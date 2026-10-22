// Merge & Export's worker holds the user's file and merged tables. Closing
// the panel lets it go only when no file is loaded; it comes back on next use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MergePanel } from './mergePanel.js';

class FakeWorker {
  constructor(log) {
    this.log = log;
    this.terminated = false;
    this.onmessage = null;
    log.created += 1;
  }
  postMessage({ id, op }) {
    this.log.ops.push(op);
    queueMicrotask(() =>
      this.onmessage?.({ data: { id, ok: true, result: { op } } }),
    );
  }
  terminate() {
    this.terminated = true;
    this.log.terminated += 1;
  }
}

/** The panel's worker lifecycle without its DOM (build() is not run). */
function panelWithFakeWorker() {
  const log = { created: 0, terminated: 0, ops: [] };
  const panel = Object.create(MergePanel.prototype);
  Object.assign(panel, {
    dataName: 'Husky Eye View',
    file: null,
    second: null,
    busy: false,
    requests: new Map(),
    nextId: 0,
    worker: null,
    ready: null,
    createWorker: () => new FakeWorker(log),
    root: { hidden: false, classList: { remove() {}, add() {} } },
  });
  globalThis.document ??= { baseURI: 'http://localhost/' };
  panel.startWorker();
  return { panel, log };
}

test('closing with no file loaded terminates the worker; next use makes a new one', async () => {
  const { panel, log } = panelWithFakeWorker();
  await panel.ready;
  const first = panel.worker;
  panel.close();
  assert.equal(first.terminated, true);
  assert.equal(panel.worker, null);
  const result = await panel.call('choices');
  assert.equal(result.op, 'choices');
  assert.equal(log.created, 2);
  assert.deepEqual(log.ops, ['init', 'init', 'choices'], 'new worker is set up first');
});

test('closing with a file loaded keeps the worker and the user’s work', async () => {
  const { panel, log } = panelWithFakeWorker();
  await panel.ready;
  panel.file = { file: 'mine.csv', rows: 10, columns: [] };
  panel.close();
  assert.equal(log.terminated, 0);
  assert.ok(panel.worker);
});

test('closing while a step is running keeps the worker', async () => {
  const { panel, log } = panelWithFakeWorker();
  await panel.ready;
  panel.busy = true;
  panel.close();
  assert.equal(log.terminated, 0);
  panel.busy = false;
  // An answer still on its way also keeps it.
  const pending = panel.post('summary');
  panel.close();
  assert.equal(log.terminated, 0);
  await pending;
  panel.close();
  assert.equal(log.terminated, 1);
});
