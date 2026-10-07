/**
 * A polygon shapefile (.shp, .shx, .dbf, .prj) from GeoJSON areas, written
 * without libraries, so a Stata session can run spshape2dta and build
 * contiguity weights, and GeoDa or QGIS can open the same areas.
 *
 * Rings follow the shapefile rule: outer rings clockwise, holes counter-
 * clockwise. The table holds the GEOID only (names are in the dataset).
 */

const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

const signedArea = (ring) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
};

/** Outer rings clockwise (negative area), holes counter-clockwise; closed. */
function shapeRings(geometry) {
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  const rings = [];
  for (const polygon of polygons) {
    polygon.forEach((raw, index) => {
      if (!raw || raw.length < 3) return;
      const ring = raw.map(([x, y]) => [x, y]);
      const [fx, fy] = ring[0];
      const [lx, ly] = ring[ring.length - 1];
      if (fx !== lx || fy !== ly) ring.push([fx, fy]);
      const clockwise = signedArea(ring) < 0;
      if ((index === 0) !== clockwise) ring.reverse();
      rings.push(ring);
    });
  }
  return rings;
}

/**
 * @param {Array<{geoid: string, geometry: object}>} areas
 * @returns {{shp: Buffer, shx: Buffer, dbf: Buffer, prj: string}}
 */
export function writeShapefile(areas) {
  const records = areas.map((area) => {
    const rings = shapeRings(area.geometry);
    const points = rings.flat();
    const box = points.reduce(
      (b, [x, y]) => [
        Math.min(b[0], x),
        Math.min(b[1], y),
        Math.max(b[2], x),
        Math.max(b[3], y),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    // Shape type 5 (polygon): type, box, part count, point count, parts, points.
    const length = 44 + 4 * rings.length + 16 * points.length;
    const content = Buffer.alloc(rings.length ? length : 4);
    if (!rings.length) {
      content.writeInt32LE(0, 0); // null shape
      return content;
    }
    content.writeInt32LE(5, 0);
    box.forEach((v, i) => content.writeDoubleLE(v, 4 + 8 * i));
    content.writeInt32LE(rings.length, 36);
    content.writeInt32LE(points.length, 40);
    let start = 0;
    rings.forEach((ring, i) => {
      content.writeInt32LE(start, 44 + 4 * i);
      start += ring.length;
    });
    let at = 44 + 4 * rings.length;
    for (const [x, y] of points) {
      content.writeDoubleLE(x, at);
      content.writeDoubleLE(y, at + 8);
      at += 16;
    }
    return { content, box };
  });

  const all = records.filter((r) => r.box).map((r) => r.box);
  const bounds = all.length
    ? all.reduce((b, r) => [
        Math.min(b[0], r[0]),
        Math.min(b[1], r[1]),
        Math.max(b[2], r[2]),
        Math.max(b[3], r[3]),
      ])
    : [0, 0, 0, 0];

  const header = (fileWords) => {
    const h = Buffer.alloc(100);
    h.writeInt32BE(9994, 0);
    h.writeInt32BE(fileWords, 24);
    h.writeInt32LE(1000, 28);
    h.writeInt32LE(5, 32);
    bounds.forEach((v, i) => h.writeDoubleLE(v, 36 + 8 * i));
    return h;
  };

  const shpParts = [];
  const shxParts = [];
  let offsetWords = 50;
  records.forEach((record, i) => {
    const content = record.content || record;
    const recordHeader = Buffer.alloc(8);
    recordHeader.writeInt32BE(i + 1, 0);
    recordHeader.writeInt32BE(content.length / 2, 4);
    shpParts.push(recordHeader, content);
    const index = Buffer.alloc(8);
    index.writeInt32BE(offsetWords, 0);
    index.writeInt32BE(content.length / 2, 4);
    shxParts.push(index);
    offsetWords += 4 + content.length / 2;
  });
  const shp = Buffer.concat([header(offsetWords), ...shpParts]);
  const shx = Buffer.concat([header(50 + 4 * records.length), ...shxParts]);

  // dBASE III table: one character field, GEOID.
  const width = 15;
  const dbfHeader = Buffer.alloc(32 + 32 + 1);
  const now = new Date();
  dbfHeader.writeUInt8(0x03, 0);
  dbfHeader.writeUInt8(now.getFullYear() - 1900, 1);
  dbfHeader.writeUInt8(now.getMonth() + 1, 2);
  dbfHeader.writeUInt8(now.getDate(), 3);
  dbfHeader.writeUInt32LE(areas.length, 4);
  dbfHeader.writeUInt16LE(dbfHeader.length, 8);
  dbfHeader.writeUInt16LE(1 + width, 10);
  dbfHeader.write('GEOID', 32, 'ascii');
  dbfHeader.write('C', 43, 'ascii');
  dbfHeader.writeUInt8(width, 48);
  dbfHeader.writeUInt8(0x0d, 64);
  const rows = areas.map((area) => {
    const row = Buffer.alloc(1 + width, 0x20);
    row.write(String(area.geoid).slice(0, width), 1, 'ascii');
    return row;
  });
  const dbf = Buffer.concat([dbfHeader, ...rows, Buffer.from([0x1a])]);
  return { shp, shx, dbf, prj: WGS84_PRJ };
}
