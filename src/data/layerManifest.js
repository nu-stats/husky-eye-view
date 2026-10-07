/**
 * The layer manifest: one entry per data layer, in Data Layers panel order.
 *
 * Everything that describes a layer outside its factory lives here, and the
 * rest of the app derives from it:
 *   - the share-link registry (src/data/layerState.js): `token`,
 *     `disposition`, `optionOwner`; serialization order is by id, so the panel
 *     order below never changes a URL;
 *   - the voice layer enum (src/voice/actionSchemas.js) and spoken names
 *     (`aliases`, src/voice/gevActions.js);
 *   - the Data Layers panel (src/ui/layerPanel.js): `group`, `label`,
 *     `vintage`, `live`;
 *   - the research profile (src/ui/layerProfile.js): `extra`;
 *   - the map card noun for pin layers (src/data/localGeojsonCore.js):
 *     `cardNoun`.
 *
 * Adding a layer: build its data and factory (src/data/infrastructure.js or
 * src/app/constructCatalog.js), then add ONE entry here. Tokens are part of
 * shared links: never reuse or change one; retire a layer by keeping its
 * entry. This module is pure data (no browser globals) so portable modules
 * such as the voice schemas can import it.
 */

/**
 * @typedef {object} LayerManifestEntry
 * @property {string} id Layer id.
 * @property {string} token Share-link token (unique, stable forever).
 * @property {string} [disposition] Share-link disposition (default
 *   'enabled-only').
 * @property {string} [optionOwner] Layer whose options this one serializes.
 * @property {string|null} [group] Data Layers group; null = not in the panel.
 * @property {string} [label] Panel label when it differs from the layer name.
 * @property {string} [vintage] Years a static dataset covers, shown in its row.
 * @property {boolean} [live] A live feed despite a local- id.
 * @property {boolean} [extra] Inherited extra hidden by the research profile.
 * @property {string} [cardNoun] Fallback map-card title for an unnamed pin.
 * @property {string[]} [aliases] Spoken names voice accepts for the layer.
 */

const HEALTH_GROUP = 'Life Expectancy & Health';
const HISTORY_GROUP = 'Redlining, Segregation & Housing';
const CENSUS_GROUP = 'People & Economy (Census)';
const INTERNET_GROUP = 'Internet Access Over Time';
const ENVIRONMENT_GROUP = 'Air & Green Space';
const RESEARCH_DATA_GROUP = 'Restricted Research Data';
const MIAMI_GROUP = 'City Study: Miami-Dade Homicides';
// 'Fly, Drone & Walk' again once Walking View returns (layerPanel.js).
const VIEWS_GROUP = 'Fly & Drone';

/** One line under each Data Layers group heading: what it holds, and how. */
export const LAYER_GROUP_NOTES = Object.freeze({
  [HEALTH_GROUP]:
    'Counties from far out; tracts appear as you zoom in to a city.',
  [HISTORY_GROUP]:
    'Census enumeration districts 1900–1930 for ten Northern cities. HOLC: mapped cities from far out, graded areas as you zoom in. Segregation by city, county and state, 2000–2024. Public housing nationwide.',
  [CENSUS_GROUP]:
    'ACS 2020–2024: counties from far out, census tracts as you zoom in.',
  [INTERNET_GROUP]:
    'Counties 1998–2024; the tract layers sharpen from counties to tracts as you zoom in. NTIA (states) and ASU (counties) in five-year blocks for comparison.',
  [ENVIRONMENT_GROUP]:
    'Counties from far out, tracts as you zoom in; large parks first, every park closer in.',
  [RESEARCH_DATA_GROUP]: 'Each needs a key from the project owner.',
  'Data Analysis':
    'Compare cities, rank areas, and run statistics on any layer.',
  [VIEWS_GROUP]: 'Ride a helicopter or fly a drone.',
  'Live Feeds': 'Real-time data across the United States.',
});

/** @type {ReadonlyArray<LayerManifestEntry>} */
export const LAYER_MANIFEST = Object.freeze(
  [
    // ---- Life Expectancy & Health ------------------------------------------
    {
      id: 'local-life-expectancy',
      token: '1',
      group: HEALTH_GROUP,
      vintage: '2010–2015',
      aliases: [
        'life expectancy',
        'tract life expectancy',
        'life expectancy tracts',
      ],
    },
    {
      id: 'local-tract-le-clusters',
      token: '4',
      group: HEALTH_GROUP,
      vintage: '2010–2015',
      aliases: [
        'life expectancy clusters',
        'tract clusters',
        'life expectancy hot spots',
      ],
    },
    {
      id: 'local-county-life-expectancy',
      token: '2',
      group: HEALTH_GROUP,
      vintage: '2000–2019',
      aliases: ['county life expectancy', 'life expectancy counties'],
    },
    {
      id: 'local-county-le-clusters',
      token: '3',
      group: HEALTH_GROUP,
      vintage: '2015',
      aliases: ['county clusters', 'county life expectancy clusters'],
    },
    {
      id: 'local-trauma-centers',
      token: 'tc',
      group: HEALTH_GROUP,
      cardNoun: 'Trauma center',
      aliases: [
        'trauma centers',
        'trauma centres',
        'trauma units',
        'hospitals',
      ],
    },

    // ---- Redlining & Housing History ---------------------------------------
    // Census enumeration districts, 1900–1930, ten Northern cities (S4).
    ...['1900', '1910', '1920', '1930'].map((year, i) => ({
      id: `local-enumeration-districts-${year}`,
      token: `e${i}`,
      group: HISTORY_GROUP,
      vintage: year,
      cardNoun: 'Enumeration district',
      aliases: [
        `enumeration districts ${year}`,
        `census districts ${year}`,
        `eds ${year}`,
        ...(year === '1930' ? ['enumeration districts'] : []),
      ],
    })),
    {
      id: 'local-holc-redlining',
      token: 'o',
      group: HISTORY_GROUP,
      vintage: '1930s maps',
      aliases: ['holc', 'redlining', 'holc redlining', 'redlining map'],
    },
    // Residential segregation (dissimilarity) by city, beside the HOLC maps.
    ...[
      ['2000', 'g0', '2000'],
      ['2010', 'g1', '2010'],
      ['2024', 'g2', '2020–2024'],
    ].map(([year, token, vintage]) => ({
      id: `local-segregation-${year}`,
      token,
      group: HISTORY_GROUP,
      vintage,
      aliases: [
        `segregation ${year === '2024' ? 'today' : year}`,
        `dissimilarity ${year === '2024' ? 'today' : year}`,
        ...(year === '2024'
          ? ['segregation', 'dissimilarity index', 'segregation 2024']
          : []),
      ],
    })),
    // The same index for whole counties and states.
    {
      id: 'local-segregation-counties',
      token: 'gc',
      group: HISTORY_GROUP,
      vintage: '2000–2024',
      aliases: [
        'segregation by county',
        'county segregation',
        'segregation counties',
      ],
    },
    {
      id: 'local-segregation-states',
      token: 'gs',
      group: HISTORY_GROUP,
      vintage: '2000–2024',
      aliases: [
        'segregation by state',
        'state segregation',
        'segregation states',
      ],
    },
    {
      id: 'local-public-housing',
      token: 'ph',
      group: HISTORY_GROUP,
      cardNoun: 'Public housing',
      aliases: ['public housing', 'housing projects', 'projects'],
    },

    // ---- People & Economy (Census): ACS 2020–2024 tracts -------------------
    {
      id: 'local-acs-poverty',
      token: 'sp',
      group: CENSUS_GROUP,
      vintage: '2020–2024',
      aliases: ['poverty', 'poverty rate', 'below poverty'],
    },
    {
      id: 'local-acs-income',
      token: 'si',
      group: CENSUS_GROUP,
      vintage: '2020–2024',
      aliases: ['income', 'median income', 'household income'],
    },
    {
      id: 'local-acs-unemployment',
      token: 'su',
      group: CENSUS_GROUP,
      vintage: '2020–2024',
      aliases: ['unemployment', 'unemployment rate', 'jobless rate'],
    },
    {
      id: 'local-acs-education',
      token: 'se',
      group: CENSUS_GROUP,
      vintage: '2020–2024',
      aliases: [
        'education',
        "bachelor's degree",
        'college degree',
        'college educated',
      ],
    },
    {
      id: 'local-acs-renters',
      token: 'sr',
      group: CENSUS_GROUP,
      vintage: '2020–2024',
      aliases: ['renters', 'renter occupied', 'tenure', 'rental housing'],
    },
    {
      id: 'local-acs-black',
      token: 'sb',
      group: CENSUS_GROUP,
      vintage: '2020–2024',
      aliases: ['black residents', 'black population', 'african american'],
    },
    {
      id: 'local-acs-hispanic',
      token: 'sh',
      group: CENSUS_GROUP,
      vintage: '2020–2024',
      aliases: ['hispanic residents', 'latino', 'hispanic population'],
    },
    {
      id: 'local-acs-no-vehicle',
      token: 'sv',
      group: CENSUS_GROUP,
      vintage: '2020–2024',
      aliases: [
        'no vehicle',
        'car free households',
        'households without a car',
      ],
    },
    {
      id: 'local-acs-broadband',
      token: 'sw',
      group: CENSUS_GROUP,
      vintage: '2020–2024',
      aliases: ['broadband', 'broadband tracts', 'internet subscription'],
    },
    {
      id: 'local-foreign-born-tracts',
      token: 'ft',
      group: CENSUS_GROUP,
      vintage: '2000–2024',
      aliases: [
        'foreign born',
        'foreign-born residents',
        'immigrants',
        'immigrant population',
        'countries of birth',
        'foreign born tracts',
      ],
    },
    {
      id: 'local-foreign-born-counties',
      token: 'fc',
      group: CENSUS_GROUP,
      vintage: '2000–2024',
      aliases: [
        'foreign born by county',
        'foreign-born counties',
        'immigrants by county',
        'county immigrant population',
      ],
    },

    // ---- Internet Access Over Time: CPS states, ACS counties and tracts ----
    {
      id: 'local-internet-use',
      token: 'iu',
      group: INTERNET_GROUP,
      vintage: '1998–2024',
      aliases: [
        'internet use',
        'internet usage',
        'internet at home',
        'internet use counties',
        'internet usage by county',
      ],
    },
    {
      id: 'local-internet-highspeed',
      token: 'ih',
      group: INTERNET_GROUP,
      vintage: '2000–2024',
      aliases: [
        'high speed internet',
        'high-speed internet',
        'broadband history',
        'high speed internet counties',
      ],
    },
    {
      id: 'local-internet-use-tracts',
      token: 'it',
      group: INTERNET_GROUP,
      vintage: '2013–2024',
      aliases: [
        'internet use tracts',
        'internet usage by tract',
        'tract internet use',
      ],
    },
    {
      id: 'local-internet-highspeed-tracts',
      token: 'ix',
      group: INTERNET_GROUP,
      vintage: '2013–2024',
      aliases: [
        'high speed internet tracts',
        'high-speed internet by tract',
        'tract high speed internet',
      ],
    },
    // Five-year blocks for comparison: NTIA states, ASU counties.
    {
      id: 'local-internet-ntia-states',
      token: 'in',
      group: INTERNET_GROUP,
      vintage: '2000–2024',
      aliases: [
        'ntia internet use',
        'ntia',
        'internet use by state',
        'state internet use',
        'adult internet use',
      ],
    },
    {
      id: 'local-internet-asu-counties',
      token: 'ia',
      group: INTERNET_GROUP,
      vintage: '2000–2018',
      aliases: [
        'asu broadband',
        'asu internet',
        'broadband estimates by county',
        'county broadband history',
      ],
    },

    // ---- Air & Green Space -------------------------------------------------
    {
      id: 'local-air-pm25',
      token: 'ap',
      group: ENVIRONMENT_GROUP,
      vintage: '2021',
      aliases: [
        'air quality',
        'pm2.5',
        'pm 2.5',
        'fine particles',
        'particulate matter',
      ],
    },
    {
      id: 'local-air-ozone',
      token: 'ao',
      group: ENVIRONMENT_GROUP,
      vintage: '2022',
      aliases: ['ozone'],
    },
    {
      id: 'local-air-nonattainment',
      token: 'an',
      group: ENVIRONMENT_GROUP,
      vintage: 'as of Aug 2026',
      aliases: ['nonattainment', 'nonattainment areas'],
    },
    {
      id: 'local-park-access',
      token: 'pa',
      group: ENVIRONMENT_GROUP,
      vintage: '2020',
      aliases: ['green space', 'green spaces', 'park access'],
    },
    {
      id: 'local-parks',
      token: 'pk',
      group: ENVIRONMENT_GROUP,
      vintage: '2025',
      aliases: ['parks', 'park outlines'],
    },

    // ---- Restricted Research Data (key-locked) -----------------------------
    {
      id: 'local-gva-2015',
      token: 'gv',
      group: RESEARCH_DATA_GROUP,
      vintage: '2015',
      cardNoun: 'Gun death',
      aliases: ['gun deaths', 'gun violence', 'gva'],
    },
    {
      id: 'local-mkdb',
      token: 'mk',
      group: RESEARCH_DATA_GROUP,
      vintage: '2006–2023',
      cardNoun: 'Mass killing',
      aliases: ['mkdb', 'mass killings', 'mass killing database'],
    },
    {
      id: 'local-chicago-homicides',
      token: 'ch',
      group: RESEARCH_DATA_GROUP,
      vintage: '1870–1930',
      cardNoun: 'Homicide',
      aliases: [
        'chicago historical homicides',
        'historical chicago homicides',
        'chicago homicide project',
      ],
    },

    // ---- City Study: Boston ------------------------------------------------
    {
      id: 'local-boston-neighborhoods',
      token: 'bn',
      group: 'City Study: Boston',
      cardNoun: 'Neighborhood',
      aliases: ['boston neighborhoods', 'boston neighbourhoods'],
    },

    // ---- City Study: Chicago -----------------------------------------------
    {
      id: 'local-chicago-events',
      token: 'k',
      group: 'City Study: Chicago',
      cardNoun: 'Event',
      aliases: ['chicago events', 'chicago homicides'],
    },
    {
      id: 'local-tlr',
      token: 'tl',
      group: 'City Study: Chicago',
      cardNoun: 'Event',
      aliases: ['tlr', 'no limit'],
    },
    {
      id: 'local-famous-shootings',
      token: 'v',
      group: 'City Study: Chicago',
      cardNoun: 'Shooting',
      aliases: ['famous shootings', 'shootings'],
    },
    {
      id: 'local-gang-map',
      token: 'y',
      group: 'City Study: Chicago',
      cardNoun: 'Hood',
      aliases: ['gang map', 'gang territories', 'gangs'],
    },
    {
      id: 'local-gang-map-labels',
      token: 'l',
      group: 'City Study: Chicago',
      aliases: ['gang names', 'gang labels'],
    },

    // ---- City Study: Miami-Dade Homicides ----------------------------------
    {
      id: 'local-miami-homicide-hotspots',
      token: 'mh',
      group: MIAMI_GROUP,
      vintage: '1956–2011',
      aliases: [
        'miami hotspots',
        'miami homicide hotspots',
        'homicide hotspots',
      ],
    },
    ...[
      ['1950s', '5', '1956–1959'],
      ['1960s', '6', '1960s'],
      ['1970s', '7', '1970s'],
      ['1980s', '8', '1980s'],
      ['1990s', '9', '1990s'],
      ['2000s', '0', '2000–2011'],
    ].map(([decade, token, vintage]) => ({
      id: `local-miami-homicides-${decade}`,
      token,
      group: MIAMI_GROUP,
      vintage,
      cardNoun: 'Homicide',
      aliases: [`miami homicides ${decade}`],
    })),

    // ---- 3D Captures -------------------------------------------------------
    {
      id: 'local-3d-captures',
      token: '3d',
      group: '3D Captures',
      aliases: ['3d captures', 'splats', 'gaussian splats'],
    },

    // ---- Fly & Drone: first-person views ----------------------------
    {
      id: 'lowflyers',
      token: 'lf',
      disposition: 'enabled+mirrored-options',
      optionOwner: 'flights',
      group: VIEWS_GROUP,
      label: 'Helicopters & Low Flyers',
      aliases: [
        'helicopters',
        'helicopter',
        'choppers',
        'low flyers',
        'low fliers',
        'low flying aircraft',
      ],
    },

    // ---- Live Feeds (inherited from God's Eye View) ----------------------
    {
      id: 'flights',
      token: 'f',
      disposition: 'enabled+options',
      optionOwner: 'flights',
      group: 'Live Feeds',
      aliases: ['flights', 'planes', 'aircraft'],
    },
    {
      id: 'military',
      token: 'm',
      disposition: 'enabled+mirrored-options',
      optionOwner: 'flights',
      group: 'Live Feeds',
      extra: true,
      aliases: ['military', 'military flights'],
    },
    {
      id: 'traffic',
      token: 't',
      group: 'Live Feeds',
      aliases: ['traffic', 'street traffic'],
    },
    { id: 'transit', token: 'j', group: 'Live Feeds', aliases: ['transit'] },
    {
      id: 'bikeshare',
      token: 'b',
      group: 'Live Feeds',
      label: 'Bike Share',
      aliases: ['bikeshare', 'bikes'],
    },
    {
      id: 'cctv',
      token: 'c',
      disposition: 'enabled+options',
      optionOwner: 'cctv',
      group: 'Live Feeds',
      label: 'Cameras',
      aliases: ['cctv', 'cameras'],
    },
    {
      id: 'alpr-cameras',
      token: 'p',
      group: 'Live Feeds',
      label: 'Mapped ALPR Cameras',
      aliases: [
        'alpr',
        'alpr cameras',
        'flock cameras',
        'license plate readers',
        'license plate cameras',
        'plate readers',
      ],
    },
    {
      id: 'earthquakes',
      token: 'e',
      group: 'Live Feeds',
      aliases: ['earthquakes', 'quakes'],
    },
    {
      id: 'local-firms',
      token: 'w',
      group: 'Live Feeds',
      label: 'Active Fires',
      live: true,
      aliases: ['firms', 'fires', 'active fires'],
    },
    {
      id: 'satellites',
      token: 's',
      disposition: 'enabled+options',
      optionOwner: 'satellites',
      group: 'Live Feeds',
      extra: true,
      aliases: ['satellites'],
    },
    {
      id: 'rocket-launches',
      token: 'x',
      group: 'Live Feeds',
      extra: true,
      aliases: ['space mission', 'space missions', 'missions'],
    },

    // ---- Infrastructure ----------------------------------------------------
    {
      id: 'military-installations',
      token: 'i',
      group: 'Infrastructure',
      extra: true,
    },
    {
      id: 'local-datacenters',
      token: 'd',
      group: 'Infrastructure',
      label: 'Data Centers',
      cardNoun: 'Datacenter',
      aliases: ['datacenters', 'data centers', 'data centres'],
    },
    {
      id: 'telegeography-submarine-cables',
      token: 'u',
      group: 'Infrastructure',
      extra: true,
      aliases: ['submarine cables', 'cables', 'telegeography'],
    },
    {
      id: 'local-dams',
      token: 'q',
      group: 'Infrastructure',
      cardNoun: 'Dam',
      aliases: ['dams'],
    },

    // ---- Utilities -----------------------------------------------------------
    {
      id: 'directions',
      token: 'n',
      group: 'Utilities',
      aliases: ['directions'],
    },
    {
      id: 'radio',
      token: 'r',
      disposition: 'enabled+options',
      optionOwner: 'radio',
      group: 'Utilities',
      aliases: ['radio', 'internet radio', 'radio stations'],
    },

    // ---- Not listed in Data Layers -------------------------------------------
    // Tokens h and z stay reserved for the Nepal flood layers
    // (bhote-koshi-2026, bhote-koshi-locator), which are off for now.
    { id: 'military-awareness', token: 'g', group: null },
    // Ships are off for now (2026-10-06): still constructed, because Military
    // Awareness reads the layer, but hidden, unvoiced and never enabled. To
    // restore, set group: 'Live Feeds', drop `off` and bring back the aliases
    // ('ais', 'ships', 'vessels', 'live vessels').
    {
      id: 'ais-live-vessels',
      token: 'a',
      group: null,
      off: true,
      label: 'Live Vessels',
    },
  ].map((entry) =>
    Object.freeze({
      disposition: 'enabled-only',
      ...entry,
      aliases: Object.freeze([...(entry.aliases || [])]),
    }),
  ),
);

/** The group whose locked research rows never start folded. */
export const RESEARCH_GROUP = RESEARCH_DATA_GROUP;

/**
 * The tools that work on the layers rather than being one (Curated Flights,
 * Area Reports, Stata Analysis, R Analysis): their own group, listed right after
 * the research data, never folded at first.
 */
export const ANALYSIS_GROUP = 'Data Analysis';

/** Every layer id, in share-link (sorted id) order. */
export const REGISTERED_LAYER_IDS = Object.freeze(
  LAYER_MANIFEST.map((entry) => entry.id).sort(),
);

/** Entry for one layer id, or undefined. */
const BY_ID = new Map(LAYER_MANIFEST.map((entry) => [entry.id, entry]));
export function layerManifestEntry(id) {
  return BY_ID.get(id);
}
