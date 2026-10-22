/**
 * NASA GIBS product configuration and snapshot source for the keyless tile
 * imagery layers. Adapted from the Sheldondouthat/satwq-reality-os fork of
 * God's Eye View (MIT); Husky Eye View keeps only the Black Marble night
 * lights product. Sources never invent data: a product without a usable
 * layer name, tile set or date throws.
 */

/** GIBS WMTS REST root for WebMercator ("best" = the best available version). */
export const GIBS_WMTS_BASE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const GIBS_CREDIT =
  'Imagery: We acknowledge the use of imagery provided by services from ' +
  "NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth " +
  'Science Data and Information System (ESDIS)';

const SIX_HOURS_MS = 6 * 3600 * 1000;

/** Yesterday in UTC as YYYY-MM-DD — the GIBS "best" daily layers lag ~1 day. */
export function yesterdayDateUTC(nowMs = Date.now()) {
  const date = new Date(nowMs);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Verified GIBS WMTS REST pattern (epsg3857/best, WebMercator — matches
 * Cesium's default UrlTemplateImageryProvider tiling):
 *   {BASE}/{LAYER}/default/{DATE}/{MATRIXSET}/{z}/{y}/{x}.{ext}
 */
export function gibsTileTemplate({ layerName, matrixSet, ext, date }) {
  if (
    !layerName ||
    !matrixSet ||
    !ext ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date || '')
  )
    throw new TypeError(
      'gibsTileTemplate requires layerName, matrixSet, ext, date',
    );
  return `${GIBS_WMTS_BASE}/${layerName}/default/${date}/${matrixSet}/{z}/{y}/{x}.${ext}`;
}

/**
 * Snapshot source for a NASA GIBS daily (or fixed-date) layer. The template is
 * recomputed on every snapshot so a daily product's date rolls over at UTC
 * midnight; a fixed-date product always gives the same template.
 */
export function createGibsSource(product, { now = () => Date.now() } = {}) {
  if (!product?.wmtsLayer)
    throw new TypeError('createGibsSource requires a GIBS product config');
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const date = product.fixedDate || yesterdayDateUTC(now());
      return {
        template: gibsTileTemplate({
          layerName: product.wmtsLayer,
          matrixSet: product.matrixSet,
          ext: product.ext,
          date,
        }),
        date,
        maximumLevel: product.maximumLevel,
        credit: product.credit || GIBS_CREDIT,
        timeMs: Date.parse(`${date}T00:00:00Z`),
      };
    },
  };
}

/** GIBS product configurations used by Husky Eye View. */
export const GIBS_PRODUCTS = Object.freeze({
  // VIIRS Black Marble: NASA's cloud-free composite of 2016 night lights.
  nightlights: Object.freeze({
    id: 'gibs-nightlights',
    name: 'Night Lights',
    icon: '✧',
    sourceLabel: 'NASA GIBS · US only',
    // Short on-map credit; the full GIBS acknowledgement is in Data attribution.
    credit: 'NASA Black Marble (GIBS)',
    wmtsLayer: 'VIIRS_Black_Marble',
    matrixSet: 'GoogleMapsCompatible_Level8',
    ext: 'png',
    fixedDate: '2016-01-01',
    maximumLevel: 8,
    updateInterval: SIX_HOURS_MS,
  }),
});

/** Static template for a GIBS product. */
export function productUrlTemplate(product, nowMs = Date.now()) {
  if (!product?.wmtsLayer) return null;
  return gibsTileTemplate({
    layerName: product.wmtsLayer,
    matrixSet: product.matrixSet,
    ext: product.ext,
    date: product.fixedDate || yesterdayDateUTC(nowMs),
  });
}
