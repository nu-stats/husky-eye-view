#!/usr/bin/env node
/**
 * Give the county layers shoreline-clipped outlines, so the Great Lakes and
 * coastal waters show cleanly instead of being tinted by county areas that
 * extend into the water.
 *
 * Source: U.S. Census Bureau cartographic boundary file (1:500,000), counties,
 * 2024 — the same family as the 2020 tract outlines (cb_2024_us_tract_500k):
 *   https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip
 * (downloaded to data/source/census/, not in git).
 *
 * Replaces the geometry of every feature (matched by 5-digit county GEOID) in
 * public/context/county-life-expectancy/ and public/context/county-clusters/,
 * keeping all properties, and rewrites each index.json bbox. Idempotent.
 *
 *   node scripts/clip-county-shorelines.mjs
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { readShapefile } from './lib/shapefile.mjs';
import { readZip } from './fetch-acs-internet-2017.mjs';
import { simplifyRing } from './build-overview-layers.mjs';

const URL_ZIP =
  'https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip';
const DIR = 'data/source/census/cb_2024_us_county_500k';
const BASE = `${DIR}/cb_2024_us_county_500k`;
const LAYERS = ['county-life-expectancy', 'county-clusters'];
/** ~100 m: plenty for counties seen from a national or state view. */
const TOLERANCE_DEG = 0.001;

async function ensureSource() {
  if (existsSync(`${BASE}.shp`)) return;
  mkdirSync(DIR, { recursive: true });
  const response = await fetch(URL_ZIP);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${URL_ZIP}`);
  const files = readZip(Buffer.from(await response.arrayBuffer()));
  for (const [name, data] of Object.entries(files))
    writeFileSync(path.join(DIR, path.basename(name)), data);
  console.log(`downloaded ${Object.keys(files).length} files to ${DIR}`);
}

const round = (ring) =>
  ring.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);

function clean(geometry) {
  const polygons = (
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : []
  )
    .map((rings) => {
      const outer = simplifyRing(rings[0], TOLERANCE_DEG) || rings[0];
      if (outer.length < 4) return null;
      return [
        round(outer),
        ...rings
          .slice(1)
          .map((ring) => simplifyRing(ring, TOLERANCE_DEG))
          .filter(Boolean)
          .map(round),
      ];
    })
    .filter(Boolean);
  if (!polygons.length) return null;
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function bboxOf(features) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { geometry } of features) {
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.coordinates;
    for (const polygon of polygons)
      for (const [x, y] of polygon[0]) {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
  }
  return box.map((v) => Number(v.toFixed(6)));
}

async function main() {
  await ensureSource();
  const outlines = new Map();
  for (const { properties: p, geometry } of readShapefile(BASE)) {
    const clipped = geometry && clean(geometry);
    if (clipped) outlines.set(String(p.GEOID), clipped);
  }
  console.log(`cartographic outlines: ${outlines.size} counties`);
  for (const layer of LAYERS) {
    const dir = path.join('public/context', layer);
    const index = JSON.parse(
      readFileSync(path.join(dir, 'index.json'), 'utf8'),
    );
    let replaced = 0;
    let kept = 0;
    for (const entry of index) {
      const file = path.join(dir, `${entry.id}.geojsonl`);
      const features = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      for (const feature of features) {
        const outline = outlines.get(String(feature.properties?.geoid));
        if (outline) {
          feature.geometry = outline;
          replaced += 1;
        } else kept += 1;
      }
      writeFileSync(file, features.map((f) => JSON.stringify(f)).join('\n'));
      entry.bbox = bboxOf(features);
    }
    writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
    console.log(
      `${layer}: ${replaced} outlines clipped to the shoreline, ${kept} unchanged`,
    );
  }
}

if (process.argv[1]?.endsWith('clip-county-shorelines.mjs')) await main();
