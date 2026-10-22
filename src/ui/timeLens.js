/**
 * Time Lens: one layer everywhere (by default the 1930s HOLC redlining map),
 * with a movable circular window onto another (by default tract poverty
 * today), like looking into another time from inside this one. Both layers
 * are the user's choice, from TIME_LENS_CATALOG, in the bar's two pickers;
 * picking the other side's layer swaps the two.
 *
 * How: the main view draws the outside layer. A second, input-less Cesium
 * view is stacked just above the main canvas, follows the main camera, draws
 * the same base map plus the inside layer, and is clipped to a circle with
 * CSS (clip-path also limits where it takes pointer events). Inside the
 * circle: drag to move it, scroll to resize it, click an area for its card.
 *
 * SWIPE shows the two layers across the whole window instead: the outside
 * layer left of a full-height divider, the inside layer right of it (the
 * shared before/after divider, src/ui/imagerySplit.js). The map moves as
 * usual under it, and a click on the right side opens that layer's card.
 */
import * as Cesium from 'cesium';
import { createImagerySplit } from './imagerySplit.js';

export const TIME_LENS_OPEN_EVENT = 'gev:time-lens-open';
/** The default outside layer (left of the swipe): the 1930s HOLC map. */
export const TIME_LENS_BASE_LAYER = 'local-holc-redlining';
/** Earlier layers, offered on both sides with the layers of today. */
export const TIME_LENS_EARLIER_LAYERS = Object.freeze([
  ['local-holc-redlining', 'HOLC redlining (1930s)', '1900–1940'],
  [
    'local-enumeration-districts-1900',
    'Enumeration districts (1900)',
    '1900–1940',
  ],
  [
    'local-enumeration-districts-1910',
    'Enumeration districts (1910)',
    '1900–1940',
  ],
  [
    'local-enumeration-districts-1920',
    'Enumeration districts (1920)',
    '1900–1940',
  ],
  [
    'local-enumeration-districts-1930',
    'Enumeration districts (1930)',
    '1900–1940',
  ],
  ['local-segregation-2000', 'Segregation by city (2000)', '2000–2015'],
  ['local-segregation-2010', 'Segregation by city (2010)', '2000–2015'],
]);
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

/**
 * Every layer either side can show, grouped by period for the pickers:
 * `[id, label, period]`, oldest first.
 */
export const TIME_LENS_CATALOG = Object.freeze([
  ...TIME_LENS_EARLIER_LAYERS,
  ...TIME_LENS_LAYERS.map(([id, label]) =>
    Object.freeze([
      id,
      label,
      id === 'local-life-expectancy' ? '2000–2015' : '2020–24',
    ]),
  ).sort((a, b) => (a[2] === b[2] ? 0 : a[2] < b[2] ? -1 : 1)),
]);

/** Whether a layer id can be shown on either side of the lens. */
export function isTimeLensLayer(layerId) {
  return TIME_LENS_CATALOG.some(([id]) => id === layerId);
}

/** The label of a lens layer id (or the id itself). */
export function timeLensLabel(layerId) {
  return TIME_LENS_CATALOG.find(([id]) => id === layerId)?.[1] || layerId;
}

/**
 * The two layers after choosing `layerId` for one side: picking the layer the
 * other side shows swaps them, so the two sides never show the same layer.
 * @param {{base: string, inside: string}} current
 * @param {'base'|'inside'} side
 * @param {string} layerId
 * @returns {{base: string, inside: string}}
 */
export function chooseTimeLensSide(current, side, layerId) {
  const other = side === 'base' ? 'inside' : 'base';
  const next = { ...current, [side]: layerId };
  if (current[other] === layerId) next[other] = current[side];
  return next;
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
    // The outside layer (left of the swipe), shown by the main view.
    this.baseId = TIME_LENS_BASE_LAYER;
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
      return this.open(event?.detail?.layerId, {
        baseId: event?.detail?.baseId,
      });
    };
    window.addEventListener(TIME_LENS_OPEN_EVENT, onOpen);
    this.removers.push(() =>
      window.removeEventListener(TIME_LENS_OPEN_EVENT, onOpen),
    );
  }

  get isOpen() {
    return Boolean(this.lens);
  }

  /**
   * Open the lens (or switch its layers when it is already open).
   * @param {string} [layerId] The inside layer (right of the swipe).
   * @param {{baseId?: string}} [options] The outside layer (left).
   */
  async open(layerId = this.layerId, { baseId } = {}) {
    if (!isTimeLensLayer(layerId)) layerId = TIME_LENS_LAYERS[0][0];
    // A second open while the first is still building (a double click, voice
    // plus a click) waits for it instead of building a second view.
    if (this.opening) {
      await this.opening.promise;
      if (this.lens && isTimeLensLayer(baseId)) await this.setBase(baseId);
      if (this.lens && layerId !== this.layerId) await this.setLayer(layerId);
      return;
    }
    if (this.lens) {
      if (isTimeLensLayer(baseId)) await this.setBase(baseId);
      return this.setLayer(layerId);
    }
    if (isTimeLensLayer(baseId)) this.baseId = baseId;
    if (this.baseId === layerId)
      this.baseId =
        layerId === TIME_LENS_BASE_LAYER
          ? TIME_LENS_LAYERS[0][0]
          : TIME_LENS_BASE_LAYER;
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
    const baseId = this.baseId;
    const manager = this.readDataManager?.();
    const restore = {
      // Outside layers the lens switched on, by whether they were on before.
      base: new Map([[baseId, Boolean(manager?.isEnabled?.(baseId))]]),
      // Inside layers the lens switched off in the main view (to put back).
      today: new Map(),
    };
    await manager?.setEnabled?.(baseId, true, {
      origin: 'time-lens',
    });
    if (opening.cancelled) {
      // Closed before anything was built: only the outside layer needs
      // putting back.
      this.restoreBase(restore, manager);
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
    const outside = timeLensLabel(this.baseId);
    const inside = timeLensLabel(this.layerId);
    this.showToast(
      lens.shape === 'swipe'
        ? `Time Lens: ${outside} left of the divider, ${inside} right of it. Drag the divider, or pick other layers in the bar.`
        : `Time Lens: ${outside} outside, ${inside} inside. Drag to move, scroll to resize, pick other layers in the bar, or choose SWIPE.`,
    );
  }

  /** Put the outside layers back as they were before the lens. */
  restoreBase(restore, manager = this.readDataManager?.()) {
    for (const [id, wasOn] of restore.base)
      if (!wasOn) manager?.setEnabled?.(id, false, { origin: 'time-lens' });
  }

  /** Name both sides in the ring, the divider and the pickers. */
  refreshLabels(lens = this.lens) {
    if (!lens) return;
    const outside = timeLensLabel(this.baseId);
    const inside = timeLensLabel(this.layerId);
    lens.select.value = this.layerId;
    if (lens.baseSelect) lens.baseSelect.value = this.baseId;
    lens.todayLabel.textContent = inside.toUpperCase();
    if (lens.thenLabel) lens.thenLabel.textContent = outside.toUpperCase();
    const line = document.getElementById?.('time-lens-split-line');
    const before = line?.querySelector?.('.before');
    const after = line?.querySelector?.('.after');
    if (before) before.textContent = outside.toUpperCase();
    if (after) after.textContent = inside.toUpperCase();
  }

  /**
   * Show `baseId` outside the lens (left of the swipe), in the main view.
   * Choosing the inside layer swaps the two sides.
   */
  async setBase(baseId) {
    const lens = this.lens;
    if (!lens || !isTimeLensLayer(baseId) || baseId === this.baseId) {
      this.refreshLabels(lens);
      return;
    }
    const next = chooseTimeLensSide(
      { base: this.baseId, inside: this.layerId },
      'base',
      baseId,
    );
    const previous = this.baseId;
    const manager = this.readDataManager?.();
    this.baseId = next.base;
    if (!lens.restore.base.has(next.base))
      lens.restore.base.set(
        next.base,
        Boolean(manager?.isEnabled?.(next.base)) ||
          lens.restore.today.get(next.base) === true,
      );
    // The old outside layer goes off unless it was on before the lens (or it
    // is about to move inside, where setLayer switches it off anyway).
    if (lens.restore.base.get(previous) === false)
      await manager?.setEnabled?.(previous, false, { origin: 'time-lens' });
    if (this.lens !== lens) return;
    await manager?.setEnabled?.(next.base, true, { origin: 'time-lens' });
    if (this.lens !== lens) return;
    if (next.inside !== this.layerId) await this.setLayer(next.inside);
    else this.refreshLabels(lens);
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
    if (lens.outsideKey)
      lens.outsideKey.textContent = swipe ? 'Left:' : 'Outside:';
    if (lens.insideKey)
      lens.insideKey.textContent = swipe ? 'Right:' : 'Inside:';
    lens.root.classList.toggle('time-lens--swipe', swipe);
    lens.ring.hidden = swipe;
    if (swipe && !lens.split) {
      lens.split = createImagerySplit({
        parent: document.body,
        initialValue: lens.splitValue ?? 0.5,
        id: 'time-lens-split-line',
        handleClass: 'time-lens-split-handle',
        cssProperty: '--time-lens-split',
        beforeLabel: timeLensLabel(this.baseId).toUpperCase(),
        afterLabel: timeLensLabel(this.layerId).toUpperCase(),
        ariaLabel:
          'Time Lens divider: the outside layer left, the inside layer right',
        formatValueText: (before, after) =>
          `${timeLensLabel(this.baseId)} ${before} percent, ${timeLensLabel(this.layerId)} ${after} percent`,
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
    this.restoreBase(lens.restore, manager);
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
      (lens.thenLabel = element('span', { className: 'time-lens-then' })),
    ]);
    lens.root.append(lens.canvasHost);
    // The ring sits outside the clipped view so it can draw past its edge.
    document.body.append(lens.root, lens.ring);
    lens.removers.push(() => lens.ring.remove());

    // One picker per side, every comparable layer grouped by period.
    const picker = (ariaLabel) => {
      const select = element('select', {
        className: 'time-lens-select',
        ariaLabel,
      });
      const groups = new Map();
      for (const [id, label, period] of TIME_LENS_CATALOG) {
        if (!groups.has(period)) {
          const group = element('optgroup', { label: period });
          groups.set(period, group);
          select.append(group);
        }
        groups
          .get(period)
          .append(element('option', { value: id, textContent: label }));
      }
      return select;
    };
    lens.baseSelect = picker('Outside the lens, left of the divider');
    lens.baseSelect.addEventListener('change', () =>
      this.setBase(lens.baseSelect.value),
    );
    lens.select = picker('Inside the lens, right of the divider');
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
              ? 'Divide the whole window: the outside layer left, the inside layer right'
              : 'A movable circle onto the inside layer',
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
      (lens.outsideKey = element('span', { className: 'time-lens-key' })),
      lens.baseSelect,
      (lens.insideKey = element('span', { className: 'time-lens-key' })),
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
    // The outside layer chosen for the inside: the two sides swap.
    if (layerId === this.baseId && layerId !== this.layerId)
      return this.setBase(this.layerId);
    this.layerId = layerId;
    this.refreshLabels(lens);
    const manager = this.readDataManager?.();
    // Outside the lens only the outside layer shows: switch the chosen layer
    // off there.
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
