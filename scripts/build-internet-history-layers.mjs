#!/usr/bin/env node
/**
 * Two comparison layers for Internet Access Over Time, both in five-year
 * blocks (2000–04, 2005–09, 2010–14, 2015–19, 2020–24) that average the
 * survey years falling inside each block:
 *
 *  - public/context/states/: every state and DC with the NTIA Internet
 *    Use Survey (CPS Computer and Internet Use Supplement) estimates for
 *    adults 15 and older: internet use anywhere, at home, at work, at school,
 *    in public places, and the devices used. Source: NTIA Data Explorer,
 *    data/source/internet/ntia-analyze-table.csv. Outlines: Census 2024
 *    cartographic boundary file (cb_2024_us_state_5m). Each state also
 *    carries its segregation indices (seg_bw24 …) for the state layer.
 *  - County and state segregation (dissimilarity, 2000 / 2010 / 2020–24) from
 *    data/source/segregation/area-indices.json (written by
 *    scripts/build-segregation-layers.mjs) as seg_<group><yy> keys.
 *  - public/context/county-life-expectancy/ gains asu<block> keys: household
 *    broadband from the ASU Technology, Data and Society county estimates
 *    (Tolbert and Mossberger 2020; data/source/internet/asu_broadband_long.csv
 *    from scripts/extract-asu-broadband.py). 2000–2012 are modeled from the
 *    CPS for the counties it identifies; 2013 on come from the ACS.
 *
 * Standard errors of a block mean: sqrt(sum of SE²) / number of years.
 * Run after scripts/build-social-layers.mjs (which leaves asu and seg keys
 * alone) and scripts/build-segregation-layers.mjs.
 *
 *   node scripts/build-internet-history-layers.mjs
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { readShapefile } from './lib/shapefile.mjs';
import { simplifyRing } from './build-overview-layers.mjs';

const NTIA_FILE = 'data/source/internet/ntia-analyze-table.csv';
const ASU_FILE = 'data/source/internet/asu_broadband_long.csv';
const STATES_SHP = 'data/source/census/cb_2024_us_state_5m/cb_2024_us_state_5m';
const STATES_OUT = 'public/context/states';
const SEGREGATION_AREAS = 'data/source/segregation/area-indices.json';
const COUNTIES = 'public/context/county-life-expectancy';
/** ~100 m: a state outline drawn over the whole country. */
const SIMPLIFY_DEGREES = 0.001;

/** Five-year blocks, named by their first year. */
export const BLOCKS = [2000, 2005, 2010, 2015, 2020];
export const blockOf = (year) =>
  year >= 2000 ? BLOCKS.findLast((b) => year >= b) : null;
export const blockLabel = (block) => `${block}–${String(block + 4).slice(2)}`;

/** NTIA variables (adults 15+) and the short keys the map reads. */
export const NTIA_VARIABLES = [
  ['internetUser', 'use', 'Uses the internet (any location)'],
  ['homeInternetUser', 'home', 'Uses the internet at home'],
  ['workInternetUser', 'work', 'Uses the internet at work'],
  ['schoolInternetUser', 'school', 'Uses the internet at school'],
  [
    'libCommInternetUser',
    'public',
    'Uses the internet at a library, community center or park',
  ],
  [
    'cafeInternetUser',
    'cafe',
    'Uses the internet at a coffee shop or other business',
  ],
  ['travelingInternetUser', 'travel', 'Uses the internet while traveling'],
  [
    'altHomeInternetUser',
    'other_home',
    "Uses the internet at someone else's home",
  ],
  ['mobilePhoneUser', 'phone', 'Uses a mobile phone'],
  ['desktopUser', 'desktop', 'Uses a desktop computer'],
  ['laptopUser', 'laptop', 'Uses a laptop computer'],
  ['tabletUser', 'tablet', 'Uses a tablet or e-book reader'],
  ['pcOrTabletUser', 'computer', 'Uses a desktop, laptop or tablet'],
  ['tvBoxUser', 'tv', 'Uses a smart TV or connected device'],
  ['wearableUser', 'wearable', 'Uses a wearable device'],
];

export const STATE_ABBR = {
  '01': 'AL',
  '02': 'AK',
  '04': 'AZ',
  '05': 'AR',
  '06': 'CA',
  '08': 'CO',
  '09': 'CT',
  10: 'DE',
  11: 'DC',
  12: 'FL',
  13: 'GA',
  15: 'HI',
  16: 'ID',
  17: 'IL',
  18: 'IN',
  19: 'IA',
  20: 'KS',
  21: 'KY',
  22: 'LA',
  23: 'ME',
  24: 'MD',
  25: 'MA',
  26: 'MI',
  27: 'MN',
  28: 'MS',
  29: 'MO',
  30: 'MT',
  31: 'NE',
  32: 'NV',
  33: 'NH',
  34: 'NJ',
  35: 'NM',
  36: 'NY',
  37: 'NC',
  38: 'ND',
  39: 'OH',
  40: 'OK',
  41: 'OR',
  42: 'PA',
  44: 'RI',
  45: 'SC',
  46: 'SD',
  47: 'TN',
  48: 'TX',
  49: 'UT',
  50: 'VT',
  51: 'VA',
  53: 'WA',
  54: 'WV',
  55: 'WI',
  56: 'WY',
};

function parseCsvLine(line) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      out.push(cell);
      cell = '';
    } else cell += char;
  }
  out.push(cell);
  return out;
}

const round1 = (value) => Number(value.toFixed(1));

/**
 * {stateAbbr: {use_2000: %, use_2000_se: %, use_2000_years: '2000, 2001, 2003', ...}}
 * for adults 15+ from the NTIA Data Explorer table.
 */
export function readNtiaBlocks(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = parseCsvLine(lines[0]);
  const keyOf = Object.fromEntries(
    NTIA_VARIABLES.map(([variable, key]) => [variable, key]),
  );
  // {abbr: {key: {block: [{year, p, se}]}}}
  const samples = {};
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const [dataset, variable, , universe] = row;
    const key = keyOf[variable];
    if (!key || universe !== 'isAdult') continue;
    const year = Number(String(dataset).slice(-4));
    const block = blockOf(year);
    if (!block) continue;
    for (const abbr of Object.values(STATE_ABBR)) {
      const p = row[head.indexOf(`${abbr}Prop`)];
      const se = row[head.indexOf(`${abbr}PropSE`)];
      if (p === '' || !Number.isFinite(Number(p))) continue;
      (((samples[abbr] ||= {})[key] ||= {})[block] ||= []).push({
        year,
        p: Number(p),
        se: se === '' ? null : Number(se),
      });
    }
  }
  const out = {};
  for (const [abbr, byKey] of Object.entries(samples)) {
    const props = (out[abbr] = {});
    for (const [key, byBlock] of Object.entries(byKey))
      for (const [block, list] of Object.entries(byBlock)) {
        list.sort((a, b) => a.year - b.year);
        props[`${key}_${block}`] = round1(
          (100 * list.reduce((s, x) => s + x.p, 0)) / list.length,
        );
        if (list.every((x) => Number.isFinite(x.se)))
          props[`${key}_${block}_se`] = Number(
            (
              (100 * Math.sqrt(list.reduce((s, x) => s + x.se ** 2, 0))) /
              list.length
            ).toFixed(2),
          );
        props[`${key}_${block}_years`] = list.map((x) => x.year).join(', ');
      }
  }
  return out;
}

/** {cfips: {asu2000: %, asu2000_years: '2000, 2001, ...', ...}} from the ASU CSV. */
export function readAsuBlocks(text) {
  const byCounty = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [fips, year, value] = line.split(',');
    const block = blockOf(Number(year));
    if (!block || !Number.isFinite(Number(value))) continue;
    ((byCounty[fips] ||= {})[block] ||= []).push({
      year: Number(year),
      v: Number(value),
    });
  }
  const out = {};
  for (const [fips, byBlock] of Object.entries(byCounty)) {
    const props = (out[fips] = {});
    for (const [block, list] of Object.entries(byBlock)) {
      list.sort((a, b) => a.year - b.year);
      props[`asu${block}`] = round1(
        (100 * list.reduce((s, x) => s + x.v, 0)) / list.length,
      );
      props[`asu${block}_years`] = list.map((x) => x.year).join(', ');
    }
  }
  return out;
}

const polygonsOf = (geometry) =>
  geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];

function cleanGeometry(geometry) {
  const polygons = [];
  for (const polygon of polygonsOf(geometry)) {
    const rings = polygon
      .map((ring) => simplifyRing(ring, SIMPLIFY_DEGREES))
      .filter(Boolean)
      .map((ring) =>
        ring.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]),
      );
    if (rings.length && rings[0].length >= 4) polygons.push(rings);
  }
  if (!polygons.length) return null;
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function bboxOf(features) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features)
    for (const [outer] of polygonsOf(feature.geometry))
      for (const [x, y] of outer) {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
  return box.map((v) => Number(v.toFixed(5)));
}

/** County and state segregation indices, as seg_<key> properties ({} when not built). */
function readSegregationAreas() {
  if (!existsSync(SEGREGATION_AREAS)) {
    console.warn(
      `no ${SEGREGATION_AREAS}: run scripts/build-segregation-layers.mjs for county and state segregation`,
    );
    return { county: {}, state: {} };
  }
  return JSON.parse(readFileSync(SEGREGATION_AREAS, 'utf8'));
}
export const segProps = (values = {}) =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([key, v]) => [`seg_${key}`, v]),
  );

function buildStates() {
  if (!existsSync(`${STATES_SHP}.shp`))
    throw new Error(
      `missing ${STATES_SHP}.shp: download https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_5m.zip and unzip it into data/source/census/cb_2024_us_state_5m`,
    );
  const ntia = readNtiaBlocks(readFileSync(NTIA_FILE, 'utf8'));
  const segregation = readSegregationAreas().state;
  const features = [];
  for (const { properties, geometry } of readShapefile(STATES_SHP)) {
    const fips = String(properties.STATEFP).padStart(2, '0');
    const abbr = STATE_ABBR[fips] || STATE_ABBR[Number(fips)];
    if (!abbr) continue; // territories: not in the NTIA tables
    const clean = cleanGeometry(geometry);
    if (!clean) continue;
    features.push({
      type: 'Feature',
      id: `ntia-${abbr}`,
      properties: {
        name: String(properties.NAME),
        abbr,
        geoid: fips,
        ...(ntia[abbr] || {}),
        ...segProps(segregation[fips]),
      },
      geometry: clean,
    });
  }
  features.sort((a, b) => a.properties.geoid.localeCompare(b.properties.geoid));
  rmSync(STATES_OUT, { recursive: true, force: true });
  mkdirSync(STATES_OUT, { recursive: true });
  writeFileSync(
    path.join(STATES_OUT, 'states.geojsonl'),
    features.map((f) => JSON.stringify(f)).join('\n'),
  );
  writeFileSync(
    path.join(STATES_OUT, 'index.json'),
    JSON.stringify([
      { id: 'states', bbox: bboxOf(features), count: features.length },
    ]),
  );
  const withData = features.filter((f) =>
    Number.isFinite(f.properties.use_2020),
  ).length;
  console.log(
    `ntia-states: ${features.length} states (${withData} with 2020–24 internet use)`,
  );
}

function addAsuToCounties() {
  const asu = readAsuBlocks(readFileSync(ASU_FILE, 'utf8'));
  const segregation = readSegregationAreas().county;
  const counts = Object.fromEntries(BLOCKS.map((b) => [b, 0]));
  let segregated = 0;
  for (const name of readdirSync(COUNTIES).filter((n) =>
    n.endsWith('.geojsonl'),
  )) {
    const file = path.join(COUNTIES, name);
    const lines = readFileSync(file, 'utf8').split('\n');
    const next = lines.map((line) => {
      if (!line.trim()) return line;
      const feature = JSON.parse(line);
      const p = feature.properties;
      for (const key of Object.keys(p))
        if (/^(asu\d{4}|seg_)/.test(key)) delete p[key];
      const values = asu[String(p.geoid)] || {};
      Object.assign(p, values);
      const seg = segProps(segregation[String(p.geoid)]);
      Object.assign(p, seg);
      if (Number.isFinite(seg.seg_bw24)) segregated += 1;
      for (const block of BLOCKS)
        if (Number.isFinite(values[`asu${block}`])) counts[block] += 1;
      return JSON.stringify(feature);
    });
    writeFileSync(file, next.join('\n'));
  }
  console.log(
    `county-life-expectancy: ASU broadband blocks on ${BLOCKS.map((b) => `${blockLabel(b)} ${counts[b]}`).join(', ')} counties; Black–white segregation 2020–24 on ${segregated}`,
  );
}

if (process.argv[1]?.endsWith('build-internet-history-layers.mjs')) {
  buildStates();
  addAsuToCounties();
}
