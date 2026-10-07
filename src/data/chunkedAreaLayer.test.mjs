// Nationwide chunked area layers (HOLC redlining, tract life expectancy):
// only the county chunks in view are fetched and drawn, zoomed-out views ask
// the user to zoom in, and clicking an area selects it for the details card.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  _resetSharedChunksForTest,
  chunksInView,
  createChunkedAreaLayer,
  getChunkedAreaFillAlpha,
  horizonViewBox,
  setChunkedAreaFillAlpha,
  viewPoseMoved,
} from './chunkedAreaLayer.js';

// Parsed chunks are shared across layers; each test brings its own files.
beforeEach(() => _resetSharedChunksForTest());

test('two layers on the same chunks download and parse each file once', async () => {
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return {
      ok: true,
      text: async () =>
        '{"type":"Feature","properties":{"a":1},"geometry":null}\n',
    };
  };
  try {
    const { readSharedChunkForTest } = await import('./chunkedAreaLayer.js');
    const [first, second] = await Promise.all([
      readSharedChunkForTest('/context/t/25025.geojsonl'),
      readSharedChunkForTest('/context/t/25025.geojsonl'),
    ]);
    assert.equal(fetched.length, 1);
    assert.equal(first, second);
    assert.equal(first[0].properties.a, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

class MockEvent {
  constructor() {
    this.listeners = new Set();
  }
  addEventListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  raise() {
    for (const listener of [...this.listeners]) listener();
  }
}

const square = (lon, lat, d = 0.01) => ({
  type: 'Polygon',
  coordinates: [
    [
      [lon - d, lat - d],
      [lon + d, lat - d],
      [lon + d, lat + d],
      [lon - d, lat - d],
    ],
  ],
});

const INDEX = [
  { id: '17031', bbox: [-88.3, 41.4, -87.5, 42.2], count: 1 }, // Cook, IL
  { id: '06037', bbox: [-118.9, 33.7, -117.6, 34.8], count: 1 }, // LA, CA
];
const CHUNKS = {
  17031: {
    type: 'Feature',
    id: 'tract-17031010100',
    properties: {
      name: 'Census Tract 101, Cook County, IL',
      geoid: '17031010100',
      life_exp_8: 68.8,
      summary: 'Life expectancy at birth: 68.8 years.',
    },
    geometry: square(-87.67, 42.02),
  },
  '06037': {
    type: 'Feature',
    id: 'tract-06037101110',
    properties: { name: 'LA tract', life_exp_8: 80.1, summary: 'x' },
    geometry: square(-118.3, 34.2),
  },
};

test('chunksInView keeps intersecting chunks, nearest first, up to the limit', () => {
  const index = [
    { id: 'far', bbox: [10, 10, 11, 11] },
    { id: 'edge', bbox: [0.9, 0.9, 2, 2] },
    { id: 'center', bbox: [0.4, 0.4, 0.6, 0.6] },
  ];
  const view = { west: 0, south: 0, east: 1, north: 1 };
  assert.deepEqual(chunksInView(index, view, 10), ['center', 'edge']);
  assert.deepEqual(chunksInView(index, view, 1), ['center']);
});

// A Cook County chunk with several areas: two plain tracts, a two-part
// MultiPolygon, and a tract without an estimate.
const COOK_AREAS = [
  {
    type: 'Feature',
    id: 'tract-a',
    properties: { name: 'Tract A', life_exp_8: 68.8 },
    geometry: square(-87.7, 41.9),
  },
  {
    type: 'Feature',
    id: 'tract-b',
    properties: { name: 'Tract B', life_exp_8: 81.2 },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        square(-87.66, 41.9).coordinates,
        square(-87.62, 41.9).coordinates,
      ],
    },
  },
  {
    type: 'Feature',
    id: 'tract-c',
    properties: { name: 'Tract C', life_exp_8: 72.0 },
    geometry: square(-87.58, 41.9),
  },
  {
    type: 'Feature',
    properties: { name: 'Tract D' },
    geometry: square(-87.54, 41.9),
  },
];

async function createHarness({
  heightM = 20_000,
  layerOptions = {},
  chunks = CHUNKS,
} = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const fetched = [];
  const selected = [];
  globalThis.window = {
    dispatchEvent(event) {
      if (event.type === 'gev:entity-selected') selected.push(event.detail);
    },
  };
  globalThis.fetch = async (url) => {
    fetched.push(url);
    if (url.endsWith('index.json')) {
      return { ok: true, status: 200, json: async () => INDEX };
    }
    const id = decodeURIComponent(
      url.split('/').pop().replace('.geojsonl', ''),
    );
    const features = [chunks[id]].flat();
    return {
      ok: true,
      status: 200,
      text: async () =>
        `${features.map((feature) => JSON.stringify(feature)).join('\n')}\n`,
    };
  };
  const moveEnd = new MockEvent();
  const preRender = new MockEvent();
  const added = [];
  const ground = [];
  let clickAction = null;
  let pickResult = null;
  const viewer = {
    selectedEntity: undefined,
    // Entities are no longer drawn; anything added here is a regression.
    dataSources: {
      add: async (ds) => added.push(ds),
      remove: (ds) => {
        const i = added.indexOf(ds);
        if (i >= 0) added.splice(i, 1);
        return true;
      },
    },
    camera: {
      moveEnd,
      positionCartographic: Cesium.Cartographic.fromDegrees(
        -87.65,
        41.85,
        heightM,
      ),
      // A view over Chicago only.
      computeViewRectangle: () =>
        Cesium.Rectangle.fromDegrees(-87.9, 41.6, -87.4, 42.1),
    },
    scene: {
      canvas: {},
      pick: () => pickResult,
      requestRender() {},
      preRender,
      // Like Cesium's PrimitiveCollection: remove() destroys the primitive.
      groundPrimitives: {
        add: (primitive) => {
          ground.push(primitive);
          return primitive;
        },
        remove: (primitive) => {
          const i = ground.indexOf(primitive);
          if (i < 0) return false;
          ground.splice(i, 1);
          primitive.destroy();
          return true;
        },
      },
    },
  };
  const layer = createChunkedAreaLayer(
    {
      id: 'local-life-expectancy',
      name: 'Life Expectancy (tracts)',
      baseUrl: '/context/life-expectancy',
      featureColor: (p) => (p.life_exp_8 < 75 ? '#b2182b' : '#2166ac'),
      legend: [
        { label: 'low', color: '#b2182b', test: (p) => p.life_exp_8 < 75 },
      ],
      screenSpaceEventHandlerFactory: () => ({
        setInputAction(action) {
          clickAction = action;
        },
        destroy() {},
      }),
      ...layerOptions,
    },
    {
      overlayHost: { hitTest: () => null },
      registerEntityContext: (entity, meta) => {
        entity.__gevContextId = meta.id;
        entity.__meta = meta;
      },
      selectEntityContext: (entity) => selected.push(entity.__meta),
      clearSelectedEntityContextForLayer() {},
      removeEntityContextsForLayer() {},
      governorRequestRender() {},
    },
  );
  return {
    layer,
    viewer,
    fetched,
    added,
    ground,
    selected,
    moveEnd,
    preRender,
    /** Pick records (instance ids) of the drawn primitive at `index`. */
    records: (index = 0) =>
      ground[index].geometryInstances.map((instance) => instance.id),
    /** Make the next click hit an instance, as scene.pick reports it. */
    setPick: (record) => {
      pickResult = record
        ? {
            primitive: ground.find((p) =>
              p.geometryInstances.some((i) => i.id === record),
            ),
            id: record,
          }
        : null;
    },
    click: () => clickAction({ position: new Cesium.Cartesian2(10, 10) }),
    cleanup() {
      layer.destroy(viewer);
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
    },
  };
}

test('a camera that never stops (cockpit, follow) still reloads the view it has moved to', async () => {
  const env = await createHarness();
  try {
    await env.layer.enable(env.viewer);
    assert.deepEqual(env.layer.getDrawnChunkIds(), ['17031']);
    // Fly to Los Angeles without ever raising moveEnd, like the cockpit camera.
    env.viewer.camera.positionCartographic = Cesium.Cartographic.fromDegrees(
      -118.3,
      34.2,
      20_000,
    );
    env.viewer.camera.computeViewRectangle = () =>
      Cesium.Rectangle.fromDegrees(-118.6, 33.9, -118.0, 34.5);
    env.preRender.raise();
    for (let i = 0; i < 50; i++) {
      if (env.layer.getDrawnChunkIds()[0] === '06037') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(env.layer.getDrawnChunkIds(), ['06037']);
    await env.layer.disable(env.viewer);
    assert.equal(env.preRender.listeners.size, 0, 'no frame work while off');
  } finally {
    env.cleanup();
  }
});

test('a horizon view loads the ground ahead of the camera, not only beneath it', () => {
  // 10 km up, west of Cook County (bbox west edge -88.3).
  const pose = { longitude: -89.0, latitude: 41.8, height: 10_000 };
  const east = horizonViewBox({ ...pose, heading: Math.PI / 2 });
  const west = horizonViewBox({ ...pose, heading: -Math.PI / 2 });
  assert.deepEqual(chunksInView(INDEX, east, 10), ['17031']);
  assert.deepEqual(chunksInView(INDEX, west, 10), []);
  // Looking east, the box reaches about 60 km ahead (6 × height).
  assert.ok(east.east > -88.0 && east.east < -87.8, String(east.east));
  assert.ok(east.west <= -89.0 - 0.3, 'the ground beneath stays included');
});

test('a near-level camera ignores Cesium’s meaningless wide rectangle and loads what is ahead', async () => {
  const env = await createHarness();
  try {
    // West of Cook County, 10 km up, looking east almost level, like a cockpit.
    env.viewer.camera.positionCartographic = Cesium.Cartographic.fromDegrees(
      -89.0,
      41.8,
      10_000,
    );
    env.viewer.camera.pitch = Cesium.Math.toRadians(-6);
    env.viewer.camera.heading = Math.PI / 2;
    // A wide box whose center is far off (the old code drew Los Angeles).
    env.viewer.camera.computeViewRectangle = () =>
      Cesium.Rectangle.fromDegrees(-125, 30, -95, 45);
    await env.layer.enable(env.viewer);
    assert.deepEqual(env.layer.getDrawnChunkIds(), ['17031']);
  } finally {
    env.cleanup();
  }
});

test('viewPoseMoved: travel, turning or climbing counts; jitter does not', () => {
  const at = { longitude: -87.65, latitude: 41.85, height: 10_000, heading: 0 };
  assert.equal(viewPoseMoved(at, { ...at }), false);
  assert.equal(viewPoseMoved(at, { ...at, longitude: -87.649 }), false);
  // A quarter of the 10 km height is 2.5 km; 0.04° of longitude is ~3.3 km.
  assert.equal(viewPoseMoved(at, { ...at, longitude: -87.61 }), true);
  assert.equal(viewPoseMoved(at, { ...at, heading: 0.5 }), true);
  assert.equal(viewPoseMoved(at, { ...at, height: 16_000 }), true);
  assert.equal(viewPoseMoved(null, at), false);
});

test('only the counties in view are fetched and drawn', async () => {
  const env = await createHarness();
  try {
    await env.layer.enable(env.viewer);
    assert.deepEqual(env.layer.getDrawnChunkIds(), ['17031']);
    assert.ok(env.fetched.some((u) => u.endsWith('/17031.geojsonl')));
    assert.ok(
      !env.fetched.some((u) => u.endsWith('/06037.geojsonl')),
      'Los Angeles is never downloaded for a Chicago view',
    );
    assert.equal(env.layer.getStats().count, 1);
    assert.deepEqual(
      env.layer.getRowControls().legend.map((l) => [l.label, l.count]),
      [['low', 1]],
    );
  } finally {
    env.cleanup();
  }
});

test('zoomed out past the threshold nothing loads and the panel says zoom in', async () => {
  const env = await createHarness({ heightM: 5_000_000 });
  try {
    await env.layer.enable(env.viewer);
    assert.deepEqual(env.layer.getDrawnChunkIds(), []);
    assert.equal(env.fetched.length, 0);
    const stats = env.layer.getStats();
    assert.equal(stats.status, 'zoom-in');
    assert.match(stats.statusMessage, /zoom in/);
  } finally {
    env.cleanup();
  }
});

test('a layer with a far stand-in draws it when zoomed out, then the detail up close', async () => {
  const env = await createHarness({
    heightM: 5_000_000,
    layerOptions: {
      far: {
        baseUrl: 'context/far-counties/',
        label: 'showing counties · zoom in for tracts',
        featureSummary: (p) => `County view of ${p.name}.`,
      },
    },
  });
  try {
    await env.layer.enable(env.viewer);
    // From far out: the stand-in's chunks, never "zoom in".
    assert.deepEqual(env.layer.getDrawnChunkIds(), ['far:17031']);
    assert.ok(env.fetched.some((url) => url.includes('far-counties/index.json')));
    assert.ok(env.fetched.some((url) => url.endsWith('far-counties/17031.geojsonl')));
    const stats = env.layer.getStats();
    assert.equal(stats.status, 'overview');
    assert.equal(stats.statusMessage, 'showing counties · zoom in for tracts');
    env.setPick(env.records()[0]);
    env.click();
    assert.match(env.selected.at(-1).properties.summary, /^County view of /);
  } finally {
    env.cleanup();
  }
});

test('a nationwide layer loads at country height and has its own zoom hint', async () => {
  const wide = await createHarness({
    heightM: 5_000_000,
    layerOptions: {
      maxHeightM: 8_000_000,
      zoomInMessage: 'zoom in to the United States to load',
    },
  });
  try {
    await wide.layer.enable(wide.viewer);
    assert.deepEqual(wide.layer.getDrawnChunkIds(), ['17031']);
    assert.equal(wide.layer.getStats().status, undefined);
  } finally {
    wide.cleanup();
  }
  const space = await createHarness({
    heightM: 20_000_000,
    layerOptions: {
      maxHeightM: 8_000_000,
      zoomInMessage: 'zoom in to the United States to load',
    },
  });
  try {
    await space.layer.enable(space.viewer);
    assert.equal(
      space.layer.getStats().statusMessage,
      'zoom in to the United States to load',
    );
  } finally {
    space.cleanup();
  }
});

test('clicking an area selects it with its summary', async () => {
  const env = await createHarness();
  try {
    await env.layer.enable(env.viewer);
    env.setPick(env.records()[0]);
    env.click();
    assert.equal(env.selected.length, 1);
    const record = env.selected[0];
    assert.equal(record.layerId, 'local-life-expectancy');
    assert.equal(record.properties.life_exp_8, 68.8);
    assert.match(record.properties.summary, /68\.8 years/);
    assert.ok(Number.isFinite(record.latitude));
  } finally {
    env.cleanup();
  }
});

test('area context names the area under a point, its neighbors and the legend (voice)', async () => {
  const env = await createHarness({
    layerOptions: { sourceNote: 'USALEEP tract life expectancy.' },
  });
  try {
    await env.layer.enable(env.viewer);
    const context = await env.layer.getAreaContext({
      longitude: -87.662,
      latitude: 42.015,
    });
    assert.equal(context.status, 'loaded');
    assert.equal(context.layerId, 'local-life-expectancy');
    assert.equal(context.atPoint.name, 'Census Tract 101, Cook County, IL');
    assert.equal(context.atPoint.life_exp_8, 68.8);
    assert.equal(context.atPoint.source_note, 'USALEEP tract life expectancy.');
    assert.deepEqual(context.legend, [{ label: 'low', count: 1 }]);

    // Outside every area: no atPoint, but the nearest area with its distance.
    const nearby = await env.layer.getAreaContext({
      longitude: -87.7,
      latitude: 41.9,
    });
    assert.equal(nearby.atPoint, null);
    assert.equal(nearby.nearby[0].name, 'Census Tract 101, Cook County, IL');
    assert.ok(nearby.nearby[0].distanceKm > 5);

    env.layer.disable(env.viewer);
    assert.equal(
      (await env.layer.getAreaContext({ longitude: -87.662, latitude: 42.015 }))
        .status,
      'disabled',
    );
  } finally {
    env.cleanup();
  }
  const high = await createHarness({ heightM: 5_000_000 });
  try {
    await high.layer.enable(high.viewer);
    const context = await high.layer.getAreaContext({
      longitude: -87.662,
      latitude: 42.015,
    });
    assert.equal(context.status, 'zoom-in');
    assert.match(context.statusMessage, /zoom in/);
  } finally {
    high.cleanup();
  }
});

test('fillAlpha sets the area fill opacity', async () => {
  const env = await createHarness({ layerOptions: { fillAlpha: 0.6 } });
  try {
    await env.layer.enable(env.viewer);
    const [instance] = env.ground[0].geometryInstances;
    // Per-instance colors are bytes: alpha 0.6 is 153/255.
    assert.ok(Math.abs(instance.attributes.color.value[3] / 255 - 0.6) < 0.01);
    assert.equal(env.ground[0].appearance.translucent, true);
  } finally {
    env.cleanup();
  }
});

test('the shared fill opacity (cockpit LAYERS slider) recolors drawn areas and clears back', async () => {
  const env = await createHarness({ layerOptions: { fillAlpha: 0.4 } });
  const alphaOf = (primitive) =>
    primitive.geometryInstances[0].attributes.color.value[3] / 255;
  try {
    await env.layer.enable(env.viewer);
    assert.ok(Math.abs(alphaOf(env.ground[0]) - 0.4) < 0.01);
    // A batch still being prepared is rebuilt at the new opacity.
    setChunkedAreaFillAlpha(0.8);
    assert.equal(getChunkedAreaFillAlpha(), 0.8);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(env.ground.length, 1);
    assert.ok(Math.abs(alphaOf(env.ground[0]) - 0.8) < 0.01);

    // A ready batch recolors in place, without a rebuild.
    const ready = env.ground[0];
    const written = [];
    Object.defineProperty(ready, 'ready', { value: true });
    ready.getGeometryInstanceAttributes = (record) => {
      const attributes = { color: new Uint8Array(4) };
      written.push({ record, attributes });
      return attributes;
    };
    setChunkedAreaFillAlpha(null);
    assert.equal(getChunkedAreaFillAlpha(), null);
    assert.equal(env.ground[0], ready, 'same primitive, recolored in place');
    assert.ok(written.length > 0);
    for (const { record, attributes } of written) {
      assert.ok(record.feature, 'each instance is recolored from its feature');
      assert.ok(Math.abs(attributes.color[3] / 255 - 0.4) < 0.01);
    }
  } finally {
    setChunkedAreaFillAlpha(null);
    env.cleanup();
  }
});

test('disable releases every drawn county', async () => {
  const env = await createHarness();
  try {
    await env.layer.enable(env.viewer);
    assert.equal(env.ground.length, 1);
    const [primitive] = env.ground;
    env.layer.disable(env.viewer);
    assert.equal(env.ground.length, 0);
    assert.equal(primitive.isDestroyed(), true);
    assert.deepEqual(env.layer.getDrawnChunkIds(), []);
  } finally {
    env.cleanup();
  }
});

test('a county is drawn as batched classification primitives, one per color, not an entity per area', async () => {
  const env = await createHarness({ chunks: { ...CHUNKS, 17031: COOK_AREAS } });
  try {
    await env.layer.enable(env.viewer);
    assert.equal(env.added.length, 0, 'no data sources / entities');
    // Red (A, C) and blue (B's two parts, and D without an estimate).
    assert.equal(env.ground.length, 2, 'one primitive per color');
    for (const primitive of env.ground) {
      assert.ok(primitive instanceof Cesium.ClassificationPrimitive);
      assert.equal(
        primitive.classificationType,
        Cesium.ClassificationType.BOTH,
      );
      assert.ok(
        primitive.appearance instanceof Cesium.PerInstanceColorAppearance,
      );
    }
    // One instance per polygon: the MultiPolygon contributes two.
    assert.deepEqual(
      env.ground.flatMap((p) => p.geometryInstances.map((i) => i.id.id)),
      ['tract-a', 'tract-c', 'tract-b', 'tract-b_2', '17031:3'],
    );
    assert.ok(
      env.ground.every((primitive) =>
        primitive.geometryInstances.every(
          (instance) => instance.geometry instanceof Cesium.PolygonGeometry,
        ),
      ),
    );
    // Counts are areas (features), not polygon parts.
    assert.equal(env.layer.getStats().count, 4);
    assert.deepEqual(
      env.layer.getRowControls().legend.map((l) => [l.label, l.count]),
      [['low', 2]],
    );
  } finally {
    env.cleanup();
  }
});

test('each area takes its own color from featureColor', async () => {
  const env = await createHarness({
    chunks: { ...CHUNKS, 17031: COOK_AREAS },
    layerOptions: {
      featureColor: (p) =>
        !Number.isFinite(p.life_exp_8)
          ? 'not a color'
          : p.life_exp_8 < 75
            ? '#b2182b'
            : '#2166ac',
    },
  });
  try {
    await env.layer.enable(env.viewer);
    const bytes = (css) => {
      const value = Cesium.ColorGeometryInstanceAttribute.toValue(
        Cesium.Color.fromCssColorString(css).withAlpha(0.4),
      );
      return [...value];
    };
    // A batch per color, every instance in a batch the same color.
    const colors = env.ground.map((primitive) =>
      primitive.geometryInstances.map((instance) => [
        ...instance.attributes.color.value,
      ]),
    );
    assert.deepEqual(colors, [
      [bytes('#b2182b'), bytes('#b2182b')],
      [bytes('#2166ac'), bytes('#2166ac')],
      [bytes('#9e9e9e')], // unparseable color falls back to gray
    ]);
  } finally {
    env.cleanup();
  }
});

test('picking an area of the batch selects exactly that feature', async () => {
  const env = await createHarness({
    chunks: { ...CHUNKS, 17031: COOK_AREAS },
    layerOptions: { sourceNote: 'USALEEP.' },
  });
  try {
    await env.layer.enable(env.viewer);
    const records = env.ground.flatMap((p) =>
      p.geometryInstances.map((instance) => instance.id),
    );
    // The second part of tract B.
    const partTwo = records.find((record) => record.id === 'tract-b_2');
    env.setPick(partTwo);
    env.click();
    assert.equal(env.selected.length, 1);
    const record = env.selected[0];
    assert.equal(record.id, 'local-life-expectancy:tract-b_2');
    assert.equal(record.label, 'Tract B');
    assert.equal(record.properties.life_exp_8, 81.2);
    assert.equal(record.properties.source_note, 'USALEEP.');
    assert.equal(record.dataSource, partTwo.primitive);
    // Centered on the clicked part (-87.62), not the feature's other part.
    assert.ok(Math.abs(record.longitude - -87.62) < 0.01, record.longitude);
    assert.ok(Math.abs(record.latitude - 41.9) < 0.01, record.latitude);
    // The context store gets a real (detached) Entity, made on demand.
    const entity = env.viewer.selectedEntity;
    assert.ok(entity instanceof Cesium.Entity);
    assert.equal(entity.__localLayerId, 'local-life-expectancy');
    assert.equal(entity.__gevContextId, record.id);
    assert.ok(
      records.every((r) => (r === partTwo ? r.entity === entity : !r.entity)),
      'only the clicked area has an entity',
    );
    // Clicking it again reuses the same entity.
    env.click();
    assert.equal(env.viewer.selectedEntity, entity);

    // Another layer's area is not ours to select.
    env.setPick({ ...records[0], __localLayerId: 'local-air-pm25' });
    env.click();
    assert.equal(env.selected.length, 2);
  } finally {
    env.cleanup();
  }
});

test('featureFilter keeps only the matching areas in the batch', async () => {
  const env = await createHarness({
    chunks: { ...CHUNKS, 17031: COOK_AREAS },
    layerOptions: { featureFilter: (p) => p.life_exp_8 < 75 },
  });
  try {
    await env.layer.enable(env.viewer);
    assert.deepEqual(
      env.records().map((record) => record.feature.properties.name),
      ['Tract A', 'Tract C'],
    );
    assert.equal(env.layer.getStats().count, 2);
  } finally {
    env.cleanup();
  }
  // A chunk with nothing left counts as drawn but adds no primitive.
  const none = await createHarness({
    chunks: { ...CHUNKS, 17031: COOK_AREAS },
    layerOptions: { featureFilter: () => false },
  });
  try {
    await none.layer.enable(none.viewer);
    assert.deepEqual(none.layer.getDrawnChunkIds(), ['17031']);
    assert.equal(none.ground.length, 0);
    assert.equal(none.layer.getStats().count, 0);
  } finally {
    none.cleanup();
  }
});

test('a county with thousands of areas is split into even batches added over several frames', async () => {
  const many = Array.from({ length: 1300 }, (_, i) => ({
    type: 'Feature',
    id: `t${i}`,
    // One color, so the batching is by count alone.
    properties: { name: `T${i}`, life_exp_8: 70 },
    geometry: square(
      -87.9 + (i % 50) * 0.01,
      41.6 + Math.floor(i / 50) * 0.01,
      0.004,
    ),
  }));
  const env = await createHarness({ chunks: { ...CHUNKS, 17031: many } });
  try {
    await env.layer.enable(env.viewer);
    assert.equal(env.layer.getStats().count, 1300);
    // 1,300 polygons: three batches of 434/434/432, one entering per frame.
    assert.equal(env.ground.length, 1);
    env.preRender.raise();
    assert.equal(env.ground.length, 2);
    env.preRender.raise();
    assert.equal(env.ground.length, 3);
    assert.deepEqual(
      env.ground.map((p) => p.geometryInstances.length),
      [434, 434, 432],
    );
    // Picking an area in a later batch maps to that batch and feature.
    const record = env.records(2).at(-1);
    env.setPick(record);
    env.click();
    assert.equal(env.selected[0].properties.name, 'T1299');
    assert.equal(env.selected[0].dataSource, env.ground[2]);
    // Leaving releases every batch, including any still queued.
    const batches = [...env.ground];
    env.layer.disable(env.viewer);
    assert.ok(batches.every((p) => p.isDestroyed()));
    assert.equal(env.ground.length, 0);
  } finally {
    env.cleanup();
  }
});

test('batches still queued when their county leaves are destroyed, never added', async () => {
  const many = Array.from({ length: 1300 }, (_, i) => ({
    type: 'Feature',
    id: `t${i}`,
    properties: { life_exp_8: 70 },
    geometry: square(
      -87.9 + (i % 50) * 0.01,
      41.6 + Math.floor(i / 50) * 0.01,
      0.004,
    ),
  }));
  const env = await createHarness({ chunks: { ...CHUNKS, 17031: many } });
  try {
    await env.layer.enable(env.viewer);
    assert.equal(env.ground.length, 1);
    env.layer.disable(env.viewer);
    env.preRender.raise();
    assert.equal(env.ground.length, 0);
  } finally {
    env.cleanup();
  }
});

test('a county leaving the view destroys its primitive and its selection', async () => {
  const env = await createHarness();
  try {
    await env.layer.enable(env.viewer);
    const [chicago] = env.ground;
    env.setPick(env.records()[0]);
    env.click();
    assert.equal(env.viewer.selectedEntity.__chunkedChunkId, '17031');
    env.viewer.camera.positionCartographic = Cesium.Cartographic.fromDegrees(
      -118.3,
      34.2,
      20_000,
    );
    env.viewer.camera.computeViewRectangle = () =>
      Cesium.Rectangle.fromDegrees(-118.6, 33.9, -118.0, 34.5);
    env.moveEnd.raise();
    for (let i = 0; i < 50; i++) {
      if (env.layer.getDrawnChunkIds()[0] === '06037') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(env.layer.getDrawnChunkIds(), ['06037']);
    assert.equal(chicago.isDestroyed(), true);
    assert.equal(env.ground.length, 1);
    assert.notEqual(env.ground[0], chicago);
    assert.equal(env.viewer.selectedEntity, undefined);
  } finally {
    env.cleanup();
  }
});
