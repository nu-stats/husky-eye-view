import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBrowserViteConfig } from '../../build/vite.js';

const PRIVATE_DIRECTORIES = [
  '.gev-logs',
  '.gev-cache',
  'data/restricted',
  'data/source',
  'data/inputs',
];
const PRIVATE_FILES = [
  '.gev-logs/realtime-conversations.jsonl',
  '.gev-cache/tomtom/budget.json',
  '.claude/settings.local.json',
  '.claude/agents/reviewer.md',
  // Plaintext research data: only its encrypted copy is ever served.
  'data/restricted/gva_2015/gva_2015.geojsonl',
  'data/source/census/tracts.csv',
  'data/inputs/chicago_events2.json',
];
// The deny list before these directories joined it.
const EARLIER_DENY = [
  '.env',
  '.env.*',
  '*.{crt,pem}',
  '**/.git/**',
  '**/ENVIRONMENT',
];

/** Send a raw request and collect the status and headers. */
function request(port, rawPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    http
      .request(
        { host: '127.0.0.1', port, path: rawPath, method, headers },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res));
        },
      )
      .on('error', reject)
      .end();
  });
}

async function fixtureRoot(t, inside = '') {
  const top = await mkdtemp(path.join(tmpdir(), 'gev-server-config-'));
  t.after(() => rm(top, { recursive: true, force: true }));
  const root = path.join(top, inside);
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><title>t</title>',
  );
  await writeFile(path.join(root, 'public.txt'), 'public');
  for (const file of PRIVATE_FILES) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'private');
  }
  return root;
}

async function startServer(t, root, server) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, ...server },
  });
  t.after(() => vite.close());
  await vite.listen();
  return vite.httpServer.address().port;
}

test('the dev and preview servers have CORS turned off', () => {
  const config = createBrowserViteConfig();
  assert.equal(config.server.cors, false);
  assert.equal(config.preview.cors, false);
});

test('the dev server denies its private directories', () => {
  const { deny } = createBrowserViteConfig().server.fs;
  for (const directory of PRIVATE_DIRECTORIES) {
    assert.ok(deny.includes(`**/${directory}/**`), directory);
  }
  assert.ok(deny.includes('**/.claude/*'));
  assert.ok(deny.includes('**/.claude/!(worktrees)/**'));
  // The earlier protections stay in place.
  for (const pattern of EARLIER_DENY)
    assert.ok(deny.includes(pattern), pattern);
});

test('without these settings Vite would serve the private files and let other localhost origins read them', async (t) => {
  const root = await fixtureRoot(t);
  const port = await startServer(t, root, { fs: { deny: EARLIER_DENY } });
  for (const file of PRIVATE_FILES) {
    assert.equal((await request(port, `/${file}`)).statusCode, 200, file);
  }
  const page = await request(port, '/public.txt', {
    headers: { origin: 'http://localhost:9999' },
  });
  assert.equal(
    page.headers['access-control-allow-origin'],
    'http://localhost:9999',
  );
});

test('Vite refuses the private files and answers other origins without CORS', async (t) => {
  const { cors, fs } = createBrowserViteConfig().server;
  const root = await fixtureRoot(t);
  const port = await startServer(t, root, { cors, fs: { deny: fs.deny } });

  for (const file of PRIVATE_FILES) {
    assert.equal((await request(port, `/${file}`)).statusCode, 403, file);
  }

  const origin = { origin: 'http://localhost:9999' };
  const page = await request(port, '/public.txt', { headers: origin });
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers['access-control-allow-origin'], undefined);

  const preflight = await request(port, '/public.txt', {
    method: 'OPTIONS',
    headers: { ...origin, 'access-control-request-method': 'POST' },
  });
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
});

test('a checkout under .claude/worktrees is served, its own private files are not', async (t) => {
  const { cors, fs } = createBrowserViteConfig().server;
  const root = await fixtureRoot(t, path.join('.claude', 'worktrees', 'w'));
  const port = await startServer(t, root, { cors, fs: { deny: fs.deny } });
  assert.equal((await request(port, '/public.txt')).statusCode, 200);
  assert.equal((await request(port, '/index.html')).statusCode, 200);
  for (const file of PRIVATE_FILES) {
    assert.equal((await request(port, `/${file}`)).statusCode, 403, file);
  }
});
