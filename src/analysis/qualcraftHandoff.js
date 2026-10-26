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

// The address as the page was opened: the share link rewrites the hash
// with the view (after the first camera move), which can happen before
// the app shell asks for a hand-off.
const BOOT_HASH = String(globalThis.location?.hash || '');

/** The hand-off part of `win`'s hash, or of the hash it was opened with. */
function handoffHash(win) {
  const now = String(win.location?.hash || '').replace(/^#/, '');
  if (new URLSearchParams(now).get('from') || win !== globalThis) return now;
  return BOOT_HASH.replace(/^#/, '');
}

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
 * `<app>:scene` (MapCraft ▸ Show in 3D) is a layer whose file carries its
 * heights and colors; it opens with `openLayer` like a layer.
 * With `keepListening`, later messages from the same opener are taken too,
 * each answered with `<this app>:received`, so the sender can send again to
 * the open window (a second window.open by name would not reload it).
 * @param {object} options
 * @param {string[]} options.accept Apps whose messages are taken.
 * @param {string} [options.ready] This app's ready message type.
 * @param {Window} [options.win]
 * @param {(file: File) => void} [options.openFile]
 * @param {(file: File) => void} [options.openLayer]
 * @param {(from: string, kind: 'table'|'layer'|'scene', name: string) => void} [options.onReceived]
 * @param {boolean} [options.keepListening]
 */
export function installCraftHandoff({
  accept,
  ready = 'hev:ready',
  win = globalThis,
  openFile = (file) =>
    win.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { file } })),
  openLayer = () => {},
  onReceived = () => {},
  fetchImpl = globalThis.fetch?.bind(globalThis),
  keepListening = false,
}) {
  const hash = handoffHash(win);
  const from = new URLSearchParams(hash).get('from');
  const idle = {
    waiting: false,
    from: null,
    stop: () => {},
    reply: () => false,
  };
  if (!from || !accept.includes(from)) return idle;
  const { pathname, search } = win.location;
  win.history?.replaceState?.(null, '', `${pathname}${search}`);
  // A desktop app (StatCraft) has no browser window to post from: it
  // serves the file once on this computer and names it in `fetch=`.
  const fetchUrl = new URLSearchParams(hash).get('fetch');
  if (fetchUrl) {
    if (!isLoopbackFetch(fetchUrl)) return idle;
    const done = fetchHandoff({
      from,
      url: fetchUrl,
      fetchImpl,
      openFile,
      openLayer,
      onReceived,
    });
    return { ...idle, waiting: true, from, done };
  }
  const opener = win.opener;
  if (!opener) return idle;

  let replyOrigin = null;
  const stop = () => win.removeEventListener('message', onMessage);
  const onMessage = (event) => {
    if (event.source !== opener || !isLoopbackOrigin(event.origin)) return;
    const data = event.data;
    if (data?.version !== 1) return;
    let kind;
    if (data.type === `${from}:table` && typeof data.csv === 'string') {
      kind = 'table';
      openFile(
        new File([data.csv], csvName(data.fileName), { type: 'text/csv' }),
      );
    } else if (
      (data.type === `${from}:layer` || data.type === `${from}:scene`) &&
      data.geojson
    ) {
      kind = data.type.endsWith(':scene') ? 'scene' : 'layer';
      const text =
        typeof data.geojson === 'string'
          ? data.geojson
          : JSON.stringify(data.geojson);
      const base = String(data.fileName || data.name || `${from}-layer`)
        .split(/[\/]/)
        .pop()
        .trim();
      openLayer(
        new File(
          [text],
          /\.(geo)?json$/i.test(base) ? base : `${base}.geojson`,
          { type: 'application/geo+json' },
        ),
      );
    } else return;
    replyOrigin = event.origin;
    if (keepListening)
      opener.postMessage(
        { type: ready.replace(/:ready$/, ':received'), version: 1 },
        event.origin,
      );
    else stop();
    onReceived(from, kind, typeof data.name === 'string' ? data.name : '');
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

/** Whether `url` is an http address on this computer (fetch= hand-off). */
export function isLoopbackFetch(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' && isLoopbackOrigin(new URL(url).origin);
  } catch {
    return false;
  }
}

/** Largest file a fetch= hand-off takes (bytes). */
const FETCH_LIMIT = 64 * 1024 * 1024;

/**
 * Fetch a file a desktop app is serving on this computer and open it: a
 * .csv as a table (Merge & Export), a .geojson or .json as a layer (My
 * files). Anything else, too large, or unreachable is left alone.
 * @returns {Promise<boolean>} whether something was opened
 */
async function fetchHandoff({
  from,
  url,
  fetchImpl,
  openFile,
  openLayer,
  onReceived,
}) {
  if (!fetchImpl) return false;
  try {
    const res = await fetchImpl(url, {
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const text = await res.text();
    if (text.length > FETCH_LIMIT) return false;
    const base = decodeURIComponent(
      new URL(url).pathname.split('/').pop() || '',
    ).trim();
    if (/\.csv$/i.test(base)) {
      openFile(new File([text], csvName(base), { type: 'text/csv' }));
    } else if (/\.(geo)?json$/i.test(base)) {
      JSON.parse(text);
      openLayer(new File([text], base, { type: 'application/geo+json' }));
    } else return false;
    onReceived(from);
    return true;
  } catch {
    return false;
  }
}
