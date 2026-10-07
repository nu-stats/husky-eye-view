import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apportion,
  areaValues,
  countryCells,
  countryName,
  parts2000to2010,
  parts2010to2020,
} from '../scripts/build-foreign-born-layers.mjs';
import {
  FOREIGN_BORN_YEARS,
  foreignBornGroups,
  foreignBornSummary,
} from './data/infrastructure.js';

const LABELS = [
  'Total',
  'Total!!Europe',
  'Total!!Europe!!Northern Europe',
  'Total!!Europe!!Northern Europe!!United Kingdom (inc. Crown Dependencies)',
  'Total!!Europe!!Northern Europe!!United Kingdom (inc. Crown Dependencies)!!England',
  'Total!!Europe!!Northern Europe!!Other Northern Europe',
  'Total!!Asia!!Eastern Asia!!China',
  'Total!!Asia!!Eastern Asia!!China!!Hong Kong',
  'Total!!Asia!!Asia, n.e.c.',
  'Total!!Americas!!Latin America!!Central America!!Mexico',
  'Total!!Americas!!Latin America!!Caribbean!!Cuba',
  'Total!!Africa!!Western Africa!!Cape Verde',
  'Total!!Americas!!Northern America!!Canada',
];

test('countries are the first heading under the regions; residual lines are left out', () => {
  assert.deepEqual(
    countryCells(LABELS).map((c) => [c.cell, c.name]),
    [
      [3, 'United Kingdom'],
      [6, 'China'],
      [9, 'Mexico'],
      [10, 'Cuba'],
      [11, 'Cabo Verde'],
      [12, 'Canada'],
    ],
  );
  assert.equal(countryName('Macedonia'), 'North Macedonia');
  assert.equal(
    countryName('Czechoslovakia (includes Czech Republic and Slovakia)'),
    'Czechoslovakia',
  );
});

test('area vectors are split across their parts by weight', () => {
  const parts = [
    { from: 'a', to: 'x', weight: 3 },
    { from: 'a', to: 'y', weight: 1 },
    { from: 'b', to: 'y', weight: 0 },
    { from: 'b', to: 'z', weight: 0 },
  ];
  const out = apportion(parts, { a: [100, 40], b: [10, 2] });
  assert.deepEqual(out.x, [75, 30]);
  // b has no weights: equal shares.
  assert.deepEqual(out.y, [25 + 5, 10 + 1]);
  assert.deepEqual(out.z, [5, 1]);
});

test('relationship files: 2000→2010 by 2010 population, 2010→2020 by land area', () => {
  const trf = [
    '01,001,020100,01001020100,1913,753,P,9846943,9810183,01,001,020100,01001020100,1912,752,P,9846256,9809944,9845776,9809944,99.99,100.00,100.00,100.00,1912,99.95,100.00,752,99.87,100.00',
    '01,001,020100,01001020100,1913,753,P,9846943,9810183,01,001,020802,01001020802,10435,4003,P,191488944,190810921,239,239,0.00,0.00,0.00,0.00,1,0.05,0.01,1,0.13,0.02',
  ].join('\n');
  assert.deepEqual(
    parts2000to2010(trf).map((p) => [p.from, p.to, p.weight]),
    [
      ['01001020100', '01001020100', 1912],
      ['01001020100', '01001020802', 1],
    ],
  );
  const tab20 = [
    'OID_TRACT_20|GEOID_TRACT_20|NAMELSAD_TRACT_20|AREALAND_TRACT_20|AREAWATER_TRACT_20|MTFCC_TRACT_20|FUNCSTAT_TRACT_20|OID_TRACT_10|GEOID_TRACT_10|NAMELSAD_TRACT_10|AREALAND_TRACT_10|AREAWATER_TRACT_10|MTFCC_TRACT_10|FUNCSTAT_TRACT_10|AREALAND_PART|AREAWATER_PART',
    '1|01001020100|T|1|0|G|S|2|01001020100|T|1|0|G|S|9820448|28435',
  ].join('\n');
  assert.deepEqual(
    parts2010to2020(tab20).map((p) => [p.from, p.to, p.weight]),
    [['01001020100', '01001020100', 9820448]],
  );
});

test('an area: foreign-born share and its top countries as "index:percent"', () => {
  const countries = countryCells(LABELS);
  const names = [
    'Mexico',
    'China',
    'Cuba',
    'United Kingdom',
    'Canada',
    'Cabo Verde',
  ];
  // [population, cell 0 (all foreign-born), cell 1, …]
  const vector = [1000, 300, 0, 0, 20, 5, 0, 60, 10, 0, 150, 40, 0, 30];
  const values = areaValues(vector, countries, (n) => names.indexOf(n));
  assert.equal(values.share, 30);
  // Mexico 15%, Cuba 4%, Canada 3%, United Kingdom 2%, China 6%; Cabo Verde 0.
  assert.equal(values.top, '0:15,1:6,2:4,4:3,3:2');
  assert.equal(
    areaValues([10, 5], countries, () => 0),
    null,
  );
});

test('the card lists the share, the top countries and the other years', () => {
  const countries = ['Mexico', 'China', 'Cuba'];
  assert.deepEqual(foreignBornGroups('0:15,2:4', countries), [
    { name: 'Mexico', pct: 15 },
    { name: 'Cuba', pct: 4 },
  ]);
  const year = FOREIGN_BORN_YEARS.find((y) => y.key === '24');
  const card = foreignBornSummary(
    year,
    { fb24: 31.2, fbt24: '0:12.5', fb00: 22.4, fb10: 27 },
    'tract',
  );
  const lines = card.split('\n');
  assert.match(
    lines[0],
    /^2020–24: 31\.2% of this tract's residents were born outside the United States \(ACS 2020–2024, table B05006\)\.$/,
  );
  assert.equal(lines[1], 'Largest countries of birth (% of all residents):');
  assert.match(lines[2], /^1\. .+ 12\.5%$/);
  assert.equal(lines[3], 'Other years: 2000 22.4% · 2006–10 27.0%');
  assert.equal(
    foreignBornSummary(year, { name: 'Suffolk County, MA' }, 'county'),
    'No 2020–24 estimate for this county (too few residents).',
  );
});
