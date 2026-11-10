#!/usr/bin/env node
/**
 * Data for the community-context assignment, at the city (incorporated place) level.
 *
 * Cities kept: population above 75,000 in 2000, 2006-2010 and 2020-2024
 * (data/source/census/places-over-75k.json).
 *
 * Writes:
 *   course/assignments/data/cities-over-75k.csv   one row per city: population, foreign-born
 *                                                 count and percent, poverty percent and
 *                                                 unemployment percent for the three periods
 *   <folder>/group-2000.tsv, group-2006_10.tsv, group-2020_24.tsv
 *                                                 for the workbook: for each city, the number of
 *                                                 residents born in each country the Census Bureau
 *                                                 reports the same way in all three periods
 *                                                 ("Other ..." leftovers left out); last row "US"
 *
 * Run these first (all write under data/source/census):
 *   node scripts/fetch-sf3-2000-places.mjs
 *   node scripts/fetch-acs-2010-places.mjs
 *   node scripts/fetch-acs-social.mjs
 *   node scripts/fetch-foreign-born.mjs                (state totals by country, for the "US" row)
 *   node scripts/fetch-foreign-born-places.mjs
 *
 *   node scripts/build-city-assignment-data.mjs <folder for the group tables>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const folder = process.argv[2];
if (!folder) throw new Error('Give a folder for the group tables');
mkdirSync(folder, { recursive: true });

const SRC = 'data/source/census';
const read = (f) => JSON.parse(readFileSync(`${SRC}/${f}`, 'utf8'));

const allPlaces = read('places-over-75k.json').places.map((p) => p.geoid).sort();
const p2000 = read('sf3-2000-places.json').place;
const p2010 = read('acs2010-places.json').place;
const p2024 = read('acs2024_social.json').place;
const fbTotal = read('foreign-born-places.json').place;
const groupsRaw = read('foreign-born-place-groups.json').place;

// City names from the Census population estimates file (summary level 162, incorporated places).
const names = {};
for (const line of readFileSync(`${SRC}/sub-est2024.csv`, 'latin1').split(/\r?\n/)) {
  if (!line.startsWith('162')) continue;
  const f = line.split(',');
  names[f[1] + f[3]] = { name: f[8], state: f[9] };
}
// Only incorporated places are cities. Census-designated places (unincorporated areas such as
// Paradise, NV or Metairie, LA) are not in the summary level 162 file, so they are left out here.
const cities = allPlaces.filter((id) => names[id]);
console.log(`left out as not incorporated: ${allPlaces.length - cities.length} (${allPlaces.filter((id) => !names[id]).join(' ')})`);
const plain = (n) =>
  n
    .replace(/ \(balance\)$/, '')
    .replace(/ (city and borough|metropolitan government|metro government|consolidated government|unified government|urban county|municipality|borough|town|village|city|CDP)$/, '');

const periods = [
  ['2000', p2000, 'fb2000'],
  ['2006_10', p2010, 'fb2006_10'],
  ['2020_24', p2024, 'fb2020_24'],
];

// ---- the city file ----
const quote = (s) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const one = (x) => Number(x.toFixed(1));
const header = ['city_code', 'city', 'state'];
for (const [p] of periods) {
  header.push(`population_${p}`, `foreign_born_count_${p}`, `foreign_born_percent_${p}`, `poverty_percent_${p}`, `unemployment_percent_${p}`);
}
const lines = [header.join(',')];
const missing = [];
for (const id of cities) {
  const n = names[id];
  if (!n) throw new Error(`no name for ${id}`);
  const row = [id, quote(plain(n.name)), quote(n.state)];
  for (const [p, src, key] of periods) {
    const s = src[id];
    const fb = fbTotal[id]?.[key];
    if (s?.pop == null || fb == null || s.pov == null || s.unemp == null) missing.push(`${id}:${p}`);
    row.push(s?.pop, fb, one((100 * fb) / s?.pop), s?.pov, s?.unemp);
  }
  lines.push(row.join(','));
}
writeFileSync('course/assignments/data/cities-over-75k.csv', lines.join('\n') + '\n');
console.log(`${cities.length} cities; missing values: ${missing.length}${missing.length ? ' ' + missing.slice(0, 12).join(' ') : ''}`);

// ---- group tables ----
const leaf = (s) => s.split('!!').pop();
const cellFiles = { 2000: 'foreign-born/fb2000.json', '2006_10': 'foreign-born/fb2010.json', '2020_24': 'foreign-born/fb2024.json' };
const meta = {};
for (const [p, file] of Object.entries(cellFiles)) {
  const j = read(file);
  const index = new Map();
  j.cells.forEach((c, i) => {
    if (c.split('!!').length >= 4) index.set(leaf(c), i); // a country or named region, not a continent total
  });
  meta[p] = { index, states: Object.values(j.state) };
}
// A group needs more than MIN_GROUP_2000 members in the United States in 2000.
const MIN_GROUP_2000 = 75000;
const usTotal2000 = (g) => meta['2000'].states.reduce((s, v) => s + v[meta['2000'].index.get(g) + 1], 0);
const groups = [...meta['2000'].index.keys()].filter(
  (g) => !g.startsWith('Other') && Object.values(meta).every((m) => m.index.has(g)) && usTotal2000(g) > MIN_GROUP_2000,
);
const key = { 2000: 'fb2000', '2006_10': 'fb2006_10', '2020_24': 'fb2020_24' };
for (const p of Object.keys(cellFiles)) {
  const { index, states } = meta[p];
  const out = [['city_code', ...groups].join('\t')];
  for (const id of cities) out.push([id, ...groups.map((g) => groupsRaw[id][key[p]][index.get(g)])].join('\t'));
  // state arrays start with the population, so the cell at position i is at i + 1
  out.push(['US', ...groups.map((g) => states.reduce((s, v) => s + v[index.get(g) + 1], 0))].join('\t'));
  writeFileSync(`${folder}/group-${p}.tsv`, out.join('\n') + '\n');
}
console.log(`${groups.length} groups`);

// Share of the U.S. foreign-born population living in these cities, for the assignment text.
for (const [p, file] of [['2000', 'foreign-born/fb2000.json'], ['2006_10', 'foreign-born/fb2010.json'], ['2020_24', 'foreign-born/fb2024.json']]) {
  const us = Object.values(read(file).state).reduce((s, v) => s + v[1], 0);
  const inCities = cities.reduce((s, id) => s + fbTotal[id][key[p]], 0);
  console.log(`foreign-born in these cities ${p}: ${((100 * inCities) / us).toFixed(1)}% of ${us}`);
}
