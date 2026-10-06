import * as Cesium from 'cesium';
import { isPointerFree } from './inputOwnership.js';
import { isLocalCardAction, pickLocalEntity } from './localGeojsonCore.js';

/**
 * Nationwide area layer loaded on demand. The dataset is split into chunks
 * (one GeoJSON Lines file per county) described by an index of bounding
 * boxes; only the chunks in view are fetched and drawn, and chunks that leave
 * the view are released. Zoomed out past `maxHeightM` nothing is drawn and the
 * panel shows a zoom-in hint.
 *
 * Each drawn chunk is batched into ground primitives holding every area of
 * the chunk (one primitive, or a few for a county with thousands of tracts),
 * with a color per area. Entities (one per polygon, via GeoJsonDataSource)
 * were far slower: every entity costs an updater, and Cesium splits clamped
 * entity polygons into a new batch whenever their bounding rectangles overlap,
 * which neighboring tracts always do, so one county became dozens of
 * separately built primitives and a zoomed-out view stalled the frame while
 * thousands of entities were processed.
 *
 * Areas are shaded by `featureColor(properties)` and are selectable: a click
 * publishes the feature's context, which opens the details card for features
 * carrying a `summary`. Only the clicked area gets a (detached) Entity, built
 * on demand for the context store; every other area is just a pick record.
 */

/** Default camera height above which the layer asks the user to zoom in. */
export const CHUNKED_AREA_MAX_HEIGHT_M = 250_000;
/** Default cap on chunks drawn at once (nearest to the view center first). */
export const CHUNKED_AREA_MAX_CHUNKS = 30;
/**
 * Every area's classification volume, in meters above the ellipsoid. From
 * far out the photorealistic globe is drawn with coarse flat
 * facets whose middles sag tens of kilometers below the curved surface (a
 * 1,000 km chord sags about 20 km), so the volume reaches far down; the top
 * clears any US summit.
 */
export const AREA_VOLUME_BOTTOM_M = -120_000;
export const AREA_VOLUME_TOP_M = 8_000;
/** Parsed chunks kept after leaving the view, so panning back is instant. */
const CHUNK_CACHE_LIMIT = 90;
const FILL_ALPHA = 0.4;
/**
 * Most polygons in one ground primitive. Cesium prepares every instance of a
 * new primitive on the main thread in a single frame (~0.1 ms each), so a
 * county with thousands of tracts is split into a few primitives...
 */
export const CHUNKED_AREA_BATCH_SIZE = 600;
/**
 * ...and at most this many polygons' worth of new primitives enter the scene
 * per frame (always at least one primitive), so loading never stalls a
 * moving camera for long.
 */
const FRAME_INSTANCE_BUDGET = 600;
/**
 * Polygons added in the current frame by ALL chunked layers together, so two
 * layers loading at once still share one frame's budget.
 */
const sharedFrameBudget = { frame: undefined, added: 0 };
/**
 * An opacity that overrides every chunked layer's own `fillAlpha` — the
 * cockpit's LAYERS slider, so tract colors read clearly from the air — or
 * null for each layer's own look.
 */
let fillAlphaOverride = null;
const fillAlphaListeners = new Set();

/**
 * Set (0.05–1) or clear (null) the shared fill opacity. Drawn areas recolor
 * in place; areas still loading are rebuilt at the new opacity.
 * @param {number|null} alpha
 */
export function setChunkedAreaFillAlpha(alpha) {
  const next = Number.isFinite(alpha)
    ? Math.min(1, Math.max(0.05, alpha))
    : null;
  if (next === fillAlphaOverride) return;
  fillAlphaOverride = next;
  for (const listener of fillAlphaListeners) {
    try {
      listener();
    } catch {
      /* one layer's failure must not stop the others */
    }
  }
}

/** The shared fill opacity in force, or null when each layer uses its own. */
export function getChunkedAreaFillAlpha() {
  return fillAlphaOverride;
}

/** Longest getAreaContext waits for areas still loading. */
const AREA_CONTEXT_WAIT_MS = 6000;
/**
 * A camera that never stops (Cockpit, a tracked follow, a route flight, a
 * continuous orbit) never emits moveEnd, so the view is also rechecked at
 * most this often while frames render, and reloaded once it has moved on.
 */
const MOTION_CHECK_MS = 1500;
const MOTION_MIN_TRAVEL_M = 1500;
const MOTION_HEADING_CHANGE_RAD = Cesium.Math.toRadians(25);
const EARTH_RADIUS_M = 6_371_000;
/** Cameras pitched shallower than this look at the horizon, not the ground. */
const SHALLOW_PITCH_RAD = Cesium.Math.toRadians(-25);

/**
 * Ground box for a horizon-up view (no ground rectangle): the area around the
 * camera plus the stretch it is looking toward, so a cockpit sees the ground
 * ahead of the aircraft, not only beneath it.
 * @param {{longitude:number, latitude:number, height:number, heading:number}} pose
 *   Degrees, meters, heading in radians.
 * @returns {{west:number,south:number,east:number,north:number}} Degrees.
 */
export function horizonViewBox({ longitude, latitude, height, heading }) {
  const aheadM = Math.min(80_000, Math.max(8_000, (height || 0) * 6));
  const d = aheadM / EARTH_RADIUS_M;
  const lat1 = Cesium.Math.toRadians(latitude);
  const lon1 = Cesium.Math.toRadians(longitude);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(heading || 0),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(heading || 0) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  const aheadLon = Cesium.Math.toDegrees(lon2);
  const aheadLat = Cesium.Math.toDegrees(lat2);
  const pad = 0.35;
  return {
    west: Math.min(longitude, aheadLon) - pad,
    east: Math.max(longitude, aheadLon) + pad,
    south: Math.min(latitude, aheadLat) - pad,
    north: Math.max(latitude, aheadLat) + pad,
  };
}

/**
 * Whether a moving camera has left the view last loaded: it traveled a
 * quarter of its height (at least 1.5 km), turned 25°, or changed height by
 * half again.
 * @param {{longitude:number, latitude:number, height:number, heading:number}} previous
 * @param {{longitude:number, latitude:number, height:number, heading:number}} next
 * @returns {boolean}
 */
export function viewPoseMoved(previous, next) {
  if (!previous || !next) return false;
  const rad = Math.PI / 180;
  const dLat = (next.latitude - previous.latitude) * rad;
  const dLon =
    (next.longitude - previous.longitude) *
    rad *
    Math.cos(((next.latitude + previous.latitude) / 2) * rad);
  const travelM = Math.hypot(dLat, dLon) * EARTH_RADIUS_M;
  if (travelM >= Math.max(MOTION_MIN_TRAVEL_M, 0.25 * Math.abs(next.height)))
    return true;
  const turn = Math.abs(
    ((next.heading - previous.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
  );
  if (turn >= MOTION_HEADING_CHANGE_RAD) return true;
  const low = Math.max(1, Math.min(previous.height, next.height));
  return Math.max(previous.height, next.height) / low >= 1.5;
}

/** Polygon rings of a Polygon/MultiPolygon geometry, as [outer, ...holes][]. */
function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** Whether a ring of [lon, lat] points contains the point (even-odd rule). */
function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Whether a Polygon/MultiPolygon feature contains [lon, lat] (holes excluded). */
function featureContains(feature, lon, lat) {
  return polygonsOf(feature.geometry).some(
    ([outer, ...holes]) =>
      outer &&
      ringContains(outer, lon, lat) &&
      !holes.some((hole) => ringContains(hole, lon, lat)),
  );
}

/**
 * Cartesian positions of a [lon, lat(, z)] ring, without the closing repeat
 * of the first point and without non-finite points (a NaN would fail the
 * whole chunk's batch).
 */
function ringPositions(ring) {
  const degrees = [];
  for (const point of ring || []) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) degrees.push(lon, lat);
  }
  const n = degrees.length;
  if (
    n >= 4 &&
    degrees[0] === degrees[n - 2] &&
    degrees[1] === degrees[n - 1]
  ) {
    degrees.length = n - 2;
  }
  return Cesium.Cartesian3.fromDegreesArray(degrees);
}

/** Polygon hierarchy of one polygon's rings, or null when it has no area. */
function hierarchyOf(rings) {
  const [outer, ...holes] = (rings || []).map(ringPositions);
  if (!outer || outer.length < 3) return null;
  return new Cesium.PolygonHierarchy(
    outer,
    holes
      .filter((hole) => hole.length >= 3)
      .map((hole) => new Cesium.PolygonHierarchy(hole)),
  );
}

/** Center of a feature's bounding box, [lon, lat] degrees (null if empty). */
function featureCenter(feature) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const rings of polygonsOf(feature.geometry)) {
    for (const [lon, lat] of rings[0] || []) {
      if (lon < w) w = lon;
      if (lat < s) s = lat;
      if (lon > e) e = lon;
      if (lat > n) n = lat;
    }
  }
  return Number.isFinite(w) ? [(w + e) / 2, (s + n) / 2] : null;
}

/**
 * Chunks whose bbox intersects the view rectangle, nearest center first.
 * @param {Array<{id:string,bbox:number[]}>} index
 * @param {{west:number,south:number,east:number,north:number}} view Degrees.
 * @param {number} limit
 * @returns {string[]}
 */
export function chunksInView(index, view, limit) {
  const cx = (view.west + view.east) / 2;
  const cy = (view.south + view.north) / 2;
  return index
    .filter(
      ({ bbox: [w, s, e, n] }) =>
        e >= view.west && w <= view.east && n >= view.south && s <= view.north,
    )
    .map((chunk) => {
      const [w, s, e, n] = chunk.bbox;
      const dx = (w + e) / 2 - cx;
      const dy = (s + n) / 2 - cy;
      return { id: chunk.id, d: dx * dx + dy * dy };
    })
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit))
    .map((chunk) => chunk.id);
}

/**
 * @param {object} options
 * @param {string} options.id Layer id.
 * @param {string} options.name Panel label.
 * @param {string} options.baseUrl Directory URL holding index.json and chunks.
 * @param {function(object):string} options.featureColor Fill color per feature.
 * @param {Array<{label:string,color:string,blurb?:string,test:function(object):boolean}>} [options.legend]
 * @param {string} [options.icon]
 * @param {string} [options.source]
 * @param {number} [options.maxHeightM]
 * @param {number} [options.maxChunks]
 * @param {string} [options.zoomInMessage] Panel hint above `maxHeightM`.
 * @param {string} [options.sourceNote] Source line for every area's details
 *   card, instead of repeating it in each feature.
 * @param {function(object):string} [options.featureSummary] Builds the
 *   details-card summary from a feature's properties, so several layers can
 *   share one set of chunks and still describe it their own way.
 * @param {function(object):boolean} [options.featureFilter] Keeps only the
 *   features whose properties pass, e.g. the significant tracts of a shared
 *   tract set.
 * @param {number} [options.fillAlpha] Area fill opacity (0–1).
 * @param {Array<{id:string,label:string,featureColor:Function,legend?:Array,featureSummary?:Function}>} [options.variants]
 *   Alternative views of the same areas (e.g. survey years); the layer row
 *   shows one chip per variant and the first is shown until another is chosen.
 * @param {object} [options.far] A coarser stand-in drawn when the camera is
 *   above `maxHeightM` (e.g. county values for a tract layer), so the layer
 *   always shows something over the country:
 *   `{ baseUrl, maxHeightM?, maxChunks?, featureColor?, featureSummary?,
 *   featureFilter?, legend?, sourceNote?, label? }`. Missing functions fall back
 *   to the layer's own (the coarse chunks then carry the same property names).
 *   A variant may add `farFeatureColor`, `farFeatureSummary` and `farLegend`.
 * @param {Function} [options.screenSpaceEventHandlerFactory] Test seam.
 * @param {object} services Shared context/overlay operations.
 */
export function createChunkedAreaLayer(
  {
    id,
    name,
    baseUrl,
    featureColor,
    legend = [],
    icon = '▦',
    source = 'Local',
    maxHeightM = CHUNKED_AREA_MAX_HEIGHT_M,
    maxChunks = CHUNKED_AREA_MAX_CHUNKS,
    zoomInMessage = 'zoom in to a city or county to load',
    sourceNote = null,
    featureSummary = null,
    featureFilter = null,
    fillAlpha = FILL_ALPHA,
    variants = [],
    far = null,
    screenSpaceEventHandlerFactory = (canvas) =>
      new Cesium.ScreenSpaceEventHandler(canvas),
  },
  {
    overlayHost,
    registerEntityContext,
    selectEntityContext,
    clearSelectedEntityContextForLayer,
    removeEntityContextsForLayer,
    governorRequestRender,
  },
) {
  // Relative directories resolve against the page, so the app still finds
  // its data when it is served under a non-root base path.
  const resolveBase = (url) => {
    const raw = String(url).replace(/\/?$/, '/');
    try {
      return new URL(raw, globalThis.document?.baseURI).href;
    } catch {
      return raw;
    }
  };
  // The detailed areas, and (optionally) the coarse stand-in used from higher
  // up. Chunk keys carry the source prefix so both share one draw map.
  const nearSource = {
    base: resolveBase(baseUrl),
    prefix: '',
    maxHeightM,
    maxChunks,
    filter: featureFilter,
    index: null,
    indexPromise: null,
  };
  const farSource = far
    ? {
        base: resolveBase(far.baseUrl),
        prefix: 'far:',
        maxHeightM: far.maxHeightM ?? 8_000_000,
        maxChunks: far.maxChunks ?? 60,
        filter: far.featureFilter ?? null,
        index: null,
        indexPromise: null,
      }
    : null;
  const sourceOf = (chunkKey) =>
    farSource && String(chunkKey).startsWith(farSource.prefix)
      ? farSource
      : nearSource;
  /** 'near', 'far' (the coarse stand-in) or null (out of range). */
  let mode = null;
  let viewer = null;
  let enabled = false;
  let destroyed = false;
  let error = null;
  let status = null;
  let lastUpdate = null;
  let generation = 0;
  let pending = 0;
  let clickHandler = null;
  let moveEndRemover = null;
  let frameRemover = null;
  let lastViewPose = null;
  let lastMotionCheckMs = 0;
  let rowControlsListener = null;
  // A variant swaps the coloring, legend and card text in place.
  let variantId = variants[0]?.id ?? null;
  let farColor = far?.featureColor ?? null;
  let farSummary = far?.featureSummary ?? null;
  let farLegend = far?.legend ?? null;
  const applyVariant = (variant) => {
    if (!variant) return;
    variantId = variant.id;
    featureColor = variant.featureColor;
    if (variant.legend) legend = variant.legend;
    if (variant.featureSummary) featureSummary = variant.featureSummary;
    if (variant.farFeatureColor) farColor = variant.farFeatureColor;
    if (variant.farFeatureSummary) farSummary = variant.farFeatureSummary;
    if (variant.farLegend) farLegend = variant.farLegend;
  };
  /** Fill color for a feature of the near or the far source. */
  const colorOf = (properties, isFar) =>
    (isFar && farColor ? farColor : featureColor)(properties);
  applyVariant(variants[0]);
  /**
   * chunk id -> { primitives, features } currently drawn. `primitives` are
   * the chunk's Cesium.GroundPrimitive batches (none when no area survived
   * the filter); `features` are the areas they draw.
   */
  const drawn = new Map();
  /** Batches waiting for a frame with budget left (see FRAME_INSTANCE_BUDGET). */
  let addQueue = [];
  /** Budget for a scene without a frame number (tests); reset every frame. */
  const ownFrameBudget = { added: 0 };
  /** chunk id -> parsed features (LRU by insertion order) */
  const cache = new Map();
  /** CSS color -> opaque Cesium color (gray when the CSS does not parse) */
  const baseColors = new Map();
  /** "css|alpha" -> per-instance color attribute */
  const colors = new Map();
  const scratchColor = new Cesium.Color();

  /** The fill opacity in force: the shared override, else the layer's own. */
  const currentFillAlpha = () => fillAlphaOverride ?? fillAlpha;

  const baseColorFor = (css) => {
    if (!baseColors.has(css)) {
      let color;
      try {
        color = Cesium.Color.fromCssColorString(css);
      } catch {
        color = undefined;
      }
      baseColors.set(css, color || Cesium.Color.fromCssColorString('#9e9e9e'));
    }
    return baseColors.get(css);
  };

  const colorAttributeFor = (css) => {
    const alpha = currentFillAlpha();
    const key = `${css}|${alpha}`;
    if (!colors.has(key)) {
      colors.set(
        key,
        Cesium.ColorGeometryInstanceAttribute.fromColor(
          baseColorFor(css).withAlpha(alpha),
        ),
      );
    }
    return colors.get(key);
  };

  /**
   * Recolor drawn areas for a new shared opacity. Ready batches update their
   * per-instance colors in place (no redraw); a chunk with a batch still
   * being prepared is rebuilt from its cached features at the new opacity.
   */
  function applyFillAlpha() {
    if (destroyed || !viewer) return;
    const alpha = currentFillAlpha();
    const rebuild = [];
    for (const [chunkId, chunk] of drawn) {
      const live = chunk.primitives.every(
        (primitive) =>
          primitive.ready &&
          typeof primitive.getGeometryInstanceAttributes === 'function',
      );
      if (!live) {
        rebuild.push(chunkId);
        continue;
      }
      for (const primitive of chunk.primitives) {
        for (const record of primitive.__areaRecords || []) {
          const attributes = primitive.getGeometryInstanceAttributes(record);
          if (!attributes) continue;
          const css = colorOf(
            record.feature?.properties || {},
            sourceOf(record.__chunkedChunkId) === farSource,
          );
          attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(
            Cesium.Color.clone(
              baseColorFor(css || '#9e9e9e'),
              scratchColor,
            ).withAlpha(alpha, scratchColor),
            attributes.color,
          );
        }
      }
    }
    for (const chunkId of rebuild) releaseChunk(chunkId);
    if (rebuild.length && enabled) refresh();
    if (governorRequestRender) governorRequestRender(`chunked-area:${id}`);
    else viewer.scene?.requestRender?.();
  }
  fillAlphaListeners.add(applyFillAlpha);

  function notifyRowControls() {
    try {
      rowControlsListener?.();
    } catch {
      /* the panel re-renders on its own cadence too */
    }
  }

  async function loadIndex(source = nearSource) {
    if (source.index) return source.index;
    source.indexPromise ||= (async () => {
      const response = await fetch(`${source.base}index.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status ?? '?'}`);
      const parsed = await response.json();
      if (!Array.isArray(parsed)) throw new Error('index is malformed');
      source.index = parsed;
      return source.index;
    })();
    try {
      return await source.indexPromise;
    } finally {
      source.indexPromise = null;
    }
  }

  async function loadChunkFeatures(chunkId) {
    const source = sourceOf(chunkId);
    const fileId = String(chunkId).slice(source.prefix.length);
    if (cache.has(chunkId)) {
      const features = cache.get(chunkId);
      cache.delete(chunkId);
      cache.set(chunkId, features); // refresh LRU position
      return features;
    }
    const response = await fetch(
      `${source.base}${encodeURIComponent(fileId)}.geojsonl`,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status ?? '?'}`);
    const text = await response.text();
    const features = text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
      .filter(
        (feature) => !source.filter || source.filter(feature.properties || {}),
      );
    cache.set(chunkId, features);
    while (cache.size > CHUNK_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (drawn.has(oldest)) break;
      cache.delete(oldest);
    }
    return features;
  }

  function destroyPrimitive(primitive) {
    try {
      viewer?.scene?.groundPrimitives?.remove(primitive);
    } catch {
      /* already gone */
    }
    try {
      if (!primitive.isDestroyed?.()) primitive.destroy?.();
    } catch {
      /* already destroyed by its collection */
    }
  }

  /** This frame's shared budget (or the layer's own one without frames). */
  function frameBudget() {
    const frame = viewer.scene.frameState?.frameNumber;
    if (frame === undefined) return ownFrameBudget;
    if (sharedFrameBudget.frame !== frame) {
      sharedFrameBudget.frame = frame;
      sharedFrameBudget.added = 0;
    }
    return sharedFrameBudget;
  }

  /**
   * Put queued batches into the scene while this frame's budget lasts (at
   * least one per frame), and ask for another frame while any are left.
   */
  function pumpAddQueue() {
    const budget = frameBudget();
    while (addQueue.length) {
      const { primitive, instanceCount } = addQueue[0];
      if (
        budget.added > 0 &&
        budget.added + instanceCount > FRAME_INSTANCE_BUDGET
      )
        break;
      addQueue.shift();
      budget.added += instanceCount;
      viewer.scene.groundPrimitives.add(primitive);
    }
    if (!addQueue.length) return;
    if (governorRequestRender) governorRequestRender(`chunked-area:${id}`);
    else viewer.scene.requestRender?.();
  }

  function releaseChunk(chunkId) {
    const chunk = drawn.get(chunkId);
    if (!chunk) return;
    drawn.delete(chunkId);
    const selected = viewer?.selectedEntity;
    if (
      selected?.__localLayerId === id &&
      selected.__chunkedChunkId === chunkId
    ) {
      viewer.selectedEntity = undefined;
      clearSelectedEntityContextForLayer(id);
    }
    addQueue = addQueue.filter((queued) => queued.chunkId !== chunkId);
    for (const primitive of chunk.primitives) destroyPrimitive(primitive);
  }

  function releaseAll() {
    for (const chunkId of [...drawn.keys()]) releaseChunk(chunkId);
  }

  /**
   * A primitive drawing `instances` (all of one color). Areas are drawn as
   * ClassificationPrimitives over fixed tall volumes (AREA_VOLUME_*), not
   * GroundPrimitives: from any distance the photorealistic tiles can be
   * coarse meshes that sit outside a GroundPrimitive's approximate terrain
   * heights (over mountains, or the sagging middle of a coarse facet),
   * which left holes in the color.
   */
  function batchPrimitive(instances) {
    const primitive = new Cesium.ClassificationPrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({
        flat: true,
        translucent: true,
      }),
      // Clamped like the entities were: over the globe and 3D tiles alike.
      classificationType: Cesium.ClassificationType.BOTH,
      asynchronous: true,
    });
    for (const instance of instances) instance.id.primitive = primitive;
    // Kept for recoloring: the primitive may release its instances once ready.
    primitive.__areaRecords = instances.map((instance) => instance.id);
    return primitive;
  }

  /**
   * Ground primitives holding every area of a chunk (CHUNKED_AREA_BATCH_SIZE
   * polygons each): a geometry instance per polygon (a MultiPolygon gives one
   * per part, as entities did), colored per instance. Each instance's id is a
   * light pick record standing in for an entity: pickLocalEntity reads
   * `__localLayerId`, and a click turns the record into a selection
   * (selectArea).
   * @returns {Cesium.GroundPrimitive[]} Empty when no area has a shape.
   */
  function buildChunkPrimitives(chunkId, features) {
    const instances = [];
    const usedIds = new Set();
    const isFar = sourceOf(chunkId) === farSource;
    features.forEach((feature, featureIndex) => {
      const properties = feature.properties || {};
      const color = colorAttributeFor(colorOf(properties, isFar) || '#9e9e9e');
      const baseId =
        feature.id !== undefined && feature.id !== null
          ? String(feature.id)
          : `${chunkId}:${featureIndex}`;
      polygonsOf(feature.geometry).forEach((rings, part) => {
        const hierarchy = hierarchyOf(rings);
        if (!hierarchy) return;
        // Unique per chunk, like GeoJsonDataSource entity ids (`id`, `id_2`).
        let recordId = baseId;
        for (let n = 2; usedIds.has(recordId); n++) recordId = `${baseId}_${n}`;
        usedIds.add(recordId);
        instances.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: hierarchy,
              height: AREA_VOLUME_BOTTOM_M,
              extrudedHeight: AREA_VOLUME_TOP_M,
            }),
            id: {
              id: recordId,
              name: properties.name,
              __localLayerId: id,
              __chunkedChunkId: chunkId,
              feature,
              part,
            },
            attributes: { color },
          }),
        );
      });
    });
    const primitives = [];
    // A ClassificationPrimitive takes one color for all its instances, so
    // areas are batched by color.
    const groups = [
      ...instances
        .reduce((byColor, instance) => {
          const key = instance.attributes.color;
          if (!byColor.has(key)) byColor.set(key, []);
          byColor.get(key).push(instance);
          return byColor;
        }, new Map())
        .values(),
    ];
    for (const group of groups) {
      // Even batches: 1,300 polygons become 3 × 434, not 600 + 600 + 100.
      const batches = Math.ceil(group.length / CHUNKED_AREA_BATCH_SIZE);
      const size = Math.ceil(group.length / Math.max(1, batches));
      for (let i = 0; i < group.length; i += size)
        primitives.push(batchPrimitive(group.slice(i, i + size)));
    }
    return primitives;
  }

  async function drawChunk(chunkId, gen) {
    const features = await loadChunkFeatures(chunkId);
    if (gen !== generation || !enabled || destroyed || drawn.has(chunkId))
      return;
    const primitives = buildChunkPrimitives(chunkId, features);
    drawn.set(chunkId, { primitives, features });
    for (const primitive of primitives)
      addQueue.push({
        chunkId,
        primitive,
        instanceCount: primitive.geometryInstances.length,
      });
    pumpAddQueue();
  }

  /** Camera position and heading in degrees/meters/radians, or null. */
  function currentPose() {
    const carto = viewer?.camera?.positionCartographic;
    if (!carto) return null;
    return {
      longitude: Cesium.Math.toDegrees(carto.longitude),
      latitude: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height,
      heading: viewer.camera.heading ?? 0,
    };
  }

  /**
   * Every frame: add the batches still queued (FRAME_INSTANCE_BUDGET), and
   * recheck a camera that keeps moving (see MOTION_CHECK_MS).
   */
  function onFrame() {
    ownFrameBudget.added = 0;
    if (addQueue.length && enabled && !destroyed) pumpAddQueue();
    const now = Date.now();
    if (now - lastMotionCheckMs < MOTION_CHECK_MS) return;
    lastMotionCheckMs = now;
    if (!enabled || destroyed || pending > 0) return;
    if (viewPoseMoved(lastViewPose, currentPose())) refresh();
  }

  /** The latest reconcile, so readers can wait for the view to finish loading. */
  let currentRefresh = Promise.resolve();
  function refresh() {
    currentRefresh = reconcileView();
    return currentRefresh;
  }

  /** Reconcile the drawn chunks with the current camera view. */
  async function reconcileView() {
    if (!enabled || destroyed || !viewer) return;
    const gen = ++generation;
    lastViewPose = currentPose();
    const height = viewer.camera.positionCartographic?.height;
    // Close in: the detailed areas. Farther out: the coarse stand-in, if any.
    const source =
      height <= maxHeightM
        ? nearSource
        : farSource && height <= farSource.maxHeightM
          ? farSource
          : null;
    if (!source) {
      status = 'zoom-in';
      mode = null;
      releaseAll();
      notifyRowControls();
      governorRequestRender?.(`chunked-area:${id}`);
      return;
    }
    status = source === farSource ? 'overview' : null;
    mode = source === farSource ? 'far' : 'near';
    let list;
    try {
      list = await loadIndex(source);
      error = null;
    } catch (err) {
      error = `index unavailable (${err?.message || 'error'})`;
      return;
    }
    if (gen !== generation || !enabled) return;
    // A near-level camera (a cockpit, a street-level look) gets no useful
    // ground rectangle from Cesium: it reports a fixed ~9°-wide box that even
    // reaches behind the camera. Such views use the ground-ahead box instead.
    const shallow = (viewer.camera.pitch ?? -Math.PI / 2) > SHALLOW_PITCH_RAD;
    const rect = shallow
      ? undefined
      : viewer.camera.computeViewRectangle?.(
          viewer.scene.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84,
        );
    const pose = currentPose();
    const view = rect
      ? {
          west: Cesium.Math.toDegrees(rect.west),
          south: Cesium.Math.toDegrees(rect.south),
          east: Cesium.Math.toDegrees(rect.east),
          north: Cesium.Math.toDegrees(rect.north),
        }
      : // Horizon-up views have no ground rectangle: use the ground around
        // the camera and ahead of it.
        horizonViewBox(pose);
    const wanted = new Set(
      chunksInView(list, view, source.maxChunks).map(
        (chunkId) => `${source.prefix}${chunkId}`,
      ),
    );
    for (const chunkId of [...drawn.keys()]) {
      if (!wanted.has(chunkId)) releaseChunk(chunkId);
    }
    const missing = [...wanted].filter((chunkId) => !drawn.has(chunkId));
    if (!missing.length) {
      notifyRowControls();
      return;
    }
    pending += 1;
    try {
      const results = await Promise.allSettled(
        missing.map((chunkId) => drawChunk(chunkId, gen)),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      error = failed.length
        ? `${failed.length} area file(s) failed to load`
        : null;
      if (!failed.length) lastUpdate = Date.now();
    } finally {
      pending -= 1;
    }
    notifyRowControls();
    governorRequestRender?.(`chunked-area:${id}`);
  }

  /** A feature's properties plus the layer-level summary and source line. */
  function describe(properties, isFar = false) {
    const summarize = isFar && farSummary ? farSummary : featureSummary;
    const note = isFar && far?.sourceNote ? far.sourceNote : sourceNote;
    return {
      ...properties,
      ...(summarize && { summary: summarize(properties) }),
      ...(note && { source_note: note }),
    };
  }

  /**
   * The Entity standing for a picked area, built on first selection only:
   * the context store, the details card and voice expect an Entity. It is
   * never added to the scene (the chunk's primitive draws the area).
   */
  function entityForRecord(record) {
    if (record.entity) return record.entity;
    const hierarchy = hierarchyOf(
      polygonsOf(record.feature.geometry)[record.part],
    );
    const entity = new Cesium.Entity({
      id: record.id,
      name: record.name,
      properties: record.feature.properties || {},
      ...(hierarchy && { polygon: { hierarchy } }),
    });
    entity.__localLayerId = id;
    entity.__chunkedChunkId = record.__chunkedChunkId;
    entity.__chunkedCenter = hierarchy
      ? Cesium.Cartographic.fromCartesian(
          Cesium.BoundingSphere.fromPoints(hierarchy.positions).center,
        )
      : null;
    record.entity = entity;
    return entity;
  }

  function selectArea(record) {
    const entity = entityForRecord(record);
    const props = describe(
      record.feature.properties || {},
      sourceOf(record.__chunkedChunkId) === farSource,
    );
    const center = entity.__chunkedCenter;
    registerEntityContext(entity, {
      id: `${id}:${entity.id}`,
      layerId: id,
      layerName: name,
      source,
      // The batch drawing the area: the store reads its `show`.
      dataSource: record.primitive,
      label: props.name || name,
      properties: props,
      latitude: center
        ? Number(Cesium.Math.toDegrees(center.latitude).toFixed(6))
        : undefined,
      longitude: center
        ? Number(Cesium.Math.toDegrees(center.longitude).toFixed(6))
        : undefined,
    });
    viewer.selectedEntity = entity;
    selectEntityContext(entity);
  }

  function installClickHandler() {
    if (clickHandler) return;
    clickHandler = screenSpaceEventHandlerFactory(viewer.scene.canvas);
    clickHandler.setInputAction((click) => {
      // A tool owns the pointer (src/data/inputOwnership.js).
      if (!isPointerFree()) return;
      if (!enabled) return;
      // Clickable local cards and pins win over areas, exactly as the other
      // local layers resolve the same click.
      if (
        overlayHost?.hitTest?.(click.position.x, click.position.y, {
          filter: isLocalCardAction,
        })
      )
        return;
      const target = pickLocalEntity(viewer.scene, click.position);
      if (target && target.__localLayerId === id && target.feature)
        selectArea(target);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  /** Loaded areas (features) passing `test`. */
  function countBy(test) {
    let count = 0;
    for (const { features } of drawn.values()) {
      for (const feature of features) {
        if (test(feature.properties || {})) count += 1;
      }
    }
    return count;
  }

  function loadedCount() {
    let count = 0;
    for (const { features } of drawn.values()) count += features.length;
    return count;
  }

  return {
    id,
    name,
    icon,
    source,
    updateInterval: 0,
    statsRefreshInterval: 1000,

    init: async () => {},
    update: async () => {},

    enable: async (activeViewer) => {
      if (destroyed) return;
      viewer = activeViewer;
      enabled = true;
      installClickHandler();
      moveEndRemover ||= viewer.camera.moveEnd.addEventListener(() => {
        refresh();
      });
      frameRemover ||=
        viewer.scene?.preRender?.addEventListener?.(onFrame) || null;
      await refresh();
    },

    disable: () => {
      enabled = false;
      generation += 1;
      moveEndRemover?.();
      moveEndRemover = null;
      frameRemover?.();
      frameRemover = null;
      releaseAll();
      clearSelectedEntityContextForLayer(id);
      removeEntityContextsForLayer(id);
      status = null;
      notifyRowControls();
    },

    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      fillAlphaListeners.delete(applyFillAlpha);
      enabled = false;
      generation += 1;
      moveEndRemover?.();
      moveEndRemover = null;
      frameRemover?.();
      frameRemover = null;
      releaseAll();
      removeEntityContextsForLayer(id);
      clickHandler?.destroy();
      clickHandler = null;
      cache.clear();
      nearSource.index = null;
      if (farSource) farSource.index = null;
    },

    getStats: () => ({
      count: loadedCount(),
      lastUpdate,
      error,
      ...(pending > 0 && {
        loading: true,
        loadingLabel: 'loading areas in view...',
      }),
      ...(status === 'zoom-in' && {
        status: 'zoom-in',
        statusMessage: zoomInMessage,
      }),
      ...(status === 'overview' && {
        status: 'overview',
        statusMessage: far?.label || 'overview · zoom in for detail',
      }),
    }),

    getRowControls: () => ({
      chips: variants.map((variant) => ({
        id: variant.id,
        label: variant.label,
        title: variant.title || variant.label,
        active: variant.id === variantId,
        onClick: () => {
          if (variant.id === variantId) return;
          applyVariant(variant);
          applyFillAlpha();
          notifyRowControls();
        },
      })),
      legend: enabled
        ? (mode === 'far' && farLegend ? farLegend : legend).map((item) => ({
            label: item.label,
            color: item.color,
            blurb: item.blurb,
            count: countBy(item.test),
          }))
        : [],
    }),
    setRowControlsListener: (listener) => {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /**
     * What this layer shows around a point, for voice and other readers: the
     * area containing the point (if loaded), the nearest other areas, and the
     * legend counts over what is loaded. Areas only exist in chunks that are
     * drawn, so a zoomed-out or disabled layer reports its status instead.
     * @param {{longitude:number, latitude:number, limit?:number}} point
     * @returns {Promise<object>}
     */
    getAreaContext: async ({ longitude, latitude, limit = 5 } = {}) => {
      const base = { layerId: id, layerName: name, source };
      // Right after a fly-to the chunks for the new view may not even have
      // started loading: reconcile with the current camera now and wait
      // (bounded), following any newer reconcile that supersedes ours, so the
      // answer covers where the camera is now.
      if (enabled && !destroyed && viewer) {
        const deadline = Date.now() + AREA_CONTEXT_WAIT_MS;
        let awaited = refresh();
        for (;;) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          await Promise.race([
            awaited.catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, remaining)),
          ]);
          if (currentRefresh === awaited || Date.now() >= deadline) break;
          awaited = currentRefresh;
        }
      }
      if (!enabled) return { ...base, status: 'disabled' };
      if (status === 'zoom-in')
        return { ...base, status: 'zoom-in', statusMessage: zoomInMessage };
      const withNote = (properties) => describe(properties, mode === 'far');
      let atPoint = null;
      const nearby = [];
      for (const { features } of drawn.values()) {
        for (const feature of features) {
          if (!atPoint && featureContains(feature, longitude, latitude)) {
            atPoint = feature;
            continue;
          }
          const center = featureCenter(feature);
          if (!center) continue;
          const dx =
            (center[0] - longitude) * Math.cos((latitude * Math.PI) / 180);
          const dy = center[1] - latitude;
          nearby.push({ feature, d2: dx * dx + dy * dy });
        }
      }
      nearby.sort((a, b) => a.d2 - b.d2);
      return {
        ...base,
        status: 'loaded',
        loadedAreas: loadedCount(),
        atPoint: atPoint ? withNote(atPoint.properties || {}) : null,
        nearby: nearby.slice(0, Math.max(0, limit)).map(({ feature, d2 }) => ({
          ...withNote(feature.properties || {}),
          distanceKm: Math.round(Math.sqrt(d2) * 111.2 * 10) / 10,
        })),
        legend: legend.map((item) => ({
          label: item.label,
          count: countBy(item.test),
        })),
      };
    },

    /** Test/QA seam: chunk ids currently drawn. */
    getDrawnChunkIds: () => [...drawn.keys()],
  };
}
