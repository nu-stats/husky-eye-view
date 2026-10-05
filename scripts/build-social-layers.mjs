#!/usr/bin/env node
/**
 * Add the Social & Economic and Internet Access measures to the shared area
 * chunks the map already draws, so no outlines are duplicated:
 *
 *  - public/context/tracts-2020/*.geojsonl gains ACS tract measures
 *    (pov, inc, unemp, ba, rent, blk, hisp, noveh, bb) from
 *    data/source/census/acs<year>_social.json (scripts/fetch-acs-social.mjs).
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
];
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
  const tracts = rewriteChunks('public/context/tracts-2020', (p) => {
    const values = acs.tract[String(p.geoid)] || {};
    for (const key of TRACT_KEYS) delete p[key];
    let any = false;
    for (const key of TRACT_KEYS) {
      if (values[key] === null || values[key] === undefined) continue;
      p[key] = values[key];
      any = true;
    }
    return any;
  });
  console.log(
    `tracts-2020: ACS ${acs.vintage} measures on ${tracts.touched} tracts in ${tracts.files} files`,
  );

  const cps = readCpsInternet(readFileSync(NTIA_FILE, 'utf8'));
  const internetKeys = (p) =>
    Object.keys(p).filter(
      (key) => /^(ia|hs)\d{4}$/.test(key) || key === 'net' || key === 'bb',
    );
  const counties = rewriteChunks(
    'public/context/county-life-expectancy',
    (p) => {
      for (const key of internetKeys(p)) delete p[key];
      const geoid = String(p.geoid);
      Object.assign(p, cps[STATE_ABBR[geoid.slice(0, 2)]] || {});
      const county = acs.county[geoid] || {};
      if (Number.isFinite(county.net)) p.net = county.net;
      if (Number.isFinite(county.bb)) p.bb = county.bb;
      return internetKeys(p).length > 0;
    },
  );
  console.log(
    `county-life-expectancy: internet values on ${counties.touched} counties (CPS ${Object.keys(CPS_YEARS).join(', ')}; ACS ${acs.vintage})`,
  );
}

if (process.argv[1]?.endsWith('build-social-layers.mjs')) main();
