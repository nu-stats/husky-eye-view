#!/usr/bin/env node
/**
 * Place-level values for Census 2000 (Summary File 3), for the Area Report
 * and the community-context assignment, from the Census Bureau's bulk files
 * (no API key needed):
 *   https://www2.census.gov/census_2000/datasets/Summary_File_3/<State>/
 *
 * Tables and cells (cell order from the census metadata for SF3 2000):
 *   P001001                         total population              (segment 1)
 *   P043 cells 5,7,12,14            civilian labor force and unemployed (segment 4)
 *   P087 cells 1,2                  total and below poverty      (segment 7)
 *
 * Each state's files are read, the place records (summary level 160) are
 * kept, and the raw downloads for that state are deleted before the next
 * state. Output (not in git): data/source/census/sf3-2000-places.json
 *   { vintage, tables, place: { "SSPPPPP": { pop, pov, unemp } } }
 *
 *   node scripts/fetch-sf3-2000-places.mjs
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const BASE = 'https://www2.census.gov/census_2000/datasets/Summary_File_3';
// `--county` reads county records (summary level 050) instead of places (160).
const COUNTY = process.argv.includes('--county');
const OUTPUT = COUNTY ? 'data/source/census/sf3-2000-counties.json' : 'data/source/census/sf3-2000-places.json';
const TMP = 'data/source/census/sf3-2000-raw';

// Cell offsets inside each segment's value fields (0-based, from the table order).
const P001_OFFSET = 0; // segment 1
const P043_OFFSET = 134; // segment 4: P043001 starts at value 841, segment 4 starts at 707
const P087_OFFSET = 101; // segment 7: P087001 starts at value 1505, segment 7 starts at 1404
const HEADER_FIELDS = 5; // FILEID, STUSAB, CHARITER, CIFSN, LOGRECNO
const CELLS = { P043: 15, P087: 17 };

// The 50 states and DC: FIPS, postal code, folder name (as in the fetch-foreign-born script).
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
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('not a ZIP');
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

/** Reads one state, then deletes its raw downloads (even when reading fails). */
async function processState(state) {
  try {
    return await readState(state);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
}

async function readState([fips, st, name]) {
  const folder = `${BASE}/${name.replace(/ /g, '_')}`;
  mkdirSync(TMP, { recursive: true });
  const names = { geo: `${st}geo_uf3.zip`, s1: `${st}00001_uf3.zip`, s4: `${st}00004_uf3.zip`, s7: `${st}00007_uf3.zip` };
  const files = {};
  let usedAll = false;
  try {
    for (const [key, file] of Object.entries(names)) {
      files[key] = unzip(await download(`${folder}/${file}`, `${TMP}/${file}`));
    }
  } catch (error) {
    // Some single-segment URLs are missing on the server (e.g. Alabama 00004 and 00007):
    // fall back to the state's full archive, which holds every segment.
    usedAll = true;
    const all = `all_${name.replace(/ /g, '_')}.zip`;
    const archive = unzip(await download(`${folder}/${all}`, `${TMP}/${all}`));
    const inner = (base) => {
      const bytes = [...archive.entries()].find(([n]) => n === base)?.[1];
      if (!bytes) throw new Error(`${all} has no ${base}`);
      return [...unzip(bytes).values()][0];
    };
    files.geo = { raw: inner(names.geo) };
    files.s1 = { raw: inner(names.s1) };
    files.s4 = { raw: inner(names.s4) };
    files.s7 = { raw: inner(names.s7) };
  }
  const geoBytes = usedAll ? files.geo.raw : [...files.geo.values()][0];
  const s1 = usedAll ? files.s1.raw : [...files.s1.values()][0];
  const s4 = usedAll ? files.s4.raw : [...files.s4.values()][0];
  const s7 = usedAll ? files.s7.raw : [...files.s7.values()][0];

  // Place records: summary level 160. LOGRECNO is columns 19-25 (1-based), PLACE 46-50.
  const places = new Map();
  for (const line of text(geoBytes).split('\n')) {
    if (line.slice(8, 11) !== (COUNTY ? '050' : '160')) continue;
    if (COUNTY && line.slice(11, 13) !== '00') continue; // whole county, not a urban/rural part
    // COUNTY is columns 32-34 (state FIPS 30-31, after the 2-digit census state code), PLACE columns 46-50 (1-based).
    places.set(line.slice(18, 25), fips + (COUNTY ? line.slice(31, 34) : line.slice(45, 50)));
  }

  // Segments: LOGRECNO is field 5 (index 4) of each record; values follow the 5 header fields.
  const out = {};
  const pick = (bytes, cb) => {
    for (const line of text(bytes).split('\n')) {
      const f = line.split(',');
      const geoid = places.get(f[4]);
      if (geoid) cb(geoid, f);
    }
  };
  pick(s1, (geoid, f) => {
    out[geoid] = { pop: Number(f[HEADER_FIELDS + P001_OFFSET]) };
  });
  const cell = (f, offset, k) => Number(f[HEADER_FIELDS + offset + k]);
  pick(s4, (geoid, f) => {
    const p = (out[geoid] ||= {});
    // P043 cells 1-based: 5 = civilian labor force (male), 7 = unemployed (male),
    // 12 = civilian labor force (female), 14 = unemployed (female).
    const lf = cell(f, P043_OFFSET, 4) + cell(f, P043_OFFSET, 11);
    const un = cell(f, P043_OFFSET, 6) + cell(f, P043_OFFSET, 13);
    p.unemp = lf > 0 ? Number(((un / lf) * 100).toFixed(2)) : null;
  });
  pick(s7, (geoid, f) => {
    const p = (out[geoid] ||= {});
    // P087001 total; P087002 income below poverty level.
    const total = cell(f, P087_OFFSET, 0);
    const below = cell(f, P087_OFFSET, 1);
    p.pov = total > 0 ? Number(((below / total) * 100).toFixed(2)) : null;
  });
  return { out, usedAll };
}

async function main() {
  const place = {};
  const failures = [];
  for (const state of STATES) {
    process.stdout.write(`${state[2]}… `);
    try {
      const { out, usedAll } = await processState(state);
      Object.assign(place, out);
      console.log(`${Object.keys(out).length} places${usedAll ? ' (full archive)' : ''}`);
    } catch (error) {
      failures.push(`${state[2]}: ${error.message}`);
      console.log(`FAILED: ${error.message}`);
    }
  }
  mkdirSync('data/source/census', { recursive: true });
  writeFileSync(
    OUTPUT,
    JSON.stringify({
      vintage: '2000',
      source: 'U.S. Census Bureau, Census 2000 Summary File 3',
      tables: {
        pop: { table: 'P001', label: 'Total population' },
        pov: { table: 'P087', label: 'Below the poverty level (% of people)' },
        unemp: { table: 'P043', label: 'Unemployment rate (% of civilian labor force)' },
      },
      [COUNTY ? 'county' : 'place']: place,
    }),
  );
  console.log(`${OUTPUT}: ${Object.keys(place).length} ${COUNTY ? 'counties' : 'places'}`);
  if (failures.length) console.log('Failures:\n' + failures.join('\n'));
}

main();
