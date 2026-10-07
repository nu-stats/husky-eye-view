#!/usr/bin/env node
/**
 * Download the place-of-birth tables behind the Foreign-Born layers, for
 * states, counties and census tracts, from the Census Bureau's bulk files
 * (no API key needed):
 *   - 2000 Census Summary File 3, PCT019 (segment 22) and P001 (segment 01)
 *     https://www2.census.gov/census_2000/datasets/Summary_File_3/<State>/
 *   - ACS 2006–2010 5-year, B05006 (sequence 18) and B01003 (sequence 11)
 *     https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state/
 *   - ACS 2020–2024 5-year, B05006 and B01003 (table-based summary file)
 *     https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/
 * plus the Census tract relationship files used to put 2000 and 2010 tracts
 * onto 2020 tracts:
 *   https://www2.census.gov/geo/docs/maps-data/data/rel/trf_txt/us2010trf.txt
 *   https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_natl.txt
 *
 * Output (not in git): data/source/census/foreign-born/
 *   fb2000.json, fb2010.json, fb2024.json
 *     { vintage, table, cells: [label path per cell],
 *       state|county|tract: { geoid: [population, cell1, cell2, ...] } }
 *   us2010trf.txt, tab20_tract20_tract10_natl.txt
 *
 *   node scripts/fetch-foreign-born.mjs [2000] [2010] [2024] [rel]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

const OUT = 'data/source/census/foreign-born';
mkdirSync(OUT, { recursive: true });

/** The 50 states and DC: FIPS, postal code, and folder names. */
const STATES = [
  ['01', 'al', 'Alabama'],
  ['02', 'ak', 'Alaska'],
  ['04', 'az', 'Arizona'],
  ['05', 'ar', 'Arkansas'],
  ['06', 'ca', 'California'],
  ['08', 'co', 'Colorado'],
  ['09', 'ct', 'Connecticut'],
  ['10', 'de', 'Delaware'],
  ['11', 'dc', 'District of Columbia'],
  ['12', 'fl', 'Florida'],
  ['13', 'ga', 'Georgia'],
  ['15', 'hi', 'Hawaii'],
  ['16', 'id', 'Idaho'],
  ['17', 'il', 'Illinois'],
  ['18', 'in', 'Indiana'],
  ['19', 'ia', 'Iowa'],
  ['20', 'ks', 'Kansas'],
  ['21', 'ky', 'Kentucky'],
  ['22', 'la', 'Louisiana'],
  ['23', 'me', 'Maine'],
  ['24', 'md', 'Maryland'],
  ['25', 'ma', 'Massachusetts'],
  ['26', 'mi', 'Michigan'],
  ['27', 'mn', 'Minnesota'],
  ['28', 'ms', 'Mississippi'],
  ['29', 'mo', 'Missouri'],
  ['30', 'mt', 'Montana'],
  ['31', 'ne', 'Nebraska'],
  ['32', 'nv', 'Nevada'],
  ['33', 'nh', 'New Hampshire'],
  ['34', 'nj', 'New Jersey'],
  ['35', 'nm', 'New Mexico'],
  ['36', 'ny', 'New York'],
  ['37', 'nc', 'North Carolina'],
  ['38', 'nd', 'North Dakota'],
  ['39', 'oh', 'Ohio'],
  ['40', 'ok', 'Oklahoma'],
  ['41', 'or', 'Oregon'],
  ['42', 'pa', 'Pennsylvania'],
  ['44', 'ri', 'Rhode Island'],
  ['45', 'sc', 'South Carolina'],
  ['46', 'sd', 'South Dakota'],
  ['47', 'tn', 'Tennessee'],
  ['48', 'tx', 'Texas'],
  ['49', 'ut', 'Utah'],
  ['50', 'vt', 'Vermont'],
  ['51', 'va', 'Virginia'],
  ['53', 'wa', 'Washington'],
  ['54', 'wv', 'West Virginia'],
  ['55', 'wi', 'Wisconsin'],
  ['56', 'wy', 'Wyoming'],
];

const RAW = `${OUT}/raw`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A file from www2.census.gov, kept under raw/ so a rerun resumes. The server
 * rate-limits (HTTP 429, sometimes an HTML page with status 200), so requests
 * are paced, ZIPs are checked, and failures back off for up to minutes.
 */
async function download(url, attempts = 8) {
  const cached = `${RAW}/${url.replace(/^https:\/\/[^/]+\//, '').replace(/[^\w.-]+/g, '_')}`;
  if (existsSync(cached)) return new Uint8Array(readFileSync(cached));
  for (let i = 1; ; i++) {
    try {
      await sleep(350);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (/\.zip$/i.test(url) && !(bytes[0] === 0x50 && bytes[1] === 0x4b))
        throw new Error('not a ZIP (rate-limit page?)');
      mkdirSync(RAW, { recursive: true });
      writeFileSync(cached, bytes);
      return bytes;
    } catch (error) {
      if (i >= attempts) throw new Error(`${url}: ${error.message}`);
      await sleep(Math.min(120000, 4000 * 2 ** (i - 1)));
    }
  }
}

/** The files of a ZIP archive, by lower-case name (stored or deflated). */
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
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );
    at +=
      46 +
      nameLength +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    files.set(
      name.toLowerCase().split('/').pop(),
      method === 8 ? inflateRawSync(data) : data,
    );
  }
  return files;
}

const text = (bytes) => new TextDecoder('latin1').decode(bytes);
const lines = (bytes) => text(bytes).split(/\r?\n/).filter(Boolean);

/** Label paths of a table's cells, in order, from the Census API metadata. */
async function cellLabels(dataset, table, expected) {
  const meta = JSON.parse(
    text(
      await download(
        `https://api.census.gov/data/${dataset}/groups/${table}.json`,
      ),
    ),
  );
  const count = Object.keys(meta.variables).filter((name) =>
    new RegExp(`^${table}_?\\d{3}E?$`).test(name),
  ).length;
  if (expected && count !== expected)
    throw new Error(
      `${table} (${dataset}) has ${count} cells, expected ${expected}`,
    );
  const labels = [];
  for (let i = 1; i <= count; i++) {
    const n = String(i).padStart(3, '0');
    const entry =
      meta.variables[`${table}${n}`] || meta.variables[`${table}_${n}E`];
    if (!entry) throw new Error(`${table} cell ${n} missing from metadata`);
    labels.push(entry.label.replace(/^Estimate!!/, '').replace(/:/g, ''));
  }
  return labels;
}

function save(vintage, table, cells, geo) {
  const file = `${OUT}/fb${vintage}.json`;
  writeFileSync(file, JSON.stringify({ vintage, table, cells, ...geo }));
  console.log(
    `${file}: ${Object.keys(geo.state).length} states, ${Object.keys(geo.county).length} counties, ${Object.keys(geo.tract).length} tracts`,
  );
}

// ---- 2000 Census SF3 ----------------------------------------------------------
async function fetch2000() {
  const cells = await cellLabels('2000/dec/sf3', 'PCT019', 126);
  const geo = { state: {}, county: {}, tract: {} };
  const base = 'https://www2.census.gov/census_2000/datasets/Summary_File_3';
  for (const [fips, st, name] of STATES) {
    const folder = `${base}/${name.replace(/ /g, '_')}`;
    let geoText;
    let seg1;
    let seg22;
    try {
      const [g, s1, s22] = await Promise.all(
        [`${st}geo_uf3.zip`, `${st}00001_uf3.zip`, `${st}00022_uf3.zip`].map(
          (f) => download(`${folder}/${f}`, 3),
        ),
      );
      [geoText, seg1, seg22] = [g, s1, s22].map(
        (zip) => [...unzip(zip).values()][0],
      );
    } catch (error) {
      // The server's firewall rejects some single-segment URLs (Maryland's
      // md00001_uf3.zip): take the same files from the state's full archive.
      console.log(
        `2000 ${st}: ${error.message}; using all_${name.replace(/ /g, '_')}.zip`,
      );
      const all = unzip(
        await download(`${folder}/all_${name.replace(/ /g, '_')}.zip`),
      );
      const pick = (...suffixes) => {
        const entry = [...all.entries()].find(([n]) =>
          suffixes.some((s) => n.endsWith(s)),
        );
        if (!entry)
          throw new Error(
            `all_${name}.zip has no ${suffixes.join(' / ')}; it holds ${[...all.keys()].slice(0, 5).join(', ')}…`,
          );
        return /\.zip$/.test(entry[0])
          ? [...unzip(entry[1]).values()][0]
          : entry[1];
      };
      geoText = pick('geo_uf3.zip', 'geo.uf3');
      seg1 = pick('00001_uf3.zip', '00001.uf3');
      seg22 = pick('00022_uf3.zip', '00022.uf3');
    }
    // Geographic header (fixed width): SUMLEV 9-11, GEOCOMP 12-13,
    // LOGRECNO 19-25, STATE 30-31, COUNTY 32-34, TRACT 56-61.
    const wanted = new Map();
    for (const line of lines(geoText)) {
      if (line.slice(11, 13) !== '00') continue;
      const level = { '040': 'state', '050': 'county', 140: 'tract' }[
        line.slice(8, 11)
      ];
      if (!level) continue;
      const geoid =
        level === 'state'
          ? line.slice(29, 31)
          : level === 'county'
            ? line.slice(29, 34)
            : line.slice(29, 34) + line.slice(55, 61);
      wanted.set(line.slice(18, 25), { level, geoid });
    }
    const population = new Map();
    for (const line of lines(seg1)) {
      const f = line.split(',');
      if (wanted.has(f[4])) population.set(f[4], Number(f[5]));
    }
    let tracts = 0;
    for (const line of lines(seg22)) {
      const f = line.split(',');
      const where = wanted.get(f[4]);
      if (!where) continue;
      // Segment 22: PCT018 (109 cells) then PCT019 (126 cells).
      geo[where.level][where.geoid] = [
        population.get(f[4]) ?? 0,
        ...f.slice(5 + 109, 5 + 109 + 126).map(Number),
      ];
      if (where.level === 'tract') tracts++;
    }
    console.log(`2000 ${st}: ${tracts} tracts`);
  }
  save(2000, 'PCT019', cells, geo);
}

// ---- ACS 2006–2010 5-year -----------------------------------------------------
async function fetch2010() {
  const cells = await cellLabels('2010/acs/acs5', 'B05006', 161);
  const geo = { state: {}, county: {}, tract: {} };
  const base =
    'https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state';
  for (const [, st, name] of STATES) {
    const stateFolder = `${base}/${name.replace(/ (\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '')}`;
    for (const part of [
      'Tracts_Block_Groups_Only',
      'All_Geographies_Not_Tracts_Block_Groups',
    ]) {
      const folder = `${stateFolder}/${part}`;
      const [g, s11, s18] = await Promise.all([
        download(`${folder}/g20105${st}.csv`),
        download(`${folder}/20105${st}0011000.zip`),
        download(`${folder}/20105${st}0018000.zip`),
      ]);
      // Geography file: LOGRECNO is column 5; GEOID ("14000US…") is found by pattern.
      const wanted = new Map();
      for (const line of lines(g)) {
        const f = line.split(',');
        const id = f.find((v) => /^(04000|05000|14000)US\d+$/.test(v));
        if (!id) continue;
        const level = { '04000': 'state', '05000': 'county', 14000: 'tract' }[
          id.slice(0, 5)
        ];
        wanted.set(f[4], { level, geoid: id.slice(7) });
      }
      const estimates = (zip) =>
        lines([...unzip(zip).entries()].find(([n]) => n.startsWith('e'))[1]);
      const population = new Map();
      // B01003 starts at field 192 of sequence 11 (1-based).
      for (const line of estimates(s11)) {
        const f = line.split(',');
        if (wanted.has(f[5])) population.set(f[5], Number(f[191]) || 0);
      }
      // B05006: 161 cells from field 66 of sequence 18.
      for (const line of estimates(s18)) {
        const f = line.split(',');
        const where = wanted.get(f[5]);
        if (!where) continue;
        geo[where.level][where.geoid] = [
          population.get(f[5]) ?? 0,
          ...f.slice(65, 65 + 161).map((v) => Number(v) || 0),
        ];
      }
    }
    console.log(`2010 ${st}: ${Object.keys(geo.tract).length} tracts so far`);
  }
  save(2010, 'B05006', cells, geo);
}

// ---- ACS 2020–2024 5-year -----------------------------------------------------
async function tableRows(table, onRow) {
  const url = `https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-${table}.dat`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const reader = createInterface({ input: Readable.fromWeb(response.body) });
  let header = null;
  for await (const line of reader) {
    const f = line.split('|');
    if (!header) {
      header = f;
      continue;
    }
    const level = {
      '0400000US': 'state',
      '0500000US': 'county',
      '1400000US': 'tract',
    }[f[0].slice(0, 9)];
    if (level) onRow(level, f[0].slice(9), f, header);
  }
}

async function fetch2024() {
  const cells = await cellLabels('2024/acs/acs5', 'B05006');
  const population = new Map();
  await tableRows('b01003', (level, geoid, f, header) => {
    population.set(
      `${level}:${geoid}`,
      Number(f[header.indexOf('B01003_E001')]) || 0,
    );
  });
  const geo = { state: {}, county: {}, tract: {} };
  let columns = null;
  await tableRows('b05006', (level, geoid, f, header) => {
    columns ||= cells.map((_, i) =>
      header.indexOf(`B05006_E${String(i + 1).padStart(3, '0')}`),
    );
    geo[level][geoid] = [
      population.get(`${level}:${geoid}`) ?? 0,
      ...columns.map((c) => Number(f[c]) || 0),
    ];
  });
  save(2024, 'B05006', cells, geo);
}

async function fetchRelationships() {
  for (const url of [
    'https://www2.census.gov/geo/docs/maps-data/data/rel/trf_txt/us2010trf.txt',
    'https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_natl.txt',
  ]) {
    const file = `${OUT}/${url.split('/').pop()}`;
    if (existsSync(file)) continue;
    writeFileSync(file, await download(url));
    console.log(`saved ${file}`);
  }
}

const wanted = process.argv.slice(2);
const want = (key) => !wanted.length || wanted.includes(key);
if (want('rel')) await fetchRelationships();
if (want('2024')) await fetch2024();
if (want('2010')) await fetch2010();
if (want('2000')) await fetch2000();
