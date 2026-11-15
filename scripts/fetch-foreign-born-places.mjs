#!/usr/bin/env node
/**
 * Place-level foreign-born residents (total count) for the three periods, for
 * the places in the community-context assignment:
 *   2000       Census 2000 SF3, PCT019 total (segment 22), per state bulk files
 *              https://www2.census.gov/census_2000/datasets/Summary_File_3/<State>/
 *   2006–2010  ACS 5-year, B05006_001 (sequence 18), per state bulk files
 *              https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state/
 *   2020–2024  ACS 5-year, B05006_E001 (table-based summary file)
 *              https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/
 *
 * Raw downloads for each 2000 and 2006–10 state are deleted before the next state.
 * Output (not in git): data/source/census/foreign-born-places.json
 *   { place: { "SSPPPPP": { fb2000, fb2006_10, fb2020_24 } } }
 *
 *   node scripts/fetch-foreign-born-places.mjs
 */
import { dirname } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { inflateRawSync } from 'node:zlib';

const OUTPUT = 'data/source/census/foreign-born-places.json';
// For the places in the community-context assignment (places-over-75k.json) the whole
// foreign-born table is kept too: the count for every country of birth, in each period.
const GROUP_OUTPUT = 'data/source/census/foreign-born-place-groups.json';
const WANT = new Set(JSON.parse(readFileSync('data/source/census/places-over-75k.json', 'utf8')).places.map((p) => p.geoid));
const CELLS = { fb2000: 126, fb2006_10: 161, fb2020_24: 178 };
const groups = {};
const keep = (id, key, values) => {
  if (WANT.has(id)) (groups[id] ||= {})[key] = values;
};
const TMP = 'data/source/census/fbplaces-raw';
const SF3 = 'https://www2.census.gov/census_2000/datasets/Summary_File_3';
const ACS10 = 'https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state';
const ACS24 = 'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b05006.dat';

// 2000 PCT019: segment 22 holds PCT018 (109 cells) then PCT019; its first cell is the total.
const PCT019_FIELD = 5 + 109;
// 2006–10 B05006: sequence 18, B05006_001 is field 66 (1-based), i.e. index 65.
const B05006_FIELD = 65;

// The 50 states and DC: FIPS, postal code, folder name.
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
const text = (bytes) => new TextDecoder('latin1').decode(bytes);

async function download(url, file, attempts = 6) {
  for (let i = 1; ; i++) {
    try {
      await sleep(300);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (/\.zip$/i.test(url) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('not a ZIP');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      return bytes;
    } catch (error) {
      if (i >= attempts) throw new Error(`${url}: ${error.message}`);
      await sleep(Math.min(60000, 3000 * 2 ** (i - 1)));
    }
  }
}

/** The files of a ZIP archive (stored or deflated), by lower-case name. */
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

/** 2000: place totals from segment 22 (PCT019), with the state archive as a fallback. */
async function read2000([fips, st, name]) {
  const folder = `${SF3}/${name.replace(/ /g, '_')}`;
  const names = { geo: `${st}geo_uf3.zip`, s22: `${st}00022_uf3.zip` };
  let geoBytes;
  let s22;
  try {
    geoBytes = [...unzip(await download(`${folder}/${names.geo}`, `${TMP}/${names.geo}`)).values()][0];
    s22 = [...unzip(await download(`${folder}/${names.s22}`, `${TMP}/${names.s22}`)).values()][0];
  } catch (error) {
    const all = `all_${name.replace(/ /g, '_')}.zip`;
    const archive = unzip(await download(`${folder}/${all}`, `${TMP}/${all}`));
    const inner = (base) => [...unzip([...archive.entries()].find(([n]) => n === base)[1]).values()][0];
    geoBytes = inner(names.geo);
    s22 = inner(names.s22);
  }
  const places = new Map();
  for (const line of text(geoBytes).split('\n')) {
    if (line.slice(8, 11) !== '160') continue;
    places.set(line.slice(18, 25), fips + line.slice(45, 50));
  }
  const out = {};
  for (const line of text(s22).split('\n')) {
    const f = line.split(',');
    const geoid = places.get(f[4]);
    if (geoid) {
      out[geoid] = Number(f[PCT019_FIELD]);
      keep(geoid, 'fb2000', f.slice(PCT019_FIELD, PCT019_FIELD + CELLS.fb2000).map(Number));
    }
  }
  return out;
}

/** 2006–10: place totals from sequence 18 (B05006_001). */
async function read2010([, st, name]) {
  const stateFolder = name.replace(/ (\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
  const folder = `${ACS10}/${stateFolder}/All_Geographies_Not_Tracts_Block_Groups`;
  const geo = text(await download(`${folder}/g20105${st}.csv`, `${TMP}/g20105${st}.csv`));
  const seq = unzip(await download(`${folder}/20105${st}0018000.zip`, `${TMP}/20105${st}0018000.zip`));
  const est = [...seq.entries()].find(([n]) => n.startsWith('e'))[1];
  const places = new Map();
  for (const line of geo.split('\n')) {
    const f = line.split(',');
    const id = f.find((v) => /^16000US\d+$/.test(v));
    if (id) places.set(f[4], id.slice(7));
  }
  const out = {};
  for (const line of text(est).split('\n')) {
    const f = line.split(',');
    const geoid = places.get(f[5]);
    if (geoid) {
      out[geoid] = Number(f[B05006_FIELD]);
      keep(geoid, 'fb2006_10', f.slice(B05006_FIELD, B05006_FIELD + CELLS.fb2006_10).map(Number));
    }
  }
  return out;
}

/** 2020–24: place totals from the table-based B05006 file (B05006_E001). */
async function read2024() {
  mkdirSync(TMP, { recursive: true });
  const response = await fetch(ACS24);
  if (!response.ok) throw new Error(`${ACS24}: HTTP ${response.status}`);
  const lines = createInterface({ input: Readable.fromWeb(response.body) });
  let header = null;
  let column = -1;
  let cols = [];
  const out = {};
  for await (const line of lines) {
    if (!header) {
      header = line.split('|');
      column = header.indexOf('B05006_E001');
      if (column < 0) throw new Error('B05006_E001 not in the 2024 file');
      cols = Array.from({ length: CELLS.fb2020_24 }, (_, i) => header.indexOf(`B05006_E${String(i + 1).padStart(3, '0')}`));
      if (cols.includes(-1)) throw new Error('a B05006 estimate column is missing from the 2024 file');
      continue;
    }
    if (!line.startsWith('1600000US')) continue;
    const values = line.split('|');
    const id = line.slice(9, 16);
    out[id] = Number(values[column]);
    if (WANT.has(id)) keep(id, 'fb2020_24', cols.map((c) => Number(values[c])));
  }
  return out;
}

async function main() {
  const place = {};
  const note = (id, key, value) => ((place[id] ||= {})[key] = value);
  const failures = [];
  for (const state of STATES) {
    process.stdout.write(`${state[2]}… `);
    try {
      const a = await read2000(state);
      for (const [id, v] of Object.entries(a)) note(id, 'fb2000', v);
      const b = await read2010(state);
      for (const [id, v] of Object.entries(b)) note(id, 'fb2006_10', v);
      console.log(`${Object.keys(a).length} / ${Object.keys(b).length} places`);
    } catch (error) {
      failures.push(`${state[2]}: ${error.message}`);
      console.log(`FAILED: ${error.message}`);
    } finally {
      rmSync(TMP, { recursive: true, force: true });
    }
  }
  console.log('2020–2024 (one table file)…');
  const c = await read2024();
  for (const [id, v] of Object.entries(c)) note(id, 'fb2020_24', v);
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync('data/source/census', { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({ place }));
  writeFileSync(GROUP_OUTPUT, JSON.stringify({ place: groups }));
  console.log(`${GROUP_OUTPUT}: ${Object.keys(groups).length} places`);
  console.log(`${OUTPUT}: ${Object.keys(place).length} places`);
  if (failures.length) console.log('Failures:\n' + failures.join('\n'));
}

main();
