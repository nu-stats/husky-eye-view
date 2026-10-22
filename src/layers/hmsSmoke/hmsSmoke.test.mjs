// Adapted from the Sheldondouthat/satwq-reality-os fork of God's Eye View
// (MIT): the KML parser tests are kept as they were; the source and layer
// tests follow Husky Eye View's JSON proxy and primitive rendering.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  createHmsSmokeLayer,
  SMOKE_DENSITY_STYLE,
  smokeDateLabel,
  HMS_SMOKE_SOURCE_LABEL,
} from './index.js';
import { createHmsSmokeSource } from './source.js';
import {
  parseSmokeKml,
  usSmokeSnapshot,
  validateSmokeSnapshot,
  SMOKE_SNAPSHOT_LIMIT,
} from './records.js';
import { ringTouchesUs } from '../../data/usArea.js';

function placemark(style, coords) {
  return (
    `<Placemark><name>smoke</name><styleUrl>#${style}</styleUrl>` +
    `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates>` +
    `</LinearRing></outerBoundaryIs></Polygon></Placemark>`
  );
}

const RING_A =
  '-120.0,40.0,0 -119.0,40.0,0 -119.0,41.0,0 -120.0,41.0,0 -120.0,40.0,0';
const RING_B =
  '-100.0,35.0,0 -99.0,35.0,0 -99.0,36.0,0 -100.0,36.0,0 -100.0,35.0,0';
const RING_C =
  // Georgia: the fork's ring sat off Florida, outside the US area.
  '-84.0,32.0,0 -83.0,32.0,0 -83.0,33.0,0 -84.0,33.0,0 -84.0,32.0,0';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Style id="Smoke_Light"><PolyStyle><color>7d00ffff</color></PolyStyle></Style>
<Style id="Smoke_Moderate"><PolyStyle><color>7d00a5ff</color></PolyStyle></Style>
<Style id="Smoke_Heavy"><PolyStyle><color>7d0000ff</color></PolyStyle></Style>
${placemark('Smoke_Light', RING_A)}
${placemark('Smoke_Moderate', RING_B)}
${placemark('Smoke_Heavy', RING_C)}
<Placemark><name>broken</name><styleUrl>#Smoke_Light</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates></coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

test('parseSmokeKml maps the three HMS densities and skips malformed placemarks', () => {
  const records = parseSmokeKml(FIXTURE);
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map((r) => r.density),
    ['light', 'moderate', 'heavy'],
  );
  assert.deepEqual(records[0].ring, [
    [-120.0, 40.0],
    [-119.0, 40.0],
    [-119.0, 41.0],
    [-120.0, 41.0],
    [-120.0, 40.0],
  ]);
});

test('parseSmokeKml rejects non-KML and skips bad rings', () => {
  assert.throws(() => parseSmokeKml('not kml at all'), /not a KML/);
  assert.throws(() => parseSmokeKml(null), /not a KML/);
  const badCoords = `<?xml version="1.0"?><kml><Document>${placemark('Smoke_Heavy', 'abc,def,0 -79.0,30.0,0')}</Document></kml>`;
  assert.deepEqual(parseSmokeKml(badCoords), []);
  const unclosed = `<?xml version="1.0"?><kml><Document>${placemark('Smoke_Light', '-80.0,30.0,0 -79.0,30.0,0')}</Document></kml>`;
  assert.deepEqual(parseSmokeKml(unclosed), []);
  const outOfRange = `<?xml version="1.0"?><kml><Document>${placemark('Smoke_Moderate', '-999.0,30.0,0 -79.0,30.0,0 -79.0,31.0,0 -80.0,31.0,0 -80.0,30.0,0')}</Document></kml>`;
  assert.deepEqual(parseSmokeKml(outOfRange), []);
});

test('parseSmokeKml enforces the polygon cap', () => {
  const many = Array.from({ length: 500 }, (_, i) =>
    placemark(
      'Smoke_Light',
      `${-120 - i * 0.001},40.0,0 ${-119 - i * 0.001},40.0,0 ${-119 - i * 0.001},41.0,0 ${-120 - i * 0.001},41.0,0 ${-120 - i * 0.001},40.0,0`,
    ),
  ).join('');
  const kml = `<?xml version="1.0"?><kml><Document>${many}</Document></kml>`;
  assert.equal(parseSmokeKml(kml).length, 400);
  assert.equal(parseSmokeKml(kml, { maxPolygons: 5 }).length, 5);
  // Regression: a capped parse must not poison subsequent parses
  // (global regex lastIndex). The fixture still yields all 3 after a cap hit.
  assert.equal(parseSmokeKml(FIXTURE).length, 3);
});

test('parseSmokeKml parses the live HMS StyleMap ids (#Smoke_*_style) and the Medium middle class', () => {
  // Recurrence guard: the live NOAA HMS feed serves StyleMap ids such as
  // #Smoke_Light_style / #Smoke_Medium_style, not the bare style names the
  // original parser expected. The feed's middle density class is "Medium".
  const liveFixture = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<StyleMap id="Smoke_Light_style"><Pair><key>normal</key><styleUrl>#Smoke_Light</styleUrl></Pair></StyleMap>
<StyleMap id="Smoke_Medium_style"><Pair><key>normal</key><styleUrl>#Smoke_Medium</styleUrl></Pair></StyleMap>
<StyleMap id="Smoke_Heavy_style"><Pair><key>normal</key><styleUrl>#Smoke_Heavy</styleUrl></Pair></StyleMap>
<Placemark><name>smoke</name><styleUrl>#Smoke_Light_style</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${RING_A}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>smoke</name><styleUrl>#Smoke_Medium_style</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${RING_B}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>smoke</name><styleUrl>#Smoke_Heavy_style</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${RING_C}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
  const records = parseSmokeKml(liveFixture);
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map((r) => r.density),
    ['light', 'moderate', 'heavy'],
  );
});

const CANADA_RING =
  '-115.0,54.5,0 -113.0,54.5,0 -113.0,56.0,0 -115.0,56.0,0 -115.0,54.5,0';
const MEXICO_RING =
  '-107.0,28.0,0 -106.0,28.0,0 -106.0,29.0,0 -107.0,29.0,0 -107.0,28.0,0';

test('usSmokeSnapshot keeps the US polygons and drops Canada and Mexico', () => {
  const kml = FIXTURE.replace(
    '</Document>',
    `${placemark('Smoke_Heavy_style', CANADA_RING)}${placemark('Smoke_Light_style', MEXICO_RING)}</Document>`,
  );
  const records = parseSmokeKml(kml);
  assert.equal(records.length, 5);
  const snapshot = usSmokeSnapshot(records, {
    date: '20261020',
    fetchedAt: 1,
    touchesUs: ringTouchesUs,
  });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.total, 5);
  assert.equal(snapshot.dropped, 2);
  assert.deepEqual(
    snapshot.polygons.map((p) => p.density),
    ['light', 'moderate', 'heavy'],
  );
  // The round trip through the browser check keeps every kept polygon.
  assert.equal(validateSmokeSnapshot(snapshot).polygons.length, 3);
});

test('usSmokeSnapshot rounds coordinates and stops at the snapshot cap', () => {
  const ring = [
    [-98.123456, 38.987654],
    [-97.5, 38.5],
    [-97.5, 39.5],
    [-98.123456, 38.987654],
  ];
  const records = Array.from({ length: SMOKE_SNAPSHOT_LIMIT + 5 }, () => ({
    density: 'light',
    ring,
  }));
  const snapshot = usSmokeSnapshot(records, {
    date: '20261020',
    fetchedAt: 1,
    touchesUs: () => true,
  });
  assert.equal(snapshot.polygons.length, SMOKE_SNAPSHOT_LIMIT);
  assert.deepEqual(snapshot.polygons[0].ring[0], [-98.123, 38.988]);
});

test('validateSmokeSnapshot refuses malformed snapshots', () => {
  const good = {
    schemaVersion: 1,
    date: '20261020',
    fetchedAt: 5,
    total: 1,
    dropped: 0,
    polygons: [
      {
        density: 'heavy',
        ring: [
          [-98, 38],
          [-97, 38],
          [-97, 39],
          [-98, 38],
        ],
      },
    ],
  };
  assert.equal(validateSmokeSnapshot(good).polygons.length, 1);
  assert.equal(validateSmokeSnapshot({ ...good, stale: true }).stale, true);
  for (const bad of [
    null,
    { ...good, schemaVersion: 2 },
    { ...good, date: '2026-10-20' },
    { ...good, polygons: 'x' },
    { ...good, polygons: [{ ...good.polygons[0], density: 'thick' }] },
    { ...good, polygons: [{ density: 'heavy', ring: [[-98, 38]] }] },
    {
      ...good,
      polygons: [
        {
          density: 'heavy',
          ring: [
            [-98, 38],
            [-97, 'x'],
            [-97, 39],
            [-98, 38],
          ],
        },
      ],
    },
  ])
    assert.throws(() => validateSmokeSnapshot(bad), /Malformed/);
});

const SNAPSHOT = usSmokeSnapshot(parseSmokeKml(FIXTURE), {
  date: '20261020',
  fetchedAt: 1_790_000_000_000,
  touchesUs: ringTouchesUs,
});

const jsonResponse = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('source returns the checked snapshot and throws on 503 / malformed', async () => {
  let requested = null;
  const ok = createHmsSmokeSource({
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return jsonResponse(SNAPSHOT);
    },
  });
  const snap = await ok.getSnapshot();
  assert.equal(requested.url, '/api/hms-smoke');
  assert.equal(
    requested.options.cache,
    undefined,
    'the default HTTP cache applies',
  );
  assert.equal(snap.date, '20261020');
  assert.equal(snap.polygons.length, 3);

  const gone = createHmsSmokeSource({
    fetchImpl: async () => jsonResponse({ error: 'hms_unavailable' }, 503),
  });
  await assert.rejects(gone.getSnapshot(), /unavailable/);

  const junk = createHmsSmokeSource({
    fetchImpl: async () => new Response('garbage'),
  });
  await assert.rejects(junk.getSnapshot(), /Malformed/);

  const wrongShape = createHmsSmokeSource({
    fetchImpl: async () => jsonResponse({ polygons: [] }),
  });
  await assert.rejects(wrongShape.getSnapshot(), /Malformed/);
});

test('density style colors match the spec (yellow/orange/red alphas)', () => {
  assert.equal(SMOKE_DENSITY_STYLE.light.alpha, 0.25);
  assert.equal(SMOKE_DENSITY_STYLE.moderate.alpha, 0.35);
  assert.equal(SMOKE_DENSITY_STYLE.heavy.alpha, 0.45);
  assert.deepEqual(
    SMOKE_DENSITY_STYLE.light.color.toCssColorString(),
    Cesium.Color.YELLOW.toCssColorString(),
  );
  assert.deepEqual(
    SMOKE_DENSITY_STYLE.moderate.color.toCssColorString(),
    Cesium.Color.ORANGE.toCssColorString(),
  );
  assert.deepEqual(
    SMOKE_DENSITY_STYLE.heavy.color.toCssColorString(),
    Cesium.Color.RED.toCssColorString(),
  );
});

test('smokeDateLabel reads the HMS day tag', () => {
  assert.equal(smokeDateLabel('20261020'), 'Oct 20, 2026');
  assert.equal(smokeDateLabel('20260105'), 'Jan 5, 2026');
  assert.equal(smokeDateLabel('2026-10-20'), '');
  assert.equal(smokeDateLabel(null), '');
});

function harness(source) {
  const primitives = [];
  const renders = [];
  const viewer = {
    scene: {
      groundPrimitives: {
        add(value) {
          primitives.push(value);
          return value;
        },
        remove(value) {
          const index = primitives.indexOf(value);
          if (index >= 0) primitives.splice(index, 1);
          return index >= 0;
        },
      },
    },
  };
  const layer = createHmsSmokeLayer({
    source,
    requestRender: (reason) => renders.push(reason),
    setTimeoutImpl: () => 0,
    clearTimeoutImpl: () => {},
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, primitives, renders };
}

test('layer shape, lifecycle, and soft failure', async () => {
  const h = harness({ getSnapshot: async () => SNAPSHOT });
  assert.equal(h.layer.id, 'hms-smoke');
  assert.equal(h.layer.name, 'Wildfire Smoke');
  assert.equal(h.layer.source, HMS_SMOKE_SOURCE_LABEL);
  assert.equal(h.layer.updateInterval, 3600_000);

  assert.equal(await h.layer.update(h.viewer), true);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 3);
  assert.equal(stats.lastUpdate, SNAPSHOT.fetchedAt);
  assert.equal(stats.error, null);
  assert.equal(stats.source, `${HMS_SMOKE_SOURCE_LABEL} · Oct 20, 2026`);
  // One classification primitive per density, over globe and tiles alike.
  assert.equal(h.primitives.length, 3);
  for (const primitive of h.primitives) {
    assert.ok(primitive instanceof Cesium.ClassificationPrimitive);
    assert.equal(primitive.classificationType, Cesium.ClassificationType.BOTH);
  }
  assert.ok(h.renders.length > 0);

  const controls = h.layer.getRowControls();
  assert.deepEqual(
    controls.legend.map(({ label, count }) => [label, count]),
    [
      ['Light', 1],
      ['Medium', 1],
      ['Heavy', 1],
    ],
  );
  assert.match(controls.info, /Oct 20, 2026.*US only/);
  assert.match(controls.infoTitle, /lower 48, Alaska, Hawaii, Puerto Rico/);

  // An unchanged refresh keeps the drawn batches and asks for no renders.
  const drawn = [...h.primitives];
  const rendersBefore = h.renders.length;
  assert.equal(await h.layer.update(h.viewer), true);
  assert.deepEqual(h.primitives, drawn, 'same day and counts: no redraw');
  assert.equal(h.renders.length, rendersBefore);

  h.layer.disable(h.viewer);
  assert.equal(h.primitives.length, 0);
  assert.equal(await h.layer.update(h.viewer), false);
  h.layer.destroy(h.viewer);
  assert.equal(h.primitives.length, 0);

  const failing = harness({
    getSnapshot: async () => {
      throw new Error('hms down');
    },
  });
  // The layer stays on and says why.
  assert.equal(await failing.layer.update(failing.viewer), true);
  assert.match(failing.layer.getStats().error, /hms down/);
  assert.equal(failing.primitives.length, 0);
});

test('smoke redraws when the day or the counts change, and after a disable', async () => {
  let snapshot = SNAPSHOT;
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  const first = [...h.primitives];
  assert.equal(first.length, 3);

  snapshot = { ...SNAPSHOT, date: '20261021' };
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.primitives.length, 3, 'a new day replaces the batches');
  assert.ok(h.primitives.every((primitive) => !first.includes(primitive)));

  const second = [...h.primitives];
  snapshot = {
    ...snapshot,
    polygons: snapshot.polygons.filter(({ density }) => density !== 'heavy'),
  };
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.primitives.length, 2, 'changed counts redraw');
  assert.ok(h.primitives.every((primitive) => !second.includes(primitive)));
  assert.equal(h.layer.getDiagnostics().counts.heavy, 0);

  h.layer.disable(h.viewer);
  h.layer.enable(h.viewer);
  assert.equal(h.primitives.length, 2, 'enable redraws the kept snapshot');
  const restored = [...h.primitives];
  assert.equal(await h.layer.update(h.viewer), true);
  assert.deepEqual(h.primitives, restored, 'and the next refresh keeps it');
  h.layer.destroy(h.viewer);
});

test('layer requires a snapshot source and rejects double init', () => {
  assert.throws(() => createHmsSmokeLayer({}), /snapshot source/);
  const h = harness({ getSnapshot: async () => ({ polygons: [] }) });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
});
