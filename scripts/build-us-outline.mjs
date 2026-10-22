// Build src/data/local_data/natural_earth/us_outline.json: the outline of
// the United States (with Alaska and Hawaii), Puerto Rico and the US Virgin
// Islands, taken from the bundled Natural Earth admin-0 countries
// (countries.json, public domain, already curated to about 1 km). The night
// lights layer cuts its tiles to it, so the imagery stops at the border.
//
// Usage: node scripts/build-us-outline.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(
  ROOT,
  'src/data/local_data/natural_earth/countries.json',
);
const OUTPUT = path.join(
  ROOT,
  'src/data/local_data/natural_earth/us_outline.json',
);
/** ISO codes kept: the 50 states, Puerto Rico, the US Virgin Islands. */
const KEEP = ['USA', 'PRI', 'VIR'];

const countries = JSON.parse(readFileSync(SOURCE, 'utf8'));
const decimals = countries.meta?.decimals;
if (!Number.isInteger(decimals))
  throw new Error('countries.json has no meta.decimals');
const features = KEEP.map((iso) => {
  const feature = countries.features.find((f) => f.iso === iso);
  if (!feature) throw new Error(`countries.json has no ${iso}`);
  return feature;
});

const outline = {
  meta: {
    title: 'United States, Puerto Rico and US Virgin Islands outline',
    source: 'src/data/local_data/natural_earth/countries.json',
    sourceUrl: countries.meta.url,
    license: countries.meta.license,
    built: 'node scripts/build-us-outline.mjs',
    decimals,
    format:
      'polygons: [polygon][ring] of packed integers in 10^-decimals degrees, first vertex absolute, then deltas (decodeRing in src/data/adminBoundaries.js); rings after the first are holes',
  },
  polygons: features.flatMap((feature) => feature.polygons),
};
writeFileSync(OUTPUT, `${JSON.stringify(outline)}\n`);

let vertices = 0;
for (const polygon of outline.polygons)
  for (const ring of polygon) vertices += ring.length / 2;
console.log(
  `Wrote ${path.relative(ROOT, OUTPUT)}: ${outline.polygons.length} polygons, ${vertices} vertices.`,
);
