/**
 * Parse NOAA HMS smoke-polygon KML into plain records.
 *
 * Adapted from the Sheldondouthat/satwq-reality-os fork of God's Eye View
 * (MIT). Husky Eye View runs the parser on the server and sends the browser
 * only the US polygons (`usSmokeSnapshot`), checked again on arrival by
 * `validateSmokeSnapshot`.
 *
 * HMS colors smoke by density via Placemark style names. The live feed
 * serves StyleMap ids with a `_style` suffix and uses `Medium` (not
 * `Moderate`) for the middle density class:
 *   #Smoke_Light_style    → light
 *   #Smoke_Medium_style   → moderate
 *   #Smoke_Heavy_style    → heavy
 * Bare ids (#Smoke_Light etc.) from older/cached files still parse.
 *
 * Parsing is string/regex based (no DOMParser) so the same code runs in
 * Node tests and in the browser. Malformed placemarks (missing or
 * non-numeric coordinates, unknown density, unclosed rings) are skipped —
 * never synthesized.
 */

/** HMS style name → density. `Medium` is HMS's real middle class (the live
 * feed serves `#Smoke_Medium_style` StyleMap ids); `Moderate` is kept for
 * older/cached files. */
export const SMOKE_DENSITY_BY_STYLE = Object.freeze({
  Smoke_Light: 'light',
  Smoke_Medium: 'moderate',
  Smoke_Moderate: 'moderate',
  Smoke_Heavy: 'heavy',
});

const PLACEMARK_RE = /<Placemark\b[\s\S]*?<\/Placemark>/gi;
const STYLE_URL_RE =
  /<styleUrl>\s*#?\s*(Smoke_(?:Light|Medium|Moderate|Heavy))(?:_style)?\s*<\/styleUrl>/i;
const COORDS_RE = /<coordinates>([\s\S]*?)<\/coordinates>/i;

function isFiniteLonLat(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/**
 * Parse the <coordinates> text of one LinearRing into [[lon,lat],...].
 * Returns null when the ring is unusable: fewer than 4 positions (a KML
 * LinearRing must be closed), or any non-finite/out-of-range pair.
 */
function parseRing(coordinatesText) {
  const ring = [];
  const tokens = String(coordinatesText).trim().split(/\s+/);
  for (const token of tokens) {
    if (!token) continue;
    const parts = token.split(',');
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!isFiniteLonLat(lon, lat)) return null;
    ring.push([lon, lat]);
  }
  return ring.length >= 4 ? ring : null;
}

/**
 * @param {string} xmlString raw KML text.
 * @param {{maxPolygons?:number}} options cap on returned records (default 400).
 * @returns {Array<{density:'light'|'moderate'|'heavy', ring:Array<[number,number]>>}}
 * @throws when the input is not parseable KML at all.
 */
export function parseSmokeKml(xmlString, { maxPolygons = 400 } = {}) {
  if (typeof xmlString !== 'string' || !/<kml[\s>]/i.test(xmlString)) {
    throw new Error('parseSmokeKml: not a KML document');
  }
  const cap = Math.max(0, Math.floor(maxPolygons));
  const records = [];
  let match;
  // PLACEMARK_RE is global: a prior capped run leaves lastIndex mid-string.
  PLACEMARK_RE.lastIndex = 0;
  while ((match = PLACEMARK_RE.exec(xmlString)) && records.length < cap) {
    const body = match[0];
    const styleMatch = STYLE_URL_RE.exec(body);
    const coordsMatch = COORDS_RE.exec(body);
    if (!styleMatch || !coordsMatch) continue; // malformed placemark: skip
    const ring = parseRing(coordsMatch[1]);
    if (!ring) continue; // malformed ring: skip
    records.push({
      density: SMOKE_DENSITY_BY_STYLE[styleMatch[1]],
      ring,
    });
  }
  return records;
}

/** Densities in drawing order, lightest first. */
export const SMOKE_DENSITIES = Object.freeze(['light', 'moderate', 'heavy']);

/** Most polygons the proxy reads from one day's KML. */
export const SMOKE_PARSE_LIMIT = 4000;
/** Most US polygons one snapshot carries to the browser. */
export const SMOKE_SNAPSHOT_LIMIT = 1500;
/** Most vertices one snapshot carries to the browser. */
export const SMOKE_VERTEX_LIMIT = 200_000;

const round = (value) => Math.round(value * 1000) / 1000;

/**
 * The US part of one day's smoke analysis: the polygons that touch the US
 * area (`touchesUs`, src/data/usArea.js), coordinates rounded to 0.001°
 * (about 100 m), within the snapshot limits.
 * @param {Array<{density: string, ring: Array<[number, number]>}>} records
 * @param {{date: string, fetchedAt: number, touchesUs: (ring: Array<[number, number]>) => boolean}} options
 */
export function usSmokeSnapshot(records, { date, fetchedAt, touchesUs }) {
  const polygons = [];
  let vertices = 0;
  let dropped = 0;
  for (const record of records) {
    if (!touchesUs(record.ring)) {
      dropped += 1;
      continue;
    }
    if (
      polygons.length >= SMOKE_SNAPSHOT_LIMIT ||
      vertices + record.ring.length > SMOKE_VERTEX_LIMIT
    )
      break;
    vertices += record.ring.length;
    polygons.push({
      density: record.density,
      ring: record.ring.map(([lon, lat]) => [round(lon), round(lat)]),
    });
  }
  return {
    schemaVersion: 1,
    date,
    fetchedAt,
    total: records.length,
    dropped,
    polygons,
  };
}

const malformed = () => new Error('Malformed HMS smoke snapshot');

/**
 * Check a snapshot from /api/hms-smoke and keep only its known fields.
 * @returns {{date: string, fetchedAt: number, stale: boolean, total: number, dropped: number, polygons: Array<{density: string, ring: Array<[number, number]>}>}}
 */
export function validateSmokeSnapshot(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    typeof value.date !== 'string' ||
    !/^\d{8}$/.test(value.date) ||
    !Number.isFinite(value.fetchedAt) ||
    !Array.isArray(value.polygons) ||
    value.polygons.length > SMOKE_SNAPSHOT_LIMIT
  )
    throw malformed();
  let vertices = 0;
  const polygons = value.polygons.map((polygon) => {
    if (
      !SMOKE_DENSITIES.includes(polygon?.density) ||
      !Array.isArray(polygon.ring) ||
      polygon.ring.length < 4 ||
      (vertices += polygon.ring.length) > SMOKE_VERTEX_LIMIT
    )
      throw malformed();
    const ring = polygon.ring.map((pair) => {
      if (!Array.isArray(pair) || !isFiniteLonLat(pair[0], pair[1]))
        throw malformed();
      return [pair[0], pair[1]];
    });
    return { density: polygon.density, ring };
  });
  const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);
  return {
    date: value.date,
    fetchedAt: value.fetchedAt,
    stale: value.stale === true,
    total: count(value.total),
    dropped: count(value.dropped),
    polygons,
  };
}
