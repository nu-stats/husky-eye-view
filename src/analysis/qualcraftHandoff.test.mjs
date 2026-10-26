// QualCraft's "Send to Husky Eye View": the app says it is ready to its
// opener and takes one table, only from that opener on a loopback address.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installQualcraftHandoff,
  isLoopbackOrigin,
} from './qualcraftHandoff.js';

const TABLE = {
  type: 'qualcraft:table',
  version: 1,
  fileName: 'code-counts-tract.csv',
  csv: 'GEOID,name,Housing\n25025010100,Tract 101,3\n',
  codebookCsv: 'code,description\nHousing,Talk about housing\n',
};

/** A page window opened at `hash` by `opener` (null for none). */
function fakeWindow(
  hash,
  opener = {
    posted: [],
    postMessage(m, o) {
      this.posted.push([m, o]);
    },
  },
) {
  const win = new EventTarget();
  win.location = { hash, pathname: '/', search: '' };
  win.replaced = [];
  win.history = { replaceState: (_s, _t, url) => win.replaced.push(url) };
  win.opener = opener;
  return win;
}

function install(win) {
  const opened = [];
  const { waiting, stop } = installQualcraftHandoff({
    win,
    openFile: (file) => opened.push(file),
  });
  const send = (
    data,
    { source = win.opener, origin = 'http://127.0.0.1:4310' } = {},
  ) => {
    const event = new Event('message');
    Object.assign(event, { data, source, origin });
    win.dispatchEvent(event);
  };
  return { opened, waiting, stop, send };
}

test('loopback origins are this computer only', () => {
  for (const origin of [
    'http://127.0.0.1:4310',
    'http://localhost:4310',
    'http://[::1]:4310',
    'https://qualcraft.localhost',
  ])
    assert.equal(isLoopbackOrigin(origin), true, origin);
  for (const origin of [
    'https://example.com',
    'http://127.0.0.1.example.com',
    'http://localhost.example.com',
    'http://192.168.1.5:4310',
    'null',
    'file://',
    '',
  ])
    assert.equal(isLoopbackOrigin(origin), false, origin);
});

test('without #from=qualcraft nothing listens or is posted', () => {
  const win = fakeWindow('#lat=42&lon=-71');
  const { opened, waiting, send } = install(win);
  assert.equal(waiting, false);
  send(TABLE);
  assert.deepEqual(win.opener.posted, []);
  assert.deepEqual(opened, []);
  assert.deepEqual(win.replaced, []);
});

test('opened by QualCraft: ready is posted, the hash cleared, the table opened', async () => {
  const win = fakeWindow('#from=qualcraft');
  const { opened, waiting, send } = install(win);
  assert.equal(waiting, true);
  assert.deepEqual(win.opener.posted, [
    [{ type: 'hev:ready', version: 1 }, '*'],
  ]);
  assert.deepEqual(win.replaced, ['/']);
  send(TABLE);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].name, 'code-counts-tract.csv');
  assert.equal(await opened[0].text(), TABLE.csv);
  // One table per hand-off.
  send(TABLE);
  assert.equal(opened.length, 1);
});

test('a table from another origin or another window is ignored', () => {
  const win = fakeWindow('#from=qualcraft');
  const { opened, send } = install(win);
  send(TABLE, { origin: 'https://example.com' });
  send(TABLE, { origin: 'http://192.168.1.5:4310' });
  send(TABLE, { source: {} });
  send({ ...TABLE, version: 2 });
  send({ ...TABLE, csv: 42 });
  assert.deepEqual(opened, []);
  // Still waiting for the real one.
  send(TABLE, { origin: 'http://localhost:4310' });
  assert.equal(opened.length, 1);
});

test('no opener: the hash is cleared and nothing waits', () => {
  const win = fakeWindow('#from=qualcraft', null);
  const { opened, waiting, send } = install(win);
  assert.equal(waiting, false);
  assert.deepEqual(win.replaced, ['/']);
  send(TABLE, { source: null });
  assert.deepEqual(opened, []);
});

test('file names are kept plain and end in .csv', () => {
  const names = [];
  for (const fileName of ['..\\..\\secret', 'counts', '', undefined]) {
    const win = fakeWindow('#from=qualcraft');
    const { opened, send } = install(win);
    send({ ...TABLE, fileName });
    names.push(opened[0].name);
  }
  assert.deepEqual(names, [
    'secret.csv',
    'counts.csv',
    'qualcraft-code-counts.csv',
    'qualcraft-code-counts.csv',
  ]);
});

test('stop() removes the listener', () => {
  const win = fakeWindow('#from=qualcraft');
  const { opened, send, stop } = install(win);
  stop();
  send(TABLE);
  assert.deepEqual(opened, []);
});

test('MapCraft can send a layer for My files and a table for Merge & Export', async () => {
  const { installCraftHandoff } = await import('./qualcraftHandoff.js');
  const layers = [];
  const tables = [];
  const win = fakeWindow('#from=mapcraft');
  const h = installCraftHandoff({ accept: ['qualcraft', 'mapcraft'], win, openFile: (f) => tables.push(f), openLayer: (f) => layers.push(f) });
  assert.equal(h.waiting, true);
  assert.deepEqual(win.opener.posted[0], [{ type: 'hev:ready', version: 1 }, '*']);
  const geojson = { type: 'FeatureCollection', features: [] };
  win.dispatchEvent(Object.assign(new Event('message'), { source: win.opener, origin: 'http://127.0.0.1:4320', data: { type: 'mapcraft:layer', version: 1, fileName: 'Sites', geojson } }));
  assert.equal(layers.length, 1);
  assert.equal(layers[0].name, 'Sites.geojson');
  assert.equal(await layers[0].text(), JSON.stringify(geojson));
  assert.equal(tables.length, 0);
  // Replies go only to the origin that sent something.
  assert.equal(h.reply({ type: 'mergecraft:table', version: 1, csv: 'GEOID\n' }), true);
  assert.deepEqual(win.opener.posted[1], [{ type: 'mergecraft:table', version: 1, csv: 'GEOID\n' }, 'http://127.0.0.1:4320']);
});

test('the Craft hand-off ignores other apps, other origins and other windows', async () => {
  const { installCraftHandoff } = await import('./qualcraftHandoff.js');
  assert.equal(installCraftHandoff({ accept: ['mapcraft'], win: fakeWindow('#from=other') }).waiting, false);
  const got = [];
  const win = fakeWindow('#from=mapcraft');
  installCraftHandoff({ accept: ['mapcraft'], ready: 'mergecraft:ready', win, openFile: (f) => got.push(f) });
  assert.deepEqual(win.opener.posted[0], [{ type: 'mergecraft:ready', version: 1 }, '*']);
  win.dispatchEvent(Object.assign(new Event('message'), { source: win.opener, origin: 'https://example.com', data: { type: 'mapcraft:table', version: 1, csv: 'x' } }));
  win.dispatchEvent(Object.assign(new Event('message'), { source: {}, origin: 'http://127.0.0.1:4320', data: { type: 'mapcraft:table', version: 1, csv: 'x' } }));
  win.dispatchEvent(Object.assign(new Event('message'), { source: win.opener, origin: 'http://127.0.0.1:4320', data: { type: 'qualcraft:table', version: 1, csv: 'x' } }));
  assert.equal(got.length, 0);
  win.dispatchEvent(Object.assign(new Event('message'), { source: win.opener, origin: 'http://localhost:4320', data: { type: 'mapcraft:table', version: 1, fileName: 'tracts', csv: 'GEOID\n' } }));
  assert.equal(got[0].name, 'tracts.csv');
});

test('a desktop app hands a layer over by fetch= on this computer', async () => {
  const { installCraftHandoff } = await import('./qualcraftHandoff.js');
  const url = 'http://127.0.0.1:50123/abc123/points.geojson';
  const win = fakeWindow(`#from=statcraft&fetch=${encodeURIComponent(url)}`, null);
  const layers = [];
  const asked = [];
  const fetchImpl = async (u) => {
    asked.push(u);
    return { ok: true, text: async () => '{"type":"FeatureCollection","features":[]}' };
  };
  const h = installCraftHandoff({ accept: ['statcraft'], win, fetchImpl, openLayer: (f) => layers.push(f) });
  assert.equal(h.waiting, true);
  assert.equal(await h.done, true);
  assert.deepEqual(asked, [url]);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].name, 'points.geojson');
  assert.deepEqual(win.replaced, ['/']);
});

test('a fetch= table opens as a CSV; other hosts and types are refused', async () => {
  const { installCraftHandoff, isLoopbackFetch } = await import('./qualcraftHandoff.js');
  const tables = [];
  const fetchImpl = async () => ({ ok: true, text: async () => 'GEOID,n\n25025,3\n' });
  const win = fakeWindow(`#from=statcraft&fetch=${encodeURIComponent('http://localhost:4000/t/counties.csv')}`, null);
  const h = installCraftHandoff({ accept: ['statcraft'], win, fetchImpl, openFile: (f) => tables.push(f) });
  assert.equal(await h.done, true);
  assert.equal(tables[0].name, 'counties.csv');
  assert.equal(isLoopbackFetch('https://example.com/x.csv'), false);
  assert.equal(isLoopbackFetch('http://192.168.1.5/x.csv'), false);
  assert.equal(isLoopbackFetch('file:///C:/x.csv'), false);
  const far = fakeWindow(`#from=statcraft&fetch=${encodeURIComponent('https://example.com/x.csv')}`, null);
  const refused = installCraftHandoff({ accept: ['statcraft'], win: far, fetchImpl });
  assert.equal(refused.waiting, false);
  const odd = fakeWindow(`#from=statcraft&fetch=${encodeURIComponent('http://127.0.0.1:9/run.exe')}`, null);
  const h2 = installCraftHandoff({ accept: ['statcraft'], win: odd, fetchImpl });
  assert.equal(await h2.done, false);
});
