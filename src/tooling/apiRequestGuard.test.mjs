import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  apiRequestGuardPlugin,
  checkApiRequest,
  createApiRequestGuard,
} from '../../build/api-request-guard.js';
import { createBrowserViteConfig } from '../../build/vite.js';
import standaloneConfig from '../../vite.config.js';

const HOST = '127.0.0.1:4173';
const PLACES = '/api/google/nearby-places?lat=30.27&lon=-97.74';
const GUARD = 'api-request-guard';
const ENFORCE_RANK = { pre: 0, post: 2 };

// Routes that had no cross-site gate of their own, plus ones that did, and
// Husky Eye View's own: the analysis programs, research data and Curated
// Flights.
const API_ROUTES = [
  '/api/cctv/frame/austin-1',
  '/api/opensky?lamin=1&lomin=1&lamax=2&lomax=2',
  '/api/tomtom/flow/10/1/1.pbf',
  '/api/firms?bbox=1,1,2,2',
  '/api/wind',
  '/api/weather?lat=1&lon=1',
  '/api/cyclones',
  '/api/fire-perimeters',
  '/api/transit/vehicles/feed',
  '/api/google/nearby-places?lat=1&lon=1',
  '/api/realtime/token',
  '/api/setup/status',
  '/api/stata/status',
  '/api/r/run',
  '/api/spss/status',
  '/api/excel/run',
  '/api/research/status',
  '/api/curated/status',
];

function check(headers, request = {}) {
  return checkApiRequest({
    method: 'GET',
    path: PLACES,
    headers: { host: HOST, ...headers },
    ...request,
  });
}

function post(path, contentType, headers = {}) {
  return checkApiRequest({
    method: 'POST',
    path,
    headers: {
      host: HOST,
      'sec-fetch-site': 'same-origin',
      'content-length': '12',
      ...(contentType === undefined ? {} : { 'content-type': contentType }),
      ...headers,
    },
  });
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    end(body = '') {
      this.body = String(body);
    },
  };
}

/** Order plugins the way Vite runs their server hooks: `pre`, normal, `post`. */
function inHookOrder(plugins) {
  const rank = (plugin) => ENFORCE_RANK[plugin.enforce] ?? 1;
  return plugins
    .filter(Boolean)
    .map((plugin, index) => ({ plugin, index }))
    .sort((a, b) => rank(a.plugin) - rank(b.plugin) || a.index - b.index)
    .map(({ plugin }) => plugin);
}

test('requests from the app itself pass', () => {
  assert.deepEqual(check({ 'sec-fetch-site': 'same-origin' }), { ok: true });
  assert.deepEqual(check({ 'sec-fetch-site': 'none' }), { ok: true });
  assert.deepEqual(check({ 'sec-fetch-site': 'Same-Origin' }), { ok: true });
});

test('requests from other sites and other localhost ports are refused', () => {
  for (const site of ['cross-site', 'same-site', 'unexpected']) {
    const verdict = check({ 'sec-fetch-site': site });
    assert.equal(verdict.ok, false, site);
    assert.equal(verdict.status, 403, site);
    assert.equal(verdict.error, 'Cross-site requests are not accepted');
  }
});

test('without Sec-Fetch-Site, an Origin must name this server exactly', () => {
  assert.deepEqual(check({ origin: 'http://127.0.0.1:4173' }), { ok: true });
  for (const origin of [
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'https://127.0.0.1:4173',
    'http://evil.example',
    'null',
    'http://127.0.0.1:4173/path',
    'http://user@127.0.0.1:4173',
    'not a url',
  ]) {
    const verdict = check({ origin });
    assert.equal(verdict.ok, false, origin);
    assert.equal(verdict.status, 403, origin);
  }
  assert.equal(
    check({ origin: 'http://evil.example' }).error,
    'Cross-origin requests are not accepted',
  );
  assert.equal(
    check({ origin: 'null' }).error,
    'Opaque origins are not accepted',
  );
  // With no Host header there is nothing to compare the Origin with.
  const hostless = checkApiRequest({
    headers: { origin: 'http://127.0.0.1:4173' },
  });
  assert.equal(hostless.ok, false);
});

test('TLS requests compare against the https origin', () => {
  assert.deepEqual(
    check({ origin: 'https://127.0.0.1:4173' }, { encrypted: true }),
    { ok: true },
  );
  assert.equal(
    check({ origin: 'http://127.0.0.1:4173' }, { encrypted: true }).ok,
    false,
  );
});

test('Sec-Fetch-Site decides when a browser sends it', () => {
  // Behind a TLS-terminating proxy the browser's Origin is https while the
  // server sees plain http; the browser's own label still says same-origin.
  assert.deepEqual(
    check({
      'sec-fetch-site': 'same-origin',
      origin: 'https://globe.example',
    }),
    { ok: true },
  );
  assert.equal(
    check({ 'sec-fetch-site': 'cross-site', origin: 'http://127.0.0.1:4173' })
      .ok,
    false,
  );
});

test('non-browser clients without either header pass', () => {
  assert.deepEqual(check({}), { ok: true });
  assert.deepEqual(checkApiRequest(), { ok: true });
  // What Node's fetch sends for the MCP server's tool calls.
  assert.deepEqual(
    check({ 'sec-fetch-mode': 'cors', 'user-agent': 'node', accept: '*/*' }),
    { ok: true },
  );
});

test('reverse-proxy headers alone do not refuse a request', () => {
  // An authentication proxy in front of the server adds these to every
  // request; the routes that refuse proxied requests still do so themselves.
  const proxied = {
    'x-forwarded-for': '203.0.113.7',
    'x-forwarded-proto': 'https',
    forwarded: 'for=203.0.113.7',
    via: '1.1 proxy',
  };
  assert.deepEqual(check({ ...proxied, 'sec-fetch-site': 'same-origin' }), {
    ok: true,
  });
  assert.deepEqual(check(proxied), { ok: true });
  assert.equal(check({ ...proxied, 'sec-fetch-site': 'cross-site' }).ok, false);
});

test('request bodies must be JSON', () => {
  for (const type of [
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON',
    'application/merge-patch+json',
  ]) {
    assert.deepEqual(post('/api/openai/hud-summary', type), { ok: true }, type);
  }
  for (const type of [
    'text/plain',
    'text/plain;charset=UTF-8',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    undefined,
  ]) {
    const verdict = post('/api/openai/hud-summary', type);
    assert.equal(verdict.ok, false, String(type));
    assert.equal(verdict.status, 415, String(type));
    assert.equal(verdict.error, 'Content-Type must be application/json');
  }
});

test('the Overpass proxy keeps its form-encoded queries', () => {
  const form = 'application/x-www-form-urlencoded';
  assert.deepEqual(post('/api/overpass', form), { ok: true });
  assert.deepEqual(post('/api/overpass?mirror=1', form), { ok: true });
  assert.deepEqual(post('/api/overpass/interpreter', form), { ok: true });
  assert.deepEqual(post('/API/Overpass', form), { ok: true });
  assert.equal(post('/api/overpass', 'text/plain').status, 415);
  assert.equal(post('/api/overpassx', form).status, 415);
  assert.equal(post('/api/openai/hud-summary', form).status, 415);
});

test('requests without a body need no Content-Type', () => {
  assert.deepEqual(
    post('/api/radio/click/abc', undefined, { 'content-length': '0' }),
    { ok: true },
  );
  assert.deepEqual(
    checkApiRequest({
      method: 'POST',
      path: '/api/radio/click/abc',
      headers: { host: HOST, 'sec-fetch-site': 'same-origin' },
    }),
    { ok: true },
  );
  assert.deepEqual(
    checkApiRequest({
      method: 'DELETE',
      path: '/api/cctv/media/abc',
      headers: { host: HOST, 'sec-fetch-site': 'same-origin' },
    }),
    { ok: true },
  );
  assert.equal(
    post('/api/openai/hud-summary', 'text/plain', {
      'content-length': undefined,
      'transfer-encoding': 'chunked',
    }).status,
    415,
  );
});

test('the middleware passes allowed requests on and refuses the rest with JSON', () => {
  const logged = [];
  const guard = createApiRequestGuard({
    log: (message) => logged.push(message),
    now: () => 1000,
  });
  let passed = 0;
  const next = () => {
    passed += 1;
  };

  guard(
    {
      method: 'GET',
      url: '/google/nearby-places?lat=30.27&lon=-97.74',
      originalUrl: PLACES,
      headers: { host: HOST, 'sec-fetch-site': 'same-origin' },
      socket: {},
    },
    response(),
    next,
  );
  assert.equal(passed, 1);

  const res = response();
  guard(
    {
      method: 'GET',
      url: '/google/nearby-places?lat=30.27&lon=-97.74',
      originalUrl: PLACES,
      headers: { host: HOST, 'sec-fetch-site': 'cross-site' },
      socket: {},
    },
    res,
    next,
  );
  assert.equal(passed, 1);
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), {
    error: 'Cross-site requests are not accepted',
  });
  assert.deepEqual(logged, [
    '[API guard] Refused GET /api/google/nearby-places (Sec-Fetch-Site: cross-site)',
  ]);
});

test('refusals are logged at most once a minute per route', () => {
  let clock = 0;
  const logged = [];
  const guard = createApiRequestGuard({
    log: (message) => logged.push(message),
    now: () => clock,
  });
  const refuse = (path) =>
    guard(
      {
        method: 'POST',
        originalUrl: path,
        headers: { host: HOST, origin: 'http://evil.example' },
        socket: {},
      },
      response(),
      () => assert.fail('a refused request must not reach the route'),
    );

  refuse('/api/realtime/debug-log');
  refuse('/api/realtime/debug-log');
  refuse('/api/openai/hud-summary');
  clock = 59_999;
  refuse('/api/realtime/debug-log');
  clock = 60_000;
  refuse('/api/realtime/debug-log');
  assert.deepEqual(logged, [
    '[API guard] Refused POST /api/realtime/debug-log (Origin: http://evil.example)',
    '[API guard] Refused POST /api/openai/hud-summary (Origin: http://evil.example)',
    '[API guard] Refused POST /api/realtime/debug-log (Origin: http://evil.example)',
  ]);
});

test('cycling paths cannot flood the log: 20 refusal lines a minute in all', () => {
  let clock = 0;
  const logged = [];
  const guard = createApiRequestGuard({
    log: (message) => logged.push(message),
    now: () => clock,
  });
  const refuse = (path) =>
    guard(
      {
        method: 'POST',
        originalUrl: path,
        headers: { host: HOST, origin: 'http://evil.example' },
        socket: {},
      },
      response(),
      () => assert.fail('a refused request must not reach the route'),
    );

  for (let index = 0; index < 50; index++) refuse(`/api/cctv/frame/${index}`);
  assert.equal(logged.length, 20);
  clock = 60_000;
  refuse('/api/cctv/frame/new');
  assert.equal(logged.length, 21);
});

test('logged values cannot carry terminal control sequences', () => {
  const logged = [];
  const guard = createApiRequestGuard({
    log: (message) => logged.push(message),
  });
  guard(
    {
      method: 'GET',
      originalUrl: '/api/x',
      headers: { host: HOST, origin: 'http://evil.example\u001b[2J' },
      socket: {},
    },
    response(),
    () => {},
  );
  assert.equal(logged.length, 1);
  assert.equal(logged[0].includes('\u001b'), false);
  assert.match(logged[0], /Origin: http:\/\/evil\.example\?\[2J/);
});

test('the guard runs right after the Host check, ahead of every route, in dev and preview', () => {
  for (const plugins of [
    createBrowserViteConfig().plugins,
    standaloneConfig({ command: 'serve', mode: 'test' }).plugins,
  ]) {
    for (const hook of ['configureServer', 'configurePreviewServer']) {
      const names = inHookOrder(plugins)
        .filter((plugin) => typeof plugin[hook] === 'function')
        .map((plugin) => plugin.name);
      assert.deepEqual(names.slice(0, 2), ['host-check', GUARD], hook);
    }
  }
  const mounted = [];
  apiRequestGuardPlugin().configureServer({
    middlewares: { use: (route) => mounted.push(route) },
  });
  assert.deepEqual(mounted, ['/api']);
});

/** Send a raw request and collect the status, headers and body. */
function send(port, url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: url,
        method,
        headers: { host: `127.0.0.1:${port}`, ...headers },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: text }),
        );
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

/** A provider stand-in: answers every `/api` route and records what reached it. */
function fixtureRoutes(reached) {
  const install = (server) => {
    server.middlewares.use('/api', (req, res) => {
      reached.push(`${req.method} ${req.originalUrl}`);
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    });
  };
  return {
    name: 'fixture-routes',
    configureServer: install,
    configurePreviewServer: install,
  };
}

async function exerciseServer(port, reached) {
  const origin = `http://127.0.0.1:${port}`;
  for (const route of API_ROUTES) {
    for (const headers of [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { origin: 'http://evil.example' },
    ]) {
      const refused = await send(port, route, { headers });
      assert.equal(refused.status, 403, `${route} ${JSON.stringify(headers)}`);
      assert.equal(refused.headers['access-control-allow-origin'], undefined);
    }
  }
  const refusedClick = await send(port, '/api/radio/click/abc', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site', 'content-length': '0' },
  });
  assert.equal(refusedClick.status, 403);
  // With CORS off, a cross-origin preflight reaches the guard and is refused,
  // so no JSON request follows it.
  const preflight = await send(port, '/api/openai/hud-summary', {
    method: 'OPTIONS',
    headers: {
      origin: 'http://evil.example',
      'sec-fetch-site': 'cross-site',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  const textBody = await send(port, '/api/realtime/debug-log', {
    method: 'POST',
    headers: {
      'sec-fetch-site': 'same-origin',
      'content-type': 'text/plain',
    },
    body: '{}',
  });
  assert.equal(textBody.status, 415);
  assert.deepEqual(reached, [], 'no refused request reached a route');

  for (const headers of [
    { 'sec-fetch-site': 'same-origin' },
    { 'sec-fetch-site': 'none' },
    { origin },
    {},
    { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.7' },
  ]) {
    const allowed = await send(port, '/api/cctv/frame/austin-1', { headers });
    assert.equal(allowed.status, 200, JSON.stringify(headers));
  }
  const form = await send(port, '/api/overpass', {
    method: 'POST',
    headers: {
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'data=%5Bout%3Ajson%5D%3B',
  });
  assert.equal(form.status, 200);
  const click = await send(port, '/api/radio/click/abc', {
    method: 'POST',
    headers: { origin, 'content-length': '0' },
  });
  assert.equal(click.status, 200);
  assert.deepEqual(reached, [
    'GET /api/cctv/frame/austin-1',
    'GET /api/cctv/frame/austin-1',
    'GET /api/cctv/frame/austin-1',
    'GET /api/cctv/frame/austin-1',
    'GET /api/cctv/frame/austin-1',
    'POST /api/overpass',
    'POST /api/radio/click/abc',
  ]);
}

function serverOptions(base, root, reached) {
  return {
    ...base,
    root,
    configFile: false,
    envFile: false,
    publicDir: false,
    logLevel: 'silent',
    // Only the Host check, the guard and the stand-in routes.
    plugins: [
      ...base.plugins.filter((plugin) =>
        ['host-check', GUARD].includes(plugin?.name),
      ),
      fixtureRoutes(reached),
    ],
    optimizeDeps: { noDiscovery: true, include: [] },
  };
}

test('the dev server refuses cross-site requests before any /api route runs', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { createServer } = await import('vite');
  const reached = [];
  const base = createBrowserViteConfig();
  const vite = await createServer({
    ...serverOptions(
      base,
      fileURLToPath(new URL('../../', import.meta.url)),
      reached,
    ),
    server: {
      ...base.server,
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      watch: null,
    },
  });
  await vite.listen();
  t.after(() => vite.close());
  await exerciseServer(vite.httpServer.address().port, reached);

  // Pages are not /api routes; the guard leaves them alone.
  const page = await send(vite.httpServer.address().port, '/index.html', {
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.notEqual(page.status, 403);
});

test('the preview server refuses them too', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { preview } = await import('vite');
  const root = await mkdtemp(path.join(tmpdir(), 'gev-api-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>t');
  const reached = [];
  const base = createBrowserViteConfig();
  const server = await preview({
    ...serverOptions(base, root, reached),
    build: { outDir: root },
    preview: { ...base.preview, host: '127.0.0.1', port: 0 },
  });
  t.after(() => new Promise((resolve) => server.httpServer.close(resolve)));
  await exerciseServer(server.httpServer.address().port, reached);
});
