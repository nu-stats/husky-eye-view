import { decodeRing } from '../../data/adminBoundaries.js';

/**
 * Cut Web Mercator imagery tiles to an outline, so a tile layer stops at a
 * border instead of at the edge of its box. The outline is packed Natural
 * Earth polygons ({ meta: { decimals }, polygons }); each ring is projected
 * once into Web Mercator tile space (0–1 across the world), and each tile is
 * drawn into a canvas and kept only inside the outline (even-odd, so holes
 * stay open). A tile that misses the outline entirely is never requested.
 */

const MAX_MERCATOR_LAT = 85.05112878;

/** Longitude/latitude in degrees → Web Mercator tile space (0–1, y down). */
export function mercatorUnit(lon, lat) {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const phi = (clamped * Math.PI) / 180;
  return [
    (lon + 180) / 360,
    (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2,
  ];
}

/**
 * Packed outline → rings in tile space, each with its bounding box.
 * @returns {Array<{points: number[], minX: number, minY: number, maxX: number, maxY: number}>}
 */
export function projectOutline(outline) {
  const decimals = outline?.meta?.decimals;
  if (!Number.isInteger(decimals) || !Array.isArray(outline?.polygons))
    throw new TypeError('outline needs meta.decimals and polygons');
  const rings = [];
  for (const polygon of outline.polygons) {
    for (const packed of polygon) {
      const ring = decodeRing(packed, decimals);
      if (ring.length < 3) continue;
      const points = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [lon, lat] of ring) {
        const [x, y] = mercatorUnit(lon, lat);
        points.push(x, y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      rings.push({ points, minX, minY, maxX, maxY });
    }
  }
  return rings;
}

/** The rings whose boxes touch tile (x, y) at `level` (one tile at level 0). */
export function ringsForTile(rings, x, y, level) {
  const n = 2 ** level;
  const west = x / n;
  const east = (x + 1) / n;
  const north = y / n;
  const south = (y + 1) / n;
  return rings.filter(
    (ring) =>
      ring.maxX >= west &&
      ring.minX <= east &&
      ring.maxY >= north &&
      ring.minY <= south,
  );
}

/** One ring's points as pixel coordinates in tile (x, y) at `level`. */
export function ringPixels(ring, x, y, level, size) {
  const n = 2 ** level;
  const pixels = new Array(ring.points.length);
  for (let i = 0; i < ring.points.length; i += 2) {
    pixels[i] = (ring.points[i] * n - x) * size;
    pixels[i + 1] = (ring.points[i + 1] * n - y) * size;
  }
  return pixels;
}

/** A transparent tile, for tiles outside the outline. */
const blankCanvas = (createCanvas) => createCanvas(1, 1);

/** Draw `image` into a canvas, kept only inside `rings` (tile x, y, level). */
export function maskTileImage(image, rings, x, y, level, createCanvas) {
  const width = image.width || 256;
  const height = image.height || 256;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  context.globalCompositeOperation = 'destination-in';
  context.beginPath();
  for (const ring of rings) {
    const pixels = ringPixels(ring, x, y, level, width);
    context.moveTo(pixels[0], (pixels[1] * height) / width);
    for (let i = 2; i < pixels.length; i += 2)
      context.lineTo(pixels[i], (pixels[i + 1] * height) / width);
    context.closePath();
  }
  context.fill('evenodd');
  return canvas;
}

function documentCanvas(width, height) {
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Make `provider` (a Cesium imagery provider on the Web Mercator tiling
 * scheme, one tile at level 0) return tiles cut to the outline `rings`
 * resolves to. Tiles outside it come back blank without a request; if the
 * outline fails to load, tiles come back uncut (the boxes still bound them).
 */
export function maskImageryProvider(
  provider,
  ringsPromise,
  { createCanvas = documentCanvas } = {},
) {
  let rings = null;
  let failed = false;
  const ready = Promise.resolve(ringsPromise).then(
    (value) => {
      rings = value;
      return value;
    },
    () => {
      failed = true;
      return null;
    },
  );
  const original = provider.requestImage.bind(provider);
  provider.requestImage = (x, y, level, request) => {
    if (rings && !ringsForTile(rings, x, y, level).length)
      return Promise.resolve(blankCanvas(createCanvas));
    const pending = original(x, y, level, request);
    // Cesium throttles by returning undefined; pass that straight back.
    if (!pending) return pending;
    return Promise.all([pending, ready]).then(([image, loaded]) => {
      if (!image || failed || !loaded) return image;
      const touching = ringsForTile(loaded, x, y, level);
      if (!touching.length) return blankCanvas(createCanvas);
      return maskTileImage(image, touching, x, y, level, createCanvas);
    });
  };
  return provider;
}

/** Fetch and project a packed outline (a URL to its JSON). */
export async function loadOutlineRings(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`outline ${response.status}`);
  return projectOutline(await response.json());
}
