#!/usr/bin/env node
/**
 * Copy each county's Local Moran's I result (2015 life expectancy) from
 * public/context/county-clusters/ onto the full county set in
 * public/context/county-life-expectancy/ (cluster, cluster_p,
 * cluster_summary), so the county cluster layer can draw every county — the
 * significant ones in cluster colors, the rest off-white — and show the
 * country's shape. Counties without a result lose any stale values.
 *
 * Run after scripts/build-context-layers.mjs. Idempotent.
 *
 *   node scripts/merge-county-clusters.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CLUSTERS = 'public/context/county-clusters';
const COUNTIES = 'public/context/county-life-expectancy';

const features = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.geojsonl'))
    .map((name) => ({
      file: path.join(dir, name),
      features: readFileSync(path.join(dir, name), 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line)),
    }));

const results = new Map();
for (const chunk of features(CLUSTERS))
  for (const { properties: p } of chunk.features)
    results.set(String(p.geoid), {
      cluster: p.cluster,
      cluster_p: p.p_value,
      cluster_summary: p.summary,
    });

let merged = 0;
let total = 0;
for (const chunk of features(COUNTIES)) {
  for (const feature of chunk.features) {
    const p = feature.properties;
    delete p.cluster;
    delete p.cluster_p;
    delete p.cluster_summary;
    const result = results.get(String(p.geoid));
    if (result) {
      Object.assign(p, result);
      merged += 1;
    }
    total += 1;
  }
  writeFileSync(
    chunk.file,
    chunk.features.map((feature) => JSON.stringify(feature)).join('\n'),
  );
}
console.log(
  `county-life-expectancy: cluster results on ${merged} of ${total} counties`,
);
