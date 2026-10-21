import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { GeoImportError, MAX_IMPORT_BYTES } from '../data/geoFileImport.js';
import {
  MY_FILES_ACCEPT,
  analyzeMyFile,
  dataSourceToGeoJson,
  fileForMerge,
  datasetToGeoJson,
  loadMyFile,
  tableFileKind,
} from './myFileTables.js';

const file = (name, text) => new File([text], name);

/** A `loadGeoFile` double that keeps the GeoJSON it was handed. */
function loader() {
  const calls = [];
  const load = async (input, options) => {
    calls.push({
      name: input.name,
      options,
      geojson: input.name.endsWith('.geojson')
        ? JSON.parse(await input.text())
        : null,
    });
    return {
      dataSource: {},
      name: input.name,
      format: 'geojson',
      entityCount: 1,
    };
  };
  return { load, calls };
}

test("My files takes God's Eye View's formats plus shapefiles and tables", () => {
  for (const ext of [
    '.geojson',
    '.json',
    '.kml',
    '.kmz',
    '.gpx',
    '.zip',
    '.csv',
    '.xlsx',
  ])
    assert.ok(MY_FILES_ACCEPT.split(',').includes(ext), ext);
  assert.equal(tableFileKind('tracts.ZIP'), 'shapefile');
  assert.equal(tableFileKind('sites.csv'), 'csv');
  assert.equal(tableFileKind('sites.tsv'), 'csv');
  assert.equal(tableFileKind('sites.xlsx'), 'excel');
  for (const name of [
    'a.geojson',
    'a.kml',
    'a.kmz',
    'a.gpx',
    'a.json',
    'noext',
  ])
    assert.equal(tableFileKind(name), null, name);
});

test('shapes stay shapes, coordinates become points, rows without either are left out', () => {
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  };
  assert.deepEqual(
    datasetToGeoJson({
      records: [
        { geometry: polygon, props: { name: 'A' } },
        { point: [-71.06, 42.36], props: { name: 'B' } },
        { geoid: '25025', props: { name: 'C' } },
      ],
    }),
    {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: polygon, properties: { name: 'A' } },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-71.06, 42.36] },
          properties: { name: 'B' },
        },
      ],
    },
  );
  assert.deepEqual(datasetToGeoJson(null).features, []);
});

test('a CSV with latitude and longitude draws one point per row, named for the CSV', async () => {
  const { load, calls } = loader();
  const loaded = await loadMyFile(
    file(
      'clinics.csv',
      'name,latitude,longitude\nNorth,42.36,-71.06\nSouth,42.30,-71.08\n',
    ),
    { color: '#39d0ff' },
    { load },
  );
  assert.equal(loaded.name, 'clinics.csv');
  assert.equal(loaded.format, 'csv');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'clinics.csv.geojson');
  assert.deepEqual(calls[0].options, { color: '#39d0ff' });
  assert.deepEqual(
    calls[0].geojson.features.map((f) => f.geometry.coordinates),
    [
      [-71.06, 42.36],
      [-71.08, 42.3],
    ],
  );
  assert.equal(calls[0].geojson.features[0].properties.name, 'North');
});

test('a zipped shapefile draws its shapes', async () => {
  const { load, calls } = loader();
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [-71.2, 42.2],
        [-71.2, 42.4],
        [-71.0, 42.4],
        [-71.2, 42.2],
      ],
    ],
  };
  const read = async (name, bytes) => {
    assert.equal(name, 'tracts.zip');
    assert.ok(bytes instanceof Uint8Array);
    return { records: [{ geometry: polygon, props: { GEOID: '25025' } }] };
  };
  const loaded = await loadMyFile(file('tracts.zip', 'PK'), {}, { load, read });
  assert.equal(loaded.format, 'shapefile');
  assert.equal(calls[0].geojson.features[0].geometry.type, 'Polygon');
});

test('a table with only GEOIDs points to Merge & Export instead of drawing nothing', async () => {
  const { load, calls } = loader();
  await assert.rejects(
    loadMyFile(file('rates.csv', 'GEOID,rate\n25025,10\n'), {}, { load }),
    (error) =>
      error instanceof GeoImportError &&
      /latitude and longitude/.test(error.message) &&
      /Merge & Export/.test(error.message),
  );
  assert.equal(calls.length, 0);
  await assert.rejects(
    loadMyFile(
      file('empty.zip', 'PK'),
      {},
      { load, read: async () => ({ records: [] }) },
    ),
    /no shapes to draw/,
  );
});

test('reader errors and the size limit reach the person as import errors', async () => {
  const { load } = loader();
  await assert.rejects(
    loadMyFile(
      file('bad.zip', 'PK'),
      {},
      {
        load,
        read: async () => {
          throw new Error(
            'Upload the shapefile as a ZIP with its .shp, .dbf and .prj files together.',
          );
        },
      },
    ),
    (error) =>
      error instanceof GeoImportError &&
      /\.shp, \.dbf and \.prj/.test(error.message),
  );
  const huge = {
    name: 'big.csv',
    size: MAX_IMPORT_BYTES + 1,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
  await assert.rejects(
    loadMyFile(huge, {}, { load }),
    (error) => error instanceof GeoImportError && error.values.size === 50,
  );
});

test("God's Eye View's own formats go straight to its loader", async () => {
  const { load, calls } = loader();
  const kml = file('route.kml', '<kml/>');
  await loadMyFile(
    kml,
    { color: '#fff' },
    { load, read: () => assert.fail('no reader') },
  );
  assert.equal(calls[0].name, 'route.kml');
  assert.equal(calls[0].geojson, null);
});

test('Analyze hands Merge & Export the file as chosen when it reads that format', () => {
  const chosen = new File(['name,lat,lon\n'], 'sites.csv');
  for (const format of ['csv', 'excel', 'geojson', 'shapefile'])
    assert.equal(
      fileForMerge({ name: 'sites.csv', format, file: chosen }),
      chosen,
    );
});

test('KML, KMZ and GPX reach Merge & Export as GeoJSON of what they drew', async () => {
  const dataSource = new Cesium.CustomDataSource('route');
  dataSource.entities.add({
    name: 'Northeastern',
    position: Cesium.Cartesian3.fromDegrees(-71.0892, 42.3398),
    point: { pixelSize: 6 },
    properties: { kind: 'campus', bad: { nested: true } },
  });
  dataSource.entities.add({
    name: 'Comm Ave',
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray([
        -71.073, 42.353, -71.089, 42.3488,
      ]),
    },
  });
  dataSource.entities.add({
    name: 'Common',
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray([
        -71.07, 42.355, -71.063, 42.357, -71.062, 42.354,
      ]),
    },
  });
  const merged = fileForMerge({
    name: 'boston.kmz',
    format: 'kmz',
    dataSource,
  });
  assert.equal(merged.name, 'boston.geojson');
  const geojson = JSON.parse(await merged.text());
  assert.deepEqual(
    geojson.features.map((f) => [f.geometry.type, f.properties.name]),
    [
      ['Point', 'Northeastern'],
      ['LineString', 'Comm Ave'],
      ['Polygon', 'Common'],
    ],
  );
  assert.deepEqual(
    geojson.features[0].geometry.coordinates,
    [-71.0892, 42.3398],
  );
  assert.equal(geojson.features[0].properties.kind, 'campus');
  assert.equal(
    'bad' in geojson.features[0].properties,
    false,
    'only plain values',
  );
  const ring = geojson.features[2].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1), 'the ring is closed');
  assert.equal(ring.length, 4);
  assert.deepEqual(dataSourceToGeoJson(null).features, []);
});

test('Analyze opens Merge & Export with the file', () => {
  const target = new EventTarget();
  const seen = [];
  target.addEventListener('gev:merge-export-open', (event) =>
    seen.push(event.detail.file),
  );
  const chosen = new File(['x'], 'sites.csv');
  analyzeMyFile({ name: 'sites.csv', format: 'csv', file: chosen }, target);
  assert.deepEqual(seen, [chosen]);
});

test('drawn pins count too: they live in importedEntities once mounted', () => {
  const pin = {
    name: 'Pin',
    position: { getValue: () => Cesium.Cartesian3.fromDegrees(-71.06, 42.36) },
  };
  const geojson = dataSourceToGeoJson({
    importedEntities: [pin],
    entities: { values: [] },
  });
  assert.deepEqual(geojson.features[0].geometry.coordinates, [-71.06, 42.36]);
});
