import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BROWSER_CSP, createBrowserViteConfig } from '../../build/vite.js';
import standaloneConfig, * as compatibility from '../../vite.config.js';
import * as providers from '../../server/providers/local.js';

test('explicit build inputs preserve browser-only defines, plugin order and loopback protections', () => {
  const plugin = { name: 'fixture-provider' };
  const config = createBrowserViteConfig({
    plugins: [plugin],
    googleApiKey: 'browser-fixture',
    cesiumToken: 'ion-fixture',
  });
  // The Host check first (it runs before every other middleware), then
  // cesium, application HTML, context compression, runtime serving, then
  // the caller's plugins.
  assert.equal(config.plugins[0].name, 'host-check');
  assert.equal(config.plugins[0].enforce, 'pre');
  assert.equal(config.plugins[3].name, 'hev-context-compression');
  assert.equal(config.plugins[4].name, 'hev-runtime-serving');
  assert.equal(config.plugins[5], plugin);
  assert.equal(config.server.host, 'localhost');
  assert.equal(config.server.port, 4173);
  assert.deepEqual(config.server.allowedHosts, ['localhost', '127.0.0.1']);
  assert.ok(config.server.fs.deny.includes('**/ENVIRONMENT'));
  assert.ok(config.server.fs.deny.includes('.env.*'));
  assert.equal(config.server.headers['X-Frame-Options'], 'DENY');
  assert.equal(config.server.headers['X-Content-Type-Options'], 'nosniff');
  const csp = config.server.headers['Content-Security-Policy'];
  assert.equal(csp, BROWSER_CSP);
  for (const directive of [
    "script-src 'self' 'unsafe-eval' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(csp.includes(directive), directive);
  }
  assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
  assert.deepEqual(config.preview.headers, config.server.headers);
  assert.deepEqual(config.define, {
    'import.meta.env.GOOGLE_MAPS_API_KEY': '"browser-fixture"',
    'import.meta.env.CESIUM_ION_TOKEN': '"ion-fixture"',
    'import.meta.env.HEV_VERSION': JSON.stringify(
      JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)))
        .version,
    ),
  });
  // A wildcard bind keeps the Host-header check; LAN names are explicit.
  for (const host of ['0.0.0.0', '::'])
    assert.deepEqual(
      createBrowserViteConfig({ host, port: '4800' }).server.allowedHosts,
      ['localhost', '127.0.0.1'],
    );
  assert.deepEqual(
    createBrowserViteConfig({
      host: '0.0.0.0',
      allowedHosts: ['localhost', '127.0.0.1', 'globe.lan'],
    }).server.allowedHosts,
    ['localhost', '127.0.0.1', 'globe.lan'],
  );
  assert.equal(
    createBrowserViteConfig({ host: '::', port: '4800' }).server.port,
    4800,
  );
});

test('build helper does not discover environment values or construct local providers', () => {
  const before = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'environment-fixture';
  try {
    const config = createBrowserViteConfig();
    assert.equal(
      config.define['import.meta.env.GOOGLE_MAPS_API_KEY'],
      undefined,
    );
    // The Host check, cesium, application HTML, context compression and
    // runtime serving: no providers.
    assert.equal(config.plugins.length, 5);
  } finally {
    if (before === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = before;
  }
});

test('root config retains existing named exports and standalone provider order', () => {
  for (const [name, value] of Object.entries(providers))
    assert.equal(compatibility[name], value, name);
  const config = standaloneConfig({ mode: 'test' });
  assert.deepEqual(
    config.plugins.slice(5, -1).map((plugin) => plugin.name),
    providers.localProviderPlugins().map((plugin) => plugin.name),
  );
  assert.equal(config.plugins.at(-2).name, 'gev-key-setup');
  assert.equal(config.plugins.at(-1).name, 'api-not-found');
});

test('build export resolves in Node and has no browser fallback', async () => {
  const exported = await import('gods-eye-view/build/vite');
  assert.equal(exported.createBrowserViteConfig, createBrowserViteConfig);
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url)),
  );
  assert.deepEqual(pkg.exports['./build/vite'], { node: './build/vite.js' });
});

test('the CSP admits the event media embeds, and no other script origin', async () => {
  const { embeddedMediaFrameUrl, resolveEmbeddedMediaSource } =
    await import('../../src/data/bhoteKoshiEmbeddedMedia.js');
  const directive = (name) =>
    BROWSER_CSP.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `))
      ?.split(/\s+/)
      .slice(1) ?? [];
  const scripts = directive('script-src');
  const frames = directive('frame-src');
  // The player API, the Facebook SDK and X's widget script.
  for (const origin of [
    'https://www.youtube.com',
    'https://connect.facebook.net',
    'https://platform.twitter.com',
  ])
    assert.ok(scripts.includes(origin), origin);
  // Only those three, and never a wildcard or a scheme.
  assert.deepEqual(
    scripts.filter(
      (source) => source.startsWith('http') || source === 'https:',
    ),
    [
      'https://www.youtube.com',
      'https://connect.facebook.net',
      'https://platform.twitter.com',
    ],
  );
  assert.ok(!scripts.some((source) => source.includes('*')));
  // Every frame the event builds for a YouTube or Facebook source is allowed.
  for (const link of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.facebook.com/facebook/videos/10153231379946729/',
  ]) {
    const source = resolveEmbeddedMediaSource(link);
    assert.ok(source, link);
    const origin = new URL(embeddedMediaFrameUrl(source, {})).origin;
    assert.ok(frames.includes(origin), `${link} -> ${origin}`);
  }
  // X posts load in X's own frames.
  assert.ok(frames.includes('https://platform.twitter.com'));
});
