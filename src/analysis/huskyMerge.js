/**
 * MergeCraft: Husky Eye View's Merge & Export as an app of its own (the
 * page is husky-merge/index.html, served by scripts/husky-merge.mjs). The
 * same panel, worker and engine — convert a file, or merge it with census
 * data and download it with the do-file, R script, steps and codebook that
 * replicate the merge — on a light 2D map instead of the globe. Everything
 * runs in the browser; files never leave the computer.
 */
import { FlatMap } from './flatMap.js';
import { MergePanel } from './mergePanel.js';
import { installCraftHandoff } from './qualcraftHandoff.js';

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
    dataName: 'MergeCraft',
    closable: false,
    analysis: false,
    showToast: toastHost ? toaster(toastHost) : () => {},
  });
  panel.open();
  // MapCraft ▸ Add census measures in MergeCraft opens this page at
  // #from=mapcraft with a GEOID table as Your file; a button then sends the
  // merged table back to MapCraft, which joins it to the layer.
  const toast = toastHost ? toaster(toastHost) : () => {};
  const handoff = installCraftHandoff({
    accept: ['mapcraft'],
    ready: 'mergecraft:ready',
    onReceived: () => {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'hm-send-back';
      back.textContent = 'Send the merged table back to MapCraft';
      back.addEventListener('click', async () => {
        if (!panel.file) return toast('Choose your file first.');
        try {
          const file = await panel.call('csv');
          const sent = handoff.reply({
            type: 'mergecraft:table',
            version: 1,
            fileName: file.fileName,
            csv: new TextDecoder().decode(file.bytes),
          });
          toast(
            sent
              ? 'Sent to MapCraft: add it there from the banner, then join it by GEOID.'
              : 'MapCraft is no longer open. Download the table instead.',
          );
        } catch (e) {
          toast(e?.message || String(e));
        }
      });
      panelHost?.prepend(back);
    },
  });
  return { map, panel, handoff };
}
