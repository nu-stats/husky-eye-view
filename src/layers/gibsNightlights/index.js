import { createImageryTileLayer } from '../imageryTile/factory.js';
import {
  GIBS_PRODUCTS,
  GIBS_CREDIT,
  createGibsSource,
  productUrlTemplate,
} from '../imageryTile/products.js';
import { US_IMAGERY_BOXES } from '../../data/usArea.js';
import { loadOutlineRings } from '../imageryTile/tileMask.js';

/**
 * Night lights (NASA Black Marble): the VIIRS Black Marble 2016 composite
 * from NASA GIBS, drawn only over the United States.
 * Adapted from the Sheldondouthat/satwq-reality-os fork of God's Eye View
 * (MIT); Husky Eye View limits the tiles to US boxes (src/data/usArea.js)
 * and cuts each one to the US outline (us_outline.json, built from the
 * bundled Natural Earth countries by scripts/build-us-outline.mjs).
 */
const PRODUCT = GIBS_PRODUCTS.nightlights;

export const NIGHTLIGHTS_COVERAGE =
  'US only: tiles load just over the lower 48, Alaska, Hawaii, Puerto Rico and the US Virgin Islands, cut to the US border (Natural Earth outline, about 1 km detail). ' +
  "NASA's cloud-free composite of 2016 VIIRS night-time light, with moonlight, aurora and fires removed.";

/** Snapshot source for the layer — exposes getSnapshot for catalog wiring. */
export function createGibsNightlightsSource(options) {
  return createGibsSource(PRODUCT, options);
}

export function createGibsNightlightsLayer({ source, ...rest } = {}) {
  return createImageryTileLayer({
    id: PRODUCT.id,
    name: PRODUCT.name,
    icon: PRODUCT.icon,
    sourceLabel: PRODUCT.sourceLabel,
    credit: PRODUCT.credit || GIBS_CREDIT,
    urlTemplate: productUrlTemplate(PRODUCT),
    maximumLevel: PRODUCT.maximumLevel,
    updateInterval: PRODUCT.updateInterval,
    boxes: US_IMAGERY_BOXES,
    outline: () =>
      loadOutlineRings(
        new URL(
          '../../data/local_data/natural_earth/us_outline.json',
          import.meta.url,
        ),
      ),
    info: '2016 composite · US only',
    infoTitle: NIGHTLIGHTS_COVERAGE,
    source: source || createGibsNightlightsSource(),
    ...rest,
  });
}
