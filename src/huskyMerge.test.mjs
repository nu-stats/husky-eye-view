import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTEXT_FOLDERS,
  moduleGraph,
  resolveRequest,
  siteFiles,
} from '../scripts/husky-merge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Husky Merge loads its modules unbundled: no bare imports, the worker included', () => {
  const graph = moduleGraph();
  for (const rel of [
    'src/analysis/huskyMerge.js',
    'src/analysis/mergePanel.js',
    'src/analysis/mergeWorker.js',
    'src/analysis/mergeSession.js',
    'src/analysis/mergeScript.js',
    'src/analysis/flatMap.js',
  ])
    assert.ok(graph.includes(rel), rel);
  // The globe is never loaded.
  assert.ok(!graph.some((rel) => /userOverlay|cesium/i.test(rel)));
});

test('Husky Merge publishes every data folder the engine reads', () => {
  const used = new Set();
  for (const rel of moduleGraph())
    for (const m of readFileSync(path.join(ROOT, rel), 'utf8').matchAll(
      /context\/([a-z0-9-]+?)(?:-?\$\{|\/|['`])/g,
    ))
      used.add(m[1]);
  for (const folder of ['tracts-2020', 'states', 'segregation', 'holc'])
    assert.ok(used.has(folder), `found context/${folder} in the code`);
  // `enumeration-districts-${year}` is the four census years.
  used.delete('enumeration-districts');
  for (const folder of used)
    assert.ok(
      CONTEXT_FOLDERS.includes(folder),
      `context/${folder} is published`,
    );
  for (const year of [1900, 1910, 1920, 1930])
    assert.ok(CONTEXT_FOLDERS.includes(`enumeration-districts-${year}`));
});

test('Husky Merge serves only the app: the page, its modules and the data', () => {
  const files = siteFiles();
  assert.equal(
    resolveRequest('/', files),
    path.join(ROOT, 'husky-merge', 'index.html'),
  );
  assert.equal(
    resolveRequest('/context/states/states.geojsonl', files),
    path.join(ROOT, 'public', 'context', 'states', 'states.geojsonl'),
  );
  for (const refused of [
    '/../package.json',
    '/%2e%2e/package.json',
    '/src/app/application.js',
    '/pinokio/ENVIRONMENT',
    '/context/tracts-2020/99999.geojsonl',
    '/context/research/anything',
    '/context//states/states.geojsonl',
  ])
    assert.equal(resolveRequest(refused, files), null, refused);
});
