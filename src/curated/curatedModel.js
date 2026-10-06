/**
 * Curated Flights, the pure part: matching spoken or typed city and layer
 * names against the city table, validating a flight plan (up to 3 cities, up
 * to 6 layers), and turning values into comparison sentences and table rows.
 * No DOM, no Cesium: the panel, the voice actions and the tests share it.
 */

export const MAX_CITIES = 3;
export const MAX_LAYERS = 6;

/** Words people say for each flight layer (the table's keys are canonical). */
export const LAYER_ALIASES = Object.freeze({
  'life-expectancy': ['life expectancy', 'life span', 'longevity', 'lifespan'],
  'short-life-clusters': [
    'short life clusters',
    'life expectancy clusters',
    'clusters',
    'low life expectancy clusters',
    'hot spots',
  ],
  pm25: [
    'pm2.5',
    'pm 2.5',
    'pm25',
    'fine particulate',
    'particulates',
    'air quality',
    'air pollution',
    'soot',
  ],
  ozone: ['ozone', 'smog'],
  'park-access': ['park access', 'parks', 'green space', 'greenspace'],
  'holc-hazardous': [
    'holc',
    'redlining',
    'redlined',
    'hazardous',
    'red lining',
  ],
  'public-housing': ['public housing', 'housing projects', 'hud housing'],
  'trauma-centers': ['trauma centers', 'trauma centres', 'trauma', 'hospitals'],
  'gva-2015': [
    'gva',
    'gun violence',
    'gun deaths',
    'gun violence archive',
    'shootings',
  ],
  mkdb: ['mkdb', 'mass killings', 'mass killing', 'mass shootings'],
  'segregation-bw': [
    'black white segregation',
    'black-white segregation',
    'black white dissimilarity',
    'segregation',
    'residential segregation',
  ],
  'segregation-hw': [
    'latino white segregation',
    'hispanic white segregation',
    'latino-white segregation',
    'white latino segregation',
    'latino white dissimilarity',
  ],
  'segregation-aw': [
    'asian white segregation',
    'asian-white segregation',
    'white asian segregation',
    'asian white dissimilarity',
  ],
  poverty: ['poverty', 'poverty rate', 'below poverty', 'poor'],
  'median-income': [
    'median income',
    'income',
    'household income',
    'median household income',
  ],
  unemployment: [
    'unemployment',
    'unemployment rate',
    'jobless',
    'jobless rate',
  ],
  bachelors: [
    'education',
    'college',
    "bachelor's",
    'bachelors',
    'college degree',
    'educational attainment',
  ],
  renters: ['renters', 'renting', 'tenure', 'renter occupied', 'homeownership'],
  black: ['black', 'black residents', 'african american', 'race'],
  hispanic: ['hispanic', 'latino', 'latinx', 'hispanic residents'],
  'no-vehicle': [
    'no vehicle',
    'no car',
    'car free',
    'households without a car',
  ],
  broadband: [
    'broadband',
    'internet',
    'internet access',
    'high speed internet',
  ],
  // The user's own upload (present only once a file is added).
  'my-data': [
    'my data',
    'my upload',
    'my file',
    'my layer',
    'uploaded data',
    'user data',
    'our data',
  ],
});

const STATE_NAMES = Object.freeze({
  AL: 'alabama',
  AK: 'alaska',
  AZ: 'arizona',
  AR: 'arkansas',
  CA: 'california',
  CO: 'colorado',
  CT: 'connecticut',
  DE: 'delaware',
  DC: 'district of columbia',
  FL: 'florida',
  GA: 'georgia',
  HI: 'hawaii',
  ID: 'idaho',
  IL: 'illinois',
  IN: 'indiana',
  IA: 'iowa',
  KS: 'kansas',
  KY: 'kentucky',
  LA: 'louisiana',
  ME: 'maine',
  MD: 'maryland',
  MA: 'massachusetts',
  MI: 'michigan',
  MN: 'minnesota',
  MS: 'mississippi',
  MO: 'missouri',
  MT: 'montana',
  NE: 'nebraska',
  NV: 'nevada',
  NH: 'new hampshire',
  NJ: 'new jersey',
  NM: 'new mexico',
  NY: 'new york',
  NC: 'north carolina',
  ND: 'north dakota',
  OH: 'ohio',
  OK: 'oklahoma',
  OR: 'oregon',
  PA: 'pennsylvania',
  RI: 'rhode island',
  SC: 'south carolina',
  SD: 'south dakota',
  TN: 'tennessee',
  TX: 'texas',
  UT: 'utah',
  VT: 'vermont',
  VA: 'virginia',
  WA: 'washington',
  WV: 'west virginia',
  WI: 'wisconsin',
  WY: 'wyoming',
});

/** Lowercase, accent-free, punctuation as spaces, "saint" for "st". */
export function normalizeName(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\bst\.?\s/g, 'saint ')
    .replace(/\bft\.?\s/g, 'fort ')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split "Detroit, MI" / "Detroit Michigan" into a city part and a state. */
function splitState(query) {
  const text = normalizeName(query)
    .replace(/\bcity of\b/g, '')
    .trim();
  for (const [abbr, name] of Object.entries(STATE_NAMES)) {
    for (const suffix of [name, abbr.toLowerCase()]) {
      if (text.endsWith(` ${suffix}`) && text.length > suffix.length + 1)
        return { city: text.slice(0, -suffix.length).trim(), state: abbr };
    }
  }
  return { city: text, state: null };
}

/**
 * Find a city by name. With no state, the largest city of that name wins and
 * the others come back as `alternatives` so the caller can mention them.
 */
export function findCity(cities, query) {
  const { city: wanted, state } = splitState(query);
  if (!wanted) return { city: null, alternatives: [] };
  const scored = [];
  for (const city of cities || []) {
    if (state && city.stateAbbr !== state) continue;
    const name = normalizeName(city.name);
    const census = normalizeName(city.censusName);
    let score = 0;
    if (name === wanted) score = 3;
    else if (census === wanted || census.startsWith(`${wanted} `)) score = 2;
    else if (name.startsWith(wanted) || wanted.startsWith(name)) score = 1;
    if (score) scored.push({ city, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || b.city.population - a.city.population,
  );
  const best = scored[0]?.city || null;
  return {
    city: best,
    alternatives: scored
      .filter(({ city, score }) => city !== best && score === scored[0].score)
      .map(({ city }) => city),
  };
}

/** Resolve a layer name ("air quality", "redlining", "pm25") to its key. */
export function findLayer(layers, query) {
  const wanted = normalizeName(query);
  if (!wanted) return null;
  if (layers?.[wanted]) return wanted;
  for (const [key, layer] of Object.entries(layers || {})) {
    if (normalizeName(key) === wanted || normalizeName(layer.label) === wanted)
      return key;
  }
  for (const [key, aliases] of Object.entries(LAYER_ALIASES)) {
    if (!layers?.[key]) continue;
    if (aliases.some((alias) => normalizeName(alias) === wanted)) return key;
  }
  for (const [key, aliases] of Object.entries(LAYER_ALIASES)) {
    if (!layers?.[key]) continue;
    if (
      aliases.some(
        (alias) =>
          wanted.includes(normalizeName(alias)) ||
          normalizeName(alias).includes(wanted),
      )
    )
      return key;
  }
  return null;
}

/**
 * Validate a requested flight. Unknown names, duplicates and anything past
 * the limits are reported in `problems` rather than silently dropped.
 */
export function planFlight(
  { cities = [], layers = [], record = false } = {},
  table,
) {
  const problems = [];
  const resolvedCities = [];
  for (const query of cities) {
    const { city, alternatives } = findCity(table?.cities, query);
    if (!city) {
      problems.push(`No US city of 100,000+ people matches “${query}”.`);
      continue;
    }
    if (resolvedCities.includes(city)) continue;
    if (resolvedCities.length >= MAX_CITIES) {
      problems.push(
        `A flight visits at most ${MAX_CITIES} cities; skipped ${city.name}.`,
      );
      continue;
    }
    if (alternatives.length)
      problems.push(
        `“${query}” matched ${city.name}, ${city.stateAbbr} (also: ${alternatives
          .map((alt) => `${alt.name}, ${alt.stateAbbr}`)
          .join('; ')}). Add the state to choose another.`,
      );
    resolvedCities.push(city);
  }
  const resolvedLayers = [];
  for (const query of layers) {
    const key = findLayer(table?.layers, query);
    if (!key) {
      const wantsUpload =
        query === 'my-data' ||
        LAYER_ALIASES['my-data'].includes(normalizeName(query));
      problems.push(
        wantsUpload
          ? 'No file has been added yet: add your data under “Your data” in the Curated Flights panel.'
          : `No flight layer matches “${query}”.`,
      );
      continue;
    }
    if (resolvedLayers.includes(key)) continue;
    if (resolvedLayers.length >= MAX_LAYERS) {
      problems.push(
        `A flight shows at most ${MAX_LAYERS} layers; skipped ${table.layers[key].label}.`,
      );
      continue;
    }
    resolvedLayers.push(key);
  }
  if (!resolvedCities.length) problems.push('Choose at least one city.');
  if (!resolvedLayers.length) problems.push('Choose at least one layer.');
  return {
    ok: resolvedCities.length > 0 && resolvedLayers.length > 0,
    cities: resolvedCities,
    layers: resolvedLayers,
    record: Boolean(record),
    problems,
  };
}

/** "72.2 years", "9.8 µg/m³", "—" for no data. */
export function formatValue(layer, value) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—';
  const digits = layer?.decimals ?? 1;
  const number = value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const unit = layer?.unit || '';
  if (unit.startsWith('%')) return `${number}%`;
  if (unit === 'dollars') return `$${number}`;
  return unit ? `${number} ${unit}` : number;
}

/** The value set for one city and layer, research values included. */
export function layerValues(city, key, research = {}) {
  return research[city.id]?.[key] || city.values?.[key] || {};
}

/** County and state labels for a city: "Wayne County", "Michigan". */
export function scopeLabels(city) {
  return {
    city: city.name,
    county: city.county?.name || 'County',
    state: city.state,
  };
}

/**
 * The highlight line for a city and layer, e.g.
 * "Detroit: 72.2 years, 2.9 years below Wayne County and 5.9 years below Michigan."
 */
export function compareSentence(layer, city, values) {
  const labels = scopeLabels(city);
  const cityValue = values?.city;
  if (!Number.isFinite(cityValue)) {
    // County- or state-level data (an upload) still compares the region.
    const region = [
      [values?.county, labels.county],
      [values?.state, labels.state],
    ]
      .filter(([value]) => Number.isFinite(value))
      .map(([value, label]) => `${label}: ${formatValue(layer, value)}`);
    return region.length
      ? `${labels.city}: no city value. ${region.join('; ')}.`
      : `${labels.city}: no ${layer.label.toLowerCase()} data for this city.`;
  }
  const unit = layer.unit?.startsWith('%')
    ? ' points'
    : layer.unit === 'dollars'
      ? ''
      : ` ${layer.unit}`;
  const money = layer.unit === 'dollars';
  const digits = layer.decimals ?? 1;
  const versus = (other, label) => {
    if (!Number.isFinite(other)) return null;
    // Difference of the rounded values, so it matches the numbers shown.
    const shown = (value) => Number(value.toFixed(digits));
    const delta = shown(cityValue) - shown(other);
    if (Math.abs(delta) < 0.5 * 10 ** -digits)
      return `about the same as ${label}`;
    const size = money
      ? `$${Math.abs(delta).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      : `${Math.abs(delta).toFixed(digits)}${unit}`;
    return `${size} ${delta > 0 ? 'above' : 'below'} ${label}`;
  };
  const parts = [
    versus(values.county, labels.county),
    versus(values.state, labels.state),
  ].filter(Boolean);
  // City-only measures (segregation) carry earlier years instead.
  const earlier = Object.entries(values.history || {})
    .filter(([, value]) => Number.isFinite(value))
    .map(([year, value]) => `${year}: ${value.toFixed(digits)}`);
  return `${labels.city}: ${formatValue(layer, cityValue)}${
    parts.length ? `, ${parts.join(' and ')}` : ''
  }${earlier.length ? ` (${earlier.join(', ')})` : ''}.`;
}

/** One row per city × layer for the data download and the report table. */
export function comparisonRows(plan, table, research = {}) {
  const rows = [];
  for (const city of plan.cities) {
    for (const key of plan.layers) {
      const layer = table.layers[key];
      const values = layerValues(city, key, research);
      rows.push({
        city: city.name,
        state: city.state,
        county: city.county?.name || '',
        cityPopulation: city.population,
        layer: layer.label,
        unit: layer.unit,
        cityValue: values.city ?? null,
        countyValue: values.county ?? null,
        stateValue: values.state ?? null,
        city2000: values.history?.[2000] ?? null,
        city2010: values.history?.[2010] ?? null,
        vintage: layer.vintage,
        note: layer.note,
        table: layer.table || '',
        source: layer.source || '',
      });
    }
  }
  return rows;
}

export const ROW_COLUMNS = Object.freeze([
  ['city', 'City'],
  ['state', 'State'],
  ['county', 'County'],
  ['cityPopulation', 'City population (2024 est.)'],
  ['layer', 'Layer'],
  ['unit', 'Unit'],
  ['cityValue', 'City value'],
  ['countyValue', 'County value'],
  ['stateValue', 'State value'],
  ['city2000', 'City value 2000'],
  ['city2010', 'City value 2010'],
  ['vintage', 'Data years'],
  ['note', 'Definition'],
  ['table', 'Census table / dataset'],
  ['source', 'Data source'],
]);

/** RFC 4180 CSV (UTF-8 with BOM so Excel reads µ and – correctly). */
export function rowsToCsv(rows) {
  const cell = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [ROW_COLUMNS.map(([, label]) => cell(label)).join(',')];
  for (const row of rows)
    lines.push(ROW_COLUMNS.map(([key]) => cell(row[key])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Point-in-polygon for GeoJSON Polygon / MultiPolygon ([lon, lat]). */
export function pointInGeometry(point, geometry) {
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  const inRing = ([x, y], ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  };
  return polygons.some(
    (polygon) =>
      inRing(point, polygon[0]) &&
      !polygon.slice(1).some((hole) => inRing(point, hole)),
  );
}

/** Whether a point lies in a county, by its nearest tract centroid. */
export function pointInCounty(point, county) {
  if (!county?.points?.length) return false;
  const [w, s, e, n] = county.bbox;
  if (point[0] < w || point[0] > e || point[1] < s || point[1] > n)
    return false;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of county.points) {
    const d = (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best?.[2] === 1;
}

/**
 * City / county / state rates for a research layer from its incident features
 * (counted in the browser once the research key unlocks them).
 *  - gva-2015: deaths (killed) per 100,000 residents
 *  - mkdb: incidents per 1,000,000 residents
 */
export function researchRates(key, features, city, county) {
  const perResidents = key === 'mkdb' ? 1_000_000 : 100_000;
  const weight = (feature) =>
    key === 'mkdb' ? 1 : Number(feature.properties?.killed) || 0;
  const inState = (feature) =>
    key === 'mkdb'
      ? String(feature.properties?.name || '').endsWith(`, ${city.stateAbbr}`)
      : feature.properties?.state === city.state;
  const totals = { city: 0, county: 0, state: 0 };
  for (const feature of features || []) {
    const point = feature.geometry?.coordinates;
    if (!Array.isArray(point)) continue;
    const w = weight(feature);
    if (inState(feature)) totals.state += w;
    if (pointInCounty(point, county)) totals.county += w;
    if (pointInGeometry(point, city.boundary)) totals.city += w;
  }
  const rate = (total, population) =>
    population > 0 ? (total / population) * perResidents : null;
  return {
    city: rate(totals.city, city.populations?.city || city.population),
    county: county ? rate(totals.county, city.populations?.county) : null,
    state: rate(totals.state, city.populations?.state),
    counts: totals,
  };
}
