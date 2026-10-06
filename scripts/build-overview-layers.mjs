#!/usr/bin/env node
/**
 * Coarse national stand-ins for area layers whose detail only draws close in,
 * so every layer shows something over the whole country:
 *
 *  - public/context/holc-cities/: one outline per HOLC-mapped city (the convex
 *    hull of its graded areas), with the share of graded land rated D
 *    ("hazardous"), built from public/context/holc/.
 *  - public/context/parks-large/: national, federal and state parks of 1,000
 *    acres or more, simplified, built from public/context/parks/.
 *
 * Both keep the index.json + <chunk>.geojsonl layout chunkedAreaLayer reads,
 * one chunk per state. Run after the HOLC or parks layers are rebuilt.
 *
 *   node scripts/build-overview-layers.mjs
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const CONTEXT = 'public/context';
export const LARGE_PARK_KINDS = new Set([
  'national-park',
  'national-forest',
  'state-park',
  'tribal-park',
]);
export const LARGE_PARK_MIN_ACRES = 1000;
/** Acres in one square degree at the equator (111.32 km per degree). */
const SQ_DEGREE_ACRES = 111.32 * 111.32 * 247.105;

function readChunks(directory) {
  const features = [];
  for (const name of readdirSync(directory).filter((n) =>
    n.endsWith('.geojsonl'),
  )) {
    for (const line of readFileSync(path.join(directory, name), 'utf8').split(
      '\n',
    )) {
      if (line.trim())
        features.push({
          chunk: name.replace(/\.geojsonl$/, ''),
          ...JSON.parse(line),
        });
    }
  }
  return features;
}

const ringsOf = (geometry) =>
  geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];

/** Planar area of a lon/lat ring in square degrees, scaled by cos(latitude). */
export function ringArea(ring) {
  let sum = 0;
  let lat = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
    lat += y1;
  }
  return Math.abs(sum / 2) * Math.cos(((lat / ring.length) * Math.PI) / 180);
}

const polygonArea = (polygons) =>
  polygons.reduce(
    (total, [outer, ...holes]) =>
      total +
      ringArea(outer) -
      holes.reduce((h, ring) => h + ringArea(ring), 0),
    0,
  );

/** Convex hull (monotone chain) of [lon, lat] points, closed. */
export function convexHull(points) {
  const pts = [
    ...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values(),
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return null;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0)
      upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return [...hull, hull[0]];
}

/** Douglas–Peucker simplification of a ring (tolerance in degrees). */
export function simplifyRing(ring, tolerance) {
  if (ring.length <= 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const length = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      // A closed ring starts and ends on one point: measure from that point.
      const d =
        length > 0
          ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
          : Math.hypot(px - ax, py - ay);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : null;
}

const round = (ring) =>
  ring.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);

function bboxOf(features) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features)
    for (const polygon of ringsOf(feature.geometry))
      for (const [x, y] of polygon[0]) {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
  return box.map((v) => Number(v.toFixed(5)));
}

function writeChunks(directory, byChunk) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const index = [];
  for (const [id, features] of [...byChunk].sort()) {
    if (!features.length) continue;
    writeFileSync(
      path.join(directory, `${id}.geojsonl`),
      features.map((feature) => JSON.stringify(feature)).join('\n'),
    );
    index.push({ id, bbox: bboxOf(features), count: features.length });
  }
  writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index));
  return index;
}

function buildHolcCities() {
  const cities = new Map();
  for (const feature of readChunks(path.join(CONTEXT, 'holc'))) {
    const city = feature.properties?.city;
    if (!city) continue;
    const entry = cities.get(city) || {
      points: [],
      area: {},
      count: 0,
      chunk: feature.chunk,
    };
    const polygons = ringsOf(feature.geometry);
    for (const polygon of polygons) entry.points.push(...polygon[0]);
    const grade = feature.properties.holc_grade;
    if (['A', 'B', 'C', 'D'].includes(grade))
      entry.area[grade] = (entry.area[grade] || 0) + polygonArea(polygons);
    entry.count += 1;
    cities.set(city, entry);
  }
  const byState = new Map();
  for (const [city, entry] of cities) {
    const hull = convexHull(entry.points);
    if (!hull) continue;
    const graded = ['A', 'B', 'C', 'D'].reduce(
      (t, g) => t + (entry.area[g] || 0),
      0,
    );
    const share = (g) =>
      graded > 0
        ? Number(((100 * (entry.area[g] || 0)) / graded).toFixed(1))
        : null;
    const d = share('D');
    const state = city.split(', ').at(-1) || entry.chunk.split('-')[0];
    const feature = {
      type: 'Feature',
      id: `holc-city-${entry.chunk}`,
      properties: {
        name: `${city}: 1930s HOLC map`,
        city,
        areas: entry.count,
        d_share: d,
        a_share: share('A'),
        b_share: share('B'),
        c_share: share('C'),
        summary:
          `${city}: ${entry.count} areas graded on the 1930s HOLC map.` +
          (d === null
            ? ''
            : ` ${d}% of the graded land was rated D ("hazardous").`) +
          ' Zoom in to see each graded area and its 1930s description.',
      },
      geometry: { type: 'Polygon', coordinates: [round(hull)] },
    };
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push(feature);
  }
  const index = writeChunks(path.join(CONTEXT, 'holc-cities'), byState);
  console.log(
    `holc-cities: ${cities.size} cities in ${index.length} state chunks`,
  );
}

function buildLargeParks() {
  const byState = new Map();
  let kept = 0;
  for (const feature of readChunks(path.join(CONTEXT, 'parks'))) {
    const p = feature.properties || {};
    if (!LARGE_PARK_KINDS.has(p.kind)) continue;
    // TIGER's acreage is often blank; measure the outline instead.
    const acres = polygonArea(ringsOf(feature.geometry)) * SQ_DEGREE_ACRES;
    if (!(Math.max(acres, p.acres || 0) >= LARGE_PARK_MIN_ACRES)) continue;
    const polygons = ringsOf(feature.geometry)
      .map((polygon) => {
        const outer = simplifyRing(polygon[0], 0.003);
        return outer ? [round(outer)] : null;
      })
      .filter(Boolean);
    if (!polygons.length) continue;
    const { chunk, ...rest } = feature;
    const state = chunk.split('_')[0];
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push({
      ...rest,
      geometry:
        polygons.length === 1
          ? { type: 'Polygon', coordinates: polygons[0] }
          : { type: 'MultiPolygon', coordinates: polygons },
    });
    kept += 1;
  }
  const index = writeChunks(path.join(CONTEXT, 'parks-large'), byState);
  console.log(
    `parks-large: ${kept} parks of ${LARGE_PARK_MIN_ACRES}+ acres in ${index.length} state chunks`,
  );
}

if (process.argv[1]?.endsWith('build-overview-layers.mjs')) {
  buildHolcCities();
  buildLargeParks();
}
