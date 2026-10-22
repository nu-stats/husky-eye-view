/**
 * My files beyond God's Eye View's four formats (GeoJSON, KML, KMZ, GPX): a
 * zipped shapefile, and a CSV or Excel table with latitude and longitude
 * columns. Husky Eye View's own readers (src/curated/userData.js, the ones
 * Curated Flights and Merge & Export use) read them, and they are drawn
 * through the same GeoJSON path as an imported .geojson file, in the browser
 * only.
 */
import * as Cesium from 'cesium';
import {
  GEO_FILE_ACCEPT,
  GeoImportError,
  MAX_IMPORT_BYTES,
} from '../data/geoFileLimits.js';

// The readers load with the first file, not at boot: God's Eye View's import
// (~50 KB) and Husky Eye View's table and shapefile readers (~90 KB with the
// Excel reader and the Curated Flights model they share).
const geoReaders = () => import('../data/geoFileImport.js');
const loadGeoFile = async (...args) =>
  (await geoReaders()).loadGeoFile(...args);
const readUpload = async (...args) =>
  (await import('../curated/userData.js')).readUpload(...args);

/** Every file My files takes. */
export const MY_FILES_ACCEPT = `${GEO_FILE_ACCEPT},.zip,.csv,.tsv,.txt,.xlsx`;

/**
 * Which of Husky Eye View's own readers a file needs, by its name.
 * @param {string} name
 * @returns {'shapefile'|'csv'|'excel'|null} null for God's Eye View's formats.
 */
export function tableFileKind(name) {
  const ext = /\.([a-z0-9]+)$/i.exec(String(name || ''))?.[1]?.toLowerCase();
  if (ext === 'zip') return 'shapefile';
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
  if (ext === 'xlsx' || ext === 'xlsm') return 'excel';
  return null;
}

/**
 * A dataset's drawable records as GeoJSON: each shape as it is, each row with
 * coordinates as a point. Rows without either are left out.
 * @param {{records?: Array<{geometry?: object, point?: number[], props?: object}>}} dataset
 * @returns {{type: 'FeatureCollection', features: object[]}}
 */
export function datasetToGeoJson(dataset) {
  const features = [];
  for (const record of dataset?.records || []) {
    const geometry =
      record.geometry ||
      (record.point ? { type: 'Point', coordinates: record.point } : null);
    if (geometry)
      features.push({
        type: 'Feature',
        geometry,
        properties: record.props || {},
      });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Load one file for My files: God's Eye View's formats as they are, tables and
 * shapefiles through Husky Eye View's readers.
 * @param {File} file
 * @param {object} options Passed on to `loadGeoFile` (viewer, color, signal).
 * @param {{load?: Function, read?: Function}} [deps] Test doubles.
 */
export async function loadMyFile(
  file,
  options = {},
  { load = loadGeoFile, read = readUpload } = {},
) {
  const kind = tableFileKind(file?.name);
  if (!kind) return load(file, options);
  if (!file || !Number.isFinite(file.size))
    throw new GeoImportError('Nothing to import.');
  const limit = MAX_IMPORT_BYTES / 1024 / 1024;
  if (file.size > MAX_IMPORT_BYTES)
    throw new GeoImportError(
      `That file is larger than ${limit} MiB.`,
      'That file is larger than {size} MiB.',
      { size: limit },
    );
  let dataset;
  try {
    dataset = await read(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    // The readers' messages are written for the person who chose the file.
    throw new GeoImportError(error?.message || 'That file could not be read.');
  }
  const geojson = datasetToGeoJson(dataset);
  if (!geojson.features.length)
    throw new GeoImportError(
      kind === 'shapefile'
        ? 'That shapefile has no shapes to draw.'
        : 'That table has no latitude and longitude columns to draw. To join it to tracts or counties by GEOID, use Analysis ▸ Merge & Export.',
    );
  const asGeoJson = new File(
    [JSON.stringify(geojson)],
    `${file.name}.geojson`,
    {
      type: 'application/geo+json',
    },
  );
  const loaded = await load(asGeoJson, options);
  const { importDisplayName } = await geoReaders();
  return { ...loaded, name: importDisplayName(file.name), format: kind };
}

// ---------- My files ▸ Analyze (Merge & Export) ----------

/** Formats Merge & Export reads as they are (its own readers). */
export const MERGE_READS = new Set(['geojson', 'csv', 'excel', 'shapefile']);

const toLonLat = (cartesian) => {
  const c = Cesium.Cartographic.fromCartesian(cartesian);
  return c
    ? [
        Number(Cesium.Math.toDegrees(c.longitude).toFixed(7)),
        Number(Cesium.Math.toDegrees(c.latitude).toFixed(7)),
      ]
    : null;
};

/**
 * What a file drew, as GeoJSON: points (pins), lines and areas with their
 * names and properties. For KML, KMZ and GPX, which Merge & Export does not
 * read: it gets what is on the map.
 * @param {object} dataSource A Cesium data source.
 * @param {object} [time]
 */
export function dataSourceToGeoJson(
  dataSource,
  time = Cesium.JulianDate.now(),
) {
  const features = [];
  // Pins live outside the entity list once drawn (src/data/geoImportPins.js
  // keeps them all in importedEntities).
  const entities =
    dataSource?.importedEntities || dataSource?.entities?.values || [];
  for (const entity of entities) {
    let geometry = null;
    const hierarchy = entity.polygon?.hierarchy?.getValue?.(time);
    const line = entity.polyline?.positions?.getValue?.(time);
    const position = entity.position?.getValue?.(time);
    if (hierarchy?.positions?.length >= 3) {
      const ring = (positions) => {
        const coordinates = positions.map(toLonLat).filter(Boolean);
        if (coordinates.length) coordinates.push(coordinates[0]);
        return coordinates;
      };
      geometry = {
        type: 'Polygon',
        coordinates: [
          ring(hierarchy.positions),
          ...(hierarchy.holes || []).map((hole) => ring(hole.positions || [])),
        ],
      };
    } else if (line?.length >= 2) {
      geometry = {
        type: 'LineString',
        coordinates: line.map(toLonLat).filter(Boolean),
      };
    } else if (position) {
      const point = toLonLat(position);
      if (point) geometry = { type: 'Point', coordinates: point };
    }
    if (!geometry) continue;
    const properties = {};
    if (entity.name) properties.name = String(entity.name);
    for (const key of entity.properties?.propertyNames || []) {
      const value = entity.properties[key]?.getValue?.(time);
      if (
        value === null ||
        ['string', 'number', 'boolean'].includes(typeof value)
      )
        properties[key] = value;
    }
    features.push({ type: 'Feature', geometry, properties });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * The file Merge & Export should read for a My files row: the file as chosen
 * when Merge & Export reads its format, otherwise what it drew, as GeoJSON.
 * @param {{name: string, format: string, file?: File, dataSource?: object}} item
 * @returns {File}
 */
export function fileForMerge(item) {
  if (MERGE_READS.has(item.format) && item.file) return item.file;
  const base = String(item.name || 'my-file').replace(/\.[a-z0-9]+$/i, '');
  return new File(
    [JSON.stringify(dataSourceToGeoJson(item.dataSource))],
    `${base}.geojson`,
    { type: 'application/geo+json' },
  );
}

/**
 * My files ▸ Analyze: open Merge & Export with this file as Your file, where it
 * can take the map's data and leave as a merged file with Stata and R scripts.
 * @param {object} item A My files row (name, format, file, dataSource).
 * @param {EventTarget} [target]
 */
export function analyzeMyFile(item, target = globalThis) {
  target.dispatchEvent(
    new CustomEvent('gev:merge-export-open', {
      detail: { file: fileForMerge(item) },
    }),
  );
}
