#!/usr/bin/env node
/**
 * Add the Social & Economic and Internet Access measures to the shared area
 * chunks the map already draws, so no outlines are duplicated:
 *
 *  - public/context/tracts-2020/*.geojsonl gains ACS tract measures
 *    (pov, inc, unemp, ba, rent, blk, hisp, noveh, bb, net) from
 *    data/source/census/acs<year>_social.json (scripts/fetch-acs-social.mjs),
 *    and 2013–2017 internet shares (net17, bb17) re-apportioned from 2010
 *    tracts (scripts/fetch-acs-internet-2017.mjs).
 *  - public/context/county-life-expectancy/*.geojsonl gains Internet Access
 *    values: the state's household internet use at home and wired high-speed
 *    service from the CPS Computer and Internet Use Supplement (NTIA Data
 *    Explorer, data/source/internet/ntia-analyze-table.csv) for 1998–2010,
 *    and the county's ACS subscription and broadband shares (net, bb).
 *
 * Run after scripts/build-environment-layers.mjs (which rewrites the tract
 * chunks) and after any county life expectancy rebuild. Idempotent.
 *
 *   node scripts/build-social-layers.mjs [acsYear]   (default 2024)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const YEAR = Number(process.argv[2]) || 2024;
const ACS_FILE = `data/source/census/acs${YEAR}_social.json`;
const NTIA_FILE = 'data/source/internet/ntia-analyze-table.csv';
// 2013–2017 B28002 (scripts/fetch-acs-internet-2017.mjs) and the 2010 → 2020
// tract relationship file it downloads.
const ACS_2017_FILE = 'data/source/census/acs2017_internet.json';
const RELATIONSHIP_FILE = 'data/source/census/tab20_tract20_tract10_natl.txt';
export const TRACT_KEYS = [
  'pov',
  'inc',
  'unemp',
  'ba',
  'rent',
  'blk',
  'hisp',
  'noveh',
  'bb',
  'net',
];
/**
 * County values for the tract layers' overview from far out: the ACS county
 * estimates, and population-weighted means of the tract environment measures.
 */
export const COUNTY_SOCIAL_KEYS = [
  'pov',
  'inc',
  'unemp',
  'ba',
  'rent',
  'blk',
  'hisp',
  'noveh',
];
export const COUNTY_ENVIRONMENT_KEYS = ['pm25', 'o3', 'park'];
/** 2013–2017 internet shares: any subscription, broadband of any type. */
export const INTERNET_2017_KEYS = ['net17', 'bb17'];

const shareOf = (part, whole) =>
  whole > 0 ? Number(((100 * part) / whole).toFixed(1)) : null;

/** {net17, bb17} percentages from {hh, net, bb} household counts. */
export function internet2017Shares(counts) {
  if (!counts || !(counts.hh > 0)) return {};
  const out = {};
  const net = shareOf(counts.net, counts.hh);
  const bb = shareOf(counts.bb, counts.hh);
  if (net !== null) out.net17 = net;
  if (bb !== null) out.bb17 = bb;
  return out;
}

/**
 * Re-apportion 2010-tract household counts onto 2020 tracts by shared land
 * area (water area for all-water tracts): each 2010 tract's households are
 * split across the 2020 tracts it overlaps, in proportion to the overlap.
 * Returns {geoid2020: {hh, net, bb}}.
 */
export function crosswalkTractCounts(relationshipText, tract2010) {
  const parts = [];
  const totals = new Map();
  const lines = relationshipText.split(/\r?\n/);
  const head = lines[0].split('|');
  const col = (name) => head.indexOf(name);
  const [g20, g10, land, water] = [
    col('GEOID_TRACT_20'),
    col('GEOID_TRACT_10'),
    col('AREALAND_PART'),
    col('AREAWATER_PART'),
  ];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const row = line.split('|');
    const part = {
      to: row[g20],
      from: row[g10],
      land: Number(row[land]) || 0,
      water: Number(row[water]) || 0,
    };
    if (!part.to || !part.from || !tract2010[part.from]) continue;
    parts.push(part);
    const total = totals.get(part.from) || { land: 0, water: 0 };
    total.land += part.land;
    total.water += part.water;
    totals.set(part.from, total);
  }
  const out = {};
  for (const part of parts) {
    const total = totals.get(part.from);
    const share =
      total.land > 0
        ? part.land / total.land
        : total.water > 0
          ? part.water / total.water
          : 0;
    if (!(share > 0)) continue;
    const source = tract2010[part.from];
    const target = (out[part.to] ||= { hh: 0, net: 0, bb: 0 });
    target.hh += (source.hh || 0) * share;
    target.net += (source.net || 0) * share;
    target.bb += (source.bb || 0) * share;
  }
  return out;
}
/** CPS survey months used per year (household, share of all households). */
export const CPS_YEARS = {
  1998: 'Dec 1998',
  2000: 'Aug 2000',
  2003: 'Oct 2003',
  2007: 'Oct 2007',
  2010: 'Oct 2010',
};
const STATE_ABBR = {
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

/** {stateAbbr: {ia1998: %, hs2000: %, ...}} from the NTIA Data Explorer file. */
export function readCpsInternet(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = parseCsvLine(lines[0]);
  const byState = {};
  const want = {
    internetAtHome: 'ia',
    wiredHighSpeedAtHome: 'hs',
  };
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const [dataset, variable, , universe] = row;
    if (!want[variable] || universe !== 'isHouseholder') continue;
    const year = Object.entries(CPS_YEARS).find(
      ([, month]) => month === dataset,
    )?.[0];
    if (!year) continue;
    for (const abbr of Object.values(STATE_ABBR)) {
      const value = Number(row[head.indexOf(`${abbr}Prop`)]);
      if (!Number.isFinite(value) || row[head.indexOf(`${abbr}Prop`)] === '')
        continue;
      (byState[abbr] ||= {})[`${want[variable]}${year}`] = Number(
        (value * 100).toFixed(1),
      );
    }
  }
  return byState;
}

function rewriteChunks(directory, update) {
  let files = 0;
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
    files += 1;
  }
  return { files, touched };
}

function main() {
  const acs = JSON.parse(readFileSync(ACS_FILE, 'utf8'));
  const acs2017 = JSON.parse(readFileSync(ACS_2017_FILE, 'utf8'));
  const tracts2017 = crosswalkTractCounts(
    readFileSync(RELATIONSHIP_FILE, 'utf8'),
    acs2017.tract2010,
  );
  // Population-weighted county means of the tract environment measures, for
  // the county overview the tract layers show from far out.
  const environment = new Map();
  const tracts = rewriteChunks('public/context/tracts-2020', (p) => {
    const values = acs.tract[String(p.geoid)] || {};
    const weight = Number(values.pop) || 0;
    if (weight > 0) {
      const county = String(p.geoid).slice(0, 5);
      const sums = environment.get(county) || {};
      for (const key of COUNTY_ENVIRONMENT_KEYS) {
        if (!Number.isFinite(p[key])) continue;
        sums[key] = (sums[key] || 0) + p[key] * weight;
        sums[`${key}_w`] = (sums[`${key}_w`] || 0) + weight;
      }
      environment.set(county, sums);
    }
    for (const key of [...TRACT_KEYS, ...INTERNET_2017_KEYS]) delete p[key];
    let any = false;
    for (const key of TRACT_KEYS) {
      if (values[key] === null || values[key] === undefined) continue;
      p[key] = values[key];
      any = true;
    }
    const earlier = internet2017Shares(tracts2017[String(p.geoid)]);
    if (Object.keys(earlier).length) any = true;
    Object.assign(p, earlier);
    return any;
  });
  console.log(
    `tracts-2020: ACS ${acs.vintage} measures and ${acs2017.vintage} internet on ${tracts.touched} tracts in ${tracts.files} files`,
  );

  const cps = readCpsInternet(readFileSync(NTIA_FILE, 'utf8'));
  const internetKeys = (p) =>
    Object.keys(p).filter(
      (key) =>
        /^(ia|hs)\d{4}$/.test(key) ||
        ['net', 'bb', ...INTERNET_2017_KEYS].includes(key),
    );
  const overviewKeys = [...COUNTY_SOCIAL_KEYS, ...COUNTY_ENVIRONMENT_KEYS];
  const counties = rewriteChunks(
    'public/context/county-life-expectancy',
    (p) => {
      for (const key of [...internetKeys(p), ...overviewKeys]) delete p[key];
      const geoid = String(p.geoid);
      Object.assign(p, cps[STATE_ABBR[geoid.slice(0, 2)]] || {});
      const county = acs.county[geoid] || {};
      if (Number.isFinite(county.net)) p.net = county.net;
      if (Number.isFinite(county.bb)) p.bb = county.bb;
      Object.assign(p, internet2017Shares(acs2017.county[geoid]));
      // The tract layers' county overview: the same property names.
      for (const key of COUNTY_SOCIAL_KEYS)
        if (Number.isFinite(county[key])) p[key] = county[key];
      const sums = environment.get(geoid) || {};
      for (const key of COUNTY_ENVIRONMENT_KEYS)
        if (sums[`${key}_w`] > 0)
          p[key] = Number((sums[key] / sums[`${key}_w`]).toFixed(1));
      return true;
    },
  );
  console.log(
    `county-life-expectancy: internet values (CPS ${Object.keys(CPS_YEARS).join(', ')}; ACS ${acs2017.vintage}, ${acs.vintage}) and the tract layers' county overview on ${counties.touched} counties`,
  );
}

if (process.argv[1]?.endsWith('build-social-layers.mjs')) main();
