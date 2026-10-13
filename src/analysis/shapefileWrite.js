/**
 * A shapefile of a table, for Merge & Export: `.shp` and `.shx` (polygons,
 * or points), `.dbf` (every column: text, numbers and dates), `.prj`
 * (WGS 84 longitude / latitude) and `.cpg` (UTF-8). Rows without a shape
 * get a null shape, so the attribute table keeps every row. No DOM and no
 * Node APIs: the worker and the tests share it.
 *
 * dBase field names have at most 10 characters; `programNames(…, 'dbf')`
 * shortens them and the codebook lists the changes.
 */
import { programNames, utf8Prefix } from './statFiles.js';

const encoder = new TextEncoder();
export const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

const signedArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
};

/** Polygon rings as the shapefile wants them: outer rings clockwise, holes not. */
function polygonRings(geometry) {
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  const rings = [];
  for (const polygon of polygons)
    polygon.forEach((source, index) => {
      if (!Array.isArray(source) || source.length < 4) return;
      const ring = source.map(([x, y]) => [x, y]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1])
        ring.push([first[0], first[1]]);
      // In x/y (longitude/latitude) a positive "signed area" here is clockwise.
      const clockwise = signedArea(ring) > 0;
      if ((index === 0) !== clockwise) ring.reverse();
      rings.push(ring);
    });
  return rings;
}

const pointOf = (geometry) =>
  geometry?.type === 'Point'
    ? geometry.coordinates
    : geometry?.type === 'MultiPoint'
      ? geometry.coordinates[0] || null
      : null;

/** dBase field definitions for the columns. */
function dbfFields(columns, rows, names) {
  return columns.map((c, j) => {
    const name = names[j];
    if (c.kind === 'date')
      return { name, type: 'D', length: 8, decimals: 0, j, kind: 'date' };
    if (c.kind === 'numeric') {
      let decimals = 0;
      let intDigits = 1;
      for (const row of rows) {
        const v = row[j];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const text = Math.abs(v)
          .toFixed(15)
          .replace(/0+$/, '')
          .replace(/\.$/, '');
        const [int, frac = ''] = text.split('.');
        intDigits = Math.max(intDigits, int.length + (v < 0 ? 1 : 0));
        decimals = Math.max(decimals, Math.min(frac.length, 15));
      }
      // dBase numbers: at most 24 characters here, decimals giving way first.
      decimals = Math.max(0, Math.min(decimals, 24 - intDigits - 1));
      const length = Math.min(24, intDigits + (decimals ? decimals + 1 : 0));
      return {
        name,
        type: 'N',
        length: Math.max(length, 1),
        decimals,
        j,
        kind: 'numeric',
      };
    }
    // Text (and date-times, as ISO text): up to 254 bytes.
    let length = 1;
    for (const row of rows) {
      const v = textOf(c, row[j]);
      if (v) length = Math.max(length, Math.min(254, encoder.encode(v).length));
    }
    return { name, type: 'C', length, decimals: 0, j, kind: c.kind };
  });
}

function textOf(column, v) {
  if (v === null || v === undefined) return '';
  if (column.kind === 'datetime' && Number.isFinite(v))
    return new Date(v).toISOString().slice(0, 19).replace('T', ' ');
  return String(v);
}

/**
 * The shapefile's files for a table and one geometry (GeoJSON, or null) per
 * row: `{files: {shp, shx, dbf, prj, cpg}, shapeType, renames, notes}`.
 */
export function writeShapefile(
  { columns, rows },
  geometries,
  { date = new Date() } = {},
) {
  const notes = [];
  const polygonal = geometries.some((g) => g && /Polygon/.test(g.type));
  const shapeType = polygonal ? 5 : 1;
  const others = geometries.filter(
    (g) => g && (polygonal ? !/Polygon/.test(g.type) : !pointOf(g)),
  ).length;
  if (others)
    notes.push(
      `${others.toLocaleString('en-US')} row${others === 1 ? '' : 's'} with a shape of another kind (lines, or points among areas) have a null shape.`,
    );
  // Shape records.
  const records = geometries.map((g) => {
    if (shapeType === 1) {
      const p = g ? pointOf(g) : null;
      if (!p) return { bytes: new Uint8Array([0, 0, 0, 0]), box: null };
      const b = new Uint8Array(20);
      const v = new DataView(b.buffer);
      v.setInt32(0, 1, true);
      v.setFloat64(4, p[0], true);
      v.setFloat64(12, p[1], true);
      return { bytes: b, box: [p[0], p[1], p[0], p[1]] };
    }
    const rings = g ? polygonRings(g) : [];
    if (!rings.length)
      return { bytes: new Uint8Array([0, 0, 0, 0]), box: null };
    const points = rings.flat();
    const box = points.reduce(
      (a, [x, y]) => [
        Math.min(a[0], x),
        Math.min(a[1], y),
        Math.max(a[2], x),
        Math.max(a[3], y),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const b = new Uint8Array(44 + 4 * rings.length + 16 * points.length);
    const v = new DataView(b.buffer);
    v.setInt32(0, 5, true);
    box.forEach((x, i) => v.setFloat64(4 + 8 * i, x, true));
    v.setInt32(36, rings.length, true);
    v.setInt32(40, points.length, true);
    let start = 0;
    rings.forEach((ring, i) => {
      v.setInt32(44 + 4 * i, start, true);
      start += ring.length;
    });
    let at = 44 + 4 * rings.length;
    for (const [x, y] of points) {
      v.setFloat64(at, x, true);
      v.setFloat64(at + 8, y, true);
      at += 16;
    }
    return { bytes: b, box };
  });
  const boxes = records.map((r) => r.box).filter(Boolean);
  const bounds = boxes.length
    ? boxes.reduce((a, b) => [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[2], b[2]),
        Math.max(a[3], b[3]),
      ])
    : [0, 0, 0, 0];
  const shpLength = 100 + records.reduce((s, r) => s + 8 + r.bytes.length, 0);
  const shxLength = 100 + 8 * records.length;
  const header = (length) => {
    const h = new Uint8Array(100);
    const v = new DataView(h.buffer);
    v.setInt32(0, 9994, false);
    v.setInt32(24, length / 2, false);
    v.setInt32(28, 1000, true);
    v.setInt32(32, shapeType, true);
    bounds.forEach((x, i) => v.setFloat64(36 + 8 * i, x, true));
    return h;
  };
  const shp = new Uint8Array(shpLength);
  const shx = new Uint8Array(shxLength);
  shp.set(header(shpLength), 0);
  shx.set(header(shxLength), 0);
  const shpView = new DataView(shp.buffer);
  const shxView = new DataView(shx.buffer);
  let offset = 100;
  records.forEach((r, i) => {
    shxView.setInt32(100 + 8 * i, offset / 2, false);
    shxView.setInt32(104 + 8 * i, r.bytes.length / 2, false);
    shpView.setInt32(offset, i + 1, false);
    shpView.setInt32(offset + 4, r.bytes.length / 2, false);
    shp.set(r.bytes, offset + 8);
    offset += 8 + r.bytes.length;
  });
  // The attribute table.
  const { names, renames } = programNames(columns, 'dbf');
  const fields = dbfFields(columns, rows, names);
  const recordLength = 1 + fields.reduce((s, f) => s + f.length, 0);
  const headerLength = 32 + 32 * fields.length + 1;
  const dbf = new Uint8Array(headerLength + recordLength * rows.length + 1);
  const dv = new DataView(dbf.buffer);
  dbf[0] = 0x03;
  dbf[1] = date.getFullYear() - 1900;
  dbf[2] = date.getMonth() + 1;
  dbf[3] = date.getDate();
  dv.setUint32(4, rows.length, true);
  dv.setUint16(8, headerLength, true);
  dv.setUint16(10, recordLength, true);
  fields.forEach((f, k) => {
    const at = 32 + 32 * k;
    dbf.set(encoder.encode(f.name).subarray(0, 10), at);
    dbf[at + 11] = f.type.charCodeAt(0);
    dbf[at + 16] = f.length;
    dbf[at + 17] = f.decimals;
  });
  dbf[headerLength - 1] = 0x0d;
  let truncated = 0;
  rows.forEach((row, i) => {
    let at = headerLength + i * recordLength;
    dbf[at] = 0x20;
    at += 1;
    for (const f of fields) {
      const v = row[f.j];
      let text = '';
      if (f.type === 'N') {
        if (typeof v === 'number' && Number.isFinite(v)) {
          text = v.toFixed(f.decimals);
          if (text.length > f.length)
            text = v.toPrecision(Math.max(1, f.length - 6));
          text = text.padStart(f.length, ' ');
        }
        dbf.fill(0x20, at, at + f.length);
        dbf.set(encoder.encode(text).subarray(0, f.length), at);
      } else if (f.type === 'D') {
        if (Number.isFinite(v))
          text = new Date(Math.round(v * 86_400_000))
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, '');
        dbf.fill(0x20, at, at + 8);
        dbf.set(encoder.encode(text), at);
      } else {
        const full = encoder.encode(textOf(columns[f.j], v));
        const bytes = utf8Prefix(textOf(columns[f.j], v), f.length);
        if (bytes.length < full.length) truncated += 1;
        dbf.fill(0x20, at, at + f.length);
        dbf.set(bytes, at);
      }
      at += f.length;
    }
  });
  dbf[dbf.length - 1] = 0x1a;
  if (truncated)
    notes.push(
      `${truncated.toLocaleString('en-US')} text value${truncated === 1 ? ' was' : 's were'} longer than a shapefile allows (254 bytes) and cut.`,
    );
  const nulls = records.filter((r) => !r.box).length;
  if (nulls)
    notes.push(
      `${nulls.toLocaleString('en-US')} row${nulls === 1 ? ' has' : 's have'} no shape (no matching area or location) and a null shape in the file.`,
    );
  return {
    files: { shp, shx, dbf, prj: WGS84_PRJ, cpg: 'UTF-8' },
    shapeType,
    renames,
    notes,
  };
}
