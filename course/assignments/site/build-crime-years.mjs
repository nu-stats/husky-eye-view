#!/usr/bin/env node
/**
 * Single-year city crime rates, for the look-up step of the knowledge checks.
 *
 * The site shows pooled rates for 2006-2010 and 2020-2024 (a population-weighted average of the
 * yearly rates). A student cannot look a pooled rate up in one FBI table, so when a pooled rate is
 * hidden the page asks her for ONE year inside the period instead. This script makes those
 * single-year rates.
 *
 * The matching of our cities to the FBI table is the same as scripts/match-city-crime.mjs
 * (same normalisation, aliases and closest-population rule), so the single-year rates come from the
 * same rows as the pooled ones.
 *
 * Writes data/source/census/city-crime-years.json:
 *   { years: { "2006_10": [2006..2010], "2020_24": [2020..2024] },
 *     rates: { "<city_code>": { "<year>": { overall, violent, property } } } }
 * A year with an incomplete offense count has no rate (null), as in the pooled table.
 *
 * Run it from the repository root, after scripts/parse-ucr-city-crime.R:
 *   node course/assignments/site/build-crime-years.mjs <ucr-city.csv>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) throw new Error('Give the parsed FBI file (ucr-city.csv)');

const parseCsv = (text) => {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

// our cities
const citiesCsv = parseCsv(readFileSync('course/assignments/data/cities-over-75k.csv', 'utf8'));
const ch = citiesCsv[0];
const cities = citiesCsv.slice(1).filter((r) => r.length > 3).map((r) => ({
  code: r[0], city: r[1], state: r[2],
  pop: { 2000: +r[ch.indexOf('population_2000')], 2008: +r[ch.indexOf('population_2006_10')], 2022: +r[ch.indexOf('population_2020_24')] },
}));

// FBI rows
const fb = parseCsv(readFileSync(input, 'utf8'));
const fh = fb[0];
const F = (name) => fh.indexOf(name);
const rows = fb.slice(1).filter((r) => r.length >= fh.length).map((r) => ({
  year: +r[F('year')], state: r[F('state')], city: r[F('city')], population: +r[F('population')],
  v: ['murder', 'rape', 'robbery', 'agg'].map((k) => (r[F(k)] === '' ? null : +r[F(k)])),
  p: ['burglary', 'larceny', 'mvt'].map((k) => (r[F(k)] === '' ? null : +r[F(k)])),
}));

const norm = (s) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[.'’]/g, '').replace(/\bsaint\b/g, 'st').replace(/\bmount\b/g, 'mt').replace(/\bfort\b/g, 'ft')
    .replace(/[^a-z0-9]+/g, ' ').trim();
const stateKey = (s) => s.toLowerCase().replace(/\bof\b/g, 'of').trim();

const ALIAS = {
  'san buenaventura|california': ['Ventura'],
  'nashville davidson|tennessee': ['Nashville', 'Metropolitan Nashville Police Department'],
  'louisville jefferson county|kentucky': ['Louisville', 'Louisville Metro'],
  'charlotte|north carolina': ['Charlotte-Mecklenburg'],
  'savannah|georgia': ['Savannah-Chatham Metropolitan'],
};

const index = new Map();
for (const r of rows) {
  const k = `${r.year}|${stateKey(r.state)}`;
  if (!index.has(k)) index.set(k, new Map());
  const m = index.get(k);
  const n = norm(r.city);
  if (!m.has(n)) m.set(n, []);
  m.get(n).push(r);
}

const candidatesFor = (c) => {
  const base = norm(c.city);
  const names = new Set([base]);
  for (const part of c.city.split(/[-/]/)) names.add(norm(part));
  if (base.endsWith(' city')) names.add(base.slice(0, -5));
  for (const a of ALIAS[`${base}|${stateKey(c.state)}`] || []) names.add(norm(a));
  return [...names];
};

const matchYear = (c, year) => {
  const m = index.get(`${year}|${stateKey(c.state)}`);
  if (!m) return null;
  const target = c.pop[year <= 2000 ? 2000 : year <= 2010 ? 2008 : 2022];
  let best = null;
  for (const n of candidatesFor(c)) {
    for (const r of m.get(n) || []) {
      const d = Math.abs(r.population - target) / target;
      if (!best || d < best.d) best = { r, d };
    }
  }
  return best && best.d < 0.5 ? best.r : null;
};

const sum = (a) => (a.some((x) => x === null) ? null : a.reduce((s, x) => s + x, 0));
const years = { '2006_10': [2006, 2007, 2008, 2009, 2010], '2020_24': [2020, 2021, 2022, 2023, 2024] };
const allYears = [...years['2006_10'], ...years['2020_24']];
const rate = (n, pop) => (n === null || !pop ? null : Number(((n / pop) * 100000).toFixed(1)));

const out = { years, rates: {} };
let have = 0, want = 0;
for (const c of cities) {
  const per = {};
  for (const y of allYears) {
    want++;
    const r = matchYear(c, y);
    if (!r) continue;
    const violent = sum(r.v), property = sum(r.p);
    const overall = violent === null || property === null ? null : violent + property;
    per[y] = {
      overall: rate(overall, r.population),
      violent: rate(violent, r.population),
      property: rate(property, r.population),
    };
    if (per[y].overall !== null) have++;
  }
  out.rates[c.code] = per;
}
writeFileSync('data/source/census/city-crime-years.json', JSON.stringify(out));
console.log(`single-year overall rates: ${have} of ${want} city-years (${cities.length} cities, ${allYears.length} years)`);
