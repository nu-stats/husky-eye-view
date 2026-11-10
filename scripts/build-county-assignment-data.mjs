#!/usr/bin/env node
/**
 * Builds the county data file for the community-context assignment:
 *   course/assignments/data/counties-over-75k.csv
 * (and data/source/census/counties-over-75k.json, the list with foreign-born counts).
 *
 * Counties kept: population above 75,000 in 2000, 2006-2010 and 2020-2024.
 * Connecticut drops out (its 2020-2024 geography is planning regions, not counties).
 *
 * Inputs (all under data/source, run these first):
 *   census/sf3-2000-counties.json     node scripts/fetch-sf3-2000-places.mjs --county
 *   census/acs2010-counties.json      node scripts/fetch-acs-2010-places.mjs --county
 *   census/acs2024_social.json        node scripts/fetch-acs-social.mjs
 *   census/foreign-born/fb*.json      node scripts/fetch-foreign-born.mjs
 *   census/sub-est2024.csv            county names
 *   nation_county_le.geojson          county life expectancy, total population, 2000-2019
 *
 * Life expectancy (total population, years) for the three periods:
 *   2000       the 2000 estimate
 *   2006-10    the mean of the 2006 to 2010 estimates
 *   2020-24    the 2019 estimate (the series ends in 2019)
 *
 *   node scripts/build-county-assignment-data.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CUT = 75000;
const SRC = 'data/source';
const read = (file) => JSON.parse(readFileSync(`${SRC}/${file}`, 'utf8'));

const c2000 = read('census/sf3-2000-counties.json').county;
const c2010 = read('census/acs2010-counties.json').county;
const c2024 = read('census/acs2024_social.json').county;
const fb = {
  2000: read('census/foreign-born/fb2000.json').county,
  '2006_10': read('census/foreign-born/fb2010.json').county,
  '2020_24': read('census/foreign-born/fb2024.json').county,
};

// County names from the Census population estimates file (summary level 050).
const names = {};
for (const line of readFileSync(`${SRC}/census/sub-est2024.csv`, 'latin1').split(/\r?\n/)) {
  if (!line.startsWith('050')) continue;
  const f = line.split(',');
  names[f[1] + f[2]] = { name: f[8], state: f[9] };
}

// Life expectancy: GEOID10 is the 2010 county code, the same as the files above.
const le = {};
const geo = JSON.parse(readFileSync(`${SRC}/nation_county_le.geojson`, 'utf8'));
for (const { properties: p } of geo.features) {
  const mean = [6, 7, 8, 9, 10].reduce((s, y) => s + p[`total_${String(y).padStart(2, '0')}`], 0) / 5;
  le[String(p.GEOID10).padStart(5, '0')] = { 2000: p.total_00, '2006_10': mean, '2020_24': p.total_19 };
}

const counties = [];
for (const id of Object.keys(c2000).sort()) {
  const pop = [c2000[id].pop, c2010[id]?.pop, c2024[id]?.pop];
  if (!pop.every((v) => v > CUT)) continue;
  counties.push({
    geoid: id,
    pop2000: pop[0],
    pop2006_10: pop[1],
    pop2020_24: pop[2],
    fb2000: fb['2000'][id]?.[1], // array index 0 is the population, 1 the foreign-born total
    fb2006_10: fb['2006_10'][id]?.[1],
    fb2020_24: fb['2020_24'][id]?.[1],
  });
}
writeFileSync(
  `${SRC}/census/counties-over-75k.json`,
  JSON.stringify({ cutoff: 'county population > 75,000 in 2000, 2006–2010 and 2020–2024', count: counties.length, counties }),
);

const quote = (s) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const one = (x) => Number(x.toFixed(1));
const header = ['county_code', 'county', 'state']; // county_code: 2-digit state + 3-digit county (FIPS)
const periods = [
  ['2000', c2000, 'pop2000', 'fb2000'],
  ['2006_10', c2010, 'pop2006_10', 'fb2006_10'],
  ['2020_24', c2024, 'pop2020_24', 'fb2020_24'],
];
for (const [p] of periods) {
  header.push(`population_${p}`, `foreign_born_count_${p}`, `foreign_born_percent_${p}`, `poverty_percent_${p}`, `unemployment_percent_${p}`, p === '2020_24' ? 'life_expectancy_2019' : `life_expectancy_${p}`);
}
const lines = [header.join(',')];
for (const r of counties) {
  const n = names[r.geoid];
  const row = [r.geoid, quote(n?.name ?? ''), quote(n?.state ?? '')];
  for (const [p, src, popKey, fbKey] of periods) {
    const s = src[r.geoid];
    row.push(r[popKey], r[fbKey], one((100 * r[fbKey]) / r[popKey]), s.pov, s.unemp, one(le[r.geoid][p]));
  }
  lines.push(row.join(','));
}
writeFileSync('course/assignments/data/counties-over-75k.csv', lines.join('\n') + '\n');
console.log(`${counties.length} counties`);
