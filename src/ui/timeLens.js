/**
 * Time Lens: the 1930s HOLC redlining map everywhere, with a movable circular
 * window onto a layer of today (tract poverty, income, segregation…), like
 * looking into another time from inside this one.
 *
 * How: the main view draws HOLC. A second, input-less Cesium view is stacked
 * just above the main canvas, follows the main camera every frame, draws the
 * same base map plus the chosen layer of today, and is clipped to a circle
 * with CSS (clip-path also limits where it takes pointer events). Inside the
 * circle: drag to move it, scroll to resize it, click an area for its card.
 */
import * as Cesium from 'cesium';

export const TIME_LENS_OPEN_EVENT = 'gev:time-lens-open';
export const TIME_LENS_BASE_LAYER = 'local-holc-redlining';
/** Layers of today offered inside the lens (first = default). */
export const TIME_LENS_LAYERS = Object.freeze([
  ['local-acs-poverty', 'Poverty (2020–24)'],
  ['local-acs-income', 'Median household income (2020–24)'],
  ['local-acs-unemployment', 'Unemployment (2020–24)'],
  ['local-acs-education', "Bachelor's degree or higher (2020–24)"],
  ['local-acs-renters', 'Renter-occupied homes (2020–24)'],
  ['local-acs-black', 'Black residents (2020–24)'],
  ['local-acs-hispanic', 'Hispanic or Latino residents (2020–24)'],
  ['local-acs-no-vehicle', 'Households without a vehicle (2020–24)'],
  ['local-acs-broadband', 'Broadband at home (2020–24)'],
  ['local-life-expectancy', 'Life expectancy (2010–15)'],
  ['local-air-pm25', 'PM2.5 air pollution (2021)'],
  ['local-park-access', 'Park access (2020)'],
  ['local-segregation-2024', 'Segregation by city (2020–24)'],
]);
const ESRI_IMAGERY =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
export const MIN_LENS_RADIUS = 60;
const DRAG_THRESHOLD_PX = 4;

/** CSS clip-path for a lens centered at (x, y) with radius r, in pixels. */
export function lensClipPath(x, y, r) {
  return `circle(${Math.round(r)}px at ${Math.round(x)}px ${Math.round(y)}px)`;
}

/** Radius kept between the minimum and 45% of the smaller window side. */
export function clampLensRadius(r, width, height) {
  const max = Math.max(MIN_LENS_RADIUS, Math.min(width, height) * 0.45);
  return Math.min(max, Math.max(MIN_LENS_RADIUS, r));
}

/** The label of a lens layer id (or the id itself). */
export function timeLensLabel(layerId) {
  return TIME_LENS_LAYERS.find(([id]) => id === layerId)?.[1] || layerId;
}

const element = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'ariaLabel') node.setAttribute('aria-label', value);
    else node[key] = value;
  }
  node.append(...children);
  return node;
};

export class TimeLens {
  /**
   * @param {object} options
   * @param {Cesium.Viewer} options.viewer The main viewer.
   * @param {() => object} options.readDataManager The app's layer manager.
   * @param {(message: string) => void} [options.showToast]
   * @param {(services: object) => object[]} [options.createLayers] Builds
   *   the research layers for the lens's own viewer (the app's
   *   createInfrastructureLayers, given by the composition layer).
   */
  constructor({
    viewer,
    readDataManager,
    showToast = () => {},
    createLayers = () => [],
  }) {
    Object.assign(this, { viewer, readDataManager, showToast, createLayers });
    this.layerId = TIME_LENS_LAYERS[0][0];
    this.lens = null;
    this.removers = [];
    const onOpen = (event) => this.open(event?.detail?.layerId);
    window.addEventListener(TIME_LENS_OPEN_EVENT, onOpen);
    this.removers.push(() =>
      window.removeEventListener(TIME_LENS_OPEN_EVENT, onOpen),
    );
  }

  get isOpen() {
    return Boolean(this.lens);
  }

  /** Open the lens (or switch its layer when it is already open). */
  async open(layerId = this.layerId) {
    if (!TIME_LENS_LAYERS.some(([id]) => id === layerId))
      layerId = TIME_LENS_LAYERS[0][0];
    if (this.lens) return this.setLayer(layerId);
    this.layerId = layerId;
    const manager = this.readDataManager?.();
    const restore = {
      holc: Boolean(manager?.isEnabled?.(TIME_LENS_BASE_LAYER)),
      today: new Map(),
    };
    await manager?.setEnabled?.(TIME_LENS_BASE_LAYER, true, {
      origin: 'time-lens',
    });
    const lens = (this.lens = {
      restore,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      r: clampLensRadius(
        Math.min(window.innerWidth, window.innerHeight) * 0.22,
        window.innerWidth,
        window.innerHeight,
      ),
      removers: [],
    });
    this.buildDom(lens);
    this.buildViewer(lens);
    await this.addBaseMap(lens);
    await this.setLayer(layerId);
    this.sync(lens);
    this.showToast(
      'Time Lens: the 1930s HOLC map outside, today inside. Drag to move, scroll to resize.',
    );
  }

  close() {
    const lens = this.lens;
    if (!lens) return;
    this.lens = null;
    for (const remove of lens.removers.splice(0)) remove();
    for (const layer of lens.layers || []) {
      try {
        layer.destroy?.();
      } catch {
        /* already gone */
      }
    }
    if (!lens.viewer2?.isDestroyed?.()) lens.viewer2?.destroy();
    lens.root.remove();
    lens.bar.remove();
    const manager = this.readDataManager?.();
    if (!lens.restore.holc)
      manager?.setEnabled?.(TIME_LENS_BASE_LAYER, false, {
        origin: 'time-lens',
      });
    for (const [id, on] of lens.restore.today)
      if (on) manager?.setEnabled?.(id, true, { origin: 'time-lens' });
  }

  destroy() {
    this.close();
    for (const remove of this.removers.splice(0)) remove();
  }

  // ---------- DOM ----------

  buildDom(lens) {
    lens.root = element('div', { id: 'time-lens', className: 'time-lens' });
    lens.canvasHost = element('div', { className: 'time-lens-view' });
    lens.ring = element('div', { className: 'time-lens-ring' }, [
      (lens.todayLabel = element('span', { className: 'time-lens-today' })),
      element('span', {
        className: 'time-lens-then',
        textContent: '1930s HOLC',
      }),
    ]);
    lens.root.append(lens.canvasHost);
    // The ring sits outside the clipped view so it can draw past its edge.
    document.body.append(lens.root, lens.ring);
    lens.removers.push(() => lens.ring.remove());

    lens.select = element('select', {
      className: 'time-lens-select',
      ariaLabel: 'Layer of today inside the lens',
    });
    for (const [id, label] of TIME_LENS_LAYERS)
      lens.select.append(element('option', { value: id, textContent: label }));
    lens.select.addEventListener('change', () =>
      this.setLayer(lens.select.value),
    );
    const close = element('button', {
      type: 'button',
      className: 'curated-button time-lens-close',
      textContent: 'CLOSE',
    });
    close.addEventListener('click', () => this.close());
    lens.bar = element('div', { className: 'time-lens-bar' }, [
      element('span', {
        className: 'curated-kicker',
        textContent: 'TIME LENS',
      }),
      element('span', {
        className: 'time-lens-key',
        textContent: 'Outside: 1930s HOLC · Inside:',
      }),
      lens.select,
      element('span', {
        className: 'time-lens-hint',
        textContent: 'drag to move · scroll to resize',
      }),
      close,
    ]);
    document.body.append(lens.bar);

    // Move: drag inside the lens. Resize: scroll inside it. A click without
    // a drag still reaches the lens view, so its areas open their cards.
    let drag = null;
    const onDown = (event) => {
      if (event.button !== 0) return;
      drag = {
        x: event.clientX,
        y: event.clientY,
        lx: lens.x,
        ly: lens.y,
        moved: false,
      };
    };
    const onMove = (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      lens.x = Math.min(window.innerWidth, Math.max(0, drag.lx + dx));
      lens.y = Math.min(window.innerHeight, Math.max(0, drag.ly + dy));
      this.layout(lens);
    };
    const onUp = () => {
      drag = null;
    };
    const onWheel = (event) => {
      event.preventDefault();
      lens.r = clampLensRadius(
        lens.r - event.deltaY * 0.25,
        window.innerWidth,
        window.innerHeight,
      );
      this.layout(lens);
    };
    const onResize = () => {
      lens.r = clampLensRadius(lens.r, window.innerWidth, window.innerHeight);
      this.layout(lens);
    };
    const onKey = (event) => {
      if (event.key === 'Escape' && this.lens === lens) this.close();
    };
    lens.root.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    lens.root.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    lens.removers.push(() => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    });
    this.layout(lens);
  }

  layout(lens) {
    lens.root.style.clipPath = lensClipPath(lens.x, lens.y, lens.r);
    Object.assign(lens.ring.style, {
      left: `${lens.x - lens.r}px`,
      top: `${lens.y - lens.r}px`,
      width: `${lens.r * 2}px`,
      height: `${lens.r * 2}px`,
    });
  }

  // ---------- the second view ----------

  buildViewer(lens) {
    lens.credits = element('div', { className: 'time-lens-credits' });
    lens.root.append(lens.credits);
    lens.viewer2 = new Cesium.Viewer(lens.canvasHost, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: false,
      creditContainer: lens.credits,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    });
    const scene = lens.viewer2.scene;
    scene.screenSpaceCameraController.enableInputs = false;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    if (scene.skyBox) scene.skyBox.show = false;
  }

  /** The same base map as the main view: photorealistic tiles or imagery. */
  async addBaseMap(lens) {
    const scene = lens.viewer2.scene;
    const main = globalThis.window?.__godsEyeView?.tileset;
    if (main && main.show && !main.isDestroyed?.()) {
      try {
        const resource = main.resource?.clone?.() || main.resource;
        lens.tileset = await Cesium.Cesium3DTileset.fromUrl(resource, {
          showCreditsOnScreen: false,
        });
        if (this.lens !== lens) return;
        scene.primitives.add(lens.tileset);
        scene.globe.show = false;
        return;
      } catch (error) {
        console.warn('[time-lens] 3D tiles unavailable, using imagery:', error);
      }
    }
    scene.globe.show = true;
    lens.viewer2.imageryLayers.add(
      Cesium.ImageryLayer.fromProviderAsync(
        Cesium.ArcGisMapServerImageryProvider.fromUrl(ESRI_IMAGERY),
      ),
    );
  }

  /** Show `layerId` inside the lens (and keep it out of the main view). */
  async setLayer(layerId) {
    const lens = this.lens;
    if (!lens) return;
    this.layerId = layerId;
    lens.select.value = layerId;
    lens.todayLabel.textContent = `TODAY · ${timeLensLabel(layerId)}`;
    const manager = this.readDataManager?.();
    // Outside the lens only HOLC shows: switch the chosen layer off there.
    if (manager?.isEnabled?.(layerId)) {
      if (!lens.restore.today.has(layerId))
        lens.restore.today.set(layerId, true);
      await manager.setEnabled(layerId, false, { origin: 'time-lens' });
    }
    lens.active?.disable?.();
    if (!lens.layers) {
      const viewer2 = lens.viewer2;
      // Clicked areas open the app's normal details card.
      lens.layers = this.createLayers({
        governorRequestRender: () => viewer2.scene.requestRender(),
      });
    }
    lens.active = lens.layers.find((layer) => layer.id === layerId) || null;
    await lens.active?.enable?.(lens.viewer2);
    lens.viewer2.scene.requestRender();
  }

  /** Follow the main camera every frame the main view draws. */
  sync(lens) {
    const copy = () => {
      if (this.lens !== lens || lens.viewer2.isDestroyed()) return;
      const from = this.viewer.camera;
      const to = lens.viewer2.camera;
      to.setView({
        destination: from.positionWC.clone(),
        orientation: {
          direction: from.directionWC.clone(),
          up: from.upWC.clone(),
        },
      });
      if (from.frustum?.fov && to.frustum) {
        to.frustum.fov = from.frustum.fov;
        to.frustum.near = from.frustum.near;
        to.frustum.far = from.frustum.far;
      }
      lens.viewer2.scene.requestRender();
    };
    lens.removers.push(this.viewer.scene.postRender.addEventListener(copy));
    copy();
  }
}
