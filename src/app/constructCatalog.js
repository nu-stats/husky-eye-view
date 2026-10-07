import { createLayerCatalog } from './catalog.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';
import { createMilitaryRegistry } from '../layers/aircraft/classification.js';
import { createLowFlyerRegistry } from '../layers/aircraft/lowFlyerRegistry.js';
import { createApplicationFlights } from './layers/flights.js';
import { createApplicationMilitary } from './layers/militaryFlights.js';
import { createApplicationLowFlyers } from './layers/lowFlyers.js';
import { createApplicationVessels } from './layers/aisLiveVessels.js';
import { createApplicationCctv } from './layers/cctv.js';
import { createApplicationRadio } from './layers/radio.js';
import { createApplicationTraffic } from './layers/traffic.js';
import { createApplicationBikeshare } from './layers/bikeshare.js';
import { createApplicationDirections } from './layers/directions.js';
import { createApplicationTransit } from './layers/transit.js';
import { createApplicationInstallations } from './layers/militaryInstallations.js';
import { createApplicationSatellites } from './layers/satellites.js';
import { createApplicationLaunches } from './layers/rocketLaunches.js';
import { createApplicationAlpr } from './layers/alprCameras.js';
import { createApplicationAwareness } from './layers/militaryAwareness.js';
import { createApplicationFirms } from './layers/firms.js';
import { createApplicationEarthquakes } from './layers/earthquakes.js';
import { createApplicationCables } from './layers/submarineCables.js';
import { createInfrastructureLayers } from '../data/infrastructure.js';
import { createSplatCapturesLayer } from '../data/splatCaptures.js';
import { localGeoJsonServices } from './localGeojsonServices.js';
// The Nepal flood (Bhote Koshi) event and locator layers are off for now
// (2026-10-06); their modules stay in src/data. Restoring them means adding
// them back here, in layerManifest.js and in scenes/recipes.js.

const SOURCE_METHODS = Object.freeze({
  flights: ['getSnapshot'],
  military: ['getSnapshot'],
  lowflyers: ['getSnapshot'],
  vessels: ['getSnapshot'],
  cctv: ['getCatalog', 'getHealth', 'getFrameUrl', 'getMediaUrl'],
  radio: ['getDirectory', 'recordClick'],
  traffic: [
    'requestRoads',
    'getStatus',
    'fetchFlowForBounds',
    'getFlowSessionStats',
    'resetFlowTileCache',
  ],
  bikeshare: ['getStations'],
  installations: ['getMappedSites', 'searchNearby'],
  satellites: ['readGroup'],
  launches: ['getLaunches', 'getActiveTle'],
  alpr: ['fetch'],
  firms: ['getSnapshot'],
  earthquakes: ['getSnapshot'],
  cables: ['fetch'],
});

/** Construct the current catalog without choosing any source provider.
 * Scene engines remain page-owned; layers and classification have this app's lifetime.
 * The manager owns layer destruction, while abort releases classification even if startup fails.
 */
export function createApplicationCatalog({
  surface,
  sources,
  signal,
  metadata = LAYER_STATE_REGISTRY,
  vesselOptions,
  resolveAsset,
}) {
  if (!signal?.addEventListener)
    throw new TypeError('An application lifetime signal is required');
  signal.throwIfAborted();
  if (!surface?.groundFloor || !surface?.terrain)
    throw new TypeError('Application surface services are required');

  for (const [name, methods] of Object.entries(SOURCE_METHODS)) {
    if (
      methods.some((method) => typeof sources?.[name]?.[method] !== 'function')
    )
      throw new TypeError(`Invalid catalog source: ${name}`);
  }
  const militaryRegistry = createMilitaryRegistry();
  const lowFlyerRegistry = createLowFlyerRegistry();
  const dispose = () => {
    signal.removeEventListener('abort', dispose);
    militaryRegistry.dispose();
    lowFlyerRegistry.dispose();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    militaryRegistry.configureSource(sources.military, { signal });
    const flights = createApplicationFlights({
      surface,
      source: sources.flights,
      militaryRegistry,
      lowFlyerRegistry,
      resolveAsset,
    });
    const military = createApplicationMilitary({
      surface,
      source: sources.military,
      militaryRegistry,
      resolveAsset,
    });
    const lowflyers = createApplicationLowFlyers({
      surface,
      source: sources.lowflyers,
      militaryRegistry,
      lowFlyerRegistry,
      resolveAsset,
    });
    const vessels = createApplicationVessels({
      source: sources.vessels,
      options: vesselOptions,
    });
    const installations = createApplicationInstallations({
      surface,
      source: sources.installations,
    });
    const satellites = createApplicationSatellites({
      source: sources.satellites,
    });
    const catalog = createLayerCatalog(
      [
        flights,
        military,
        lowflyers,
        createApplicationEarthquakes({ source: sources.earthquakes }),
        createApplicationAlpr({ surface, source: sources.alpr }),
        satellites,
        createApplicationLaunches({ source: sources.launches, satellites }),
        createApplicationTraffic({ source: sources.traffic }),
        createApplicationCctv({ surface, source: sources.cctv }),
        createApplicationRadio({ surface, source: sources.radio }),
        createApplicationTransit({ surface, source: sources.transit }),
        createApplicationBikeshare({ source: sources.bikeshare }),
        createApplicationDirections(),
        vessels,
        installations,
        createApplicationAwareness({
          flights,
          military,
          lowflyers,
          vessels,
          installations,
        }),
        ...createInfrastructureLayers(localGeoJsonServices),
        createSplatCapturesLayer(),
        createApplicationCables({ source: sources.cables }),
        createApplicationFirms({
          surface,
          id: 'local-firms',
          name: 'FIRMS Active Fires',
          icon: '▲',
          source: 'NASA FIRMS · LIVE',
          feed: sources.firms,
        }),
      ],
      metadata,
    );
    return Object.freeze({
      ...catalog,
      militaryRegistry,
      lowFlyerRegistry,
      surface,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
