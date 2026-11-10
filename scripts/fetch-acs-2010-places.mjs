#!/usr/bin/env node
/**
 * Place-level values for ACS 2006–2010 (5-year), for the Area Report and the
 * community-context assignment, from the Census Bureau's sequence files (no
 * API key needed):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state/
 *
 * Cells (sequence file, field number counted from 1):
 *   pop    B01003_001                       field 192 of sequence 11
 *   pov    B17001_001 total, B17001_002 below poverty   fields 7, 8 of sequence 44
 *   unemp  civilian unemployed / (civilian employed + unemployed), summed over
 *          B23001 age-and-sex cells (armed forces left out)     sequence 69
 *
 * Each state's raw downloads are deleted before the next state.
 * Output (not in git): data/source/census/acs2010-places.json
 *   { vintage, tables, place: { "SSPPPPP": { pop, pov, unemp } } }
 *
 *   node scripts/fetch-acs-2010-places.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const BASE =
  'https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state';
// `--county` reads county records (GEOID 05000US) instead of places (16000US).
const COUNTY = process.argv.includes('--county');
const OUTPUT = COUNTY ? 'data/source/census/acs2010-counties.json' : 'data/source/census/acs2010-places.json';
const TMP = 'data/source/census/acs2010-raw';

// B23001 cells (1-based field numbers in sequence 69), from the census labels:
// civilian employed and civilian unemployed, by sex and age (armed forces excluded).
const B23001_EMPLOYED = [69, 81, 76, 91, 86, 99, 13, 20, 27, 34, 41, 48, 55, 62, 113, 106, 120, 134, 127, 141, 148, 155, 162, 167, 172, 177];
const B23001_UNEMPLOYED = [63, 70, 82, 77, 92, 87, 100, 14, 21, 28, 35, 42, 49, 56, 114, 107, 121, 135, 128, 142, 149, 156, 163, 168, 173, 178];

// The 50 states and DC: FIPS, postal code, state name.
const STATES = [
  ['01', 'al', 'Alabama'], ['02', 'ak', 'Alaska'], ['04', 'az', 'Arizona'], ['05', 'ar', 'Arkansas'],
  ['06', 'ca', 'California'], ['08', 'co', 'Colorado'], ['09', 'ct', 'Connecticut'], ['10', 'de', 'Delaware'],
  ['11', 'dc', 'District of Columbia'], ['12', 'fl', 'Florida'], ['13', 'ga', 'Georgia'], ['15', 'hi', 'Hawaii'],
  ['16', 'id', 'Idaho'], ['17', 'il', 'Illinois'], ['18', 'in', 'Indiana'], ['19', 'ia', 'Iowa'],
  ['20', 'ks', 'Kansas'], ['21', 'ky', 'Kentucky'], ['22', 'la', 'Louisiana'], ['23', 'me', 'Maine'],
  ['24', 'md', 'Maryland'], ['25', 'ma', 'Massachusetts'], ['26', 'mi', 'Michigan'], ['27', 'mn', 'Minnesota'],
  ['28', 'ms', 'Mississippi'], ['29', 'mo', 'Missouri'], ['30', 'mt', 'Montana'], ['31', 'ne', 'Nebraska'],
  ['32', 'nv', 'Nevada'], ['33', 'nh', 'New Hampshire'], ['34', 'nj', 'New Jersey'], ['35', 'nm', 'New Mexico'],
  ['36', 'ny', 'New York'], ['37', 'nc', 'North Carolina'], ['38', 'nd', 'North Dakota'], ['39', 'oh', 'Ohio'],
  ['40', 'ok', 'Oklahoma'], ['41', 'or', 'Oregon'], ['42', 'pa', 'Pennsylvania'], ['44', 'ri', 'Rhode Island'],
  ['45', 'sc', 'South Carolina'], ['46', 'sd', 'South Dakota'], ['47', 'tn', 'Tennessee'], ['48', 'tx', 'Texas'],
  ['49', 'ut', 'Utah'], ['50', 'vt', 'Vermont'], ['51', 'va', 'Virginia'], ['53', 'wa', 'Washington'],
  ['54', 'wv', 'West Virginia'], ['55', 'wi', 'Wisconsin'], ['56', 'wy', 'Wyoming'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, file, attempts = 6) {
  for (let i = 1; ; i++) {
    try {
      await sleep(300);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (/\.zip$/i.test(url) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('not a ZIP');
      writeFileSync(file, bytes);
      return bytes;
    } catch (error) {
      if (i >= attempts) throw new Error(`${url}: ${error.message}`);
      await sleep(Math.min(60000, 3000 * 2 ** (i - 1)));
    }
  }
}

/** The files of a ZIP archive (stored or deflated), by name. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP archive');
  const files = new Map();
  let at = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    files.set(name.toLowerCase(), method === 0 ? data : inflateRawSync(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const text = (bytes) => new TextDecoder('latin1').decode(bytes);
const share = (part, whole) => (whole > 0 ? Number(((part / whole) * 100).toFixed(2)) : null);

/** Reads one state, then deletes its raw downloads (even when reading fails). */
async function processState(state) {
  try {
    return await readState(state);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
}

async function readState([fips, st, name]) {
  mkdirSync(TMP, { recursive: true });
  const stateFolder = name.replace(/ (\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
  const folder = `${BASE}/${stateFolder}/All_Geographies_Not_Tracts_Block_Groups`;
  const get = async (file) => {
    const bytes = await download(`${folder}/${file}`, `${TMP}/${file}`);
    return file.endsWith('.csv') ? bytes : [...unzip(bytes).entries()].find(([n]) => n.startsWith('e'))[1];
  };
  const geoText = text(await get(`g20105${st}.csv`));
  const s11 = await get(`20105${st}0011000.zip`);
  const s44 = await get(`20105${st}0044000.zip`);
  const s69 = await get(`20105${st}0069000.zip`);

  // Place records (summary level 160): LOGRECNO is column 5 of the geography CSV; the GEOID is "16000US" + state + place.
  const places = new Map();
  for (const line of geoText.split('\n')) {
    const f = line.split(',');
    const id = f.find((v) => (COUNTY ? /^05000US\d+$/ : /^16000US\d+$/).test(v));
    if (!id) continue;
    places.set(f[4], id.slice(7));
  }

  // Estimates: LOGRECNO is field 6 (index 5) of each sequence record; cells are 1-based fields.
  const out = {};
  const pick = (bytes, cb) => {
    for (const line of text(bytes).split('\n')) {
      const f = line.split(',');
      const geoid = places.get(f[5]);
      if (geoid) cb(geoid, f);
    }
  };
  pick(s11, (geoid, f) => {
    (out[geoid] ||= {}).pop = Number(f[191]);
  });
  pick(s44, (geoid, f) => {
    (out[geoid] ||= {}).pov = share(Number(f[7]), Number(f[6]));
  });
  pick(s69, (geoid, f) => {
    const sum = (cells) => cells.reduce((s, c) => s + Number(f[c - 1]), 0);
    const unemployed = sum(B23001_UNEMPLOYED);
    const labor = unemployed + sum(B23001_EMPLOYED);
    (out[geoid] ||= {}).unemp = share(unemployed, labor);
  });
  return out;
}

async function main() {
  const place = {};
  const failures = [];
  for (const state of STATES) {
    process.stdout.write(`${state[2]}… `);
    try {
      const out = await processState(state);
      Object.assign(place, out);
      console.log(`${Object.keys(out).length} places`);
    } catch (error) {
      failures.push(`${state[2]}: ${error.message}`);
      console.log(`FAILED: ${error.message}`);
    }
  }
  mkdirSync('data/source/census', { recursive: true });
  writeFileSync(
    OUTPUT,
    JSON.stringify({
      vintage: '2006–2010',
      source: 'U.S. Census Bureau, American Community Survey 2006–2010 5-year estimates',
      tables: {
        pop: { table: 'B01003', label: 'Total population' },
        pov: { table: 'B17001', label: 'Below the poverty level (% of people)' },
        unemp: { table: 'B23001', label: 'Unemployment rate (% of civilian labor force)' },
      },
      [COUNTY ? 'county' : 'place']: place,
    }),
  );
  console.log(`${OUTPUT}: ${Object.keys(place).length} ${COUNTY ? 'counties' : 'places'}`);
  if (failures.length) console.log('Failures:\n' + failures.join('\n'));
}

main();
