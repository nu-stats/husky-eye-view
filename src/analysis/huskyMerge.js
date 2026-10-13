/**
 * Husky Merge: Husky Eye View's Merge & Export as an app of its own (the
 * page is husky-merge/index.html, served by scripts/husky-merge.mjs). The
 * same panel, worker and engine — convert a file, or merge it with census
 * data and download it with the do-file, R script, steps and codebook that
 * replicate the merge — on a light 2D map instead of the globe. Everything
 * runs in the browser; files never leave the computer.
 */
import { FlatMap } from './flatMap.js';
import { MergePanel } from './mergePanel.js';

/** An app file (Census outlines and data); a page sent for a missing file is missing. */
async function readContext(path) {
  const response = await fetch(new URL(path, document.baseURI).href);
  if (
    !response.ok ||
    /text\/html/i.test(response.headers.get('content-type') || '')
  )
    throw new Error(`${path}: not found`);
  return response.text();
}

/** A short message at the bottom of the page. */
function toaster(host) {
  let timer = 0;
  return (text) => {
    host.textContent = text;
    host.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      host.hidden = true;
    }, 6000);
  };
}

export function startHuskyMerge({
  panelHost = document.getElementById('hm-panel'),
  mapHost = document.getElementById('hm-map'),
  toastHost = document.getElementById('hm-toast'),
} = {}) {
  const map = new FlatMap({ host: mapHost, readContext });
  const panel = new MergePanel({
    container: panelHost,
    mapView: map,
    title: 'CONVERT & MERGE',
    kicker: 'DATA',
    dataName: 'Husky Merge',
    closable: false,
    analysis: false,
    showToast: toastHost ? toaster(toastHost) : () => {},
  });
  panel.open();
  return { map, panel };
}
