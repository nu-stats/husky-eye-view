#!/usr/bin/env node
/**
 * ACS 2006-2010 (5-year) place values for five more indicators of the community-context site:
 * median household income, bachelor's or higher, renter share, Black share, Hispanic share.
 * Sequence files, no API key:
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state/
 *
 * Where each cell is (sequence number and starting field, from
 * .../2010/documentation/5_year/user_tools/Sequence_Number_and_Table_Number_Lookup.txt;
 * B01003 = field 192 of sequence 11 comes out the same way as in scripts/fetch-acs-2010-places.mjs):
 *   B03002 (sequence 13, starts at field 38)  cell 1 total, 4 = not Hispanic Black alone, 12 = Hispanic or Latino
 *   B15002 (sequence 40, starts at field 90)  cell 1 total; bachelor's, master's, professional, doctorate =
 *                                             cells 15-18 (men) and 32-35 (women)
 *   B19013 (sequence 53, starts at field 177) median household income (2010 inflation-adjusted dollars)
 *   B25003 (sequence 95, starts at field 11)  cell 1 occupied units, 3 = renter occupied
 *
 * Output (not in git): data/source/census/acs2010-places-extra.json
 *   { vintage, tables, place: { "SSPPPPP": { inc, ba, rent, blk, hisp } } }
 *
 *   node course/assignments/site/fetch/fetch-2010-extra.mjs      (run from the repository root)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { STATES, download, unzip, text, share, positive } from './common.mjs';

const BASE = 'https://www2.census.gov/programs-surveys/acs/summary_file/2010/data/5_year_seq_by_state';
const OUTPUT = 'data/source/census/acs2010-places-extra.json';
const TMP = 'data/source/census/acs2010-extra-raw';

async function readState([, st, name]) {
  mkdirSync(TMP, { recursive: true });
  const stateFolder = name.replace(/ (\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '');
  const folder = `${BASE}/${stateFolder}/All_Geographies_Not_Tracts_Block_Groups`;
  const get = async (file) => {
    const bytes = await download(`${folder}/${file}`, `${TMP}/${file}`);
    return file.endsWith('.csv') ? bytes : [...unzip(bytes).entries()].find(([n]) => n.startsWith('e'))[1];
  };
  const geoText = text(await get(`g20105${st}.csv`));
  const seq = async (n) => text(await get(`20105${st}${String(n).padStart(4, '0')}000.zip`));
  const s13 = await seq(13);
  const s40 = await seq(40);
  const s53 = await seq(53);
  const s95 = await seq(95);

  const places = new Map();
  for (const line of geoText.split('\n')) {
    const f = line.split(',');
    const id = f.find((v) => /^16000US\d+$/.test(v));
    if (id) places.set(f[4], id.slice(7));
  }
  const out = {};
  const pick = (body, cb) => {
    for (const line of body.split('\n')) {
      const f = line.split(',');
      const geoid = places.get(f[5]);
      if (geoid) cb((out[geoid] ||= {}), (field) => Number(f[field - 1])); // 1-based field numbers
    }
  };
  pick(s13, (p, c) => {
    p.blk = share(c(38 + 3), c(38));
    p.hisp = share(c(38 + 11), c(38));
  });
  pick(s40, (p, c) => {
    let degrees = 0;
    for (const n of [15, 16, 17, 18, 32, 33, 34, 35]) degrees += c(90 + n - 1);
    p.ba = share(degrees, c(90));
  });
  pick(s53, (p, c) => {
    p.inc = positive(c(177));
  });
  pick(s95, (p, c) => {
    p.rent = share(c(11 + 2), c(11));
  });
  return out;
}

const place = {};
const failures = [];
for (const state of STATES) {
  process.stdout.write(`${state[2]}... `);
  try {
    const out = await readState(state);
    Object.assign(place, out);
    console.log(`${Object.keys(out).length} places`);
  } catch (error) {
    failures.push(`${state[2]}: ${error.message}`);
    console.log(`FAILED: ${error.message}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
}
mkdirSync('data/source/census', { recursive: true });
writeFileSync(
  OUTPUT,
  JSON.stringify({
    vintage: '2006-2010',
    source: 'U.S. Census Bureau, American Community Survey 2006-2010 5-year estimates',
    tables: {
      inc: { table: 'B19013', label: 'Median household income (2010 inflation-adjusted dollars)' },
      ba: { table: 'B15002', label: "Bachelor's degree or higher (% of adults 25+)" },
      rent: { table: 'B25003', label: 'Renter-occupied homes (% of occupied housing units)' },
      blk: { table: 'B03002', label: 'Black alone, not Hispanic (% of people)' },
      hisp: { table: 'B03002', label: 'Hispanic or Latino (% of people)' },
    },
    place,
  }),
);
console.log(`${OUTPUT}: ${Object.keys(place).length} places`);
if (failures.length) console.log('Failures:\n' + failures.join('\n'));
