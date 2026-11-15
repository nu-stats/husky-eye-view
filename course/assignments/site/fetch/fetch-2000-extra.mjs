#!/usr/bin/env node
/**
 * Census 2000 (Summary File 3) place values for five more indicators of the community-context
 * site: median household income, bachelor's or higher, renter share, Black share, Hispanic share.
 * Bulk files, no API key: https://www2.census.gov/census_2000/datasets/Summary_File_3/
 *
 * Where each cell is (segment and offset from the SF3 table matrix, 0SF3_table_matrix.doc; the
 * offsets of P043 = 134 and P087 = 101 in scripts/fetch-sf3-2000-places.mjs come out the same way):
 *   P007 (segment 1,  offset 19)   Hispanic or Latino by race: cell 1 total, 4 = not Hispanic Black alone, 10 = Hispanic
 *   P037 (segment 3,  offset 206)  sex by educational attainment, 25+: cell 1 total; bachelor's, master's,
 *                                  professional, doctorate = cells 15-18 (men) and 32-35 (women)
 *   P053 (segment 6,  offset 82)   median household income in 1999 (1999 dollars)
 *   H007 (segment 56, offset 17)   tenure: cell 1 occupied units, 3 = renter occupied
 *
 * Output (not in git): data/source/census/sf3-2000-places-extra.json
 *   { vintage, tables, place: { "SSPPPPP": { inc, ba, rent, blk, hisp } } }
 *
 *   node course/assignments/site/fetch/fetch-2000-extra.mjs      (run from the repository root)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { STATES, download, unzip, text, share, positive } from './common.mjs';

const BASE = 'https://www2.census.gov/census_2000/datasets/Summary_File_3';
const OUTPUT = 'data/source/census/sf3-2000-places-extra.json';
const TMP = 'data/source/census/sf3-2000-extra-raw';
const HEADER = 5; // FILEID, STUSAB, CHARITER, CIFSN, LOGRECNO
const SEGMENTS = { s1: 1, s3: 3, s6: 6, s56: 56 };

async function readState([fips, st, name]) {
  const folder = `${BASE}/${name.replace(/ /g, '_')}`;
  mkdirSync(TMP, { recursive: true });
  const file = (seg) => `${st}000${String(seg).padStart(2, '0')}_uf3.zip`;
  const names = { geo: `${st}geo_uf3.zip`, ...Object.fromEntries(Object.entries(SEGMENTS).map(([k, s]) => [k, file(s)])) };
  const raw = {};
  try {
    for (const [key, f] of Object.entries(names)) raw[key] = [...unzip(await download(`${folder}/${f}`, `${TMP}/${f}`)).values()][0];
  } catch {
    // Some single-segment URLs are missing: use the state's full archive.
    const all = `all_${name.replace(/ /g, '_')}.zip`;
    const archive = unzip(await download(`${folder}/${all}`, `${TMP}/${all}`));
    for (const [key, f] of Object.entries(names)) {
      const inner = archive.get(f);
      if (!inner) throw new Error(`${all} has no ${f}`);
      raw[key] = [...unzip(inner).values()][0];
    }
  }
  // Place records (summary level 160): LOGRECNO is columns 19-25, PLACE columns 46-50 (1-based).
  const places = new Map();
  for (const line of text(raw.geo).split('\n')) {
    if (line.slice(8, 11) !== '160') continue;
    places.set(line.slice(18, 25), fips + line.slice(45, 50));
  }
  const out = {};
  const pick = (bytes, cb) => {
    for (const line of text(bytes).split('\n')) {
      const f = line.split(',');
      const geoid = places.get(f[4]);
      if (geoid) cb((out[geoid] ||= {}), (offset, k) => Number(f[HEADER + offset + k]));
    }
  };
  pick(raw.s1, (p, c) => {
    p.blk = share(c(19, 3), c(19, 0));
    p.hisp = share(c(19, 9), c(19, 0));
  });
  pick(raw.s3, (p, c) => {
    let degrees = 0;
    for (const k of [14, 15, 16, 17, 31, 32, 33, 34]) degrees += c(206, k);
    p.ba = share(degrees, c(206, 0));
  });
  pick(raw.s6, (p, c) => {
    p.inc = positive(c(82, 0));
  });
  pick(raw.s56, (p, c) => {
    p.rent = share(c(17, 2), c(17, 0));
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
    vintage: '2000',
    source: 'U.S. Census Bureau, Census 2000 Summary File 3',
    tables: {
      inc: { table: 'P053', label: 'Median household income in 1999 (dollars)' },
      ba: { table: 'P037', label: "Bachelor's degree or higher (% of adults 25+)" },
      rent: { table: 'H007', label: 'Renter-occupied homes (% of occupied housing units)' },
      blk: { table: 'P007', label: 'Black alone, not Hispanic (% of people)' },
      hisp: { table: 'P007', label: 'Hispanic or Latino (% of people)' },
    },
    place,
  }),
);
console.log(`${OUTPUT}: ${Object.keys(place).length} places`);
if (failures.length) console.log('Failures:\n' + failures.join('\n'));
