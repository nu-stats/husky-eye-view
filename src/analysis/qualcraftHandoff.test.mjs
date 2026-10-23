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
