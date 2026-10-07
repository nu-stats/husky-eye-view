#!/usr/bin/env node
/**
 * Foreign-born residents by census tract and county for 2000, 2006–2010 and
 * 2020–2024: the share of residents born outside the United States, and the
 * eight largest countries of birth in each area, each as a share of ALL
 * residents. Values are added to the shared area chunks the map already
 * draws (no outlines are duplicated):
 *
 *  - public/context/tracts-2020/*.geojsonl gains fb00, fb10, fb24 (percent)
 *    and fbt00, fbt10, fbt24 (the top eight, "country:percent,…", countries
 *    by index into src/data/foreignBornCountries.js).
 *  - public/context/county-life-expectancy/*.geojsonl gains the same keys
 *    from the county tables (also the tract layer's view from far out).
 *
 * Sources (scripts/fetch-foreign-born.mjs, data/source/census/foreign-born/):
 * Census 2000 SF3 PCT019 and P001; ACS 2006–2010 and 2020–2024 5-year B05006
 * and B01003. 2000 tracts are moved onto 2010 tracts with the Census 2010
 * tract relationship file (by 2010 population in each part), and 2010 tracts
 * onto 2020 tracts with the 2020 relationship file (by land area).
 *
 *   node scripts/build-foreign-born-layers.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = 'data/source/census/foreign-born';
const COUNTRIES_MODULE = 'src/data/foreignBornCountries.js';
export const FB_YEARS = Object.freeze([
  { key: '00', file: 'fb2000.json' },
  { key: '10', file: 'fb2010.json' },
  { key: '24', file: 'fb2024.json' },
]);
export const TOP_GROUPS = 8;

/** Region and subregion headings in the place-of-birth tables. */
const REGIONS = new Set([
  'Europe',
  'Northern Europe',
  'Western Europe',
  'Southern Europe',
  'Eastern Europe',
  'Asia',
  'Eastern Asia',
  'South Central Asia',
  'South Eastern Asia',
  'Western Asia',
  'Africa',
  'Eastern Africa',
  'Middle Africa',
  'Northern Africa',
  'Southern Africa',
  'Western Africa',
  'Oceania',
  'Australia and New Zealand Subregion',
  'Americas',
  'Latin America',
  'Caribbean',
  'Central America',
  'South America',
  'Northern America',
]);
const RESIDUAL = /^Other\b|n\.e\.c\.|not specified|^Born at sea|, other$/i;
/** Older names, so one country reads the same in every year. */
const NAME_ALIASES = Object.freeze({
  'Cape Verde': 'Cabo Verde',
  Macedonia: 'North Macedonia',
});

/** "United Kingdom (inc. Crown Dependencies)" -> "United Kingdom". */
export const countryName = (label) => {
  const name = label
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return NAME_ALIASES[name] || name;
};

/**
 * The country cells of a place-of-birth table: the first heading under the
 * region / subregion levels, skipping residual lines ("Other …", "n.e.c.").
 * Sub-country lines (England, Hong Kong under China, …) count in their
 * country. Returns [{cell, name}] with cell = 0-based index into the cells.
 */
export function countryCells(labels) {
  const out = [];
  const paths = labels.map((label) => label.split('!!').map((s) => s.trim()));
  // An "Other …" line with lines under it is a heading too (Census 2000 lists
  // Costa Rica … Panama under "Other Central America").
  const parents = new Set(paths.map((parts) => parts.slice(0, -1).join('!!')));
  const heading = (parts, depth) =>
    REGIONS.has(parts[depth]) ||
    (/^Other\b/.test(parts[depth]) &&
      parents.has(parts.slice(0, depth + 1).join('!!')));
  paths.forEach((parts, cell) => {
    if (parts[0] !== 'Total') return;
    let depth = 1;
    while (depth < parts.length && heading(parts, depth)) depth += 1;
    if (depth !== parts.length - 1) return;
    const name = countryName(parts[depth]);
    if (!name || RESIDUAL.test(name)) return;
    out.push({ cell, name });
  });
  return out;
}

/**
 * Move area vectors onto other areas by weighted parts: parts are
 * {from, to, weight}; each source's weights are normalized to sum to 1
 * (equal shares when they are all zero).
 */
export function apportion(parts, values) {
  const totals = new Map();
  const counts = new Map();
  for (const part of parts) {
    if (!values[part.from]) continue;
    totals.set(part.from, (totals.get(part.from) || 0) + part.weight);
    counts.set(part.from, (counts.get(part.from) || 0) + 1);
  }
  const out = {};
  for (const part of parts) {
    const source = values[part.from];
    if (!source) continue;
    const total = totals.get(part.from);
    const share = total > 0 ? part.weight / total : 1 / counts.get(part.from);
    if (!(share > 0)) continue;
    const target = (out[part.to] ||= new Array(source.length).fill(0));
    for (let i = 0; i < source.length; i++) target[i] += source[i] * share;
  }
  return out;
}

/** 2000 -> 2010 tract parts from us2010trf.txt (2010 population in each part). */
export function parts2000to2010(text) {
  const parts = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const f = line.split(',');
    // GEOID00 (3), GEOID10 (12), AREALANDPT (19), POP10PT (24): the 2010
    // population living in the part.
    parts.push({
      from: f[3],
      to: f[12],
      weight: Number(f[24]) || 0,
      land: Number(f[19]) || 0,
    });
  }
  // Parts of an unpopulated 2000 tract split by land area instead.
  const populated = new Set(
    parts.filter((p) => p.weight > 0).map((p) => p.from),
  );
  return parts.map((p) =>
    populated.has(p.from) ? p : { ...p, weight: p.land },
  );
}

/** 2010 -> 2020 tract parts from tab20_tract20_tract10_natl.txt (land area). */
export function parts2010to2020(text) {
  const lines = text.split(/\r?\n/);
  const head = lines[0].replace(/^﻿/, '').split('|');
  const col = (name) => head.indexOf(name);
  const [to, from, land, water] = [
    'GEOID_TRACT_20',
    'GEOID_TRACT_10',
    'AREALAND_PART',
    'AREAWATER_PART',
  ].map(col);
  const parts = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const f = line.split('|');
    parts.push({
      from: f[from],
      to: f[to],
      weight: Number(f[land]) || 0,
      water: Number(f[water]) || 0,
    });
  }
  const landed = new Set(parts.filter((p) => p.weight > 0).map((p) => p.from));
  return parts.map((p) => (landed.has(p.from) ? p : { ...p, weight: p.water }));
}

/**
 * {share, top} for one area vector [population, foreignBorn, cell2, …]:
 * share = foreign-born % of residents; top = the largest countries of birth
 * as "index:percent" pairs (percent of all residents, one decimal).
 */
export function areaValues(vector, countries, indexOf, minPopulation = 20) {
  const population = vector?.[0] || 0;
  if (!(population >= minPopulation)) return null;
  const foreignBorn = vector[1] || 0;
  const share = Number(((100 * foreignBorn) / population).toFixed(1));
  const top = countries
    .map(({ cell, name }) => ({ name, count: vector[cell + 1] || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_GROUPS)
    .map((c) => ({
      i: indexOf(c.name),
      pct: Number(((100 * c.count) / population).toFixed(1)),
    }))
    .filter((c) => c.pct > 0);
  return {
    share,
    top: top.map((c) => `${c.i}:${c.pct}`).join(','),
    // Counts (re-apportioned tracts are fractional): for ranking by size.
    population: Math.round(population),
    foreignBorn: Math.round(foreignBorn),
  };
}

function rewriteChunks(directory, update) {
  let touched = 0;
  for (const name of readdirSync(directory).filter((n) =>
    n.endsWith('.geojsonl'),
  )) {
    const file = path.join(directory, name);
    const lines = readFileSync(file, 'utf8').split('\n');
    let changed = false;
    const next = lines.map((line) => {
      if (!line.trim()) return line;
      const feature = JSON.parse(line);
      if (update(feature.properties)) {
        changed = true;
        touched += 1;
      }
      return JSON.stringify(feature);
    });
    if (changed) writeFileSync(file, next.join('\n'));
  }
  return touched;
}

// Connecticut's 2022 planning regions replaced its counties: the 2024 tract
// outlines and ACS 2020–2024 use the new county codes, earlier files the old
// ones, while the six-digit tract codes stayed the same.
const ctKey = (geoid) => `09${geoid.slice(5)}`;
/** County codes that changed between vintages (the chunks use the left one). */
const COUNTY_ALIASES = {
  46102: ['46113'],
  46113: ['46102'],
  '02158': ['02270'],
  '02270': ['02158'],
  '02261': ['02063', '02066'],
};

function main() {
  const data = Object.fromEntries(
    FB_YEARS.map((year) => [
      year.key,
      JSON.parse(readFileSync(`${DIR}/${year.file}`, 'utf8')),
    ]),
  );
  // Vector layout: [population, table cell 0 (all foreign-born), cell 1, …],
  // so a country's count sits at vector[cell + 1].
  const countries = Object.fromEntries(
    FB_YEARS.map((year) => [year.key, countryCells(data[year.key].cells)]),
  );

  // One list of country names, largest first nationally in 2020–2024.
  const national = new Map();
  for (const year of [...FB_YEARS].reverse()) {
    const us = Object.values(data[year.key].state).reduce((sum, v) => {
      v.forEach((n, i) => (sum[i] = (sum[i] || 0) + n));
      return sum;
    }, []);
    for (const { cell, name } of countries[year.key])
      if (!national.has(name))
        national.set(
          name,
          (us[cell + 1] || 0) * (year.key === '24' ? 1 : 1e-6),
        );
  }
  const names = [...national.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  const indexOf = (name) => names.indexOf(name);
  writeFileSync(
    COUNTRIES_MODULE,
    `// Generated by scripts/build-foreign-born-layers.mjs — do not edit.\n// Countries of birth in Census 2000 SF3 PCT019 and ACS B05006 (2006–2010,\n// 2020–2024), largest US foreign-born population first (2020–2024). The\n// foreign-born layers store each area's top countries as indexes into this list.\nexport const FOREIGN_BORN_COUNTRIES = Object.freeze([\n${names.map((name) => `  '${name.replace(/'/g, "\\'")}',`).join('\n')}\n]);\n`,
  );

  // Tracts on 2020 outlines.
  const rel2010 = parts2010to2020(
    readFileSync(`${DIR}/tab20_tract20_tract10_natl.txt`, 'utf8'),
  );
  const rel2000 = parts2000to2010(readFileSync(`${DIR}/us2010trf.txt`, 'utf8'));
  const on2020 = {
    24: data['24'].tract,
    10: apportion(rel2010, data['10'].tract),
    '00': apportion(rel2010, apportion(rel2000, data['00'].tract)),
  };
  // Connecticut lookups by state + tract code, where that pair is unique.
  const ctIndex = {};
  for (const key of ['00', '10', '24']) {
    const index = new Map();
    for (const [geoid, vector] of Object.entries(on2020[key])) {
      if (!geoid.startsWith('09')) continue;
      const k = ctKey(geoid);
      index.set(k, index.has(k) ? null : vector);
    }
    ctIndex[key] = index;
  }
  const tractVector = (key, geoid) =>
    on2020[key][geoid] ||
    (geoid.startsWith('09') ? ctIndex[key].get(ctKey(geoid)) : null) ||
    null;

  // fb / fbt for the map and cards; pop / fbn (residents, foreign-born
  // residents) for reports — every year on counties, 2020–24 on tracts.
  const KEYS = FB_YEARS.flatMap((y) => [
    `fb${y.key}`,
    `fbt${y.key}`,
    `pop${y.key}`,
    `fbn${y.key}`,
  ]);
  const counts = { tracts: 0, '00': 0, 10: 0, 24: 0 };
  // ACS 2020–2024 tracts summed into Connecticut's old counties.
  const ctCounties = {};
  const oldCounty = new Map(
    rel2010
      .filter((p) => p.to.startsWith('09'))
      .map((p) => [ctKey(p.to), p.to.slice(0, 5)]),
  );
  for (const [geoid, vector] of Object.entries(data['24'].tract)) {
    if (!geoid.startsWith('09')) continue;
    const county = oldCounty.get(ctKey(geoid));
    if (!county) continue;
    const sum = (ctCounties[county] ||= new Array(vector.length).fill(0));
    vector.forEach((n, i) => (sum[i] += n));
  }

  counts.tracts = rewriteChunks('public/context/tracts-2020', (p) => {
    for (const key of KEYS) delete p[key];
    const geoid = String(p.geoid);
    let any = false;
    for (const year of FB_YEARS) {
      const values = areaValues(
        tractVector(year.key, geoid),
        countries[year.key],
        indexOf,
      );
      if (!values) continue;
      p[`fb${year.key}`] = values.share;
      if (values.top) p[`fbt${year.key}`] = values.top;
      if (year.key === '24') {
        p.pop24 = values.population;
        p.fbn24 = values.foreignBorn;
      }
      counts[year.key] += 1;
      any = true;
    }
    return any;
  });
  console.log(
    `tracts-2020: foreign-born on ${counts.tracts} tracts (2000 ${counts['00']}, 2006–10 ${counts[10]}, 2020–24 ${counts[24]})`,
  );

  const countyVector = (key, geoid) => {
    const table = data[key].county;
    if (key === '24' && geoid.startsWith('09') && ctCounties[geoid])
      return ctCounties[geoid];
    if (table[geoid]) return table[geoid];
    const aliases = COUNTY_ALIASES[geoid]?.map((g) => table[g]).filter(Boolean);
    if (!aliases?.length) return null;
    return aliases.reduce((sum, v) => sum.map((n, i) => n + v[i]));
  };
  const countyCounts = { '00': 0, 10: 0, 24: 0 };
  const countiesTouched = rewriteChunks(
    'public/context/county-life-expectancy',
    (p) => {
      for (const key of KEYS) delete p[key];
      const geoid = String(p.geoid);
      let any = false;
      for (const year of FB_YEARS) {
        const values = areaValues(
          countyVector(year.key, geoid),
          countries[year.key],
          indexOf,
        );
        if (!values) continue;
        p[`fb${year.key}`] = values.share;
        if (values.top) p[`fbt${year.key}`] = values.top;
        p[`pop${year.key}`] = values.population;
        p[`fbn${year.key}`] = values.foreignBorn;
        countyCounts[year.key] += 1;
        any = true;
      }
      return any;
    },
  );
  console.log(
    `counties: foreign-born on ${countiesTouched} counties (2000 ${countyCounts['00']}, 2006–10 ${countyCounts[10]}, 2020–24 ${countyCounts[24]}); ${names.length} countries`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
