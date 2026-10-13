/**
 * Merge & Export's worker: reading files, merging, attaching the app's data
 * and writing exports all happen here, off the page's main thread, so the
 * app stays responsive with large files. The panel (mergePanel.js) sends
 * `{id, op, args}` and gets `{id, ok, result}` back, with `{id, progress}`
 * lines while it works.
 */
import { MergeSession } from './mergeSession.js';

let session = null;
let base = self.location.href;

const readContext = async (path) => {
  const response = await fetch(new URL(path, base).href);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
};

/** A file result with its bytes moved, not copied, to the page. */
const fileResult = (file) => {
  const bytes = file.bytes.slice();
  return [
    {
      fileName: file.fileName,
      mime: file.mime,
      bytes,
      renames: file.renames,
      notes: file.notes,
    },
    [bytes.buffer],
  ];
};

const ops = {
  init({ baseUrl }) {
    base = baseUrl || base;
    session = new MergeSession({ readContext });
    return true;
  },
  open({ name, bytes, which }) {
    return session.open(name, new Uint8Array(bytes), which);
  },
  summary: () => session.summary(),
  choices: () => session.choices(),
  findItems: ({ phrases }) => session.findItems(phrases),
  merge: (args) => session.mergeSecond(args),
  attach: ({ ids }, progress) => session.attach(ids, progress),
  count: ({ level }, progress) => session.count(level, progress),
  reset() {
    session.reset();
    return session.summary();
  },
  preview: () => session.preview(),
  map: ({ column }) => session.mapData(column),
  async convert({ format, codebook }) {
    return fileResult(await session.exportConverted(format, { codebook }));
  },
  async exportMerged({ format }) {
    return fileResult(await session.exportMerged(format));
  },
  async csv() {
    return fileResult(await session.csvForAnalysis());
  },
};

self.onmessage = async ({ data }) => {
  const { id, op, args = {} } = data || {};
  const progress = (text) => self.postMessage({ id, progress: text });
  try {
    if (!ops[op]) throw new Error(`Unknown request ${op}.`);
    if (op !== 'init' && !session)
      throw new Error('Merge & Export is not ready yet.');
    let result = await ops[op](args, progress);
    let transfer = [];
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      Array.isArray(result[1]) &&
      result[1][0] instanceof ArrayBuffer
    )
      [result, transfer] = result;
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
