/**
 * My files beyond God's Eye View's four formats (GeoJSON, KML, KMZ, GPX): a
 * zipped shapefile, and a CSV or Excel table with latitude and longitude
 * columns. Husky Eye View's own readers (src/curated/userData.js, the ones
 * Curated Flights and Merge & Export use) read them, and they are drawn
 * through the same GeoJSON path as an imported .geojson file, in the browser
 * only.
 */
import { readUpload } from '../curated/userData.js';
import {
  GEO_FILE_ACCEPT,
  GeoImportError,
  MAX_IMPORT_BYTES,
  importDisplayName,
  loadGeoFile,
} from '../data/geoFileImport.js';

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
  return { ...loaded, name: importDisplayName(file.name), format: kind };
}
