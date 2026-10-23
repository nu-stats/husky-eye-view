/**
 * Menus on screen: which launchers the bottom rows and the dock show.
 *
 * Not every session needs every menu. The tune button in the top-center row
 * opens a short list: one switch per menu, and workspaces that set them all at
 * once (Research, Teach, Live world, Everything). A hidden menu gets the
 * `hev-menu-hidden` class (display: none); the bottom rows already skip a
 * launcher that is not displayed and close up the gap, so nothing else moves.
 *
 * Weather and Recent Imagery are not listed: they appear by themselves while
 * one of their layers is on. The choice is kept per browser (localStorage);
 * storage is best effort and the page works without it.
 */

export const MENU_HIDDEN_CLASS = 'hev-menu-hidden';
export const MENU_VISIBILITY_KEY = 'hev:menu-visibility:v1';

/** Every menu that can be hidden, in on-screen order. */
export const MENU_ITEMS = Object.freeze([
  Object.freeze({ id: 'data-panel', label: 'Data Layers' }),
  Object.freeze({ id: 'analysis-panel', label: 'Analysis' }),
  Object.freeze({ id: 'scene-panel', label: 'Scenes' }),
  Object.freeze({ id: 'location-bar', label: 'Location' }),
  Object.freeze({ id: 'control-panel', label: 'Visual Presets' }),
  Object.freeze({ id: 'pp-toggles', label: 'Display' }),
  Object.freeze({ id: 'cctv-panel', label: 'CCTV' }),
  Object.freeze({ id: 'global-context-panel', label: 'Context' }),
]);
const MENU_IDS = MENU_ITEMS.map(({ id }) => id);

/** One click sets every menu: the ones a kind of session uses. */
export const MENU_WORKSPACES = Object.freeze([
  Object.freeze({
    id: 'research',
    label: 'Research',
    title: 'Data Layers, Analysis and Location',
    shown: Object.freeze(['data-panel', 'analysis-panel', 'location-bar']),
  }),
  Object.freeze({
    id: 'teach',
    label: 'Teach',
    title: 'Data Layers, Scenes, Location and Display',
    shown: Object.freeze([
      'data-panel',
      'scene-panel',
      'location-bar',
      'pp-toggles',
    ]),
  }),
  Object.freeze({
    id: 'live',
    label: 'Live world',
    title: 'Data Layers, Location, Visual Presets, Display, CCTV and Context',
    shown: Object.freeze([
      'data-panel',
      'location-bar',
      'control-panel',
      'pp-toggles',
      'cctv-panel',
      'global-context-panel',
    ]),
  }),
  Object.freeze({
    id: 'all',
    label: 'Everything',
    title: 'Every menu',
    shown: Object.freeze([...MENU_IDS]),
  }),
]);

/** Known menu ids only, once each, in menu order. */
export function normalizeHiddenMenus(value) {
  const wanted = new Set(Array.isArray(value) ? value : []);
  return MENU_IDS.filter((id) => wanted.has(id));
}

/** The menus a workspace hides. */
export function workspaceHiddenMenus(workspaceId) {
  const workspace = MENU_WORKSPACES.find(({ id }) => id === workspaceId);
  if (!workspace) return [];
  return MENU_IDS.filter((id) => !workspace.shown.includes(id));
}

/** The workspace these hidden menus match, or 'custom'. */
export function matchingWorkspace(hidden) {
  const key = normalizeHiddenMenus(hidden).join(',');
  return (
    MENU_WORKSPACES.find(({ id }) => workspaceHiddenMenus(id).join(',') === key)
      ?.id || 'custom'
  );
}

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The workspace a browser starts with before anyone chooses menus. */
export const DEFAULT_WORKSPACE = 'research';

/**
 * The stored hidden menus: the default workspace's when nothing is stored,
 * none when storage fails (every menu stays reachable).
 */
export function readHiddenMenus(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(MENU_VISIBILITY_KEY);
    if (raw == null) return workspaceHiddenMenus(DEFAULT_WORKSPACE);
    return normalizeHiddenMenus(JSON.parse(raw)?.hidden);
  } catch {
    return [];
  }
}

/** Store the hidden menus; returns whether it was written. */
export function writeHiddenMenus(hidden, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      MENU_VISIBILITY_KEY,
      JSON.stringify({ hidden: normalizeHiddenMenus(hidden) }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Show and hide the menus. A menu that is open when it is hidden is closed
 * first (its own collapse button), so it does not come back open.
 */
export function applyHiddenMenus(hidden, documentRef = globalThis.document) {
  const set = new Set(normalizeHiddenMenus(hidden));
  for (const id of MENU_IDS) {
    const element = documentRef?.getElementById?.(id);
    if (!element) continue;
    const hide = set.has(id);
    if (hide && !element.classList.contains('collapsed'))
      element
        .querySelector(
          `[data-collapse-target="${id}"], [data-dock-toggle-target="${id}"]`,
        )
        ?.click?.();
    element.classList.toggle(MENU_HIDDEN_CLASS, hide);
  }
}

const node = (documentRef, tag, props = {}, children = []) => {
  const element = documentRef.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('aria-') || key === 'role')
      element.setAttribute(key, value);
    else element[key] = value;
  }
  element.append(...children);
  return element;
};

/**
 * Wire the tune button: a popover with the workspaces and one switch per menu.
 * @param {object} options
 * @param {HTMLElement|null} options.button The top-center tune button.
 * @param {Document} [options.documentRef]
 * @param {Storage|null} [options.storage] Injected for tests.
 * @param {{isEnabled: Function, setEnabled: Function}} [options.calm] The
 *   calm screen (src/ui/calmChrome.js): its switch joins the popover.
 * @param {() => void} [options.openKeys] Opens POWER UP (keys), which leaves
 *   the corner while the screen is calm.
 * @returns {{destroy: Function, setHidden: Function, getHidden: Function}}
 */
export function bindMenuCustomizer({
  button,
  documentRef = globalThis.document,
  storage,
  calm = null,
  openKeys = null,
} = {}) {
  let hidden = readHiddenMenus(storage);
  let sync = () => {};
  function setHidden(next) {
    hidden = normalizeHiddenMenus(next);
    applyHiddenMenus(hidden, documentRef);
    writeHiddenMenus(hidden, storage);
    sync();
  }
  applyHiddenMenus(hidden, documentRef);
  // A hidden menu that something opens (a first-run tile opening Context, a
  // Cameras layer opening CCTV) comes back on screen and stays.
  const reveal =
    typeof globalThis.MutationObserver === 'function'
      ? new globalThis.MutationObserver((records) => {
          for (const { target } of records) {
            if (
              hidden.includes(target.id) &&
              !target.classList.contains('collapsed')
            )
              setHidden(hidden.filter((id) => id !== target.id));
          }
        })
      : null;
  for (const { id } of MENU_ITEMS) {
    const element = documentRef?.getElementById?.(id);
    if (element)
      reveal?.observe(element, {
        attributes: true,
        attributeFilter: ['class'],
      });
  }
  if (!button || !documentRef?.body) {
    return {
      destroy() {},
      setHidden,
      getHidden: () => [...hidden],
    };
  }

  const workspaceButtons = new Map();
  const switches = new Map();
  const popover = node(documentRef, 'div', {
    id: 'menu-customize-popover',
    role: 'dialog',
    'aria-label': 'Menus on screen',
    hidden: true,
  });
  const status = node(documentRef, 'p', {
    className: 'menu-customize-note',
    textContent:
      'Weather and Recent Imagery appear by themselves while their layers are on.',
  });
  const workspaceRow = node(
    documentRef,
    'div',
    { className: 'menu-customize-workspaces', role: 'group' },
    MENU_WORKSPACES.map((workspace) => {
      const choice = node(documentRef, 'button', {
        type: 'button',
        className: 'menu-customize-workspace',
        textContent: workspace.label.toUpperCase(),
        title: workspace.title,
        dataset: { workspace: workspace.id },
      });
      choice.addEventListener('click', () =>
        setHidden(workspaceHiddenMenus(workspace.id)),
      );
      workspaceButtons.set(workspace.id, choice);
      return choice;
    }),
  );
  workspaceRow.setAttribute('aria-label', 'Workspaces');
  const list = node(
    documentRef,
    'div',
    { className: 'menu-customize-list' },
    MENU_ITEMS.map((item) => {
      const box = node(documentRef, 'input', {
        type: 'checkbox',
        dataset: { menu: item.id },
      });
      box.addEventListener('change', () => {
        const next = new Set(hidden);
        if (box.checked) next.delete(item.id);
        else next.add(item.id);
        setHidden([...next]);
      });
      switches.set(item.id, box);
      return node(documentRef, 'label', { className: 'menu-customize-item' }, [
        box,
        node(documentRef, 'span', { textContent: item.label }),
      ]);
    }),
  );
  const extras = [];
  if (calm) {
    const box = node(documentRef, 'input', { type: 'checkbox' });
    box.checked = calm.isEnabled();
    box.addEventListener('change', () => calm.setEnabled(box.checked));
    extras.push(
      node(
        documentRef,
        'label',
        { className: 'menu-customize-item menu-customize-calm' },
        [
          box,
          node(documentRef, 'span', {
            textContent:
              'Calm screen: fade the menus and shrink the title while I work',
          }),
        ],
      ),
    );
  }
  if (typeof openKeys === 'function') {
    const keys = node(documentRef, 'button', {
      type: 'button',
      className: 'menu-customize-keys',
      textContent: 'POWER UP · OPTIONAL KEYS',
    });
    keys.addEventListener('click', () => {
      setOpen(false);
      openKeys();
    });
    extras.push(keys);
  }
  popover.append(
    node(documentRef, 'div', {
      className: 'menu-customize-kicker',
      textContent: 'MENUS ON SCREEN',
    }),
    workspaceRow,
    list,
    status,
    ...extras,
  );
  documentRef.body.append(popover);

  sync = () => {
    const workspace = matchingWorkspace(hidden);
    for (const [id, choice] of workspaceButtons)
      choice.setAttribute('aria-pressed', String(id === workspace));
    for (const [id, box] of switches) box.checked = !hidden.includes(id);
    button.classList.toggle('menu-customize-custom', workspace === 'custom');
  };

  function setOpen(open) {
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      const rect = button.getBoundingClientRect();
      popover.style.top = `${Math.round(rect.bottom + 10)}px`;
      popover.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
      switches.values().next().value?.focus?.({ preventScroll: true });
    }
  }

  const onButton = () => setOpen(popover.hidden);
  const onDocumentDown = (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || button.contains(event.target)) return;
    setOpen(false);
  };
  const onKey = (event) => {
    if (event.key !== 'Escape' || popover.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setOpen(false);
    button.focus?.();
  };
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', popover.id);
  button.addEventListener('click', onButton);
  documentRef.addEventListener('pointerdown', onDocumentDown, true);
  documentRef.addEventListener('keydown', onKey, true);
  sync();

  return {
    setHidden,
    getHidden: () => [...hidden],
    destroy() {
      reveal?.disconnect();
      button.removeEventListener('click', onButton);
      documentRef.removeEventListener('pointerdown', onDocumentDown, true);
      documentRef.removeEventListener('keydown', onKey, true);
      popover.remove();
    },
  };
}
