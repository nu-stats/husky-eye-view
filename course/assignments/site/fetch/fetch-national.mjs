#!/usr/bin/env node
/**
 * National (United States, 50 states + DC) values of the seven menu indicators for the three periods,
 * with the same tables and cells as the city values (fetch-2000-extra.mjs, fetch-2010-extra.mjs,
 * scripts/fetch-acs-social.mjs and the poverty/unemployment fetchers in scripts/).
 *
 * Counts come from the Census Bureau's own United States record; the percents are checked
 * against the sum of the 51 state records read from the same files (printed to the console).
 * Output: course/assignments/site/data/national.json
 *
 *   node course/assignments/site/fetch/fetch-national.mjs <scratch folder>
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { download, unzip, text } from './common.mjs';

const TMP = process.argv[2];
if (!TMP) throw new Error('Give a scratch folder for the raw downloads');
mkdirSync(TMP, { recursive: true });
const pct = (part, whole) => Number(((100 * part) / whole).toFixed(1));
const report = { '2000': {}, '2006_10': {}, '2020_24': {} };
const check = {};

// ---------- Census 2000, Summary File 3, 0_National ----------
{
  const BASE = 'https://www2.census.gov/census_2000/datasets/Summary_File_3/0_National';
  const HEADER = 5;
  const getSeg = async (name) => [...unzip(await download(`${BASE}/${name}`, `${TMP}/${name}`)).values()][0];
  const geo = text(await getSeg('usgeo_uf3.zip'));
  const levels = {}; // logrecno -> { level, state }
  for (const line of geo.split('\n')) {
    if (line.length < 50) continue;
    levels[line.slice(18, 25)] = { sumlev: line.slice(8, 11), comp: line.slice(11, 13), state: line.slice(29, 31) };
  }
  const usId = Object.keys(levels).find((k) => levels[k].sumlev === '010' && levels[k].comp === '00');
  const stateIds = Object.keys(levels).filter((k) => levels[k].sumlev === '040' && levels[k].comp === '00' && levels[k].state !== '72');
  console.log(`2000: US logrecno ${usId}, state records ${stateIds.length}`);
  const wanted = new Set([usId, ...stateIds]);
  const rows = {};
  for (const seg of [1, 3, 4, 6, 7, 56]) {
    const body = text(await getSeg(`us000${String(seg).padStart(2, '0')}_uf3.zip`));
    const map = new Map();
    for (const line of body.split('\n')) {
      const key = line.split(',', 5)[4];
      if (wanted.has(key)) map.set(key, line.split(','));
    }
    rows[seg] = map;
  }
  const cell = (seg, id, offset, k) => Number(rows[seg].get(id)[HEADER + offset + k]);
  const counts = (id) => ({
    pov: [cell(7, id, 101, 1), cell(7, id, 101, 0)],
    unemp: [cell(4, id, 134, 6) + cell(4, id, 134, 13), cell(4, id, 134, 4) + cell(4, id, 134, 11)],
    ba: [[14, 15, 16, 17, 31, 32, 33, 34].reduce((s, k) => s + cell(3, id, 206, k), 0), cell(3, id, 206, 0)],
    rent: [cell(56, id, 17, 2), cell(56, id, 17, 0)],
    blk: [cell(1, id, 19, 3), cell(1, id, 19, 0)],
    hisp: [cell(1, id, 19, 9), cell(1, id, 19, 0)],
    pop: cell(1, id, 0, 0),
  });
  const us = counts(usId);
  const sum = { pov: [0, 0], unemp: [0, 0], ba: [0, 0], rent: [0, 0], blk: [0, 0], hisp: [0, 0], pop: 0 };
  for (const id of stateIds) {
    const c = counts(id);
    for (const k of Object.keys(sum)) {
      if (k === 'pop') sum.pop += c.pop;
      else { sum[k][0] += c[k][0]; sum[k][1] += c[k][1]; }
    }
  }
  const names = { pov: 'poverty_percent', unemp: 'unemployment_percent', ba: 'bachelors_percent', rent: 'renter_percent', blk: 'black_percent', hisp: 'hispanic_percent' };
  for (const [k, name] of Object.entries(names)) report['2000'][name] = pct(...us[k]);
  report['2000'].median_household_income = cell(6, usId, 82, 0);
  check['2000'] = { usPopulation: us.pop, statePopulation: sum.pop, states: stateIds.length };
  for (const [k, name] of Object.entries(names)) check['2000'][name] = { us: pct(...us[k]), stateSum: pct(...sum[k]) };
}

// ---------- ACS 2006-2010, sequence files, UnitedStates folder ----------
{
  const BASE = 'https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state/UnitedStates/All_Geographies_Not_Tracts_Block_Groups';
  const B23001_EMPLOYED = [69, 81, 76, 91, 86, 99, 13, 20, 27, 34, 41, 48, 55, 62, 113, 106, 120, 134, 127, 141, 148, 155, 162, 167, 172, 177];
  const B23001_UNEMPLOYED = [63, 70, 82, 77, 92, 87, 100, 14, 21, 28, 35, 42, 49, 56, 114, 107, 121, 135, 128, 142, 149, 156, 163, 168, 173, 178];
  const geoBytes = await download(`${BASE}/g20105us.csv`, `${TMP}/g20105us.csv`);
  let usId = null;
  const stateIds = [];
  for (const line of text(geoBytes).split('\n')) {
    const f = line.split(',');
    const id = f.find((v) => /^(01|04)000US\d*$/.test(v));
    if (!id) continue;
    if (id === '01000US') usId = f[4];
    else if (id.startsWith('04000US') && id !== '04000US72') stateIds.push(f[4]);
  }
  console.log(`2010: US logrecno ${usId}, state records ${stateIds.length}`);
  const wanted = new Set([usId, ...stateIds]);
  const seq = async (n) => {
    const f = `20105us${String(n).padStart(4, '0')}000.zip`;
    const body = text([...unzip(await download(`${BASE}/${f}`, `${TMP}/${f}`)).entries()].find(([name]) => name.startsWith('e'))[1]);
    const map = new Map();
    for (const line of body.split('\n')) {
      const key = line.split(',', 6)[5];
      if (wanted.has(key)) map.set(key, line.split(','));
    }
    return map;
  };
  const s13 = await seq(13), s40 = await seq(40), s44 = await seq(44), s53 = await seq(53), s69 = await seq(69), s95 = await seq(95);
  const get = (map, id, field) => Number(map.get(id)[field - 1]);
  const counts = (id) => ({
    pov: [get(s44, id, 8), get(s44, id, 7)],
    unemp: [B23001_UNEMPLOYED.reduce((s, c) => s + get(s69, id, c), 0), 0],
    ba: [[15, 16, 17, 18, 32, 33, 34, 35].reduce((s, n) => s + get(s40, id, 90 + n - 1), 0), get(s40, id, 90)],
    rent: [get(s95, id, 13), get(s95, id, 11)],
    blk: [get(s13, id, 41), get(s13, id, 38)],
    hisp: [get(s13, id, 49), get(s13, id, 38)],
  });
  const withLabor = (id, c) => { c.unemp[1] = c.unemp[0] + B23001_EMPLOYED.reduce((s, x) => s + get(s69, id, x), 0); return c; };
  const us = withLabor(usId, counts(usId));
  const names = { pov: 'poverty_percent', unemp: 'unemployment_percent', ba: 'bachelors_percent', rent: 'renter_percent', blk: 'black_percent', hisp: 'hispanic_percent' };
  for (const [k, name] of Object.entries(names)) report['2006_10'][name] = pct(...us[k]);
  report['2006_10'].median_household_income = get(s53, usId, 177);
  check['2006_10'] = { states: stateIds.length };
  if (stateIds.length) {
    const sum = { pov: [0, 0], unemp: [0, 0], ba: [0, 0], rent: [0, 0], blk: [0, 0], hisp: [0, 0] };
    for (const id of stateIds) {
      const c = withLabor(id, counts(id));
      for (const k of Object.keys(sum)) { sum[k][0] += c[k][0]; sum[k][1] += c[k][1]; }
    }
    for (const [k, name] of Object.entries(names)) check['2006_10'][name] = { us: pct(...us[k]), stateSum: pct(...sum[k]) };
  }
}

// ---------- ACS 2020-2024, table-based summary file ----------
{
  const BASE = 'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024';
  const wanted = (table, cells) => cells.map((c) => `${table}_${c}`);
  const tables = {
    B17001: ['E001', 'E002'],
    B19013: ['E001'],
    B23025: ['E003', 'E005'],
    B15003: ['E001', 'E022', 'E023', 'E024', 'E025'],
    B25003: ['E001', 'E003'],
    B03002: ['E001', 'E004', 'E012'],
  };
  const read = async (table) => {
    const response = await fetch(`${BASE}-${table.toLowerCase()}.dat`);
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
    let header = null;
    const rows = { US: null, states: [] };
    for await (const line of createInterface({ input: Readable.fromWeb(response.body) })) {
      if (!header) { header = line.split('|'); continue; }
      if (line.startsWith('0100000US')) rows.US = line.split('|');
      else if (line.startsWith('0400000US') && !line.startsWith('0400000US72')) rows.states.push(line.split('|'));
    }
    const col = Object.fromEntries(header.map((h, i) => [h, i]));
    const val = (row, cell) => Number(row[col[`${table}_${cell}`]]);
    return { us: (cell) => val(rows.US, cell), states: (cell) => rows.states.reduce((s, r) => s + val(r, cell), 0), n: rows.states.length };
  };
  const t = {};
  for (const table of Object.keys(tables)) { t[table] = await read(table); console.log(`2024 ${table}: ${t[table].n} state rows`); }
  const both = (fn) => [fn((tb, c) => t[tb].us(c)), fn((tb, c) => t[tb].states(c))];
  const defs = {
    poverty_percent: (g) => pct(g('B17001', 'E002'), g('B17001', 'E001')),
    unemployment_percent: (g) => pct(g('B23025', 'E005'), g('B23025', 'E003')),
    bachelors_percent: (g) => pct(['E022', 'E023', 'E024', 'E025'].reduce((s, c) => s + g('B15003', c), 0), g('B15003', 'E001')),
    renter_percent: (g) => pct(g('B25003', 'E003'), g('B25003', 'E001')),
    black_percent: (g) => pct(g('B03002', 'E004'), g('B03002', 'E001')),
    hispanic_percent: (g) => pct(g('B03002', 'E012'), g('B03002', 'E001')),
  };
  check['2020_24'] = {};
  for (const [name, fn] of Object.entries(defs)) {
    const [u, s] = both(fn);
    report['2020_24'][name] = u;
    check['2020_24'][name] = { us: u, stateSum: s };
  }
  report['2020_24'].median_household_income = t.B19013.us('E001');
}

const order = ['poverty_percent', 'unemployment_percent', 'median_household_income', 'bachelors_percent', 'renter_percent', 'black_percent', 'hispanic_percent'];
const result = {};
for (const p of ['2000', '2006_10', '2020_24']) result[p] = Object.fromEntries(order.map((v) => [v, report[p][v]]));
writeFileSync(new URL('../data/national.json', import.meta.url), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify(result, null, 1));
console.log('CHECK', JSON.stringify(check, null, 1));
rmSync(TMP, { recursive: true, force: true });
