import * as Cesium from 'cesium';

/**
 * Per-layer data attribution registered into Cesium's credit display.
 *
 * Legal requirement (see DATA_SOURCES.md, findings H10/H11 in
 * docs/pre-ship-audit-2026-07-01.md): every third-party data layer this app can
 * display carries its own license and required attribution — ODbL (OSM
 * datacenters/dams, adsb.lol, Overpass roads), CC BY-NC-SA (TeleGeography
 * cables), NASA FIRMS, CelesTrak, USGS, City of Austin, Fintraffic (CC BY 4.0),
 * The MIT code license does NOT cover this data.
 *
 * These credits are registered ONCE at init as STATIC credits with
 * showOnScreen=false, so they live in the expandable bottom-left "Data
 * attribution" lightbox (Cesium's credit popover) rather than cluttering the
 * on-globe line. Always-present is intentional and reversible: the lightbox is
 * the app's canonical attribution surface and DATA_SOURCES.md is the
 * machine-readable index. Strings are copied verbatim from DATA_SOURCES.md — if
 * you add a data source, add it there AND here.
 */

/**
 * Attribution entries. `html` is the credit markup; keep it minimal and
 * link out where DATA_SOURCES.md provides a canonical URL. Order roughly
 * follows DATA_SOURCES.md (live sources, then bundled snapshots).
 * @type {{ key: string, html: string }[]}
 */
export const DATA_CREDITS = [
  // ── Live sources ────────────────────────────────────────────────
  {
    key: 'opensky',
    html:
      'Flights: OpenSky Network — Schäfer et al., ' +
      '“Bringing Up OpenSky”, IPSN 2014 · ' +
      '<a href="https://opensky-network.org" target="_blank" rel="noopener">opensky-network.org</a> ' +
      '(non-commercial)',
  },
  {
    key: 'adsblol',
    html:
      'Military flights, aircraft traces &amp; bounded regional flight fallback: ' +
      '<a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'adsbdb',
    html:
      'Aircraft type, registration &amp; flight routes: ' +
      '<a href="https://www.adsbdb.com" target="_blank" rel="noopener">adsbdb</a> ' +
      '· aircraft data from PlaneBase · ICAO-to-N-number conversion by ' +
      'Guillaume Michel · route data is the work of ' +
      'David Taylor, Edinburgh, and Jim Mason, Glasgow, and may not be ' +
      'copied, published, or incorporated into other databases without the ' +
      'explicit permission of David J Taylor, Edinburgh',
  },
  {
    key: 'aisstream',
    html:
      'Live vessels (AIS): ' +
      '<a href="https://aisstream.io" target="_blank" rel="noopener">AISStream.io</a>',
  },
  {
    key: 'celestrak',
    html:
      'Satellites (TLEs): CelesTrak ' +
      '(<a href="https://celestrak.org" target="_blank" rel="noopener">celestrak.org</a>), ' +
      'Dr. T.S. Kelso',
  },
  {
    key: 'launch-library-2',
    html:
      'Space mission launch, payload &amp; recovery metadata: ' +
      '<a href="https://ll.thespacedevs.com/docs/" target="_blank" rel="noopener">Launch Library 2 — The Space Devs</a> ' +
      '(API documentation and rate limits)',
  },
  {
    key: 'usgs',
    html: 'Earthquakes: Data courtesy of the U.S. Geological Survey',
  },
  {
    key: 'overpass',
    html:
      'Road geometry (traffic): ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'photon-geocoder',
    html:
      'Keyless place search: ' +
      '<a href="https://photon.komoot.io" target="_blank" rel="noopener">Photon</a> (komoot) over ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'alpr-osm',
    html:
      'ALPR camera locations (automatic license plate readers): ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a>); ' +
      'community mapping includes <a href="https://deflock.org" target="_blank" rel="noopener">DeFlock</a>',
  },
  {
    key: 'military-installations-osm',
    html:
      'Mapped installation context: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0; incomplete mapped context)',
  },
  {
    key: 'cockpit-place-osm',
    html:
      'Cockpit place context and last-resort place search: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      'via Nominatim (ODbL 1.0)',
  },
  {
    key: 'open-meteo',
    html:
      'Cockpit current conditions: ' +
      '<a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> ' +
      '(CC BY 4.0)',
  },
  {
    key: 'google-news-rss',
    html:
      'Cockpit regional headlines: ' +
      '<a href="https://policies.google.com/terms" target="_blank" rel="noopener">Google News RSS</a> ' +
      '(location-matched article links; publisher terms apply)',
  },
  {
    key: 'gdelt',
    html:
      'Cockpit regional headlines: ' +
      '<a href="https://www.gdeltproject.org/about.html" target="_blank" rel="noopener">GDELT Project</a> ' +
      '(location-matched article links; publisher terms apply)',
  },
  {
    key: 'austin-cctv',
    html:
      'CCTV cameras &amp; frames: City of Austin, TX — ' +
      '<a href="https://data.austintexas.gov" target="_blank" rel="noopener">data.austintexas.gov</a>',
  },
  {
    key: 'txdot-cctv',
    html:
      'CCTV cameras &amp; frames (Texas): ' +
      '<a href="https://its.txdot.gov/" target="_blank" rel="noopener">Texas Department of Transportation</a> (courtesy)',
  },
  {
    key: 'caltrans-cctv',
    html:
      'CCTV cameras &amp; frames (California): Caltrans — ' +
      '<a href="https://cwwp2.dot.ca.gov/" target="_blank" rel="noopener">cwwp2.dot.ca.gov</a>',
  },
  {
    key: 'tfl-cctv',
    html:
      'CCTV cameras &amp; frames (London): ' +
      '<a href="https://tfl.gov.uk/info-for/open-data-users/" target="_blank" rel="noopener">Powered by TfL Open Data</a>. ' +
      'Contains OS data © Crown copyright and database rights.',
  },
  {
    key: 'ontario-511-cctv',
    html:
      'CCTV cameras &amp; frames (Ontario): ' +
      '<a href="https://511on.ca/" target="_blank" rel="noopener">Ontario 511</a> ' +
      '(<a href="https://www.ontario.ca/page/open-government-licence-ontario" target="_blank" rel="noopener">Open Government Licence - Ontario</a>)',
  },
  {
    key: 'fintraffic-cctv',
    html:
      'CCTV cameras &amp; frames (Finland): Fintraffic / ' +
      '<a href="https://www.digitraffic.fi/en/" target="_blank" rel="noopener">digitraffic.fi</a>, ' +
      'license CC BY 4.0',
  },
  {
    key: 'calgary-cctv',
    html:
      'Traffic cameras (Calgary): contains information licensed under the ' +
      '<a href="https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa" target="_blank" rel="noopener">Open Government Licence – City of Calgary</a>',
  },
  {
    key: 'gbfs',
    html: 'Bikeshare availability: GBFS operator feeds (e.g. Austin BCycle)',
  },
  {
    key: 'osrm-routing',
    // The service asks for its attribution to carry a "fix the map" link, so
    // a reader who spots a wrong turn can go and correct the data it came from.
    html:
      'Routing (voice routes and Directions): OSRM on the FOSSGIS servers — ' +
      '<a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">routing.openstreetmap.de</a> · ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> (ODbL) · ' +
      '<a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">fix the map</a>',
  },
  {
    key: 'gtfs-rt',
    html: 'Transit vehicles: operator GTFS-Realtime feeds (each operator is credited below when its vehicles are shown)',
  },
  {
    key: 'radio-browser',
    html:
      'Internet-radio station directory: ' +
      '<a href="https://www.radio-browser.info/" target="_blank" rel="noopener">Radio Browser</a> ' +
      '(public domain; audio delivered directly by each broadcaster)',
  },
  {
    key: 'reearth-terrain',
    html:
      'Terrain (keyless globe stacks): ' +
      '<a href="https://terrain.reearth.land" target="_blank" rel="noopener">Re:Earth Terrain</a> / ' +
      'Mapterhorn (CC BY 4.0) / EGM2008 (NGA)',
  },
  // ── Bundled snapshots ───────────────────────────────────────────
  {
    key: 'datacenters',
    html:
      'Datacenters: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'dams',
    html:
      'Dams: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0) + Open Infrastructure Map',
  },
  {
    key: 'firms',
    html:
      'Active fires: NASA FIRMS — we acknowledge the use of data and/or imagery ' +
      'from NASA’s Fire Information for Resource Management System ' +
      '(<a href="https://earthdata.nasa.gov/firms" target="_blank" rel="noopener">earthdata.nasa.gov/firms</a>), ' +
      'part of NASA’s Earth Observing System Data and Information System (EOSDIS)',
  },
  {
    key: 'drivebc-cctv',
    html:
      'CCTV cameras &amp; frames (British Columbia): ' +
      '<a href="https://www.drivebc.ca/" target="_blank" rel="noopener">DriveBC</a>. ' +
      'Contains information licensed under the ' +
      '<a href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc" target="_blank" rel="noopener">Open Government Licence – British Columbia</a>. ' +
      'Some cameras are supplied by partners (TransLink, the City of Vancouver, the City of Surrey, Parks Canada and others); each names its provider in the CCTV panel.',
  },
  {
    key: 'tallinn-cctv',
    html:
      'CCTV cameras &amp; frames (Tallinn): City of Tallinn — ' +
      '<a href="https://ristmikud.tallinn.ee/" target="_blank" rel="noopener">ristmikud.tallinn.ee</a> (courtesy)',
  },
  {
    key: 'tarktee-cctv',
    html:
      'CCTV cameras &amp; frames (Estonia road weather): Transpordiamet / Tarktee — ' +
      '<a href="https://tarktee.transpordiamet.ee/" target="_blank" rel="noopener">tarktee.transpordiamet.ee</a> (courtesy)',
  },
  {
    key: 'warendorf-cctv',
    html:
      'Webcam (Warendorf): <a href="https://www.warendorf.de/" target="_blank" rel="noopener">Stadt Warendorf</a> (courtesy); ' +
      'camera poses derived from OpenStreetMap geometry, © OpenStreetMap contributors (ODbL)',
  },
  {
    key: 'nsw-cctv',
    html:
      'CCTV cameras &amp; frames (New South Wales): ' +
      '<a href="https://www.livetraffic.com/" target="_blank" rel="noopener">Live Traffic NSW</a> — Transport for NSW ' +
      '(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>)',
  },
  {
    key: 'telegeography',
    html:
      'Submarine cables: © TeleGeography — ' +
      '<a href="https://www.submarinecablemap.com" target="_blank" rel="noopener">submarinecablemap.com</a> ' +
      '(CC BY-NC-SA 3.0 — NonCommercial)',
  },

  // ── Husky Eye View research layers ───────────────────────────────
  {
    key: 'mapping-inequality',
    html:
      'HOLC redlining maps and 1930s area descriptions: Robert K. Nelson, LaDale Winling et al., ' +
      '<a href="https://dsl.richmond.edu/panorama/redlining/" target="_blank" rel="noopener">Mapping Inequality: Redlining in New Deal America</a>, ' +
      'American Panorama, University of Richmond Digital Scholarship Lab',
  },
  {
    key: 'ltdb-segregation',
    html:
      'Segregation (dissimilarity, computed by Husky Eye View): ' +
      '<a href="https://s4.ad.brown.edu/Projects/Diversity/Researcher/Bridging.htm" target="_blank" rel="noopener">Longitudinal Tract Data Base</a>, ' +
      'Spatial Structures in the Social Sciences, Brown University — Logan, Xu &amp; Stults (2014), ' +
      '“Interpolating US Decennial Census Tract Data from as Early as 1970 to 2010,” <i>The Professional Geographer</i> 66(3)',
  },
  {
    key: 'usaleep',
    html:
      'Tract life expectancy 2010–2015: ' +
      '<a href="https://www.cdc.gov/nchs/nvss/usaleep/usaleep.html" target="_blank" rel="noopener">U.S. Small-Area Life Expectancy Estimates Project (USALEEP)</a> — ' +
      'NCHS, NAPHSIS and the Robert Wood Johnson Foundation; clusters (Local Moran’s I) computed by the project',
  },
  {
    key: 'county-life-expectancy',
    html: 'County life expectancy 2000–2019, total and by race and ethnicity, with clusters (Local Moran’s I) computed by the project',
  },
  {
    key: 'cdc-tracking',
    html:
      'PM2.5 and ozone (Downscaler model, EPA CMAQ with monitor data) and access to parks: ' +
      '<a href="https://ephtracking.cdc.gov" target="_blank" rel="noopener">CDC Environmental Public Health Tracking Network</a>',
  },
  {
    key: 'epa-green-book',
    html:
      'Nonattainment areas: ' +
      '<a href="https://www.epa.gov/green-book" target="_blank" rel="noopener">U.S. EPA Green Book</a>',
  },
  {
    key: 'census-acs',
    html:
      'Social and economic measures, internet and broadband, segregation 2020–2024, Curated Flights: ' +
      '<a href="https://www.census.gov/programs-surveys/acs" target="_blank" rel="noopener">U.S. Census Bureau, American Community Survey</a> ' +
      '5-year estimates (2013–2017, 2020–2024); city populations from the Vintage 2024 population estimates',
  },
  {
    key: 'census-cps-ntia',
    html:
      'Internet use 1998–2010: U.S. Census Bureau Current Population Survey, Computer and Internet Use Supplement, via the ' +
      '<a href="https://www.ntia.gov/data/explorer" target="_blank" rel="noopener">NTIA Data Explorer</a>',
  },
  {
    key: 'census-boundaries',
    html:
      'Boundaries: U.S. Census Bureau TIGER/Line, cartographic boundary files (tracts, counties, places), ' +
      'TIGERweb, the 2010–2020 tract relationship file and the 2010 Gazetteer; parks from TIGER/Line Area Landmarks',
  },
  {
    key: 'hifld-hospitals',
    html:
      'Trauma centers: ' +
      '<a href="https://hifld-geoplatform.hub.arcgis.com" target="_blank" rel="noopener">Homeland Infrastructure Foundation-Level Data (HIFLD)</a>, Hospitals',
  },
  {
    key: 'hud-public-housing',
    html:
      'Public housing developments: ' +
      '<a href="https://hudgis-hud.opendata.arcgis.com" target="_blank" rel="noopener">U.S. Department of Housing and Urban Development (HUD)</a>',
  },
  {
    key: 'boston-neighborhoods',
    html:
      'Boston neighborhoods: City of Boston neighborhood statistical areas, ' +
      '<a href="https://data.boston.gov" target="_blank" rel="noopener">Analyze Boston</a>',
  },
  {
    key: 'chicago-layers',
    html:
      'Chicago events, TLR and famous shootings: project-compiled from public reporting and video; ' +
      'gang territories and names: community-mapped “Big Bas #1 Chicagoland &amp; Illinois Gang Map” (Google My Maps)',
  },
  {
    key: 'miami-homicides',
    html: 'Miami-Dade homicides 1956–2011 and hotspots: Miami-Dade homicide records, compiled by the project',
  },
  {
    key: 'restricted-research',
    html:
      'Restricted (key-locked) research data: ' +
      '<a href="https://www.gunviolencearchive.org" target="_blank" rel="noopener">Gun Violence Archive</a> (2015); ' +
      'Associated Press / USA TODAY / Northeastern University Mass Killing Database (2006–2023)',
  },
  {
    key: 's4-enumeration-districts',
    html:
      'Census enumeration districts 1900–1930: Shertzer, Walsh and Logan (2016), Historical Methods 49(4); ' +
      '<a href="https://s4.ad.brown.edu/Projects/UTP2/ncities.htm" target="_blank" rel="noopener">Urban Transition Historical GIS Project</a>, S4, Brown University',
  },
  {
    key: 'ntia-internet-use-survey',
    html:
      'Internet use by state, adults 15+: ' +
      '<a href="https://www.ntia.gov/data/explorer" target="_blank" rel="noopener">NTIA Internet Use Survey (Data Explorer)</a>, ' +
      'U.S. Census Bureau CPS Computer and Internet Use Supplement',
  },
  {
    key: 'asu-county-broadband',
    html:
      'Broadband at home by county, 2000–2018: Caroline Tolbert and Karen Mossberger (2020), ' +
      '<a href="https://techdatasociety.asu.edu/broadband-data-portal/county-data" target="_blank" rel="noopener">U.S. CPS & ACS Geographic Estimates of Internet Use, 1997–2018</a>, ' +
      'Technology, Data and Society, Arizona State University',
  },
  {
    key: 'chicago-historical-homicides',
    html:
      'Chicago homicides 1870–1930 (key-locked): Leigh Bienen, ' +
      '<a href="https://doi.org/10.21985/N2HB3R" target="_blank" rel="noopener">Homicide in Chicago, 1870–1930</a> ' +
      '(Chicago Historical Homicide Project, Northwestern University); locations geocoded against ' +
      '<a href="https://data.cityofchicago.org/d/pr57-gg9e" target="_blank" rel="noopener">City of Chicago street center lines</a>, ' +
      'the Chicago Directory Company’s 1909 Plan of Re-Numbering, and William Martin’s 1948 list of Chicago street-name changes (Living History of Illinois)',
  },
  {
    key: 'splat-sample',
    html: '3D capture sample: CesiumJS sample data (Apache-2.0)',
  },
  {
    key: 'bpd-scanner',
    html:
      'Boston Police scanner link: the department’s public feed on ' +
      '<a href="https://radio.rapidsos.com/boston" target="_blank" rel="noopener">radio.rapidsos.com/boston</a> (linked, not played)',
  },
];

/**
 * Conditional credits — registered via `registerDynamicCredit` only when the
 * corresponding capability actually activates (deliberately NOT part of
 * DATA_CREDITS, which is always-on). TomTom terms require attribution when
 * their flow data is displayed; keyless installs never show it, so the
 * credit only appears once live traffic-flow mode activates.
 * @type {{ key: string, html: string }}
 */
export const TOMTOM_CREDIT = {
  key: 'tomtom',
  html:
    'Traffic flow data © ' +
    '<a href="https://www.tomtom.com" target="_blank" rel="noopener">TomTom</a>',
};

/** Registered when the first Natural Earth region outline resolves (public
 * domain — no attribution required; credited as a courtesy). */
export const NATURAL_EARTH_CREDIT = {
  key: 'natural-earth',
  html:
    'Physical region boundaries from ' +
    '<a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain)',
};

/**
 * Per-feed transit credit, registered the first time that feed's vehicles
 * render (see `src/data/transitFeeds.js` for the license of each).
 * @param {{ id: string, attribution: string, license: string, licenseUrl: string }} feed
 * @returns {{ key: string, html: string }}
 */
export function transitFeedCredit(feed) {
  const escape = (text) =>
    String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  return {
    key: `transit-${feed.id}`,
    html:
      `Transit (${escape(feed.attribution)}): ` +
      `<a href="${escape(feed.licenseUrl)}" target="_blank" rel="noopener">${escape(feed.license)}</a>`,
  };
}

/** Registered when the Bhote Koshi event reconstruction activates. */
export const BHOTE_KOSHI_CREDIT = {
  key: 'bhote-koshi-2026',
  html:
    'Bhote Koshi 2026 event imagery and derived reconstruction: ' +
    '<a href="https://vantor.com/company/open-data-program" target="_blank" rel="noopener">Vantor Open Data</a> ' +
    'and <a href="https://github.com/geo-pera/bhotekoshi-2026-reconstruction" target="_blank" rel="noopener">GeoPera</a> ' +
    '(CC BY-NC 4.0); terrain © Re:Earth / Mapterhorn (CC BY 4.0)',
};

/** Registered when the scene-friendly Nepal incident locator activates. */
export const BHOTE_KOSHI_LOCATOR_CREDIT = {
  key: 'bhote-koshi-locator',
  html:
    'Nepal administrative boundary and nearby-city locations: ' +
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
    '(ODbL 1.0); incident-place anchors use an owner-curated, source-verified geolocation union; ' +
    'flood corridor derived from the ' +
    '<a href="https://github.com/geo-pera/bhotekoshi-2026-reconstruction/blob/main/vectors/river_centerline.geojson" target="_blank" rel="noopener">GeoPera river centerline</a> ' +
    '(CC BY-NC 4.0)',
};

/** @type {Set<string>} Keys of dynamic credits already registered this session. */
const _dynamicCreditKeys = new Set();

/**
 * Register a conditional credit at the moment its data source activates.
 * Idempotent per `credit.key`; lands in the same "Data attribution" popover
 * as the static credits (showOnScreen=false).
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 * @param {{ key: string, html: string }} credit — e.g. `TOMTOM_CREDIT`
 * @returns {boolean} True when the credit is (now) registered.
 */
export function registerDynamicCredit(viewer, credit) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return false;
  }
  if (!credit?.key || !credit?.html) return false;
  if (_dynamicCreditKeys.has(credit.key)) return true;
  creditDisplay.addStaticCredit(new Cesium.Credit(credit.html, false));
  _dynamicCreditKeys.add(credit.key);
  return true;
}

/**
 * Register every per-layer data credit into the viewer's credit display.
 * Idempotent: safe to call once at init. Credits are static and always
 * present in the "Data attribution" popover.
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 */
export function registerDataCredits(viewer, credits = DATA_CREDITS) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return;
  }
  for (const { html } of credits) {
    // showOnScreen=false → lives in the expandable "Data attribution" popover,
    // not the on-globe credit line.
    creditDisplay.addStaticCredit(new Cesium.Credit(html, false));
  }
}
