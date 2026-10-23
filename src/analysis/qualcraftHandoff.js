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
