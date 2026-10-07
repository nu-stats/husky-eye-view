import { layerFeedState } from '../data/feedState.js';
export { layerFeedState } from '../data/feedState.js';
import { GUIDANCE_STATUSES } from '../loadingFeedback.js';
import { keySetupRequirement } from '../keySetupCore.mjs';
import { OWN_KEY_PROMPTS, openResearchKeyPrompt } from './researchKeyPrompt.js';
import {
  LAYER_GROUP_NOTES,
  LAYER_MANIFEST,
  RESEARCH_GROUP,
} from '../data/layerManifest.js';
import {
  applyLayerProfileClass,
  layerListedInProfile,
  readShowAllLayers,
  writeShowAllLayers,
} from './layerProfile.js';
const FEED_STATE_LABELS = Object.freeze({
  nominal: 'ON',
  loading: 'LOADING',
  degraded: 'DEGRADED',
  stale: 'STALE',
  partial: 'PARTIAL',
  fallback: 'FALLBACK',
  unavailable: 'UNAVAILABLE',
});

// Groups, their order and the rows in each come from the layer manifest
// (src/data/layerManifest.js), which lists layers in panel order: the
// project's research layers first, then the feeds inherited from God's Eye
// View. Presentation order is independent of catalog registration.
export const PANEL_GROUPS = Object.freeze(
  LAYER_MANIFEST.reduce((groups, entry) => {
    if (!entry.group) return groups;
    let group = groups.find(({ label }) => label === entry.group);
    if (!group) {
      group = { label: entry.group, ids: [] };
      groups.push(group);
    }
    group.ids.push(entry.id);
    return groups;
  }, []),
);
export const PANEL_ORDER = PANEL_GROUPS.flatMap(({ label, ids }) =>
  ids.map((id) => ({ id, label })),
);
const PANEL_POSITIONS = new Map(
  PANEL_ORDER.map(({ id }, index) => [id, index]),
);
const PANEL_LABELS = Object.fromEntries(
  LAYER_MANIFEST.filter((entry) => entry.label).map((entry) => [
    entry.id,
    entry.label,
  ]),
);

function panelLabel(layer) {
  return PANEL_LABELS[layer.id] || layer.name;
}

// View modes listed under Helicopters & Low Flyers (src/ui/cockpitGroundView.js).
const GROUND_VIEW_ROWS = Object.freeze([
  Object.freeze({
    mode: 'drone',
    icon: '✣',
    label: 'Drone View',
    meta: 'Fly 30–120 m up · W/S/A/D, Q/E height',
  }),
  // Walking View is switched off for now (2026-10-06): at eye level the
  // photorealistic tiles look melted. Set `off: false` to bring it back
  // (voice: gevActions.js start_ground_view).
  Object.freeze({
    mode: 'walk',
    icon: '⛶',
    label: 'Walking View',
    meta: 'Walk the street · W/S/A/D, drag to look',
    off: true,
  }),
]);

// Under HOLC: a lens onto today inside the 1930s map (src/ui/timeLens.js).
const TIME_LENS_ROW = Object.freeze({
  mode: 'time-lens',
  icon: '◎',
  label: 'Time Lens (1930s ↔ today)',
  meta: 'HOLC map with a movable window onto a layer of today',
  title:
    'Time Lens: the 1930s HOLC map, with today seen through a movable lens',
  event: 'gev:time-lens-open',
});

// The years a static dataset describes (manifest `vintage`), shown in its row
// instead of a "2m ago" refresh time that only means something for live feeds.
const DATA_VINTAGE = Object.fromEntries(
  LAYER_MANIFEST.filter((entry) => entry.vintage).map((entry) => [
    entry.id,
    entry.vintage,
  ]),
);
// Live layers whose ids share the local- prefix of the static datasets.
const LIVE_LOCAL_LAYERS = new Set(
  LAYER_MANIFEST.filter((entry) => entry.live).map((entry) => entry.id),
);

/** What the row says about how current the data is, or '' for none. */
function dataFreshness(layerId, ago) {
  if (DATA_VINTAGE[layerId]) return DATA_VINTAGE[layerId];
  const staticLayer =
    String(layerId).startsWith('local-') && !LIVE_LOCAL_LAYERS.has(layerId);
  return staticLayer ? '' : ago;
}

/**
 * Whether a layer is off and waiting on a key (a locked research dataset, or
 * a keyed feed that reported its key missing).
 * @param {object} layer Row from the layer manager's getAll().
 * @returns {boolean}
 */
export function layerIsLocked(layer) {
  return (
    !layer?.enabled &&
    layer?.stats?.keyRequired === true &&
    Boolean(layer?.requiresKeyId)
  );
}

/**
 * A layer icon is a text symbol, or `ms:<name>` for a Material Symbols glyph
 * (each such name must be in index.html's icon_names list).
 */
export function setLayerIcon(element, icon) {
  const glyph = /^ms:([a-z0-9_]+)$/.exec(String(icon || ''));
  element.classList.toggle('material-symbols-outlined', Boolean(glyph));
  element.textContent = glyph ? glyph[1] : icon || '';
}

/** Per-viewer convenience: which layer groups are folded away. */
const COLLAPSED_GROUPS_KEY = 'hev.layerGroupsCollapsed';

function readCollapsedGroups() {
  try {
    const raw = globalThis.localStorage?.getItem(COLLAPSED_GROUPS_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : null;
  } catch {
    return null;
  }
}

function writeCollapsedGroups(groups) {
  try {
    globalThis.localStorage?.setItem(
      COLLAPSED_GROUPS_KEY,
      JSON.stringify([...groups]),
    );
  } catch {
    /* storage unavailable: the fold simply is not remembered */
  }
}

/**
 * Guidance for a control a missing provider key is holding back.
 *
 * The key registry already owns what each key is called and which environment
 * variables enable it, so a layer only declares WHICH key it needs
 * (`requiresKeyId`) and reports `stats.keyRequired` while that key is absent.
 * Naming the variable turns an unexplained dead control into a next step.
 *
 * An unnamed or unknown key returns '' rather than guessing: guidance naming
 * the wrong variable sends the operator to the wrong provider.
 *
 * @param {object} [layer] Row from the layer manager's getAll().
 * @returns {string} Guidance text, or '' when no key guidance applies.
 */
export function layerKeyRequirementTooltip(layer = {}) {
  if (layer?.stats?.keyRequired !== true) return '';
  const requiresKeyId = String(layer.requiresKeyId || '').trim();
  return requiresKeyId ? keySetupRequirement(requiresKeyId) : '';
}

/** Layer row presentation over supplied state and actions; no layer imports. */
export class LayerPanel {
  constructor({
    getLayers,
    isEnabled,
    setEnabled,
    setLayerParams,
    getRowControls,
    hasRowControls,
    subscribeRowControls,
    onHiddenRefresh = () => {},
  }) {
    this.getAll = getLayers;
    this.isEnabled = isEnabled;
    this.setEnabled = setEnabled;
    this.setLayerParams = setLayerParams;
    this._rowControlsFor = getRowControls;
    this.hasRowControls = hasRowControls;
    this.subscribeRowControls = subscribeRowControls;
    this.onHiddenRefresh = onHiddenRefresh;
    this._generation = 0;
    this._removers = [];
    this._destroyed = false;
    // Panel-only view state: the search text and folded groups. A stored fold
    // wins; with none, groups without an active layer start folded.
    this._query = '';
    this._collapsedGroups = readCollapsedGroups();
    this._groups = new Map();
    this._onSignature = '';
  }
  mount(container) {
    if (this._destroyed) return;
    this._releaseBindings();
    this._toggleContainer = container;
    applyLayerProfileClass();
    this._renderToggles();
  }
  _bind(element, type, listener) {
    element.addEventListener(type, listener);
    this._removers.push(() => element.removeEventListener(type, listener));
  }
  _releaseBindings() {
    this._generation++;
    for (const remove of this._removers.splice(0)) remove();
  }
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._releaseBindings();
    this._onBadge?.remove();
    this._onBadge = null;
    this._toggleContainer = null;
  }

  /**
   * Search box, the "on now" strip of active layers, and the empty-search
   * message. Sticky at the top of the scrolling list.
   */
  _buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'data-panel-toolbar';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'data-search-input';
    input.placeholder = 'Find a layer';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Find a layer');
    input.value = this._query;
    this._bind(input, 'input', () => {
      this._query = input.value;
      this._applyFilter();
    });
    this._bind(input, 'keydown', (event) => {
      // Escape clears the search first; it only reaches the app's own
      // Escape handling once the box is empty.
      if (event.key !== 'Escape' || !input.value) return;
      input.value = '';
      this._query = '';
      this._applyFilter();
      event.stopPropagation();
    });
    const strip = document.createElement('div');
    strip.className = 'data-on-strip';
    strip.setAttribute('aria-label', 'Layers that are on');
    this._bind(strip, 'click', (event) => {
      const chip = event.target?.closest?.('.data-on-chip');
      if (chip) this._revealRow(chip.dataset.onLayer);
    });
    const empty = document.createElement('div');
    empty.className = 'data-search-empty';
    empty.hidden = true;
    toolbar.appendChild(input);
    toolbar.appendChild(strip);
    this._searchInput = input;
    this._stripEl = strip;
    this._emptyEl = empty;
    return { toolbar, empty };
  }

  /** "N ON" badge beside the panel title, visible even while it is folded. */
  _mountOnBadge() {
    const header = this._toggleContainer
      ?.closest?.('[data-panel-id]')
      ?.querySelector?.('.panel-header');
    const title = header?.querySelector?.('.panel-title');
    if (!title) return;
    if (!this._onBadge) {
      this._onBadge = document.createElement('span');
      this._onBadge.className = 'data-on-badge';
      this._onBadge.setAttribute('aria-live', 'polite');
    }
    title.after(this._onBadge);
  }

  _toggleGroup(group) {
    if (!this._collapsedGroups) this._collapsedGroups = new Set();
    if (this._collapsedGroups.has(group)) this._collapsedGroups.delete(group);
    else this._collapsedGroups.add(group);
    writeCollapsedGroups(this._collapsedGroups);
    this._applyFilter();
  }

  /** Show rows matching the search (and not folded away while not searching). */
  _applyFilter() {
    const query = this._query.trim().toLowerCase();
    let matches = 0;
    for (const [group, entry] of this._groups) {
      const folded = !query && Boolean(this._collapsedGroups?.has(group));
      const groupMatch = Boolean(query) && group.toLowerCase().includes(query);
      let visible = 0;
      for (const { row, label } of entry.rows) {
        const match = !query || groupMatch || label.includes(query);
        row.hidden = !match || folded;
        if (match) visible++;
      }
      matches += visible;
      entry.heading.hidden = visible === 0;
      entry.heading.setAttribute('aria-expanded', String(!folded));
      entry.heading.classList.toggle('folded', folded);
    }
    if (this._emptyEl) {
      this._emptyEl.hidden = matches > 0;
      this._emptyEl.textContent = query
        ? `No layer matches "${this._query.trim()}".`
        : '';
    }
  }

  /** Unfold, scroll to and briefly mark a layer's row (from the on-now strip). */
  _revealRow(layerId) {
    for (const [group, entry] of this._groups) {
      const item = entry.rows.find(
        ({ row }) => row.dataset.layerId === layerId,
      );
      if (!item) continue;
      if (this._collapsedGroups?.has(group)) this._toggleGroup(group);
      if (item.row.hidden) {
        this._query = '';
        if (this._searchInput) this._searchInput.value = '';
        this._applyFilter();
      }
      item.row.scrollIntoView?.({ block: 'nearest' });
      item.row.classList.toggle('data-row-flash', true);
      setTimeout(() => item.row.classList.toggle('data-row-flash', false), 900);
      return;
    }
  }

  /**
   * Mark rows that are on, count them per group and in the panel badge, and
   * list them in the on-now strip (rebuilt only when the set changes).
   */
  _syncOnState(layers = this.getAll()) {
    if (!this._toggleContainer) return;
    const on = [];
    const onByGroup = new Map();
    const lockedByGroup = new Map();
    for (const layer of layers) {
      if (!layer.showInTogglePanel) continue;
      const row = this._rows?.get(layer.id);
      if (!row) {
        // A layer the research profile left out was just switched on (voice,
        // a link): rebuild so it is listed and can be switched off again.
        if (layer.enabled && !this._profileRerenderQueued) {
          this._profileRerenderQueued = true;
          queueMicrotask(() => {
            this._profileRerenderQueued = false;
            this._renderToggles();
          });
        }
        continue;
      }
      row.classList.toggle('is-on', Boolean(layer.enabled));
      const locked = layerIsLocked(layer);
      row.classList.toggle('is-locked', locked);
      if (locked)
        lockedByGroup.set(
          row.dataset.group,
          (lockedByGroup.get(row.dataset.group) || 0) + 1,
        );
      if (!layer.enabled) continue;
      on.push(layer);
      const group = row.dataset.group;
      onByGroup.set(group, (onByGroup.get(group) || 0) + 1);
    }
    // A layer that turns on (by click, voice or a restored link) unfolds its
    // group so it is never switched on out of sight.
    const onIds = new Set(on.map((layer) => layer.id));
    if (this._lastOn) {
      let unfolded = false;
      for (const layer of on) {
        if (this._lastOn.has(layer.id)) continue;
        const group = this._rows?.get(layer.id)?.dataset.group;
        if (group && this._collapsedGroups?.delete(group)) unfolded = true;
      }
      if (unfolded) {
        writeCollapsedGroups(this._collapsedGroups);
        this._applyFilter();
      }
    }
    this._lastOn = onIds;
    for (const [group, entry] of this._groups) {
      const count = onByGroup.get(group) || 0;
      const locked = lockedByGroup.get(group) || 0;
      entry.count.textContent = [
        count ? `${count} on` : '',
        locked ? `${locked} locked` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (this._onBadge) {
      this._onBadge.textContent = on.length ? `${on.length} ON` : '';
      this._onBadge.hidden = on.length === 0;
    }
    const signature = on.map((layer) => layer.id).join('|');
    if (!this._stripEl || signature === this._onSignature) return;
    this._onSignature = signature;
    this._stripEl.textContent = '';
    for (const layer of on) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'data-on-chip';
      chip.dataset.onLayer = layer.id;
      chip.title = `${panelLabel(layer)} is on. Show its row.`;
      chip.textContent = panelLabel(layer);
      this._stripEl.appendChild(chip);
    }
    this._stripEl.hidden = on.length === 0;
  }

  _renderToggles() {
    if (this._destroyed || !this._toggleContainer) return;
    this._releaseBindings();
    this._toggleContainer.innerHTML = '';
    this._groups = new Map();
    this._rows = new Map();
    this._onSignature = '';
    this._lastOn = null;

    const generation = this._generation;
    const layers = this.getAll()
      .slice()
      .sort(
        (a, b) =>
          (PANEL_POSITIONS.get(a.id) ?? PANEL_ORDER.length) -
          (PANEL_POSITIONS.get(b.id) ?? PANEL_ORDER.length),
      );
    const { toolbar, empty } = this._buildToolbar();
    this._toggleContainer.appendChild(toolbar);
    this._mountOnBadge();
    const groupOf = (layer) =>
      PANEL_ORDER[PANEL_POSITIONS.get(layer.id)]?.label ?? 'Other layers';
    if (!this._collapsedGroups) {
      // First visit: fold every group that has nothing switched on.
      const active = new Set(
        layers.filter((layer) => layer.enabled).map(groupOf),
      );
      this._collapsedGroups = new Set(
        layers
          .map(groupOf)
          .filter((group) => !active.has(group) && group !== RESEARCH_GROUP),
      );
    }
    let previousGroup = '';
    const showAll = readShowAllLayers();
    for (const layer of layers) {
      if (!layer.showInTogglePanel) continue;
      if (!layerListedInProfile(layer, showAll)) continue;
      const group = groupOf(layer);
      if (previousGroup === RESEARCH_GROUP && group !== previousGroup) {
        this._toggleContainer.appendChild(this._buildCuratedRow());
        this._toggleContainer.appendChild(this._buildReportsRow());
      }
      if (group && group !== previousGroup) {
        const heading = document.createElement('button');
        heading.type = 'button';
        heading.className = 'data-layer-group-heading';
        heading.dataset.group = group;
        const label = document.createElement('span');
        label.className = 'data-group-label';
        label.textContent = group;
        const count = document.createElement('span');
        count.className = 'data-group-on';
        heading.appendChild(label);
        heading.appendChild(count);
        if (LAYER_GROUP_NOTES[group]) {
          const note = document.createElement('span');
          note.className = 'data-group-note';
          note.textContent = LAYER_GROUP_NOTES[group];
          heading.appendChild(note);
        }
        this._bind(heading, 'click', () => this._toggleGroup(group));
        this._toggleContainer.appendChild(heading);
        this._groups.set(group, { heading, count, rows: [] });
      }
      previousGroup = group;
      const row = document.createElement('div');
      row.className = 'data-toggle-row';
      row.dataset.layerId = layer.id;
      row.dataset.group = group;
      this._rows.set(layer.id, row);
      this._groups.get(group)?.rows.push({
        row,
        label: panelLabel(layer).toLowerCase(),
      });

      const topRow = document.createElement('div');
      topRow.className = 'data-toggle-top';

      const left = document.createElement('div');
      left.className = 'data-toggle-left';
      const icon = document.createElement('span');
      icon.className = 'data-icon';
      setLayerIcon(icon, layer.icon);
      const name = document.createElement('span');
      name.className = 'data-name';
      name.textContent = panelLabel(layer);
      left.appendChild(icon);
      left.appendChild(name);

      const right = document.createElement('div');
      right.className = 'data-toggle-right';

      const count = document.createElement('span');
      count.className = 'data-count';
      count.textContent = this._layerCountText(layer.stats);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `data-toggle-btn${layer.enabled ? ' active' : ''}`;
      this._syncToggleButton(toggle, layer);
      this._bind(toggle, 'click', async () => {
        // Native `disabled` immediately evicts keyboard focus in Chromium. Keep
        // the lifecycle control focusable while it is busy, and enforce the
        // same single-flight interaction contract through ARIA instead.
        if (
          this._destroyed ||
          this._generation !== generation ||
          toggle.getAttribute('aria-disabled') === 'true'
        )
          return;
        // A locked layer asks for its key instead: POWER UP when this server
        // offers it, otherwise a small built-in prompt (shared links, builds).
        const live = this.getAll().find(({ id }) => id === layer.id);
        if (live && layerIsLocked(live)) {
          const powerUp = document.getElementById('key-setup-chip');
          if (powerUp && !powerUp.hidden) {
            powerUp.click();
            // Open at this layer's own key field (it may be far down the list).
            const keyId = String(live.requiresKeyId || '');
            const later = globalThis.requestAnimationFrame || setTimeout;
            later(() => {
              const row =
                /^[\w-]+$/.test(keyId) &&
                document.querySelector(`[data-key-id="${keyId}"]`);
              row?.scrollIntoView({ block: 'center' });
              row?.querySelector('input')?.focus({ preventScroll: true });
            });
            return;
          }
          const saved = await openResearchKeyPrompt({
            layerName: panelLabel(live),
            ...OWN_KEY_PROMPTS[live.requiresKeyId],
          });
          if (!saved || this._destroyed || this._generation !== generation)
            return;
        }
        toggle.setAttribute('aria-disabled', 'true');
        toggle.setAttribute('aria-busy', 'true');
        try {
          await this.setEnabled(layer.id, !this.isEnabled(layer.id), {
            origin: 'user',
          });
        } catch (error) {
          console.warn(`[Data] ${layer.id} toggle error:`, error);
        } finally {
          const all = this.getAll();
          const current = all.find(({ id }) => id === layer.id);
          if (!this._destroyed && current && this._generation === generation) {
            this._syncToggleButton(toggle, current);
            this._syncOnState(all);
          }
        }
      });

      right.appendChild(count);
      right.appendChild(toggle);
      topRow.appendChild(left);
      topRow.appendChild(right);

      const bottomRow = document.createElement('div');
      bottomRow.className = 'data-toggle-meta';
      bottomRow.textContent = this._buildMetaText(layer);

      row.appendChild(topRow);
      row.appendChild(bottomRow);

      // Optional per-layer sub-controls (chips + color legend). The click
      // listener is delegated and attached once here, so it survives
      // _refreshTogglePanel — which only rewrites the container's contents.
      if (this.hasRowControls(layer.id)) {
        // A layer whose controls settle asynchronously (a chunked catalog load
        // that can also fail) pushes a re-render through this; nothing else
        // would repaint the row before its next scheduled refresh.
        const unsubscribe = this.subscribeRowControls(layer.id, () =>
          this._refreshTogglePanel(),
        );
        if (unsubscribe) this._removers.push(unsubscribe);
        const controls = document.createElement('div');
        controls.className = 'data-toggle-controls';
        this._bind(controls, 'click', (event) => {
          const button = event.target?.closest?.('.data-toggle-chip');
          if (!button || button.disabled) return;
          // Re-read the live descriptor rather than trusting the rendered
          // chip, so a stale row can never apply an inverted toggle.
          const chip = this._rowControlsFor(layer.id)?.chips?.find(
            (entry) => entry.id === button.dataset.chipId,
          );
          if (!chip || chip.disabled || !this.isEnabled(layer.id)) return;
          if (typeof chip.onClick === 'function') chip.onClick();
          else if (chip.params)
            this.setLayerParams(layer.id, chip.params, { origin: 'user' });
        });
        row.appendChild(controls);
        // An ordered list below the chips, for a layer whose row carries a
        // sequence (turn-by-turn directions). Its own delegated listener, its
        // own container — the chip row stays a chip row.
        const list = document.createElement('ol');
        list.className = 'data-row-list';
        list.hidden = true;
        this._bind(list, 'click', (event) => {
          const button = event.target?.closest?.('.data-row-list-item');
          if (!button || button.disabled) return;
          const item = this._rowControlsFor(layer.id)?.list?.items?.find(
            (entry) => entry.id === button.dataset.listItemId,
          );
          if (item?.params)
            this.setLayerParams(layer.id, item.params, { origin: 'user' });
        });
        row.appendChild(list);
        this._syncRowControls(controls, layer, list);
      }

      this._toggleContainer.appendChild(row);
      // Walking and Drone views ride with the low flyers: a lower,
      // user-driven look at the same layers. They are views, not data.
      if (layer.id === 'lowflyers') {
        for (const view of GROUND_VIEW_ROWS.filter((row) => !row.off))
          this._toggleContainer.appendChild(this._buildViewRow(view, group));
      }
      if (layer.id === 'local-holc-redlining')
        this._toggleContainer.appendChild(
          this._buildViewRow(TIME_LENS_ROW, group),
        );
    }
    if (previousGroup === RESEARCH_GROUP) {
      this._toggleContainer.appendChild(this._buildCuratedRow());
      this._toggleContainer.appendChild(this._buildReportsRow());
    }
    this._toggleContainer.appendChild(empty);
    this._toggleContainer.appendChild(this._buildProfileToggle(layers));
    this._applyFilter();
    this._syncOnState(layers);
  }

  /**
   * Research Data → Curated Flights: opens the city-comparison tour panel
   * (src/curated/curatedPanel.js). It has its own key, so it reads LOCKED
   * until that key is in this browser session.
   */
  _buildCuratedRow() {
    const group = RESEARCH_GROUP;
    const row = document.createElement('div');
    row.className = 'data-toggle-row data-view-row data-curated-row';
    row.dataset.group = group;
    this._groups.get(group)?.rows.push({ row, label: 'curated flights' });
    const top = document.createElement('div');
    top.className = 'data-toggle-top';
    const left = document.createElement('div');
    left.className = 'data-toggle-left';
    const icon = document.createElement('span');
    icon.className = 'data-icon';
    icon.textContent = '✈';
    const name = document.createElement('span');
    name.className = 'data-name';
    name.textContent = 'Curated Flights';
    left.append(icon, name);
    const right = document.createElement('div');
    right.className = 'data-toggle-right';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'data-toggle-btn data-view-start';
    open.setAttribute('aria-label', 'Open Curated Flights');
    // LOCKED until this session holds the Curated Flights key; POWER UP's
    // key-change event flips it without re-rendering the panel.
    const syncLock = () => {
      let hasKey = false;
      try {
        hasKey = Boolean(globalThis.sessionStorage?.getItem('hev.curatedKey'));
      } catch {
        hasKey = false;
      }
      open.textContent = hasKey ? 'OPEN' : 'LOCKED';
      open.title = hasKey
        ? 'Plan a tour comparing up to 3 cities'
        : 'Curated Flights needs its own key (POWER UP)';
    };
    syncLock();
    this._bind(window, 'hev:research-key-changed', syncLock);
    this._bind(open, 'click', () =>
      window.dispatchEvent(new CustomEvent('gev:curated-flights-open')),
    );
    right.appendChild(open);
    top.append(left, right);
    const meta = document.createElement('div');
    meta.className = 'data-toggle-meta';
    meta.textContent =
      'Tour up to 3 cities · 6 layers · report, data and charts';
    row.append(top, meta);
    return row;
  }

  /**
   * Research Data → Area Reports: rank counties, tracts or states by any
   * layer and save PDF / CSV / XLSX (src/reports/reportPanel.js). No key.
   */
  _buildReportsRow() {
    const group = RESEARCH_GROUP;
    const row = document.createElement('div');
    row.className =
      'data-toggle-row data-view-row data-curated-row data-reports-row';
    row.dataset.group = group;
    this._groups.get(group)?.rows.push({ row, label: 'area reports' });
    const top = document.createElement('div');
    top.className = 'data-toggle-top';
    const left = document.createElement('div');
    left.className = 'data-toggle-left';
    const icon = document.createElement('span');
    icon.className = 'data-icon';
    icon.textContent = '▤';
    const name = document.createElement('span');
    name.className = 'data-name';
    name.textContent = 'Area Reports';
    left.append(icon, name);
    const right = document.createElement('div');
    right.className = 'data-toggle-right';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'data-toggle-btn data-view-start';
    open.setAttribute('aria-label', 'Open Area Reports');
    open.textContent = 'OPEN';
    open.title = 'Rank counties, tracts or states by any layer';
    this._bind(open, 'click', () =>
      window.dispatchEvent(new CustomEvent('gev:area-reports-open')),
    );
    right.appendChild(open);
    top.append(left, right);
    const meta = document.createElement('div');
    meta.className = 'data-toggle-meta';
    meta.textContent = 'Rank areas by any layer · PDF, CSV and XLSX';
    row.append(top, meta);
    return row;
  }

  /** A row that starts a view mode (Walking / Drone) rather than a layer. */
  _buildViewRow(view, group) {
    const row = document.createElement('div');
    row.className = 'data-toggle-row data-view-row';
    row.dataset.viewMode = view.mode;
    row.dataset.group = group;
    this._groups.get(group)?.rows.push({
      row,
      label: view.label.toLowerCase(),
    });
    const top = document.createElement('div');
    top.className = 'data-toggle-top';
    const left = document.createElement('div');
    left.className = 'data-toggle-left';
    const icon = document.createElement('span');
    icon.className = 'data-icon';
    icon.textContent = view.icon;
    const name = document.createElement('span');
    name.className = 'data-name';
    name.textContent = view.label;
    left.append(icon, name);
    const right = document.createElement('div');
    right.className = 'data-toggle-right';
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'data-toggle-btn data-view-start';
    start.textContent = 'START';
    start.setAttribute('aria-label', `Start ${view.label}`);
    start.title =
      view.title || `${view.label}: click the map where you want to start`;
    this._bind(start, 'click', () =>
      window.dispatchEvent(
        new CustomEvent(view.event || 'gev:ground-view-request', {
          detail: { mode: view.mode },
        }),
      ),
    );
    right.appendChild(start);
    top.append(left, right);
    const meta = document.createElement('div');
    meta.className = 'data-toggle-meta';
    meta.textContent = view.meta;
    row.append(top, meta);
    return row;
  }

  /** "Show all layers" switch for the research profile (see layerProfile.js). */
  _buildProfileToggle(layers) {
    const showAll = readShowAllLayers();
    const hidden = layers.filter(
      (layer) =>
        layer.showInTogglePanel && !layerListedInProfile(layer, showAll),
    ).length;
    const label = document.createElement('label');
    label.className = 'data-profile-toggle';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = showAll;
    const text = document.createElement('span');
    text.textContent = showAll
      ? 'Show all layers (including God’s Eye View extras)'
      : `Show all layers (${hidden} more from God’s Eye View)`;
    label.appendChild(box);
    label.appendChild(text);
    this._bind(box, 'change', () => {
      writeShowAllLayers(box.checked);
      this._renderToggles();
    });
    return label;
  }

  /**
   * A layer that is on but drawn only closer in (tract layers from a national
   * view) says so plainly: a ZOOM IN badge in place of the count, and one
   * notice each time it is switched on out of range.
   */
  _syncZoomPrompt(row, count, layer) {
    const waiting =
      layer.enabled &&
      String(layer.stats?.status || '').toLowerCase() === 'zoom-in';
    row.classList.toggle('needs-zoom', waiting);
    if (waiting && count) count.textContent = 'ZOOM IN';
    this._zoomNoticed ||= new Set();
    if (!waiting) {
      this._zoomNoticed.delete(layer.id);
      return;
    }
    if (this._zoomNoticed.has(layer.id)) return;
    this._zoomNoticed.add(layer.id);
    const message = String(layer.stats?.statusMessage || 'zoom in to load')
      .replace(/ to load$/, ' to see it')
      .trim();
    window.dispatchEvent(
      new CustomEvent('gev:notice', {
        detail: { message: `${panelLabel(layer)}: ${message}.` },
      }),
    );
  }

  /** Qualify a loaded count when it does not mean items currently on screen. */
  _layerCountText(stats) {
    if (typeof stats.countLabel === 'string' && stats.countLabel.trim())
      return stats.countLabel;
    return stats.count ? this._formatCount(stats.count) : '—';
  }

  /**
   * Render a layer's row chips and color legend, and keep the whole block
   * hidden while the layer is off (or while a dependency owner has surrendered
   * it) so a quiet row stays quiet.
   *
   * Chip BUTTONS are reconciled in place, keyed by chip id, rather than
   * rebuilt: this runs on every panel refresh — including the one the chip's
   * own click triggers — and replacing the node would drop keyboard focus
   * mid-interaction. Legend entries hold no focus and no listeners, so they
   * are replaced freely.
   * @param {HTMLElement|null} container The row's `.data-toggle-controls` node.
   * @param {object} layer Registered layer entry.
   * @param {HTMLElement|null} [listContainer] The row's `.data-row-list` node.
   */
  _syncRowControls(container, layer, listContainer = null) {
    if (!container) return;
    const controls = layer.enabled ? this._rowControlsFor(layer.id) : null;
    const chips = controls?.chips || [];
    const legend = controls?.legend || [];
    this._syncRowList(listContainer, controls?.list || null);
    container.hidden = chips.length === 0 && legend.length === 0;

    for (const node of [...container.children]) {
      if (
        String(node.className).split(/\s+/).includes('data-toggle-legend-item')
      )
        node.remove();
    }

    const stale = new Map();
    for (const node of [...container.children]) {
      if (node.dataset?.chipId) stale.set(node.dataset.chipId, node);
    }

    for (const chip of chips) {
      let button = stale.get(chip.id);
      stale.delete(chip.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.chipId = chip.id;
        container.appendChild(button);
      }
      const state = chip.state || (chip.active ? 'active' : 'idle');
      button.className = `data-toggle-chip chip-${state}${chip.active ? ' active' : ''}`;
      if (button.textContent !== chip.label) button.textContent = chip.label;
      button.title = chip.title || '';
      button.disabled = Boolean(chip.disabled);
      button.setAttribute('aria-pressed', chip.active ? 'true' : 'false');
      button.setAttribute('aria-busy', chip.busy ? 'true' : 'false');
    }
    for (const node of stale.values()) node.remove();

    for (const item of legend) {
      const entry = document.createElement('span');
      entry.className = 'data-toggle-legend-item';
      if (item.blurb) entry.title = item.blurb;
      const swatch = document.createElement('span');
      swatch.className = 'data-toggle-legend-swatch';
      swatch.style.background = item.color;
      const text = document.createElement('span');
      text.textContent = `${item.label} ${this._formatCount(item.count)}`;
      entry.append(swatch, text);
      container.appendChild(entry);
    }
  }

  /**
   * Render a row's ordered list (turn-by-turn directions).
   *
   * Each entry is a real `<button>` inside a real `<li>`, so Tab reaches it and
   * Enter activates it with no key handling of our own, and the `<ol>` carries
   * the ordering a screen reader announces. Items are reconciled in place,
   * keyed by id, for the same reason chips are: this runs on every refresh —
   * including the one a click on the list triggers — and replacing the node
   * would drop keyboard focus mid-interaction.
   * @param {HTMLElement|null} container The row's `.data-row-list` node.
   * @param {{ariaLabel?: string, items?: Array<object>}|null} list Descriptor.
   */
  _syncRowList(container, list) {
    if (!container) return;
    const items = list?.items || [];
    container.hidden = items.length === 0;
    if (list?.ariaLabel) container.setAttribute('aria-label', list.ariaLabel);

    const stale = new Map();
    for (const node of [...container.children]) {
      if (node.dataset?.listItemId) stale.set(node.dataset.listItemId, node);
    }
    let previous = null;
    let activeButton = null;
    for (const item of items) {
      let entry = stale.get(item.id);
      stale.delete(item.id);
      let button;
      if (!entry) {
        entry = document.createElement('li');
        entry.dataset.listItemId = item.id;
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'data-row-list-item';
        button.dataset.listItemId = item.id;
        const lead = document.createElement('span');
        lead.className = 'data-row-list-lead';
        const text = document.createElement('span');
        text.className = 'data-row-list-text';
        button.append(lead, text);
        entry.appendChild(button);
      } else {
        button = entry.querySelector('.data-row-list-item');
      }
      // Keep DOM order in step with descriptor order without rebuilding.
      const anchor = previous ? previous.nextSibling : container.firstChild;
      if (entry !== anchor) container.insertBefore(entry, anchor);
      previous = entry;
      if (!button) continue;
      const lead = button.querySelector('.data-row-list-lead');
      const text = button.querySelector('.data-row-list-text');
      const leadText = String(item.lead ?? '');
      const bodyText = String(item.text ?? '');
      if (lead && lead.textContent !== leadText) lead.textContent = leadText;
      if (text && text.textContent !== bodyText) text.textContent = bodyText;
      button.disabled = Boolean(item.disabled);
      button.classList.toggle('note', Boolean(item.disabled));
      button.classList.toggle('active', Boolean(item.active));
      button.classList.toggle('current', Boolean(item.current));
      button.setAttribute('aria-current', item.current ? 'step' : 'false');
      button.setAttribute('aria-pressed', item.active ? 'true' : 'false');
      button.title = bodyText;
      if (item.current) activeButton = button;
    }
    for (const node of stale.values()) node.remove();
    // Follow the flight, but never steal a scroll the reader is making
    // themselves: only when the step actually changed.
    if (
      activeButton &&
      container.dataset.currentId !== activeButton.dataset.listItemId
    ) {
      container.dataset.currentId = activeButton.dataset.listItemId;
      activeButton.scrollIntoView?.({ block: 'nearest' });
    } else if (!activeButton) {
      delete container.dataset.currentId;
    }
  }

  _refreshTogglePanel() {
    if (this._destroyed || !this._toggleContainer) return;
    // Skip DOM churn while hidden; visibilitychange (main.js) triggers one
    // refresh on return. (perf wave 2)
    if (typeof document !== 'undefined' && document.hidden) {
      this.onHiddenRefresh();
      return;
    }
    const layers = this.getAll();
    this._syncOnState(layers);
    for (const layer of layers) {
      const row =
        this._rows?.get(layer.id) ||
        this._toggleContainer.querySelector(`[data-layer-id="${layer.id}"]`);
      if (!row) continue;

      const btn = row.querySelector('.data-toggle-btn');
      if (btn) {
        this._syncToggleButton(btn, layer);
      }

      const count = row.querySelector('.data-count');
      if (count) {
        count.textContent = this._layerCountText(layer.stats);
      }
      this._syncZoomPrompt(row, count, layer);

      const meta = row.querySelector('.data-toggle-meta');
      if (meta) {
        meta.textContent = this._buildMetaText(layer);
      }

      this._syncRowControls(
        row.querySelector('.data-toggle-controls'),
        layer,
        row.querySelector('.data-row-list'),
      );
    }
  }

  _buildMetaText(layer) {
    const stats = layer.stats || {};
    const feedState = layerFeedState(stats);
    const stateLabel = FEED_STATE_LABELS[feedState];
    const source = stats.source || layer.source;
    if (layerIsLocked(layer) && stats.statusMessage) {
      return `${source} · ${stats.statusMessage}`;
    }
    const lifecycleState =
      layer.lifecycleState || (layer.enabled ? 'enabled' : 'disabled');
    if (lifecycleState === 'enabling' || lifecycleState === 'disabling') {
      return `${lifecycleState.toUpperCase()} · ${source}`;
    }
    if (layer.lifecycleUncertain) {
      return `UNCERTAIN · ${source} · lifecycle state requires reconciliation`;
    }
    const presentedError =
      stats.error || stats.lastError || stats.managerRefreshError;
    if (presentedError) {
      if (typeof stats.retryInSec === 'number' && stats.retryInSec > 0) {
        return `${stateLabel} · ${source} · ${presentedError} · retry ${stats.retryInSec}s`;
      }
      return `${stateLabel} · ${source} · ${presentedError}`;
    }
    // A guidance status carries its prompt in `statusMessage`, not `error`, so
    // the row still tells the operator what to do without reporting a fault.
    if (
      GUIDANCE_STATUSES.includes(String(stats.status || '').toLowerCase()) &&
      typeof stats.statusMessage === 'string' &&
      stats.statusMessage.trim()
    ) {
      return `${source} · ${stats.statusMessage.trim()}`;
    }
    const ago = stats.lastUpdate ? this._timeAgo(stats.lastUpdate) : 'never';
    if (stats.loading) {
      const loadingLabel =
        typeof stats.loadingLabel === 'string' && stats.loadingLabel.trim()
          ? stats.loadingLabel.trim()
          : 'loading...';
      return `${source} · ${loadingLabel}`;
    }
    if (feedState === 'fallback') {
      const detail =
        typeof stats.loadingLabel === 'string' && stats.loadingLabel.trim()
          ? stats.loadingLabel.trim()
          : stats.coverage || ago;
      return `${stateLabel} · ${source} · ${detail}`;
    }
    if (feedState === 'partial') {
      const { acceptedRowCount, rawRowCount } = stats;
      const detail =
        Number.isInteger(acceptedRowCount) &&
        Number.isInteger(rawRowCount) &&
        acceptedRowCount >= 0 &&
        rawRowCount > acceptedRowCount
          ? `${acceptedRowCount} of ${rawRowCount} records accepted`
          : 'incomplete snapshot';
      return `${stateLabel} · ${source} · ${detail} · ${ago}`;
    }
    if (feedState === 'stale') {
      const retry =
        typeof stats.retryInSec === 'number' && stats.retryInSec > 0
          ? ` · retrying in ${stats.retryInSec}s`
          : '';
      return `${stateLabel} · ${source} · ${ago}${retry}`;
    }
    if (typeof stats.loadingLabel === 'string' && stats.loadingLabel.trim()) {
      return `${source} · ${stats.loadingLabel.trim()}`;
    }
    const freshness = dataFreshness(layer.id, ago);
    return freshness ? `${source} · ${freshness}` : source;
  }

  _syncToggleButton(button, layer) {
    const feedState = layer.enabled ? layerFeedState(layer.stats) : 'off';
    const transitioning =
      layer.lifecycleState === 'enabling' ||
      layer.lifecycleState === 'disabling';
    const uncertain = Boolean(layer.lifecycleUncertain);
    const locked = layerIsLocked(layer);
    button.classList.toggle('active', layer.enabled);
    button.classList.toggle('locked', locked);
    button.classList.toggle('transitioning', transitioning);
    button.classList.toggle('enabling', layer.lifecycleState === 'enabling');
    button.classList.toggle('disabling', layer.lifecycleState === 'disabling');
    button.classList.toggle('lifecycle-uncertain', uncertain);
    for (const state of Object.keys(FEED_STATE_LABELS)) {
      button.classList.toggle(
        `feed-${state}`,
        layer.enabled && !uncertain && feedState === state,
      );
    }
    button.dataset.feedState = transitioning
      ? layer.lifecycleState
      : uncertain
        ? 'uncertain'
        : feedState;
    // A busy toggle remains the keyboard focus owner. `aria-disabled` plus the
    // click guard above prevents repeat activation without the focus loss caused
    // by native `disabled`.
    button.disabled = false;
    button.setAttribute('aria-disabled', String(transitioning));
    button.setAttribute('aria-busy', String(transitioning));
    button.textContent = transitioning
      ? layer.lifecycleState.toUpperCase()
      : uncertain
        ? 'UNCERTAIN'
        : layer.enabled
          ? FEED_STATE_LABELS[feedState]
          : locked
            ? 'LOCKED'
            : 'OFF';
    const keyGuidance = layerKeyRequirementTooltip(layer);
    // Name the missing key on the control itself: a row reading KEY REQUIRED
    // without saying WHICH key leaves a dead control and no next step. Empty
    // when the layer needs no key, or already has one.
    button.title = keyGuidance;
    button.setAttribute(
      'aria-label',
      keyGuidance
        ? `${panelLabel(layer)}: ${button.textContent}. ${keyGuidance}`
        : `${panelLabel(layer)}: ${button.textContent}`,
    );
  }

  _formatCount(n) {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  }

  _timeAgo(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }
}
