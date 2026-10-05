import { createLocalGeoJsonLayer } from './localGeojsonCore.js';
import { createChunkedAreaLayer } from './chunkedAreaLayer.js';

// Nationwide context layers, chunked by county under public/context/ by
// scripts/build-context-layers.mjs and loaded only for the counties in view.
const HOLC_GRADES = Object.freeze([
  { grade: 'A', label: 'A Best', color: '#76a865' },
  { grade: 'B', label: 'B Still Desirable', color: '#7cb5bd' },
  { grade: 'C', label: 'C Declining', color: '#ffff00' },
  { grade: 'D', label: 'D Hazardous', color: '#d9533c' },
]);
// USALEEP's published national quintile bins for life_exp_8 (years).
const LIFE_EXPECTANCY_BINS = Object.freeze([
  { label: '≤75.1', color: '#b2182b', min: -Infinity, max: 75.15 },
  { label: '75.2–77.5', color: '#ef8a62', min: 75.15, max: 77.55 },
  { label: '77.6–79.5', color: '#fddbc7', min: 77.55, max: 79.55 },
  { label: '79.6–81.6', color: '#67a9cf', min: 79.55, max: 81.65 },
  { label: '≥81.7', color: '#2166ac', min: 81.65, max: Infinity },
]);
const NO_DATA_COLOR = '#9e9e9e';

function lifeExpectancyBin(years) {
  if (!(Number(years) > 0)) return null;
  return LIFE_EXPECTANCY_BINS.find((b) => years >= b.min && years < b.max);
}

/** Legend rows for a layer shaded by lifeExpectancyBin(property). */
function lifeExpectancyLegend(key) {
  return [
    ...LIFE_EXPECTANCY_BINS.map((b) => ({
      label: b.label,
      color: b.color,
      test: (p) => lifeExpectancyBin(p[key]) === b,
    })),
    {
      label: 'No data',
      color: NO_DATA_COLOR,
      test: (p) => !lifeExpectancyBin(p[key]),
    },
  ];
}

// Local Moran's I cluster types for life expectancy, colored like the life
// expectancy bins (blue = longer lives, red = shorter). Only significant
// clusters and outliers are in the data.
const LIFE_EXPECTANCY_CLUSTERS = Object.freeze([
  { type: 'HH', label: 'High–High (long-life cluster)', color: '#2166ac' },
  { type: 'LL', label: 'Low–Low (short-life cluster)', color: '#b2182b' },
  { type: 'HL', label: 'High–Low outlier', color: '#92c5de' },
  { type: 'LH', label: 'Low–High outlier', color: '#f4a582' },
]);
const clusterColor = (p) =>
  LIFE_EXPECTANCY_CLUSTERS.find((c) => c.type === p.cluster)?.color ||
  NO_DATA_COLOR;
const clusterLegend = () =>
  LIFE_EXPECTANCY_CLUSTERS.map((c) => ({
    label: c.label,
    color: c.color,
    test: (p) => p.cluster === c.type,
  }));
// Card wording for a tract's cluster (formerly stored in every feature).
const CLUSTER_WORDING = Object.freeze({
  HH: ['long-life cluster (high–high)', 'high, and so are its neighbors'],
  LL: ['short-life cluster (low–low)', 'low, and so are its neighbors'],
  HL: ['high outlier (high–low)', 'high while its neighbors are low'],
  LH: ['low outlier (low–high)', 'low while its neighbors are high'],
});
function tractClusterSummary(p) {
  const [label, detail] = CLUSTER_WORDING[p.cluster] || [];
  if (!label) return 'Not a significant cluster.';
  const value = Number.isFinite(p.life_exp_8)
    ? `${p.life_exp_8.toFixed(1)} years`
    : 'n/a';
  const pValue = Number.isFinite(p.p_value)
    ? ` (p = ${p.p_value.toFixed(3)})`
    : '';
  return `Local Moran's I ${label}: this tract's life expectancy (${value}) is ${detail}${pValue}.`;
}
// Miami-Dade homicides 1956-2011: one pin layer per decade, each in its own
// color (the 1950s and 2000s layers are partial decades). Files are written
// by scripts/convert-miami-dade-homicides.mjs.
const HOMICIDE_DECADES = Object.freeze([
  {
    key: '1950s',
    label: '1956–1959',
    color: '#f0f921',
    url: new URL(
      './local_data/miami_dade_homicides/homicides_1950s.geojsonl',
      import.meta.url,
    ).href,
  },
  {
    key: '1960s',
    label: '1960s',
    color: '#fdb42f',
    url: new URL(
      './local_data/miami_dade_homicides/homicides_1960s.geojsonl',
      import.meta.url,
    ).href,
  },
  {
    key: '1970s',
    label: '1970s',
    color: '#f07f4f',
    url: new URL(
      './local_data/miami_dade_homicides/homicides_1970s.geojsonl',
      import.meta.url,
    ).href,
  },
  {
    key: '1980s',
    label: '1980s',
    color: '#d8576b',
    url: new URL(
      './local_data/miami_dade_homicides/homicides_1980s.geojsonl',
      import.meta.url,
    ).href,
  },
  {
    key: '1990s',
    label: '1990s',
    color: '#b83289',
    url: new URL(
      './local_data/miami_dade_homicides/homicides_1990s.geojsonl',
      import.meta.url,
    ).href,
  },
  {
    key: '2000s',
    label: '2000–2011',
    color: '#8b0aa5',
    url: new URL(
      './local_data/miami_dade_homicides/homicides_2000s.geojsonl',
      import.meta.url,
    ).href,
  },
]);
// Homicide hotspot bands (kernel density, homicides per km² over 1956-2011;
// top-weighted percentile breaks from scripts/build-miami-homicide-hotspots.mjs), off-white
// for the lowest to orange for the most concentrated.
const HOMICIDE_HOTSPOT_BANDS = Object.freeze([
  { band: 1, label: '1–3.8 per km²', color: '#fff5eb' },
  { band: 2, label: '3.8–8.7', color: '#fee6ce' },
  { band: 3, label: '8.7–16', color: '#fdd0a2' },
  { band: 4, label: '16–31', color: '#fdae6b' },
  { band: 5, label: '31–86', color: '#fd8d3c' },
  { band: 6, label: '86–532 (top 3%)', color: '#f16913' },
]);
// Air quality by census tract (scripts/build-air-quality.mjs). PM2.5 bins
// bracket the EPA annual standard (9.0 µg/m³ since 2024; 12 before).
const PM25_BINS = Object.freeze([
  { label: 'Under 6 µg/m³', color: '#1a9850', min: -Infinity, max: 6 },
  { label: '6–8', color: '#91cf60', min: 6, max: 8 },
  { label: '8–9 (just under the standard)', color: '#fee08b', min: 8, max: 9 },
  { label: '9–10 (above the EPA standard)', color: '#fc8d59', min: 9, max: 10 },
  { label: '10–12', color: '#d73027', min: 10, max: 12 },
  { label: '12 and over', color: '#7b3294', min: 12, max: Infinity },
]);
// Ozone: yearly average of each day's highest 8-hour level (ppb). Not the
// 70 ppb standard's test (the 4th-highest day), so bins are relative.
const OZONE_BINS = Object.freeze([
  { label: 'Under 32 ppb', color: '#1a9850', min: -Infinity, max: 32 },
  { label: '32–36', color: '#91cf60', min: 32, max: 36 },
  { label: '36–40', color: '#fee08b', min: 36, max: 40 },
  { label: '40–44', color: '#fc8d59', min: 40, max: 44 },
  { label: '44–48', color: '#d73027', min: 44, max: 48 },
  { label: '48 and over', color: '#7b3294', min: 48, max: Infinity },
]);
const AIR_TRACT_SOURCE_NOTE =
  'CDC Environmental Public Health Tracking Downscaler model (EPA CMAQ fused with monitor readings): PM2.5 is the 2021 annual mean, ozone the 2022 annual mean of the daily 8-hour maximum. Census 2024 tract outlines. Lower 48 states only.';
// Park access: share of residents within 1/2 mile of a park. Many city tracts
// are at 100%, so the top bin is exactly 100 and the lower bins spread out.
const PARK_ACCESS_BINS = Object.freeze([
  { label: 'Under 25%', color: '#a6611a', min: -Infinity, max: 25 },
  { label: '25–50%', color: '#dfc27d', min: 25, max: 50 },
  { label: '50–75%', color: '#c2e699', min: 50, max: 75 },
  { label: '75–99%', color: '#78c679', min: 75, max: 99.95 },
  { label: '100% (everyone)', color: '#238443', min: 99.95, max: Infinity },
]);
const PARK_ACCESS_SOURCE_NOTE =
  'CDC Environmental Public Health Tracking, Access to Parks (2020): percent of residents living within 1/2 mile of a park. Census 2024 tract outlines.';
// TIGER/Line park landmark kinds (scripts/build-environment-layers.mjs).
const PARK_KINDS = Object.freeze([
  {
    kinds: ['national-park'],
    label: 'National Park Service',
    color: '#1b5e20',
  },
  {
    kinds: ['national-forest'],
    label: 'National forest / other federal',
    color: '#558b2f',
  },
  { kinds: ['state-park'], label: 'State park', color: '#2e7d32' },
  {
    kinds: ['regional-park', 'county-park'],
    label: 'Regional / county park',
    color: '#66bb6a',
  },
  {
    kinds: ['city-park', 'park'],
    label: 'City / local park',
    color: '#9ccc65',
  },
  { kinds: ['tribal-park'], label: 'Tribal park', color: '#8d6e63' },
  {
    kinds: ['private-park', 'other-park'],
    label: 'Private / other',
    color: '#a5d6a7',
  },
]);
const parkKindLabel = (kind) =>
  PARK_KINDS.find((k) => k.kinds.includes(kind))?.label || 'Park';

// ---- Social & Economic (US): ACS 5-year tract measures ------------------
export const ACS_SOCIAL_VINTAGE = '2020–2024';
const percent =
  (digits = 1) =>
  (value) =>
    `${value.toFixed(digits)}%`;
const shareBins = (cuts, colors, suffix = '%') =>
  Object.freeze(
    colors.map((color, i) => ({
      label:
        i === 0
          ? `Under ${cuts[0]}${suffix}`
          : i === colors.length - 1
            ? `${cuts[i - 1]}${suffix} and over`
            : `${cuts[i - 1]}–${cuts[i]}${suffix}`,
      color,
      min: i === 0 ? -Infinity : cuts[i - 1],
      max: i === colors.length - 1 ? Infinity : cuts[i],
    })),
  );
// Sequential single-hue ramps, light to dark (one hue per measure).
const REDS = ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15'];
const GREENS = [
  '#edf8e9',
  '#bae4b3',
  '#74c476',
  '#31a354',
  '#006d2c',
  '#00441b',
];
const ORANGES = ['#feedde', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603'];
const BLUES = ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'];
const PURPLES = ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'];
const BROWNS = [
  '#fff7ec',
  '#fee8c8',
  '#fdbb84',
  '#e34a33',
  '#b30000',
  '#7f0000',
];
const TEALS = [
  '#f6eff7',
  '#d0d1e6',
  '#a6bddb',
  '#67a9cf',
  '#1c9099',
  '#016c59',
];
const GREYS = ['#f7f7f7', '#cccccc', '#969696', '#636363', '#252525'];

export const SOCIAL_MEASURES = Object.freeze([
  {
    id: 'local-acs-poverty',
    key: 'pov',
    name: 'Poverty (tracts)',
    icon: '◔',
    table: 'B17001',
    definition: 'share of people whose income is below the poverty level.',
    format: (v) => `${v.toFixed(1)}% of people below the poverty level`,
    bins: shareBins([10, 20, 30, 40], REDS),
  },
  {
    id: 'local-acs-income',
    key: 'inc',
    name: 'Median Household Income (tracts)',
    icon: '$',
    table: 'B19013',
    definition: 'median household income in inflation-adjusted dollars.',
    format: (v) =>
      `Median household income $${Math.round(v).toLocaleString('en-US')}`,
    bins: Object.freeze([
      { label: 'Under $35k', color: GREENS[0], min: -Infinity, max: 35000 },
      { label: '$35–55k', color: GREENS[1], min: 35000, max: 55000 },
      { label: '$55–75k', color: GREENS[2], min: 55000, max: 75000 },
      { label: '$75–100k', color: GREENS[3], min: 75000, max: 100000 },
      { label: '$100–150k', color: GREENS[4], min: 100000, max: 150000 },
      { label: '$150k and over', color: GREENS[5], min: 150000, max: Infinity },
    ]),
  },
  {
    id: 'local-acs-unemployment',
    key: 'unemp',
    name: 'Unemployment (tracts)',
    icon: '◑',
    table: 'B23025',
    definition: 'unemployed share of the civilian labor force.',
    format: (v) => `Unemployment ${v.toFixed(1)}% of the civilian labor force`,
    bins: shareBins([3, 5, 8, 12], ORANGES),
  },
  {
    id: 'local-acs-education',
    key: 'ba',
    name: "Bachelor's Degree or Higher (tracts)",
    icon: '✎',
    table: 'B15003',
    definition:
      "share of adults 25 and older with a bachelor's degree or higher.",
    format: (v) =>
      `${v.toFixed(1)}% of adults 25+ hold a bachelor's degree or higher`,
    bins: shareBins([15, 30, 45, 60], BLUES),
  },
  {
    id: 'local-acs-renters',
    key: 'rent',
    name: 'Renter-Occupied Homes (tracts)',
    icon: '⌂',
    table: 'B25003',
    definition: 'share of occupied housing units that are renter-occupied.',
    format: (v) => `${v.toFixed(1)}% of occupied homes are rented`,
    bins: shareBins([20, 40, 60, 80], PURPLES),
  },
  {
    id: 'local-acs-black',
    key: 'blk',
    name: 'Black Residents (tracts)',
    icon: '●',
    table: 'B03002',
    definition:
      'share of people who are Black or African American alone, not Hispanic or Latino.',
    format: (v) => `${v.toFixed(1)}% Black (not Hispanic)`,
    bins: shareBins([5, 20, 40, 60, 80], BROWNS),
  },
  {
    id: 'local-acs-hispanic',
    key: 'hisp',
    name: 'Hispanic or Latino Residents (tracts)',
    icon: '●',
    table: 'B03002',
    definition: 'share of people who are Hispanic or Latino (of any race).',
    format: (v) => `${v.toFixed(1)}% Hispanic or Latino`,
    bins: shareBins([5, 20, 40, 60, 80], TEALS),
  },
  {
    id: 'local-acs-no-vehicle',
    key: 'noveh',
    name: 'Households Without a Vehicle (tracts)',
    icon: '⊘',
    table: 'B25044',
    definition: 'share of occupied housing units with no vehicle available.',
    format: (v) => `${v.toFixed(1)}% of households have no vehicle`,
    bins: shareBins([5, 10, 20, 40], GREYS),
  },
  {
    id: 'local-acs-broadband',
    key: 'bb',
    name: 'Broadband at Home (tracts)',
    icon: '⌁',
    table: 'B28002',
    definition:
      'share of households with a broadband internet subscription of any type.',
    format: percent(1),
    bins: shareBins([60, 75, 85, 92], BLUES),
  },
]);

// ---- Internet Access (US): state CPS history + county ACS ---------------
// Spans 1998 (about a quarter of households online) to today (about nine in
// ten), so each survey year lands on distinguishable steps.
const INTERNET_BINS = shareBins(
  [25, 40, 55, 70, 85],
  ['#d6e6f4', '#abd0e6', '#6aaed6', '#3787c0', '#105ba4', '#08306b'],
);
// Tracts have only the ACS years (2013 on), when most households were already
// online, so their bins split the upper range more finely (same for both years).
const TRACT_INTERNET_BINS = shareBins([60, 70, 80, 90], BLUES);
const INTERNET_COUNTY_SOURCE_NOTE =
  '1998–2010: U.S. Census Bureau Current Population Survey, Computer and Internet Use Supplement, published by NTIA (Internet Use Survey, Data Explorer), share of all households; state estimates only, so each county shows its state. 2013–2017 and 2020–2024: American Community Survey 5-year estimates, table B28002, county estimates.';
const INTERNET_TRACT_SOURCE_NOTE =
  'U.S. Census Bureau, American Community Survey 5-year estimates, table B28002, census tracts. 2013–2017 (the first 5-year release with internet questions) was published on 2010 tracts; its household counts are moved onto the 2020 tracts shown here in proportion to shared land area (Census 2010–2020 tract relationship file). Tract estimates carry wide margins of error. The ACS has no tract internet data before 2013; see the county layers for 1998–2010.';

/** A 5-year ACS internet estimate (table B28002) at county or tract level. */
const acsInternetYear = (key, vintage, scope, what) => ({
  key,
  label: `${vintage.slice(0, 5)}${vintage.slice(7)}`,
  title: `${vintage}: ${scope} estimate (ACS B28002, ${what})`,
  scope,
  vintage,
});

const cpsInternetYears = (prefix, years, what) =>
  years.map((year) => ({
    key: `${prefix}${year}`,
    label: String(year),
    title: `${year}: state estimate (CPS${what ? `, ${what}` : ''})`,
    scope: 'state',
  }));

export const INTERNET_MEASURES = Object.freeze([
  {
    id: 'local-internet-use',
    name: 'Internet Use at Home (counties)',
    what: 'households where someone uses the internet at home',
    geography: 'county',
    years: [
      ...cpsInternetYears('ia', [1998, 2000, 2003, 2007, 2010]),
      acsInternetYear(
        'net17',
        '2013–2017',
        'county',
        'any internet subscription',
      ),
      acsInternetYear(
        'net',
        '2020–2024',
        'county',
        'any internet subscription',
      ),
    ],
  },
  {
    id: 'local-internet-highspeed',
    name: 'High-Speed Internet at Home (counties)',
    what: 'households with high-speed (broadband) internet at home',
    geography: 'county',
    years: [
      ...cpsInternetYears('hs', [2000, 2003, 2010], 'wired high-speed service'),
      acsInternetYear('bb17', '2013–2017', 'county', 'broadband of any type'),
      acsInternetYear('bb', '2020–2024', 'county', 'broadband of any type'),
    ],
  },
  {
    id: 'local-internet-use-tracts',
    name: 'Internet Use at Home (tracts)',
    what: 'households with an internet subscription of any type',
    geography: 'tract',
    years: [
      acsInternetYear(
        'net17',
        '2013–2017',
        'tract',
        'any internet subscription',
      ),
      acsInternetYear('net', '2020–2024', 'tract', 'any internet subscription'),
    ],
  },
  {
    id: 'local-internet-highspeed-tracts',
    name: 'High-Speed Internet at Home (tracts)',
    what: 'households with broadband internet of any type',
    geography: 'tract',
    years: [
      acsInternetYear('bb17', '2013–2017', 'tract', 'broadband of any type'),
      acsInternetYear('bb', '2020–2024', 'tract', 'broadband of any type'),
    ],
  },
]);

export function internetSummary(measure, year, p) {
  const value = p[year.key];
  if (!Number.isFinite(value)) return `No ${year.label} estimate here.`;
  const where =
    year.scope === 'state'
      ? `the state's households (CPS ${year.label}; state estimate shown for every county)`
      : year.scope === 'county'
        ? `this county's households (ACS ${year.vintage}, table B28002)`
        : `this tract's households (ACS ${year.vintage}, table B28002${year.key.endsWith('17') ? '; moved from 2010 tracts by shared land area' : ''})`;
  return `${value.toFixed(1)}% of ${where}: ${measure.what}.`;
}

function binOf(bins, value) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : bins.find((b) => value >= b.min && value < b.max);
}

/** Legend rows for a layer shaded by binOf(bins, property). */
function binLegend(bins, key) {
  return [
    ...bins.map((b) => ({
      label: b.label,
      color: b.color,
      test: (p) => binOf(bins, p[key]) === b,
    })),
    {
      label: 'No estimate',
      color: NO_DATA_COLOR,
      test: (p) => !binOf(bins, p[key]),
    },
  ];
}

const NONATTAINMENT_TYPES = Object.freeze([
  { pollutant: 'ozone', label: 'Ozone (2015 standard)', color: '#ff8c00' },
  { pollutant: 'pm25', label: 'PM2.5 (2012 standard)', color: '#9c27b0' },
]);

/** County layers are drawn nationwide: every state, from space-station height. */
const COUNTY_LAYER_OPTIONS = Object.freeze({
  maxHeightM: 8_000_000,
  maxChunks: 60,
  zoomInMessage: 'zoom in to the United States to load',
});

// Resolved by Vite in builds and relative to this module in other consumers.
const datacentersUrl = new URL(
  './local_data/datacenters/datacenters.geojsonl',
  import.meta.url,
).href;
const damsUrl = new URL('./local_data/dams/dams.geojsonl', import.meta.url)
  .href;
const chicagoEventsUrl = new URL(
  './local_data/chicago_events/chicago_events.geojsonl',
  import.meta.url,
).href;
const tlrUrl = new URL('./local_data/tlr/tlr.geojsonl', import.meta.url).href;
// Converted from the public "Big Bas #1 Chicagoland & Illinois Gang Map"
// (Google My Maps) by scripts/mymaps-to-geojson.mjs + build-gang-map-layers.mjs.
const gangMapUrl = new URL(
  './local_data/gang_map/gang_map.geojsonl',
  import.meta.url,
).href;
const famousShootingsUrl = new URL(
  './local_data/gang_map/famous_shootings.geojsonl',
  import.meta.url,
).href;
// Trauma centers (HIFLD Hospitals, open hospitals with a trauma designation;
// scripts/fetch-trauma-centers.mjs), colored by trauma level.
const traumaCentersUrl = new URL(
  './local_data/trauma_centers/trauma_centers.geojsonl',
  import.meta.url,
).href;
const TRAUMA_LEVELS = Object.freeze([
  {
    label: 'Level I',
    color: '#e31a1c',
    test: (p) => p.trauma_level === 'Level I',
  },
  {
    label: 'Level II',
    color: '#fd8d3c',
    test: (p) => p.trauma_level === 'Level II',
  },
  {
    label: 'Level III',
    color: '#fecc5c',
    test: (p) => p.trauma_level === 'Level III',
  },
  {
    label: 'Level IV',
    color: '#a1dab4',
    test: (p) => p.trauma_level === 'Level IV',
  },
  {
    label: 'Level V',
    color: '#41b6c4',
    test: (p) => p.trauma_level === 'Level V',
  },
  {
    label: 'Pediatric only',
    color: '#c51b8a',
    test: (p) => String(p.trauma_level).startsWith('Pediatric'),
  },
  {
    label: 'Other designation',
    color: '#bdbdbd',
    test: (p) => p.trauma_level === 'Other designation',
  },
]);
// Public housing developments (HUD; scripts/fetch-public-housing.mjs), one
// pin per development, colored by the decade its first building was built.
const publicHousingUrl = new URL(
  './local_data/public_housing/developments.geojsonl',
  import.meta.url,
).href;
const HOUSING_ERAS = Object.freeze([
  { label: 'Before 1950', color: '#bf812d', min: 0, max: 1950 },
  { label: '1950s', color: '#dfc27d', min: 1950, max: 1960 },
  { label: '1960s', color: '#f6e8c3', min: 1960, max: 1970 },
  { label: '1970s', color: '#c7eae5', min: 1970, max: 1980 },
  { label: '1980s', color: '#80cdc1', min: 1980, max: 1990 },
  { label: '1990 and later', color: '#35978f', min: 1990, max: Infinity },
]);
const housingEra = (p) =>
  Number(p.construct_year) > 0
    ? HOUSING_ERAS.find(
        (e) => p.construct_year >= e.min && p.construct_year < e.max,
      )
    : null;
// Gun Violence Archive 2015 gun deaths, geocoded by
// scripts/geocode-gva-incidents.mjs and built by scripts/build-gva-layer.mjs.
// Locked research data: served decrypted by server/providers/research.js only
// when the research key is configured (the repo carries it encrypted).
const gva2015Url = '/api/research/gva-2015';
const GVA_DEATHS = Object.freeze([
  { label: '1 killed', color: '#fc9272', min: 1, max: 2 },
  { label: '2 killed', color: '#ef3b2c', min: 2, max: 3 },
  { label: '3–4 killed', color: '#cb181d', min: 3, max: 5 },
  { label: '5 or more killed', color: '#67000d', min: 5, max: Infinity },
]);
const gvaDeaths = (p) =>
  GVA_DEATHS.find((d) => p.killed >= d.min && p.killed < d.max);
// Mass Killing Database incidents (4+ killed, 2006–2023), tract-checked and
// built by scripts/convert-mkdb-incidents.mjs.
const mkdbUrl = '/api/research/mkdb';
const MKDB_DEATHS = Object.freeze([
  { label: '4 killed', color: '#d4b9da', min: 4, max: 5 },
  { label: '5 killed', color: '#c994c7', min: 5, max: 6 },
  { label: '6–9 killed', color: '#df65b0', min: 6, max: 10 },
  { label: '10 or more killed', color: '#ce1256', min: 10, max: Infinity },
]);
const mkdbDeaths = (p) =>
  MKDB_DEATHS.find((d) => p.killed >= d.min && p.killed < d.max);
// Boston's 69 neighborhood statistical areas, reprojected from Massachusetts
// State Plane by scripts/convert-boston-neighborhoods.mjs. Each area is shaded
// by the neighborhood group the source file assigns it (its `Nbhd` field).
const bostonNeighborhoodsUrl = new URL(
  './local_data/boston/neighborhoods.geojsonl',
  import.meta.url,
).href;
const BOSTON_NEIGHBORHOOD_GROUPS = Object.freeze(
  [
    ['Allston-Brighton', '#1f77b4'],
    ['Back Bay', '#aec7e8'],
    ['Beacon Hill', '#ff7f0e'],
    ['Charlestown', '#ffbb78'],
    ['Dorchester', '#2ca02c'],
    ['East Boston', '#98df8a'],
    ['Fenway', '#d62728'],
    ['Financial District', '#ff9896'],
    ['Hyde Park', '#9467bd'],
    ['Mattapan', '#c5b0d5'],
    ['Mission Hill', '#8c564b'],
    ['Roslindale', '#c49c94'],
    ['Roxbury', '#e377c2'],
    ['South Boston', '#f7b6d2'],
    ['South End', '#bcbd22'],
    ['West Roxbury', '#17becf'],
  ].map(([label, color]) => ({
    label,
    color,
    test: (p) => p.neighborhood === label,
  })),
);

// Hoods without a gang line and non-hood areas keep one color per source
// My Maps layer.
const GANG_MAP_CATEGORY_COLORS = Object.freeze({
  'Chicago Hoods': '#ff3b3b',
  'Suburb Hoods': '#ff9100',
  'Illinois Hoods': '#ffd600',
  'Demolished Projects & Apartments': '#a1887f',
});
const HOOD_LAYERS = new Set([
  'Chicago Hoods',
  'Suburb Hoods',
  'Illinois Hoods',
]);
// Hood territories are shaded by primary gang (the `gang` property). The
// largest gangs get fixed, well-separated colors; the rest hash into a
// secondary palette so every territory of one gang still shares a color.
const MAJOR_GANG_COLORS = Object.freeze({
  'gangster disciples': '#1e88e5',
  'black disciples': '#00acc1',
  'latin kings': '#fdd835',
  'black p stones': '#e53935',
  'conservative vice lords': '#43a047',
  'four corner hustlers': '#8e24aa',
  'traveling vice lords': '#7cb342',
  'satan disciples': '#ffb300',
  'maniac latin disciples': '#d81b60',
  'gangster two sixes': '#f4511e',
  'new breeds': '#3949ab',
  'mafia insane vice lords': '#00897b',
});
const OTHER_GANG_COLORS = Object.freeze([
  '#90caf9',
  '#a5d6a7',
  '#ffcc80',
  '#ce93d8',
  '#ef9a9a',
  '#80deea',
  '#fff59d',
  '#bcaaa4',
  '#b0bec5',
  '#f48fb1',
]);

/** Normalize a gang name so spelling/punctuation variants share a color. */
function gangKey(gang) {
  return String(gang)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fill color for one gang map feature.
 * @param {object} properties Feature properties.
 * @returns {string|undefined}
 */
function gangMapFeatureColor(properties) {
  if (HOOD_LAYERS.has(properties.layer) && properties.gang) {
    const key = gangKey(properties.gang);
    if (MAJOR_GANG_COLORS[key]) return MAJOR_GANG_COLORS[key];
    let hash = 0;
    for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return OTHER_GANG_COLORS[hash % OTHER_GANG_COLORS.length];
  }
  return GANG_MAP_CATEGORY_COLORS[properties.layer];
}

/**
 * Create fresh datacenter, dam, Chicago event, gang map (territories plus
 * a separate names layer) and famous shooting layers without starting or loading them.
 * @param {object} services Caller-owned context, overlay and render operations.
 * @returns {object[]} Datacenters, dams, Chicago events, gang map, gang map
 * labels, then famous shootings, with stable standalone identities.
 */
export function createInfrastructureLayers(services) {
  const datacenters = createLocalGeoJsonLayer(
    {
      id: 'local-datacenters',
      url: datacentersUrl,
      name: 'Datacenters',
      color: '#00ffff', // Cyan
      icon: '▣',
      source: 'Local',
      labels: true,
      labelMax: 700,
      labelGridPx: 138,
    },
    services,
  );

  const dams = createLocalGeoJsonLayer(
    {
      id: 'local-dams',
      url: damsUrl,
      name: 'Dams',
      color: '#0088ff', // Blue
      icon: '▰',
      // OpenStreetMap via Open Infrastructure Map (see the folder README).
      source: 'OpenStreetMap',
      labels: true,
      labelMax: 900,
      labelGridPx: 132,
    },
    services,
  );

  const chicagoEvents = createLocalGeoJsonLayer(
    {
      id: 'local-chicago-events',
      url: chicagoEventsUrl,
      name: 'Chicago Events',
      color: '#ff3b6b', // Magenta-red
      icon: '●',
      source: 'Local',
      labels: true,
      labelMax: 50,
      labelGridPx: 90,
    },
    services,
  );

  // TLR: locations from the "No Limit: Chicago's Deadliest Gang" video, each
  // linked to its moment in the video (scripts/geocode-tlr-locations.mjs).
  const tlr = createLocalGeoJsonLayer(
    {
      id: 'local-tlr',
      url: tlrUrl,
      name: 'TLR',
      color: '#ff8c1a',
      icon: '●',
      source: 'Video locations',
      labels: true,
      labelMax: 50,
      labelGridPx: 90,
    },
    services,
  );

  const gangMap = createLocalGeoJsonLayer(
    {
      id: 'local-gang-map',
      url: gangMapUrl,
      name: 'Gang Map',
      color: '#ff3b3b', // Red; per-category colors below
      icon: '⬢',
      source: 'Big Bas My Maps',
      labels: true,
      labelMax: 300,
      labelGridPx: 140,
      featureColor: gangMapFeatureColor,
      labeledAreas: true,
    },
    services,
  );
  // The territories draw no names; this separate layer over the same data
  // draws only the names, so either can be on without the other.
  gangMap.setAreaLabelsVisible(false);
  const gangMapLabels = createLocalGeoJsonLayer(
    {
      id: 'local-gang-map-labels',
      url: gangMapUrl,
      name: 'Gang Map Labels',
      color: '#ff3b3b',
      icon: '🏷',
      source: 'Hood names',
      labels: true,
      labelMax: 300,
      labelGridPx: 140,
      featureColor: gangMapFeatureColor,
      labeledAreas: true,
      areaNamesOnly: true,
    },
    services,
  );

  const famousShootings = createLocalGeoJsonLayer(
    {
      id: 'local-famous-shootings',
      url: famousShootingsUrl,
      name: 'Famous Shootings',
      color: '#f5f5f5', // White
      icon: '✚',
      source: 'Big Bas My Maps',
      labels: true,
      labelMax: 120,
      labelGridPx: 110,
    },
    services,
  );

  const holcRedlining = createChunkedAreaLayer(
    {
      id: 'local-holc-redlining',
      name: 'HOLC Redlining (1930s)',
      baseUrl: 'context/holc/',
      icon: '▦',
      source: 'Mapping Inequality',
      featureColor: (p) =>
        HOLC_GRADES.find((g) => g.grade === p.holc_grade)?.color ||
        NO_DATA_COLOR,
      legend: HOLC_GRADES.map((g) => ({
        label: g.label,
        color: g.color,
        test: (p) => p.holc_grade === g.grade,
      })),
    },
    services,
  );

  const lifeExpectancy = createChunkedAreaLayer(
    {
      id: 'local-life-expectancy',
      name: 'Life Expectancy (tracts)',
      baseUrl: 'context/life-expectancy/',
      icon: '♥',
      source: 'USALEEP',
      sourceNote: 'USALEEP census-tract life expectancy (life_exp_8).',
      featureSummary: (p) =>
        Number.isFinite(p.life_exp_8)
          ? `Life expectancy at birth: ${p.life_exp_8.toFixed(1)} years.`
          : 'No life expectancy estimate for this tract.',
      featureColor: (p) =>
        lifeExpectancyBin(p.life_exp_8)?.color || NO_DATA_COLOR,
      legend: lifeExpectancyLegend('life_exp_8'),
    },
    services,
  );

  // PM2.5, ozone and park access share one set of 2020 tract chunks; each
  // layer colors and describes the tracts its own way.
  const airSummary = (p) =>
    [
      Number.isFinite(p.pm25)
        ? `PM2.5 (2021 avg): ${p.pm25.toFixed(1)} µg/m³; EPA annual standard 9.0`
        : null,
      Number.isFinite(p.o3)
        ? `Ozone (2022 avg daily 8-h max): ${p.o3.toFixed(1)} ppb`
        : null,
    ]
      .filter(Boolean)
      .join('\n') ||
    'No modeled estimate (the CDC model covers the lower 48 states).';

  const airPm25 = createChunkedAreaLayer(
    {
      id: 'local-air-pm25',
      name: 'Air Quality: PM2.5 (tracts)',
      baseUrl: 'context/tracts-2020/',
      icon: '☁',
      source: 'CDC 2021',
      sourceNote: AIR_TRACT_SOURCE_NOTE,
      featureSummary: airSummary,
      featureColor: (p) => binOf(PM25_BINS, p.pm25)?.color || NO_DATA_COLOR,
      legend: binLegend(PM25_BINS, 'pm25'),
    },
    services,
  );

  const airOzone = createChunkedAreaLayer(
    {
      id: 'local-air-ozone',
      name: 'Air Quality: Ozone (tracts)',
      baseUrl: 'context/tracts-2020/',
      icon: '☁',
      source: 'CDC 2022',
      sourceNote: AIR_TRACT_SOURCE_NOTE,
      featureSummary: airSummary,
      featureColor: (p) => binOf(OZONE_BINS, p.o3)?.color || NO_DATA_COLOR,
      legend: binLegend(OZONE_BINS, 'o3'),
    },
    services,
  );

  const parkAccess = createChunkedAreaLayer(
    {
      id: 'local-park-access',
      name: 'Green Space: Park Access (tracts)',
      baseUrl: 'context/tracts-2020/',
      icon: '♣',
      source: 'CDC 2020',
      sourceNote: PARK_ACCESS_SOURCE_NOTE,
      featureSummary: (p) =>
        Number.isFinite(p.park)
          ? `${p.park.toFixed(1)}% of residents live within 1/2 mile of a park (2020).`
          : 'No park-access estimate for this tract.',
      featureColor: (p) =>
        binOf(PARK_ACCESS_BINS, p.park)?.color || NO_DATA_COLOR,
      legend: binLegend(PARK_ACCESS_BINS, 'park'),
    },
    services,
  );

  const parks = createChunkedAreaLayer(
    {
      id: 'local-parks',
      name: 'Green Space: Parks',
      baseUrl: 'context/parks/',
      icon: '♠',
      source: 'Census TIGER 2025',
      sourceNote:
        'Census TIGER/Line 2025 Area Landmarks, park feature classes (K2180–K2190). Small neighborhood parks are incomplete.',
      featureSummary: (p) =>
        `${parkKindLabel(p.kind)}${Number.isFinite(p.acres) && p.acres > 0 ? ` · about ${p.acres.toLocaleString('en-US')} acres of land` : ''}.`,
      featureColor: (p) =>
        PARK_KINDS.find((k) => k.kinds.includes(p.kind))?.color ||
        NO_DATA_COLOR,
      legend: PARK_KINDS.map((k) => ({
        label: k.label,
        color: k.color,
        test: (p) => k.kinds.includes(p.kind),
      })),
      fillAlpha: 0.55,
      // Parks are sparse; a wider view still loads only a few cells.
      maxHeightM: 600_000,
      maxChunks: 60,
    },
    services,
  );

  const airNonattainment = createChunkedAreaLayer(
    {
      id: 'local-air-nonattainment',
      name: 'Air Quality: Nonattainment Areas',
      baseUrl: 'context/air-nonattainment/',
      icon: '⚠',
      source: 'EPA Green Book',
      featureColor: (p) =>
        NONATTAINMENT_TYPES.find((t) => t.pollutant === p.pollutant)?.color ||
        NO_DATA_COLOR,
      legend: NONATTAINMENT_TYPES.map((t) => ({
        label: t.label,
        color: t.color,
        test: (p) => p.pollutant === t.pollutant,
      })),
      fillAlpha: 0.35,
      // 75 regulatory areas in all, so the whole country can be shown at once.
      maxHeightM: 8_000_000,
      maxChunks: 64,
      zoomInMessage: 'zoom in to the United States to load',
    },
    services,
  );

  // Reads the life-expectancy tract chunks and keeps the tracts with a
  // significant Local Moran's I result (scripts/build-context-layers.mjs).
  const tractClusters = createChunkedAreaLayer(
    {
      id: 'local-tract-le-clusters',
      name: 'Life Expectancy Clusters (tracts)',
      baseUrl: 'context/life-expectancy/',
      icon: '◈',
      source: "Local Moran's I",
      sourceNote:
        "Local Moran's I (Anselin) on USALEEP tract life expectancy (nation_tracts_le_cluster).",
      featureFilter: (p) => Boolean(p.cluster),
      featureSummary: tractClusterSummary,
      featureColor: clusterColor,
      legend: clusterLegend(),
      // Chunks are shared with the full tract layer, so keep the same
      // view limits as other tract layers.
      maxHeightM: 400_000,
      maxChunks: 45,
    },
    services,
  );

  const countyLifeExpectancy = createChunkedAreaLayer(
    {
      id: 'local-county-life-expectancy',
      name: 'Life Expectancy (counties)',
      baseUrl: 'context/county-life-expectancy/',
      icon: '♥',
      source: 'County 2000–2019',
      featureColor: (p) =>
        lifeExpectancyBin(p.life_exp)?.color || NO_DATA_COLOR,
      legend: lifeExpectancyLegend('life_exp'),
      ...COUNTY_LAYER_OPTIONS,
    },
    services,
  );

  const countyClusters = createChunkedAreaLayer(
    {
      id: 'local-county-le-clusters',
      name: 'Life Expectancy Clusters (counties)',
      baseUrl: 'context/county-clusters/',
      icon: '◈',
      source: "Local Moran's I",
      featureColor: clusterColor,
      legend: clusterLegend(),
      ...COUNTY_LAYER_OPTIONS,
    },
    services,
  );

  const miamiHomicideHotspots = createChunkedAreaLayer(
    {
      id: 'local-miami-homicide-hotspots',
      name: 'Miami Homicide Hotspots',
      baseUrl: 'context/miami-homicide-hotspots/',
      icon: '▦',
      source: 'Kernel density',
      sourceNote:
        'Kernel density of 13,348 Miami-Dade homicides, 1956–2011 (quartic kernel, 800 m radius, 200 m cells; bands at the 40th/65th/80th/90th/97th percentiles). 667 incidents stacked on fallback geocodes are left out.',
      featureColor: (p) =>
        HOMICIDE_HOTSPOT_BANDS.find((b) => b.band === p.band)?.color ||
        NO_DATA_COLOR,
      legend: HOMICIDE_HOTSPOT_BANDS.map((b) => ({
        label: b.label,
        color: b.color,
        test: (p) => p.band === b.band,
      })),
      fillAlpha: 0.6,
      maxHeightM: 400_000,
      maxChunks: 1,
      zoomInMessage: 'zoom in to Miami-Dade to load',
    },
    services,
  );

  // Same pins, stems and clickable cards as Chicago Events, one layer per
  // decade in that decade's color.
  const miamiHomicides = HOMICIDE_DECADES.map((decade) =>
    createLocalGeoJsonLayer(
      {
        id: `local-miami-homicides-${decade.key}`,
        name: `Miami Homicides ${decade.label}`,
        url: decade.url,
        color: decade.color,
        icon: '●',
        source: 'Miami-Dade homicides',
        labels: true,
        labelMax: 50,
        labelGridPx: 90,
        legend: [
          { label: decade.label, color: decade.color, test: () => true },
        ],
      },
      services,
    ),
  );

  const gva2015 = createLocalGeoJsonLayer(
    {
      id: 'local-gva-2015',
      name: 'Gun Deaths 2015 (GVA)',
      url: gva2015Url,
      lockedDataset: 'gva-2015',
      color: '#ef3b2c',
      icon: '●',
      source: 'Gun Violence Archive',
      labels: true,
      labelMax: 50,
      labelGridPx: 90,
      featureColor: (p) => gvaDeaths(p)?.color,
      legend: GVA_DEATHS.map((d) => ({
        label: d.label,
        color: d.color,
        test: (p) => gvaDeaths(p) === d,
      })),
    },
    services,
  );

  const mkdb = createLocalGeoJsonLayer(
    {
      id: 'local-mkdb',
      name: 'MKDB Mass Killings (2006–2023)',
      url: mkdbUrl,
      lockedDataset: 'mkdb',
      color: '#df65b0',
      icon: '●',
      source: 'Mass Killing Database',
      labels: true,
      labelMax: 50,
      labelGridPx: 90,
      featureColor: (p) => mkdbDeaths(p)?.color,
      legend: MKDB_DEATHS.map((d) => ({
        label: d.label,
        color: d.color,
        test: (p) => mkdbDeaths(p) === d,
      })),
    },
    services,
  );

  const traumaCenters = createLocalGeoJsonLayer(
    {
      id: 'local-trauma-centers',
      name: 'Trauma Centers',
      url: traumaCentersUrl,
      color: '#e31a1c',
      icon: '✚',
      source: 'HIFLD Hospitals',
      labels: true,
      labelMax: 60,
      labelGridPx: 110,
      featureColor: (p) => TRAUMA_LEVELS.find((l) => l.test(p))?.color,
      legend: TRAUMA_LEVELS,
    },
    services,
  );

  const publicHousing = createLocalGeoJsonLayer(
    {
      id: 'local-public-housing',
      name: 'Public Housing',
      url: publicHousingUrl,
      color: '#80cdc1',
      icon: '⌂',
      source: 'HUD',
      labels: true,
      labelMax: 60,
      labelGridPx: 110,
      featureColor: (p) => housingEra(p)?.color || NO_DATA_COLOR,
      legend: [
        ...HOUSING_ERAS.map((e) => ({
          label: e.label,
          color: e.color,
          test: (p) => housingEra(p) === e,
        })),
        {
          label: 'Year unknown',
          color: NO_DATA_COLOR,
          test: (p) => !housingEra(p),
        },
      ],
    },
    services,
  );

  const bostonNeighborhoods = createLocalGeoJsonLayer(
    {
      id: 'local-boston-neighborhoods',
      name: 'Boston Neighborhoods',
      url: bostonNeighborhoodsUrl,
      color: '#a2aaad',
      icon: '⬢',
      source: 'Neighborhood areas',
      labels: true,
      labelMax: 80,
      labelGridPx: 120,
      labeledAreas: true,
      featureColor: (p) =>
        BOSTON_NEIGHBORHOOD_GROUPS.find((g) => g.test(p))?.color ||
        NO_DATA_COLOR,
      legend: BOSTON_NEIGHBORHOOD_GROUPS,
    },
    services,
  );

  // Social & Economic (US): ACS tract measures on the shared 2020 tract
  // chunks (scripts/build-social-layers.mjs). Each names its Census table.
  const socialLayers = SOCIAL_MEASURES.map((measure) =>
    createChunkedAreaLayer(
      {
        id: measure.id,
        name: measure.name,
        baseUrl: 'context/tracts-2020/',
        icon: measure.icon,
        source: `ACS ${ACS_SOCIAL_VINTAGE}`,
        sourceNote: `U.S. Census Bureau, American Community Survey ${ACS_SOCIAL_VINTAGE} 5-year estimates, table ${measure.table}: ${measure.definition} Census 2020 tract outlines.`,
        featureSummary: (p) =>
          Number.isFinite(p[measure.key])
            ? `${measure.format(p[measure.key])} (ACS ${ACS_SOCIAL_VINTAGE}, table ${measure.table}).`
            : 'No ACS estimate for this tract (too few people or households).',
        featureColor: (p) =>
          binOf(measure.bins, p[measure.key])?.color || NO_DATA_COLOR,
        legend: binLegend(measure.bins, measure.key),
      },
      services,
    ),
  );

  // Internet Access (US): household internet over time, by county and tract.
  // 1998–2010 come from the CPS Computer and Internet Use Supplement, which
  // is only published by state, so every county shows its state's value;
  // 2013–2017 and 2020–2024 are ACS estimates (table B28002). Tracts have the
  // two ACS periods only.
  const internetLayers = INTERNET_MEASURES.map((measure) => {
    const bins =
      measure.geography === 'tract' ? TRACT_INTERNET_BINS : INTERNET_BINS;
    return createChunkedAreaLayer(
      {
        id: measure.id,
        name: measure.name,
        ...(measure.geography === 'county'
          ? {
              baseUrl: 'context/county-life-expectancy/',
              ...COUNTY_LAYER_OPTIONS,
              source: 'Census CPS / ACS',
              sourceNote: INTERNET_COUNTY_SOURCE_NOTE,
            }
          : {
              baseUrl: 'context/tracts-2020/',
              source: 'Census ACS',
              sourceNote: INTERNET_TRACT_SOURCE_NOTE,
            }),
        icon: '⌁',
        variants: measure.years.map((year) => ({
          id: year.key,
          label: year.label,
          title: year.title,
          featureColor: (p) => binOf(bins, p[year.key])?.color || NO_DATA_COLOR,
          legend: binLegend(bins, year.key),
          featureSummary: (p) => internetSummary(measure, year, p),
        })),
        featureColor: () => NO_DATA_COLOR,
      },
      services,
    );
  });

  return [
    datacenters,
    dams,
    chicagoEvents,
    tlr,
    gangMap,
    gangMapLabels,
    famousShootings,
    holcRedlining,
    lifeExpectancy,
    tractClusters,
    countyLifeExpectancy,
    countyClusters,
    airPm25,
    airOzone,
    airNonattainment,
    parkAccess,
    parks,
    ...miamiHomicides,
    miamiHomicideHotspots,
    traumaCenters,
    publicHousing,
    ...socialLayers,
    ...internetLayers,
    gva2015,
    mkdb,
    bostonNeighborhoods,
  ];
}
