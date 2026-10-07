/**
 * Area Reports: every value a report can rank by or list, for counties,
 * census tracts and states. Each measure names the property the map's area
 * files already carry (public/context/county-life-expectancy, tracts-2020,
 * states), its unit, years and source, and the Data Layers layer it comes
 * from, so a report can be asked for by layer name ("rank by poverty").
 *
 * format: count | percent | dollars | years | index | category | number
 */

export const REPORT_GEOGRAPHIES = Object.freeze({
  county: {
    label: 'Counties',
    noun: 'county',
    baseUrl: 'context/county-life-expectancy/',
  },
  tract: {
    label: 'Census tracts',
    noun: 'tract',
    baseUrl: 'context/tracts-2020/',
  },
  state: { label: 'States', noun: 'state', baseUrl: 'context/states/' },
});

const ACS = 'ACS 2020–2024 5-year';
const C = ['county'];
const CT = ['county', 'tract'];
const CS = ['county', 'state'];

const measure = (id, spec) => Object.freeze({ id, decimals: 1, ...spec });

// tableLabel: how a results table names the measure, when not its label.
const TABLE_LABELS = { poverty: 'Poverty Rate' };

export const REPORT_MEASURES = Object.freeze([
  // ---- Population and immigration -----------------------------------------
  measure('population', {
    label: 'Total population',
    short: 'Population',
    key: 'pop24',
    format: 'count',
    years: '2020–24',
    source: `${ACS}, table B01003`,
    geographies: CT,
    layerId: 'local-foreign-born-counties',
    aliases: ['total population', 'population', 'residents', 'people'],
  }),
  measure('foreign-born-count', {
    label: 'Foreign-born residents',
    short: 'Foreign-born',
    key: 'fbn24',
    format: 'count',
    years: '2020–24',
    source: `${ACS}, table B05006`,
    geographies: CT,
    layerId: 'local-foreign-born-counties',
    aliases: [
      'immigrant population',
      'immigrants',
      'foreign born population',
      'foreign born',
      'size of the foreign born population',
      'number of immigrants',
    ],
  }),
  measure('foreign-born-share', {
    label: 'Foreign-born, % of residents',
    short: 'Foreign-born %',
    tableLabel: '%Foreign-born',
    key: 'fb24',
    format: 'percent',
    years: '2020–24',
    source: `${ACS}, table B05006`,
    geographies: CT,
    layerId: 'local-foreign-born-tracts',
    aliases: [
      'percent foreign born',
      'foreign born share',
      'share of immigrants',
      'immigrant share',
    ],
  }),
  measure('foreign-born-share-2010', {
    label: 'Foreign-born, % of residents',
    short: 'Foreign-born % 2006–10',
    key: 'fb10',
    format: 'percent',
    years: '2006–10',
    source: 'ACS 2006–2010 5-year, table B05006',
    geographies: CT,
    layerId: 'local-foreign-born-counties',
    aliases: ['foreign born 2010', 'immigrant share 2010'],
  }),
  measure('foreign-born-share-2000', {
    label: 'Foreign-born, % of residents',
    short: 'Foreign-born % 2000',
    key: 'fb00',
    format: 'percent',
    years: '2000',
    source: 'Census 2000 SF3, table PCT019',
    geographies: CT,
    layerId: 'local-foreign-born-counties',
    aliases: ['foreign born 2000', 'immigrant share 2000'],
  }),
  measure('top-countries', {
    label: 'Largest countries of birth (% of all residents)',
    short: 'Largest countries of birth',
    key: 'fbt24',
    format: 'category',
    years: '2020–24',
    source: `${ACS}, table B05006`,
    geographies: CT,
    layerId: 'local-foreign-born-counties',
    rankable: false,
    aliases: [
      'countries of birth',
      'largest immigrant groups',
      'top countries of birth',
      'immigrant groups',
    ],
  }),
  // ---- People & Economy (ACS) ----------------------------------------------
  ...[
    [
      'poverty',
      'pov',
      'Poverty rate (% of people)',
      'Poverty %',
      'B17001',
      'local-acs-poverty',
      ['poverty', 'poverty rate', 'below poverty'],
    ],
    [
      'unemployment',
      'unemp',
      'Unemployment rate (% of labor force)',
      'Unemployment %',
      'B23025',
      'local-acs-unemployment',
      ['unemployment', 'unemployment rate', 'jobless rate'],
    ],
    [
      'bachelors',
      'ba',
      "Bachelor's degree or higher (% of adults 25+)",
      "Bachelor's %",
      'B15003',
      'local-acs-education',
      ['education', 'college degree', 'bachelors'],
    ],
    [
      'renters',
      'rent',
      'Renter-occupied homes (%)',
      'Renters %',
      'B25003',
      'local-acs-renters',
      ['renters', 'renting'],
    ],
    [
      'black',
      'blk',
      'Black, not Hispanic (% of people)',
      'Black %',
      'B03002',
      'local-acs-black',
      ['black residents', 'black population'],
    ],
    [
      'hispanic',
      'hisp',
      'Hispanic or Latino (% of people)',
      'Hispanic %',
      'B03002',
      'local-acs-hispanic',
      ['hispanic', 'latino'],
    ],
    [
      'no-vehicle',
      'noveh',
      'Households without a vehicle (%)',
      'No vehicle %',
      'B25044',
      'local-acs-no-vehicle',
      ['no vehicle', 'no car'],
    ],
    [
      'internet',
      'net',
      'Households with internet at home (%)',
      'Internet %',
      'B28002',
      'local-internet-use',
      ['internet', 'internet use', 'internet access'],
    ],
    [
      'broadband',
      'bb',
      'Households with broadband (%)',
      'Broadband %',
      'B28002',
      'local-acs-broadband',
      ['broadband', 'high speed internet'],
    ],
  ].map(([id, key, label, short, table, layerId, aliases]) =>
    measure(id, {
      label,
      short,
      key,
      format: 'percent',
      years: '2020–24',
      source: `${ACS}, table ${table}`,
      geographies: CT,
      layerId,
      aliases,
      ...(TABLE_LABELS[id] && { tableLabel: TABLE_LABELS[id] }),
    }),
  ),
  measure('median-income', {
    label: 'Median household income',
    short: 'Median income',
    key: 'inc',
    format: 'dollars',
    decimals: 0,
    years: '2020–24',
    source: `${ACS}, table B19013`,
    geographies: CT,
    layerId: 'local-acs-income',
    aliases: ['income', 'median income', 'household income'],
  }),
  // ---- Life expectancy and health ------------------------------------------
  measure('life-expectancy', {
    label: 'Life expectancy at birth (years)',
    short: 'Life expectancy',
    key: 'life_exp',
    format: 'years',
    years: '2019',
    source: 'IHME US county life expectancy (nation_county_le)',
    geographies: C,
    layerId: 'local-county-life-expectancy',
    aliases: ['life expectancy', 'lifespan', 'longevity'],
  }),
  measure('life-expectancy-2000', {
    label: 'Life expectancy at birth (years)',
    short: 'Life expectancy 2000',
    key: 'life_exp_2000',
    format: 'years',
    years: '2000',
    source: 'IHME US county life expectancy (nation_county_le)',
    geographies: C,
    layerId: 'local-county-life-expectancy',
    aliases: ['life expectancy 2000'],
  }),
  measure('cluster-status', {
    label: "Life expectancy cluster (Local Moran's I)",
    short: 'Cluster status',
    key: 'cluster',
    format: 'category',
    years: '2015',
    source:
      "Local Moran's I on county life expectancy, 2015 (nation_county_le_cluster)",
    geographies: C,
    layerId: 'local-county-le-clusters',
    rankable: false,
    aliases: [
      'cluster status',
      'clustering status',
      'county clustering',
      'life expectancy clusters',
      'clusters',
    ],
  }),
  // ---- Air and green space (county: population-weighted tract means) -------
  measure('pm25', {
    label: 'Fine particles, PM2.5 (µg/m³)',
    short: 'PM2.5',
    key: 'pm25',
    format: 'number',
    years: '2021',
    source: 'CDC Environmental Public Health Tracking (tract annual mean)',
    geographies: CT,
    layerId: 'local-air-pm25',
    aliases: ['pm2.5', 'air quality', 'air pollution', 'fine particles'],
  }),
  measure('ozone', {
    label: 'Ozone (ppb)',
    short: 'Ozone',
    key: 'o3',
    format: 'number',
    years: '2022',
    source: 'CDC Environmental Public Health Tracking (tract annual mean)',
    geographies: CT,
    layerId: 'local-air-ozone',
    aliases: ['ozone', 'smog'],
  }),
  measure('park-access', {
    label: 'Living within a half mile of a park (%)',
    short: 'Park access %',
    key: 'park',
    format: 'percent',
    years: '2020',
    source: 'CDC Environmental Public Health Tracking',
    geographies: CT,
    layerId: 'local-park-access',
    aliases: ['park access', 'parks', 'green space'],
  }),
  // ---- Internet history ------------------------------------------------------
  measure('asu-broadband', {
    label: 'Broadband at home, ASU estimates (%)',
    short: 'ASU broadband %',
    key: 'asu2015',
    format: 'percent',
    years: '2015–18',
    source: 'Tolbert & Mossberger (2020), Arizona State University',
    geographies: C,
    layerId: 'local-internet-asu-counties',
    aliases: ['asu broadband'],
  }),
  measure('ntia-internet-use', {
    label: 'Internet use, adults 15+ (%)',
    short: 'Internet use (NTIA) %',
    key: 'use_2020',
    format: 'percent',
    years: '2020–24',
    source: 'NTIA Internet Use Survey (state estimates)',
    geographies: ['state'],
    layerId: 'local-internet-ntia-states',
    aliases: ['ntia internet use', 'adult internet use'],
  }),
  // ---- Segregation -----------------------------------------------------------
  ...[
    [
      'segregation-bw',
      'seg_bw24',
      'Black–white',
      ['black white segregation', 'segregation', 'black-white segregation'],
    ],
    [
      'segregation-hw',
      'seg_hw24',
      'Latino–white',
      ['latino white segregation', 'hispanic white segregation'],
    ],
    ['segregation-aw', 'seg_aw24', 'Asian–white', ['asian white segregation']],
  ].map(([id, key, pair, aliases]) =>
    measure(id, {
      label: `${pair} dissimilarity index (0–100)`,
      short: `${pair} segregation`,
      key,
      format: 'index',
      years: '2020–24',
      source: `${ACS} B03002 over 2010 tracts (Husky Eye View)`,
      geographies: CS,
      layerId: 'local-segregation-counties',
      aliases,
    }),
  ),
]);

/** The test case's columns: the 50 largest immigrant populations by county. */
export const DEFAULT_REPORT = Object.freeze({
  geography: 'county',
  rankBy: 'foreign-born-count',
  order: 'desc',
  limit: 50,
  columns: [
    'population',
    'foreign-born-count',
    'foreign-born-share',
    'poverty',
    'unemployment',
    'life-expectancy',
    'cluster-status',
  ],
  formats: ['pdf', 'csv', 'xlsx'],
});

export const measuresFor = (geography) =>
  REPORT_MEASURES.filter((m) => m.geographies.includes(geography));

export const findMeasure = (id) => REPORT_MEASURES.find((m) => m.id === id);
