import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PANEL_ORDER } from './layerPanel.js';
import { LAYER_MANIFEST } from '../data/layerManifest.js';

// The panel order is derived from the layer manifest.
function panelOrder() {
  const source = readFileSync(
    new URL('./layerPanel.js', import.meta.url),
    'utf8',
  );
  return { source, order: PANEL_ORDER };
}

test('every panel row comes from exactly one manifest entry', () => {
  const listed = LAYER_MANIFEST.filter((entry) => entry.group).map(
    (entry) => entry.id,
  );
  assert.deepEqual(
    PANEL_ORDER.map(({ id }) => id),
    listed,
  );
  assert.equal(new Set(listed).size, listed.length);
});

test('locked research datasets keep their own group that never starts folded', () => {
  const { source, order } = panelOrder();
  assert.deepEqual(
    order
      .filter(({ label }) => label === 'Restricted Research Data')
      .map(({ id }) => id),
    ['local-gva-2015', 'local-mkdb', 'local-chicago-homicides'],
  );
  // Research comes first: the research groups sit above the inherited live
  // feeds, infrastructure and utilities.
  const labels = [...new Set(order.map(({ label }) => label))];
  assert.equal(labels[0], 'Life Expectancy & Health');
  assert.ok(
    labels.indexOf('Restricted Research Data') < labels.indexOf('Live Feeds'),
  );
  assert.deepEqual(labels.slice(-3), [
    'Live Feeds',
    'Infrastructure',
    'Utilities',
  ]);
  // First-visit folding skips the group, so the locked rows are in sight.
  assert.match(
    source,
    /filter\(\(group\) => !active\.has\(group\) && group !== RESEARCH_GROUP\)/,
  );
});

test('panel presentation places Transit between Street Traffic and Bike Share in Live Feeds', () => {
  const { order } = panelOrder();
  const live = order
    .filter(({ label }) => label === 'Live Feeds')
    .map(({ id }) => id);
  const transit = live.indexOf('transit');
  assert.deepEqual(live.slice(transit - 1, transit + 2), [
    'traffic',
    'transit',
    'bikeshare',
  ]);
  assert.equal(order.filter(({ id }) => id === 'transit').length, 1);
  // Chicago's research layers are no longer mixed into a live "Events" group.
  assert.equal(
    order.some(({ label }) => label === 'Events'),
    false,
  );
  assert.deepEqual(
    order
      .filter(({ label }) => label === 'City Study: Chicago')
      .map(({ id }) => id),
    [
      'local-chicago-events',
      'local-tlr',
      'local-famous-shootings',
      'local-gang-map',
      'local-gang-map-labels',
    ],
  );
});

test('partial feed controls distinguish incomplete records from stale data and outages', async () => {
  const { LayerPanel, layerFeedState } = await import('./layerPanel.js');
  const classes = new Map();
  const attrs = new Map();
  const button = {
    classList: { toggle: (key, value) => classes.set(key, value) },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  const layer = {
    id: 'ais-live-vessels',
    name: 'Live Vessels',
    source: 'AISStream',
    enabled: true,
    stats: {
      partial: true,
      stale: false,
      count: 2,
      acceptedRowCount: 2,
      rawRowCount: 3,
      lastUpdate: Date.now(),
    },
  };
  const panel = LayerPanel.prototype;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'PARTIAL');
  assert.equal(button.dataset.feedState, 'partial');
  assert.equal(classes.get('feed-partial'), true);
  assert.equal(classes.get('feed-stale'), false);
  assert.match(attrs.get('aria-label'), /PARTIAL/);
  assert.match(
    panel._buildMetaText(layer),
    /^PARTIAL · AISStream · 2 of 3 records accepted · /,
  );
  assert.match(
    panel._buildMetaText({
      ...layer,
      stats: { ...layer.stats, rawRowCount: 2 },
    }),
    /incomplete snapshot/,
  );
  assert.equal(layerFeedState({ ...layer.stats, stale: true }), 'stale');
  assert.equal(
    layerFeedState({ ...layer.stats, error: 'Connection lost' }),
    'degraded',
  );
  assert.equal(
    layerFeedState({ ...layer.stats, status: 'unavailable' }),
    'unavailable',
  );
  assert.equal(layerFeedState({ ...layer.stats, loading: true }), 'loading');
  layer.stats = { ...layer.stats, partial: false };
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'ON');
  assert.equal(classes.get('feed-partial'), false);
  layer.enabled = false;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'OFF');
});

test('static research rows show the years their data covers, not a refresh time', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const meta = (layer) =>
    LayerPanel.prototype._buildMetaText.call(
      { _timeAgo: () => '2m ago' },
      { enabled: true, stats: { lastUpdate: Date.now() }, ...layer },
    );
  assert.equal(
    meta({ id: 'local-holc-redlining', source: 'Mapping Inequality' }),
    'Mapping Inequality · 1930s maps',
  );
  assert.equal(
    meta({ id: 'local-air-pm25', source: 'CDC 2021' }),
    'CDC 2021 · 2021',
  );
  // A static layer without a listed vintage shows just its source...
  assert.equal(
    meta({ id: 'local-tlr', source: 'Video locations' }),
    'Video locations',
  );
  // ...while live feeds keep their refresh time.
  assert.equal(meta({ id: 'flights', source: 'OpenSky' }), 'OpenSky · 2m ago');
  assert.equal(
    meta({ id: 'local-firms', source: 'NASA FIRMS' }),
    'NASA FIRMS · 2m ago',
  );
});
