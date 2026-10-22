// Adapted from the Sheldondouthat/satwq-reality-os fork of God's Eye View
// (MIT). The RainViewer and other GIBS products are not in Husky Eye View, so
// their tests are left out; the box, host and lifecycle tests are new.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createImageryTileLayer } from './factory.js';
import {
  GIBS_WMTS_BASE,
  GIBS_PRODUCTS,
  yesterdayDateUTC,
  gibsTileTemplate,
  productUrlTemplate,
  createGibsSource,
} from './products.js';

/** Minimal imagery collection: add/remove only. */
function stubCollection() {
  const added = [];
  return {
    added,
    add(imageryLayer) {
      added.push(imageryLayer);
      return imageryLayer;
    },
    remove(imageryLayer) {
      const index = added.indexOf(imageryLayer);
      if (index >= 0) added.splice(index, 1);
      return index >= 0;
    },
  };
}

function stubViewer() {
  const imageryLayers = stubCollection();
  return { imageryLayers, added: imageryLayers.added };
}

function staticSource(template) {
  return { getSnapshot: async () => ({ template }) };
}

const degrees = (rectangle) =>
  [rectangle.west, rectangle.south, rectangle.east, rectangle.north].map(
    (value) => Number(Cesium.Math.toDegrees(value).toFixed(4)),
  );

test('yesterdayDateUTC returns yesterday in UTC', () => {
  assert.equal(
    yesterdayDateUTC(Date.parse('2026-09-26T12:00:00Z')),
    '2026-09-25',
  );
  // Just past UTC midnight still counts the previous UTC day.
  assert.equal(
    yesterdayDateUTC(Date.parse('2026-09-26T00:30:00Z')),
    '2026-09-25',
  );
  assert.match(yesterdayDateUTC(), /^\d{4}-\d{2}-\d{2}$/);
});

test('gibsTileTemplate builds the verified WMTS REST pattern', () => {
  assert.equal(
    gibsTileTemplate({
      layerName: 'MODIS_Terra_CorrectedReflectance_TrueColor',
      matrixSet: 'GoogleMapsCompatible_Level9',
      ext: 'jpg',
      date: '2026-09-25',
    }),
    `${GIBS_WMTS_BASE}/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-09-25/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
  );
  assert.throws(
    () =>
      gibsTileTemplate({
        layerName: 'x',
        matrixSet: 'y',
        ext: 'jpg',
        date: 'not-a-date',
      }),
    /date/,
  );
});

test('the Black Marble product carries the verified layer facts', () => {
  assert.deepEqual(Object.keys(GIBS_PRODUCTS), ['nightlights']);
  const product = GIBS_PRODUCTS.nightlights;
  assert.equal(product.wmtsLayer, 'VIIRS_Black_Marble');
  assert.equal(product.fixedDate, '2016-01-01');
  assert.equal(product.matrixSet, 'GoogleMapsCompatible_Level8');
  assert.equal(product.ext, 'png');
  assert.equal(product.maximumLevel, 8);
  assert.equal(product.updateInterval, 6 * 3600 * 1000);
  assert.equal(
    productUrlTemplate(product, Date.parse('2026-09-26T12:00:00Z')),
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
  );
  assert.equal(productUrlTemplate({}), null);
});

test('GIBS source stamps the template date per snapshot', async () => {
  let nowMs = Date.parse('2026-09-26T12:00:00Z');
  const daily = {
    wmtsLayer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    matrixSet: 'GoogleMapsCompatible_Level9',
    ext: 'jpg',
  };
  const source = createGibsSource(daily, { now: () => nowMs });
  let snapshot = await source.getSnapshot({});
  assert.ok(
    snapshot.template.includes('/default/2026-09-25/'),
    snapshot.template,
  );
  nowMs = Date.parse('2026-09-27T12:00:00Z');
  snapshot = await source.getSnapshot({});
  assert.ok(
    snapshot.template.includes('/default/2026-09-26/'),
    snapshot.template,
  );
  const fixed = await createGibsSource(GIBS_PRODUCTS.nightlights).getSnapshot(
    {},
  );
  assert.ok(fixed.template.includes('/default/2016-01-01/'), fixed.template);
  assert.equal(fixed.credit, GIBS_PRODUCTS.nightlights.credit);
  assert.throws(() => createGibsSource({}), /GIBS product/);
});

test('factory validates its inputs', () => {
  assert.throws(() => createImageryTileLayer(), /id/);
  assert.throws(() => createImageryTileLayer({ id: 'x' }), /name/);
  assert.throws(
    () =>
      createImageryTileLayer({
        id: 'x',
        name: 'X',
        updateInterval: 1000,
      }),
    /snapshot source/,
  );
  assert.throws(
    () =>
      createImageryTileLayer({
        id: 'x',
        name: 'X',
        source: staticSource('t'),
        updateInterval: 0,
      }),
    /updateInterval/,
  );
  for (const boxes of [[], [[0, 0, 1]], [[1, 0, 0, 1]], [[0, 1, 1, 0]]])
    assert.throws(
      () =>
        createImageryTileLayer({
          id: 'x',
          name: 'X',
          source: staticSource('t'),
          updateInterval: 1000,
          boxes,
        }),
      /boxes/,
      JSON.stringify(boxes),
    );
});

test('factory lifecycle: init, enable attaches, update confirms, disable detaches, destroy clears', async () => {
  const viewer = stubViewer();
  const renders = [];
  const layer = createImageryTileLayer({
    id: 'test-layer',
    name: 'Test Layer',
    icon: '✧',
    sourceLabel: 'Test',
    credit: 'test credit',
    urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
    maximumLevel: 9,
    updateInterval: 1000,
    requestRender: (reason) => renders.push(reason),
    eventTarget: null,
    source: staticSource('https://tiles.example/{z}/{x}/{y}.png'),
  });
  assert.equal(layer.id, 'test-layer');
  assert.equal(layer.source, 'Test');
  assert.equal(layer.updateInterval, 1000);
  assert.throws(() => layer.enable(), /before init/);

  layer.init(viewer);
  assert.throws(() => layer.init(viewer), /already initialized/);
  layer.enable(viewer);
  // A static template attaches synchronously on enable, over the whole world.
  assert.equal(viewer.added.length, 1);
  assert.ok(viewer.added[0].imageryProvider.url.includes('tiles.example'));
  assert.equal(viewer.added[0].alpha, 0.85);
  assert.ok(renders.length > 0);

  // update() with an unchanged template does not rebuild the provider.
  const first = viewer.added[0];
  assert.equal(await layer.update(viewer), true);
  assert.equal(viewer.added.length, 1);
  assert.equal(viewer.added[0], first);
  const stats = layer.getStats();
  assert.equal(stats.frames, 1);
  assert.ok(Number.isFinite(stats.lastUpdate));
  assert.equal(stats.error, null);

  layer.disable(viewer);
  assert.equal(viewer.added.length, 0);
  // update() while disabled is a no-op.
  assert.equal(await layer.update(viewer), false);
  layer.destroy(viewer);
  const cleared = layer.getStats();
  assert.equal(cleared.frames, 0);
  assert.equal(cleared.lastUpdate, null);
  assert.equal(cleared.error, null);
});

test('boxes: one imagery layer per box, each clipped to it, provider included', async () => {
  const viewer = stubViewer();
  const boxes = [
    [-125, 24.4, -66.9, 49.4],
    [-160.6, 18.8, -154.6, 22.4],
  ];
  const layer = createImageryTileLayer({
    id: 'boxed',
    name: 'Boxed',
    urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
    updateInterval: 1000,
    eventTarget: null,
    boxes,
    source: staticSource('https://tiles.example/{z}/{x}/{y}.png'),
  });
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(await layer.update(viewer), true);
  assert.equal(viewer.added.length, 2);
  viewer.added.forEach((imageryLayer, index) => {
    assert.deepEqual(degrees(imageryLayer.rectangle), boxes[index]);
    // The provider's own rectangle keeps Cesium from requesting tiles
    // outside the box at all.
    assert.deepEqual(
      degrees(imageryLayer.imageryProvider.rectangle),
      boxes[index],
    );
  });
  assert.deepEqual(layer.getDiagnostics().rectangles, boxes);
  layer.destroy(viewer);
  assert.equal(viewer.added.length, 0);
});

test('the imagery follows the map stack host and says when there is none', async () => {
  const viewer = stubViewer();
  const tileset = stubCollection();
  let current = { collection: viewer.imageryLayers, kind: 'globe' };
  const events = new EventTarget();
  const layer = createImageryTileLayer({
    id: 'hosted',
    name: 'Hosted',
    urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
    updateInterval: 1000,
    eventTarget: events,
    boxes: [[-125, 24.4, -66.9, 49.4]],
    source: staticSource('https://tiles.example/{z}/{x}/{y}.png'),
  });
  layer.init(viewer);
  layer.attachShellServices({ imageryHost: () => current });
  layer.enable(viewer);
  assert.equal(await layer.update(viewer), true);
  assert.equal(viewer.added.length, 1);

  current = { collection: tileset, kind: 'tileset' };
  events.dispatchEvent(new Event('gev:map-stack-changed'));
  assert.equal(viewer.added.length, 0);
  assert.equal(tileset.added.length, 1);

  current = { collection: null, kind: 'none' };
  assert.match(layer.getStats().error, /choose a globe map/);
  assert.equal(tileset.added.length, 0);

  current = { collection: viewer.imageryLayers, kind: 'globe' };
  assert.equal(layer.getStats().error, null);
  assert.equal(viewer.added.length, 1);
  layer.destroy(viewer);
  events.dispatchEvent(new Event('gev:map-stack-changed'));
  assert.equal(viewer.added.length, 0);
});

test('factory rebuilds the provider only when the template changes', async () => {
  const viewer = stubViewer();
  let nowMs = Date.parse('2026-09-26T12:00:00Z');
  const layer = createImageryTileLayer({
    id: 'test-gibs',
    name: 'Test GIBS',
    sourceLabel: 'NASA GIBS',
    credit: 'gibs',
    urlTemplate: null,
    maximumLevel: 9,
    updateInterval: 1000,
    eventTarget: null,
    source: createGibsSource(
      {
        wmtsLayer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
        matrixSet: 'GoogleMapsCompatible_Level9',
        ext: 'jpg',
      },
      { now: () => nowMs },
    ),
  });
  layer.init(viewer);
  layer.enable(viewer);
  // No static template: nothing until the first snapshot.
  assert.equal(viewer.added.length, 0);
  assert.equal(await layer.update(viewer), true);
  assert.equal(viewer.added.length, 1);
  const first = viewer.added[0];
  assert.ok(first.imageryProvider.url.includes('/2026-09-25/'));

  // Same date: no rebuild.
  assert.equal(await layer.update(viewer), true);
  assert.equal(viewer.added[0], first);

  // Midnight rollover: template changes, provider rebuilt.
  nowMs = Date.parse('2026-09-27T12:00:00Z');
  assert.equal(await layer.update(viewer), true);
  assert.equal(viewer.added.length, 1);
  assert.notEqual(viewer.added[0], first);
  assert.ok(viewer.added[0].imageryProvider.url.includes('/2026-09-26/'));
  assert.equal(layer.getStats().frames, 3);
  layer.destroy(viewer);
  assert.equal(viewer.added.length, 0);
});

test('factory detaches on failure instead of showing stale tiles', async () => {
  const viewer = stubViewer();
  let fail = false;
  const layer = createImageryTileLayer({
    id: 'test-flaky',
    name: 'Test Flaky',
    credit: 'c',
    urlTemplate: 'https://tiles.example/a/{z}/{x}/{y}.png',
    updateInterval: 1000,
    eventTarget: null,
    source: {
      getSnapshot: async () => {
        if (fail) throw new Error('boom');
        return { template: 'https://tiles.example/a/{z}/{x}/{y}.png' };
      },
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(viewer.added.length, 1);
  fail = true;
  assert.equal(await layer.update(viewer), false);
  assert.equal(viewer.added.length, 0);
  assert.match(layer.getStats().error, /boom/);
  assert.equal(layer.getStats().frames, 0);
  layer.destroy(viewer);
});
