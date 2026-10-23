/**
 * A calm screen while you work: the menus fade and the title plate shrinks to
 * its badge, so the map has the window.
 *
 * - Once the map has been used (a first click or scroll on it, so a new
 *   visitor sees every menu first), the bottom rows, the dock and the top
 *   buttons fade (body class `hev-chrome-faded`) while the map moves, or
 *   after FADE_AFTER_MS without using them. They come back while the pointer is near the top or bottom
 *   edge, a menu is open, the keyboard is in them, or the first-run card or
 *   the tune popover is up.
 * - The title plate shrinks to the husky-eye badge (`hev-title-compact`)
 *   after the first click or scroll on the map, or TITLE_COMPACT_AFTER_MS;
 *   hovering it shows the full name.
 * - POWER UP leaves the corner (`hev-calm`); the tune popover opens it.
 *
 * One switch turns all of it off (the tune popover); the choice is kept per
 * browser, best effort. Recording and clean view hide the interface anyway.
 */

export const CALM_KEY = 'hev:calm-ui:v1';
export const FADE_AFTER_MS = 6000;
export const TITLE_COMPACT_AFTER_MS = 45000;
/** The edge bands where the pointer brings the menus back, in pixels. */
export const NEAR_TOP_PX = 130;
export const NEAR_BOTTOM_PX = 190;

/** Panels whose open state keeps the menus up (open = not `.collapsed`). */
const PANEL_IDS = Object.freeze([
  'data-panel',
  'analysis-panel',
  'scene-panel',
  'pp-toggles',
  'cctv-panel',
  'global-context-panel',
  'weather-panel',
  'recent-imagery-panel',
  'location-bar',
  'control-panel',
]);
/** Containers that fade, and whose focus or hover keeps them up. */
const CHROME_IDS = Object.freeze([
  'left-panel-stack',
  'right-context-rail',
  'command-dock',
  'top-center-actions',
]);

/**
 * Whether the menus should be faded right now.
 * @param {{enabled: boolean, armed?: boolean, moving: boolean,
 *   idleMs: number, panelOpen: boolean, nearChrome: boolean,
 *   focusInChrome: boolean, fadeAfterMs?: number}} state `armed`: the map
 *   has been used at least once.
 */
export function shouldFade({
  enabled,
  armed = true,
  moving,
  idleMs,
  panelOpen,
  nearChrome,
  focusInChrome,
  fadeAfterMs = FADE_AFTER_MS,
}) {
  if (!enabled || !armed || panelOpen || nearChrome || focusInChrome)
    return false;
  return Boolean(moving) || idleMs >= fadeAfterMs;
}

/** Whether a pointer at `y` is in the top or bottom band of the window. */
export function nearChromeEdge(y, height) {
  if (!Number.isFinite(y) || !Number.isFinite(height)) return false;
  return y <= NEAR_TOP_PX || y >= height - NEAR_BOTTOM_PX;
}

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The stored choice; on unless it was switched off. */
export function readCalm(storage) {
  try {
    return resolveStorage(storage)?.getItem?.(CALM_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Store the choice; returns whether it was written. */
export function writeCalm(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(CALM_KEY, enabled ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the calm screen.
 * @param {object} options
 * @param {object} [options.viewer] The Cesium viewer (camera moves, canvas).
 * @param {Document} [options.documentRef]
 * @param {Window} [options.windowRef]
 * @param {Storage|null} [options.storage]
 * @param {() => number} [options.now]
 * @returns {{isEnabled: Function, setEnabled: Function, destroy: Function,
 *   refresh: Function}}
 */
export function bindCalmChrome({
  viewer = null,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  storage,
  now = () => Date.now(),
} = {}) {
  const body = documentRef?.body;
  let enabled = readCalm(storage);
  let moving = false;
  let armed = false;
  let lastUse = now();
  let pointer = { y: NaN };
  let destroyed = false;
  const removers = [];
  const listen = (target, type, listener, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener, options);
    removers.push(() => target.removeEventListener(type, listener, options));
  };

  const reducedMotion = () =>
    windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ===
    true;
  const byId = (id) => documentRef?.getElementById?.(id);
  const visible = (element) =>
    Boolean(element) && element.getClientRects?.().length > 0;
  const panelOpen = () =>
    PANEL_IDS.some((id) => {
      const panel = byId(id);
      return (
        panel &&
        !panel.hidden &&
        !panel.classList.contains('collapsed') &&
        visible(panel)
      );
    }) ||
    visible(byId('first-run-launcher')) ||
    byId('menu-customize-popover')?.hidden === false;
  const focusInChrome = () => {
    const active = documentRef?.activeElement;
    return (
      Boolean(active) && CHROME_IDS.some((id) => byId(id)?.contains(active))
    );
  };

  function refresh() {
    if (destroyed || !body) return;
    body.classList.toggle('hev-calm', enabled);
    body.classList.toggle('hev-calm-animate', enabled && !reducedMotion());
    if (!enabled) body.classList.remove('hev-title-compact');
    const fade = shouldFade({
      enabled,
      armed,
      moving,
      idleMs: now() - lastUse,
      panelOpen: panelOpen(),
      nearChrome: nearChromeEdge(pointer.y, windowRef?.innerHeight),
      focusInChrome: focusInChrome(),
    });
    body.classList.toggle('hev-chrome-faded', fade);
  }

  const used = () => {
    lastUse = now();
    refresh();
  };
  const compactTitle = () => {
    if (enabled && body) body.classList.add('hev-title-compact');
  };
  const firstUse = () => {
    armed = true;
    lastUse = now();
    compactTitle();
  };

  listen(
    documentRef,
    'pointermove',
    (event) => {
      pointer = { y: event.clientY };
      if (nearChromeEdge(event.clientY, windowRef?.innerHeight)) used();
      else refresh();
    },
    { passive: true },
  );
  // Leaving the window counts as away from the edges.
  listen(documentRef, 'pointerleave', () => {
    pointer = { y: NaN };
    refresh();
  });
  listen(documentRef, 'keydown', used, true);
  listen(documentRef, 'focusin', refresh);
  // The first real use of the map shrinks the title.
  const canvas = viewer?.scene?.canvas;
  listen(canvas, 'pointerdown', firstUse, { passive: true });
  listen(canvas, 'wheel', firstUse, { passive: true });
  const titleTimer = setTimeout(compactTitle, TITLE_COMPACT_AFTER_MS);
  removers.push(() => clearTimeout(titleTimer));
  const camera = viewer?.camera;
  const onMoveStart = () => {
    moving = true;
    refresh();
  };
  const onMoveEnd = () => {
    moving = false;
    refresh();
  };
  const removeStart = camera?.moveStart?.addEventListener?.(onMoveStart);
  const removeEnd = camera?.moveEnd?.addEventListener?.(onMoveEnd);
  if (removeStart) removers.push(removeStart);
  if (removeEnd) removers.push(removeEnd);
  // The idle fade and panel changes need no event of their own.
  const ticker = setInterval(refresh, 500);
  removers.push(() => clearInterval(ticker));
  refresh();

  return {
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = Boolean(next);
      writeCalm(enabled, storage);
      lastUse = now();
      refresh();
    },
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const remove of removers.splice(0)) remove();
      body?.classList.remove(
        'hev-calm',
        'hev-chrome-faded',
        'hev-title-compact',
      );
    },
  };
}
