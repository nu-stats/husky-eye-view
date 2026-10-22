import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_LENS_RADIUS,
  TIME_LENS_BASE_LAYER,
  TIME_LENS_CATALOG,
  TIME_LENS_LAYERS,
  TIME_LENS_SHAPES,
  TimeLens,
  chooseTimeLensSide,
  clampLensRadius,
  isTimeLensLayer,
  lensClipPath,
  swipeClipPath,
  timeLensLabel,
} from './timeLens.js';
import * as Cesium from 'cesium';
import { REGISTERED_LAYER_IDS } from '../data/layerState.js';

test('the lens clip path is a circle in whole pixels', () => {
  assert.equal(lensClipPath(452.4, 577.6, 215.2), 'circle(215px at 452px 578px)');
});

test('the swipe shows today right of the divider, in whole pixels and inside the window', () => {
  assert.deepEqual(TIME_LENS_SHAPES, ['circle', 'swipe']);
  assert.equal(swipeClipPath(1600, 0.5), 'inset(0px 0px 0px 800px)');
  assert.equal(swipeClipPath(1003, 0.3333), 'inset(0px 0px 0px 334px)');
  assert.equal(swipeClipPath(1600, -0.2), 'inset(0px 0px 0px 0px)');
  assert.equal(swipeClipPath(1600, 1.4), 'inset(0px 0px 0px 1600px)');
});

test('the lens radius stays between the minimum and 45% of the window', () => {
  assert.equal(clampLensRadius(10, 1200, 900), MIN_LENS_RADIUS);
  assert.equal(clampLensRadius(1000, 1200, 900), 405);
  assert.equal(clampLensRadius(200, 1200, 900), 200);
  // A tiny window still allows the minimum.
  assert.equal(clampLensRadius(500, 100, 100), MIN_LENS_RADIUS);
});

test('the lens shows registered layers of today over the HOLC map', () => {
  assert.equal(TIME_LENS_BASE_LAYER, 'local-holc-redlining');
  assert.ok(TIME_LENS_LAYERS.length >= 10);
  for (const [id, label] of TIME_LENS_LAYERS) {
    assert.ok(REGISTERED_LAYER_IDS.includes(id), id);
    assert.notEqual(id, TIME_LENS_BASE_LAYER);
    assert.equal(timeLensLabel(id), label);
  }
  assert.equal(TIME_LENS_LAYERS[0][0], 'local-acs-poverty');
  assert.equal(timeLensLabel('unknown-layer'), 'unknown-layer');
});

// ---------- the lens's lifecycle, with fake views ----------

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const flush = () => new Promise((done) => setTimeout(done, 0));

globalThis.window ??= {
  innerWidth: 1200,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document ??= { getElementById: () => null };

function fakeElement() {
  return {
    style: {},
    classList: { toggle() {} },
    setAttribute() {},
    remove() {
      this.removed = true;
    },
    textContent: '',
    hidden: false,
    value: '',
  };
}

function fakeSecondViewer() {
  const viewer = {
    destroyed: false,
    renders: 0,
    views: 0,
    primitives: [],
    scene: {
      requestRender: () => viewer.renders++,
      primitives: { add: (primitive) => viewer.primitives.push(primitive) },
      globe: { show: true },
    },
    camera: {
      setView: () => viewer.views++,
      frustum: { fov: 1, near: 1, far: 2 },
    },
    imageryLayers: { add() {} },
    isDestroyed: () => viewer.destroyed,
    destroy: () => (viewer.destroyed = true),
  };
  return viewer;
}

function fakeMainViewer() {
  return {
    camera: {
      positionWC: new Cesium.Cartesian3(1e6, 2e6, 3e6),
      directionWC: new Cesium.Cartesian3(0, 0, -1),
      upWC: new Cesium.Cartesian3(0, 1, 0),
      frustum: { fov: 1, near: 1, far: 1e9 },
    },
    scene: { postRender: new Cesium.Event() },
  };
}

/** Layer manager whose setEnabled(id) waits while `gates` holds that id. */
function fakeManager() {
  const enabled = new Set();
  const manager = {
    calls: [],
    gates: new Map(),
    isEnabled: (id) => enabled.has(id),
    async setEnabled(id, on) {
      manager.calls.push([id, on]);
      await manager.gates.get(id)?.promise;
      if (on) enabled.add(id);
      else enabled.delete(id);
    },
  };
  return manager;
}

/** TimeLens with the DOM and the second Cesium view replaced by fakes. */
class TestLens extends TimeLens {
  constructor({ realBaseMap = false, ...options } = {}) {
    const manager = fakeManager();
    super({
      viewer: fakeMainViewer(),
      readDataManager: () => manager,
      createLayers: () =>
        TIME_LENS_LAYERS.map(([id]) => ({
          id,
          enable: async () => {},
          disable() {},
          destroy() {},
        })),
      ...options,
    });
    this.manager = manager;
    this.realBaseMap = realBaseMap;
    this.viewers = [];
    this.listeners = 0;
  }

  buildDom(lens) {
    for (const key of ['root', 'bar', 'ring', 'select', 'todayLabel', 'hint'])
      lens[key] = fakeElement();
    lens.shapeButtons = { circle: fakeElement(), swipe: fakeElement() };
    // Stands in for the window listeners the real DOM adds.
    this.listeners++;
    lens.removers.push(() => this.listeners--);
    this.layout(lens);
  }

  buildViewer(lens) {
    lens.viewer2 = fakeSecondViewer();
    this.viewers.push(lens.viewer2);
  }

  async addBaseMap(lens) {
    if (this.realBaseMap) return super.addBaseMap(lens);
  }
}

test('the second view draws only when the main camera changed', async () => {
  const timeLens = new TestLens();
  await timeLens.open();
  const viewer2 = timeLens.viewers[0];
  const camera = timeLens.viewer.camera;
  const postRender = timeLens.viewer.scene.postRender;
  const renders = viewer2.renders;
  const views = viewer2.views;
  for (let frame = 0; frame < 30; frame++) postRender.raiseEvent();
  assert.equal(viewer2.renders, renders, 'a still camera asks for no redraw');
  assert.equal(viewer2.views, views);

  camera.positionWC = new Cesium.Cartesian3(1e6, 2e6, 3.1e6);
  postRender.raiseEvent();
  postRender.raiseEvent();
  assert.equal(viewer2.renders, renders + 1, 'a move draws once');

  camera.upWC = new Cesium.Cartesian3(0, 0.6, 0.8);
  postRender.raiseEvent();
  camera.frustum.fov = 0.8;
  postRender.raiseEvent();
  assert.equal(viewer2.renders, renders + 3, 'turning and zooming draw too');
  assert.equal(viewer2.camera.frustum.fov, 0.8);
  timeLens.destroy();
});

test('two quick opens build one second view', async () => {
  const timeLens = new TestLens();
  const holc = deferred();
  timeLens.manager.gates.set(TIME_LENS_BASE_LAYER, holc);
  const first = timeLens.open('local-acs-poverty');
  const second = timeLens.open('local-acs-income');
  holc.resolve();
  await Promise.all([first, second]);
  assert.equal(timeLens.viewers.length, 1);
  assert.equal(timeLens.listeners, 1);
  assert.equal(timeLens.viewer.scene.postRender.numberOfListeners, 1);
  assert.equal(timeLens.layerId, 'local-acs-income', 'the later choice wins');
  timeLens.close();
  assert.equal(timeLens.viewers[0].destroyed, true);
  assert.equal(timeLens.viewer.scene.postRender.numberOfListeners, 0);
  timeLens.destroy();
});

test('closing before the lens is built leaves nothing behind', async () => {
  const timeLens = new TestLens();
  const holc = deferred();
  timeLens.manager.gates.set(TIME_LENS_BASE_LAYER, holc);
  const opening = timeLens.open();
  timeLens.close();
  holc.resolve();
  await opening;
  await flush();
  assert.equal(timeLens.isOpen, false);
  assert.equal(timeLens.viewers.length, 0);
  assert.equal(timeLens.viewer.scene.postRender.numberOfListeners, 0);
  assert.equal(
    timeLens.manager.isEnabled(TIME_LENS_BASE_LAYER),
    false,
    'HOLC is put back off',
  );
  timeLens.destroy();
});

test('closing while the layer of today switches off outside adds no frame listener', async () => {
  const timeLens = new TestLens();
  await timeLens.manager.setEnabled('local-acs-poverty', true);
  const today = deferred();
  timeLens.manager.gates.set('local-acs-poverty', today);
  const opening = timeLens.open('local-acs-poverty');
  await flush();
  assert.equal(timeLens.viewers.length, 1, 'built, waiting in setLayer');
  timeLens.close();
  today.resolve();
  await opening;
  await flush();
  assert.equal(timeLens.viewers[0].destroyed, true);
  assert.equal(timeLens.listeners, 0);
  assert.equal(timeLens.viewer.scene.postRender.numberOfListeners, 0);
  assert.equal(timeLens.viewers[0].renders, 0, 'nothing drawn after close');
  timeLens.destroy();
});

test('a 3D tileset that finishes loading after close is destroyed', async () => {
  const original = Cesium.Cesium3DTileset.fromUrl;
  const loading = deferred();
  Cesium.Cesium3DTileset.fromUrl = () => loading.promise;
  globalThis.window.__godsEyeView = {
    tileset: { show: true, isDestroyed: () => false, resource: 'tiles.json' },
  };
  try {
    const timeLens = new TestLens({ realBaseMap: true });
    const opening = timeLens.open();
    await flush();
    timeLens.close();
    const tileset = { destroyed: false, destroy: () => (tileset.destroyed = true) };
    loading.resolve(tileset);
    await opening;
    assert.equal(tileset.destroyed, true);
    assert.equal(timeLens.viewers[0].primitives.length, 0);
    assert.equal(timeLens.viewer.scene.postRender.numberOfListeners, 0);
    assert.equal(timeLens.listeners, 0);
    timeLens.destroy();
  } finally {
    Cesium.Cesium3DTileset.fromUrl = original;
    delete globalThis.window.__godsEyeView;
  }
});

// ---------- choosing both layers ----------

test('either side can show every comparable layer, grouped by period, oldest first', () => {
  const ids = TIME_LENS_CATALOG.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length, 'no layer twice');
  for (const id of ids) assert.ok(REGISTERED_LAYER_IDS.includes(id), id);
  assert.ok(ids.includes(TIME_LENS_BASE_LAYER));
  for (const [id] of TIME_LENS_LAYERS) assert.ok(ids.includes(id), id);
  assert.ok(ids.includes('local-enumeration-districts-1930'));
  assert.ok(ids.includes('local-segregation-2000'));
  const periods = TIME_LENS_CATALOG.map(([, , period]) => period);
  assert.deepEqual([...new Set(periods)], ['1900–1940', '2000–2015', '2020–24']);
  assert.deepEqual(periods, [...periods].sort(), 'grouped, oldest first');
  assert.equal(timeLensLabel('local-holc-redlining'), 'HOLC redlining (1930s)');
  assert.equal(isTimeLensLayer('local-segregation-2010'), true);
  assert.equal(isTimeLensLayer('flights'), false);
});

test('picking the other side\'s layer swaps the two sides', () => {
  const now = { base: 'local-holc-redlining', inside: 'local-acs-poverty' };
  assert.deepEqual(chooseTimeLensSide(now, 'base', 'local-segregation-2000'), {
    base: 'local-segregation-2000',
    inside: 'local-acs-poverty',
  });
  assert.deepEqual(chooseTimeLensSide(now, 'base', 'local-acs-poverty'), {
    base: 'local-acs-poverty',
    inside: 'local-holc-redlining',
  });
  assert.deepEqual(chooseTimeLensSide(now, 'inside', 'local-holc-redlining'), {
    base: 'local-acs-poverty',
    inside: 'local-holc-redlining',
  });
});

test('the outside layer is the user\'s choice, and closing puts every layer back', async () => {
  const timeLens = new TestLens({
    createLayers: () =>
      TIME_LENS_CATALOG.map(([id]) => ({
        id,
        enable: async () => {},
        disable() {},
        destroy() {},
      })),
  });
  const { manager } = timeLens;
  // On before the lens: kept on afterwards.
  await manager.setEnabled('local-acs-income', true);
  await timeLens.open('local-acs-poverty');
  assert.equal(manager.isEnabled(TIME_LENS_BASE_LAYER), true, 'HOLC outside first');

  await timeLens.setBase('local-segregation-2000');
  assert.equal(timeLens.baseId, 'local-segregation-2000');
  assert.equal(manager.isEnabled('local-segregation-2000'), true);
  assert.equal(manager.isEnabled(TIME_LENS_BASE_LAYER), false, 'the old outside layer goes off');

  // Inside: a layer that was on in the main view goes off there while inside.
  await timeLens.setLayer('local-acs-income');
  assert.equal(manager.isEnabled('local-acs-income'), false);

  // Picking the outside layer for the inside swaps the sides.
  await timeLens.setLayer('local-segregation-2000');
  assert.equal(timeLens.layerId, 'local-segregation-2000');
  assert.equal(timeLens.baseId, 'local-acs-income');
  assert.equal(manager.isEnabled('local-acs-income'), true, 'now outside');
  assert.equal(manager.isEnabled('local-segregation-2000'), false, 'now inside');

  // A detail on the open event sets both sides of an open lens.
  await timeLens.open('local-acs-poverty', { baseId: TIME_LENS_BASE_LAYER });
  assert.equal(timeLens.baseId, TIME_LENS_BASE_LAYER);
  assert.equal(timeLens.layerId, 'local-acs-poverty');

  timeLens.close();
  await flush();
  assert.equal(manager.isEnabled(TIME_LENS_BASE_LAYER), false);
  assert.equal(manager.isEnabled('local-segregation-2000'), false);
  assert.equal(manager.isEnabled('local-acs-poverty'), false);
  assert.equal(manager.isEnabled('local-acs-income'), true, 'on before, on after');
  timeLens.destroy();
});
