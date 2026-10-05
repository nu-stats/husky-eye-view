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

const RESEARCH_DATA_GROUP = 'Research Data';

/** @type {ReadonlyArray<LayerManifestEntry>} */
export const LAYER_MANIFEST = Object.freeze(
  [
    // ---- Neighborhood Data (US) ----------------------------------------
    {
      id: 'local-holc-redlining',
      token: 'o',
      group: 'Neighborhood Data (US)',
      vintage: '1930s maps',
      aliases: ['holc', 'redlining', 'holc redlining', 'redlining map'],
    },
    {
      id: 'local-life-expectancy',
      token: '1',
      group: 'Neighborhood Data (US)',
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
      group: 'Neighborhood Data (US)',
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
      group: 'Neighborhood Data (US)',
      vintage: '2000–2019',
      aliases: ['county life expectancy', 'life expectancy counties'],
    },
    {
      id: 'local-county-le-clusters',
      token: '3',
      group: 'Neighborhood Data (US)',
      vintage: '2015',
      aliases: ['county clusters', 'county life expectancy clusters'],
    },

    // ---- Air Quality (US) ----------------------------------------------
    {
      id: 'local-air-pm25',
      token: 'ap',
      group: 'Air Quality (US)',
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
      group: 'Air Quality (US)',
      vintage: '2022',
      aliases: ['ozone'],
    },
    {
      id: 'local-air-nonattainment',
      token: 'an',
      group: 'Air Quality (US)',
      vintage: 'as of Aug 2026',
      aliases: ['nonattainment', 'nonattainment areas'],
    },

    // ---- Green Space (US) ----------------------------------------------
    {
      id: 'local-park-access',
      token: 'pa',
      group: 'Green Space (US)',
      vintage: '2020',
      aliases: ['green space', 'green spaces', 'park access'],
    },
    {
      id: 'local-parks',
      token: 'pk',
      group: 'Green Space (US)',
      vintage: '2025',
      aliases: ['parks', 'park outlines'],
    },

    // ---- Health & Housing (US) -----------------------------------------
    {
      id: 'local-trauma-centers',
      token: 'tc',
      group: 'Health & Housing (US)',
      cardNoun: 'Trauma center',
      aliases: [
        'trauma centers',
        'trauma centres',
        'trauma units',
        'hospitals',
      ],
    },
    {
      id: 'local-public-housing',
      token: 'ph',
      group: 'Health & Housing (US)',
      cardNoun: 'Public housing',
      aliases: ['public housing', 'housing projects', 'projects'],
    },

    // ---- Social & Economic (US): ACS 2020–2024 tracts --------------------
    {
      id: 'local-acs-poverty',
      token: 'sp',
      group: 'Social & Economic (US)',
      vintage: '2020–2024',
      aliases: ['poverty', 'poverty rate', 'below poverty'],
    },
    {
      id: 'local-acs-income',
      token: 'si',
      group: 'Social & Economic (US)',
      vintage: '2020–2024',
      aliases: ['income', 'median income', 'household income'],
    },
    {
      id: 'local-acs-unemployment',
      token: 'su',
      group: 'Social & Economic (US)',
      vintage: '2020–2024',
      aliases: ['unemployment', 'unemployment rate', 'jobless rate'],
    },
    {
      id: 'local-acs-education',
      token: 'se',
      group: 'Social & Economic (US)',
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
      group: 'Social & Economic (US)',
      vintage: '2020–2024',
      aliases: ['renters', 'renter occupied', 'tenure', 'rental housing'],
    },
    {
      id: 'local-acs-black',
      token: 'sb',
      group: 'Social & Economic (US)',
      vintage: '2020–2024',
      aliases: ['black residents', 'black population', 'african american'],
    },
    {
      id: 'local-acs-hispanic',
      token: 'sh',
      group: 'Social & Economic (US)',
      vintage: '2020–2024',
      aliases: ['hispanic residents', 'latino', 'hispanic population'],
    },
    {
      id: 'local-acs-no-vehicle',
      token: 'sv',
      group: 'Social & Economic (US)',
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
      group: 'Social & Economic (US)',
      vintage: '2020–2024',
      aliases: ['broadband', 'broadband tracts', 'internet subscription'],
    },

    // ---- Internet Access (US): CPS 1998–2010 (states) + ACS (counties) --
    {
      id: 'local-internet-use',
      token: 'iu',
      group: 'Internet Access (US)',
      vintage: '1998–2024',
      aliases: ['internet use', 'internet usage', 'internet at home'],
    },
    {
      id: 'local-internet-highspeed',
      token: 'ih',
      group: 'Internet Access (US)',
      vintage: '2000–2024',
      aliases: [
        'high speed internet',
        'high-speed internet',
        'broadband history',
      ],
    },

    // ---- Research Data (key-locked) ------------------------------------
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

    // ---- Boston ----------------------------------------------------------
    {
      id: 'local-boston-neighborhoods',
      token: 'bn',
      group: 'Boston',
      cardNoun: 'Neighborhood',
      aliases: ['boston neighborhoods', 'boston neighbourhoods'],
    },

    // ---- Chicago ---------------------------------------------------------
    {
      id: 'local-chicago-events',
      token: 'k',
      group: 'Chicago',
      cardNoun: 'Event',
      aliases: ['chicago events', 'chicago homicides'],
    },
    {
      id: 'local-tlr',
      token: 'tl',
      group: 'Chicago',
      cardNoun: 'Event',
      aliases: ['tlr', 'no limit'],
    },
    {
      id: 'local-famous-shootings',
      token: 'v',
      group: 'Chicago',
      cardNoun: 'Shooting',
      aliases: ['famous shootings', 'shootings'],
    },
    {
      id: 'local-gang-map',
      token: 'y',
      group: 'Chicago',
      cardNoun: 'Hood',
      aliases: ['gang map', 'gang territories', 'gangs'],
    },
    {
      id: 'local-gang-map-labels',
      token: 'l',
      group: 'Chicago',
      aliases: ['gang names', 'gang labels'],
    },

    // ---- Miami-Dade Homicides --------------------------------------------
    {
      id: 'local-miami-homicide-hotspots',
      token: 'mh',
      group: 'Miami-Dade Homicides',
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
      group: 'Miami-Dade Homicides',
      vintage,
      cardNoun: 'Homicide',
      aliases: [`miami homicides ${decade}`],
    })),

    // ---- 3D Captures -----------------------------------------------------
    {
      id: 'local-3d-captures',
      token: '3d',
      group: '3D Captures',
      aliases: ['3d captures', 'splats', 'gaussian splats'],
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
      id: 'lowflyers',
      token: 'lf',
      disposition: 'enabled+mirrored-options',
      optionOwner: 'flights',
      group: 'Live Feeds',
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
    {
      id: 'ais-live-vessels',
      token: 'a',
      group: 'Live Feeds',
      label: 'Live Vessels',
      aliases: ['ais', 'ships', 'vessels', 'live vessels'],
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
    { id: 'bhote-koshi-2026', token: 'h', group: null },
    { id: 'bhote-koshi-locator', token: 'z', group: null },
    { id: 'military-awareness', token: 'g', group: null },
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

/** Every layer id, in share-link (sorted id) order. */
export const REGISTERED_LAYER_IDS = Object.freeze(
  LAYER_MANIFEST.map((entry) => entry.id).sort(),
);

/** Entry for one layer id, or undefined. */
const BY_ID = new Map(LAYER_MANIFEST.map((entry) => [entry.id, entry]));
export function layerManifestEntry(id) {
  return BY_ID.get(id);
}
