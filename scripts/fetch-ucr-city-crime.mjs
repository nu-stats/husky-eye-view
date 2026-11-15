#!/usr/bin/env node
/**
 * Downloads the FBI "Offenses Known to Law Enforcement by City" tables (Table 8) for the years used in
 * the community-context assignment, into a folder you choose (delete it when you are done):
 *   2000, 2006-2010   one Excel table per year (static FBI files)  ->  <folder>/t<year>.xls
 *   2020-2024         the Crime Data Explorer download for the year (a signed link is requested from
 *                     https://cde.ucr.cjis.gov/LATEST/s3/signedurl?key=cius/<year>/offenses-known-to-le-<year>.zip)
 *                     ->  Table 8 files unpacked under <folder>/z<year>/
 *
 * Then:
 *   Rscript scripts/parse-ucr-city-crime.R <folder> <folder>/ucr-city.csv
 *   node scripts/match-city-crime.mjs <folder>/ucr-city.csv        (writes data/source/census/city-crime.json)
 *
 *   node scripts/fetch-ucr-city-crime.mjs <folder>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const folder = process.argv[2];
if (!folder) throw new Error('Give a folder for the downloads');
mkdirSync(folder, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'Mozilla/5.0' };

async function get(url, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      await sleep(300);
      const response = await fetch(url, { headers: UA });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (i >= attempts) throw new Error(`${url}: ${error.message}`);
      await sleep(3000 * 2 ** (i - 1));
    }
  }
}

/** The files of a ZIP archive (stored or deflated): Map of path -> bytes. */
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
    if (!name.endsWith('/')) files.set(name, method === 0 ? data : inflateRawSync(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const save = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
};

// 2000 and 2006-2010: static Excel files
const STATIC = {
  2000: 'https://www2.fbi.gov/ucr/cius_00/xl/00tbl08.xls',
  2006: 'https://www2.fbi.gov/ucr/cius2006/data/documents/06tbl08.xls',
  2007: 'https://www2.fbi.gov/ucr/cius2007/data/documents/07tbl08.xls',
  2008: 'https://www2.fbi.gov/ucr/cius2008/data/documents/08tbl08.xls',
  2009: 'https://www2.fbi.gov/ucr/cius2009/data/documents/09tbl08.xls',
  2010: 'https://ucr.fbi.gov/crime-in-the-u.s/2010/crime-in-the-u.s.-2010/tables/10tbl08.xls',
};
for (const [year, url] of Object.entries(STATIC)) {
  save(`${folder}/t${year}.xls`, await get(url));
  console.log(`${year}: ok`);
}

// 2020-2024: Crime Data Explorer downloads; keep only the Table 8 files
const isTable8 = (name) => /table[ _]?0?8(?![0-9])/i.test(name) && /\.xlsx$/i.test(name) && /by[_ ](state[_ ]by[_ ])?city/i.test(name);
for (const year of [2020, 2021, 2022, 2023, 2024]) {
  const key = `cius/${year}/offenses-known-to-le-${year}.zip`;
  const link = JSON.parse(new TextDecoder().decode(await get(`https://cde.ucr.cjis.gov/LATEST/s3/signedurl?key=${key}`)))[key];
  if (!link) throw new Error(`no download link for ${year}`);
  const files = unzip(await get(link));
  let kept = 0;
  for (const [name, bytes] of files) {
    if (isTable8(name)) {
      save(`${folder}/z${year}/${name.split('/').pop()}`, bytes);
      kept++;
    } else if (/table[ _]?0?8(?![0-9]).*state cuts\.zip$/i.test(name)) {
      for (const [inner, innerBytes] of unzip(bytes)) {
        if (isTable8(inner)) {
          save(`${folder}/z${year}/${inner.split('/').pop()}`, innerBytes);
          kept++;
        }
      }
    }
  }
  console.log(`${year}: ${kept} Table 8 files`);
}
