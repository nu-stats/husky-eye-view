import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  ARC_CAPS,
  DEFAULT_ARC_CAP,
  DEFAULT_VIEW_ID,
  MIGRATION_FLOWS_LAYER_ID,
  US_ISO3,
  VIEWS,
  analystRows,
  buildViewArcs,
  countryCard,
  nearestPoint,
  selectTopArcs,
  usCard,
  validateBundle,
  viewDefinition,
  viewLegend,
  vintageText,
  wrapCardLines,
} from './model.js';
import { ANCHOR_HEIGHT_M, createFlowRenderer } from './render.js';

export * from './model.js';

// Resolved when read, so importing this module never needs a module URL.
function bundledDataUrl() {
  return new URL(
    '../../data/local_data/migration_flows/us-migration-flows.json',
    import.meta.url,
  ).href;
}

const CARD_ACCENT = '#ffd166';

/**
 * Migration & Refugee Flows: arcs between the United States and every other
 * country for one of four views (immigrants by country of birth, refugees and
 * asylum-seekers by origin, refugees resettled, remittances sent from the
 * US). Width and colour follow the size of each flow; only the largest are
 * drawn unless the row asks for all. Clicking a country or an arc opens a card
 * with the number, its year and source.
 *
 * Adapted from uxhimanshuk/ground-view (MIT), src/layers/arcs/index.js and
 * the refugees, migrantStock and remittances layers.
 *
 * @param {object} options
 * @param {object} options.overlayHost World overlay host (setEntries,
 *   clearSource, setVisible).
 * @param {Function} [options.screenSpaceEventHandlerFactory] canvas -> handler.
 * @param {Function} [options.fetchImpl] fetch(url, init).
 * @param {string} [options.dataUrl] Where the bundled table is served.
 * @param {Function} [options.createRenderer] Renderer factory (tests).
 */
export function createMigrationFlowsLayer({
  overlayHost,
  screenSpaceEventHandlerFactory = null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  dataUrl = null,
  createRenderer = createFlowRenderer,
} = {}) {
  if (!overlayHost) throw new TypeError('Migration flows need an overlay host');
  const id = MIGRATION_FLOWS_LAYER_ID;
  const renderer = createRenderer();
  let viewer = null;
  let handler = null;
  let enabled = false;
  let bundle = null;
  let loading = null;
  let error = null;
  let lastUpdate = null;
  let viewId = DEFAULT_VIEW_ID;
  let cap = DEFAULT_ARC_CAP;
  let model = null;
  let shown = [];
  let selected = null;
  let rowControlsListener = null;

  const notifyRowControls = () => {
    try {
      rowControlsListener?.();
    } catch {
      // The panel re-renders on its own cadence too.
    }
  };

  async function loadBundle() {
    if (bundle) return bundle;
    if (!loading) {
      loading = (async () => {
        const response = await fetchImpl(dataUrl || bundledDataUrl(), {
          cache: 'force-cache',
        });
        if (!response.ok)
          throw new Error(`Migration flows data HTTP ${response.status}`);
        const json = validateBundle(await response.json());
        if (!json) throw new Error('Malformed migration flows data');
        bundle = json;
        return bundle;
      })().finally(() => {
        loading = null;
      });
    }
    return loading;
  }

  function clearCard() {
    overlayHost.clearSource(id);
    viewer?.scene?.requestRender?.();
  }

  function publishCard(iso3) {
    const card =
      iso3 === US_ISO3 ? usCard(model, shown.length) : countryCard(model, iso3);
    const position =
      iso3 === US_ISO3 ? renderer.nodePosition(US_ISO3) : renderer.anchor(iso3);
    if (!card || !position) return false;
    const details = [
      ...card.lines.flatMap((line) => wrapCardLines(line)),
      ...wrapCardLines(model.definition.caveat),
    ];
    overlayHost.setEntries(
      id,
      [
        {
          id: `flow:${viewId}:${iso3}`,
          position,
          variant: 'card',
          title: card.title,
          details,
          accent: CARD_ACCENT,
          selected: true,
          protected: true,
          priority: 1000,
          collisionGroup: 'ambient-card',
          zIndex: 40,
          interactive: false,
          edgeFade: 'keyhole',
          horizonCull: true,
          terrainOcclusion: false,
          gapPx: 15,
          placement: 'above',
        },
      ],
      { cohortLimit: 4, collisionCapacity: 4, moving: false },
    );
    viewer?.scene?.requestRender?.();
    return true;
  }

  function redraw() {
    model = bundle ? buildViewArcs(bundle, viewId) : null;
    shown = model ? selectTopArcs(model.arcs, cap) : [];
    // A selection that is no longer drawn has nothing to anchor its card.
    if (
      selected &&
      selected !== US_ISO3 &&
      !shown.some((a) => a.iso3 === selected)
    )
      selected = null;
    renderer.draw(shown, {
      bins: model?.definition.bins || [],
      usPoint: model?.usPoint,
      selectedIso3: selected,
      show: enabled,
    });
    if (selected && enabled) publishCard(selected);
    else clearCard();
    notifyRowControls();
  }

  function select(iso3) {
    selected = iso3 || null;
    redraw();
  }

  function onClick(click) {
    if (!isPointerFree() || !enabled || !viewer || !model) return;
    const node = renderer.nearestNode(click.position);
    if (node) {
      select(node === selected ? null : node);
      return;
    }
    const arc = renderer.pickedArc(viewer.scene.pick(click.position));
    if (arc) {
      select(arc === selected ? null : arc);
      return;
    }
    // A click on the globe near a drawn country selects it.
    const ray = viewer.camera.getPickRay(click.position);
    const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
    const carto = hit && Cesium.Cartographic.fromCartesian(hit);
    if (!carto) return;
    const points = [
      { iso3: US_ISO3, ...model.usPoint },
      ...shown.map((a) => ({
        iso3: a.iso3,
        ...(a.from === model.usPoint ? a.to : a.from),
      })),
    ];
    const near = nearestPoint(
      points,
      Cesium.Math.toDegrees(carto.longitude),
      Cesium.Math.toDegrees(carto.latitude),
    );
    if (near) select(near === selected ? null : near);
    else if (selected) select(null);
  }

  function setView(next) {
    if (!viewDefinition(next) || next === viewId) return;
    viewId = next;
    redraw();
  }

  function cycleCap() {
    const index = ARC_CAPS.indexOf(cap);
    cap = ARC_CAPS[(index + 1) % ARC_CAPS.length];
    redraw();
  }

  return {
    id,
    name: 'Migration & Refugee Flows',
    icon: '⤳',
    source: 'UN DESA / UNHCR / World Bank',
    updateInterval: 0,
    statsRefreshInterval: 1000,

    init(nextViewer) {
      viewer = nextViewer;
      renderer.attach(viewer);
      overlayHost.setVisible(id, false);
      if (!handler && screenSpaceEventHandlerFactory && viewer?.scene?.canvas) {
        handler = screenSpaceEventHandlerFactory(viewer.scene.canvas);
        handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
      return true;
    },

    async enable() {
      enabled = true;
      overlayHost.setVisible(id, true);
      renderer.setVisible(true);
      return true;
    },

    async update() {
      if (!enabled) return true;
      try {
        await loadBundle();
        if (!enabled) return true;
        error = null;
        lastUpdate = Date.now();
        redraw();
      } catch (failure) {
        error = failure?.message || String(failure);
        notifyRowControls();
      }
      return true;
    },

    disable() {
      enabled = false;
      selected = null;
      renderer.setVisible(false);
      clearCard();
      overlayHost.setVisible(id, false);
      notifyRowControls();
      return true;
    },

    destroy() {
      enabled = false;
      handler?.destroy?.();
      handler = null;
      renderer.destroy();
      overlayHost.clearSource(id);
      overlayHost.setVisible(id, false);
      viewer = null;
      model = null;
      shown = [];
      selected = null;
    },

    getStats() {
      return {
        count: shown.length,
        ...(model && {
          countLabel: `${shown.length} of ${model.arcs.length}`,
        }),
        lastUpdate,
        error,
        ...(loading && { loading: true, loadingLabel: 'loading flows...' }),
      };
    },

    getRowControls() {
      const years = bundle?.views || {};
      const chips = VIEWS.map((view) => ({
        id: `view-${view.id}`,
        label: years[view.id]
          ? `${view.chip} ${years[view.id].year}`
          : view.chip,
        title: years[view.id]
          ? `${view.valueLabel}, ${vintageText(years[view.id])} (${view.shortSource})`
          : view.valueLabel,
        active: view.id === viewId,
        onClick: () => setView(view.id),
      }));
      chips.push({
        id: 'arc-cap',
        label: cap == null ? 'All countries' : `Top ${cap}`,
        title: 'How many of the largest flows to draw (click to change)',
        active: false,
        onClick: cycleCap,
      });
      const info = model
        ? `${model.definition.valueLabel}, ${vintageText(model.view)}. ${model.definition.caveat}`
        : '';
      return {
        chips,
        legend: enabled ? viewLegend(model, shown) : [],
        info,
        infoTitle: model
          ? `Source: ${model.view.source || model.definition.shortSource}. Licence: ${model.view.licence || 'see Data attribution'}.`
          : '',
      };
    },

    setRowControlsListener(listener) {
      rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    /** Scene and voice options: `{ view, cap, selected }`. */
    setParams(params = {}) {
      if (params.view !== undefined && !viewDefinition(params.view))
        return false;
      if (params.cap !== undefined && !ARC_CAPS.includes(params.cap))
        return false;
      if (params.view !== undefined) viewId = params.view;
      if (params.cap !== undefined) cap = params.cap;
      if (params.selected !== undefined)
        selected = params.selected
          ? String(params.selected).toUpperCase()
          : null;
      if (bundle) redraw();
      return true;
    },

    getParams() {
      return { view: viewId, cap, selected };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!enabled) return [];
      return analystRows(model, maxCount);
    },

    getLodDiagnostics() {
      return {
        view: viewId,
        arcsLoaded: model?.arcs.length || 0,
        arcsShown: shown.length,
        cap,
        selected,
        anchorHeightM: ANCHOR_HEIGHT_M,
        ...renderer.counts?.(),
      };
    },
  };
}
