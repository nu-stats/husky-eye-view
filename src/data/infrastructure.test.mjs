import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import { createInfrastructureLayers } from 'gods-eye-view/infrastructure';
import { createLocalGeoJsonLayer } from 'gods-eye-view/infrastructure/geojson';

function services() {
  const records = new Map();
  let selection;
  return {
    records,
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
    registerEntityContext(entity, metadata) {
      records.set(metadata.id, { entity, ...metadata });
    },
    selectEntityContext(entity) {
      selection = entity;
    },
    clearSelectedEntityContextForLayer() {
      selection = undefined;
    },
    removeEntityContextsForLayer(id) {
      for (const [key, record] of records)
        if (record.layerId === id) records.delete(key);
    },
    governorRequestRender() {},
    selection: () => selection,
  };
}

test('package exports import without an application, DOM, fetch, or timers', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    globalThis.fetch = () => { throw new Error('unexpected fetch'); };
    globalThis.setTimeout = () => { throw new Error('unexpected timer'); };
    for (const key of ['window', 'document']) {
      delete globalThis[key];
    }
    await import('gods-eye-view/infrastructure');
    await import('gods-eye-view/infrastructure/geojson');
    await import('gods-eye-view/infrastructure/lod');
  `,
    ],
    { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('infrastructure factory preserves identity and creates independent state without loading', (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('factory must not fetch');
  });
  const first = createInfrastructureLayers(services());
  const second = createInfrastructureLayers(services());
  assert.deepEqual(
    first.map(({ id, name, source }) => ({ id, name, source })),
    [
      { id: 'local-datacenters', name: 'Datacenters', source: 'Local' },
      { id: 'local-dams', name: 'Dams', source: 'OpenStreetMap' },
      { id: 'local-chicago-events', name: 'Chicago Events', source: 'Local' },
      { id: 'local-tlr', name: 'TLR', source: 'Video locations' },
      { id: 'local-gang-map', name: 'Gang Map', source: 'Big Bas My Maps' },
      {
        id: 'local-gang-map-labels',
        name: 'Gang Map Labels',
        source: 'Hood names',
      },
      {
        id: 'local-famous-shootings',
        name: 'Famous Shootings',
        source: 'Big Bas My Maps',
      },
      {
        id: 'local-holc-redlining',
        name: 'HOLC Redlining (1930s)',
        source: 'Mapping Inequality',
      },
      {
        id: 'local-life-expectancy',
        name: 'Life Expectancy (tracts)',
        source: 'USALEEP',
      },
      {
        id: 'local-tract-le-clusters',
        name: 'Life Expectancy Clusters (tracts)',
        source: "Local Moran's I",
      },
      {
        id: 'local-county-life-expectancy',
        name: 'Life Expectancy (counties)',
        source: 'County 2000–2019',
      },
      {
        id: 'local-county-le-clusters',
        name: 'Life Expectancy Clusters (counties)',
        source: "Local Moran's I",
      },
      {
        id: 'local-air-pm25',
        name: 'Air Quality: PM2.5 (tracts)',
        source: 'CDC 2021',
      },
      {
        id: 'local-air-ozone',
        name: 'Air Quality: Ozone (tracts)',
        source: 'CDC 2022',
      },
      {
        id: 'local-air-nonattainment',
        name: 'Air Quality: Nonattainment Areas',
        source: 'EPA Green Book',
      },
      {
        id: 'local-park-access',
        name: 'Green Space: Park Access (tracts)',
        source: 'CDC 2020',
      },
      {
        id: 'local-parks',
        name: 'Green Space: Parks',
        source: 'Census TIGER 2025',
      },
      {
        id: 'local-miami-homicides-1950s',
        name: 'Miami Homicides 1956–1959',
        source: 'Miami-Dade homicides',
      },
      {
        id: 'local-miami-homicides-1960s',
        name: 'Miami Homicides 1960s',
        source: 'Miami-Dade homicides',
      },
      {
        id: 'local-miami-homicides-1970s',
        name: 'Miami Homicides 1970s',
        source: 'Miami-Dade homicides',
      },
      {
        id: 'local-miami-homicides-1980s',
        name: 'Miami Homicides 1980s',
        source: 'Miami-Dade homicides',
      },
      {
        id: 'local-miami-homicides-1990s',
        name: 'Miami Homicides 1990s',
        source: 'Miami-Dade homicides',
      },
      {
        id: 'local-miami-homicides-2000s',
        name: 'Miami Homicides 2000–2011',
        source: 'Miami-Dade homicides',
      },
      {
        id: 'local-miami-homicide-hotspots',
        name: 'Miami Homicide Hotspots',
        source: 'Kernel density',
      },
      {
        id: 'local-trauma-centers',
        name: 'Trauma Centers',
        source: 'HIFLD Hospitals',
      },
      {
        id: 'local-public-housing',
        name: 'Public Housing',
        source: 'HUD',
      },
      ...[
        ['local-acs-poverty', 'Poverty (tracts)'],
        ['local-acs-income', 'Median Household Income (tracts)'],
        ['local-acs-unemployment', 'Unemployment (tracts)'],
        ['local-acs-education', "Bachelor's Degree or Higher (tracts)"],
        ['local-acs-renters', 'Renter-Occupied Homes (tracts)'],
        ['local-acs-black', 'Black Residents (tracts)'],
        ['local-acs-hispanic', 'Hispanic or Latino Residents (tracts)'],
        ['local-acs-no-vehicle', 'Households Without a Vehicle (tracts)'],
        ['local-acs-broadband', 'Broadband at Home (tracts)'],
      ].map(([id, name]) => ({ id, name, source: 'ACS 2020–2024' })),
      {
        id: 'local-internet-use',
        name: 'Internet Use at Home',
        source: 'Census CPS / ACS',
      },
      {
        id: 'local-internet-highspeed',
        name: 'High-Speed Internet at Home',
        source: 'Census CPS / ACS',
      },
      {
        id: 'local-gva-2015',
        name: 'Gun Deaths 2015 (GVA)',
        source: 'Gun Violence Archive',
      },
      {
        id: 'local-mkdb',
        name: 'MKDB Mass Killings (2006–2023)',
        source: 'Mass Killing Database',
      },
      {
        id: 'local-boston-neighborhoods',
        name: 'Boston Neighborhoods',
        source: 'Neighborhood areas',
      },
    ],
  );
  const locked = new Set(['local-gva-2015', 'local-mkdb']);
  first.forEach((layer, index) => {
    assert.notEqual(layer, second[index]);
    layer.destroy();
    const stats = second[index].getStats();
    if (locked.has(layer.id)) {
      // Research datasets start locked until the server says the key opens them.
      assert.equal(second[index].requiresKeyId, 'research-data');
      assert.equal(stats.keyRequired, true);
      assert.equal(stats.status, 'locked');
      assert.equal(stats.count, 0);
      assert.equal(stats.error, null);
    } else {
      assert.deepEqual(stats, { count: 0, lastUpdate: null, error: null });
    }
    second[index].destroy();
  });
});

test('a locked research layer refuses to turn on until the server unlocks it', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let status = 'locked';
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => ({ configured: true, datasets: { mkdb: status } }),
    url,
  });
  const layer = createInfrastructureLayers(services()).find(
    ({ id }) => id === 'local-mkdb',
  );
  await layer.init();
  await assert.rejects(
    layer.enable({}),
    /Locked: click to enter the research key/,
  );
  assert.equal(
    (await layer.getAreaContext({ longitude: 0, latitude: 0 })).status,
    'locked',
  );
  status = 'unlocked';
  await layer.init();
  assert.equal(layer.getStats().keyRequired, undefined);
  layer.destroy();
});

test('a locked layer sends this browser session’s research key, and only that', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.sessionStorage;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalStorage;
  });
  const seen = [];
  let sessionKey = null;
  globalThis.sessionStorage = {
    getItem: (slot) => (slot === 'hev.researchKey' ? sessionKey : null),
  };
  globalThis.fetch = async (url, init = {}) => {
    const key = init.headers?.['X-HEV-Research-Key'] ?? null;
    seen.push({ url, key });
    return {
      ok: true,
      json: async () => ({
        configured: Boolean(key),
        datasets: { mkdb: key === 'k1' ? 'unlocked' : 'locked' },
      }),
    };
  };
  const layer = createInfrastructureLayers(services()).find(
    ({ id }) => id === 'local-mkdb',
  );
  await layer.init();
  assert.equal(layer.getStats().status, 'locked', 'no session key yet');
  assert.equal(seen.at(-1).key, null);
  sessionKey = 'k1';
  await layer.init();
  assert.equal(seen.at(-1).url, '/api/research/status');
  assert.equal(seen.at(-1).key, 'k1');
  assert.equal(layer.getStats().keyRequired, undefined, 'unlocked');
  layer.destroy();
});

test('dataset URLs still name the complete bundled sources', () => {
  // US-only since v0.1.3 (scripts/filter-points-to-us.mjs): 1,549 of 4,351
  // data centers and 66 of 704 dams.
  for (const [file, count] of [
    ['datacenters', 1549],
    ['dams', 66],
  ]) {
    const lines = readFileSync(
      new URL(`./local_data/${file}/${file}.geojsonl`, import.meta.url),
      'utf8',
    )
      .split('\n')
      .filter((line) => line.trim());
    assert.equal(lines.length, count);
  }
});

test('two viewers use their supplied contexts and dispose independently', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        type: 'Feature',
        id: 'same-id',
        properties: { name: 'Dam' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [0.01, 0],
              [0, 0.01],
              [0, 0],
            ],
          ],
        },
      }),
  }));
  const hosts = [services(), services()];
  const instances = hosts.map((host) => {
    const sources = new Cesium.DataSourceCollection();
    let click;
    const layer = createLocalGeoJsonLayer(
      {
        id: 'local-dams',
        name: 'Dams',
        color: '#0088ff',
        url: '/dams.geojsonl',
        screenSpaceEventHandlerFactory: () => ({
          setInputAction(fn) {
            click = fn;
          },
          destroy() {},
        }),
      },
      host,
    );
    const viewer = {
      dataSources: sources,
      scene: {
        canvas: {},
        preRender: new Cesium.Event(),
        requestRender() {},
        screenSpaceCameraController: { enableInputs: true },
        pick: () => ({ id: sources.get(0).entities.values[0] }),
      },
      camera: { moveEnd: new Cesium.Event(), flyTo() {} },
    };
    return { layer, viewer, click: () => click({ position: {} }) };
  });
  t.after(() =>
    instances.forEach(({ layer, viewer }) => layer.destroy(viewer)),
  );
  await Promise.all(instances.map(({ layer, viewer }) => layer.enable(viewer)));
  assert.equal(hosts[0].records.size, 1);
  assert.equal(hosts[1].records.size, 1);
  instances[0].click();
  assert.ok(hosts[0].selection());
  assert.equal(hosts[1].selection(), undefined);
  instances[0].layer.destroy(instances[0].viewer);
  assert.equal(hosts[0].records.size, 0);
  assert.equal(hosts[1].records.size, 1);
  assert.equal(instances[1].viewer.dataSources.length, 1);
});

test('consumer build includes only infrastructure code and resolves assets under a non-root base', async () => {
  const { build } = await import('vite');
  const { fileURLToPath } = await import('node:url');
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    base: '/example/',
    build: {
      write: false,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: fileURLToPath(
          import.meta.resolve('gods-eye-view/infrastructure'),
        ),
        external: ['cesium'],
        preserveEntrySignatures: 'strict',
      },
    },
  });
  const output = result.output;
  const entry = output.find((item) => item.type === 'chunk' && item.isEntry);
  const sources = Object.keys(entry.modules).filter((id) => id.endsWith('.js'));
  assert.deepEqual(sources.map((id) => id.split('/').at(-1)).sort(), [
    'chunkedAreaLayer.js',
    'infrastructure.js',
    // Pure layer metadata (card nouns for unnamed pins).
    'layerManifest.js',
    'localGeojsonCore.js',
    'localGeojsonLod.js',
    'localLabelSettings.js',
  ]);
  assert.deepEqual(
    entry.imports,
    ['cesium'],
    'the viewer supplies the same Cesium dependency',
  );
  for (const name of ['datacenters', 'dams']) {
    const asset = output.find(
      (item) => item.type === 'asset' && item.fileName.includes(name),
    );
    assert.ok(asset, `${name} must be emitted`);
    assert.ok(
      entry.code.includes(`/example/${asset.fileName}`),
      `${name} must retain the consumer base path`,
    );
  }
});
