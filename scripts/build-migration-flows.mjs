#!/usr/bin/env node
/**
 * Build the bundled table for the "Migration & Refugee Flows" layer: flows
 * between the United States and every other country, from four sources.
 *
 *   src/data/local_data/migration_flows/us-migration-flows.json
 *
 * Views (each keeps its own year):
 *  - stock: immigrants living in the US by country of birth. UN DESA
 *    Population Division, International Migrant Stock 2024, Table 1 (both
 *    sexes, mid-2024 column), destination = United States of America (840).
 *    Licence CC BY 3.0 IGO.
 *  - refugees: refugees plus asylum-seekers whose country of asylum is the
 *    US, by country of origin. UNHCR Refugee Population Statistics API,
 *    /population/v1/population, latest year with rows. Licence CC BY 4.0.
 *  - resettlement: refugees resettled to the US in that year, by country of
 *    origin. UNHCR /population/v1/solutions, same year. Licence CC BY 4.0.
 *  - remittances: money sent FROM the US to each receiving country.
 *    KNOMAD / World Bank Bilateral Remittance Matrix 2021 (December 2022
 *    version, the latest published), USD millions. Licence CC BY 4.0.
 *
 * Arc anchors are Natural Earth 10m admin-0 label points (public domain),
 * pinned to the commit build-admin-packs.mjs uses.
 *
 * Downloads are cached in data/source/migration-flows/ (gitignored); pass
 * --refresh to fetch again. The UN server needs a browser User-Agent, and
 * knomad.org now answers the matrix's official path with its home page, so
 * the Internet Archive copy of the same official URL is used as a fallback.
 *
 * Adapted from uxhimanshuk/ground-view (MIT): scripts/build-migrant-stock.mjs,
 * scripts/build-remittances.mjs, scripts/build-country-centroids.mjs and
 * src/layers/refugees/records.js, narrowed here to flows to or from the US.
 *
 *   node scripts/build-migration-flows.mjs [--refresh] [--unhcr-year 2025]
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkbook } from './lib/xlsx-lite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data', 'source', 'migration-flows');
export const OUT_FILE = path.join(
  ROOT,
  'src/data/local_data/migration_flows/us-migration-flows.json',
);

const NE_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
export const NATURAL_EARTH_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_COMMIT}/geojson/ne_10m_admin_0_countries.geojson`;
export const UN_DESA_URL =
  'https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx';
export const KNOMAD_URL =
  'https://www.knomad.org/sites/default/files/2022-12/bilateral_remittance_matrix_2021_0.xlsx';
export const KNOMAD_ARCHIVE_URL = `https://web.archive.org/web/2023/${KNOMAD_URL}`;
const UNHCR_API = 'https://api.unhcr.org/population/v1';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

export const US = 'USA';
const US_M49 = 840;
/** UN DESA Table 1 columns: destination code, origin code, 2024 both sexes. */
const DESA_COL = Object.freeze({ destCode: 4, originCode: 6, y2024: 14 });
/** UN DESA origin code for the all-origins total. */
const DESA_WORLD = 900;
/** UNHCR origin codes that are not a country: unknown, stateless, Tibetan. */
const UNHCR_NON_COUNTRY = new Set(['UNK', 'XXA', 'TIB', '-']);

const r2 = (n) => Math.round(n * 100) / 100;
const valid3 = (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v);

/** Lower-case, accent-free, punctuation-free key for name joins. */
export function normalizeCountryName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** KNOMAD spellings that Natural Earth names do not cover. */
const NAME_ALIASES = Object.freeze({
  'russian federation': 'RUS',
  'korea rep': 'KOR',
  'korea dem peoples rep': 'PRK',
  'korea dem people s rep': 'PRK',
  'iran islamic rep': 'IRN',
  'viet nam': 'VNM',
  turkiye: 'TUR',
  turkey: 'TUR',
  'syrian arab republic': 'SYR',
  'lao pdr': 'LAO',
  'egypt arab rep': 'EGY',
  'yemen rep': 'YEM',
  'congo dem rep': 'COD',
  'congo rep': 'COG',
  'cote divoire': 'CIV',
  'gambia the': 'GMB',
  'bahamas the': 'BHS',
  'kyrgyz republic': 'KGZ',
  'slovak republic': 'SVK',
  'micronesia fed sts': 'FSM',
  'venezuela rb': 'VEN',
  'hong kong sar china': 'HKG',
  'macao sar china': 'MAC',
  'west bank and gaza': 'PSE',
  'cabo verde': 'CPV',
  'timor leste': 'TLS',
  'north macedonia': 'MKD',
  eswatini: 'SWZ',
  'st kitts and nevis': 'KNA',
  'st lucia': 'LCA',
  'st vincent and the grenadines': 'VCT',
  'united states': 'USA',
  'united kingdom': 'GBR',
  czechia: 'CZE',
  'czech republic': 'CZE',
  'brunei darussalam': 'BRN',
  curacao: 'CUW',
  'sint maarten dutch part': 'SXM',
  'virgin islands u s': 'VIR',
  'british virgin islands': 'VGB',
  'faroe islands': 'FRO',
  kosovo: 'XKX',
});

/** Everyday names where Natural Earth's long name is the formal one. */
const DISPLAY_NAMES = Object.freeze({
  KOR: 'South Korea',
  PRK: 'North Korea',
  RUS: 'Russia',
  LAO: 'Laos',
  USA: 'United States',
  CZE: 'Czechia',
  COD: 'DR Congo',
  COG: 'Congo (Republic)',
  CPV: 'Cabo Verde',
  SWZ: 'Eswatini',
  TUR: 'Türkiye',
});

/**
 * Pure: Natural Earth admin-0 GeoJSON to {ISO3: {name, lat, lon, m49, names}}.
 * Label points sit inside the main landmass, which reads better as an arc
 * anchor than an area centroid (USA, Russia, France).
 */
export function buildCentroidTable(geojson) {
  const countries = {};
  for (const feature of geojson?.features || []) {
    const p = feature.properties || {};
    // Natural Earth stores -99 for France and Norway and for dependencies that
    // share a sovereign's code; only the sovereign feature owns an ISO3.
    const iso3 = valid3(p.ISO_A3)
      ? p.ISO_A3
      : valid3(p.ISO_A3_EH) && p.ADM0_A3 === p.ISO_A3_EH
        ? p.ISO_A3_EH
        : p.ADM0_A3 === 'KOS'
          ? 'XKX'
          : null;
    if (!iso3 || !Number.isFinite(p.LABEL_X) || !Number.isFinite(p.LABEL_Y))
      continue;
    const m49 = [p.ISO_N3, p.ISO_N3_EH, p.UN_A3]
      .map((v) => Number.parseInt(v, 10))
      .find((v) => Number.isInteger(v) && v > 0);
    const names = [
      p.NAME,
      p.NAME_LONG,
      p.NAME_EN,
      p.BRK_NAME,
      p.FORMAL_EN,
      p.NAME_SORT,
      p.NAME_ALT,
    ]
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim());
    // NAME abbreviates ("Antigua and Barb."), so cards use the long name.
    const display =
      DISPLAY_NAMES[iso3] ||
      [p.NAME_LONG, p.NAME_EN, p.NAME].find(
        (v) => typeof v === 'string' && v.trim() && !v.includes('.'),
      );
    countries[iso3] = {
      name: (display || names[0] || iso3).trim(),
      lat: r2(p.LABEL_Y),
      lon: r2(p.LABEL_X),
      m49: m49 || null,
      names: [...new Set(names)],
    };
  }
  return countries;
}

/** Name and M49 lookups over a centroid table. */
export function createCountryResolver(countries) {
  const byName = new Map();
  const byM49 = new Map();
  for (const [iso3, c] of Object.entries(countries)) {
    if (c.m49) byM49.set(c.m49, iso3);
    for (const n of c.names || [c.name]) {
      const key = normalizeCountryName(n);
      if (key && !byName.has(key)) byName.set(key, iso3);
    }
  }
  const known = (iso3) =>
    iso3 && Object.hasOwn(countries, iso3) ? iso3 : null;
  return {
    byIso3: (code) =>
      known(
        String(code || '')
          .trim()
          .toUpperCase(),
      ),
    byM49: (code) => byM49.get(Number(code)) || null,
    byName(name) {
      const key = normalizeCountryName(name);
      return byName.get(key) || known(NAME_ALIASES[key]) || null;
    },
  };
}

/**
 * Pure: UN DESA Table 1 rows to the people living in the US by country of
 * birth, mid-2024. `total` is the published all-origins figure.
 */
export function extractUsMigrantStock(rows, resolver) {
  const flows = {};
  const unmatched = {};
  let total = null;
  for (const row of rows) {
    if (row[DESA_COL.destCode] !== US_M49) continue;
    const origin = row[DESA_COL.originCode];
    const value = row[DESA_COL.y2024];
    if (!Number.isInteger(origin) || typeof value !== 'number') continue;
    if (origin === DESA_WORLD) {
      total = Math.round(value);
      continue;
    }
    // Regional aggregates use codes 900 and up (and a few below, which do not
    // resolve to a country either).
    if (!(value > 0)) continue;
    const iso3 = resolver.byM49(origin);
    if (!iso3) {
      if (origin < 900) unmatched[origin] = Math.round(value);
      continue;
    }
    if (iso3 === US) continue;
    flows[iso3] = (flows[iso3] || 0) + Math.round(value);
  }
  return { flows: sortFlows(flows), total, unmatched };
}

/**
 * Pure: KNOMAD matrix rows (header row first) to the remittances the US
 * sends to each receiving country, USD millions, plus the WORLD total.
 */
export function extractUsRemittances(rows, resolver) {
  const header = rows.find((r) => typeof r?.[1] === 'string' && r[1].trim());
  if (!header) throw new Error('Remittance header row not found');
  const usRow = rows.find(
    (r) => typeof r?.[0] === 'string' && resolver.byName(r[0]) === US,
  );
  if (!usRow) throw new Error('United States row not found in the matrix');
  const flows = {};
  const unmatched = [];
  let total = null;
  header.forEach((name, col) => {
    if (col === 0 || typeof name !== 'string' || !name.trim()) return;
    const value = usRow[col];
    if (/^world$/i.test(name.trim())) {
      if (typeof value === 'number') total = Math.round(value * 10) / 10;
      return;
    }
    if (typeof value !== 'number' || !(value > 0)) return;
    const iso3 = resolver.byName(name);
    if (!iso3) {
      unmatched.push(name.trim());
      return;
    }
    if (iso3 === US) return;
    flows[iso3] = Math.round(((flows[iso3] || 0) + value) * 10) / 10;
  });
  return { flows: sortFlows(flows), total, unmatched };
}

/** UNHCR returns numbers as numbers, numeric strings or "-". */
function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Pure: UNHCR population rows (country of asylum = US) to refugees plus
 * asylum-seekers by origin. Origins that are not a country (unknown,
 * stateless) are summed into `unknownOrigin`, never drawn.
 */
export function extractUsRefugees(items, resolver) {
  const flows = {};
  const split = {};
  const unmatched = {};
  let unknownOrigin = 0;
  let refugees = 0;
  let asylumSeekers = 0;
  for (const row of items || []) {
    if (String(row?.coa_iso || '').toUpperCase() !== US) continue;
    const r = count(row.refugees);
    const a = count(row.asylum_seekers);
    if (r + a <= 0) continue;
    refugees += r;
    asylumSeekers += a;
    const code = String(row.coo_iso ?? '').toUpperCase();
    if (UNHCR_NON_COUNTRY.has(code) || !code) {
      unknownOrigin += r + a;
      continue;
    }
    const iso3 = resolver.byIso3(code);
    if (!iso3 || iso3 === US) {
      // A territory without its own point (French Guiana, Guadeloupe…).
      unmatched[code] = (unmatched[code] || 0) + r + a;
      continue;
    }
    flows[iso3] = (flows[iso3] || 0) + r + a;
    const prior = split[iso3] || [0, 0];
    split[iso3] = [prior[0] + r, prior[1] + a];
  }
  const sorted = sortFlows(flows);
  return {
    flows: sorted,
    split: Object.fromEntries(Object.keys(sorted).map((k) => [k, split[k]])),
    total: refugees + asylumSeekers,
    refugees,
    asylumSeekers,
    unknownOrigin,
    unmatched,
  };
}

/** Pure: UNHCR solutions rows (country = US) to resettlement by origin. */
export function extractUsResettlement(items, resolver) {
  const flows = {};
  let total = 0;
  let unknownOrigin = 0;
  for (const row of items || []) {
    if (String(row?.coa_iso || '').toUpperCase() !== US) continue;
    const value = count(row.resettlement);
    if (!value) continue;
    total += value;
    const code = String(row.coo_iso ?? '').toUpperCase();
    const iso3 = UNHCR_NON_COUNTRY.has(code) ? null : resolver.byIso3(code);
    if (!iso3 || iso3 === US) {
      unknownOrigin += value;
      continue;
    }
    flows[iso3] = (flows[iso3] || 0) + value;
  }
  return { flows: sortFlows(flows), total, unknownOrigin };
}

/** Largest first, ties by code, so the file diff stays stable. */
function sortFlows(flows) {
  return Object.fromEntries(
    Object.entries(flows).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
  );
}

/**
 * Pure: the bundled table. Only the countries that appear in a view (plus
 * the US) are kept, as [name, lat, lon].
 */
export function assembleBundle({ countries, views, built }) {
  const used = new Set([US]);
  for (const view of Object.values(views))
    for (const iso3 of Object.keys(view.flows)) used.add(iso3);
  const table = {};
  for (const iso3 of [...used].sort()) {
    const c = countries[iso3];
    if (c) table[iso3] = [c.name, c.lat, c.lon];
  }
  return {
    meta: {
      title: 'Migration and refugee flows to and from the United States',
      built,
      anchors: `Natural Earth 10m admin-0 label points (public domain), ${NATURAL_EARTH_URL}`,
      tool: 'scripts/build-migration-flows.mjs',
    },
    countries: table,
    views,
  };
}

// ---- I/O --------------------------------------------------------------------

async function cached(name, fetcher, refresh) {
  const file = path.join(CACHE, name);
  if (!refresh && existsSync(file)) return readFile(file);
  const bytes = await fetcher();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, bytes);
  return bytes;
}

async function download(url, { headers = {}, expect = null } = {}) {
  const response = await fetch(url, { headers });
  const type = response.headers.get('content-type') || '';
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  if (expect && !expect.test(type))
    throw new Error(`Unexpected content type ${type} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function unhcrJson(endpoint, year, refresh) {
  const query = new URLSearchParams({
    limit: '10000',
    yearFrom: String(year),
    yearTo: String(year),
    coa: US,
    coo_all: 'true',
  });
  const bytes = await cached(
    `unhcr-${endpoint}-${year}.json`,
    () => download(`${UNHCR_API}/${endpoint}/?${query}`),
    refresh,
  );
  const json = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(json?.items))
    throw new Error(`Malformed UNHCR ${endpoint} response`);
  return json.items;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const yearArg = process.argv.indexOf('--unhcr-year');
  const built = new Date().toISOString().slice(0, 10);

  const countries = buildCentroidTable(
    JSON.parse(
      (
        await cached(
          'ne_10m_admin_0_countries.geojson',
          () => download(NATURAL_EARTH_URL),
          refresh,
        )
      ).toString('utf8'),
    ),
  );
  const resolver = createCountryResolver(countries);

  const desa = openWorkbook(
    await cached(
      'undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx',
      () => download(UN_DESA_URL, { headers: { 'user-agent': BROWSER_UA } }),
      refresh,
    ),
  );
  const stock = extractUsMigrantStock(desa.rows('Table 1'), resolver);
  if (Object.keys(stock.unmatched).length)
    console.warn('UN DESA origins without a country point:', stock.unmatched);

  const knomad = openWorkbook(
    await cached(
      'bilateral_remittance_matrix_2021_0.xlsx',
      async () => {
        try {
          return await download(KNOMAD_URL, {
            expect: /spreadsheet|octet-stream/,
          });
        } catch {
          return download(KNOMAD_ARCHIVE_URL);
        }
      },
      refresh,
    ),
  );
  const remit = extractUsRemittances(
    [...knomad.rows(knomad.sheetNames[0])],
    resolver,
  );
  if (remit.unmatched.length)
    console.warn('KNOMAD receivers without a country point:', remit.unmatched);

  // UNHCR: the requested year, else the latest of last year and the one
  // before that has rows for the US.
  const thisYear = new Date().getUTCFullYear();
  const years =
    yearArg > 0
      ? [Number(process.argv[yearArg + 1])]
      : [thisYear - 1, thisYear - 2];
  let unhcrYear = null;
  let refugees = null;
  for (const year of years) {
    const items = await unhcrJson('population', year, refresh);
    const result = extractUsRefugees(items, resolver);
    if (Object.keys(result.flows).length) {
      unhcrYear = year;
      refugees = result;
      break;
    }
  }
  if (!refugees) throw new Error('UNHCR has no recent rows for the US');
  if (Object.keys(refugees.unmatched).length)
    console.warn('UNHCR origins without a country point:', refugees.unmatched);
  const resettlement = extractUsResettlement(
    await unhcrJson('solutions', unhcrYear, refresh),
    resolver,
  );

  const unhcrMeta = {
    year: unhcrYear,
    asOf: `end of ${unhcrYear}`,
    licence: 'CC BY 4.0',
    retrieved: built,
  };
  const views = {
    stock: {
      year: 2024,
      asOf: 'mid-2024',
      unit: 'people',
      direction: 'to-us',
      source:
        'UN DESA Population Division, International Migrant Stock 2024 (POP/DB/MIG/Stock/Rev.2024), Table 1',
      url: UN_DESA_URL,
      licence: 'CC BY 3.0 IGO',
      retrieved: built,
      total: stock.total,
      flows: stock.flows,
    },
    refugees: {
      ...unhcrMeta,
      unit: 'people',
      direction: 'to-us',
      source:
        'UNHCR Refugee Population Statistics (refugees and asylum-seekers, country of asylum United States)',
      url: `${UNHCR_API}/population/?yearFrom=${unhcrYear}&yearTo=${unhcrYear}&coa=USA&coo_all=true`,
      total: refugees.total,
      refugees: refugees.refugees,
      asylumSeekers: refugees.asylumSeekers,
      unknownOrigin: refugees.unknownOrigin,
      unmapped: Object.values(refugees.unmatched).reduce((a, b) => a + b, 0),
      flows: refugees.flows,
      split: refugees.split,
    },
    resettlement: {
      ...unhcrMeta,
      asOf: `during ${unhcrYear}`,
      unit: 'people',
      direction: 'to-us',
      source:
        'UNHCR Refugee Population Statistics, solutions: resettlement arrivals to the United States',
      url: `${UNHCR_API}/solutions/?yearFrom=${unhcrYear}&yearTo=${unhcrYear}&coa=USA&coo_all=true`,
      total: resettlement.total,
      unknownOrigin: resettlement.unknownOrigin,
      flows: resettlement.flows,
    },
    remittances: {
      year: 2021,
      asOf: '2021 estimates, published December 2022',
      unit: 'USD millions',
      direction: 'from-us',
      source:
        'KNOMAD / World Bank Bilateral Remittance Matrix 2021 (December 2022 version)',
      url: KNOMAD_URL,
      licence: 'CC BY 4.0 (World Bank Open Data terms)',
      retrieved: built,
      total: remit.total,
      flows: remit.flows,
    },
  };
  const bundle = assembleBundle({ countries, views, built });
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(bundle)}\n`);
  for (const [key, view] of Object.entries(views))
    console.log(
      `${key} ${view.year}: ${Object.keys(view.flows).length} countries, total ${view.total} ${view.unit}`,
    );
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
