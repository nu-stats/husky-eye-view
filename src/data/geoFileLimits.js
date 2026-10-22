/**
 * The import's limits and error type, apart from its readers: the My files
 * controls need them at boot, while src/data/geoFileImport.js (the parsers)
 * loads with the first file. That module re-exports everything here.
 */

/** Largest file accepted, in bytes. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
/** Most files on the globe at once. */
export const MAX_IMPORTED_FILES = 12;
/** What the file picker offers. */
export const GEO_FILE_ACCEPT = '.geojson,.json,.kml,.kmz,.gpx';

/**
 * An error whose message is meant for the person who chose the file. The
 * message stays English; `template` and `values`, when given, let the UI show
 * it in the active language.
 */
export class GeoImportError extends Error {
  constructor(message, template = message, values = {}) {
    super(message);
    this.name = 'GeoImportError';
    this.template = template;
    this.values = values;
  }
}
