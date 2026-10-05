import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CITIES,
  MAX_LAYERS,
  compareSentence,
  comparisonRows,
  findCity,
  findLayer,
  formatValue,
  normalizeName,
  planFlight,
  pointInCounty,
  pointInGeometry,
  researchRates,
  rowsToCsv,
} from './curatedModel.js';

const square = (w, s, e, n) => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});

const LAYERS = {
  'life-expectancy': {
    label: 'Life expectancy',
    unit: 'years',
    decimals: 1,
    vintage: '2010–2015',
    note: 'Life expectancy at birth.',
  },
  pm25: {
    label: 'PM2.5',
    unit: 'µg/m³',
    decimals: 1,
    vintage: '2021',
    note: 'Fine particles.',
  },
  'park-access': {
    label: 'Park access',
    unit: '% of residents',
    decimals: 1,
    vintage: '2020',
    note: 'Half a mile of a park.',
  },
  'holc-hazardous': {
    label: 'HOLC “Hazardous” (D) area',
    unit: '% of graded area',
    decimals: 1,
    vintage: '1935–1940',
    note: 'D share.',
  },
  ozone: {
    label: 'Ozone',
    unit: 'ppb',
    decimals: 1,
    vintage: '2022',
    note: '',
  },
  'public-housing': {
    label: 'Public housing units',
    unit: 'per 1,000 residents',
    decimals: 1,
    vintage: '',
    note: '',
  },
  'trauma-centers': {
    label: 'Level I–II trauma centers',
    unit: 'per 100,000 residents',
    decimals: 2,
    vintage: '',
    note: '',
  },
  'gva-2015': {
    label: 'Gun deaths (GVA 2015)',
    unit: 'per 100,000 residents',
    decimals: 1,
    vintage: '2015',
    research: true,
    note: '',
  },
};

const city = (
  id,
  name,
  censusName,
  state,
  stateAbbr,
  population,
  extra = {},
) => ({
  id,
  name,
  censusName,
  state,
  stateAbbr,
  population,
  county: { fips: `${id.slice(0, 2)}001`, name: `${name} County` },
  populations: {
    city: population,
    county: population * 2,
    state: population * 10,
  },
  boundary: square(-1, -1, 1, 1),
  values: {},
  ...extra,
});

const TABLE = {
  layers: LAYERS,
  cities: [
    city('2622000', 'Detroit', 'Detroit city', 'Michigan', 'MI', 645705, {
      county: { fips: '26163', name: 'Wayne County' },
      values: {
        'life-expectancy': { city: 72.22, county: 75.15, state: 78.07 },
      },
    }),
    city('3137000', 'Omaha', 'Omaha city', 'Nebraska', 'NE', 489265),
    city(
      '2970000',
      'Springfield',
      'Springfield city',
      'Missouri',
      'MO',
      170000,
    ),
    city(
      '2567000',
      'Springfield',
      'Springfield city',
      'Massachusetts',
      'MA',
      155000,
    ),
    city('2965000', 'St. Louis', 'St. Louis city', 'Missouri', 'MO', 280000),
    city(
      '1150000',
      'Washington',
      'Washington city',
      'District of Columbia',
      'DC',
      700000,
    ),
    city(
      '2938000',
      'Kansas City',
      'Kansas City city',
      'Missouri',
      'MO',
      510000,
    ),
    city('2036000', 'Kansas City', 'Kansas City city', 'Kansas', 'KS', 155000),
    city(
      '4752006',
      'Nashville',
      'Nashville-Davidson metropolitan government (balance)',
      'Tennessee',
      'TN',
      705000,
    ),
  ],
};

test('names normalize: accents, punctuation, St./Ft.', () => {
  assert.equal(normalizeName('St. Louis'), 'saint louis');
  assert.equal(normalizeName('Ft. Worth'), 'fort worth');
  assert.equal(normalizeName('  São   Paulo!'), 'sao paulo');
});

test('cities match by name, with the state choosing among namesakes', () => {
  assert.equal(findCity(TABLE.cities, 'Detroit').city.id, '2622000');
  assert.equal(findCity(TABLE.cities, 'detroit, mi').city.id, '2622000');
  assert.equal(findCity(TABLE.cities, 'Detroit Michigan').city.id, '2622000');
  assert.equal(findCity(TABLE.cities, 'Saint Louis').city.id, '2965000');
  assert.equal(findCity(TABLE.cities, 'Washington DC').city.id, '1150000');
  assert.equal(findCity(TABLE.cities, 'Nashville-Davidson').city.id, '4752006');
  // Largest namesake wins without a state, the others are offered.
  const springfield = findCity(TABLE.cities, 'Springfield');
  assert.equal(springfield.city.stateAbbr, 'MO');
  assert.deepEqual(
    springfield.alternatives.map((c) => c.stateAbbr),
    ['MA'],
  );
  assert.equal(findCity(TABLE.cities, 'Springfield, MA').city.stateAbbr, 'MA');
  assert.equal(
    findCity(TABLE.cities, 'Kansas City Kansas').city.stateAbbr,
    'KS',
  );
  assert.equal(findCity(TABLE.cities, 'Atlantis').city, null);
});

test('layers match by key, label or the words people use', () => {
  assert.equal(findLayer(LAYERS, 'life expectancy'), 'life-expectancy');
  assert.equal(findLayer(LAYERS, 'air quality'), 'pm25');
  assert.equal(findLayer(LAYERS, 'redlining'), 'holc-hazardous');
  assert.equal(findLayer(LAYERS, 'green space'), 'park-access');
  assert.equal(findLayer(LAYERS, 'gun deaths'), 'gva-2015');
  assert.equal(findLayer(LAYERS, 'PM2.5'), 'pm25');
  assert.equal(findLayer(LAYERS, 'mass killings'), null, 'not in this table');
  assert.equal(findLayer(LAYERS, 'astrology'), null);
});

test('a plan keeps at most 3 cities and 6 layers and explains what it dropped', () => {
  const plan = planFlight(
    {
      cities: ['Detroit', 'Omaha', 'Detroit', 'St. Louis', 'Nashville'],
      layers: [
        'life expectancy',
        'pm25',
        'parks',
        'redlining',
        'ozone',
        'public housing',
        'trauma',
        'nonsense',
      ],
      record: 1,
    },
    TABLE,
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.cities.length, MAX_CITIES);
  assert.deepEqual(
    plan.cities.map((c) => c.name),
    ['Detroit', 'Omaha', 'St. Louis'],
  );
  assert.equal(plan.layers.length, MAX_LAYERS);
  assert.equal(plan.record, true);
  assert.ok(plan.problems.some((p) => /at most 3 cities/.test(p)));
  assert.ok(plan.problems.some((p) => /at most 6 layers/.test(p)));
  assert.ok(plan.problems.some((p) => /nonsense/.test(p)));
  const empty = planFlight({ cities: ['Atlantis'], layers: [] }, TABLE);
  assert.equal(empty.ok, false);
  assert.ok(empty.problems.some((p) => /Choose at least one layer/.test(p)));
});

test('values format with units, and missing values as a dash', () => {
  assert.equal(formatValue(LAYERS['life-expectancy'], 72.224), '72.2 years');
  assert.equal(formatValue(LAYERS['park-access'], 94.03), '94.0%');
  assert.equal(
    formatValue(LAYERS['trauma-centers'], 1.2),
    '1.20 per 100,000 residents',
  );
  assert.equal(formatValue(LAYERS.pm25, null), '—');
});

test('the highlight sentence compares the city with its county and state', () => {
  const detroit = TABLE.cities[0];
  assert.equal(
    compareSentence(
      LAYERS['life-expectancy'],
      detroit,
      detroit.values['life-expectancy'],
    ),
    'Detroit: 72.2 years, 3.0 years below Wayne County and 5.9 years below Michigan.',
  );
  assert.equal(
    compareSentence(LAYERS['park-access'], detroit, {
      city: 90,
      county: 80,
      state: null,
    }),
    'Detroit: 90.0%, 10.0 points above Wayne County.',
  );
  assert.match(compareSentence(LAYERS.pm25, detroit, {}), /no pm2\.5 data/);
});

test('dollar measures read as money, differences included', () => {
  const income = {
    label: 'Median household income',
    unit: 'dollars',
    decimals: 0,
    vintage: '2020–2024',
  };
  const detroit = {
    name: 'Detroit',
    county: { name: 'Wayne County' },
    state: 'Michigan',
  };
  assert.equal(formatValue(income, 39938), '$39,938');
  assert.equal(
    compareSentence(income, detroit, {
      city: 39938,
      county: 60539,
      state: 72875,
    }),
    'Detroit: $39,938, $20,601 below Wayne County and $32,937 below Michigan.',
  );
});

test('the data rows and CSV carry every city × layer with units and years', () => {
  const plan = planFlight(
    { cities: ['Detroit', 'Omaha'], layers: ['life expectancy', 'pm25'] },
    TABLE,
  );
  const rows = comparisonRows(plan, TABLE);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    [rows[0].city, rows[0].layer, rows[0].cityValue, rows[0].countyValue],
    ['Detroit', 'Life expectancy', 72.22, 75.15],
  );
  const csv = rowsToCsv(rows);
  assert.ok(csv.startsWith('﻿City,State,County'));
  assert.equal(csv.trim().split('\r\n').length, 5);
  assert.ok(csv.includes('µg/m³'));
});

test('points fall in a city boundary or its county by nearest tract', () => {
  const ring = square(0, 0, 10, 10);
  assert.equal(pointInGeometry([5, 5], ring), true);
  assert.equal(pointInGeometry([15, 5], ring), false);
  const holed = {
    type: 'Polygon',
    coordinates: [
      ring.coordinates[0],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  };
  assert.equal(pointInGeometry([5, 5], holed), false, 'inside a hole');
  const county = {
    bbox: [0, 0, 10, 10],
    points: [
      [2, 2, 1],
      [8, 8, 0],
    ],
  };
  assert.equal(pointInCounty([3, 3], county), true);
  assert.equal(
    pointInCounty([7, 9], county),
    false,
    'nearest tract is outside',
  );
  assert.equal(pointInCounty([20, 20], county), false, 'outside the box');
});

test('research rates count deaths per 100,000 (GVA) and incidents per million (MKDB)', () => {
  const detroit = TABLE.cities[0];
  const county = { bbox: [-2, -2, 2, 2], points: [[0, 0, 1]] };
  const gva = [
    {
      geometry: { coordinates: [0, 0] },
      properties: { killed: 2, state: 'Michigan' },
    },
    {
      geometry: { coordinates: [1.5, 1.5] },
      properties: { killed: 1, state: 'Michigan' },
    },
    {
      geometry: { coordinates: [50, 50] },
      properties: { killed: 4, state: 'Ohio' },
    },
  ];
  const rates = researchRates('gva-2015', gva, detroit, county);
  assert.deepEqual(rates.counts, { city: 2, county: 3, state: 3 });
  assert.equal(rates.city.toFixed(3), ((2 / 645705) * 1e5).toFixed(3));
  const mkdb = [
    {
      geometry: { coordinates: [0.5, 0.5] },
      properties: { name: 'Detroit, MI', killed: 5 },
    },
    {
      geometry: { coordinates: [40, 40] },
      properties: { name: 'Flint, MI', killed: 4 },
    },
  ];
  const mk = researchRates('mkdb', mkdb, detroit, null);
  assert.deepEqual(mk.counts, { city: 1, county: 0, state: 2 });
  assert.equal(mk.county, null, 'no county lookup, no county rate');
});
