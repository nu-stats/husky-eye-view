/**
 * Open a file someone picked in a file box when it is compressed (.zip, .gz,
 * .bz2, .xz, .zst, .tar and the combinations), before the box reads it. When
 * the archive holds several files that fit the box, a small window asks which
 * one (or, where the box takes several, which ones) to use.
 */
import { acceptExtensions, isCompressedName } from '../data/unpack/names.js';

export {
  COMPRESSED_ACCEPT,
  isCompressedName,
  withCompressed,
} from '../data/unpack/names.js';

// The decoders (~40 KB) load with the first compressed file, not at boot.
const archiveReaders = () => import('../data/unpack/openArchive.js');

const sizeText = (bytes) =>
  bytes >= 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

const STYLE = {
  dialog: {
    background: '#08141e',
    color: '#e3faff',
    border: '1px solid #656565',
    borderRadius: '6px',
    padding: '18px 20px',
    width: 'min(520px,calc(100vw - 32px))',
    boxSizing: 'border-box',
    position: 'fixed',
    inset: '0',
    margin: 'auto',
    height: 'fit-content',
    zIndex: '10000',
    maxHeight: 'calc(100vh - 32px)',
    overflow: 'auto',
    font: '14px/1.5 sans-serif',
  },
  button: {
    background: '#10242e',
    color: '#e3faff',
    border: '1px solid #656565',
    borderRadius: '3px',
    padding: '6px 10px',
    margin: '6px 6px 0 0',
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
  },
};

/**
 * Ask which of an archive's files to use. Resolves to the chosen files, or an
 * empty list when the window is closed without a choice.
 */
export function chooseFromArchive(
  files,
  archiveName,
  { multiple = false, document: doc = globalThis.document } = {},
) {
  return new Promise((resolve) => {
    const dialog = doc.createElement('dialog');
    dialog.className = 'hev-archive-pick';
    dialog.setAttribute('aria-label', `Choose a file from ${archiveName}`);
    Object.assign(dialog.style, STYLE.dialog);
    // Each button settles the choice itself: the dialog's close event can
    // wait for the next frame, which a hidden tab never draws.
    let settled = false;
    const finish = (chosen) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(chosen);
    };
    const head = doc.createElement('p');
    head.style.margin = '0 0 8px';
    const which = multiple ? 'ones' : 'one';
    head.textContent = `"${archiveName}" holds ${files.length} files. Which ${which}?`;
    const list = doc.createElement('ul');
    Object.assign(list.style, { listStyle: 'none', margin: 0, padding: 0 });
    const button = (label, onClick, parent) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      Object.assign(b.style, STYLE.button);
      b.addEventListener('click', onClick);
      parent.append(b);
      return b;
    };
    for (const file of files) {
      const li = doc.createElement('li');
      button(
        `${file.name} (${sizeText(file.bytes.length)})`,
        () => finish([file]),
        li,
      );
      list.append(li);
    }
    const footer = doc.createElement('div');
    footer.style.marginTop = '10px';
    if (multiple) button(`All ${files.length}`, () => finish(files), footer);
    button('Cancel', () => finish([]), footer);
    // Escape closes the dialog without a choice.
    dialog.addEventListener('close', () => finish([]));
    dialog.append(head, list, footer);
    doc.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Every file inside the picked files, without asking: for boxes that match
 * files by their path (scene data packs). A compressed file whose name is in
 * `keep` stays as it is. Each file from an archive carries its path inside
 * the archive as `webkitRelativePath`, as a folder pick would.
 * @param {File[]} files
 * @param {{keep?: Set<string>, maxBytes?: number}} [options]
 * @returns {Promise<File[]>}
 */
export async function openAllPicked(
  files,
  { keep = new Set(), maxBytes = 256 * 1024 * 1024 } = {},
) {
  const out = [];
  for (const file of files) {
    if (!isCompressedName(file.name) || keep.has(file.name)) {
      out.push(file);
      continue;
    }
    const { openArchive } = await archiveReaders();
    const inner = await openArchive(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      { maxBytes },
    );
    for (const entry of inner) {
      const opened = new File([entry.bytes], entry.name.split('/').pop());
      Object.defineProperty(opened, 'webkitRelativePath', {
        value: entry.name,
      });
      out.push(opened);
    }
  }
  return out;
}

/**
 * The files a box should read for one picked file: the file itself when it is
 * not compressed, otherwise the file(s) inside, as File objects named as in
 * the archive (without its folders). An empty list means the person closed
 * the chooser. Errors carry messages meant for the person.
 * @param {File} file
 * @param {{accept?: string, multiple?: boolean, maxBytes?: number,
 *   document?: Document}} [options] `accept` is the box's own accept list;
 *   `maxBytes` the most one unpacked file may be (the box's own limit).
 * @returns {Promise<File[]>}
 */
export async function openPicked(
  file,
  {
    accept = '',
    multiple = false,
    maxBytes = 250 * 1024 * 1024,
    document,
  } = {},
) {
  if (!file || !isCompressedName(file.name)) return file ? [file] : [];
  const { openArchive, offered } = await archiveReaders();
  // An archive may hold more than one box's worth; each file is checked below.
  const files = await openArchive(
    new Uint8Array(await file.arrayBuffer()),
    file.name,
    { maxBytes: Math.max(4 * maxBytes, 256 * 1024 * 1024) },
  );
  if (!files.length) throw new Error(`"${file.name}" has no files in it.`);
  // The original file, when it is a shapefile zip kept whole.
  if (
    files.length === 1 &&
    files[0].bytes.length === file.size &&
    files[0].name === file.name
  )
    return [file];
  const fit = offered(files, acceptExtensions(accept));
  const chosen =
    fit.length === 1
      ? fit
      : await chooseFromArchive(fit, file.name, { multiple, document });
  for (const entry of chosen)
    if (entry.bytes.length > maxBytes)
      throw new Error(
        `"${entry.name}" in ${file.name} unpacks to ${sizeText(entry.bytes.length)}; the limit is ${sizeText(maxBytes)}.`,
      );
  return chosen.map(
    (entry) => new File([entry.bytes], entry.name.split('/').pop()),
  );
}
