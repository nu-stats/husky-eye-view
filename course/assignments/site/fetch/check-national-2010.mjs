#!/usr/bin/env node
// Cross-check for fetch-national.mjs: ACS 2006-2010 national percents from the sum of the 51 state records.
//   node course/assignments/site/fetch/check-national-2010.mjs <scratch folder>
import { mkdirSync, rmSync } from 'node:fs';
import { STATES, download, unzip, text } from './common.mjs';

const TMP = process.argv[2];
mkdirSync(TMP, { recursive: true });
const BASE = 'https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state';
const B23001_EMPLOYED = [69, 81, 76, 91, 86, 99, 13, 20, 27, 34, 41, 48, 55, 62, 113, 106, 120, 134, 127, 141, 148, 155, 162, 167, 172, 177];
const B23001_UNEMPLOYED = [63, 70, 82, 77, 92, 87, 100, 14, 21, 28, 35, 42, 49, 56, 114, 107, 121, 135, 128, 142, 149, 156, 163, 168, 173, 178];
const sum = { pov: [0, 0], unemp: [0, 0], ba: [0, 0], rent: [0, 0], blk: [0, 0], hisp: [0, 0] };
for (const [fips, st, name] of STATES) {
  const stateFolder = name.replace(/ (\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
  const folder = `${BASE}/${stateFolder}/All_Geographies_Not_Tracts_Block_Groups`;
  const get = async (file) => {
    const bytes = await download(`${folder}/${file}`, `${TMP}/${file}`);
    return file.endsWith('.csv') ? bytes : [...unzip(bytes).entries()].find(([n]) => n.startsWith('e'))[1];
  };
  let id = null;
  for (const line of text(await get(`g20105${st}.csv`)).split('\n')) {
    const f = line.split(',');
    if (f.includes(`04000US${fips}`)) { id = f[4]; break; }
  }
  const row = async (n) => {
    const body = text(await get(`20105${st}${String(n).padStart(4, '0')}000.zip`));
    for (const line of body.split('\n')) { const f = line.split(','); if (f[5] === id) return (field) => Number(f[field - 1]); }
    throw new Error(`${name}: no state row in sequence ${n}`);
  };
  const s13 = await row(13), s40 = await row(40), s44 = await row(44), s69 = await row(69), s95 = await row(95);
  const add = (k, a, b) => { sum[k][0] += a; sum[k][1] += b; };
  add('pov', s44(8), s44(7));
  const un = B23001_UNEMPLOYED.reduce((s, c) => s + s69(c), 0);
  add('unemp', un, un + B23001_EMPLOYED.reduce((s, c) => s + s69(c), 0));
  add('ba', [15, 16, 17, 18, 32, 33, 34, 35].reduce((s, n) => s + s40(90 + n - 1), 0), s40(90));
  add('rent', s95(13), s95(11));
  add('blk', s13(41), s13(38));
  add('hisp', s13(49), s13(38));
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  process.stdout.write(`${name} `);
}
console.log('\n' + JSON.stringify(Object.fromEntries(Object.entries(sum).map(([k, [a, b]]) => [k, Number(((100 * a) / b).toFixed(1))]))));
