import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PARSED_BYTES_PER_FILE_BYTE,
  createChunkCache,
} from '../../server/analysis/chunkCache.js';

const folder = (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hev-chunks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const feature = (geoid) =>
  JSON.stringify({
    type: 'Feature',
    properties: { geoid },
    geometry: { type: 'Point', coordinates: [0, 0] },
  });

test('area files are parsed once, shared, and read afresh when they change', async (t) => {
  const root = folder(t);
  const file = path.join(root, '25.geojsonl');
  writeFileSync(file, `${feature('25001')}\r\n\n${feature('25003')}\n`);
  const cache = createChunkCache();
  const [a, b] = await Promise.all([
    cache.features(file),
    cache.features(file),
  ]);
  assert.equal(a, b, 'two requests at once share one read');
  assert.deepEqual(
    a.map((f) => f.properties.geoid),
    ['25001', '25003'],
    'blank lines are skipped',
  );
  assert.equal(await cache.features(file), a);
  assert.equal(cache.stats().reads, 1);
  assert.ok(Object.isFrozen(a[0].properties), 'shared values cannot change');
  assert.ok(Object.isFrozen(a[0].geometry));
  writeFileSync(file, `${feature('25005')}\n`);
  utimesSync(file, new Date(2030, 0, 1), new Date(2030, 0, 1));
  const changed = await cache.features(file);
  assert.deepEqual(
    changed.map((f) => f.properties.geoid),
    ['25005'],
  );
  assert.equal(cache.stats().reads, 2);
  assert.equal(cache.stats().entries, 1);
});

test('the cache keeps the most recently used files within its budget', async (t) => {
  const root = folder(t);
  const files = ['a', 'b', 'c'].map((name) => {
    const file = path.join(root, `${name}.geojsonl`);
    writeFileSync(file, `${feature(name)}\n`);
    return file;
  });
  const one =
    Buffer.byteLength(`${feature('a')}\n`) * PARSED_BYTES_PER_FILE_BYTE;
  const cache = createChunkCache({ maxBytes: one * 2 });
  for (const file of files) await cache.features(file);
  assert.equal(cache.stats().entries, 2);
  assert.ok(cache.stats().bytes <= one * 2);
  await cache.features(files[2]);
  assert.equal(cache.stats().reads, 3, 'c was kept');
  await cache.features(files[0]);
  assert.equal(cache.stats().reads, 4, 'a was dropped first');
  const many = await createChunkCache().manyFeatures([...files].reverse());
  assert.deepEqual(
    many.map((features) => features[0].properties.geoid),
    ['c', 'b', 'a'],
    'several files come back in the order asked for',
  );
  const index = path.join(root, 'index.json');
  writeFileSync(index, '[{"id":"a"}]');
  assert.deepEqual(await cache.json(index), [{ id: 'a' }]);
  const tiny = createChunkCache({ maxBytes: 1 });
  await tiny.features(files[0]);
  assert.equal(tiny.stats().entries, 0, 'a file over the budget is not kept');
  await assert.rejects(cache.features(path.join(root, 'missing.geojsonl')));
});
