import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_CHUNKS_WITHOUT_LIMIT,
  layerFolder,
  layerRows,
  layerVariables,
  readLayerAreas,
  sampleLayerVariables,
} from '../../server/analysis/layerData.js';
import { prepareSession } from '../../server/analysis/stataSession.js';

const square = (x, y) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
      [x, y],
    ],
  ],
});

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hev-layer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'context', 'tracts-test');
  mkdirSync(dir, { recursive: true });
  const write = (id, features) =>
    writeFileSync(
      path.join(dir, `${id}.geojsonl`),
      features.map((f) => JSON.stringify(f)).join('\n'),
    );
  write('25025', [
    {
      properties: {
        name: 'Tract 1, Suffolk County, MA',
        geoid: '25025000100',
        fb24: 30.5,
        pov: 12,
        summary: 'card text',
        holc_grade: 'C',
      },
      geometry: square(-71.1, 42.3),
    },
    {
      properties: {
        name: 'Tract 2, Suffolk County, MA',
        geoid: '25025000200',
        fb24: null,
        pov: 20,
        summary: 'card text',
        holc_grade: 'D',
      },
      geometry: square(-71.0, 42.3),
    },
  ]);
  write('44007', [
    {
      properties: {
        name: 'Tract 3, Providence County, RI',
        geoid: '44007000100',
        fb24: 18,
        pov: 15,
      },
      geometry: square(-71.4, 41.8),
    },
  ]);
  writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify([
      { id: '25025', bbox: [-71.1, 42.3, -69.9, 43.3] },
      { id: '44007', bbox: [-71.4, 41.8, -70.4, 42.8] },
    ]),
  );
  return root;
}

test('a layer gives every field, named like the Area Reports measures where it is one', (t) => {
  const publicDir = fixture(t);
  const { areas } = readLayerAreas({
    baseUrl: 'context/tracts-test/',
    publicDir,
  });
  assert.equal(areas.length, 3);
  const vars = layerVariables(areas);
  const names = vars.map((v) => v.name);
  assert.deepEqual(names, [
    'name',
    'geoid',
    'foreign_born_share',
    'poverty',
    'holc_grade',
    'lon',
    'lat',
  ]);
  assert.ok(!names.includes('summary'), 'card text is not data');
  assert.equal(
    vars.find((v) => v.name === 'foreign_born_share').kind,
    'numeric',
  );
  assert.equal(vars.find((v) => v.name === 'holc_grade').kind, 'string');
  assert.match(vars.find((v) => v.name === 'poverty').label, /Poverty rate/);
  const rows = layerRows(vars, areas);
  assert.equal(rows[1][2], null, 'a missing value stays missing');
  assert.equal(rows[0][5], -70.6);
});

test('one state, the map view, and a limit for large layers', (t) => {
  const publicDir = fixture(t);
  const ma = readLayerAreas({
    baseUrl: 'context/tracts-test/',
    publicDir,
    state: '25',
  });
  assert.equal(ma.areas.length, 2);
  assert.equal(ma.stateApplied, true);
  const view = readLayerAreas({
    baseUrl: 'context/tracts-test/',
    publicDir,
    view: { west: -71.5, south: 41.5, east: -70.5, north: 42.5 },
  });
  assert.deepEqual(
    view.areas.map((a) => a.properties.geoid),
    ['44007000100'],
  );
  assert.equal(layerFolder('../secret/', publicDir), null);
  assert.equal(layerFolder('context/missing/', publicDir), null);
  assert.ok(MAX_CHUNKS_WITHOUT_LIMIT >= 100);
  assert.equal(
    sampleLayerVariables({ baseUrl: 'context/tracts-test/', publicDir }).length,
    7,
  );
});

test('a Stata session can analyze one layer: all of its fields, in the chosen state', (t) => {
  const publicDir = fixture(t);
  const env = { HEV_ANALYSIS_DIR: path.join(publicDir, 'sessions') };
  const run = prepareSession(
    {
      baseUrl: 'context/tracts-test/',
      layerName: 'Test Tracts',
      state: 'MA',
      commands: ['summarize foreign_born_share poverty', 'tab holc_grade'],
    },
    { env, publicDir },
  );
  assert.equal(run.ok, true, run.problems?.join(' '));
  assert.equal(run.session.areas, 2);
  assert.equal(run.session.layer, 'Test Tracts');
  assert.match(run.session.title, /Test Tracts, 2 areas in Massachusetts/);
  const csv = readFileSync(path.join(run.session.folder, 'data.csv'), 'utf8');
  assert.match(
    csv,
    /^name,geoid,foreign_born_share,poverty,holc_grade,lon,lat/,
  );
  const doFile = readFileSync(
    path.join(run.session.folder, 'analysis.do'),
    'utf8',
  );
  assert.match(doFile, /stringcols\(1 2 5\)/);
  const unknown = prepareSession(
    { baseUrl: 'context/tracts-test/', commands: ['summarize nothing_here'] },
    { env, publicDir },
  );
  assert.equal(unknown.ok, false);
});
