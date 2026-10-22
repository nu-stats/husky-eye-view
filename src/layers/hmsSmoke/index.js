import * as Cesium from 'cesium';
import { SMOKE_DENSITIES } from './records.js';
export {
  parseSmokeKml,
  SMOKE_DENSITY_BY_STYLE,
  SMOKE_DENSITIES,
  validateSmokeSnapshot,
} from './records.js';
export { createHmsSmokeSource } from './source.js';

/**
 * Wildfire smoke (NOAA HMS): the day's satellite-analysed smoke plumes over
 * the United States, shaded by density.
 *
 * Adapted from the Sheldondouthat/satwq-reality-os fork of God's Eye View
 * (MIT). Husky Eye View changes: the proxy sends only US polygons; the
 * polygons are drawn as one classification primitive per density (like the
 * area layers in src/data/chunkedAreaLayer.js), over the globe and the
 * photorealistic tiles alike, instead of one entity each; a failed refresh
 * keeps the layer on with the error in its row; the row shows a density
 * legend and what the layer covers.
 */

/** Fill color per smoke density. */
export const SMOKE_DENSITY_STYLE = Object.freeze({
  light: Object.freeze({ color: Cesium.Color.YELLOW, alpha: 0.25 }),
  moderate: Object.freeze({ color: Cesium.Color.ORANGE, alpha: 0.35 }),
  heavy: Object.freeze({ color: Cesium.Color.RED, alpha: 0.45 }),
});

const DENSITY_LABELS = Object.freeze({
  light: 'Light',
  moderate: 'Medium',
  heavy: 'Heavy',
});

// The smoke is classified onto whatever lies inside these volumes: deep
// enough for any terrain, high enough for any building (chunkedAreaLayer.js).
const VOLUME_BOTTOM_M = -120_000;
const VOLUME_TOP_M = 8_000;

export const HMS_SMOKE_SOURCE_LABEL = 'NOAA HMS · US only';

export const HMS_SMOKE_COVERAGE =
  'US only: polygons that reach the lower 48, Alaska, Hawaii, Puerto Rico or the US Virgin Islands, drawn whole. ' +
  "NOAA's analysts trace smoke seen from satellites; it may be high aloft rather than at the ground, and cloud can hide it.";

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

/** "20261020" → "Oct 20, 2026". */
export function smokeDateLabel(ymd) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(ymd || ''));
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : '';
}

/** Cartesian positions of an open or closed ring, without repeats. */
function ringPositions(ring) {
  const degrees = [];
  let previous = null;
  for (const [lon, lat] of ring) {
    if (previous && previous[0] === lon && previous[1] === lat) continue;
    degrees.push(lon, lat);
    previous = [lon, lat];
  }
  if (
    degrees.length >= 4 &&
    degrees[0] === degrees.at(-2) &&
    degrees[1] === degrees.at(-1)
  )
    degrees.length -= 2;
  return degrees.length >= 6
    ? Cesium.Cartesian3.fromDegreesArray(degrees)
    : null;
}

/** Same day, same polygon total and same per-density counts: same plumes. */
function snapshotKey(snapshot) {
  const counts = { light: 0, moderate: 0, heavy: 0 };
  for (const polygon of snapshot?.polygons ?? [])
    if (polygon.density in counts) counts[polygon.density]++;
  return [
    snapshot?.date ?? '',
    snapshot?.total ?? '',
    counts.light,
    counts.moderate,
    counts.heavy,
  ].join('|');
}

/** Own one NOAA HMS smoke display and its refresh lifecycle. */
export function createHmsSmokeLayer({
  source,
  requestRender = () => {},
  setTimeoutImpl = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutImpl = (id) => globalThis.clearTimeout(id),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('HMS smoke requires a snapshot source');
  let _viewer = null;
  let _request = null;
  let _primitives = [];
  // snapshotKey() of what the primitives show; null when nothing is drawn.
  let _drawnKey = null;
  let _snapshot = null;
  let _counts = { light: 0, moderate: 0, heavy: 0 };
  let _lastUpdate = null;
  let _lastError = null;
  let _loading = false;
  let _enabled = false;
  let _readyTimer = null;
  let _readyChecks = 0;
  let _listener = null;

  const notify = () => _listener?.();

  function stopReadyPump() {
    if (_readyTimer !== null) clearTimeoutImpl(_readyTimer);
    _readyTimer = null;
  }

  // Cesium builds the volumes in workers and only notices they are done on a
  // frame; with the render governor idle there may be no frame, so ask for
  // one now and then until every batch is ready (at most ~15 s).
  function pumpUntilReady() {
    stopReadyPump();
    _readyChecks = 0;
    const tick = () => {
      _readyTimer = null;
      if (!_enabled || !_primitives.length) return;
      requestRender('hms-smoke');
      if (_primitives.every((primitive) => primitive.ready)) return;
      if (++_readyChecks > 60) return;
      _readyTimer = setTimeoutImpl(tick, 250);
    };
    tick();
  }

  function clearPrimitives() {
    stopReadyPump();
    const collection = _viewer?.scene?.groundPrimitives;
    for (const primitive of _primitives) {
      try {
        collection?.remove(primitive);
      } catch {
        /* the collection is already gone */
      }
      try {
        if (!primitive.isDestroyed?.()) primitive.destroy?.();
      } catch {
        /* destroyed with its collection */
      }
    }
    const had = _primitives.length > 0;
    _primitives = [];
    _drawnKey = null;
    if (had) requestRender('hms-smoke');
  }

  function draw(snapshot) {
    const { polygons } = snapshot;
    clearPrimitives();
    _drawnKey = snapshotKey(snapshot);
    const counts = { light: 0, moderate: 0, heavy: 0 };
    for (const density of SMOKE_DENSITIES) {
      const style = SMOKE_DENSITY_STYLE[density];
      const color = Cesium.ColorGeometryInstanceAttribute.fromColor(
        style.color.withAlpha(style.alpha),
      );
      const instances = [];
      polygons.forEach((polygon, index) => {
        if (polygon.density !== density) return;
        const positions = ringPositions(polygon.ring);
        if (!positions) return;
        instances.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: new Cesium.PolygonHierarchy(positions),
              height: VOLUME_BOTTOM_M,
              extrudedHeight: VOLUME_TOP_M,
            }),
            id: `hms-smoke:${index}`,
            attributes: { color },
          }),
        );
      });
      counts[density] = instances.length;
      if (!instances.length) continue;
      // A classification primitive takes one color for all its instances.
      const primitive = new Cesium.ClassificationPrimitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
        }),
        classificationType: Cesium.ClassificationType.BOTH,
        asynchronous: true,
      });
      _viewer.scene.groundPrimitives.add(primitive);
      _primitives.push(primitive);
    }
    _counts = counts;
    pumpUntilReady();
    return counts.light + counts.moderate + counts.heavy;
  }

  const layer = {
    id: 'hms-smoke',
    name: 'Wildfire Smoke',
    icon: '≋',
    source: HMS_SMOKE_SOURCE_LABEL,
    updateInterval: 3600_000,

    init(viewer) {
      if (_viewer) throw new Error('HMS smoke layer is already initialized');
      if (!viewer?.scene?.groundPrimitives)
        throw new TypeError('HMS smoke needs scene.groundPrimitives');
      _viewer = viewer;
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
    },

    enable() {
      _enabled = true;
      if (_snapshot && !_primitives.length) draw(_snapshot);
    },

    disable() {
      _request?.abort();
      _request = null;
      _loading = false;
      _enabled = false;
      clearPrimitives();
      notify();
    },

    async update(_v, { signal } = {}) {
      if (!_enabled || !_viewer) return false;
      _request?.abort();
      const request = new AbortController();
      if (signal?.aborted) request.abort(signal.reason);
      const abort = () => request.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      _request = request;
      _loading = true;
      notify();
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _snapshot = snapshot;
        // The hourly refresh mostly returns the day already drawn; rebuilding
        // every volume (and pumping renders until they are ready) would
        // change nothing on screen.
        if (snapshotKey(snapshot) !== _drawnKey) draw(snapshot);
        _lastUpdate = snapshot.fetchedAt || Date.now();
        _lastError = null;
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        // Stay on with the cause in the row, as the other NOAA layers do; the
        // next hourly refresh tries again.
        _lastError = error?.message || 'HMS smoke source unavailable';
        return true;
      } finally {
        signal?.removeEventListener('abort', abort);
        if (_request === request) {
          _request = null;
          _loading = false;
          notify();
        }
      }
    },

    getRowControls() {
      const dateLabel = smokeDateLabel(_snapshot?.date);
      return {
        chips: [],
        legend: SMOKE_DENSITIES.map((density, index) => ({
          label: DENSITY_LABELS[density],
          color: SMOKE_DENSITY_STYLE[density].color
            .withAlpha(0.75)
            .toCssColorString(),
          count: _snapshot ? _counts[density] : null,
          ...(index === 0 ? { blurb: HMS_SMOKE_COVERAGE } : {}),
        })),
        info: dateLabel
          ? `NOAA analysis of ${dateLabel} (UTC) · US only`
          : 'US only',
        infoTitle: HMS_SMOKE_COVERAGE,
      };
    },

    setRowControlsListener(value) {
      _listener = typeof value === 'function' ? value : null;
    },

    destroy() {
      _request?.abort();
      _request = null;
      _enabled = false;
      clearPrimitives();
      _viewer = null;
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _listener = null;
    },

    getStats() {
      const dateLabel = smokeDateLabel(_snapshot?.date);
      return {
        count: _snapshot ? _counts.light + _counts.moderate + _counts.heavy : 0,
        lastUpdate: _lastUpdate,
        loading: _loading,
        error: _lastError,
        stale: Boolean(_snapshot?.stale),
        source: dateLabel
          ? `${HMS_SMOKE_SOURCE_LABEL} · ${dateLabel}`
          : HMS_SMOKE_SOURCE_LABEL,
      };
    },

    getDiagnostics() {
      return {
        enabled: _enabled,
        primitives: _primitives.length,
        ready: _primitives.every((primitive) => primitive.ready),
        date: _snapshot?.date || null,
        counts: { ..._counts },
        total: _snapshot?.total ?? null,
        dropped: _snapshot?.dropped ?? null,
      };
    },
  };
  return layer;
}
