import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import {
  RUNTIME_KEYS,
  RUNTIME_KEY_DEFINES,
  createPublicDirMiddleware,
  createRuntimeKeysMiddleware,
  fillRuntimeKeys,
} from '../../build/runtime-serving.js';
import { keySetupEndpoint } from '../../server/standalone/key-setup.js';
import { buildFingerprint } from '../../scripts/pinokio-start.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hev-serving-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function call(middleware, url, headers = {}) {
  const res = {
    headers: {},
    statusCode: 0,
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };
  let nexted = false;
  await middleware({ method: 'GET', url, headers }, res, () => {
    nexted = true;
  });
  return { res, nexted };
}

test('a build carries key placeholders, never the keys', () => {
  assert.deepEqual(Object.keys(RUNTIME_KEY_DEFINES), [
    'import.meta.env.GOOGLE_MAPS_API_KEY',
    'import.meta.env.CESIUM_ION_TOKEN',
  ]);
  const source = `const a=${RUNTIME_KEY_DEFINES['import.meta.env.GOOGLE_MAPS_API_KEY']},b=${RUNTIME_KEY_DEFINES['import.meta.env.CESIUM_ION_TOKEN']};`;
  assert.equal(
    fillRuntimeKeys(source, {
      GOOGLE_MAPS_API_KEY: 'g-1',
      CESIUM_ION_TOKEN: '',
    }),
    'const a="g-1",b="";',
  );
  // A value is escaped as one string literal.
  assert.equal(
    fillRuntimeKeys(`x="${RUNTIME_KEYS.GOOGLE_MAPS_API_KEY}"`, {
      GOOGLE_MAPS_API_KEY: 'a"b',
    }),
    'x="a\\"b"',
  );
});

test('the preview server fills the current keys into built scripts', async (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(
    path.join(root, 'assets', 'index-abc.js'),
    `k=${RUNTIME_KEY_DEFINES['import.meta.env.GOOGLE_MAPS_API_KEY']};`,
  );
  writeFileSync(path.join(root, 'assets', 'plain-abc.js'), 'k=1;');
  const middleware = createRuntimeKeysMiddleware({
    assetsDir: () => path.join(root, 'assets'),
  });
  const before = process.env.GOOGLE_MAPS_API_KEY;
  t.after(() => {
    if (before === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = before;
  });
  process.env.GOOGLE_MAPS_API_KEY = 'first';
  const first = await call(middleware, '/assets/index-abc.js');
  assert.equal(first.res.body.toString(), 'k="first";');
  assert.equal(first.res.headers['cache-control'], 'no-cache');
  // A key saved in Provider Settings shows on the next load.
  process.env.GOOGLE_MAPS_API_KEY = 'second';
  const second = await call(middleware, '/assets/index-abc.js', {
    'if-none-match': first.res.headers.etag,
  });
  assert.equal(second.res.statusCode, 200);
  assert.equal(second.res.body.toString(), 'k="second";');
  // Scripts without a placeholder, and module requests, go to Vite.
  assert.equal((await call(middleware, '/assets/plain-abc.js')).nexted, true);
  assert.equal(
    (await call(middleware, '/assets/index-abc.js?import')).nexted,
    true,
  );
});

test('public files are served in place and never from outside the folder', async (t) => {
  const root = fixture(t);
  const pub = path.join(root, 'public');
  mkdirSync(path.join(pub, 'models'), { recursive: true });
  writeFileSync(path.join(pub, 'models', 'tower.glb'), 'glb');
  writeFileSync(path.join(root, 'secret.txt'), 'nope');
  const middleware = createPublicDirMiddleware({ publicDir: () => pub });
  // A file streams, so this response is a real writable stream.
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  res.headers = {};
  res.setHeader = (name, value) => (res.headers[name.toLowerCase()] = value);
  let nexted = false;
  await middleware(
    { method: 'GET', url: '/models/tower.glb', headers: {} },
    res,
    () => {
      nexted = true;
    },
  );
  await new Promise((resolve) => res.on('finish', resolve));
  assert.equal(nexted, false);
  assert.equal(Buffer.concat(chunks).toString(), 'glb');
  assert.equal(res.headers['content-type'], 'model/gltf-binary');
  const again = await call(middleware, '/models/tower.glb', {
    'if-none-match': res.headers.etag,
  });
  assert.equal(again.res.statusCode, 304);
  for (const url of [
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/missing.png',
    '/',
  ])
    assert.equal((await call(middleware, url)).nexted, true, url);
});

test('Provider Settings reaches the preview server only when Pinokio allows it', () => {
  const pinokio = keySetupEndpoint({ allowPreview: true });
  assert.equal(pinokio.apply({}, { command: 'serve', isPreview: true }), true);
  assert.equal(typeof pinokio.configurePreviewServer, 'function');
  const plain = keySetupEndpoint({ allowPreview: false });
  assert.equal(plain.apply({}, { command: 'serve', isPreview: true }), false);
  assert.equal(plain.configurePreviewServer, undefined);
});

test('the build fingerprint follows the sources and ignores tests', (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'main.js'), 'a');
  const base = buildFingerprint(root);
  writeFileSync(path.join(root, 'src', 'main.test.mjs'), 'test');
  assert.equal(buildFingerprint(root), base);
  writeFileSync(path.join(root, 'src', 'main.js'), 'ab');
  assert.notEqual(buildFingerprint(root), base);
});
