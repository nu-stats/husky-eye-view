#!/usr/bin/env node
/**
 * Download the ACS 5-year tables behind the Social & Economic layers and the
 * Curated Flights social measures, keeping only states, counties, places and
 * tracts, and save the derived percentages as one JSON file.
 *
 * Source: U.S. Census Bureau, American Community Survey 5-year estimates,
 * table-based summary files (no API key needed):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/<year>/table-based-SF/
 *
 * Output: data/source/census/acs<year>_social.json (not in git)
 *   { vintage, tables, measures, state|county|place|tract: {geoid: {key: value}} }
 *
 *   node scripts/fetch-acs-social.mjs [year]      (default 2024 = 2020–2024)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

const YEAR = Number(process.argv[2]) || 2024;
const BASE = `https://www2.census.gov/programs-surveys/acs/summary_file/${YEAR}/table-based-SF/data/5YRData/acsdt5y${YEAR}`;
const OUTPUT = `data/source/census/acs${YEAR}_social.json`;

/** Geography prefixes kept (summary level + component code). */
const LEVELS = {
  '0400000US': 'state',
  '0500000US': 'county',
  '1600000US': 'place',
  '1400000US': 'tract',
};

/**
 * Each measure: its Census table, the estimate cells it reads, and how they
 * combine. Shares are percentages of the table's universe.
 */
export const ACS_MEASURES = {
  pop: {
    table: 'B01003',
    label: 'Total population',
    cells: ['E001'],
    value: ([n]) => n,
  },
  pov: {
    table: 'B17001',
    label: 'Below the poverty level (% of people)',
    cells: ['E001', 'E002'],
    value: ([all, below]) => share(below, all),
  },
  inc: {
    table: 'B19013',
    label: 'Median household income (dollars)',
    cells: ['E001'],
    value: ([median]) => (median > 0 ? median : null),
  },
  unemp: {
    table: 'B23025',
    label: 'Unemployment rate (% of civilian labor force)',
    cells: ['E003', 'E005'],
    value: ([force, unemployed]) => share(unemployed, force),
  },
  ba: {
    table: 'B15003',
    label: "Bachelor's degree or higher (% of adults 25+)",
    cells: ['E001', 'E022', 'E023', 'E024', 'E025'],
    value: ([all, ...degrees]) =>
      share(
        degrees.reduce((s, n) => s + n, 0),
        all,
      ),
  },
  rent: {
    table: 'B25003',
    label: 'Renter-occupied homes (% of occupied housing units)',
    cells: ['E001', 'E003'],
    value: ([all, renters]) => share(renters, all),
  },
  blk: {
    table: 'B03002',
    label: 'Black, not Hispanic (% of people)',
    cells: ['E001', 'E004'],
    value: ([all, black]) => share(black, all),
  },
  hisp: {
    table: 'B03002',
    label: 'Hispanic or Latino (% of people)',
    cells: ['E001', 'E012'],
    value: ([all, hispanic]) => share(hispanic, all),
  },
  noveh: {
    table: 'B25044',
    label: 'Households with no vehicle (% of occupied housing units)',
    cells: ['E001', 'E003', 'E010'],
    value: ([all, owners, renters]) => share(owners + renters, all),
  },
  net: {
    table: 'B28002',
    label: 'Households with an internet subscription (%)',
    cells: ['E001', 'E002'],
    value: ([all, any]) => share(any, all),
  },
  bb: {
    table: 'B28002',
    label: 'Households with broadband of any type (%)',
    cells: ['E001', 'E004'],
    value: ([all, broadband]) => share(broadband, all),
  },
};

function share(part, whole) {
  return whole > 0 && part >= 0
    ? Number(((part / whole) * 100).toFixed(2))
    : null;
}

async function readTable(table) {
  const url = `${BASE}-${table.toLowerCase()}.dat`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
  const lines = createInterface({ input: Readable.fromWeb(response.body) });
  let header = null;
  const rows = new Map();
  for await (const line of lines) {
    if (!header) {
      header = line.split('|');
      continue;
    }
    const level = LEVELS[line.slice(0, 9)];
    if (!level) continue;
    const values = line.split('|');
    rows.set(values[0], { level, values });
  }
  return { header, rows };
}

async function main() {
  const tables = [...new Set(Object.values(ACS_MEASURES).map((m) => m.table))];
  const out = { state: {}, county: {}, place: {}, tract: {} };
  for (const table of tables) {
    process.stdout.write(`${table}… `);
    const { header, rows } = await readTable(table);
    const column = (cell) => header.indexOf(`${table}_${cell}`);
    for (const [key, measure] of Object.entries(ACS_MEASURES)) {
      if (measure.table !== table) continue;
      const indexes = measure.cells.map(column);
      if (indexes.some((i) => i < 0)) throw new Error(`${key}: missing cells`);
      for (const [geo, { level, values }] of rows) {
        const numbers = indexes.map((i) => Number(values[i]));
        if (numbers.some((n) => !Number.isFinite(n))) continue;
        const value = measure.value(numbers);
        if (value === null || value === undefined) continue;
        const geoid = geo.slice(9);
        (out[level][geoid] ||= {})[key] = value;
      }
    }
    console.log(`${rows.size} geographies`);
  }
  mkdirSync('data/source/census', { recursive: true });
  writeFileSync(
    OUTPUT,
    JSON.stringify({
      vintage: `${YEAR - 4}–${YEAR}`,
      source: `U.S. Census Bureau, American Community Survey ${YEAR - 4}–${YEAR} 5-year estimates`,
      tables: Object.fromEntries(
        Object.entries(ACS_MEASURES).map(([key, m]) => [
          key,
          { table: m.table, label: m.label },
        ]),
      ),
      ...out,
    }),
  );
  console.log(
    `${OUTPUT}: ${Object.keys(out.tract).length} tracts, ${Object.keys(out.county).length} counties, ${Object.keys(out.place).length} places`,
  );
}

if (process.argv[1]?.endsWith('fetch-acs-social.mjs')) main();
