#!/usr/bin/env node
/**
 * Matches the FBI city crime tables (made by scripts/parse-ucr-city-crime.R) to the cities in the
 * community-context assignment and computes crime rates per 100,000 residents:
 *   overall = violent + property, violent = murder + rape + robbery + aggravated assault,
 *   property = burglary + larceny-theft + motor vehicle theft (arson is not counted).
 * A city-year has a rate only if every offense in the group was reported (the FBI leaves some blank,
 * e.g. Chicago's rape counts before 2013, so those rates stay blank).
 * Periods: 2000 (one year); 2006-2010 and 2020-2024 pooled as a population-weighted average of the
 * yearly rates (the same as total offenses / total population, times 100,000), over years with data.
 *
 * Writes data/source/census/city-crime.json:
 *   { "<city_code>": { overall_crime_rate_2000, violent_crime_rate_2000, property_crime_rate_2000,
 *                      ... _2006_10, ... _2020_24, crime_years_2006_10, crime_years_2020_24 } }
 *
 *   node scripts/match-city-crime.mjs <ucr-city.csv>
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

// aliases: our normalized name + state -> FBI normalized names to try (extend after looking at the unmatched list)
const ALIAS = {
  'san buenaventura|california': ['Ventura'],
  'nashville davidson|tennessee': ['Nashville', 'Metropolitan Nashville Police Department'],
  'louisville jefferson county|kentucky': ['Louisville', 'Louisville Metro'],
  'charlotte|north carolina': ['Charlotte-Mecklenburg'],
  'savannah|georgia': ['Savannah-Chatham Metropolitan'],
};

// index FBI rows by state and normalized name, per year
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
  // Census writes "Boise City" and "West Valley City"; the FBI table says "Boise" and "West Valley"
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
      // choose the row whose population is closest to the Census population
      const d = Math.abs(r.population - target) / target;
      if (!best || d < best.d) best = { r, d };
    }
  }
  return best && best.d < 0.5 ? best.r : null;
};

const sum = (a) => (a.some((x) => x === null) ? null : a.reduce((s, x) => s + x, 0));
const result = {};
const unmatched = {};
for (const c of cities) {
  const out = {};
  const perYear = {};
  for (const y of [2000, 2006, 2007, 2008, 2009, 2010, 2020, 2021, 2022, 2023, 2024]) {
    const r = matchYear(c, y);
    if (!r) { (unmatched[`${c.city}, ${c.state}`] ||= []).push(y); continue; }
    const violent = sum(r.v), property = sum(r.p);
    perYear[y] = { pop: r.population, violent, property, overall: violent === null || property === null ? null : violent + property };
  }
  const rate = (years, key) => {
    const ok = years.filter((y) => perYear[y] && perYear[y][key] !== null && perYear[y].pop > 0);
    if (!ok.length) return null;
    // population-weighted average of the yearly rates = total offenses / total population
    const w = ok.reduce((s, y) => s + perYear[y].pop, 0);
    const x = ok.reduce((s, y) => s + (perYear[y][key] / perYear[y].pop) * 100000 * perYear[y].pop, 0);
    return { value: Number((x / w).toFixed(1)), n: ok.length };
  };
  const periods = { '2000': [2000], '2006_10': [2006, 2007, 2008, 2009, 2010], '2020_24': [2020, 2021, 2022, 2023, 2024] };
  for (const [p, years] of Object.entries(periods)) {
    for (const [name, key] of [['overall', 'overall'], ['violent', 'violent'], ['property', 'property']]) {
      const r = rate(years, key);
      out[`${name}_crime_rate_${p}`] = r ? r.value : null;
    }
    if (p !== '2000') out[`crime_years_${p}`] = Math.min(...['overall', 'violent', 'property'].map((k) => (rate(years, k) || { n: 0 }).n));
  }
  result[c.code] = out;
}
writeFileSync('data/source/census/city-crime.json', JSON.stringify(result));

// diagnostics: a city-year without a rate is either not in the FBI table or incomplete (a blank offense count)
{
  const periodsDiag = { 2000: [2000], '2006-2010': [2006, 2007, 2008, 2009, 2010], '2020-2024': [2020, 2021, 2022, 2023, 2024] };
  for (const [label, years] of Object.entries(periodsDiag)) {
    let notIn = 0, incomplete = 0, ok = 0;
    for (const c of cities) {
      let any = false, anyIn = false;
      for (const y of years) {
        const r = matchYear(c, y);
        if (r) { anyIn = true; if (sum(r.v) !== null && sum(r.p) !== null) any = true; }
      }
      if (any) ok++; else if (anyIn) incomplete++; else notIn++;
    }
    console.log(`${label}: rate for ${ok} cities; in the table but incomplete ${incomplete}; not in the table ${notIn}`);
  }
}
const never = Object.entries(unmatched).filter(([, ys]) => ys.length >= 8);
const some = Object.entries(unmatched).filter(([, ys]) => ys.length < 8 && ys.length > 0);
console.log(`cities: ${cities.length}`);
for (const p of ['2000', '2006_10', '2020_24']) {
  const have = cities.filter((c) => result[c.code][`overall_crime_rate_${p}`] !== null).length;
  console.log(`overall rate available ${p}: ${have} of ${cities.length}`);
}
console.log(`not found in most years (${never.length}): ${never.map(([n]) => n).join('; ')}`);
console.log(`missing in some years (${some.length}): ${some.slice(0, 40).map(([n, ys]) => `${n} [${ys.join(',')}]`).join('; ')}`);
