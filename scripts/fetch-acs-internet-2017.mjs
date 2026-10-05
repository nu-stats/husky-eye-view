#!/usr/bin/env node
/**
 * Download household internet subscriptions (ACS table B28002) from the
 * 2013–2017 ACS 5-year estimates, the first 5-year release that asked about
 * internet access, for every county and census tract, plus the Census 2010 →
 * 2020 tract relationship file used to move the 2010-tract values onto the
 * 2020 tracts the map draws.
 *
 * Sources (no API key needed):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2017/data/5_year_seq_by_state/
 *     <State>/Tracts_Block_Groups_Only/ and All_Geographies_Not_Tracts_Block_Groups/
 *     (sequence 0128 holds B28002; g20175xx.csv maps record numbers to GEOIDs)
 *   https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_natl.txt
 *
 * Output (not in git):
 *   data/source/census/acs2017_internet.json
 *     { vintage, table, county: {geoid: {hh, net, bb}}, tract2010: {...} }
 *     hh = households; net, bb = households with any internet subscription /
 *     broadband of any type (counts, so they can be re-apportioned).
 *   data/source/census/tab20_tract20_tract10_natl.txt
 *
 *   node scripts/fetch-acs-internet-2017.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const ROOT =
  'https://www2.census.gov/programs-surveys/acs/summary_file/2017/data/5_year_seq_by_state';
const RELATIONSHIP_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_natl.txt';
const OUT_DIR = 'data/source/census';
const OUTPUT = `${OUT_DIR}/acs2017_internet.json`;
const RELATIONSHIP_FILE = `${OUT_DIR}/tab20_tract20_tract10_natl.txt`;
const SEQUENCE = '0128';
// B28002 starts at field 18 of sequence 0128 (1-based, after 6 identifier
// fields; ACS_5yr_Seq_Table_Number_Lookup.txt). Cells used: 001 households,
// 002 with an internet subscription, 004 broadband of any type.
const CELL = { hh: 17, net: 18, bb: 20 };

export const STATES = {
  Alabama: 'al',
  Alaska: 'ak',
  Arizona: 'az',
  Arkansas: 'ar',
  California: 'ca',
  Colorado: 'co',
  Connecticut: 'ct',
  Delaware: 'de',
  DistrictOfColumbia: 'dc',
  Florida: 'fl',
  Georgia: 'ga',
  Hawaii: 'hi',
  Idaho: 'id',
  Illinois: 'il',
  Indiana: 'in',
  Iowa: 'ia',
  Kansas: 'ks',
  Kentucky: 'ky',
  Louisiana: 'la',
  Maine: 'me',
  Maryland: 'md',
  Massachusetts: 'ma',
  Michigan: 'mi',
  Minnesota: 'mn',
  Mississippi: 'ms',
  Missouri: 'mo',
  Montana: 'mt',
  Nebraska: 'ne',
  Nevada: 'nv',
  NewHampshire: 'nh',
  NewJersey: 'nj',
  NewMexico: 'nm',
  NewYork: 'ny',
  NorthCarolina: 'nc',
  NorthDakota: 'nd',
  Ohio: 'oh',
  Oklahoma: 'ok',
  Oregon: 'or',
  Pennsylvania: 'pa',
  PuertoRico: 'pr',
  RhodeIsland: 'ri',
  SouthCarolina: 'sc',
  SouthDakota: 'sd',
  Tennessee: 'tn',
  Texas: 'tx',
  Utah: 'ut',
  Vermont: 'vt',
  Virginia: 'va',
  Washington: 'wa',
  WestVirginia: 'wv',
  Wisconsin: 'wi',
  Wyoming: 'wy',
};

/** Files from a zip archive (stored or deflated entries), by name. */
export function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files[name] = method === 0 ? data : inflateRawSync(data);
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

/** {logrecno: geoid} for one summary level ('140' tracts, '050' counties). */
export function readGeography(text, level) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const row = line.split(',');
    if (row[2] !== level || row[3] !== '00') continue;
    // GEOIDs look like 14000US01001020100: summary level, component, "US".
    const geoid = row.find((cell) => /^\d{5}US\d+$/.test(cell));
    if (geoid) out[row[4]] = geoid.split('US')[1];
  }
  return out;
}

/** {geoid: {hh, net, bb}} from an estimates sequence file. */
export function readEstimates(text, geography) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const row = line.split(',');
    const geoid = geography[row[5]];
    if (!geoid) continue;
    const value = (index) => {
      const n = Number(row[index]);
      return Number.isFinite(n) && row[index] !== '' && row[index] !== '.'
        ? n
        : null;
    };
    out[geoid] = {
      hh: value(CELL.hh),
      net: value(CELL.net),
      bb: value(CELL.bb),
    };
  }
  return out;
}

async function download(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function fetchState(folder, abbr, part, level) {
  const base = `${ROOT}/${folder}/${part}`;
  const geography = readGeography(
    (await download(`${base}/g20175${abbr}.csv`)).toString('latin1'),
    level,
  );
  const zip = readZip(await download(`${base}/20175${abbr}${SEQUENCE}000.zip`));
  const estimates = zip[`e20175${abbr}${SEQUENCE}000.txt`];
  if (!estimates) throw new Error(`no estimates file in ${folder} ${part}`);
  return readEstimates(estimates.toString('latin1'), geography);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const county = {};
  const tract2010 = {};
  for (const [folder, abbr] of Object.entries(STATES)) {
    Object.assign(
      tract2010,
      await fetchState(folder, abbr, 'Tracts_Block_Groups_Only', '140'),
    );
    Object.assign(
      county,
      await fetchState(
        folder,
        abbr,
        'All_Geographies_Not_Tracts_Block_Groups',
        '050',
      ),
    );
    process.stdout.write(`${abbr} `);
  }
  console.log();
  writeFileSync(
    OUTPUT,
    JSON.stringify({
      vintage: '2013–2017',
      table: 'B28002',
      county,
      tract2010,
    }),
  );
  console.log(
    `${OUTPUT}: ${Object.keys(county).length} counties, ${Object.keys(tract2010).length} 2010 tracts`,
  );
  if (!existsSync(RELATIONSHIP_FILE)) {
    writeFileSync(RELATIONSHIP_FILE, await download(RELATIONSHIP_URL));
    console.log(`${RELATIONSHIP_FILE}: downloaded`);
  }
}

if (process.argv[1]?.endsWith('fetch-acs-internet-2017.mjs')) await main();
