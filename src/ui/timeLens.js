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
 *
 * SWIPE shows the two times across the whole window instead: 1930s HOLC left
 * of a full-height divider, the layer of today right of it (the shared
 * before/after divider, src/ui/imagerySplit.js). The map moves as usual under
 * it, and a click on the today side opens that layer's card.
 */
import * as Cesium from 'cesium';
import { createImagerySplit } from './imagerySplit.js';

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
/** The lens shapes: a movable circle, or a divider across the whole window. */
export const TIME_LENS_SHAPES = Object.freeze(['circle', 'swipe']);
const SHAPE_HINTS = Object.freeze({
  circle: 'drag to move · scroll to resize',
  swipe: 'drag the divider · the map moves as usual',
});

/** CSS clip-path for a lens centered at (x, y) with radius r, in pixels. */
export function lensClipPath(x, y, r) {
  return `circle(${Math.round(r)}px at ${Math.round(x)}px ${Math.round(y)}px)`;
}

/** CSS clip-path for the today side of the swipe: right of the divider. */
export function swipeClipPath(width, split) {
  const left = Math.round(Math.max(0, Math.min(1, split)) * width);
  return `inset(0px 0px 0px ${left}px)`;
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
    // The last shape chosen this session (the next lens opens with it).
    this.shape = 'circle';
    this.lens = null;
    this.removers = [];
    const onOpen = (event) => {
      const shape = event?.detail?.shape;
      if (TIME_LENS_SHAPES.includes(shape)) {
        if (this.lens) this.setShape(shape);
        else this.shape = shape;
      }
      return this.open(event?.detail?.layerId);
    };
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
    // A second open while the first is still building (a double click, voice
    // plus a click) waits for it instead of building a second view.
    if (this.opening) {
      await this.opening.promise;
      if (this.lens && layerId !== this.layerId) await this.setLayer(layerId);
      return;
    }
    if (this.lens) return this.setLayer(layerId);
    const opening = { cancelled: false };
    this.opening = opening;
    opening.promise = this.build(layerId, opening);
    try {
      await opening.promise;
    } finally {
      if (this.opening === opening) this.opening = null;
    }
  }

  async build(layerId, opening) {
    this.layerId = layerId;
    const manager = this.readDataManager?.();
    const restore = {
      holc: Boolean(manager?.isEnabled?.(TIME_LENS_BASE_LAYER)),
      today: new Map(),
    };
    await manager?.setEnabled?.(TIME_LENS_BASE_LAYER, true, {
      origin: 'time-lens',
    });
    if (opening.cancelled) {
      // Closed before anything was built: only HOLC needs putting back.
      if (!restore.holc)
        manager?.setEnabled?.(TIME_LENS_BASE_LAYER, false, {
          origin: 'time-lens',
        });
      return;
    }
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
    this.setShape(this.shape);
    await this.addBaseMap(lens);
    if (this.lens !== lens) return;
    await this.setLayer(layerId);
    if (this.lens !== lens) return;
    this.sync(lens);
    this.showToast(
      lens.shape === 'swipe'
        ? 'Time Lens: the 1930s HOLC map left of the divider, today right of it. Drag the divider.'
        : 'Time Lens: the 1930s HOLC map outside, today inside. Drag to move, scroll to resize, or choose SWIPE.',
    );
  }

  /** Switch the lens between the movable circle and the full-window swipe. */
  setShape(shape) {
    if (!TIME_LENS_SHAPES.includes(shape)) shape = 'circle';
    this.shape = shape;
    const lens = this.lens;
    if (!lens) return;
    lens.shape = shape;
    const swipe = shape === 'swipe';
    for (const [name, button] of Object.entries(lens.shapeButtons))
      button.setAttribute('aria-pressed', String(name === shape));
    lens.hint.textContent = SHAPE_HINTS[shape];
    lens.root.classList.toggle('time-lens--swipe', swipe);
    lens.ring.hidden = swipe;
    if (swipe && !lens.split) {
      lens.split = createImagerySplit({
        parent: document.body,
        initialValue: lens.splitValue ?? 0.5,
        id: 'time-lens-split-line',
        handleClass: 'time-lens-split-handle',
        cssProperty: '--time-lens-split',
        beforeLabel: '1930s HOLC',
        afterLabel: `TODAY · ${timeLensLabel(this.layerId)}`,
        ariaLabel: 'Time Lens divider: 1930s HOLC left, today right',
        formatValueText: (before, after) =>
          `1930s HOLC ${before} percent, today ${after} percent`,
        onChange: (value) => {
          lens.splitValue = value;
          this.layout(lens);
        },
      });
    } else if (!swipe && lens.split) {
      lens.splitValue = lens.split.getValue();
      lens.split.destroy();
      lens.split = null;
    }
    this.layout(lens);
  }

  close() {
    if (this.opening) {
      this.opening.cancelled = true;
      this.opening = null;
    }
    const lens = this.lens;
    if (!lens) return;
    this.lens = null;
    lens.split?.destroy();
    lens.split = null;
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
    lens.shapeButtons = {};
    const shapes = element(
      'span',
      {
        className: 'time-lens-shapes',
        role: 'group',
        ariaLabel: 'Lens shape',
      },
      TIME_LENS_SHAPES.map((shape) => {
        const button = element('button', {
          type: 'button',
          className: 'time-lens-shape',
          textContent: shape === 'swipe' ? 'SWIPE' : 'CIRCLE',
          title:
            shape === 'swipe'
              ? 'Divide the whole window: 1930s HOLC left, today right'
              : 'A movable circle onto today',
        });
        button.addEventListener('click', () => this.setShape(shape));
        lens.shapeButtons[shape] = button;
        return button;
      }),
    );
    lens.hint = element('span', { className: 'time-lens-hint' });
    lens.bar = element('div', { className: 'time-lens-bar' }, [
      element('span', {
        className: 'curated-kicker',
        textContent: 'TIME LENS',
      }),
      element('span', {
        className: 'time-lens-key',
        textContent: '1930s HOLC · Today:',
      }),
      lens.select,
      shapes,
      lens.hint,
      close,
    ]);
    document.body.append(lens.bar);

    // CIRCLE: drag inside the lens to move it, scroll to resize it.
    // SWIPE: the today side keeps the mouse, so a click opens that layer's
    // card (a click the main map also saw would close it again). A drag, any
    // other button and the wheel are handed to the main map, which takes the
    // pointer over (Cesium captures it) and moves as usual.
    let drag = null;
    const toMap = (type, event, extra = {}) => {
      const canvas = this.viewer?.canvas;
      if (!canvas) return;
      const init = {
        bubbles: true,
        cancelable: true,
        clientX: extra.clientX ?? event.clientX,
        clientY: extra.clientY ?? event.clientY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      };
      canvas.dispatchEvent(
        type === 'wheel'
          ? new WheelEvent('wheel', {
              ...init,
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              deltaMode: event.deltaMode,
            })
          : new PointerEvent(type, {
              ...init,
              pointerId: event.pointerId,
              pointerType: event.pointerType || 'mouse',
              isPrimary: event.isPrimary,
              button: event.button,
              buttons: event.buttons,
            }),
      );
    };
    const onDown = (event) => {
      if (lens.shape === 'swipe') {
        if (event.button !== 0) {
          toMap('pointerdown', event);
          return;
        }
        drag = { swipe: true, x: event.clientX, y: event.clientY, event };
        return;
      }
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
      if (drag.swipe) {
        // From here on the map has the pointer: press where the drag began.
        const press = drag.event;
        drag = null;
        toMap('pointerdown', press);
        toMap('pointermove', event);
        return;
      }
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
      if (lens.shape === 'swipe') {
        toMap('wheel', event);
        return;
      }
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
    lens.root.addEventListener('contextmenu', (event) => {
      if (lens.shape === 'swipe') event.preventDefault();
    });
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
    if (lens.shape === 'swipe') {
      lens.root.style.clipPath = swipeClipPath(
        window.innerWidth,
        lens.split?.getValue() ?? 0.5,
      );
      return;
    }
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
        const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, {
          showCreditsOnScreen: false,
        });
        if (this.lens !== lens || lens.viewer2.isDestroyed()) {
          // Closed while it loaded: nothing else will ever destroy it.
          tileset.destroy();
          return;
        }
        lens.tileset = tileset;
        scene.primitives.add(tileset);
        scene.globe.show = false;
        return;
      } catch (error) {
        console.warn('[time-lens] 3D tiles unavailable, using imagery:', error);
        if (this.lens !== lens) return;
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
    const after = document
      .getElementById('time-lens-split-line')
      ?.querySelector('.after');
    if (after) after.textContent = lens.todayLabel.textContent;
    const manager = this.readDataManager?.();
    // Outside the lens only HOLC shows: switch the chosen layer off there.
    if (manager?.isEnabled?.(layerId)) {
      if (!lens.restore.today.has(layerId))
        lens.restore.today.set(layerId, true);
      await manager.setEnabled(layerId, false, { origin: 'time-lens' });
      if (this.lens !== lens) return;
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
    // Closed while it was enabling: close() already destroyed the layers and
    // the second view, so there is nothing left to draw.
    if (this.lens !== lens) return;
    lens.viewer2.scene.requestRender();
  }

  /**
   * Follow the main camera whenever the main view draws. The main view can
   * draw 30 times a second with the camera still (flights, wind), so the
   * second view is only told to draw when the camera actually changed. Tiles
   * still loading need no help: Cesium redraws a request-render scene itself
   * when a tile request or decode finishes. Moving, resizing or reshaping the
   * lens only changes its CSS clip, so it needs no redraw either.
   */
  sync(lens) {
    if (this.lens !== lens || lens.viewer2.isDestroyed()) return;
    const last = {
      position: new Cesium.Cartesian3(),
      direction: new Cesium.Cartesian3(),
      up: new Cesium.Cartesian3(),
      fov: undefined,
      near: undefined,
      far: undefined,
      copied: false,
    };
    const copy = () => {
      if (this.lens !== lens || lens.viewer2.isDestroyed()) return;
      const from = this.viewer.camera;
      const position = from.positionWC;
      const direction = from.directionWC;
      const up = from.upWC;
      const frustum = from.frustum;
      if (
        last.copied &&
        Cesium.Cartesian3.equals(position, last.position) &&
        Cesium.Cartesian3.equals(direction, last.direction) &&
        Cesium.Cartesian3.equals(up, last.up) &&
        frustum?.fov === last.fov &&
        frustum?.near === last.near &&
        frustum?.far === last.far
      )
        return;
      Cesium.Cartesian3.clone(position, last.position);
      Cesium.Cartesian3.clone(direction, last.direction);
      Cesium.Cartesian3.clone(up, last.up);
      last.fov = frustum?.fov;
      last.near = frustum?.near;
      last.far = frustum?.far;
      last.copied = true;
      const to = lens.viewer2.camera;
      to.setView({
        destination: Cesium.Cartesian3.clone(position),
        orientation: {
          direction: Cesium.Cartesian3.clone(direction),
          up: Cesium.Cartesian3.clone(up),
        },
      });
      if (frustum?.fov && to.frustum) {
        to.frustum.fov = frustum.fov;
        to.frustum.near = frustum.near;
        to.frustum.far = frustum.far;
      }
      lens.viewer2.scene.requestRender();
    };
    lens.removers.push(this.viewer.scene.postRender.addEventListener(copy));
    copy();
  }
}
