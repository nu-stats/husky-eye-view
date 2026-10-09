/**
 * Curated Flights, your own data: reading an uploaded CSV, Excel workbook,
 * GeoJSON or zipped shapefile in the browser (nothing is sent anywhere),
 * finding how it joins to the map (census GEOIDs, coordinates or its own
 * shapes), and the city / county / state values a flight compares. No DOM,
 * no Cesium: the panel, the map overlay and the tests share it.
 */
import { pointInCounty, pointInGeometry } from './curatedModel.js';
import { readXlsxTable } from './xlsxRead.js';

/** Key of the uploaded layer in a flight's layer table. */
export const USER_LAYER_KEY = 'my-data';
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_RECORDS = 250_000;

/** GEOID length -> geography. Shorter IDs that lost a leading zero are padded. */
export const GEOID_LEVELS = Object.freeze({
  2: 'state',
  5: 'county',
  7: 'place',
  11: 'tract',
  12: 'block group',
});
const PADDED_LENGTH = Object.freeze({ 1: 2, 4: 5, 6: 7, 10: 11 });
const LEVEL_RANK = Object.freeze({
  state: 1,
  county: 2,
  place: 3,
  tract: 4,
  'block group': 5,
});

export const LEVEL_PLURAL = Object.freeze({
  state: 'states',
  county: 'counties',
  place: 'places',
  tract: 'tracts',
  'block group': 'block groups',
  point: 'points',
  area: 'areas',
});

/** How the values in a scope are combined. */
export const METHODS = Object.freeze({
  'count-rate': 'Count per 100,000 residents',
  'sum-rate': 'Total per 100,000 residents',
  mean: 'Average',
  sum: 'Total',
});

const LAT_NAMES =
  /^(lat|latitude|y|lat_?dd|point_?y|y_?coord|ycoord|intptlat\d*)$/;
const LON_NAMES =
  /^(lon|lng|long|longitude|x|lon_?dd|long_?dd|point_?x|x_?coord|xcoord|intptlon\d*)$/;
const GEOID_NAMES =
  /^(geoid|geo_?id|geoid\d{2}|geoidfq|geoid_?fq|affgeoid\d*|fips|fips_?code|full_?fips|geofips|geocode|stcofips|county_?fips|cnty_?fips|countyfips|tract_?fips|tract_?geoid|tractfips|place_?fips|placefips|state_?fips|statefips|bg_?geoid|gisjoin)$/;
const STATE_PART = /^(statefp\d*|state|st|state_?code|stfips)$/;
const COUNTY_PART = /^(countyfp\d*|county|cnty|county_?code|cofips)$/;
const TRACT_PART = /^(tractce\d*|tract|tract_?code)$/;
const WEIGHT_NAMES =
  /^(pop|population|total_?pop(ulation)?|totpop|pop_?total|tot_?pop|total_?pop_?18_?plus|households|weight|wt|b01003_?001e|p1_?001n|dp05_?0001e)$/;

const key = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** A cell as a number: "1,234", "12.5%", "$40,000" -> number; else null. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || typeof value === 'boolean')
    return null;
  const text = String(value)
    .trim()
    .replace(/^\$/, '')
    .replace(/%$/, '')
    .replace(/,(?=\d{3}(\D|$))/g, '');
  if (!text || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * A census GEOID from a cell: digits only, "1400000US25025010405" and NHGIS
 * "G25002500104050"-style prefixes removed, Excel's lost leading zero put
 * back. Returns `{geoid, level}` or null.
 */
export function normalizeGeoid(value) {
  let text = String(value ?? '').trim();
  const us = text.toUpperCase().lastIndexOf('US');
  if (us >= 0) text = text.slice(us + 2);
  text = text.replace(/\.0+$/, '');
  if (!/^\d+$/.test(text)) return null;
  if (PADDED_LENGTH[text.length])
    text = text.padStart(PADDED_LENGTH[text.length], '0');
  const level = GEOID_LEVELS[text.length];
  return level ? { geoid: text, level } : null;
}

// ---------- readers ----------

/** RFC 4180 CSV (comma, tab or semicolon) to `{columns, rows}`. */
export function parseCsv(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const firstLine = source.slice(0, source.search(/\r?\n|$/));
  const delimiter = [',', '\t', ';']
    .map((d) => [d, firstLine.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (source[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
  }
  if (field !== '' || row.length) endRow();
  const [header = [], ...body] = rows;
  const seen = new Map();
  const columns = header.map((name, i) => {
    const base = name.trim() || `column_${i + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}_${n}` : base;
  });
  return {
    columns,
    rows: body.map((cells) =>
      Object.fromEntries(
        columns.map((column, i) => [column, (cells[i] ?? '').trim()]),
      ),
    ),
  };
}

/** GeoJSON (FeatureCollection, Feature, geometry) or GeoJSON lines. */
export function parseGeoJson(text) {
  const source = String(text || '').replace(/^﻿/, '');
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    // GeoJSON lines: one feature per line.
    const features = [];
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        features.push(JSON.parse(line));
      } catch {
        throw new Error('This file is not valid GeoJSON.');
      }
    }
    parsed = { type: 'FeatureCollection', features };
  }
  if (parsed?.type === 'FeatureCollection')
    return (parsed.features || []).filter((f) => f?.type === 'Feature');
  if (parsed?.type === 'Feature') return [parsed];
  if (parsed?.type && parsed.coordinates)
    return [{ type: 'Feature', properties: {}, geometry: parsed }];
  throw new Error('This file is not valid GeoJSON.');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function')
    throw new Error('This browser cannot open ZIP files.');
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in a ZIP archive: `[{name, read(): Promise<Uint8Array>}]`. */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('This file is not a ZIP archive.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('This ZIP archive is damaged.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'latin1').decode(
      nameBytes,
    );
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      read: async () => {
        const start =
          local +
          30 +
          view.getUint16(local + 26, true) +
          view.getUint16(local + 28, true);
        const data = bytes.subarray(start, start + compressed);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new Error(`Unsupported ZIP compression in ${name}.`);
      },
    });
  }
  return entries;
}

const ringArea = (ring) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
};

const ringHas = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
};

/** Shapefile rings to GeoJSON: clockwise rings are shells, the rest holes. */
function shapefilePolygon(rings) {
  const shells = [];
  const holes = [];
  for (const ring of rings) (ringArea(ring) < 0 ? shells : holes).push(ring);
  // Some writers ignore the winding rule: then every ring is a shell.
  if (!shells.length) return polygonGeometry(holes.map((ring) => [ring]));
  const polygons = shells.map((ring) => [ring]);
  for (const hole of holes) {
    const owner =
      polygons.find((polygon) => ringHas(hole[0], polygon[0])) ||
      polygons[polygons.length - 1];
    owner.push(hole);
  }
  return polygonGeometry(polygons);
}

const polygonGeometry = (polygons) =>
  polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };

/** The geometries of a .shp file (null for null shapes). */
export function parseShp(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 100 || view.getInt32(0, false) !== 9994)
    throw new Error('The .shp file is not a shapefile.');
  const geometries = [];
  let offset = 100;
  while (offset + 8 <= bytes.length) {
    const length = view.getInt32(offset + 4, false) * 2;
    const at = offset + 8;
    offset = at + length;
    if (length < 4 || offset > bytes.length) break;
    const type = view.getInt32(at, true);
    const point = (p) => [
      view.getFloat64(p, true),
      view.getFloat64(p + 8, true),
    ];
    if (type === 0) geometries.push(null);
    else if (type === 1 || type === 11 || type === 21)
      geometries.push({ type: 'Point', coordinates: point(at + 4) });
    else if (type === 8 || type === 18 || type === 28) {
      const n = view.getInt32(at + 36, true);
      const points = Array.from({ length: n }, (_, i) =>
        point(at + 40 + i * 16),
      );
      geometries.push(
        n === 1
          ? { type: 'Point', coordinates: points[0] }
          : { type: 'MultiPoint', coordinates: points },
      );
    } else if ([3, 13, 23, 5, 15, 25].includes(type)) {
      const parts = view.getInt32(at + 36, true);
      const total = view.getInt32(at + 40, true);
      const starts = Array.from({ length: parts }, (_, i) =>
        view.getInt32(at + 44 + i * 4, true),
      );
      const base = at + 44 + parts * 4;
      const lines = starts.map((start, i) => {
        const stop = i + 1 < parts ? starts[i + 1] : total;
        return Array.from({ length: stop - start }, (_, k) =>
          point(base + (start + k) * 16),
        );
      });
      if (type % 10 === 5) geometries.push(shapefilePolygon(lines));
      else
        geometries.push(
          lines.length === 1
            ? { type: 'LineString', coordinates: lines[0] }
            : { type: 'MultiLineString', coordinates: lines },
        );
    } else throw new Error(`Unsupported shapefile shape type ${type}.`);
  }
  return geometries;
}

/** The records of a .dbf table (dBASE III). */
export function parseDbf(bytes, encoding = 'latin1') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const decoder = new TextDecoder(encoding);
  const fields = [];
  for (let at = 32; at + 32 <= headerLength && bytes[at] !== 0x0d; at += 32) {
    const raw = bytes.subarray(at, at + 11);
    const zero = raw.indexOf(0);
    fields.push({
      name: decoder.decode(zero >= 0 ? raw.subarray(0, zero) : raw).trim(),
      type: String.fromCharCode(bytes[at + 11]),
      length: bytes[at + 16],
    });
  }
  const rows = [];
  for (let r = 0; r < records; r++) {
    let at = headerLength + r * recordLength;
    if (at + recordLength > bytes.length) break;
    const deleted = bytes[at] === 0x2a;
    at += 1;
    const row = {};
    for (const field of fields) {
      const text = decoder.decode(bytes.subarray(at, at + field.length)).trim();
      at += field.length;
      if (field.type === 'N' || field.type === 'F')
        row[field.name] = text === '' ? null : toNumber(text);
      else if (field.type === 'L')
        row[field.name] = /^[YyTt]$/.test(text)
          ? true
          : /^[NnFf]$/.test(text)
            ? false
            : null;
      else row[field.name] = text;
    }
    if (!deleted) rows.push(row);
  }
  return rows;
}

/** A zipped shapefile as GeoJSON features (the first .shp in the archive). */
export async function readZippedShapefile(bytes) {
  const entries = readZip(bytes).filter(
    (entry) => !/(^|\/)(__MACOSX|\._)/.test(entry.name),
  );
  const shps = entries.filter((entry) => /\.shp$/i.test(entry.name));
  if (!shps.length) {
    const inner = entries.find((entry) =>
      /\.(csv|geojson|json|txt)$/i.test(entry.name),
    );
    if (inner)
      return { inner: { name: inner.name, bytes: await inner.read() } };
    throw new Error('The ZIP holds no shapefile (.shp), CSV or GeoJSON.');
  }
  const shp = shps[0];
  const stem = shp.name.slice(0, -4).toLowerCase();
  const sibling = (ext) =>
    entries.find((entry) => entry.name.toLowerCase() === `${stem}.${ext}`);
  const dbfEntry = sibling('dbf');
  const prj = sibling('prj')
    ? new TextDecoder().decode(await sibling('prj').read())
    : '';
  const cpg = sibling('cpg')
    ? new TextDecoder().decode(await sibling('cpg').read()).trim()
    : '';
  const geometries = parseShp(await shp.read());
  const rows = dbfEntry
    ? parseDbf(
        await dbfEntry.read(),
        /utf-?8|65001/i.test(cpg) ? 'utf-8' : 'latin1',
      )
    : [];
  const notes = [];
  if (shps.length > 1)
    notes.push(
      `The ZIP holds ${shps.length} shapefiles; using ${shp.name.split('/').pop()}.`,
    );
  return {
    name: shp.name.split('/').pop(),
    prj,
    notes,
    features: geometries.map((geometry, i) => ({
      type: 'Feature',
      properties: rows[i] || {},
      geometry,
    })),
  };
}

// ---------- geometry helpers ----------

/** Every [lon, lat] of a geometry. */
function eachPosition(geometry, visit) {
  const walk = (coords) => {
    if (typeof coords?.[0] === 'number') visit(coords);
    else for (const child of coords || []) walk(child);
  };
  if (geometry?.type === 'GeometryCollection')
    for (const part of geometry.geometries || []) eachPosition(part, visit);
  else walk(geometry?.coordinates);
}

/** [w, s, e, n] of a geometry, or null. */
export function geometryBbox(geometry) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  eachPosition(geometry, ([x, y]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < w) w = x;
    if (y < s) s = y;
    if (x > e) e = x;
    if (y > n) n = y;
  });
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/**
 * A representative point: the point itself, the mean of a multipoint, or the
 * area-weighted centroid of a polygon's largest part (its bbox center when
 * that falls outside, e.g. a crescent).
 */
export function geometryPoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates.slice(0, 2);
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : null;
  if (polygons?.length) {
    let best = null;
    let bestArea = -1;
    for (const polygon of polygons) {
      const area = Math.abs(ringArea(polygon[0] || []));
      if (area > bestArea) {
        bestArea = area;
        best = polygon;
      }
    }
    // Relative to the first vertex, so the cross products keep precision.
    const [ox, oy] = best?.[0]?.[0] || [0, 0];
    const ring = (best?.[0] || []).map(([x, y]) => [x - ox, y - oy]);
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
    if (a !== 0) {
      const centroid = [ox + cx / (3 * a), oy + cy / (3 * a)];
      if (pointInGeometry(centroid, { type: 'Polygon', coordinates: best }))
        return centroid;
    }
  }
  const bbox = geometryBbox(geometry);
  return bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null;
}

const looksProjected = (bbox) =>
  bbox &&
  (Math.abs(bbox[0]) > 180 ||
    Math.abs(bbox[2]) > 180 ||
    Math.abs(bbox[1]) > 90 ||
    Math.abs(bbox[3]) > 90);

// ---------- building a dataset ----------

/** Find the join columns among `columns` (names only; values checked later). */
export function detectColumns(columns) {
  const byKey = new Map(columns.map((column) => [key(column), column]));
  const find = (pattern) =>
    [...byKey.entries()].find(([name]) => pattern.test(name))?.[1] || null;
  return {
    lat: find(LAT_NAMES),
    lon: find(LON_NAMES),
    geoid: find(GEOID_NAMES),
    statePart: find(STATE_PART),
    countyPart: find(COUNTY_PART),
    tractPart: find(TRACT_PART),
    // Adults first: survey prevalences (e.g. CDC PLACES) are shares of adults.
    weight: find(/^total_?pop_?18_?plus$|^adults?$/) || find(WEIGHT_NAMES),
  };
}

/** GEOIDs of a column, and the level most of them share. */
function geoidColumn(rows, column) {
  const counts = {};
  let valid = 0;
  for (const row of rows) {
    const id = normalizeGeoid(row[column]);
    if (!id) continue;
    valid++;
    counts[id.level] = (counts[id.level] || 0) + 1;
  }
  const level = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return valid >= Math.max(1, rows.length * 0.5) ? level : null;
}

/** A GEOID built from separate state / county / tract code columns. */
function partsGeoid(row, parts) {
  const digits = (value, width) => {
    const text = String(value ?? '')
      .trim()
      .replace(/\.0+$/, '');
    return /^\d+$/.test(text) && text.length <= width
      ? text.padStart(width, '0')
      : null;
  };
  const state = digits(row[parts.statePart], 2);
  if (!state) return null;
  if (!parts.countyPart) return null;
  const county = digits(row[parts.countyPart], 3);
  if (!county) return null;
  if (!parts.tractPart) return `${state}${county}`;
  const tract = digits(row[parts.tractPart], 6);
  return tract ? `${state}${county}${tract}` : `${state}${county}`;
}

/** Numeric columns: at least half of the filled cells are numbers. */
function numericColumns(rows, columns, exclude) {
  return columns.filter((column) => {
    if (exclude.has(column)) return false;
    let filled = 0;
    let numbers = 0;
    for (const row of rows.slice(0, 2000)) {
      const value = row[column];
      if (value === null || value === undefined || value === '') continue;
      filled++;
      if (toNumber(value) !== null) numbers++;
    }
    return filled > 0 && numbers / filled >= 0.5;
  });
}

/**
 * Turn rows (from a CSV or a GeoJSON / shapefile's features) into a dataset:
 * `{name, kind, level, join, records, columns, numeric, weight, notes}`.
 * A record is `{geoid, level, point, geometry, props}`.
 */
export function buildDataset({ name, rows, columns, geometries = null }) {
  if (!rows.length) throw new Error('The file has no rows.');
  if (rows.length > MAX_RECORDS)
    throw new Error(
      `The file has ${rows.length.toLocaleString('en-US')} rows; the limit is ${MAX_RECORDS.toLocaleString('en-US')}.`,
    );
  const found = detectColumns(columns);
  const notes = [];
  // Several ID columns (county FIPS and tract FIPS): join on the finest.
  const finest = columns
    .filter((column) => GEOID_NAMES.test(key(column)))
    .map((column) => ({ column, level: geoidColumn(rows, column) }))
    .filter(({ level }) => level)
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0];
  if (finest) found.geoid = finest.column;
  let geoidLevel = found.geoid ? geoidColumn(rows, found.geoid) : null;
  let geoidOf = geoidLevel ? (row) => normalizeGeoid(row[found.geoid]) : null;
  let join = geoidLevel ? `the ${found.geoid} column` : null;
  if (!geoidOf && found.statePart && found.countyPart) {
    const ids = rows.map((row) => partsGeoid(row, found));
    if (ids.filter(Boolean).length >= rows.length * 0.5) {
      geoidOf = (row) => normalizeGeoid(partsGeoid(row, found));
      geoidLevel = found.tractPart ? 'tract' : 'county';
      join = [found.statePart, found.countyPart, found.tractPart]
        .filter(Boolean)
        .join(' + ');
    }
  }
  if (!geoidOf) {
    // Any column of census IDs, whatever it is called.
    for (const column of columns) {
      const level = geoidColumn(rows, column);
      if (level && level !== 'state' && /id|fips|geo|code/i.test(column)) {
        geoidOf = (row) => normalizeGeoid(row[column]);
        geoidLevel = level;
        join = `the ${column} column`;
        found.geoid = column;
        break;
      }
    }
  }
  const coordinates =
    !geometries && found.lat && found.lon
      ? (row) => {
          const lat = toNumber(row[found.lat]);
          const lon = toNumber(row[found.lon]);
          return lat === null || lon === null ? null : [lon, lat];
        }
      : null;
  const records = [];
  let unmatched = 0;
  rows.forEach((row, i) => {
    const geometry = geometries?.[i] || null;
    const id = geoidOf ? geoidOf(row) : null;
    const point = geometry
      ? geometryPoint(geometry)
      : coordinates
        ? coordinates(row)
        : null;
    if (!id && !point) {
      unmatched++;
      return;
    }
    records.push({
      geoid: id?.geoid || null,
      level: id?.level || null,
      point,
      geometry: geometry
        ? geometry
        : point && !id
          ? { type: 'Point', coordinates: point }
          : null,
      props: row,
    });
  });
  if (!records.length)
    throw new Error(
      geometries
        ? 'None of the features has a shape.'
        : 'No column joins this file to the map. Add census GEOIDs (state, county, place, tract or block group), or latitude and longitude columns.',
    );
  const bbox = records.reduce((box, record) => {
    const b = record.point ? [...record.point, ...record.point] : null;
    if (!b) return box;
    return box
      ? [
          Math.min(box[0], b[0]),
          Math.min(box[1], b[1]),
          Math.max(box[2], b[2]),
          Math.max(box[3], b[3]),
        ]
      : b;
  }, null);
  if (looksProjected(bbox))
    throw new Error(
      'The coordinates are not longitude and latitude (the file uses a projected coordinate system). Save it in WGS 84 (EPSG:4326) and upload it again.',
    );
  if (unmatched)
    notes.push(
      `${unmatched.toLocaleString('en-US')} row${unmatched === 1 ? '' : 's'} had no usable ID or location and were left out.`,
    );
  const types = new Set(
    records.map((record) => record.geometry?.type).filter(Boolean),
  );
  const pointsOnly =
    !geoidLevel &&
    [...types].every((type) => type === 'Point' || type === 'MultiPoint');
  const kind = pointsOnly ? 'points' : 'areas';
  const level = geoidLevel || (pointsOnly ? 'point' : 'area');
  const exclude = new Set(
    [
      ...columns.filter((column) => GEOID_NAMES.test(key(column))),
      found.geoid,
      found.lat,
      found.lon,
      found.statePart,
      found.countyPart,
      found.tractPart,
    ].filter(Boolean),
  );
  const numeric = numericColumns(
    records.map((record) => record.props),
    columns,
    exclude,
  );
  return {
    name,
    kind,
    level,
    join:
      join ||
      (coordinates ? `${found.lat} / ${found.lon}` : 'the shapes in the file'),
    records,
    columns,
    numeric,
    weight:
      found.weight && numeric.includes(found.weight) ? found.weight : null,
    bbox,
    notes,
  };
}

/** Read an uploaded file (name + bytes) into a dataset. */
export async function readUpload(name, bytes) {
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new Error(
      `The file is ${(bytes.length / 1048576).toFixed(0)} MB; the limit is ${MAX_UPLOAD_BYTES / 1048576} MB.`,
    );
  const lower = name.toLowerCase();
  const text = () => new TextDecoder().decode(bytes);
  const fromFeatures = (fileName, features, notes = []) => {
    const columns = [
      ...new Set(features.flatMap((f) => Object.keys(f.properties || {}))),
    ];
    const dataset = buildDataset({
      name: fileName,
      rows: features.map((f) => f.properties || {}),
      columns,
      geometries: features.map((f) => f.geometry || null),
    });
    dataset.notes.unshift(...notes);
    return dataset;
  };
  if (lower.endsWith('.zip')) {
    const zipped = await readZippedShapefile(bytes);
    if (zipped.inner) return readUpload(zipped.inner.name, zipped.inner.bytes);
    const dataset = fromFeatures(name, zipped.features, zipped.notes);
    if (/^\s*PROJCS/i.test(zipped.prj) && looksProjected(dataset.bbox))
      throw new Error(
        'The shapefile uses a projected coordinate system. Save it in WGS 84 (EPSG:4326) and upload it again.',
      );
    return dataset;
  }
  if (/\.(geojson|json|geojsonl|ndjson)$/.test(lower))
    return fromFeatures(name, parseGeoJson(text()));
  if (/\.(csv|tsv|txt)$/.test(lower)) {
    const { columns, rows } = parseCsv(text());
    return buildDataset({ name, rows, columns });
  }
  if (/\.(xlsx|xlsm)$/.test(lower)) {
    // The first sheet with data, its first row the header.
    const { columns, rows } = await readXlsxTable(bytes);
    return buildDataset({ name, rows, columns });
  }
  if (lower.endsWith('.shp'))
    throw new Error(
      'Upload the shapefile as a ZIP with its .shp, .dbf and .prj files together.',
    );
  throw new Error(
    'Upload a CSV, an Excel workbook (.xlsx), GeoJSON, or a zipped shapefile.',
  );
}

// ---------- values for a flight ----------

/** Sensible first choices for a dataset's layer. */
export function defaultOptions(dataset) {
  // A rate or share before counts; population columns are weights, not values.
  const values = dataset.numeric.filter(
    (c) => c !== dataset.weight && !WEIGHT_NAMES.test(key(c)),
  );
  const column =
    values.find((c) => /prev|rate|pct|percent|share|_p$/i.test(c)) ||
    values[0] ||
    dataset.numeric[0] ||
    null;
  const label = dataset.name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return {
    column: dataset.kind === 'points' ? null : column,
    method:
      dataset.kind === 'points' ? 'count-rate' : column ? 'mean' : 'count-rate',
    weight: dataset.kind === 'points' ? null : dataset.weight,
    label: label ? `My data: ${label}` : 'My data',
    // Prevalences, rates and shares are percentages unless the user says not.
    unit: column && /prev|pct|percent|share/i.test(column) ? '% of people' : '',
    decimals: 1,
  };
}

/** Methods that make sense for a dataset (counts need people to divide by). */
export function methodsFor(dataset) {
  return dataset.kind === 'points'
    ? ['count-rate', 'sum-rate', 'mean']
    : ['mean', 'sum', 'count-rate', 'sum-rate'];
}

/** The unit a method gives the layer when the user has not typed one. */
export function methodUnit(options) {
  if (options.unit) return options.unit;
  if (options.method === 'count-rate') return 'per 100,000 residents';
  if (options.method === 'sum-rate')
    return `${options.column || 'total'} per 100,000 residents`;
  return options.column || 'value';
}

/**
 * Which scopes (city, county, state) a record belongs to.
 * `context`: {city, county (curated table county), stateGeometry, tractPoints}
 */
export function recordScopes(
  record,
  { city, county, stateGeometry, tractPoints },
) {
  const scopes = { city: false, county: false, state: false };
  const fips = city.county?.fips;
  if (record.geoid) {
    const id = record.geoid;
    scopes.state = id.startsWith(city.stateFips);
    if (record.level === 'place') scopes.city = id === city.id;
    if (record.level === 'state') return scopes;
    if (record.level === 'place') return scopes;
    scopes.county = Boolean(fips) && id.slice(0, 5) === fips;
    if (record.level === 'county') return scopes;
    const point = record.point || tractPoints?.get(id.slice(0, 11)) || null;
    scopes.city =
      Boolean(point && scopes.state) && pointInGeometry(point, city.boundary);
    return scopes;
  }
  const point = record.point;
  if (!point) return scopes;
  scopes.state = stateGeometry ? pointInGeometry(point, stateGeometry) : false;
  scopes.county = scopes.state && pointInCounty(point, county);
  scopes.city = pointInGeometry(point, city.boundary);
  return scopes;
}

/**
 * City / county / state values of the uploaded layer for one city:
 * `{city, county, state, counts}`; null where the file has nothing there.
 */
export function userLayerValues(dataset, options, city, context) {
  const sums = {
    city: { n: 0, total: 0, weighted: 0, weights: 0 },
    county: { n: 0, total: 0, weighted: 0, weights: 0 },
    state: { n: 0, total: 0, weighted: 0, weights: 0 },
  };
  const needsValue = options.method !== 'count-rate';
  for (const record of dataset.records) {
    const value = options.column
      ? toNumber(record.props[options.column])
      : null;
    if (needsValue && value === null) continue;
    const weight = options.weight ? toNumber(record.props[options.weight]) : 1;
    if (options.method === 'mean' && options.weight && !(weight > 0)) continue;
    const scopes = recordScopes(record, { city, ...context });
    for (const scope of ['city', 'county', 'state']) {
      if (!scopes[scope]) continue;
      const sum = sums[scope];
      sum.n += 1;
      sum.total += value ?? 0;
      sum.weighted += (value ?? 0) * weight;
      sum.weights += weight;
    }
  }
  const people = {
    city: city.populations?.city || city.population,
    county: city.populations?.county,
    state: city.populations?.state,
  };
  const result = { counts: {} };
  for (const scope of ['city', 'county', 'state']) {
    const sum = sums[scope];
    result.counts[scope] = sum.n;
    if (options.method === 'count-rate' || options.method === 'sum-rate') {
      // A rate needs the whole scope: zero points in a city is a real zero,
      // but only when the file covers that place at all.
      const total = options.method === 'count-rate' ? sum.n : sum.total;
      const covered = sum.n > 0 || sums.state.n > 0;
      result[scope] =
        covered && people[scope] > 0 ? (total / people[scope]) * 100_000 : null;
    } else if (!sum.n) result[scope] = null;
    else if (options.method === 'sum') result[scope] = sum.total;
    else result[scope] = sum.weights > 0 ? sum.weighted / sum.weights : null;
    // Five significant digits: tidy in the data file, exact enough for rates.
    if (Number.isFinite(result[scope]))
      result[scope] = Number(result[scope].toPrecision(5));
  }
  return result;
}

/** One sentence on how the layer was made, for the card, report and README. */
export function describeUserLayer(dataset, options) {
  const count = dataset.records.length.toLocaleString('en-US');
  const what = LEVEL_PLURAL[dataset.level] || 'records';
  const method =
    options.method === 'count-rate'
      ? `the number of ${what} per 100,000 residents`
      : options.method === 'sum-rate'
        ? `the total of ${options.column} per 100,000 residents`
        : options.method === 'sum'
          ? `the total of ${options.column}`
          : `the ${options.weight ? `${options.weight}-weighted ` : ''}average of ${options.column}`;
  const scopes =
    dataset.level === 'county'
      ? ' County data has no city value; the state is the mean of its counties in the file.'
      : dataset.level === 'state'
        ? ' State data has only a state value.'
        : dataset.level === 'place'
          ? ' Place data gives the city; the state is the mean of its places in the file.'
          : dataset.level === 'tract' || dataset.level === 'block group'
            ? ` The city is the ${what} whose center lies inside the city boundary; county and state come from the GEOID.`
            : ' Each record counts toward the city, county and state it falls in.';
  return `Uploaded by the user: ${dataset.name} (${count} ${what}, joined by ${dataset.join}). Each value is ${method}.${scopes} Not checked by Husky Eye View.`;
}

/** The layer entry a flight's table gets for the upload. */
export function userLayerEntry(dataset, options) {
  return {
    label: options.label || 'My data',
    group: 'Your data',
    layerId: null,
    user: true,
    unit: methodUnit(options),
    decimals: Number.isInteger(options.decimals) ? options.decimals : 1,
    vintage: 'as uploaded',
    higherIs: null,
    note: describeUserLayer(dataset, options),
    source: `User upload: ${dataset.name}. Processed in the browser; never sent to a server.`,
    table: dataset.name,
  };
}

/** A copy of the flight table with the upload added as a layer. */
export function tableWithUpload(table, dataset, options) {
  if (!dataset) return table;
  return {
    ...table,
    layers: {
      ...table.layers,
      [USER_LAYER_KEY]: userLayerEntry(dataset, options),
    },
  };
}

/** Five quantile class breaks for coloring the upload on the map. */
export function quantileBreaks(values, classes = 5) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const breaks = [];
  for (let i = 1; i < classes; i++)
    breaks.push(
      sorted[
        Math.min(sorted.length - 1, Math.floor((i * sorted.length) / classes))
      ],
    );
  return [...new Set(breaks)];
}

/** Class index (0..breaks.length) of a value. */
export function classOf(value, breaks) {
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
}
