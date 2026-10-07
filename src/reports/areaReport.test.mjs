import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import {
  decodeCountries,
  findReportMeasure,
  findState,
  formatValue,
  planReport,
  reportCsv,
  reportFiles,
  reportNotes,
  reportPdf,
  reportRows,
  reportTable,
  reportTitle,
} from './areaReport.js';
import { REPORT_MEASURES, measuresFor } from './reportMeasures.js';

const COUNTIES = [
  {
    geoid: '06037',
    name: 'Los Angeles County, CA',
    pop24: 9900000,
    fbn24: 3300000,
    fb24: 33.3,
    pov: 13.7,
    unemp: 6.4,
    life_exp: 81.2,
    cluster: 'HH',
    fbt24: '0:12.1,2:2.3',
  },
  {
    geoid: '12086',
    name: 'Miami-Dade County, FL',
    pop24: 2700000,
    fbn24: 1470000,
    fb24: 54.5,
    pov: 14.5,
    unemp: 4.6,
    life_exp: 81.9,
  },
  {
    geoid: '25025',
    name: 'Suffolk County, MA',
    pop24: 790000,
    fbn24: 235000,
    fb24: 29.8,
    pov: 16.8,
    unemp: 5.8,
    life_exp: 80.5,
    cluster: 'LH',
  },
  {
    geoid: '25017',
    name: 'Middlesex County, MA',
    pop24: 1630000,
    fbn24: 400000,
    fb24: 24.6,
    pov: 7.9,
    unemp: 4.1,
    life_exp: 82.6,
    cluster: 'HH',
  },
  {
    geoid: '48201',
    name: 'Harris County, TX',
    pop24: 4800000,
    fbn24: 1300000,
    fb24: 27.1,
    pov: 16.1,
    unemp: 6.1,
    life_exp: 78.3,
  },
  { geoid: '30001', name: 'Beaverhead County, MT', pop24: 9500, fb24: 2.1 },
];

test('the default plan is the test case: the 50 largest immigrant populations by county', () => {
  const plan = planReport({});
  assert.equal(plan.ok, true);
  assert.equal(plan.geography, 'county');
  assert.equal(plan.rankBy.id, 'foreign-born-count');
  assert.equal(plan.order, 'desc');
  assert.equal(plan.limit, 50);
  assert.deepEqual(
    plan.columns.map((m) => m.id),
    [
      'population',
      'foreign-born-count',
      'foreign-born-share',
      'poverty',
      'unemployment',
      'life-expectancy',
      'cluster-status',
    ],
  );
  assert.deepEqual(plan.formats, ['pdf', 'csv', 'xlsx']);
  assert.equal(
    reportTitle(plan),
    'The 50 counties with the largest foreign-born population',
  );
});

test('spoken names resolve; unknown ones are reported, not dropped', () => {
  assert.equal(
    findReportMeasure('immigrant population').id,
    'foreign-born-count',
  );
  assert.equal(findReportMeasure('poverty rate').id, 'poverty');
  assert.equal(findReportMeasure('clustering status').id, 'cluster-status');
  assert.equal(findReportMeasure('life expectancy').id, 'life-expectancy');
  assert.equal(findReportMeasure('life expectancy', 'tract'), null);
  assert.equal(findState('Massachusetts'), '25');
  assert.equal(findState('ma'), '25');
  const plan = planReport({
    geography: 'counties',
    rankBy: 'poverty',
    order: 'lowest',
    limit: '10',
    columns: ['unemployment', 'moon phase'],
    state: 'MA',
    formats: ['excel'],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.order, 'asc');
  assert.equal(plan.state, '25');
  assert.deepEqual(
    plan.columns.map((m) => m.id),
    ['poverty', 'unemployment'],
  );
  assert.deepEqual(plan.formats, ['xlsx']);
  assert.match(plan.problems[0], /moon phase/);
  assert.equal(
    reportTitle(plan),
    'The 10 counties in Massachusetts with the lowest poverty rate',
  );
  assert.equal(planReport({ rankBy: 'cluster status' }).ok, false);
  assert.equal(planReport({ geography: 'tracts' }).ok, false);
  assert.equal(
    planReport({ geography: 'tracts', state: 'Massachusetts' }).ok,
    true,
  );
  assert.equal(planReport({ limit: 9000 }).limit, 500);
  // Default columns a tract lacks (life expectancy, clusters) drop quietly.
  const tracts = planReport({
    geography: 'tracts',
    state: 'MA',
    rankBy: 'percent foreign born',
  });
  assert.deepEqual(tracts.problems, []);
  assert.ok(!tracts.columns.some((m) => m.id === 'life-expectancy'));
  assert.equal(
    reportTitle(tracts),
    'The 50 census tracts in Massachusetts with the highest share of foreign-born residents',
  );
});

test('rows are ranked, filtered by state, and skip areas without a value', () => {
  const plan = planReport({ limit: 3 });
  const { rows, eligible } = reportRows(plan, COUNTIES);
  assert.equal(eligible, 5);
  assert.deepEqual(
    rows.map((r) => r.geoid),
    ['06037', '12086', '48201'],
  );
  assert.deepEqual(
    [
      rows[0].rank,
      rows[0].stateFips,
      rows[0].countyFips,
      rows[0].stateName,
      rows[0].area,
    ],
    [1, '06', '037', 'California', 'Los Angeles County'],
  );
  const ma = reportRows(
    planReport({ state: 'MA', rankBy: 'poverty' }),
    COUNTIES,
  );
  assert.deepEqual(
    ma.rows.map((r) => r.area),
    ['Suffolk County', 'Middlesex County'],
  );
});

test('cells read as people expect; data files keep numbers', () => {
  const by = (id) => REPORT_MEASURES.find((m) => m.id === id);
  assert.equal(formatValue(by('foreign-born-count'), 3300000.4), '3,300,000');
  assert.equal(formatValue(by('poverty'), 13.66), '13.7%');
  assert.equal(formatValue(by('median-income'), 54321), '$54,321');
  assert.equal(
    formatValue(by('cluster-status'), 'HH'),
    'High–High (long-life cluster)',
  );
  assert.equal(formatValue(by('cluster-status'), undefined), 'Not significant');
  assert.equal(formatValue(by('poverty'), null), '—');
  assert.equal(
    decodeCountries('0:12.1,2:2.3', ['Mexico', 'India', 'China']),
    'Mexico 12.1%; China 2.3%',
  );
  const plan = planReport({ limit: 2 });
  const { rows } = reportRows(plan, COUNTIES);
  const { header, body } = reportTable(plan, rows);
  assert.deepEqual(header.slice(0, 5), [
    'Rank',
    'State FIPS',
    'County FIPS',
    'State',
    'County',
  ]);
  assert.equal(header[5], 'Total population, 2020–24');
  assert.deepEqual(body[0].slice(0, 7), [
    1,
    '06',
    '037',
    'California',
    'Los Angeles County',
    9900000,
    3300000,
  ]);
  assert.equal(body[1].at(-1), 'Not significant');
  const csv = reportCsv(plan, rows);
  // UTF-8 byte-order mark first, so Excel reads the dashes.
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(
    csv.slice(1).startsWith('Rank,State FIPS,County FIPS,State,County,'),
  );
  assert.match(
    csv,
    /\r\n1,06,037,California,Los Angeles County,9900000,3300000,33.3,13.7,6.4,81.2,High–High \(long-life cluster\)\r\n/,
  );
});

test('notes name every column source; the files come in one ZIP', () => {
  const plan = planReport({ limit: 5 });
  const { rows, eligible } = reportRows(plan, COUNTIES);
  const notes = reportNotes(plan, {
    eligible,
    date: new Date('2026-10-06T12:00:00Z'),
  });
  assert.equal(
    notes[0][1],
    'The 5 counties with the largest foreign-born population',
  );
  assert.ok(notes.some(([label]) => label === 'Reading clusters'));
  for (const m of plan.columns)
    assert.ok(notes.some(([label]) => label === m.short));
  const pdf = reportPdf(plan, rows, { eligible });
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), '%PDF-');
  assert.match(
    new TextDecoder('latin1').decode(pdf),
    /MediaBox \[0 0 792 612\]/,
  );
  const zip = reportFiles(plan, rows, {
    eligible,
    date: new Date('2026-10-06T12:00:00Z'),
  });
  assert.equal(
    zip.name,
    'husky-eye-view_report_counties_foreign-born-count_top-5_2026-10-06.zip',
  );
  const text = new TextDecoder('latin1').decode(zip.data);
  for (const ext of ['pdf', 'csv', 'xlsx'])
    assert.ok(text.includes(`top-5_2026-10-06.${ext}`));
  assert.ok(inflateRawSync);
  const single = reportFiles({ ...plan, formats: ['csv'] }, rows, {
    date: new Date('2026-10-06T12:00:00Z'),
  });
  assert.match(single.name, /\.csv$/);
});

test('every measure is complete and available somewhere', () => {
  for (const m of REPORT_MEASURES) {
    for (const field of [
      'label',
      'short',
      'key',
      'format',
      'years',
      'source',
      'layerId',
    ])
      assert.ok(m[field], `${m.id} lacks ${field}`);
    assert.ok(m.geographies.length > 0);
  }
  assert.ok(measuresFor('state').length >= 4);
  assert.equal(
    new Set(REPORT_MEASURES.map((m) => m.id)).size,
    REPORT_MEASURES.length,
  );
});

test('the voice tool offers exactly the report measures', async () => {
  const { GEV_ACTION_SCHEMAS } = await import('../voice/actionSchemas.js');
  const tool = GEV_ACTION_SCHEMAS.find(
    (s) => s.name === 'generate_area_report',
  );
  assert.deepEqual(
    [...tool.parameters.properties.rank_by.enum].sort(),
    REPORT_MEASURES.map((m) => m.id).sort(),
  );
});
