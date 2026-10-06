import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from './curatedFiles.js';
import {
  USER_LAYER_KEY,
  buildDataset,
  classOf,
  defaultOptions,
  describeUserLayer,
  geometryPoint,
  normalizeGeoid,
  parseCsv,
  parseDbf,
  parseGeoJson,
  parseShp,
  quantileBreaks,
  readUpload,
  readZip,
  recordScopes,
  tableWithUpload,
  toNumber,
  userLayerValues,
} from './userData.js';

const bytes = (text) => new TextEncoder().encode(text);

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

// A city inside its county inside its state, all squares.
const city = {
  id: '2507000',
  name: 'Boston',
  state: 'Massachusetts',
  stateAbbr: 'MA',
  stateFips: '25',
  county: { fips: '25025', name: 'Suffolk County' },
  population: 650_000,
  populations: { city: 650_000, county: 800_000, state: 7_000_000 },
  boundary: square(-71.2, 42.2, -71.0, 42.4),
};
const county = {
  bbox: [-71.3, 42.1, -70.9, 42.5],
  points: [
    [-71.1, 42.3, 1],
    [-71.25, 42.15, 1],
    [-70.5, 42.3, 0],
  ],
};
const stateGeometry = square(-73.5, 41.2, -69.9, 42.9);
const context = { county, stateGeometry, tractPoints: new Map() };

test('numbers and GEOIDs are read the way spreadsheets write them', () => {
  assert.equal(toNumber('1,234.5'), 1234.5);
  assert.equal(toNumber('12.5%'), 12.5);
  assert.equal(toNumber('$40,000'), 40000);
  assert.equal(toNumber('n/a'), null);
  assert.equal(toNumber(''), null);
  assert.deepEqual(normalizeGeoid('1400000US25025010405'), {
    geoid: '25025010405',
    level: 'tract',
  });
  // Excel dropped the leading zero of Alabama.
  assert.deepEqual(normalizeGeoid('1001'), { geoid: '01001', level: 'county' });
  assert.deepEqual(normalizeGeoid('6037.0'), {
    geoid: '06037',
    level: 'county',
  });
  assert.deepEqual(normalizeGeoid('2507000'), {
    geoid: '2507000',
    level: 'place',
  });
  assert.equal(normalizeGeoid('Boston'), null);
  assert.equal(normalizeGeoid('123'), null);
});

test('CSV: quotes, embedded commas and newlines, tabs, BOM', () => {
  const parsed = parseCsv(
    '﻿name,"value, %"\r\n"Smith, ""J""",12.5\n"two\nlines",3\n\n',
  );
  assert.deepEqual(parsed.columns, ['name', 'value, %']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].name, 'Smith, "J"');
  assert.equal(parsed.rows[1].name, 'two\nlines');
  const tabs = parseCsv('GEOID\tRate\n25025\t4.1\n');
  assert.deepEqual(tabs.rows, [{ GEOID: '25025', Rate: '4.1' }]);
});

test('a county CSV joins by GEOID; the city has no value, the state is the mean', () => {
  const { columns, rows } = parseCsv(
    'GEOID,Name,Rate,Pop\n25025,Suffolk,10,800000\n25017,Middlesex,4,1600000\n36061,New York,99,1600000\n',
  );
  const dataset = buildDataset({ name: 'rates.csv', rows, columns });
  assert.equal(dataset.kind, 'areas');
  assert.equal(dataset.level, 'county');
  assert.deepEqual(dataset.numeric, ['Rate', 'Pop']);
  assert.equal(dataset.weight, 'Pop');
  const options = defaultOptions(dataset);
  assert.equal(options.column, 'Rate');
  assert.equal(options.method, 'mean');
  const values = userLayerValues(dataset, options, city, context);
  assert.equal(values.city, null);
  assert.equal(values.county, 10);
  // Population-weighted: (10*0.8M + 4*1.6M) / 2.4M = 6.
  assert.equal(values.state, 6);
  const unweighted = userLayerValues(
    dataset,
    { ...options, weight: null },
    city,
    context,
  );
  assert.equal(unweighted.state, 7);
});

test('state + county code columns build the GEOID', () => {
  const { columns, rows } = parseCsv(
    'STATEFP,COUNTYFP,score\n25,25,3\n25,17,5\n',
  );
  const dataset = buildDataset({ name: 'x.csv', rows, columns });
  assert.equal(dataset.level, 'county');
  assert.equal(dataset.records[0].geoid, '25025');
  assert.deepEqual(dataset.numeric, ['score']);
});

test('points become counts per 100,000 residents of each scope', () => {
  const { columns, rows } = parseCsv(
    'lat,lon,cost\n42.3,-71.1,5\n42.25,-71.05,7\n42.15,-71.25,1\n42.6,-71.8,2\n40.7,-74.0,9\n',
  );
  const dataset = buildDataset({ name: 'incidents.csv', rows, columns });
  assert.equal(dataset.kind, 'points');
  assert.equal(dataset.level, 'point');
  const options = defaultOptions(dataset);
  assert.equal(options.method, 'count-rate');
  const values = userLayerValues(dataset, options, city, context);
  assert.deepEqual(values.counts, { city: 2, county: 3, state: 4 });
  const near = (a, b) => assert.ok(Math.abs(a - b) / b < 1e-4, `${a} vs ${b}`);
  near(values.city, (2 / 650_000) * 100_000);
  near(values.county, (3 / 800_000) * 100_000);
  near(values.state, (4 / 7_000_000) * 100_000);
  const sums = userLayerValues(
    dataset,
    { ...options, method: 'sum-rate', column: 'cost' },
    city,
    context,
  );
  near(sums.city, (12 / 650_000) * 100_000);
  const means = userLayerValues(
    dataset,
    { ...options, method: 'mean', column: 'cost' },
    city,
    context,
  );
  assert.equal(means.city, 6);
});

test('tract IDs without shapes use tract centers for the city', () => {
  const { columns, rows } = parseCsv(
    'tract_geoid,v\n25025000100,10\n25025000200,20\n25017000300,30\n',
  );
  const dataset = buildDataset({ name: 't.csv', rows, columns });
  assert.equal(dataset.level, 'tract');
  const tractPoints = new Map([
    ['25025000100', [-71.1, 42.3]],
    ['25025000200', [-71.25, 42.15]],
    ['25017000300', [-71.3, 42.45]],
  ]);
  const values = userLayerValues(
    dataset,
    { column: 'v', method: 'mean', weight: null },
    city,
    { ...context, tractPoints },
  );
  assert.equal(values.city, 10);
  assert.equal(values.county, 15);
  assert.equal(values.state, 20);
  assert.deepEqual(
    recordScopes(dataset.records[2], { city, ...context, tractPoints }),
    { city: false, county: false, state: true },
  );
});

test('CDC PLACES layout: county and tract IDs, joins on the tract', () => {
  const { columns, rows } = parseCsv(
    '"stateabbr","countyfips","tractfips","totalpopulation","totalpop18plus","access2_crudeprev","access2_crude95ci"\n' +
      '"MA","25025","25025000100","3000","2500","10.0","( 8.0, 12.0)"\n' +
      '"MA","25025","25025000200","1000","1000","4.0","( 3.0, 5.0)"\n',
  );
  const dataset = buildDataset({ name: 'places.csv', rows, columns });
  assert.equal(dataset.level, 'tract');
  assert.match(dataset.join, /tractfips/);
  assert.equal(dataset.weight, 'totalpop18plus');
  assert.ok(!dataset.numeric.includes('access2_crude95ci'));
  const options = defaultOptions(dataset);
  assert.equal(options.column, 'access2_crudeprev');
  assert.equal(options.weight, 'totalpop18plus');
  assert.equal(options.unit, '% of people');
  const values = userLayerValues(dataset, options, city, context);
  // Weighted by adults: (10*2500 + 4*1000) / 3500.
  assert.equal(values.county, 8.2857);
});

test('place IDs match the city itself', () => {
  const { columns, rows } = parseCsv(
    'place_fips,score\n2507000,8\n2511000,4\n3651000,1\n',
  );
  const dataset = buildDataset({ name: 'p.csv', rows, columns });
  assert.equal(dataset.level, 'place');
  const values = userLayerValues(
    dataset,
    { column: 'score', method: 'mean', weight: null },
    city,
    context,
  );
  assert.equal(values.city, 8);
  assert.equal(values.county, null);
  assert.equal(values.state, 6);
});

test('a file with nothing to join on says what to add', () => {
  const { columns, rows } = parseCsv('name,score\nA,1\n');
  assert.throws(
    () => buildDataset({ name: 'x.csv', rows, columns }),
    /census GEOIDs .* or latitude and longitude/,
  );
});

test('projected coordinates are refused with a fix', () => {
  const { columns, rows } = parseCsv('x,y,v\n775000,2950000,1\n');
  assert.throws(() => buildDataset({ name: 'x.csv', rows, columns }), /WGS 84/);
});

test('GeoJSON polygons without IDs use their own shapes', async () => {
  const text = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Inside', score: 4 },
        geometry: square(-71.15, 42.25, -71.05, 42.35),
      },
      {
        type: 'Feature',
        properties: { name: 'Outside', score: 8 },
        geometry: square(-72.5, 42.0, -72.3, 42.2),
      },
    ],
  });
  const dataset = await readUpload('areas.geojson', bytes(text));
  assert.equal(dataset.kind, 'areas');
  assert.equal(dataset.level, 'area');
  const [x, y] = geometryPoint(dataset.records[0].geometry);
  assert.ok(Math.abs(x + 71.1) < 1e-9 && Math.abs(y - 42.3) < 1e-9);
  const values = userLayerValues(
    dataset,
    defaultOptions(dataset),
    city,
    context,
  );
  assert.equal(values.city, 4);
  assert.equal(values.state, 6);
  // GeoJSON lines too.
  const lines = parseGeoJson(
    `${JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } })}\n`,
  );
  assert.equal(lines.length, 1);
});

/** A tiny shapefile: one polygon with a hole, one point file. */
function shapefile(shapes, type) {
  const records = shapes.map((content, i) => {
    const header = new DataView(new ArrayBuffer(8));
    header.setInt32(0, i + 1, false);
    header.setInt32(4, content.byteLength / 2, false);
    return [new Uint8Array(header.buffer), new Uint8Array(content)];
  });
  const length =
    100 + records.reduce((n, [h, c]) => n + h.length + c.length, 0);
  const head = new DataView(new ArrayBuffer(100));
  head.setInt32(0, 9994, false);
  head.setInt32(24, length / 2, false);
  head.setInt32(28, 1000, true);
  head.setInt32(32, type, true);
  const out = new Uint8Array(length);
  out.set(new Uint8Array(head.buffer), 0);
  let at = 100;
  for (const [h, c] of records) {
    out.set(h, at);
    out.set(c, at + h.length);
    at += h.length + c.length;
  }
  return out;
}

function polygonRecord(rings) {
  const points = rings.flat();
  const view = new DataView(
    new ArrayBuffer(44 + rings.length * 4 + points.length * 16),
  );
  view.setInt32(0, 5, true);
  view.setInt32(36, rings.length, true);
  view.setInt32(40, points.length, true);
  let start = 0;
  rings.forEach((ring, i) => {
    view.setInt32(44 + i * 4, start, true);
    start += ring.length;
  });
  const base = 44 + rings.length * 4;
  points.forEach(([x, y], i) => {
    view.setFloat64(base + i * 16, x, true);
    view.setFloat64(base + i * 16 + 8, y, true);
  });
  return view.buffer;
}

function dbf(fields, rows) {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(out.buffer);
  out[0] = 3;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  fields.forEach((field, i) => {
    out.set(bytes(field.name), 32 + i * 32);
    out[32 + i * 32 + 11] = field.type.charCodeAt(0);
    out[32 + i * 32 + 16] = field.length;
  });
  out[headerLength - 1] = 0x0d;
  rows.forEach((row, r) => {
    let at = headerLength + r * recordLength;
    out[at++] = 0x20;
    fields.forEach((field, i) => {
      const text = String(row[i]).padEnd(field.length).slice(0, field.length);
      out.set(bytes(text), at);
      at += field.length;
    });
  });
  out[out.length - 1] = 0x1a;
  return out;
}

test('a zipped shapefile: polygon with a hole, attributes from the .dbf', async () => {
  // Shapefile shells run clockwise, holes counterclockwise.
  const shell = [
    [-71.2, 42.2],
    [-71.2, 42.4],
    [-71.0, 42.4],
    [-71.0, 42.2],
    [-71.2, 42.2],
  ];
  const hole = [
    [-71.15, 42.25],
    [-71.05, 42.25],
    [-71.05, 42.35],
    [-71.15, 42.35],
    [-71.15, 42.25],
  ];
  const shp = shapefile([polygonRecord([shell, hole])], 5);
  const geometries = parseShp(shp);
  assert.equal(geometries[0].type, 'Polygon');
  assert.equal(geometries[0].coordinates.length, 2);
  const table = dbf(
    [
      { name: 'GEOID', type: 'C', length: 5 },
      { name: 'RATE', type: 'N', length: 6 },
    ],
    [['25025', 12.5]],
  );
  assert.deepEqual(parseDbf(table), [{ GEOID: '25025', RATE: 12.5 }]);
  const zip = buildZip([
    { name: 'tracts/area.shp', data: shp },
    { name: 'tracts/area.dbf', data: table },
    { name: 'tracts/area.prj', data: bytes('GEOGCS["GCS_WGS_1984"]') },
  ]);
  assert.equal(readZip(zip).length, 3);
  const dataset = await readUpload('area.zip', zip);
  assert.equal(dataset.level, 'county');
  assert.equal(dataset.records[0].geoid, '25025');
  assert.equal(dataset.records[0].geometry.type, 'Polygon');
  assert.deepEqual(dataset.numeric, ['RATE']);
});

test('a ZIP holding a CSV reads the CSV', async () => {
  const zip = buildZip([
    { name: 'data.csv', data: bytes('GEOID,v\n25025,1\n') },
  ]);
  const dataset = await readUpload('data.zip', zip);
  assert.equal(dataset.level, 'county');
});

test('the upload joins the flight table as its own layer', () => {
  const { columns, rows } = parseCsv('GEOID,Rate\n25025,10\n');
  const dataset = buildDataset({ name: 'my_rates.csv', rows, columns });
  const options = defaultOptions(dataset);
  assert.equal(options.label, 'My data: my rates');
  const table = { layers: { poverty: { label: 'Poverty' } }, cities: [] };
  const merged = tableWithUpload(table, dataset, options);
  assert.equal(table.layers[USER_LAYER_KEY], undefined);
  const layer = merged.layers[USER_LAYER_KEY];
  assert.equal(layer.user, true);
  assert.equal(layer.unit, 'Rate');
  assert.match(layer.note, /Uploaded by the user: my_rates\.csv/);
  assert.match(describeUserLayer(dataset, options), /average of Rate/);
});

test('quantile classes for the map colors', () => {
  const breaks = quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(breaks, [3, 5, 7, 9]);
  assert.equal(classOf(1, breaks), 0);
  assert.equal(classOf(5, breaks), 2);
  assert.equal(classOf(10, breaks), 4);
});
