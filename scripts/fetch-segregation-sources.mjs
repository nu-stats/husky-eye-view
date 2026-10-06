#!/usr/bin/env node
/**
 * Download the sources for the residential segregation layers (no API keys):
 *
 *  - Longitudinal Tract Data Base (LTDB), Spatial Structures in the Social
 *    Sciences (S4), Brown University: standard full-count files for 2000, 2010
 *    and 2020, race and Hispanic origin counts on 2010 tract boundaries.
 *    https://s4.ad.brown.edu/Projects/Diversity/researcher/ltbddload/datalist.aspx
 *    (the page's year menu posts back and returns the zip).
 *  - American Community Survey 2020–2024 5-year estimates, table B03002
 *    (Hispanic or Latino origin by race), 2020 tracts; table-based summary file.
 *  - Census 2010 Gazetteer tract file: an internal point for every 2010 tract.
 *  - Census 2024 cartographic boundary file (1:500,000) of places.
 *
 * Output: data/source/segregation/ (not in git).
 *
 *   node scripts/fetch-segregation-sources.mjs
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readZip } from './fetch-acs-internet-2017.mjs';

const OUT = 'data/source/segregation';
const LTDB_PAGE =
  'https://s4.ad.brown.edu/Projects/Diversity/researcher/ltbddload/datalist.aspx';
/** The page's "Download Standard Full Data Files" year menu values. */
const LTDB_YEARS = { 2000: '4', 2010: '5', 2020: '6' };
const ACS_B03002 =
  'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b03002.dat';
const GAZETTEER_2010 =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/Gaz_tracts_national.zip';
const PLACES =
  'https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_place_500k.zip';

async function get(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response;
}

function unzipTo(buffer, directory) {
  mkdirSync(directory, { recursive: true });
  const files = readZip(buffer);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    writeFileSync(path.join(directory, path.basename(name)), data);
  }
  return Object.keys(files);
}

async function ltdb(year) {
  const marker = path.join(OUT, `ltdb_${year}.done`);
  if (existsSync(marker)) return;
  const page = await get(LTDB_PAGE);
  const html = await page.text();
  const cookie = (page.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .join('; ');
  const field = (name) =>
    (html.match(new RegExp(`id="${name}" value="([^"]*)"`)) || [])[1] || '';
  const response = await get(LTDB_PAGE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({
      __VIEWSTATE: field('__VIEWSTATE'),
      __VIEWSTATEGENERATOR: field('__VIEWSTATEGENERATOR'),
      __EVENTVALIDATION: field('__EVENTVALIDATION'),
      DropDownList5: LTDB_YEARS[year],
      Button3: 'Download Standard Full Data Files',
    }),
  });
  if (!/zip/.test(response.headers.get('content-type') || ''))
    throw new Error(`LTDB ${year}: the page did not return a zip`);
  const names = unzipTo(
    Buffer.from(await response.arrayBuffer()),
    path.join(OUT, 'ltdb'),
  );
  writeFileSync(marker, names.join('\n'));
  console.log(`LTDB ${year}: ${names.join(', ')}`);
}

async function download(url, file) {
  if (existsSync(file)) return;
  const response = await get(url);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
  console.log(`downloaded ${path.basename(file)}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const year of Object.keys(LTDB_YEARS)) await ltdb(year);
  await download(ACS_B03002, path.join(OUT, 'acsdt5y2024-b03002.dat'));
  if (!existsSync(path.join(OUT, 'gazetteer'))) {
    const response = await get(GAZETTEER_2010);
    unzipTo(
      Buffer.from(await response.arrayBuffer()),
      path.join(OUT, 'gazetteer'),
    );
    console.log('downloaded the 2010 tract gazetteer');
  }
  if (!existsSync(path.join(OUT, 'places'))) {
    const response = await get(PLACES);
    unzipTo(
      Buffer.from(await response.arrayBuffer()),
      path.join(OUT, 'places'),
    );
    console.log('downloaded the 2024 cartographic place boundaries');
  }
}

if (process.argv[1]?.endsWith('fetch-segregation-sources.mjs')) await main();
