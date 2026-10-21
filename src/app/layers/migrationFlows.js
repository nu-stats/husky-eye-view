import * as Cesium from 'cesium';
import { createMigrationFlowsLayer } from '../../layers/migrationFlows/index.js';
import { overlayHost } from './overlayHost.js';

/** Wire the Migration & Refugee Flows layer to the application overlay host. */
export function createApplicationMigrationFlows(options) {
  return createMigrationFlowsLayer({
    overlayHost,
    screenSpaceEventHandlerFactory: (canvas) =>
      new Cesium.ScreenSpaceEventHandler(canvas),
    ...options,
  });
}
