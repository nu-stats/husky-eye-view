import { createGibsNightlightsLayer } from '../../layers/gibsNightlights/index.js';
import { governorRequestRender } from '../../renderGovernor.js';

/** Wire the NASA GIBS Black Marble night-lights tile layer to the application. */
export function createApplicationGibsNightlights(options) {
  return createGibsNightlightsLayer({
    requestRender: governorRequestRender,
    ...options,
  });
}
