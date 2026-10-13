import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import {
  EXPORT_FORMATS,
  MERGE_CATALOG,
  attachData,
  codebookRows,
  countPoints,
  describeJoin,
  exportBundle,
  exportTable,
  findJoin,
  findMergeItems,
  mergeChoices,
  mergeTables,
  readTable,
  suggestKeys,
} from './mergeData.js';

const PUBLIC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
);
const readContext = (p) => readFileSync(path.join(PUBLIC, p), 'utf8');
const csv = (name, text) => readTable(name, new TextEncoder().encode(text));

test('a CSV keeps IDs with leading zeros as text and numbers as numbers', async () => {
  const t = await csv(
    'a.csv',
    'tract_fips,zip,value,name\n01001020100,02115,1.5,A\n01001020200,02116,"2,000",B',
  );
  assert.deepEqual(
    t.columns.map((c) => c.kind),
    ['string', 'string', 'numeric', 'string'],
  );
  assert.deepEqual(t.rows[1], ['01001020200', '02116', 2000, 'B']);
});

test('the join is found from GEOIDs (Excel’s lost zeros too), parts, or coordinates', async () => {
  const lost = findJoin(
    await csv('t.csv', 'tractfips,x\n1001020100,1\n25025010405,2'),
  );
  assert.equal(lost.level, 'tract');
  assert.deepEqual(lost.ids, ['01001020100', '25025010405']);
  const parts = findJoin(
    await csv('p.csv', 'STATEFP,COUNTYFP,v\n25,25,1\n6,37,2'),
  );
  assert.deepEqual([parts.level, parts.ids], ['county', ['25025', '06037']]);
  const pts = findJoin(
    await csv('pt.csv', 'id,latitude,longitude\n1,42.34,-71.09\n2,,'),
  );
  assert.equal(pts.kind, 'points');
  assert.deepEqual(pts.points, [[-71.09, 42.34], null]);
  // A ZIP code is not a county.
  assert.equal(
    findJoin(await csv('z.csv', 'zip,v\n02115,1\n02116,2')).kind,
    'none',
  );
  assert.match(
    describeJoin(await csv('z.csv', 'zip,v\n02115,1'), { kind: 'none' }),
    /another of your files/,
  );
});

test('two of your files merge on a key: left, inner and outer, like Stata', async () => {
  const survey = await csv(
    'survey.csv',
    'respondent,school_id,score\n1,S01,4\n2,S01,5\n3,S02,3\n4,S09,2',
  );
  const schools = await csv(
    'schools.csv',
    'School ID,enrollment,score\nS01,500,88\nS02,320,71\nS03,410,90',
  );
  assert.deepEqual(suggestKeys(survey, schools)[0], {
    left: 'school_id',
    right: 'School ID',
    share: 2 / 3,
  });
  const left = mergeTables(survey, schools, {
    leftKey: 'school_id',
    rightKey: 'School ID',
  });
  assert.equal(left.report.relation, 'm:1');
  assert.deepEqual(
    left.table.columns.map((c) => c.name),
    ['respondent', 'school_id', 'score', 'enrollment', 'score_2', 'hev_merge'],
  );
  assert.deepEqual(
    left.table.rows.map((r) => r.at(-1)),
    [3, 3, 3, 1],
  );
  assert.equal(
    mergeTables(survey, schools, {
      leftKey: 'school_id',
      rightKey: 'School ID',
      keep: 'inner',
    }).table.rows.length,
    3,
  );
  const outer = mergeTables(survey, schools, {
    leftKey: 'school_id',
    rightKey: 'School ID',
    keep: 'outer',
  });
  assert.deepEqual(outer.table.rows.at(-1), [null, 'S03', null, 410, 90, 2]);
  const dup = await csv('d.csv', 'k,v\n1,a\n1,b');
  assert.throws(
    () => mergeTables(dup, dup, { leftKey: 'k', rightKey: 'k' }),
    /repeat in both files/,
  );
});

test('a tract file is offered tract, county and state data; phrases pick measures', () => {
  const join = { kind: 'geoid', level: 'tract', ids: [] };
  const groups = mergeChoices(join).map((g) => g.group);
  assert.ok(groups.includes('People & Economy (ACS)'));
  assert.ok(
    !MERGE_CATALOG.some((i) => /gva|mkdb|homicide/i.test(i.id)),
    'no restricted research data',
  );
  assert.deepEqual(findMergeItems(join, ['poverty']), ['tract:poverty']);
  assert.deepEqual(findMergeItems(join, ['life expectancy']), [
    'county:life-expectancy',
  ]);
  assert.deepEqual(findMergeItems(join, ['segregation']).sort(), [
    'county:segregation-aw',
    'county:segregation-bw',
    'county:segregation-hw',
  ]);
  // A state file takes county data as one row per county (no state poverty).
  assert.deepEqual(
    findMergeItems({ kind: 'geoid', level: 'state', ids: [] }, ['poverty']),
    ['county:poverty'],
  );
});

test('attaching tract, county and state data keeps every row and flags matches', async () => {
  const t = await csv(
    'mine.csv',
    'GEOID,value\n25025010405,1\n25025010404,2\n99999999999,3',
  );
  const join = findJoin(t);
  const { table, report } = await attachData(
    t,
    join,
    [
      'tract:poverty',
      'county:life-expectancy',
      'state:ntia-internet-use',
      'tract:usaleep',
    ],
    { readContext },
  );
  const col = (name) => table.columns.findIndex((c) => c.name === name);
  assert.equal(table.rows.length, 3);
  const tract = JSON.parse(
    readContext('context/tracts-2020/25025.geojsonl')
      .split('\n')
      .find((l) => l.includes('"25025010405"')),
  ).properties;
  assert.equal(table.rows[0][col('tract_poverty')], tract.pov);
  assert.equal(table.rows[0][col('hev_geoid')], '25025010405');
  assert.ok(Number.isFinite(table.rows[0][col('county_life_expectancy')]));
  assert.deepEqual(
    table.rows.map((r) => r[col('hev_matched')]),
    [3, 3, 1],
  );
  assert.equal(table.rows[2][col('tract_poverty')], null);
  assert.equal(report.matchedRows, 2);
  assert.equal(
    table.columns[col('tract_poverty')].source,
    MERGE_CATALOG.find((i) => i.id === 'tract:poverty').source,
  );
});

test('2020 tracts missing from USALEEP’s 2010 tracts take the value at their center', async () => {
  const ids = readContext('context/tracts-2020/25025.geojsonl')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l).properties.geoid);
  const t = await csv(
    'suffolk.csv',
    `GEOID,v\n${ids.map((g) => `${g},1`).join('\n')}`,
  );
  const { table, report } = await attachData(
    t,
    findJoin(t),
    ['tract:usaleep'],
    { readContext },
  );
  const j = table.columns.findIndex((c) => c.name === 'tract_life_expectancy');
  const valued = table.rows.filter((r) => r[j] !== null).length;
  assert.ok(valued >= 190, `${valued} of ${ids.length} tracts have a value`);
  assert.match(
    report.notes.join(' '),
    /took the value of the 2010 tract containing/,
  );
});

test('points are tagged with their tract, city, HOLC grade and enumeration district', async () => {
  const t = await csv(
    'pts.csv',
    'id,lat,lon\nneu,42.3398,-71.0892\nsea,42.0,-69.0',
  );
  const join = findJoin(t);
  const { table } = await attachData(
    t,
    join,
    ['tract:poverty', 'place:segregation24', 'point:holc', 'point:ed1930'],
    { readContext },
  );
  const row = Object.fromEntries(
    table.columns.map((c, j) => [c.name, table.rows[0][j]]),
  );
  assert.equal(row.hev_tract_geoid, '25025010405');
  assert.equal(row.hev_city_geoid, '2507000');
  assert.equal(row.holc_grade, 'D');
  assert.equal(row.holc_city, 'Boston, MA');
  assert.ok(row.ed1930);
  assert.equal(row.hev_matched, 3);
  assert.equal(table.rows[1].at(-1), 1); // in the ocean
});

test('points are counted per tract, with a rate, and the counts take data too', async () => {
  const t = await csv(
    'pts.csv',
    'id,lat,lon\na,42.3398,-71.0892\nb,42.3399,-71.0893\nc,42.0,-69.0',
  );
  const counted = await countPoints(t, findJoin(t), 'tract', { readContext });
  const row = counted.table.rows.find((r) => r[0] === '25025010405');
  assert.equal(row[3], 2);
  assert.equal(row[5], Math.round((2 / row[4]) * 1000 * 1000) / 1000);
  assert.equal(counted.report.outside, 1);
  const next = await attachData(
    counted.table,
    counted.join,
    ['tract:poverty'],
    { readContext },
  );
  assert.equal(next.report.matchedRows, counted.table.rows.length);
});

test('every export format writes its file, and the bundle adds a codebook and README', async () => {
  const t = await csv(
    'my file.csv',
    'GEOID,value\n25025010405,1\n99999999999,',
  );
  const { table } = await attachData(t, findJoin(t), ['tract:poverty'], {
    readContext,
  });
  const magic = {
    csv: (b) => b[0] === 0xef && b[1] === 0xbb,
    xlsx: (b) => b[0] === 0x50 && b[1] === 0x4b,
    dta: (b) => new TextDecoder().decode(b.slice(0, 11)) === '<stata_dta>',
    sav: (b) => new TextDecoder().decode(b.slice(0, 4)) === '$FL2',
    rdata: (b) =>
      new TextDecoder().decode(gunzipSync(b).slice(0, 5)) === 'RDX2\n',
    rds: (b) => new TextDecoder().decode(gunzipSync(b).slice(0, 2)) === 'X\n',
  };
  // Shapefiles need your file's shapes: mergeSession.test.mjs covers them.
  for (const format of Object.keys(EXPORT_FORMATS).filter((f) => f !== 'shp')) {
    const file = await exportTable(table, format);
    assert.ok(magic[format](file.bytes), format);
    assert.match(
      file.fileName,
      new RegExp(`^my_file\\.${EXPORT_FORMATS[format].ext}$`),
    );
  }
  const bundle = await exportBundle(table, 'dta', {
    log: ['Read my file.csv'],
  });
  const names = [];
  const view = new DataView(bundle.bytes.buffer, bundle.bytes.byteOffset);
  let readme = '';
  for (let at = 0; view.getUint32(at, true) === 0x04034b50;) {
    const method = view.getUint16(at + 8, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(
      bundle.bytes.slice(at + 30, at + 30 + nameLength),
    );
    const data = bundle.bytes.slice(
      at + 30 + nameLength + extra,
      at + 30 + nameLength + extra + size,
    );
    if (name === 'README.txt')
      readme = new TextDecoder().decode(
        method === 8 ? inflateRawSync(data) : data,
      );
    names.push(name);
    at += 30 + nameLength + extra + size;
  }
  assert.deepEqual(names, ['my_file.dta', 'codebook.csv', 'README.txt']);
  assert.match(readme, /1\. Read my file\.csv/);
  assert.match(readme, /CC BY-NC-SA/);
  const codebook = codebookRows(table, 'dta');
  assert.deepEqual(codebook.find((r) => r[1] === 'hev_matched').slice(3, 5), [
    'number',
    '1 = Not matched; 3 = Matched',
  ]);
});
