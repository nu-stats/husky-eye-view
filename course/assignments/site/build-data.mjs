#!/usr/bin/env node
/**
 * Makes the two small JSON files the site reads (site/data/cities.json and site/data/groups.json).
 *
 * Usage, from the repository root:
 *   node scripts/build-city-assignment-data.mjs <folder>        (writes the three group-*.tsv files)
 *   node course/assignments/site/build-data.mjs <folder>
 *
 * It reads the three group tables in <folder> and the course city file
 * (course/assignments/data/cities-over-75k.csv). It writes nothing else.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = process.argv[2];
// With no folder, only data/cities.json is rebuilt (groups.json is kept as it is).
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'data');
mkdirSync(out, { recursive: true });

const periods = ['2000', '2006_10', '2020_24'];
const variables = [
  'population', 'foreign_born_percent', 'poverty_percent', 'unemployment_percent',
  // reported crimes per 100,000 residents (FBI), blank where the city has no value
  'overall_crime_rate', 'violent_crime_rate', 'property_crime_rate',
];

// ---- cities ----
function splitCsv(line) {
  const cells = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}
const csv = readFileSync(join(here, '..', 'data', 'cities-over-75k.csv'), 'utf8').trim().split(/\r?\n/);
const head = splitCsv(csv[0]);
const rows = csv.slice(1).map(splitCsv);
const col = (name) => head.indexOf(name);
const num = (s) => (s === '' || s === undefined ? null : Number(s));
const cities = {
  code: rows.map((r) => r[col('city_code')]),
  city: rows.map((r) => r[col('city')]),
  state: rows.map((r) => r[col('state')]),
  values: {},
};
for (const p of periods) {
  cities.values[p] = {};
  for (const v of variables) cities.values[p][v] = rows.map((r) => num(r[col(`${v}_${p}`)]));
}
// ---- five more indicators (median income, bachelor's, renters, Black, Hispanic) ----
// Census 2000 and ACS 2006-2010 come from site/fetch/*.mjs; ACS 2020-2024 from scripts/fetch-acs-social.mjs.
// All five come from the same Census tables in every period. black_percent is Black alone, not Hispanic.
const census = join(here, '..', '..', '..', 'data', 'source', 'census');
const extraFiles = { '2000': 'sf3-2000-places-extra.json', '2006_10': 'acs2010-places-extra.json', '2020_24': 'acs2024_social.json' };
const extraKeys = {
  median_household_income: 'inc',
  bachelors_percent: 'ba',
  renter_percent: 'rent',
  black_percent: 'blk',
  hispanic_percent: 'hisp',
};
for (const p of periods) {
  const place = JSON.parse(readFileSync(join(census, extraFiles[p]), 'utf8')).place;
  for (const [name, key] of Object.entries(extraKeys)) {
    cities.values[p][name] = cities.code.map((id) => place[id]?.[key] ?? null);
  }
}
// ---- single-year crime rates (for the look-up step of the knowledge checks) ----
// The pooled rates (2006-2010, 2020-2024) are population-weighted averages of the yearly rates, so a
// student cannot look one up in a single FBI table. When a pooled rate is hidden the page asks her for
// one year inside the period, from these. Built by build-crime-years.mjs; a year with an incomplete
// offense count is null, as in the pooled rates.
{
  const file = join(census, 'city-crime-years.json');
  const yearly = JSON.parse(readFileSync(file, 'utf8'));
  cities.crime_years = yearly.years;
  cities.year_values = {};
  for (const y of Object.values(yearly.years).flat()) {
    cities.year_values[y] = {};
    for (const [name, key] of [['overall_crime_rate', 'overall'], ['violent_crime_rate', 'violent'], ['property_crime_rate', 'property']]) {
      cities.year_values[y][name] = cities.code.map((id) => yearly.rates[id]?.[y]?.[key] ?? null);
    }
  }
}
writeFileSync(join(out, 'cities.json'), JSON.stringify(cities));

if (!folder) {
  console.log(`${cities.code.length} cities written to ${out} (groups.json kept)`);
  process.exit(0);
}

// ---- groups ----
const groups = { names: [], size: {}, us: {} };
for (const p of periods) {
  const lines = readFileSync(join(folder, `group-${p}.tsv`), 'utf8').trim().split(/\r?\n/).map((l) => l.split('\t'));
  const names = lines[0].slice(1);
  if (!groups.names.length) groups.names = names;
  else if (names.join('|') !== groups.names.join('|')) throw new Error(`group names differ in ${p}`);
  const body = lines.slice(1);
  const us = body.pop();
  if (us[0] !== 'US') throw new Error('last row should be US');
  if (body.map((r) => r[0]).join() !== cities.code.join()) throw new Error(`city codes differ in ${p}`);
  // size[p][g] = one number per city
  groups.size[p] = names.map((_, g) => body.map((r) => Number(r[g + 1])));
  groups.us[p] = us.slice(1).map(Number);
}
writeFileSync(join(out, 'groups.json'), JSON.stringify(groups));
console.log(`${cities.code.length} cities, ${groups.names.length} groups written to ${out}`);
