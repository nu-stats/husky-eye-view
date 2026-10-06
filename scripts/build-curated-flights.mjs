#!/usr/bin/env node
/**
 * Build the Curated Flights city table: every US city of 100,000+ people with
 * its boundary and population-weighted city / county / state values for the
 * layers a flight can show.
 *
 * Sources (data/source/census/, not in git; see journey.txt Step 52):
 *   sub-est2024.csv          Census Vintage 2024 city population estimates
 *   places_100k.geojson      TIGERweb incorporated places (+ Urban Honolulu CDP)
 *   acs2024_social.json      ACS 2020–2024 5-year tract population (B01003)
 *                            and place / county / state social measures
 *                            (scripts/fetch-acs-social.mjs)
 * plus the app's own public/context tract, HOLC and point data.
 *
 * City membership: a tract (or point) belongs to a city when its centroid
 * falls inside the city boundary. County and state values average every tract
 * in the city's principal county (the one holding most of its people) and in
 * its state. Averages weight each tract by its ACS population.
 *
 * Output: data/source/curated/curated-flights.json (plain, not in git). Lock it
 * for the repository with scripts/lock-curated-flights.mjs.
 *
 *   node scripts/build-curated-flights.mjs
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE = 'data/source/census';
const OUTPUT = 'data/source/curated/curated-flights.json';
const MIN_POPULATION = 100_000;
// Weight for a 2010 tract whose population cannot be matched to 2020 tracts.
const FALLBACK_TRACT_POPULATION = 4000;
// Below this a tract's life expectancy is a missing-value code, not an estimate.
const MIN_LIFE_EXPECTANCY = 30;

const STATE_ABBR = {
  '01': 'AL',
  '02': 'AK',
  '04': 'AZ',
  '05': 'AR',
  '06': 'CA',
  '08': 'CO',
  '09': 'CT',
  10: 'DE',
  11: 'DC',
  12: 'FL',
  13: 'GA',
  15: 'HI',
  16: 'ID',
  17: 'IL',
  18: 'IN',
  19: 'IA',
  20: 'KS',
  21: 'KY',
  22: 'LA',
  23: 'ME',
  24: 'MD',
  25: 'MA',
  26: 'MI',
  27: 'MN',
  28: 'MS',
  29: 'MO',
  30: 'MT',
  31: 'NE',
  32: 'NV',
  33: 'NH',
  34: 'NJ',
  35: 'NM',
  36: 'NY',
  37: 'NC',
  38: 'ND',
  39: 'OH',
  40: 'OK',
  41: 'OR',
  42: 'PA',
  44: 'RI',
  45: 'SC',
  46: 'SD',
  47: 'TN',
  48: 'TX',
  49: 'UT',
  50: 'VT',
  51: 'VA',
  53: 'WA',
  54: 'WV',
  55: 'WI',
  56: 'WY',
};

/**
 * What a flight can show about a city. `kind` says how the value is made:
 * mean (population-weighted tract mean), share (percent of residents or area),
 * rate (per N residents). GVA and MKDB are counted in the browser after the
 * research key unlocks them, so they are listed but never computed here.
 */
export const CURATED_LAYERS = {
  'life-expectancy': {
    label: 'Life expectancy',
    group: 'Health & environment',
    layerId: 'local-life-expectancy',
    unit: 'years',
    decimals: 1,
    vintage: '2010–2015',
    higherIs: 'better',
    note: 'Average life expectancy at birth, weighted by tract population.',
    source:
      'CDC/NCHS U.S. Small-area Life Expectancy Estimates Project (USALEEP), 2010–2015; population weights ACS 2020–2024 table B01003.',
    table: 'USALEEP; ACS B01003 (weights)',
  },
  'short-life-clusters': {
    label: 'Short-life clusters',
    group: 'Health & environment',
    layerId: 'local-tract-le-clusters',
    unit: '% of residents',
    decimals: 1,
    vintage: '2010–2015',
    higherIs: 'worse',
    note: 'Share of residents living in low–low life expectancy cluster tracts (local Moran’s I).',
    source:
      'Husky Eye View analysis of USALEEP tract life expectancy (local Moran’s I clusters); ACS 2020–2024 table B01003 weights.',
    table: 'USALEEP; ACS B01003 (weights)',
  },
  pm25: {
    label: 'PM2.5',
    group: 'Health & environment',
    layerId: 'local-air-pm25',
    unit: 'µg/m³',
    decimals: 1,
    vintage: '2021',
    higherIs: 'worse',
    note: 'Annual mean fine particulate matter, weighted by population. Lower 48 only.',
    source:
      'CDC Environmental Public Health Tracking, PM2.5 downscaler estimates (EPA CMAQ fused with monitors), 2021.',
    table: 'CDC Tracking; ACS B01003 (weights)',
  },
  ozone: {
    label: 'Ozone',
    group: 'Health & environment',
    layerId: 'local-air-ozone',
    unit: 'ppb',
    decimals: 1,
    vintage: '2022',
    higherIs: 'worse',
    note: 'Annual mean of the daily 8-hour ozone maximum, weighted by population. Lower 48 only.',
    source:
      'CDC Environmental Public Health Tracking, ozone downscaler estimates, 2022.',
    table: 'CDC Tracking; ACS B01003 (weights)',
  },
  'park-access': {
    label: 'Park access',
    group: 'Health & environment',
    layerId: 'local-park-access',
    unit: '% of residents',
    decimals: 1,
    vintage: '2020',
    higherIs: 'better',
    note: 'Share of residents within half a mile of a park.',
    source: 'CDC Environmental Public Health Tracking, Access to Parks, 2020.',
    table: 'CDC Tracking; ACS B01003 (weights)',
  },
  'holc-hazardous': {
    label: 'HOLC “Hazardous” (D) area',
    group: 'Health & environment',
    layerId: 'local-holc-redlining',
    unit: '% of graded area',
    decimals: 1,
    vintage: '1935–1940',
    higherIs: 'worse',
    note: 'Share of the 1930s HOLC-graded area rated D (“Hazardous”). Only cities and counties with HOLC maps.',
    source:
      'Mapping Inequality: Redlining in New Deal America (University of Richmond Digital Scholarship Lab), HOLC area grades.',
    table: 'Mapping Inequality',
  },
  'public-housing': {
    label: 'Public housing units',
    group: 'Health & environment',
    layerId: 'local-public-housing',
    unit: 'per 1,000 residents',
    decimals: 1,
    vintage: 'HUD current',
    higherIs: null,
    note: 'HUD public housing development units per 1,000 residents.',
    source:
      'U.S. Department of Housing and Urban Development, Public Housing Developments; residents from ACS 2020–2024 table B01003.',
    table: 'HUD; ACS B01003',
  },
  'trauma-centers': {
    label: 'Level I–II trauma centers',
    group: 'Health & environment',
    layerId: 'local-trauma-centers',
    unit: 'per 100,000 residents',
    decimals: 2,
    vintage: '2024',
    higherIs: 'better',
    note: 'Level I or II trauma centers per 100,000 residents.',
    source:
      'Homeland Infrastructure Foundation-Level Data (HIFLD), Hospitals (trauma designation); residents from ACS 2020–2024 table B01003.',
    table: 'HIFLD; ACS B01003',
  },
  ...Object.fromEntries(
    Object.entries({
      poverty: [
        'Poverty',
        'pov',
        'local-acs-poverty',
        '% of people',
        'worse',
        'B17001',
        'Share of people whose income in the past 12 months was below the poverty level.',
      ],
      'median-income': [
        'Median household income',
        'inc',
        'local-acs-income',
        'dollars',
        'better',
        'B19013',
        'Median household income in the past 12 months (2024 inflation-adjusted dollars).',
      ],
      unemployment: [
        'Unemployment',
        'unemp',
        'local-acs-unemployment',
        '% of labor force',
        'worse',
        'B23025',
        'Unemployed share of the civilian labor force (16 and older).',
      ],
      bachelors: [
        "Bachelor's degree or higher",
        'ba',
        'local-acs-education',
        '% of adults 25+',
        'better',
        'B15003',
        "Share of adults 25 and older with a bachelor's, master's, professional or doctorate degree.",
      ],
      renters: [
        'Renter-occupied homes',
        'rent',
        'local-acs-renters',
        '% of occupied homes',
        null,
        'B25003',
        'Share of occupied housing units that are renter-occupied.',
      ],
      black: [
        'Black residents',
        'blk',
        'local-acs-black',
        '% of people',
        null,
        'B03002',
        'Share of people who are Black or African American alone, not Hispanic or Latino.',
      ],
      hispanic: [
        'Hispanic or Latino residents',
        'hisp',
        'local-acs-hispanic',
        '% of people',
        null,
        'B03002',
        'Share of people who are Hispanic or Latino (of any race).',
      ],
      'no-vehicle': [
        'Households without a vehicle',
        'noveh',
        'local-acs-no-vehicle',
        '% of households',
        null,
        'B25044',
        'Share of occupied housing units with no vehicle available.',
      ],
      broadband: [
        'Broadband at home',
        'bb',
        'local-acs-broadband',
        '% of households',
        'better',
        'B28002',
        'Share of households with a broadband internet subscription of any type.',
      ],
    }).map(([key, [label, acs, layerId, unit, higherIs, table, note]]) => [
      key,
      {
        label,
        group: 'Social & economic (ACS)',
        layerId,
        acs,
        unit,
        decimals: acs === 'inc' ? 0 : 1,
        vintage: '2020–2024',
        higherIs,
        note,
        source: `U.S. Census Bureau, American Community Survey 2020–2024 5-year estimates, table ${table}. City = Census place; county and state = Census county and state estimates.`,
        table: `ACS ${table}`,
      },
    ]),
  ),
  // Residential segregation (scripts/build-segregation-layers.mjs): a city
  // measure only, so county and state stay empty; 2000 and 2010 ride along.
  ...Object.fromEntries(
    [
      ['segregation-bw', 'bw', 'Black–white segregation', 'Black'],
      [
        'segregation-hw',
        'hw',
        'Latino–white segregation',
        'Hispanic or Latino',
      ],
      ['segregation-aw', 'aw', 'Asian–white segregation', 'Asian'],
    ].map(([key, pair, label, noun]) => [
      key,
      {
        label,
        group: 'Segregation (dissimilarity)',
        layerId: 'local-segregation-2024',
        segregation: pair,
        unit: 'index (0–100)',
        decimals: 1,
        vintage: '2020–2024 (with 2000 and 2010)',
        higherIs: 'worse',
        note: `Dissimilarity index of ${noun} and non-Hispanic white residents across the census tracts of the city, its principal county and its state (0 = evenly spread, 100 = completely separated). The city's 2000 and 2010 values are included for comparison.`,
        source:
          'Longitudinal Tract Data Base (LTDB), Spatial Structures in the Social Sciences, Brown University (2000, 2010 census counts on 2010 tracts); U.S. Census Bureau, ACS 2020–2024 5-year estimates, table B03002, moved onto 2010 tracts. Index computed by Husky Eye View.',
        table: 'LTDB; ACS B03002',
      },
    ]),
  ),
  'gva-2015': {
    label: 'Gun deaths (GVA 2015)',
    group: 'Research data',
    layerId: 'local-gva-2015',
    unit: 'per 100,000 residents',
    decimals: 1,
    vintage: '2015',
    higherIs: 'worse',
    research: true,
    note: 'Gun Violence Archive 2015 deaths per 100,000 residents. Needs the research key.',
    source:
      'Gun Violence Archive, 2015 gun deaths (Guardian-corrected release); residents from ACS 2020–2024 table B01003.',
    table: 'GVA; ACS B01003',
  },
  mkdb: {
    label: 'Mass killings (MKDB)',
    group: 'Research data',
    layerId: 'local-mkdb',
    unit: 'per 1,000,000 residents',
    decimals: 2,
    vintage: '2006–2023',
    higherIs: 'worse',
    research: true,
    note: 'Mass killing incidents 2006–2023 per 1,000,000 residents. Needs the research key.',
    source:
      'Mass Killing Database (MKDB), 2006–2023; residents from ACS 2020–2024 table B01003.',
    table: 'MKDB; ACS B01003',
  },
};

// ---------- geometry ----------

function ringArea(ring, cosLat) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * cosLat * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(sum / 2);
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** Area-weighted centroid of the outer rings (good enough for membership). */
function centroidOf(geometry) {
  let ax = 0;
  let ay = 0;
  let total = 0;
  for (const polygon of polygonsOf(geometry)) {
    const ring = polygon[0];
    if (!ring?.length) continue;
    let cx = 0;
    let cy = 0;
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
    if (Math.abs(a) < 1e-14) {
      cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      a = 1e-12;
      ax += cx * a;
      ay += cy * a;
      total += a;
      continue;
    }
    cx /= 3 * a;
    cy /= 3 * a;
    const weight = Math.abs(a);
    ax += cx * weight;
    ay += cy * weight;
    total += weight;
  }
  return total ? [ax / total, ay / total] : null;
}

function areaOf(geometry) {
  let area = 0;
  for (const polygon of polygonsOf(geometry)) {
    const cosLat = Math.cos(((polygon[0]?.[0]?.[1] || 0) * Math.PI) / 180);
    area += ringArea(polygon[0], cosLat);
    for (const hole of polygon.slice(1)) area -= ringArea(hole, cosLat);
  }
  return Math.max(0, area);
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function inGeometry(point, geometry) {
  return polygonsOf(geometry).some(
    (polygon) =>
      inRing(point, polygon[0]) &&
      !polygon.slice(1).some((hole) => inRing(point, hole)),
  );
}

function bboxOf(geometry) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygonsOf(geometry))
    for (const [x, y] of polygon[0]) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  return box;
}

const round = (value, digits = 5) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function roundGeometry(geometry) {
  const roundRing = (ring) => ring.map(([x, y]) => [round(x, 4), round(y, 4)]);
  if (geometry.type === 'Polygon')
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map(roundRing),
    };
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((polygon) => polygon.map(roundRing)),
  };
}

// ---------- inputs ----------

function readLines(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function readChunks(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.geojsonl'))
    .flatMap((name) => readLines(path.join(directory, name)));
}

function readCities() {
  const lines = readFileSync(path.join(SOURCE, 'sub-est2024.csv'), 'latin1')
    .trim()
    .split(/\r?\n/);
  const head = lines[0].split(',');
  const cities = new Map();
  for (const line of lines.slice(1)) {
    const values = line.split(',');
    const row = Object.fromEntries(head.map((h, i) => [h, values[i]]));
    if (row.SUMLEV !== '162' || Number(row.POPESTIMATE2024) < MIN_POPULATION)
      continue;
    cities.set(row.STATE + row.PLACE, {
      id: row.STATE + row.PLACE,
      censusName: row.NAME,
      name: cleanCityName(row.NAME),
      state: row.STNAME,
      stateFips: row.STATE,
      stateAbbr: STATE_ABBR[row.STATE] || '',
      population: Number(row.POPESTIMATE2024),
    });
  }
  return cities;
}

/** "Nashville-Davidson metropolitan government (balance)" → "Nashville". */
export function cleanCityName(censusName) {
  const special = {
    'Urban Honolulu CDP': 'Honolulu',
    'Nashville-Davidson metropolitan government (balance)': 'Nashville',
    'Louisville/Jefferson County metro government (balance)': 'Louisville',
    'Indianapolis city (balance)': 'Indianapolis',
    'Athens-Clarke County unified government (balance)': 'Athens',
    'Augusta-Richmond County consolidated government (balance)': 'Augusta',
    'Macon-Bibb County': 'Macon',
    'Lexington-Fayette urban county': 'Lexington',
    'Boise City city': 'Boise',
  };
  if (special[censusName]) return special[censusName];
  return censusName
    .replace(/\s*\(balance\)$/, '')
    .replace(
      /\s+(city|town|village|borough|municipality|CDP|consolidated government|metropolitan government|unified government|urban county|metro government|charter township|township)$/i,
      '',
    )
    .trim();
}

const ACS_FILE = path.join(SOURCE, 'acs2024_social.json');
let acsCache = null;
/** ACS 2020–2024 measures by geography (scripts/fetch-acs-social.mjs). */
function readAcs() {
  acsCache ||= JSON.parse(readFileSync(ACS_FILE, 'utf8'));
  return acsCache;
}

const SEGREGATION_DIR = 'public/context/segregation';
let segregationCache = null;
/** City dissimilarity indices by 7-digit place GEOID (the segregation layers). */
function readSegregation() {
  if (segregationCache) return segregationCache;
  segregationCache = new Map();
  for (const name of readdirSync(SEGREGATION_DIR).filter((n) =>
    n.endsWith('.geojsonl'),
  ))
    for (const line of readFileSync(
      path.join(SEGREGATION_DIR, name),
      'utf8',
    ).split('\n'))
      if (line.trim()) {
        const { properties } = JSON.parse(line);
        segregationCache.set(String(properties.geoid), properties);
      }
  return segregationCache;
}

const SEGREGATION_AREAS = 'data/source/segregation/area-indices.json';
let segregationAreasCache = null;
/** County and state dissimilarity indices (scripts/build-segregation-layers.mjs). */
function readSegregationAreas() {
  segregationAreasCache ||= JSON.parse(readFileSync(SEGREGATION_AREAS, 'utf8'));
  return segregationAreasCache;
}

function readPopulation() {
  const population = new Map();
  for (const [geoid, values] of Object.entries(readAcs().tract))
    if (Number.isFinite(values.pop)) population.set(geoid, values.pop);
  return population;
}

// ---------- aggregation ----------

class Accumulator {
  constructor() {
    this.sum = 0;
    this.weight = 0;
    this.count = 0;
  }
  add(value, weight) {
    if (!Number.isFinite(value) || !(weight > 0)) return;
    this.sum += value * weight;
    this.weight += weight;
    this.count += 1;
  }
  mean() {
    return this.weight > 0 ? this.sum / this.weight : null;
  }
}

/** Nearest-tract lookup on a coarse grid, for points with no county field. */
function createTractGrid(tracts) {
  const cell = 0.05;
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  for (const tract of tracts) {
    const k = key(...tract.centroid);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(tract);
  }
  return (point) => {
    const gx = Math.floor(point[0] / cell);
    const gy = Math.floor(point[1] / cell);
    let best = null;
    let bestDistance = Infinity;
    for (let radius = 0; radius <= 6 && !best; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1)
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (const tract of grid.get(`${gx + dx}:${gy + dy}`) || []) {
            const d =
              (tract.centroid[0] - point[0]) ** 2 +
              (tract.centroid[1] - point[1]) ** 2;
            if (d < bestDistance) {
              bestDistance = d;
              best = tract;
            }
          }
        }
    }
    return best;
  };
}

function main() {
  const cities = readCities();
  const population = readPopulation();
  const places = JSON.parse(
    readFileSync(path.join(SOURCE, 'places_100k.geojson'), 'utf8'),
  ).features;
  for (const place of places) {
    const city = cities.get(place.properties.GEOID);
    if (!city) continue;
    city.geometry = place.geometry;
    city.bbox = bboxOf(place.geometry);
    city.center = centroidOf(place.geometry);
  }
  const cityList = [...cities.values()].filter((city) => city.geometry);
  const cityFor = (point) =>
    cityList.find(
      (city) =>
        point[0] >= city.bbox[0] &&
        point[0] <= city.bbox[2] &&
        point[1] >= city.bbox[1] &&
        point[1] <= city.bbox[3] &&
        inGeometry(point, city.geometry),
    ) || null;

  // 2020 tracts: population, air quality, park access, county names.
  const countyNames = new Map();
  const tracts2020 = readChunks('public/context/tracts-2020').map((feature) => {
    const p = feature.properties;
    const geoid = String(p.geoid);
    const county = String(p.name || '').split(', ')[1];
    if (county) countyNames.set(geoid.slice(0, 5), county);
    return {
      geoid,
      county: geoid.slice(0, 5),
      state: geoid.slice(0, 2),
      centroid: centroidOf(feature.geometry),
      population: population.get(geoid) || 0,
      pm25: Number(p.pm25),
      o3: Number(p.o3),
      park: Number(p.park),
    };
  });
  const knownTracts = new Set(tracts2020.map((t) => t.geoid));
  const childPopulation = new Map();
  for (const [geoid, pop] of population) {
    const prefix = geoid.slice(0, 9);
    childPopulation.set(prefix, (childPopulation.get(prefix) || 0) + pop);
  }
  // 2010 tracts (life expectancy): population from the matching 2020 tract,
  // or from the 2020 tracts it split into.
  const tracts2010 = readChunks('public/context/life-expectancy').map(
    (feature) => {
      const p = feature.properties;
      const geoid = String(p.geoid);
      const pop =
        population.get(geoid) ||
        (!knownTracts.has(geoid) && childPopulation.get(geoid.slice(0, 9))) ||
        FALLBACK_TRACT_POPULATION;
      return {
        geoid,
        county: geoid.slice(0, 5),
        state: geoid.slice(0, 2),
        centroid: centroidOf(feature.geometry),
        population: pop,
        // USALEEP stores a suppressed estimate as 0; treat it as missing.
        lifeExpectancy:
          Number(p.life_exp_8) > MIN_LIFE_EXPECTANCY
            ? Number(p.life_exp_8)
            : NaN,
        shortLife: p.cluster === 'LL' ? 100 : 0,
      };
    },
  );

  // Membership.
  for (const tract of [...tracts2020, ...tracts2010]) {
    tract.city = tract.centroid ? cityFor(tract.centroid)?.id || null : null;
  }

  const levels = ['city', 'county', 'state'];
  const scopeKey = (level, tract, city) =>
    level === 'city'
      ? tract.city === city.id
      : level === 'county'
        ? tract.county === city.countyFips
        : tract.state === city.stateFips;

  // Principal county and populations.
  for (const city of cityList) {
    const byCounty = new Map();
    for (const tract of tracts2020)
      if (tract.city === city.id)
        byCounty.set(
          tract.county,
          (byCounty.get(tract.county) || 0) + tract.population,
        );
    city.countyFips =
      [...byCounty].sort((a, b) => b[1] - a[1])[0]?.[0] ||
      tracts2020.find((t) => t.state === city.stateFips)?.county ||
      null;
    city.countyName = countyNames.get(city.countyFips) || '';
  }
  const populationOf = new Map();
  const addPopulation = (key, pop) =>
    populationOf.set(key, (populationOf.get(key) || 0) + pop);
  for (const tract of tracts2020) {
    addPopulation(`county:${tract.county}`, tract.population);
    addPopulation(`state:${tract.state}`, tract.population);
    if (tract.city) addPopulation(`city:${tract.city}`, tract.population);
  }

  // Point layers and HOLC are assigned once, then summed per scope.
  const nearestTract = createTractGrid(tracts2020);
  const placePoint = (point) => {
    const tract = nearestTract(point);
    return {
      city: cityFor(point)?.id || null,
      county: tract?.county || null,
      state: tract?.state || null,
    };
  };
  const housing = readLines(
    'src/data/local_data/public_housing/developments.geojsonl',
  ).map((feature) => ({
    ...placePoint(feature.geometry.coordinates),
    units: Number(feature.properties.units) || 0,
  }));
  const trauma = readLines(
    'src/data/local_data/trauma_centers/trauma_centers.geojsonl',
  )
    .filter((feature) =>
      /Level (I|II)\b(?!I)/.test(String(feature.properties.trauma_level || '')),
    )
    .map((feature) => placePoint(feature.geometry.coordinates));
  const holc = readChunks('public/context/holc')
    .filter((feature) => /^[ABCD]/.test(String(feature.properties.holc_grade)))
    .map((feature) => {
      const centroid = centroidOf(feature.geometry);
      return {
        ...(centroid ? placePoint(centroid) : {}),
        grade: String(feature.properties.holc_grade)[0],
        area: areaOf(feature.geometry),
      };
    });

  const scopeMatch = (level, item, city) =>
    level === 'city'
      ? item.city === city.id
      : level === 'county'
        ? item.county === city.countyFips
        : item.state === city.stateFips;
  const popFor = (level, city) =>
    level === 'city'
      ? populationOf.get(`city:${city.id}`) || city.population
      : level === 'county'
        ? populationOf.get(`county:${city.countyFips}`) || null
        : populationOf.get(`state:${city.stateFips}`) || null;

  // Per-scope accumulations are cached: many cities share a county or state.
  const memo = new Map();
  const cached = (key, compute) => {
    if (!memo.has(key)) memo.set(key, compute());
    return memo.get(key);
  };
  const scopeId = (level, city) =>
    level === 'city'
      ? city.id
      : level === 'county'
        ? city.countyFips
        : city.stateFips;

  const outCities = cityList
    .sort((a, b) => b.population - a.population)
    .map((city) => {
      const stats = {};
      const values = {
        'life-expectancy': {},
        'short-life-clusters': {},
        pm25: {},
        ozone: {},
        'park-access': {},
        'holc-hazardous': {},
        'public-housing': {},
        'trauma-centers': {},
      };
      // Census social measures come straight from the ACS place, county and
      // state estimates (no tract averaging).
      const acs = readAcs();
      for (const [key, layer] of Object.entries(CURATED_LAYERS)) {
        if (!layer.acs) continue;
        values[key] = {
          city: acs.place[city.id]?.[layer.acs] ?? null,
          county: acs.county[city.countyFips]?.[layer.acs] ?? null,
          state: acs.state[city.stateFips]?.[layer.acs] ?? null,
        };
      }
      // Segregation: the city's index, and the same index over all tracts of
      // its principal county and its state (scripts/build-segregation-layers.mjs).
      const segregation = readSegregation().get(city.id) || {};
      const areas = readSegregationAreas();
      const countySeg = areas.county[city.countyFips] || {};
      const stateSeg = areas.state[city.stateFips] || {};
      for (const [key, layer] of Object.entries(CURATED_LAYERS)) {
        if (!layer.segregation) continue;
        const value = (suffix) =>
          Number.isFinite(segregation[`${layer.segregation}${suffix}`])
            ? segregation[`${layer.segregation}${suffix}`]
            : null;
        values[key] = {
          city: value('24'),
          county: Number.isFinite(countySeg[`${layer.segregation}24`])
            ? countySeg[`${layer.segregation}24`]
            : null,
          state: Number.isFinite(stateSeg[`${layer.segregation}24`])
            ? stateSeg[`${layer.segregation}24`]
            : null,
          history: { 2000: value('00'), 2010: value('10') },
        };
      }
      const tractCounts = {};
      for (const level of levels) {
        const id = scopeId(level, city);
        const t2010 = cached(`2010:${level}:${id}`, () => {
          const le = new Accumulator();
          const cluster = new Accumulator();
          for (const tract of tracts2010)
            if (scopeKey(level, tract, city)) {
              le.add(tract.lifeExpectancy, tract.population);
              cluster.add(tract.shortLife, tract.population);
            }
          return { le: le.mean(), cluster: cluster.mean(), n: le.count };
        });
        const t2020 = cached(`2020:${level}:${id}`, () => {
          const pm = new Accumulator();
          const oz = new Accumulator();
          const park = new Accumulator();
          let n = 0;
          for (const tract of tracts2020)
            if (scopeKey(level, tract, city)) {
              n += 1;
              pm.add(tract.pm25, tract.population);
              oz.add(tract.o3, tract.population);
              park.add(tract.park, tract.population);
            }
          return { pm: pm.mean(), oz: oz.mean(), park: park.mean(), n };
        });
        const points = cached(`points:${level}:${id}`, () => {
          let units = 0;
          let centers = 0;
          let graded = 0;
          let hazardous = 0;
          for (const item of housing)
            if (scopeMatch(level, item, city)) units += item.units;
          for (const item of trauma)
            if (scopeMatch(level, item, city)) centers += 1;
          for (const item of holc)
            if (scopeMatch(level, item, city)) {
              graded += item.area;
              if (item.grade === 'D') hazardous += item.area;
            }
          return { units, centers, graded, hazardous };
        });
        const pop = popFor(level, city);
        values['life-expectancy'][level] = round(t2010.le, 2);
        values['short-life-clusters'][level] = round(t2010.cluster, 2);
        values.pm25[level] = round(t2020.pm, 2);
        values.ozone[level] = round(t2020.oz, 2);
        values['park-access'][level] = round(t2020.park, 2);
        values['holc-hazardous'][level] = points.graded
          ? round((points.hazardous / points.graded) * 100, 2)
          : null;
        values['public-housing'][level] = pop
          ? round((points.units / pop) * 1000, 3)
          : null;
        values['trauma-centers'][level] = pop
          ? round((points.centers / pop) * 100000, 3)
          : null;
        tractCounts[level] = { tracts2010: t2010.n, tracts2020: t2020.n };
        stats[`population_${level}`] = pop;
        stats[`count_${level}`] = {
          publicHousingUnits: points.units,
          traumaCenters: points.centers,
        };
      }
      return {
        id: city.id,
        name: city.name,
        censusName: city.censusName,
        state: city.state,
        stateAbbr: city.stateAbbr,
        stateFips: city.stateFips,
        county: { fips: city.countyFips, name: city.countyName },
        population: city.population,
        populations: {
          city: stats.population_city,
          county: stats.population_county,
          state: stats.population_state,
        },
        counts: {
          city: stats.count_city,
          county: stats.count_county,
          state: stats.count_state,
        },
        tracts: tractCounts,
        center: city.center.map((value) => round(value, 5)),
        bbox: city.bbox.map((value) => round(value, 5)),
        boundary: roundGeometry(city.geometry),
        values,
      };
    });

  // County lookup for the research layers, which are counted in the browser:
  // the tract centroids in and around each principal county, flagged by
  // membership, so an incident point takes its nearest tract's county.
  const counties = {};
  const COUNTY_MARGIN = 0.03;
  for (const city of outCities) {
    const fips = city.county.fips;
    if (!fips || counties[fips]) continue;
    const own = tracts2020.filter((t) => t.county === fips && t.centroid);
    if (!own.length) continue;
    const box = own.reduce(
      (b, t) => [
        Math.min(b[0], t.centroid[0]),
        Math.min(b[1], t.centroid[1]),
        Math.max(b[2], t.centroid[0]),
        Math.max(b[3], t.centroid[1]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const bbox = [
      box[0] - COUNTY_MARGIN,
      box[1] - COUNTY_MARGIN,
      box[2] + COUNTY_MARGIN,
      box[3] + COUNTY_MARGIN,
    ];
    counties[fips] = {
      name: city.county.name,
      bbox: bbox.map((v) => round(v, 4)),
      points: tracts2020
        .filter(
          (t) =>
            t.centroid &&
            t.centroid[0] >= bbox[0] &&
            t.centroid[0] <= bbox[2] &&
            t.centroid[1] >= bbox[1] &&
            t.centroid[1] <= bbox[3],
        )
        .map((t) => [
          round(t.centroid[0], 4),
          round(t.centroid[1], 4),
          t.county === fips ? 1 : 0,
        ]),
    };
  }

  const output = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    method:
      'Area measures are population-weighted tract averages (ACS 2020–2024 5-year population, table B01003); Census social measures are the ACS 2020–2024 estimates published for each city (Census place), county and state. A tract or point belongs to a city when its centroid lies inside the Census city boundary; county = the county holding most of the city’s residents.',
    sources: [
      'U.S. Census Bureau, Vintage 2024 Population Estimates (cities and towns).',
      'U.S. Census Bureau, TIGERweb incorporated place boundaries.',
      'U.S. Census Bureau, American Community Survey 2020–2024 5-year estimates (tables B01003, B03002, B15003, B17001, B19013, B23025, B25003, B25044, B28002), table-based summary files.',
      'CDC/NCHS U.S. Small-area Life Expectancy Estimates Project (USALEEP), 2010–2015.',
      'CDC Environmental Public Health Tracking, PM2.5 (2021) and ozone (2022) downscaler estimates.',
      'Mapping Inequality (University of Richmond), HOLC area grades.',
      'HUD Public Housing Developments; HIFLD Hospitals (trauma designation).',
    ],
    layers: CURATED_LAYERS,
    cities: outCities,
    counties,
  };
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(output));
  const sample = outCities.find((city) => city.id === '2622000');
  console.log(
    `curated flights: ${outCities.length} cities, ${(JSON.stringify(output).length / 1e6).toFixed(1)} MB`,
  );
  if (sample)
    console.log(
      `Detroit: LE ${JSON.stringify(sample.values['life-expectancy'])} PM2.5 ${JSON.stringify(sample.values.pm25)} county ${sample.county.name} tracts ${JSON.stringify(sample.tracts.city)}`,
    );
}

if (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('build-curated-flights.mjs')
)
  main();
