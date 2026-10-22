import * as Cesium from 'cesium';
import { NO_IMAGERY_HOST } from '../../maps/imageryHost.js';
import { maskImageryProvider } from './tileMask.js';

/**
 * Build a keyless WMTS/XYZ-style tile-imagery layer on
 * Cesium.UrlTemplateImageryProvider.
 *
 * Adapted from the Sheldondouthat/satwq-reality-os fork of God's Eye View
 * (MIT). Husky Eye View changes:
 *   - `boxes` limits the imagery to [west, south, east, north] boxes in
 *     degrees, one Cesium imagery layer per box with its provider and layer
 *     `rectangle` set to the box, so no tile is requested outside them;
 *   - the imagery goes on whatever the map stack offers (`imageryHost`, as
 *     the weather layers do: the globe, or the photorealistic tileset) and
 *     moves when the map changes;
 *   - the layer manager runs the first update after enable, so enable only
 *     attaches a static template; stats use `lastUpdate`;
 *   - `outline` (an async loader of projected rings, src/layers/imageryTile/
 *     tileMask.js) cuts every tile to a border, loaded once on first use;
 *   - the row can carry a caveat (`info`).
 *
 * The snapshot source owns the exact URL template; the layer only rebuilds
 * the providers when the template or the host changes. A failing source
 * leaves the layer detached with `getStats().error` set — never fake tiles.
 *
 * Snapshot shape (from `source.getSnapshot`): `{ template, maximumLevel?,
 * credit? }`. When the snapshot omits `template`, the static `urlTemplate`
 * passed to the factory is used.
 */
export function createImageryTileLayer({
  id,
  name,
  icon,
  source,
  sourceLabel,
  credit,
  urlTemplate = null,
  maximumLevel = 8,
  opacity = 0.85,
  updateInterval,
  boxes = null,
  outline = null,
  info = null,
  infoTitle = '',
  countLabel = null,
  requestRender = () => {},
  eventTarget = globalThis.window,
  cesium = Cesium,
} = {}) {
  if (!id || typeof id !== 'string')
    throw new TypeError('Imagery tile layer requires an id');
  if (!name || typeof name !== 'string')
    throw new TypeError('Imagery tile layer requires a name');
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError(`${id}: requires a snapshot source`);
  if (!Number.isFinite(updateInterval) || updateInterval <= 0)
    throw new TypeError(
      `${id}: updateInterval must be a positive number of milliseconds`,
    );
  if (
    boxes !== null &&
    (!Array.isArray(boxes) ||
      !boxes.length ||
      boxes.some(
        (box) =>
          !Array.isArray(box) ||
          box.length !== 4 ||
          !box.every(Number.isFinite) ||
          box[0] >= box[2] ||
          box[1] >= box[3],
      ))
  )
    throw new TypeError(`${id}: boxes must be [west, south, east, north]`);

  let _viewer = null;
  let _imageryHost = null;
  /** @type {Array<{layer: object, collection: object}>} */
  let _attached = [];
  let _collection = null;
  let _template = null;
  let _snapshot = null;
  let _enabled = false;
  let _request = null;
  let _frames = 0;
  let _lastUpdate = null;
  let _lastError = null;
  /** Outline rings, loaded on the first attach (when `outline` is given). */
  let _outlineRings = null;

  const host = () =>
    _imageryHost?.() ?? {
      collection: _viewer?.imageryLayers ?? null,
      kind: 'globe',
    };

  /** Remove the imagery; `keepTemplate` when only the host is changing. */
  function detach({ keepTemplate = false } = {}) {
    for (const { layer: imageryLayer, collection } of _attached) {
      try {
        collection.remove(imageryLayer, true);
      } catch {
        /* the collection is already gone */
      }
    }
    const had = _attached.length > 0;
    _attached = [];
    _collection = null;
    if (!keepTemplate) _template = null;
    if (had) requestRender(`imagery-tile:${id}`);
  }

  /** Show `template` on the current host (it waits while there is none). */
  function attach(template, snapshot) {
    _template = template;
    const collection = host().collection;
    if (!collection) return false;
    const level = Number.isFinite(snapshot?.maximumLevel)
      ? snapshot.maximumLevel
      : maximumLevel;
    const tileCredit = snapshot?.credit ?? credit;
    for (const box of boxes || [null]) {
      const rectangle = box
        ? cesium.Rectangle.fromDegrees(box[0], box[1], box[2], box[3])
        : undefined;
      const provider = new cesium.UrlTemplateImageryProvider({
        url: template,
        maximumLevel: level,
        credit: tileCredit,
        ...(rectangle ? { rectangle } : {}),
      });
      if (outline) {
        _outlineRings ??= Promise.resolve().then(outline);
        maskImageryProvider(provider, _outlineRings);
      }
      const imageryLayer = new cesium.ImageryLayer(provider, {
        alpha: opacity,
        ...(rectangle ? { rectangle } : {}),
      });
      collection.add(imageryLayer);
      _attached.push({ layer: imageryLayer, collection });
    }
    _collection = collection;
    requestRender(`imagery-tile:${id}`);
    return true;
  }

  /** Move the imagery when the map stack's host changed. */
  function syncHost() {
    if (!_enabled || !_template) return;
    if ((host().collection ?? null) === _collection) return;
    detach({ keepTemplate: true });
    attach(_template, _snapshot);
  }
  const onMapStackChanged = () => syncHost();

  const layer = {
    id,
    name,
    icon,
    source: sourceLabel || id,
    updateInterval,

    init(viewer) {
      if (_viewer) throw new Error(`${id}: layer is already initialized`);
      if (!viewer?.imageryLayers)
        throw new TypeError(`${id}: viewer needs imageryLayers`);
      _viewer = viewer;
      _enabled = false;
      _frames = 0;
      _lastUpdate = null;
      _lastError = null;
      eventTarget?.addEventListener?.(
        'gev:map-stack-changed',
        onMapStackChanged,
      );
    },

    attachShellServices(services) {
      _imageryHost =
        typeof services?.imageryHost === 'function'
          ? services.imageryHost
          : null;
      syncHost();
    },

    enable() {
      if (!_viewer) throw new Error(`${id}: enable before init`);
      _enabled = true;
      // A static template attaches at once; the manager's first update()
      // then confirms it (or swaps in the snapshot's template).
      if (urlTemplate && !_attached.length) attach(urlTemplate, null);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      detach();
    },

    async update(_v, { signal } = {}) {
      if (!_enabled || !_viewer) return false;
      _request?.abort();
      const request = new AbortController();
      if (signal?.aborted) request.abort(signal.reason);
      const abort = () => request.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const template =
          (snapshot && typeof snapshot.template === 'string'
            ? snapshot.template
            : null) || urlTemplate;
        if (!template || typeof template !== 'string')
          throw new Error(`${id}: snapshot produced no URL template`);
        _snapshot = snapshot;
        if (template !== _template || host().collection !== _collection) {
          detach();
          attach(template, snapshot);
        }
        _frames += 1;
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _lastError = error?.message || `${name} source unavailable`;
        // Degrade to off on failure rather than showing stale tiles as live.
        detach();
        return false;
      } finally {
        signal?.removeEventListener('abort', abort);
        if (_request === request) _request = null;
      }
    },

    destroy() {
      _request?.abort();
      _request = null;
      _enabled = false;
      detach();
      eventTarget?.removeEventListener?.(
        'gev:map-stack-changed',
        onMapStackChanged,
      );
      _viewer = null;
      _imageryHost = null;
      _snapshot = null;
      _frames = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getStats() {
      // The panel polls stats while the layer is on: a cheap host check, so
      // the imagery follows a map change even without the event.
      syncHost();
      const shown = _attached.length > 0;
      return {
        count: 0,
        ...(shown && countLabel ? { countLabel } : {}),
        frames: _frames,
        lastUpdate: _lastUpdate,
        error:
          _lastError ||
          (_enabled && !host().collection ? NO_IMAGERY_HOST : null),
      };
    },

    ...(info
      ? {
          getRowControls() {
            return { chips: [], legend: [], info, infoTitle };
          },
        }
      : {}),

    getDiagnostics() {
      return {
        enabled: _enabled,
        attached: _attached.length,
        template: _template,
        rectangles: _attached.map(({ layer: imageryLayer }) => {
          const r = imageryLayer.rectangle;
          return r
            ? [r.west, r.south, r.east, r.north].map((v) =>
                Number(cesium.Math.toDegrees(v).toFixed(2)),
              )
            : null;
        }),
      };
    },
  };
  return layer;
}
