/**
 * The BPD SCANNER preset in Radio (full panel, compact dock, cockpit popover).
 *
 * Boston Police radio has been encrypted since August 2025; the department's
 * public replacement is a delayed web player at radio.rapidsos.com/boston
 * whose terms allow personal listening but not retransmission. So the preset
 * is a link to that player, never an in-app stream, and it is only offered
 * while the view is within 15 miles of the Boston city boundary:
 *   - map view: the point at the center of the screen,
 *   - cockpit: the aircraft (the cockpit camera rides on it).
 */
import * as Cesium from 'cesium';
import {
  BOSTON_SCANNER_RADIUS_MILES,
  BOSTON_SCANNER_URL,
  milesFromBoston,
} from '../data/bostonScannerZone.js';

const CHECK_INTERVAL_MS = 750;

// Fetched as an asset (like the .geojsonl layers) so the outline stays out of
// the main bundle; a JSON import attribute fails under the Vite dev server.
const BOSTON_OUTLINE_URL = new URL(
  '../data/local_data/boston/city-outline.json',
  import.meta.url,
).href;

async function loadBostonRings() {
  const response = await fetch(BOSTON_OUTLINE_URL);
  if (!response.ok) throw new Error(`city outline HTTP ${response.status}`);
  return (await response.json()).rings;
}

/**
 * The point the scanner zone is measured from.
 * @returns {{lat:number, lon:number}|null}
 */
export function scannerViewPoint(viewer, { cockpit = false } = {}) {
  const camera = viewer?.camera;
  if (!camera) return null;
  let cartographic = null;
  const canvas = viewer.scene?.canvas;
  if (!cockpit && canvas && typeof camera.pickEllipsoid === 'function') {
    const position = camera.pickEllipsoid(
      new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      viewer.scene.globe?.ellipsoid || Cesium.Ellipsoid.WGS84,
    );
    if (position) cartographic = Cesium.Cartographic.fromCartesian(position);
  }
  cartographic ||= camera.positionCartographic || null;
  if (!cartographic) return null;
  return {
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    lon: Cesium.Math.toDegrees(cartographic.longitude),
  };
}

/** Title text for an offered preset. */
export function scannerPresetTitle(miles) {
  const where =
    miles === 0
      ? 'View is over Boston'
      : `View is ${miles.toFixed(1)} mi from Boston`;
  return `Open the official Boston Police radio feed in a new tab (delayed about 5 minutes; personal listening only). ${where}.`;
}

/**
 * Show or hide every [data-boston-scanner] link as the view moves.
 * @returns {{refresh: () => void, destroy: () => void}}
 */
export function installBostonScannerPreset({
  viewer,
  documentRef = globalThis.document,
  windowRef = globalThis,
  loadRings = loadBostonRings,
  intervalMs = CHECK_INTERVAL_MS,
} = {}) {
  if (!viewer || !documentRef?.querySelectorAll)
    return { refresh() {}, destroy() {} };

  let rings = null;
  let destroyed = false;
  let lastAvailable = null;
  let lastMiles = null;

  const apply = (miles) => {
    const available = miles <= BOSTON_SCANNER_RADIUS_MILES;
    const title = available ? scannerPresetTitle(miles) : null;
    // Looked up each time: the Radio and cockpit templates may be (re)rendered
    // after this is installed. Attributes are written only when they change.
    for (const link of documentRef.querySelectorAll('[data-boston-scanner]')) {
      if (link.hidden !== !available) link.hidden = !available;
      if (link.href !== BOSTON_SCANNER_URL) link.href = BOSTON_SCANNER_URL;
      if (title && link.title !== title) link.title = title;
    }
    lastAvailable = available;
    lastMiles = miles;
  };

  const inCockpit = () =>
    Boolean(documentRef.body?.classList?.contains('cockpit-mode'));

  const refresh = () => {
    if (destroyed || !rings) return;
    const cockpit = inCockpit();
    const point = scannerViewPoint(viewer, { cockpit });
    apply(point ? milesFromBoston(point.lat, point.lon, rings) : Infinity);
  };

  Promise.resolve()
    .then(loadRings)
    .then((loaded) => {
      rings = loaded;
      refresh();
    })
    .catch((error) => {
      // Without the outline the preset simply stays hidden.
      console.warn(
        '[radio] Boston scanner zone unavailable:',
        error?.message || error,
      );
    });

  // The cockpit camera moves every frame without moveEnd, so a light poll
  // measures the distance there. In the map view moveEnd and mode changes
  // measure it; the poll only reapplies the last answer, so a link rendered
  // later still shows (or stays hidden) according to the range.
  const timer = windowRef.setInterval?.(() => {
    if (destroyed || documentRef.hidden) return;
    if (inCockpit()) refresh();
    else if (lastMiles !== null) apply(lastMiles);
  }, intervalMs);
  const removeMoveEnd = viewer.camera?.moveEnd?.addEventListener?.(refresh);
  windowRef.addEventListener?.('gev:cockpit-mode-changed', refresh);

  return {
    refresh,
    get available() {
      return lastAvailable;
    },
    destroy() {
      destroyed = true;
      if (timer != null) windowRef.clearInterval?.(timer);
      removeMoveEnd?.();
      windowRef.removeEventListener?.('gev:cockpit-mode-changed', refresh);
    },
  };
}
