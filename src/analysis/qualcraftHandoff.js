/**
 * QualCraft ▸ Map ▸ Code counts by area ▸ Send to Husky Eye View.
 *
 * QualCraft (qualitative coding, on this computer) opens this app at
 * `#from=qualcraft`. The app tells its opener it is ready; QualCraft then
 * posts its table of code counts, which opens in Merge & Export as Your file,
 * as if the user had chosen it. Protocol version 1:
 *
 *   HEV → opener    { type: 'hev:ready', version: 1 }   (holds no data)
 *   opener → HEV    { type: 'qualcraft:table', version: 1, fileName, csv, codebookCsv }
 *
 * The table is taken only from the window that opened this one, and only
 * when that window is on this computer (a loopback address): interview data
 * never comes from, or goes to, anywhere else.
 */

const OPEN_EVENT = 'gev:merge-export-open'; // mergePanel.js MERGE_OPEN_EVENT

/** Whether `origin` is a page on this computer (127.0.0.1, localhost, [::1], *.localhost). */
export function isLoopbackOrigin(origin) {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return (
      ['127.0.0.1', 'localhost', '[::1]'].includes(hostname) ||
      hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

/** QualCraft's file name, kept to a plain name ending in .csv. */
function csvName(fileName) {
  const base = String(fileName || '')
    .split(/[\\/]/)
    .pop()
    .trim();
  if (!base) return 'qualcraft-code-counts.csv';
  return /\.csv$/i.test(base) ? base : `${base}.csv`;
}

/**
 * When this page was opened by QualCraft, answer it and take one table.
 * `waiting` says whether it is waiting for one; `stop()` stops listening.
 * @param {object} [options]
 * @param {Window} [options.win]
 * @param {(file: File) => void} [options.openFile] Opens Merge & Export with the file.
 * @returns {{waiting: boolean, stop: () => void}}
 */
export function installQualcraftHandoff({
  win = globalThis,
  openFile = (file) =>
    win.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { file } })),
} = {}) {
  const hash = String(win.location?.hash || '').replace(/^#/, '');
  const idle = { waiting: false, stop: () => {} };
  if (new URLSearchParams(hash).get('from') !== 'qualcraft') return idle;
  // A reload should not wait for QualCraft again.
  const { pathname, search } = win.location;
  win.history?.replaceState?.(null, '', `${pathname}${search}`);
  const opener = win.opener;
  if (!opener) return idle;

  const stop = () => win.removeEventListener('message', onMessage);
  const onMessage = (event) => {
    if (event.source !== opener || !isLoopbackOrigin(event.origin)) return;
    const data = event.data;
    if (data?.type !== 'qualcraft:table' || data.version !== 1) return;
    if (typeof data.csv !== 'string') return;
    stop();
    openFile(
      new File([data.csv], csvName(data.fileName), { type: 'text/csv' }),
    );
  };
  win.addEventListener('message', onMessage);
  opener.postMessage({ type: 'hev:ready', version: 1 }, '*');
  return { waiting: true, stop };
}

/**
 * The Craft hand-off (MapCraft docs/handoff.md, protocol version 1) for any
 * of the Craft apps: when this page was opened at `#from=<app>` by one of
 * `accept`, answer with `ready` and take one message from that opener:
 * `<app>:table` (a CSV, opened with `openFile`) or `<app>:layer` (GeoJSON,
 * opened with `openLayer`). Only from the opener, only from a loopback
 * address. `reply(message)` sends one message back to the opener's origin
 * once it has sent something (MergeCraft's "Send back to MapCraft").
 * @param {object} options
 * @param {string[]} options.accept Apps whose messages are taken.
 * @param {string} [options.ready] This app's ready message type.
 * @param {Window} [options.win]
 * @param {(file: File) => void} [options.openFile]
 * @param {(file: File) => void} [options.openLayer]
 * @param {(from: string) => void} [options.onReceived]
 */
export function installCraftHandoff({
  accept,
  ready = 'hev:ready',
  win = globalThis,
  openFile = (file) =>
    win.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { file } })),
  openLayer = () => {},
  onReceived = () => {},
}) {
  const hash = String(win.location?.hash || '').replace(/^#/, '');
  const from = new URLSearchParams(hash).get('from');
  const idle = { waiting: false, from: null, stop: () => {}, reply: () => false };
  if (!from || !accept.includes(from)) return idle;
  const { pathname, search } = win.location;
  win.history?.replaceState?.(null, '', `${pathname}${search}`);
  const opener = win.opener;
  if (!opener) return idle;

  let replyOrigin = null;
  const stop = () => win.removeEventListener('message', onMessage);
  const onMessage = (event) => {
    if (event.source !== opener || !isLoopbackOrigin(event.origin)) return;
    const data = event.data;
    if (data?.version !== 1) return;
    if (data.type === `${from}:table` && typeof data.csv === 'string') {
      openFile(new File([data.csv], csvName(data.fileName), { type: 'text/csv' }));
    } else if (data.type === `${from}:layer` && data.geojson) {
      const text = typeof data.geojson === 'string' ? data.geojson : JSON.stringify(data.geojson);
      const base = String(data.fileName || data.name || `${from}-layer`).split(/[\/]/).pop().trim();
      openLayer(new File([text], /\.(geo)?json$/i.test(base) ? base : `${base}.geojson`, { type: 'application/geo+json' }));
    } else return;
    replyOrigin = event.origin;
    stop();
    onReceived(from);
  };
  win.addEventListener('message', onMessage);
  opener.postMessage({ type: ready, version: 1 }, '*');
  return {
    waiting: true,
    from,
    stop,
    reply(message) {
      if (!replyOrigin || opener.closed) return false;
      opener.postMessage(message, replyOrigin);
      return true;
    },
  };
}
