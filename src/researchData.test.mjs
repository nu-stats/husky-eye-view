import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RESEARCH_DATASETS,
  RESEARCH_KEY_HEADER,
  decryptResearchBuffer,
  encryptResearchText,
  researchDataProxy,
} from '../server/providers/research.js';
import {
  KEY_SETUP_KEYS,
  keySetupStatus,
  knownKeySetupEnvVars,
  validateKeySetupUpdates,
} from './keySetupCore.mjs';

const TEXT =
  '{"type":"Feature","properties":{"name":"A"}}\n{"type":"Feature"}\n';

test('a locked dataset opens only with the key it was locked with', () => {
  const locked = encryptResearchText(TEXT, 'right-key');
  assert.ok(
    !locked.includes(Buffer.from('Feature')),
    'no plaintext in the file',
  );
  assert.equal(decryptResearchBuffer(locked, 'right-key'), TEXT);
  assert.equal(decryptResearchBuffer(locked, 'wrong-key'), null);
  assert.equal(decryptResearchBuffer(locked, ''), null);
  assert.equal(
    decryptResearchBuffer(Buffer.from('not locked'), 'right-key'),
    null,
  );
});

/** Drive the middleware with a fake request and collect the response. */
function request(plugin, url, headers = {}) {
  let handler = null;
  plugin.configureServer({
    middlewares: { use: (prefix, fn) => (handler = fn) },
  });
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        resolve({
          status: this.status,
          headers: this.headers,
          body: String(body),
        });
      },
    };
    handler({ url, headers }, res);
  });
}

test('the key comes only with the request, never from the server configuration', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hev-research-'));
  const saved = process.env.HEV_RESEARCH_DATA_KEY;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.HEV_RESEARCH_DATA_KEY;
    else process.env.HEV_RESEARCH_DATA_KEY = saved;
  });
  writeFileSync(
    path.join(dir, RESEARCH_DATASETS.mkdb),
    encryptResearchText(TEXT, 'k1'),
  );
  // A key left in the environment must not open anything by itself.
  process.env.HEV_RESEARCH_DATA_KEY = 'k1';
  const plugin = researchDataProxy({ dataDir: dir });
  let res = await request(plugin, '/status');
  assert.deepEqual(JSON.parse(res.body), {
    configured: false,
    datasets: { 'gva-2015': 'locked', mkdb: 'locked' },
  });
  assert.equal((await request(plugin, '/mkdb')).status, 503);
  // The browser session's key, sent in the header, does.
  const headers = { [RESEARCH_KEY_HEADER]: 'k1' };
  res = await request(plugin, '/mkdb', headers);
  assert.equal(res.status, 200);
  assert.equal(res.body, TEXT);
  res = await request(plugin, '/status', headers);
  assert.equal(JSON.parse(res.body).datasets.mkdb, 'unlocked');
});

test('the research route serves data only to the right key', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hev-research-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, RESEARCH_DATASETS.mkdb),
    encryptResearchText(TEXT, 'k1'),
  );
  let key = '';
  const plugin = researchDataProxy({ dataDir: dir, readKey: () => key });

  let res = await request(plugin, '/status');
  assert.deepEqual(JSON.parse(res.body), {
    configured: false,
    datasets: { 'gva-2015': 'locked', mkdb: 'locked' },
  });
  res = await request(plugin, '/mkdb');
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'no_key');

  key = 'nope';
  res = await request(plugin, '/mkdb');
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).error, 'bad_key');

  key = 'k1';
  res = await request(plugin, '/mkdb');
  assert.equal(res.status, 200);
  assert.equal(res.body, TEXT);
  assert.match(res.headers['Content-Type'], /ndjson/);
  res = await request(plugin, '/status');
  assert.deepEqual(JSON.parse(res.body).datasets, {
    'gva-2015': 'locked',
    mkdb: 'unlocked',
  });

  res = await request(plugin, '/gva-2015');
  assert.equal(res.status, 404, 'a dataset whose file is absent');
  res = await request(plugin, '/../../pinokio/ENVIRONMENT');
  assert.equal(res.status, 404, 'only the named datasets are reachable');
});

test('the shipped repository carries both datasets encrypted, never in plaintext', () => {
  for (const file of Object.values(RESEARCH_DATASETS)) {
    assert.ok(
      existsSync(new URL(`../data/research/${file}`, import.meta.url)),
      file,
    );
  }
  for (const old of [
    'gva_2015/incidents.geojsonl',
    'mkdb/incidents.geojsonl',
  ]) {
    assert.equal(
      existsSync(new URL(`./data/local_data/${old}`, import.meta.url)),
      false,
      `${old} must not be bundled in plaintext`,
    );
  }
});

test('POWER UP offers the research key, issued by the owner (no sign-up link)', () => {
  const entry = KEY_SETUP_KEYS.find((key) => key.id === 'research-data');
  assert.ok(entry);
  assert.deepEqual([...entry.envVars], ['HEV_RESEARCH_DATA_KEY']);
  assert.equal(entry.getUrl, '');
});

test('the research key is browser-session only: the server can never save it', () => {
  const entry = KEY_SETUP_KEYS.find((key) => key.id === 'research-data');
  assert.equal(entry.browserSession, true);
  assert.equal(knownKeySetupEnvVars().has('HEV_RESEARCH_DATA_KEY'), false);
  assert.match(
    validateKeySetupUpdates({ HEV_RESEARCH_DATA_KEY: 'k1' }).error,
    /Unknown key/,
  );
  // Even a leftover server value does not count as set, and the optional
  // owner-issued key never counts toward "keys waiting".
  const status = keySetupStatus({ HEV_RESEARCH_DATA_KEY: 'k1' });
  const row = status.keys.find((key) => key.id === 'research-data');
  assert.equal(row.set, false);
  assert.equal(row.browserSession, true);
  // Both owner-issued session keys (research data, Curated Flights) are
  // optional and never count toward "keys waiting".
  assert.equal(
    status.total,
    status.keys.length - status.keys.filter((key) => key.browserSession).length,
  );
  assert.equal(
    status.keys.filter((key) => key.browserSession).length,
    2,
    'research data and Curated Flights',
  );
  assert.ok(!JSON.stringify(status).includes('k1'));
});

test('POWER UP and the locked layers share one session slot and change event', async () => {
  const core = await import('./data/localGeojsonCore.js');
  const panel = await import('./keySetup.js');
  assert.equal(
    panel.SESSION_KEY_SLOTS.HEV_RESEARCH_DATA_KEY,
    core.RESEARCH_KEY_SESSION_SLOT,
  );
  assert.equal(panel.SESSION_KEY_EVENT, core.RESEARCH_KEY_EVENT);
  assert.equal(core.RESEARCH_KEY_HEADER.toLowerCase(), RESEARCH_KEY_HEADER);

  const store = new Map();
  const events = [];
  const saved = {
    sessionStorage: globalThis.sessionStorage,
    dispatchEvent: globalThis.dispatchEvent,
  };
  globalThis.sessionStorage = {
    getItem: (slot) => store.get(slot) ?? null,
    setItem: (slot, value) => store.set(slot, value),
    removeItem: (slot) => store.delete(slot),
  };
  globalThis.dispatchEvent = (event) => events.push(event.type);
  try {
    assert.equal(panel.hasSessionKey('HEV_RESEARCH_DATA_KEY'), false);
    panel.writeSessionKey('HEV_RESEARCH_DATA_KEY', 'k1');
    assert.equal(store.get('hev.researchKey'), 'k1');
    assert.equal(panel.hasSessionKey('HEV_RESEARCH_DATA_KEY'), true);
    panel.writeSessionKey('HEV_RESEARCH_DATA_KEY', '');
    assert.equal(store.has('hev.researchKey'), false);
    assert.deepEqual(events, [
      core.RESEARCH_KEY_EVENT,
      core.RESEARCH_KEY_EVENT,
    ]);
    assert.equal(panel.writeSessionKey('OPENAI_API_KEY', 'x'), false);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
