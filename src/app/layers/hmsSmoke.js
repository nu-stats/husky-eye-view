import {
  createHmsSmokeLayer,
  createHmsSmokeSource,
} from '../../layers/hmsSmoke/index.js';
import { governorRequestRender } from '../../renderGovernor.js';

/**
 * Wire the NOAA HMS daily smoke polygons to the application. Like Recent
 * Imagery it takes no catalog source: its one feed is the keyless
 * same-origin /api/hms-smoke proxy.
 */
export function createApplicationHmsSmoke(options) {
  return createHmsSmokeLayer({
    source: createHmsSmokeSource(),
    requestRender: governorRequestRender,
    ...options,
  });
}
