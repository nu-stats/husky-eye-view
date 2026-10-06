#!/usr/bin/env node
/**
 * Residential segregation (dissimilarity index) for every US city of 75,000+
 * people, in 2000, 2010 and 2020–2024, on consistently defined geography:
 *
 *  - Tracts: 2010 census tracts throughout. 2000 and 2010 counts come from the
 *    Longitudinal Tract Data Base (LTDB, S4, Brown University), already on 2010
 *    boundaries. ACS 2020–2024 tract counts (2020 tracts, table B03002) are
 *    moved onto 2010 tracts in proportion to shared land area (Census
 *    2020–2010 tract relationship file).
 *  - Cities: each 2010 tract belongs to the 2010 place LTDB assigns it
 *    (placefp10), in every year, so a city's tracts never change.
 *  - Which cities: incorporated places with 75,000+ people in the Census
 *    Vintage 2024 estimates (plus Urban Honolulu CDP), drawn with 2024
 *    cartographic boundaries.
 *
 * D = ½ Σ |m_i / M − w_i / W| over a city's tracts, for Black, Hispanic or
 * Latino, and Asian residents (m) against non-Hispanic white residents (w),
 * scaled 0–100. An index is left out when the group has fewer than
 * MIN_GROUP people or the city fewer than MIN_TRACTS populated tracts.
 *
 * Inputs: data/source/segregation/ (scripts/fetch-segregation-sources.mjs),
 *   data/source/census/tab20_tract20_tract10_natl.txt, data/source/census/sub-est2024.csv
 * Output: public/context/segregation/ (index.json + one chunk per state)
 *
 *   node scripts/build-segregation-layers.mjs
 */
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { readShapefile } from './lib/shapefile.mjs';
import { simplifyRing } from './build-overview-layers.mjs';

const SOURCE = 'data/source/segregation';
const RELATIONSHIP = 'data/source/census/tab20_tract20_tract10_natl.txt';
const POPULATION = 'data/source/census/sub-est2024.csv';
const OUT = 'public/context/segregation';
export const MIN_POPULATION = 75_000;
export const MIN_GROUP = 1_000;
export const MIN_TRACTS = 5;
/** Groups compared with non-Hispanic white residents. */
export const GROUPS = { bw: 'black', hw: 'hispanic', aw: 'asian' };
export const YEARS = ['00', '10', '24'];

/** Dissimilarity index (0–100) of group `m` against `w` over tracts. */
export function dissimilarity(tracts, m, w) {
  let M = 0;
  let W = 0;
  for (const t of tracts) {
    M += t[m] || 0;
    W += t[w] || 0;
  }
  if (!(M > 0 && W > 0)) return null;
  let sum = 0;
  for (const t of tracts) sum += Math.abs((t[m] || 0) / M - (t[w] || 0) / W);
  return Number((50 * sum).toFixed(1));
}

function csvRows(file, delimiter = ',') {
  const lines = readFileSync(file, 'latin1').split(/\r?\n/).filter(Boolean);
  // Some LTDB files start with a UTF-8 byte-order mark (read as latin1 here).
  const head = lines[0]
    .replace(/^(﻿|ï»¿)/, '')
    .split(delimiter)
    .map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    return Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const tractId = (raw) => String(raw).replace(/\D/g, '').padStart(11, '0');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 2010 tract -> 7-digit 2010 place GEOID (LTDB placefp10). */
function tractPlaces(rows2000) {
  const out = new Map();
  for (const row of rows2000) {
    const place = String(row.placefp10 || '').padStart(5, '0');
    if (!/^\d{5}$/.test(place) || place === '00000' || place === '99999')
      continue;
    const tract = tractId(row.tractid10);
    out.set(tract, tract.slice(0, 2) + place);
  }
  return out;
}

async function acsTractCounts() {
  const file = path.join(SOURCE, 'acsdt5y2024-b03002.dat');
  const lines = createInterface({ input: createReadStream(file, 'latin1') });
  let head = null;
  const out = new Map();
  for await (const line of lines) {
    const cells = line.split('|');
    if (!head) {
      head = Object.fromEntries(cells.map((h, i) => [h, i]));
      continue;
    }
    if (!cells[0].startsWith('1400000US')) continue;
    const at = (cell) => num(cells[head[`B03002_${cell}`]]);
    out.set(cells[0].slice(9), {
      pop: at('E001'),
      white: at('E003'),
      black: at('E004'),
      asian: at('E006'),
      hispanic: at('E012'),
    });
  }
  return out;
}

/** 2020-tract counts shared out to 2010 tracts by each 2020 tract's land. */
function onto2010(counts2020) {
  const lines = readFileSync(RELATIONSHIP, 'utf8').split(/\r?\n/);
  const head = lines[0].split('|');
  const [g20, g10, land] = [
    'GEOID_TRACT_20',
    'GEOID_TRACT_10',
    'AREALAND_PART',
  ].map((name) => head.indexOf(name));
  const parts = [];
  const totals = new Map();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const row = line.split('|');
    const part = { from: row[g20], to: row[g10], land: num(row[land]) };
    if (!counts2020.has(part.from)) continue;
    parts.push(part);
    totals.set(part.from, (totals.get(part.from) || 0) + part.land);
  }
  const out = new Map();
  for (const part of parts) {
    const total = totals.get(part.from);
    const share = total > 0 ? part.land / total : 0;
    if (!(share > 0)) continue;
    const source = counts2020.get(part.from);
    const target = out.get(part.to) || {
      pop: 0,
      white: 0,
      black: 0,
      asian: 0,
      hispanic: 0,
    };
    for (const key of Object.keys(target)) target[key] += source[key] * share;
    out.set(part.to, target);
  }
  return out;
}

function citiesOver(threshold) {
  const rows = csvRows(POPULATION);
  const out = new Map();
  for (const row of rows) {
    if (row.sumlev !== '162') continue;
    const pop = num(row.popestimate2024);
    if (pop < threshold) continue;
    out.set(row.state.padStart(2, '0') + row.place.padStart(5, '0'), {
      pop,
      name: row.name.replace(
        /\s+(city|town|village|borough|municipality|consolidated government \(balance\)|metropolitan government \(balance\)|unified government \(balance\)|metro government \(balance\)|urban county|\(balance\))$/i,
        '',
      ),
    });
  }
  return out;
}

const round = (ring) =>
  ring.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);
function outline(geometry) {
  const polygons = (
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  )
    .map((rings) => {
      const outer = simplifyRing(rings[0], 0.0008) || rings[0];
      return outer.length >= 4
        ? [
            round(outer),
            ...rings
              .slice(1)
              .map((r) => simplifyRing(r, 0.0008))
              .filter(Boolean)
              .map(round),
          ]
        : null;
    })
    .filter(Boolean);
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

/** Where the county and state indices go (read by build-internet-history-layers). */
export const AREA_OUT = 'data/source/segregation/area-indices.json';

/**
 * Dissimilarity for every county or state (all of its 2010 tracts, same
 * method and minimums as the cities): {areaId: {pop00, bw00, hw00, aw00, ...}}.
 */
export function areaIndices(byYear, areaOf) {
  const out = {};
  for (const year of YEARS) {
    const byArea = new Map();
    for (const [tract, row] of byYear[year]) {
      if (!row || !(row.pop > 0)) continue;
      const area = areaOf(tract);
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area).push(row);
    }
    for (const [area, rows] of byArea) {
      const values = (out[area] ||= {});
      const totals = rows.reduce(
        (sum, r) => {
          for (const key of Object.keys(sum)) sum[key] += r[key];
          return sum;
        },
        { pop: 0, white: 0, black: 0, asian: 0, hispanic: 0 },
      );
      values[`pop${year}`] = Math.round(totals.pop);
      values[`tracts${year}`] = rows.length;
      for (const [key, group] of Object.entries(GROUPS))
        values[`${key}${year}`] =
          rows.length >= MIN_TRACTS &&
          totals[group] >= MIN_GROUP &&
          totals.white >= MIN_GROUP
            ? dissimilarity(rows, group, 'white')
            : null;
    }
  }
  return out;
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

async function main() {
  const rows2000 = csvRows(path.join(SOURCE, 'ltdb', 'LTDB 2000 FULL.csv'));
  const rows2010 = csvRows(
    path.join(SOURCE, 'ltdb', 'LTDB_Std_2010_fullcount.csv'),
  );
  const places = tractPlaces(rows2000);
  const byYear = {
    '00': new Map(
      rows2000.map((r) => [
        tractId(r.tractid10),
        {
          pop: num(r.pop00),
          white: num(r.nhwht00),
          black: num(r.nhblk00),
          asian: num(r.asian00),
          hispanic: num(r.hisp00),
        },
      ]),
    ),
    10: new Map(
      rows2010.map((r) => [
        tractId(r.tractid),
        {
          pop: num(r.pop10),
          white: num(r.nhwht10),
          black: num(r.nhblk10),
          asian: num(r.asian10),
          hispanic: num(r.hisp10),
        },
      ]),
    ),
    24: onto2010(await acsTractCounts()),
  };

  const cities = citiesOver(MIN_POPULATION);
  // Urban Honolulu is a census-designated place, not incorporated.
  if (!cities.has('1571550'))
    cities.set('1571550', { pop: 350_964, name: 'Urban Honolulu' });

  // Tracts of each city (by LTDB's 2010 place assignment).
  const cityTracts = new Map();
  for (const [tract, place] of places) {
    if (!cities.has(place)) continue;
    if (!cityTracts.has(place)) cityTracts.set(place, []);
    cityTracts.get(place).push(tract);
  }

  const results = new Map();
  for (const [geoid, city] of cities) {
    const tracts = cityTracts.get(geoid) || [];
    const values = {};
    for (const year of YEARS) {
      const rows = tracts
        .map((t) => byYear[year].get(t))
        .filter((r) => r && r.pop > 0);
      const totals = rows.reduce(
        (sum, r) => {
          for (const key of Object.keys(sum)) sum[key] += r[key];
          return sum;
        },
        { pop: 0, white: 0, black: 0, asian: 0, hispanic: 0 },
      );
      values[`pop${year}`] = Math.round(totals.pop);
      for (const [key, group] of Object.entries(GROUPS)) {
        values[`n_${group}${year}`] = Math.round(totals[group]);
        values[`${key}${year}`] =
          rows.length >= MIN_TRACTS &&
          totals[group] >= MIN_GROUP &&
          totals.white >= MIN_GROUP
            ? dissimilarity(rows, group, 'white')
            : null;
      }
      values[`n_white${year}`] = Math.round(totals.white);
      values[`tracts${year}`] = rows.length;
    }
    results.set(geoid, { ...city, ...values });
  }
  // Rank every index among the cities that have it (1 = most segregated).
  for (const year of YEARS)
    for (const key of Object.keys(GROUPS)) {
      const ranked = [...results.entries()]
        .filter(([, r]) => Number.isFinite(r[`${key}${year}`]))
        .sort((a, b) => b[1][`${key}${year}`] - a[1][`${key}${year}`]);
      ranked.forEach(([, r], i) => {
        r[`r_${key}${year}`] = i + 1;
        r[`of_${key}${year}`] = ranked.length;
      });
    }

  // Outlines (2024 cartographic places), chunked by state.
  const byState = new Map();
  for (const { properties: p, geometry } of readShapefile(
    path.join(SOURCE, 'places', 'cb_2024_us_place_500k'),
  )) {
    const r = results.get(String(p.GEOID));
    if (!r || !geometry) continue;
    const feature = {
      type: 'Feature',
      id: `seg-${p.GEOID}`,
      properties: { ...r, name: `${r.name}, ${p.STUSPS}`, geoid: p.GEOID },
      geometry: outline(geometry),
    };
    delete feature.properties.pop;
    feature.properties.pop2024 = r.pop;
    const state = String(p.STUSPS);
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push(feature);
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const index = [];
  for (const [state, features] of [...byState].sort()) {
    writeFileSync(
      path.join(OUT, `${state}.geojsonl`),
      features.map((f) => JSON.stringify(f)).join('\n'),
    );
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of features)
      for (const poly of f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry.coordinates)
        for (const [x, y] of poly[0]) {
          box[0] = Math.min(box[0], x);
          box[1] = Math.min(box[1], y);
          box[2] = Math.max(box[2], x);
          box[3] = Math.max(box[3], y);
        }
    index.push({ id: state, bbox: box, count: features.length });
  }
  writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  const drawn = index.reduce((n, e) => n + e.count, 0);
  console.log(
    `segregation: ${cities.size} cities of ${MIN_POPULATION.toLocaleString()}+, ${drawn} drawn in ${index.length} state chunks`,
  );
  const top = (key, year) =>
    [...results.values()]
      .filter((r) => r[`r_${key}${year}`] <= 5)
      .sort((a, b) => a[`r_${key}${year}`] - b[`r_${key}${year}`])
      .map((r) => `${r.name} ${r[`${key}${year}`]}`)
      .join('; ');
  for (const year of YEARS)
    console.log(
      `  20${year} most segregated (Black–white): ${top('bw', year)}`,
    );
  console.log(
    `  ${ordinal(1)}… check: Detroit`,
    JSON.stringify(results.get('2622000')).slice(0, 300),
  );
  // Counties and states, for their own layers and for Curated Flights.
  const areas = {
    note: 'Dissimilarity (0-100) vs non-Hispanic white residents over 2010 tracts; LTDB 2000/2010, ACS 2020-2024 B03002 moved onto 2010 tracts. scripts/build-segregation-layers.mjs',
    county: areaIndices(byYear, (tract) => tract.slice(0, 5)),
    state: areaIndices(byYear, (tract) => tract.slice(0, 2)),
  };
  writeFileSync(AREA_OUT, JSON.stringify(areas));
  console.log(
    `area indices: ${Object.keys(areas.county).length} counties, ${Object.keys(areas.state).length} states -> ${AREA_OUT}; Cook County 2024: ${JSON.stringify(areas.county['17031'])}`,
  );
}

if (process.argv[1]?.endsWith('build-segregation-layers.mjs')) await main();
