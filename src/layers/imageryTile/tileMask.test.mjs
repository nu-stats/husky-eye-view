import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeRing, pointInRing } from '../../data/adminBoundaries.js';
import {
  maskImageryProvider,
  mercatorUnit,
  projectOutline,
  ringPixels,
  ringsForTile,
} from './tileMask.js';

const outline = JSON.parse(
  readFileSync(
    new URL(
      '../../data/local_data/natural_earth/us_outline.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

/** Even-odd test over every ring of the packed outline. */
function inOutline(lon, lat) {
  let inside = false;
  for (const polygon of outline.polygons)
    for (const packed of polygon)
      if (pointInRing(decodeRing(packed, outline.meta.decimals), lat, lon))
        inside = !inside;
  return inside;
}

/** The XYZ tile holding a point at `level`. */
function tileOf(lon, lat, level) {
  const [x, y] = mercatorUnit(lon, lat);
  const n = 2 ** level;
  return [Math.floor(x * n), Math.floor(y * n)];
}

test('the US outline holds the states, Puerto Rico and the Virgin Islands, and stops at the border', () => {
  for (const [name, lon, lat] of [
    ['Boston', -71.06, 42.36],
    ['Detroit', -83.05, 42.33],
    ['El Paso', -106.44, 31.76],
    ['Seattle', -122.33, 47.61],
    ['Anchorage', -149.9, 61.22],
    ['Honolulu', -157.86, 21.31],
    ['Caguas, Puerto Rico', -66.035, 18.234],
    ['Charlotte Amalie', -64.93, 18.34],
  ])
    assert.ok(inOutline(lon, lat), name);
  for (const [name, lon, lat] of [
    ['Windsor, Ontario', -83.02, 42.28],
    ['Ciudad Juárez', -106.45, 31.69],
    ['Tijuana', -117.04, 32.51],
    ['Vancouver', -123.12, 49.28],
    ['Toronto', -79.38, 43.65],
    ['Havana', -82.37, 23.11],
  ])
    assert.ok(!inOutline(lon, lat), name);
});

test('Web Mercator tile space: the world is one 0–1 tile, y grows southward', () => {
  assert.deepEqual(
    mercatorUnit(0, 0).map((v) => +v.toFixed(6)),
    [0.5, 0.5],
  );
  const [west] = mercatorUnit(-180, 0);
  assert.equal(west, 0);
  assert.ok(mercatorUnit(0, 60)[1] < 0.5);
  assert.ok(mercatorUnit(0, -60)[1] > 0.5);
});

test('only rings near a tile are drawn into it, in its own pixels', () => {
  const rings = projectOutline(outline);
  const [mx, my] = tileOf(-90, 40, 2);
  assert.ok(ringsForTile(rings, mx, my, 2).length > 0, 'the lower 48');
  // Mid-Atlantic, far from any US island.
  const [ax, ay] = tileOf(-35, 35, 4);
  assert.equal(ringsForTile(rings, ax, ay, 4).length, 0);
  // A ring's pixels land inside the tile that holds it.
  const [bx, by] = tileOf(-71.06, 42.36, 6);
  const near = ringsForTile(rings, bx, by, 6);
  const pixels = ringPixels(near[0], bx, by, 6, 256);
  assert.ok(pixels.some((v, i) => i % 2 === 0 && v >= 0 && v <= 256));
});

/** A canvas stand-in that records what is drawn. */
function fakeCanvasFactory(log) {
  return (width, height) => {
    const calls = [];
    log.push({ width, height, calls });
    return {
      width,
      height,
      getContext: () => ({
        drawImage: (...args) => calls.push(['drawImage', args.length]),
        beginPath: () => calls.push(['beginPath']),
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        fill: (rule) => calls.push(['fill', rule]),
        set globalCompositeOperation(value) {
          calls.push(['composite', value]);
        },
      }),
    };
  };
}

test('tiles outside the outline are never requested; border tiles are cut to it', async () => {
  const rings = projectOutline(outline);
  const requested = [];
  const provider = {
    requestImage(x, y, level) {
      requested.push([x, y, level]);
      return Promise.resolve({ width: 256, height: 256 });
    },
  };
  const canvases = [];
  maskImageryProvider(provider, Promise.resolve(rings), {
    createCanvas: fakeCanvasFactory(canvases),
  });

  // A border tile (Detroit / Windsor) is fetched, drawn, and cut even-odd.
  const [dx, dy] = tileOf(-83.05, 42.33, 8);
  const cut = await provider.requestImage(dx, dy, 8);
  assert.deepEqual(requested, [[dx, dy, 8]]);
  assert.equal(cut.width, 256);
  assert.deepEqual(
    canvases.at(-1).calls.filter(([name]) => name !== 'beginPath'),
    [
      ['drawImage', 5],
      ['composite', 'destination-in'],
      ['fill', 'evenodd'],
    ],
  );

  // Once the outline is in, a tile over Ontario's interior is blank, unasked.
  const [ox, oy] = tileOf(-85, 50, 8);
  const blank = await provider.requestImage(ox, oy, 8);
  assert.equal(blank.width, 1);
  assert.equal(requested.length, 1);
});

test('a throttled request passes straight back, and a missing outline leaves tiles uncut', async () => {
  const image = { width: 256, height: 256 };
  let throttle = true;
  const provider = {
    requestImage: () => (throttle ? undefined : Promise.resolve(image)),
  };
  maskImageryProvider(provider, Promise.reject(new Error('404')), {
    createCanvas: () => {
      throw new Error('no canvas when uncut');
    },
  });
  assert.equal(provider.requestImage(0, 0, 0), undefined);
  throttle = false;
  assert.equal(await provider.requestImage(0, 0, 0), image);
});
