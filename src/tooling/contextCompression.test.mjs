import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  createContextCompressionMiddleware,
  pickEncoding,
} from '../../build/context-compression.js';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hev-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'context', 'tracts'), { recursive: true });
  const body = `${'{"type":"Feature","properties":{"pm25":7.1}}\n'.repeat(400)}`;
  writeFileSync(path.join(root, 'context', 'tracts', '25025.geojsonl'), body);
  writeFileSync(path.join(root, 'secret.txt'), 'nope');
  return { root, body };
}

async function call(middleware, url, headers = {}) {
  const res = {
    headers: {},
    statusCode: 0,
    body: null,
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

test('area-layer chunks are served compressed when the browser accepts it', async (t) => {
  const { root, body } = fixture(t);
  const middleware = createContextCompressionMiddleware({ publicRoot: () => root });
  const br = await call(middleware, '/context/tracts/25025.geojsonl', {
    'accept-encoding': 'gzip, deflate, br',
  });
  assert.equal(br.nexted, false);
  assert.equal(br.res.headers['content-encoding'], 'br');
  assert.equal(br.res.headers.vary, 'Accept-Encoding');
  assert.equal(zlib.brotliDecompressSync(br.res.body).toString(), body);
  assert.ok(br.res.body.length < body.length / 5, 'repetitive text shrinks a lot');

  const gz = await call(middleware, '/context/tracts/25025.geojsonl', {
    'accept-encoding': 'gzip',
  });
  assert.equal(gz.res.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(gz.res.body).toString(), body);
});

test('a reload revalidates an unchanged chunk instead of downloading it', async (t) => {
  const { root } = fixture(t);
  const middleware = createContextCompressionMiddleware({ publicRoot: () => root });
  const url = '/context/tracts/25025.geojsonl';
  const first = await call(middleware, url, { 'accept-encoding': 'br' });
  const tag = first.res.headers.etag;
  assert.match(tag, /^W\/".+-br"$/);
  const again = await call(middleware, url, {
    'accept-encoding': 'br',
    'if-none-match': tag,
  });
  assert.equal(again.res.statusCode, 304);
  assert.equal(again.res.body, undefined);
  // Another encoding is another representation.
  const gz = await call(middleware, url, {
    'accept-encoding': 'gzip',
    'if-none-match': tag,
  });
  assert.equal(gz.res.statusCode, 200);
});

test('point-layer files under an extra root are compressed too', async (t) => {
  const { root, body } = fixture(t);
  const data = path.join(root, 'local_data');
  mkdirSync(path.join(data, 'dams'), { recursive: true });
  writeFileSync(path.join(data, 'dams', 'dams.geojsonl'), body);
  const middleware = createContextCompressionMiddleware({
    publicRoot: () => root,
    extraRoots: () => [{ prefix: '/src/data/local_data/', dir: data }],
  });
  const served = await call(middleware, '/src/data/local_data/dams/dams.geojsonl', {
    'accept-encoding': 'br',
  });
  assert.equal(served.nexted, false);
  assert.equal(zlib.brotliDecompressSync(served.res.body).toString(), body);
  // JSON imported as code (?import) and paths escaping the folder go to Vite.
  for (const url of [
    '/src/data/local_data/dams/dams.geojsonl?import',
    '/src/data/local_data/../secret.txt',
  ]) {
    assert.equal(
      (await call(middleware, url, { 'accept-encoding': 'br' })).nexted,
      true,
      url,
    );
  }
});

test('everything else falls through to Vite untouched', async (t) => {
  const { root } = fixture(t);
  const middleware = createContextCompressionMiddleware({ publicRoot: () => root });
  for (const [url, headers] of [
    ['/context/tracts/25025.geojsonl', {}],
    ['/src/main.js', { 'accept-encoding': 'br' }],
    ['/context/tracts/missing.geojsonl', { 'accept-encoding': 'br' }],
    ['/context/../secret.txt', { 'accept-encoding': 'br' }],
  ]) {
    assert.equal((await call(middleware, url, headers)).nexted, true, url);
  }
  assert.equal(pickEncoding('gzip;q=1.0, br;q=0.9'), 'br');
  assert.equal(pickEncoding('identity'), null);
});
