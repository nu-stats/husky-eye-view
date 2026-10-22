import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assembleBundle,
  buildCentroidTable,
  createCountryResolver,
  extractUsMigrantStock,
  extractUsRefugees,
  extractUsRemittances,
  extractUsResettlement,
} from '../../../scripts/build-migration-flows.mjs';
import {
  ARC_CAPS,
  DEFAULT_ARC_CAP,
  MIGRATION_FLOWS_LAYER_ID,
  VIEWS,
  analystRows,
  binIndex,
  buildViewArcs,
  countryCard,
  createMigrationFlowsLayer,
  formatUsdMillions,
  selectTopArcs,
  usCard,
  validateBundle,
  viewLegend,
} from './index.js';
import { arcPositions, greatCirclePoints } from './geo.js';
import {
  layerManifestEntry,
  LAYER_MANIFEST,
} from '../../data/layerManifest.js';

const BUNDLE_PATH = fileURLToPath(
  new URL(
    '../../data/local_data/migration_flows/us-migration-flows.json',
    import.meta.url,
  ),
);
const BUNDLE = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'));

// ---- Bundled data -------------------------------------------------------------

test('bundled table: valid, every view has an explicit year, source and licence', () => {
  assert.ok(validateBundle(BUNDLE));
  const years = Object.fromEntries(
    VIEWS.map(({ id }) => [id, BUNDLE.views[id].year]),
  );
  assert.equal(years.stock, 2024);
  assert.equal(years.remittances, 2021);
  assert.ok(years.refugees >= 2024, 'UNHCR year is recent');
  assert.equal(years.resettlement, years.refugees);
  for (const { id } of VIEWS) {
    const view = BUNDLE.views[id];
    assert.ok(view.asOf, `${id} asOf`);
    assert.ok(view.source, `${id} source`);
    assert.ok(view.licence, `${id} licence`);
    assert.ok(Number(view.total) > 0, `${id} total`);
    assert.ok(Object.keys(view.flows).length >= 20, `${id} has countries`);
  }
  assert.equal(BUNDLE.views.remittances.direction, 'from-us');
  assert.equal(BUNDLE.views.stock.direction, 'to-us');
});

test('bundled table: every flow is a country with a point, never the US itself', () => {
  for (const { id } of VIEWS) {
    for (const [iso3, value] of Object.entries(BUNDLE.views[id].flows)) {
      assert.match(iso3, /^[A-Z]{3}$/);
      assert.notEqual(iso3, 'USA');
      assert.ok(value > 0, `${id} ${iso3} positive`);
      const point = BUNDLE.countries[iso3];
      assert.ok(Array.isArray(point), `${id} ${iso3} has a point`);
      assert.ok(Math.abs(point[1]) <= 90 && Math.abs(point[2]) <= 180);
    }
  }
  // The largest flows are where the published tables put them.
  const top = (id) => Object.keys(BUNDLE.views[id].flows)[0];
  assert.equal(top('stock'), 'MEX');
  assert.equal(top('remittances'), 'MEX');
});

test('bundled table: drawn countries never exceed the national total', () => {
  for (const { id } of VIEWS) {
    const view = BUNDLE.views[id];
    const sum = Object.values(view.flows).reduce((a, b) => a + b, 0);
    assert.ok(sum <= view.total + 1, `${id}: ${sum} <= ${view.total}`);
  }
  const refugees = BUNDLE.views.refugees;
  assert.equal(refugees.total, refugees.refugees + refugees.asylumSeekers);
  for (const [iso3, [r, a]] of Object.entries(refugees.split))
    assert.equal(r + a, refugees.flows[iso3]);
});

// ---- Build script: the US filter ------------------------------------------------

const COUNTRIES = buildCentroidTable({
  features: [
    ['USA', 'United States of America', 840, -97.5, 39.5],
    ['MEX', 'Mexico', 484, -102.3, 23.9],
    ['IND', 'India', 356, 79.4, 22.7],
    ['DEU', 'Germany', 276, 10.0, 51.2],
    ['SYR', 'Syria', 760, 38.3, 35.0],
  ].map(([iso3, name, m49, lon, lat]) => ({
    properties: {
      ISO_A3: iso3,
      NAME: name,
      NAME_LONG: name,
      ISO_N3: String(m49),
      LABEL_X: lon,
      LABEL_Y: lat,
    },
  })),
});
const RESOLVER = createCountryResolver(COUNTRIES);

test('build: centroid table keeps ISO3, M49 and label point', () => {
  assert.deepEqual(
    { ...COUNTRIES.MEX, names: undefined },
    { name: 'Mexico', lat: 23.9, lon: -102.3, m49: 484, names: undefined },
  );
  assert.equal(COUNTRIES.USA.name, 'United States', 'everyday name');
  assert.equal(RESOLVER.byName('United States'), 'USA');
  assert.equal(RESOLVER.byName('Syrian Arab Republic'), 'SYR');
  assert.equal(RESOLVER.byM49(356), 'IND');
});

test('build: UN DESA rows keep destination USA only, with the World total', () => {
  // [index, dest name, coverage, type, dest code, origin name, origin code, …1990–2024]
  const row = (dest, origin, v2024) => {
    const r = [0, 'x', null, 'B', dest, 'y', origin];
    r[14] = v2024;
    return r;
  };
  const { flows, total } = extractUsMigrantStock(
    [
      ['Index', 'header'],
      row(840, 900, 1000),
      row(840, 484, 600),
      row(840, 356, 300),
      row(840, 1834, 50), // regional aggregate: not a country
      row(840, 840, 5), // self
      row(276, 760, 800), // Germany as destination: ignored
      row(484, 840, 900), // Mexico as destination: ignored
    ],
    RESOLVER,
  );
  assert.equal(total, 1000);
  assert.deepEqual(flows, { MEX: 600, IND: 300 });
  assert.deepEqual(Object.keys(flows), ['MEX', 'IND'], 'largest first');
});

test('build: KNOMAD matrix reads only the United States row, WORLD as total', () => {
  const rows = [
    [
      'Sending / receiving',
      'Mexico',
      'India',
      'Germany',
      'United States',
      'WORLD',
    ],
    ['Germany', 1, 2, null, 3, 6],
    ['United States', 52595.34, 15808, 40, null, 68443.3],
    ['WORLD', 60000, 80000, 100, 7000, 1],
  ];
  const { flows, total } = extractUsRemittances(rows, RESOLVER);
  assert.deepEqual(flows, { MEX: 52595.3, IND: 15808, DEU: 40 });
  assert.equal(total, 68443.3);
});

test('build: UNHCR rows keep asylum country USA; unknown origins are not drawn', () => {
  const items = [
    { coa_iso: 'USA', coo_iso: 'MEX', refugees: 100, asylum_seekers: '50' },
    { coa_iso: 'USA', coo_iso: 'UNK', refugees: 10, asylum_seekers: 990 },
    { coa_iso: 'USA', coo_iso: 'SYR', refugees: '-', asylum_seekers: 7 },
    { coa_iso: 'USA', coo_iso: 'GUF', refugees: 3, asylum_seekers: 0 },
    { coa_iso: 'DEU', coo_iso: 'SYR', refugees: 600000, asylum_seekers: 0 },
  ];
  const result = extractUsRefugees(items, RESOLVER);
  assert.deepEqual(result.flows, { MEX: 150, SYR: 7 });
  assert.deepEqual(result.split, { MEX: [100, 50], SYR: [0, 7] });
  assert.equal(result.unknownOrigin, 1000);
  assert.deepEqual(result.unmatched, { GUF: 3 });
  assert.equal(result.total, 1160);
  const resettled = extractUsResettlement(
    [
      { coa_iso: 'USA', coo_iso: 'SYR', resettlement: 40 },
      { coa_iso: 'USA', coo_iso: 'MEX', resettlement: '-' },
      { coa_iso: 'CAN', coo_iso: 'SYR', resettlement: 900 },
    ],
    RESOLVER,
  );
  assert.deepEqual(resettled.flows, { SYR: 40 });
  assert.equal(resettled.total, 40);
});

test('build: the bundle keeps only countries a view uses, plus the US', () => {
  const views = Object.fromEntries(
    VIEWS.map(({ id }) => [
      id,
      {
        year: 2024,
        direction: 'to-us',
        flows: id === 'stock' ? { MEX: 5 } : {},
      },
    ]),
  );
  const bundle = assembleBundle({ countries: COUNTRIES, views, built: 'x' });
  assert.deepEqual(Object.keys(bundle.countries), ['MEX', 'USA']);
  assert.deepEqual(bundle.countries.MEX, ['Mexico', 23.9, -102.3]);
});

// ---- Arc model -----------------------------------------------------------------

test('arcs: inbound views point at the US, remittances leave it', () => {
  const stock = buildViewArcs(BUNDLE, 'stock');
  const mex = stock.arcs[0];
  assert.equal(mex.iso3, 'MEX');
  assert.equal(mex.rank, 1);
  assert.deepEqual(mex.to, stock.usPoint);
  assert.notDeepEqual(mex.from, stock.usPoint);
  assert.ok(mex.share > 0.15 && mex.share < 0.3, 'Mexico ~ a fifth');
  const remit = buildViewArcs(BUNDLE, 'remittances');
  assert.deepEqual(remit.arcs[0].from, remit.usPoint);
  for (let i = 1; i < stock.arcs.length; i++)
    assert.ok(stock.arcs[i - 1].value >= stock.arcs[i].value, 'sorted');
});

test('arcs: skips the US, missing points and non-positive values', () => {
  const bundle = {
    countries: { USA: ['United States', 39, -98], MEX: ['Mexico', 24, -102] },
    views: {
      stock: {
        year: 2024,
        direction: 'to-us',
        total: 10,
        flows: { MEX: 4, USA: 3, XXX: 2, CUB: 0 },
      },
    },
  };
  const model = buildViewArcs(bundle, 'stock');
  assert.deepEqual(
    model.arcs.map((a) => a.iso3),
    ['MEX'],
  );
  assert.equal(model.skipped, 3);
  assert.equal(model.arcs[0].share, 0.4);
  assert.equal(buildViewArcs(bundle, 'nope'), null);
});

test('arcs: top-N cap and size classes', () => {
  const model = buildViewArcs(BUNDLE, 'refugees');
  assert.equal(selectTopArcs(model.arcs, 25).length, 25);
  assert.equal(selectTopArcs(model.arcs, null).length, model.arcs.length);
  assert.deepEqual(ARC_CAPS, [25, 50, null]);
  assert.equal(DEFAULT_ARC_CAP, 25);
  const bins = VIEWS[0].bins;
  assert.equal(binIndex(bins, 11_000_000), 0);
  assert.equal(binIndex(bins, 600_000), 1);
  assert.equal(binIndex(bins, 300_000), 2);
  assert.equal(binIndex(bins, 10), bins.length - 1);
  const legend = viewLegend(model, selectTopArcs(model.arcs, 25));
  assert.equal(legend.length, 4);
  assert.equal(
    legend.reduce((a, b) => a + b.count, 0),
    25,
  );
  assert.deepEqual(
    legend.map((item) => item.label),
    ['100k+', '25k–100k', '5k–25k', 'under 5k'],
  );
  const remit = buildViewArcs(BUNDLE, 'remittances');
  assert.deepEqual(
    viewLegend(remit, []).map((item) => item.label),
    ['$5B+', '$2B–$5B', '$500M–$2B', 'under $500M'],
  );
});

test('cards: number, rank, year and source; US card names what is not drawn', () => {
  const model = buildViewArcs(BUNDLE, 'refugees');
  const card = countryCard(model, model.arcs[0].iso3);
  assert.match(card.title, / to United States$/);
  const text = card.lines.join('\n');
  assert.match(text, /Refugees and asylum-seekers in the US: /);
  assert.match(text, /Rank 1 of \d+/);
  assert.match(text, /asylum-seekers/);
  assert.match(text, new RegExp(`Year: end of ${BUNDLE.views.refugees.year}`));
  assert.match(text, /Source: UNHCR/);
  const us = usCard(model, 25).lines.join('\n');
  assert.match(us, /all countries: /);
  assert.match(us, /Drawn: largest 25 of/);
  assert.match(us, /unknown or stateless origin/);
  const remit = buildViewArcs(BUNDLE, 'remittances');
  assert.match(countryCard(remit, 'MEX').title, /^United States to Mexico$/);
  assert.match(countryCard(remit, 'MEX').lines[0], /\$\d+\.\dB/);
  assert.equal(countryCard(remit, 'ZZZ'), null);
  const stock = buildViewArcs(BUNDLE, 'stock');
  assert.match(countryCard(stock, 'PRI').lines.join(' '), /US territory/);
});

test('formatting and analyst rows', () => {
  assert.equal(formatUsdMillions(52595.3), '$52.6B');
  assert.equal(formatUsdMillions(850), '$850M');
  const rows = analystRows(buildViewArcs(BUNDLE, 'stock'), 3);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].iso3, 'MEX');
  assert.equal(rows[0].year, 2024);
  assert.equal(rows[0].unit, 'people');
});

test('geometry: great circle keeps its endpoints; arcs rise in the middle', () => {
  const a = { lon: -102, lat: 24 };
  const b = { lon: -98, lat: 39 };
  const points = greatCirclePoints(a, b, 8);
  assert.equal(points.length, 9);
  assert.ok(Math.abs(points[0].lon - a.lon) < 1e-9);
  assert.ok(Math.abs(points[8].lat - b.lat) < 1e-9);
  const { positions, peakM } = arcPositions(a, b);
  const heights = positions.filter((_, i) => i % 3 === 2);
  assert.ok(peakM > 0);
  assert.ok(Math.max(...heights) > heights[0]);
});

// ---- Layer -------------------------------------------------------------------

function fakeLayer() {
  const draws = [];
  const overlay = { entries: new Map(), visible: new Map() };
  const overlayHost = {
    setEntries: (id, entries) => overlay.entries.set(id, entries),
    clearSource: (id) => overlay.entries.delete(id),
    setVisible: (id, v) => overlay.visible.set(id, v),
  };
  const renderer = {
    attach() {},
    draw(arcs, options) {
      draws.push({ arcs, options });
    },
    setVisible() {},
    pickedArc: () => null,
    nearestNode: () => null,
    anchor: () => ({ x: 1, y: 2, z: 3 }),
    nodePosition: () => ({ x: 0, y: 0, z: 0 }),
    counts: () => ({}),
    destroy() {},
  };
  let fetches = 0;
  const layer = createMigrationFlowsLayer({
    overlayHost,
    createRenderer: () => renderer,
    dataUrl: 'test://flows.json',
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, json: async () => BUNDLE };
    },
  });
  return { layer, draws, overlay, fetches: () => fetches };
}

test('layer: loads once, draws the top 25 immigrants by default, chips carry years', async () => {
  const { layer, draws, fetches } = fakeLayer();
  assert.equal(layer.id, MIGRATION_FLOWS_LAYER_ID);
  layer.init({ scene: {} });
  await layer.enable();
  await layer.update();
  await layer.update();
  assert.equal(fetches(), 1);
  const last = draws.at(-1);
  assert.equal(last.arcs.length, 25);
  assert.equal(last.arcs[0].iso3, 'MEX');
  const controls = layer.getRowControls();
  assert.deepEqual(
    controls.chips.map((c) => c.label),
    [
      'Immigrants 2024',
      `Refugees & asylum ${BUNDLE.views.refugees.year}`,
      `Resettled ${BUNDLE.views.resettlement.year}`,
      'Remittances 2021',
      'Top 25',
    ],
  );
  assert.equal(controls.chips[0].active, true);
  assert.match(controls.info, /mid-2024/);
  assert.match(controls.info, /not yearly arrivals/);
  assert.match(controls.infoTitle, /CC BY 3\.0 IGO/);
  assert.equal(controls.legend.length, 4);
  assert.equal(
    layer.getStats().countLabel,
    `25 of ${Object.keys(BUNDLE.views.stock.flows).length}`,
  );
});

test('layer: chips switch view and cap; params validate; selection opens a card', async () => {
  const { layer, draws, overlay } = fakeLayer();
  layer.init({ scene: {} });
  await layer.enable();
  await layer.update();
  layer.getRowControls().chips[3].onClick();
  assert.equal(layer.getParams().view, 'remittances');
  assert.deepEqual(
    draws.at(-1).arcs[0].from,
    buildViewArcs(BUNDLE, 'remittances').usPoint,
  );
  layer.getRowControls().chips.at(-1).onClick();
  assert.equal(layer.getParams().cap, 50);
  layer.getRowControls().chips.at(-1).onClick();
  assert.equal(layer.getParams().cap, null);
  assert.equal(
    draws.at(-1).arcs.length,
    Object.keys(BUNDLE.views.remittances.flows).length,
  );
  assert.equal(layer.setParams({ view: 'bogus' }), false);
  assert.equal(layer.setParams({ cap: 7 }), false);
  assert.equal(
    layer.setParams({ view: 'refugees', cap: 25, selected: 'ven' }),
    true,
  );
  const [card] = overlay.entries.get(MIGRATION_FLOWS_LAYER_ID);
  assert.equal(card.title, 'Venezuela to United States');
  assert.ok(card.details.some((line) => /Year: end of/.test(line)));
  assert.ok(card.details.some((line) => /Source: UNHCR/.test(line)));
  assert.equal(draws.at(-1).options.selectedIso3, 'VEN');
  // A selection outside the drawn set is dropped rather than left unanchored.
  layer.setParams({ selected: 'BEN' });
  assert.equal(layer.getParams().selected, null);
  assert.equal(overlay.entries.has(MIGRATION_FLOWS_LAYER_ID), false);
  layer.disable();
  assert.deepEqual(layer.getAnalystRecords(), []);
  assert.equal(overlay.visible.get(MIGRATION_FLOWS_LAYER_ID), false);
});

test('layer: a bad table reports an error instead of throwing', async () => {
  const layer = createMigrationFlowsLayer({
    overlayHost: { setEntries() {}, clearSource() {}, setVisible() {} },
    createRenderer: () => ({
      attach() {},
      draw() {},
      setVisible() {},
      destroy() {},
    }),
    dataUrl: 'test://bad.json',
    fetchImpl: async () => ({ ok: true, json: async () => ({ views: {} }) }),
  });
  layer.init({ scene: {} });
  await layer.enable();
  assert.equal(await layer.update(), true);
  assert.match(layer.getStats().error, /Malformed/);
});

test('layer: the click handler lives only while the layer is on', async () => {
  const handlers = [];
  const layer = createMigrationFlowsLayer({
    overlayHost: { setEntries() {}, clearSource() {}, setVisible() {} },
    createRenderer: () => ({
      attach() {},
      draw() {},
      setVisible() {},
      destroy() {},
    }),
    screenSpaceEventHandlerFactory: () => {
      const handler = {
        actions: 0,
        destroyed: false,
        setInputAction() {
          this.actions += 1;
        },
        destroy() {
          this.destroyed = true;
        },
      };
      handlers.push(handler);
      return handler;
    },
    dataUrl: 'test://flows.json',
    fetchImpl: async () => ({ ok: true, json: async () => BUNDLE }),
  });
  layer.init({ scene: { canvas: {} } });
  assert.equal(handlers.length, 0, 'none while off');
  await layer.enable();
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0].actions, 1);
  layer.disable();
  assert.equal(handlers[0].destroyed, true);
  await layer.enable();
  assert.equal(handlers.length, 2, 'a fresh handler each time it is turned on');
  layer.destroy();
  assert.equal(handlers[1].destroyed, true);
});

test('manifest: one off-by-default entry next to the foreign-born layers', () => {
  const entry = layerManifestEntry(MIGRATION_FLOWS_LAYER_ID);
  assert.equal(entry.token, 'mf');
  assert.equal(entry.disposition, 'enabled-only');
  assert.equal(
    entry.group,
    layerManifestEntry('local-foreign-born-counties').group,
  );
  const ids = LAYER_MANIFEST.map((e) => e.id);
  assert.equal(
    ids.indexOf(MIGRATION_FLOWS_LAYER_ID),
    ids.indexOf('local-foreign-born-counties') + 1,
  );
  assert.equal(
    LAYER_MANIFEST.filter((e) => e.token === 'mf').length,
    1,
    'token unique',
  );
});
