import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { MergeSession } from './mergeSession.js';
import { readDta, readSav } from './statRead.js';
import { parseDbf, parseShp } from '../curated/userData.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '..', '..', 'public');
const readContext = (p) => readFileSync(path.join(PUBLIC, p), 'utf8');
const bytes = (text) => new TextEncoder().encode(text);

/** A ZIP's entries by name. */
function unzip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = new Map();
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const method = view.getUint16(at + 8, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(
      zip.slice(at + 30, at + 30 + nameLength),
    );
    const data = zip.slice(
      at + 30 + nameLength + extra,
      at + 30 + nameLength + extra + size,
    );
    out.set(name, method === 8 ? new Uint8Array(inflateRawSync(data)) : data);
    at += 30 + nameLength + extra + size;
  }
  return out;
}
const text = (b) => new TextDecoder().decode(b);

test('convert: a Stata file saved as SPSS keeps its values, labels and dates', async () => {
  const s = new MergeSession({ readContext });
  const fixture = new Uint8Array(
    readFileSync(path.join(HERE, 'fixtures', 'haven-v14.dta')),
  );
  const opened = await s.open('survey.dta', fixture);
  assert.equal(opened.rows, 4);
  const file = await s.exportConverted('sav');
  assert.equal(file.fileName, 'survey.sav');
  const back = await readSav(file.bytes);
  const original = readDta(fixture);
  assert.deepEqual(
    back.rows.map((r) => r.slice(0, 3)),
    original.rows.map((r) => r.slice(0, 3)),
  );
  assert.equal(back.columns[1].label, 'A value — with a label');
  assert.deepEqual(back.columns.find((c) => c.name === 'grade').valueLabels, {
    1: 'Low',
    2: 'Mid',
    3: 'High',
  });
  const zipped = unzip(
    (await s.exportConverted('dta', { codebook: true })).bytes,
  );
  assert.deepEqual([...zipped.keys()], ['survey.dta', 'codebook.csv']);
});

test('merge: the ZIP holds the data, a do-file, an R script, the steps and the inputs', async () => {
  const s = new MergeSession({ readContext });
  // Excel dropped the leading zero of Alabama's tract IDs.
  await s.open(
    'my tracts.csv',
    bytes(
      'tractfips,county_code,uninsured\n1001020100,001,5.5\n25025010405,025,7\n99999999999,999,1',
    ),
  );
  await s.open(
    'county facts.csv',
    bytes('county_code,clinics\n001,4\n025,40'),
    'second',
  );
  const merged = s.mergeSecond({
    leftKey: 'county_code',
    rightKey: 'county_code',
    keep: 'left',
  });
  assert.equal(merged.matched, 2);
  const attached = await s.attach(['tract:poverty', 'county:life-expectancy']);
  assert.equal(attached.matchedRows, 2);
  const zip = await s.exportMerged('dta');
  assert.equal(zip.fileName, 'my_tracts_merged_dta.zip');
  const files = unzip(zip.bytes);
  for (const name of [
    'my_tracts_merged.dta',
    'my_tracts_merge.do',
    'my_tracts_merge.R',
    'my_tracts_steps.txt',
    'codebook.csv',
    'inputs/my_tracts_as_read.csv',
    'inputs/county_facts_as_read.csv',
    'inputs/hev_step3_tract.csv',
    'inputs/hev_step3_county.csv',
    'inputs/original/my tracts.csv',
  ])
    assert.ok(files.has(name), name);
  // The data file is the session's table.
  const dta = readDta(files.get('my_tracts_merged.dta'));
  assert.equal(dta.rows.length, 3);
  const geoid = dta.columns.findIndex((c) => c.name === 'hev_geoid');
  // The clean ID used to match (a well-formed ID that is not on the map stays;
  // hev_matched says it did not match).
  assert.deepEqual(
    dta.rows.map((r) => r[geoid]),
    ['01001020100', '25025010405', '99999999999'],
  );
  const matched = dta.columns.findIndex((c) => c.name === 'hev_matched');
  assert.deepEqual(
    dta.rows.map((r) => r[matched]),
    [3, 3, 1],
  );
  // The do-file: each step, merges on plain (not strL) keys, the checks.
  const doFile = text(files.get('my_tracts_merge.do'));
  assert.match(doFile, /^\* my_tracts_merge\.do/);
  assert.match(
    doFile,
    // Each county once on both sides here: one to one.
    /merge 1:1 hev__key using `other', keep\(master match\)/,
  );
  assert.match(doFile, /merge m:1 hev__k using `tract', keep\(master match\)/);
  assert.doesNotMatch(doFile, /strL hev__k/);
  assert.match(doFile, /assert _N == 3/);
  assert.match(doFile, /cf _all using `rebuilt'/);
  assert.match(
    doFile,
    /ustrregexra\(hev__g, "\^\.\*\[Uu\]\[Ss\]", ""\), "\\\.0\+\\\$", ""\)/,
  );
  // The app's data: exactly the areas found.
  const tract = text(files.get('inputs/hev_step3_tract.csv'))
    .trim()
    .split('\n');
  assert.equal(tract[0], 'hev__k,tract_poverty');
  assert.equal(tract.length, 3);
  // The steps, in words, with their numbers.
  const steps = text(files.get('my_tracts_steps.txt'));
  assert.match(steps, /Step 1\. Read your file my tracts\.csv/);
  assert.match(
    steps,
    /Step 2\. Merge with county facts\.csv on county_code = county_code/,
  );
  assert.match(steps, /Matched 2 of 3 rows/);
  assert.match(steps, /Source: ACS 2020–2024/);
});

test('levels: a file of tracts and counties is matched row by row at each row’s own level', async () => {
  const s = new MergeSession({ readContext });
  const opened = await s.open(
    'mixed.csv',
    // Excel dropped Los Angeles's leading zero, in a county and a tract.
    bytes('GEOID,v\n25025010405,1\n25025,2\n6037,3\n6037101110,4\n,5'),
  );
  assert.equal(opened.join.level, 'mixed');
  assert.match(opened.describe, /2 tracts, 2 counties/);
  assert.match(opened.describe, /1 row has no usable ID/);
  const levels = new Set(
    s.choices().flatMap((g) => g.items.map((i) => i.level)),
  );
  assert.ok(levels.has('tract') && levels.has('county') && levels.has('state'));
  const a = await s.attach(['tract:poverty', 'county:poverty']);
  assert.equal(a.matchedRows, 4);
  const t = s.current.table;
  const at = (name) => t.columns.findIndex((c) => c.name === name);
  assert.deepEqual(
    t.rows.map((r) => r[at('hev_level')]),
    ['tract', 'county', 'county', 'tract', null],
  );
  // Tract data only on tract rows; county data on every row with a county.
  assert.deepEqual(
    t.rows.map((r) => r[at('tract_poverty')] !== null),
    [true, false, false, true, false],
  );
  assert.deepEqual(
    t.rows.map((r) => r[at('county_poverty')] !== null),
    [true, true, true, true, false],
  );
  assert.equal(
    t.rows[0][at('county_poverty')],
    t.rows[1][at('county_poverty')],
  );
  const files = unzip((await s.exportMerged('dta')).bytes);
  const doFile = text(files.get('mixed_merge.do'));
  assert.match(
    doFile,
    /replace hev__g = "" if !inlist\(strlen\(hev__g\), 11, 5\)/,
  );
  assert.match(doFile, /replace hev_level = "county" if strlen\(hev__g\) == 5/);
  assert.match(
    doFile,
    /replace hev__m = hev__m_tract if missing\(hev__m\) & hev__k_tract != ""/,
  );
  assert.match(
    text(files.get('mixed_steps.txt')),
    /Each row is matched at its own level/,
  );
});

test('levels: a county file given tract data becomes one row per tract, each keeping the county’s values', async () => {
  const s = new MergeSession({ readContext });
  await s.open('clinics.csv', bytes('county_fips,clinics\n25025,40\n99999,1'));
  const tractItem = s
    .choices()
    .flatMap((g) => g.items)
    .find((i) => i.id === 'tract:poverty');
  assert.equal(tractItem.expands, true);
  const tracts = readContext('context/tracts-2020/25025.geojsonl')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).properties.geoid)
    .sort();
  const a = await s.attach(['tract:poverty', 'county:life-expectancy']);
  assert.equal(a.expanded, true);
  assert.equal(a.rows, tracts.length + 1);
  assert.match(a.notes[0], /Each county became one row per tract in it/);
  assert.match(a.notes[0], /1 without tracts stays one row/);
  const t = s.current.table;
  const at = (name) => t.columns.findIndex((c) => c.name === name);
  assert.deepEqual(
    t.rows.slice(0, -1).map((r) => r[at('hev_tract_geoid')]),
    tracts,
  );
  // The county's own value on every one of its tracts, and its data.
  assert.ok(t.rows.slice(0, -1).every((r) => r[at('clinics')] === 40));
  assert.equal(
    new Set(t.rows.slice(0, -1).map((r) => r[at('county_le')])).size,
    1,
  );
  assert.deepEqual(t.rows.at(-1).slice(0, 2), ['99999', 1]);
  assert.equal(t.rows.at(-1)[at('hev_tract_geoid')], null);
  // Every row still comes from a row of your file (for the shapefile).
  assert.deepEqual([...new Set(t.origin)], [0, 1]);
  const files = unzip((await s.exportMerged('csv')).bytes);
  const units = text(files.get('inputs/hev_step2_tracts.csv'))
    .trim()
    .split('\n');
  assert.equal(units[0], 'hev__g,hev_tract_geoid,hev_tract_name');
  assert.equal(units.length, tracts.length + 1);
  const doFile = text(files.get('clinics_merge.do'));
  assert.match(doFile, /joinby hev__g using `units', unmatched\(master\)/);
  assert.match(doFile, /sort hev__row hev__u/);
  assert.match(
    text(files.get('clinics_steps.txt')),
    /Step 2\. One row per tract: each county row became/,
  );
});

test('levels: a state file given county data becomes one row per county; a city takes the county its center is in', async () => {
  const s = new MergeSession({ readContext });
  await s.open('states.csv', bytes('state_fips,v\n44,1'));
  const a = await s.attach(['county:poverty']);
  assert.equal(a.expanded, true);
  // Rhode Island's five counties.
  assert.equal(a.rows, 5);
  assert.equal(a.matchedRows, 5);
  const c = new MergeSession({ readContext });
  await c.open('cities.csv', bytes('place_fips,v\n2507000,1'));
  const b = await c.attach(['county:poverty', 'place:segregation24']);
  assert.equal(b.expanded, false);
  assert.match(
    b.notes.join(' '),
    /City rows take the county their center is in/,
  );
  const files = unzip((await c.exportMerged('csv')).bytes);
  // Boston's center is in Suffolk County.
  assert.equal(
    text(files.get('inputs/hev_step2_city_county.csv')).trim(),
    'hev__p,hev__c\n2507000,25025',
  );
});

test('levels: state, county and tract code columns make one tract GEOID, not mixed IDs', async () => {
  const s = new MergeSession({ readContext });
  const opened = await s.open(
    'parts.csv',
    bytes('state,county,tract,v\n25,25,10405,1\n25,25,010404,2\n6,37,101110,3'),
  );
  assert.equal(opened.join.level, 'tract');
  assert.match(opened.describe, /joined by state \+ county \+ tract/);
});

test('merge: points tagged, counted per tract, with the located file for replication', async () => {
  const s = new MergeSession({ readContext });
  await s.open(
    'sites.csv',
    bytes(
      'site,lat,lon\nneu,42.3398,-71.0892\nneu2,42.3401,-71.0889\nsea,42.0,-69.0',
    ),
  );
  const counted = await s.count('tract');
  assert.equal(counted.withPoints, 1);
  await s.attach(['tract:poverty']);
  const files = unzip((await s.exportMerged('csv')).bytes);
  const located = text(files.get('inputs/hev_step2_located.csv'))
    .trim()
    .split('\n');
  assert.deepEqual(located.slice(0, 4), [
    'hev__row,hev__area',
    '1,25025010405',
    '2,25025010405',
    '3,',
  ]);
  assert.match(
    text(files.get('sites_merge.do')),
    /collapse \(sum\) points, by\(hev__area\)/,
  );
  assert.ok(files.has('sites_merged.csv'));
});

/** Point sets of a polygon, ignoring ring direction. */
const pointSet = (g) =>
  [
    ...new Set(
      (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
        .flat(1)
        .flatMap((ring) => ring.map(([x, y]) => `${x},${y}`)),
    ),
  ]
    .sort()
    .join(';');

test('shapefile: the merged data keeps your file’s own geography, nothing else', async () => {
  const s = new MergeSession({ readContext });
  await s.open(
    'my tracts.csv',
    bytes(
      'tractfips,county_code\n1001020100,001\n25025010405,025\n99999999999,999',
    ),
  );
  await s.open(
    'counties.csv',
    bytes('county_code,clinics\n001,4\n025,40\n777,7'),
    'second',
  );
  s.mergeSecond({
    leftKey: 'county_code',
    rightKey: 'county_code',
    keep: 'outer',
  });
  await s.attach(['tract:poverty', 'county:life-expectancy']);
  const zip = await s.exportMerged('shp');
  const files = unzip(zip.bytes);
  for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg'])
    assert.ok(files.has(`my_tracts_merged.${ext}`), ext);
  assert.ok(
    files.has('my_tracts_merge.do') && files.has('my_tracts_steps.txt'),
  );
  const shapes = parseShp(files.get('my_tracts_merged.shp'));
  // Two tracts of your file; your unmatched ID and the second file's own row: no shape.
  assert.equal(shapes.length, 4);
  assert.deepEqual(
    shapes.map((g) => (g ? g.type.replace('Multi', '') : null)),
    ['Polygon', 'Polygon', null, null],
  );
  const outline = JSON.parse(
    readContext('context/tracts-2020/25025.geojsonl')
      .split('\n')
      .find((l) => l.includes('"25025010405"')),
  ).geometry;
  assert.equal(pointSet(shapes[1]), pointSet(outline));
  const dbf = parseDbf(files.get('my_tracts_merged.dbf'), 'utf-8');
  const fields = dbf.columns || Object.keys(dbf[0]);
  assert.ok(
    fields.every((n) => n.length <= 10),
    fields.join(','),
  );
  assert.ok(fields.includes('tract_pove'));
  assert.match(
    text(files.get('my_tracts_steps.txt')),
    /your original file's own geography: the Census outline of each 2020 census tract/,
  );
  assert.match(text(files.get('my_tracts_merged.prj')), /GCS_WGS_1984/);
});

test('shapefile: your own shapes are kept as they are; points stay points', async () => {
  const square = {
    type: 'Polygon',
    coordinates: [
      [
        [-71, 42],
        [-70, 42],
        [-70, 43],
        [-71, 43],
        [-71, 42],
      ],
    ],
  };
  const s = new MergeSession({ readContext });
  await s.open(
    'mine.geojson',
    bytes(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { id: 'a', v: 1 }, geometry: square },
        ],
      }),
    ),
  );
  const shapes = parseShp(
    unzip((await s.exportConverted('shp')).bytes).get('mine.shp'),
  );
  assert.equal(pointSet(shapes[0]), pointSet(square));
  const p = new MergeSession({ readContext });
  await p.open(
    'sites.csv',
    bytes('site,lat,lon\nneu,42.3398,-71.0892\nnone,,'),
  );
  const points = parseShp(
    unzip((await p.exportConverted('shp')).bytes).get('sites.shp'),
  );
  assert.deepEqual(points[0], {
    type: 'Point',
    coordinates: [-71.0892, 42.3398],
  });
  assert.equal(points[1], null);
  // Counting turns rows into areas: no shapes of your file to keep.
  await p.count('tract');
  await assert.rejects(p.exportMerged('shp'), /After counting points per area/);
});
