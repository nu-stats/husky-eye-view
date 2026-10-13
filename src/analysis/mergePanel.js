/**
 * Merge & Export (Analysis menu), two ways:
 *
 *  1. Convert a file — your CSV, Excel, Stata, SPSS, R, GeoJSON or shapefile
 *     saved as CSV, Excel, Stata (.dta), SPSS (.sav) or R (.RData / .rds),
 *     labels and dates kept.
 *  2. Merge with the map's data — your file (and a second file of yours)
 *     with the app's data, downloaded with a Stata do-file, an R script and
 *     a description of every step, so the merge can be checked and repeated;
 *     or sent to the Stata, R, SPSS or Excel box.
 *
 * All the work runs in a worker (mergeWorker.js), so large files never
 * freeze the page; the map draws a preview once per file (outlines for a
 * few areas, a dot per area for many). Files never leave the computer
 * unless sent to an analysis box, which runs on this computer's own server.
 */
import { EXPORT_FORMATS, LEVEL_NOUN, READ_FORMATS } from './mergeData.js';
import {
  deleteSavedFile,
  listSavedFiles,
  loadSavedFile,
  saveFile,
} from './savedFiles.js';

export const MERGE_OPEN_EVENT = 'gev:merge-export-open';
const ENGINES = [
  ['stata', 'Stata'],
  ['r', 'R'],
  ['spss', 'SPSS'],
  ['excel', 'Excel'],
];
const MODES = {
  convert: 'Convert a file',
  merge: 'Merge with the map’s data',
};

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children))
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  return node;
}

const button = (text, title, primary = false) =>
  element('button', {
    type: 'button',
    className: primary ? 'curated-button curated-start' : 'curated-button',
    textContent: text,
    ...(title && { title }),
  });

const sizeText = (n) =>
  n < 1048576
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1048576).toFixed(1)} MB`;

/** Save bytes as a download. */
function download(fileName, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = element('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Show or hide a block (a flex row's display would override `hidden`). */
function show(node, on) {
  node.hidden = !on;
  node.style.display = on ? '' : 'none';
}

export class MergePanel {
  constructor({
    viewer = null,
    showToast = () => {},
    openAnalysis = async () => null,
    createWorker,
  } = {}) {
    this.viewer = viewer;
    this.showToast = showToast;
    this.openAnalysis = openAnalysis;
    this.mode = 'merge';
    this.file = null; // summary of your file
    this.second = null;
    this.busy = false;
    this.overlay = null;
    this.removers = [];
    this.requests = new Map();
    this.nextId = 0;
    this.worker = (
      createWorker ||
      (() =>
        new Worker(new URL('./mergeWorker.js', import.meta.url), {
          type: 'module',
        }))
    )();
    this.worker.onmessage = ({ data }) => this.onWorker(data);
    this.ready = this.call('init', { baseUrl: document.baseURI });
    this.build();
    const onOpen = () => this.open();
    window.addEventListener(MERGE_OPEN_EVENT, onOpen);
    this.removers.push(() =>
      window.removeEventListener(MERGE_OPEN_EVENT, onOpen),
    );
  }

  // ---------- the worker ----------

  call(op, args = {}, transfer = []) {
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, args }, transfer);
    });
  }

  onWorker({ id, ok, result, error, progress }) {
    const request = this.requests.get(id);
    if (!request) return;
    if (progress) {
      this.setStatus(progress);
      return;
    }
    this.requests.delete(id);
    if (ok) request.resolve(result);
    else request.reject(new Error(error));
  }

  /** Run a step with the buttons off and its errors shown. */
  async work(task) {
    if (this.busy)
      return { ok: false, error: 'Busy with the last step; one moment.' };
    this.busy = true;
    this.sync();
    try {
      await this.ready;
      return await task();
    } catch (error) {
      return this.fail(error.message);
    } finally {
      this.busy = false;
      this.sync();
    }
  }

  // ---------- the panel ----------

  build() {
    this.root = element('section', {
      id: 'merge-export-panel',
      className: 'curated-panel area-reports-panel stata-panel merge-panel',
      role: 'dialog',
      ariaLabel: 'Merge & Export',
      hidden: true,
    });
    const close = element('button', {
      type: 'button',
      className: 'curated-close',
      ariaLabel: 'Close Merge & Export',
      textContent: '×',
    });
    close.addEventListener('click', () => this.close());
    const step = (n, title) =>
      element('p', { className: 'curated-label merge-step' }, [
        element('span', { className: 'merge-step-n', textContent: String(n) }),
        title,
      ]);

    // What to do.
    this.modeButtons = Object.entries(MODES).map(([mode, text]) => {
      const b = element('button', {
        type: 'button',
        className: 'merge-mode',
        textContent: text,
        ariaPressed: 'false',
      });
      b.addEventListener('click', () => this.setMode(mode));
      return [mode, b];
    });
    this.modeHint = element('p', { className: 'curated-hint merge-mode-hint' });

    // Your file.
    this.fileInput = element('input', {
      type: 'file',
      accept: READ_FORMATS,
      hidden: true,
      ariaLabel: 'Choose your file',
    });
    this.fileInput.addEventListener(
      'change',
      () => void this.chooseFile(this.fileInput.files?.[0], 'first'),
    );
    this.chooseButton = button(
      'CHOOSE YOUR FILE',
      'CSV, Excel, Stata (.dta), SPSS (.sav), R (.RData, .rds), GeoJSON or a zipped shapefile',
      true,
    );
    this.chooseButton.addEventListener('click', () => {
      this.fileInput.value = '';
      this.fileInput.click();
    });
    this.savedList = element('select', { ariaLabel: 'Your saved files' });
    this.savedList.addEventListener('change', () => this.sync());
    this.openSaved = button('OPEN', 'Open the saved file');
    this.openSaved.addEventListener(
      'click',
      () => void this.openSavedFile('first'),
    );
    this.forgetSaved = button(
      'REMOVE',
      'Remove the saved file from this computer',
    );
    this.forgetSaved.addEventListener(
      'click',
      () => void this.removeSavedFile(),
    );
    this.keep = element('input', {
      type: 'checkbox',
      ariaLabel: 'Keep it in Your saved files',
    });
    this.info = element('p', {
      className: 'curated-hint merge-info',
      textContent: 'No file yet.',
    });
    this.showMap = element('input', {
      type: 'checkbox',
      checked: true,
      ariaLabel: 'Show on the map',
    });
    this.showMap.addEventListener('change', () => void this.drawMap());
    this.shadeBy = element('select', { ariaLabel: 'Shade the map by' });
    this.shadeBy.addEventListener('change', () => void this.drawMap());
    this.mapRow = element('div', { className: 'curated-options' }, [
      element('label', { className: 'curated-check' }, [
        this.showMap,
        ' Show on the map',
      ]),
      element('label', { className: 'curated-check' }, [
        'Shade by ',
        this.shadeBy,
      ]),
    ]);

    // Option 1: convert.
    this.convertFormat = this.formatSelect('Save as');
    this.convertCodebook = element('input', {
      type: 'checkbox',
      ariaLabel: 'Add a codebook (ZIP)',
    });
    this.convertButton = button(
      'DOWNLOAD',
      'Download your file in the chosen format',
      true,
    );
    this.convertButton.addEventListener('click', () => void this.convert());
    this.convertBox = element('div', { className: 'merge-section' }, [
      step(2, 'Save it as'),
      element('div', { className: 'curated-options' }, [
        element('label', { className: 'curated-check' }, [
          'Format ',
          this.convertFormat,
        ]),
        element('label', { className: 'curated-check' }, [
          this.convertCodebook,
          ' With a codebook (ZIP)',
        ]),
      ]),
      element('div', { className: 'curated-options' }, [this.convertButton]),
      element('p', {
        className: 'curated-hint',
        textContent:
          'Variable labels, value labels, missing values and dates are kept. SPSS keeps text up to 255 characters, Stata 2,045.',
      }),
    ]);

    // Option 2: merge.
    this.secondInput = element('input', {
      type: 'file',
      accept: READ_FORMATS,
      hidden: true,
      ariaLabel: 'Choose a second file',
    });
    this.secondInput.addEventListener(
      'change',
      () => void this.chooseFile(this.secondInput.files?.[0], 'second'),
    );
    this.secondButton = button(
      'CHOOSE A SECOND FILE',
      'Another file of yours, linked by a shared column',
    );
    this.secondButton.addEventListener('click', () => {
      this.secondInput.value = '';
      this.secondInput.click();
    });
    this.secondSaved = button(
      'USE THE SAVED FILE',
      'Use the file chosen in Your saved files as the second file',
    );
    this.secondSaved.addEventListener(
      'click',
      () => void this.openSavedFile('second'),
    );
    this.secondInfo = element('p', { className: 'curated-hint' });
    this.leftKey = element('select', {
      ariaLabel: 'Linking column in your file',
    });
    this.rightKey = element('select', {
      ariaLabel: 'Linking column in the second file',
    });
    this.keepRows = element('select', { ariaLabel: 'Which rows to keep' }, [
      element('option', {
        value: 'left',
        textContent: 'Every row of your file',
      }),
      element('option', {
        value: 'inner',
        textContent: 'Only rows in both files',
      }),
      element('option', {
        value: 'outer',
        textContent: 'Every row of both files',
      }),
    ]);
    this.mergeButton = button('MERGE FILES');
    this.mergeButton.addEventListener('click', () => void this.mergeSecond());
    this.secondBox = element('div', { className: 'merge-second' }, [
      element('div', { className: 'curated-options' }, [
        element('label', { className: 'curated-check' }, [
          'Your file’s column ',
          this.leftKey,
        ]),
        element('label', { className: 'curated-check' }, [
          'Second file’s column ',
          this.rightKey,
        ]),
      ]),
      element('div', { className: 'curated-options' }, [
        element('label', { className: 'curated-check' }, [
          'Keep ',
          this.keepRows,
        ]),
        this.mergeButton,
      ]),
    ]);
    this.choices = element('div', { className: 'merge-choices' });
    this.addButton = button(
      'ADD THE DATA',
      'Attach the ticked data to every row of your file',
      true,
    );
    this.addButton.addEventListener('click', () => void this.addData());
    this.countLevel = element(
      'select',
      { ariaLabel: 'Count points per' },
      ['tract', 'county', 'state'].map((v) =>
        element('option', { value: v, textContent: v }),
      ),
    );
    this.countButton = button(
      'COUNT POINTS',
      'A table of areas with the number of your points in each, and a rate per 1,000 residents',
    );
    this.countButton.addEventListener('click', () => void this.count());
    this.countBox = element('div', { className: 'curated-options' }, [
      element('label', { className: 'curated-check' }, [
        'Or count your points per ',
        this.countLevel,
      ]),
      this.countButton,
    ]);
    this.mergeFormat = this.formatSelect('Format of the merged data');
    this.downloadButton = button(
      'DOWNLOAD',
      'The merged data, a Stata do-file, an R script and a description of every step, in a ZIP',
      true,
    );
    this.downloadButton.addEventListener(
      'click',
      () => void this.downloadMerged(),
    );
    this.resetButton = button('START OVER', 'Back to your file as it was read');
    this.resetButton.addEventListener('click', () => void this.reset());
    this.sendButtons = ENGINES.map(([id, name]) => {
      const b = button(
        name.toUpperCase(),
        `Open the merged data in the ${name} box, ready to analyze`,
      );
      b.addEventListener('click', () => void this.sendTo(id));
      return b;
    });
    this.mergeBox = element('div', { className: 'merge-section' }, [
      step(2, 'Merge with another of your files (optional)'),
      element('div', { className: 'curated-options' }, [
        this.secondButton,
        this.secondSaved,
      ]),
      this.secondInfo,
      this.secondBox,
      step(3, 'Add Husky Eye View data'),
      this.choices,
      element('div', { className: 'curated-options' }, [this.addButton]),
      this.countBox,
      step(4, 'Download, or analyze it'),
      element('div', { className: 'curated-options' }, [
        element('label', { className: 'curated-check' }, [
          'Format ',
          this.mergeFormat,
        ]),
        this.downloadButton,
        this.resetButton,
      ]),
      element('p', {
        className: 'curated-hint',
        textContent:
          'The download is a ZIP: the merged data, a Stata do-file and an R script that rebuild it from the files included and check the result, a description of every step (.txt), and a codebook.',
      }),
      element('div', { className: 'curated-options merge-send' }, [
        element('span', {
          className: 'curated-hint',
          textContent: 'Analyze in ',
        }),
        ...this.sendButtons,
      ]),
    ]);
    this.statusLine = element('p', {
      className: 'curated-status',
      ariaLive: 'polite',
    });
    this.preview = element('div', { className: 'merge-preview' });

    this.root.append(
      element('header', { className: 'curated-header' }, [
        element('span', { className: 'curated-kicker', textContent: 'DATA' }),
        element('strong', { textContent: 'MERGE & EXPORT' }),
        close,
      ]),
      element('div', { className: 'curated-form' }, [
        element(
          'div',
          { className: 'merge-modes', role: 'group', ariaLabel: 'What to do' },
          this.modeButtons.map(([, b]) => b),
        ),
        this.modeHint,
        step(1, 'Your file'),
        element('div', { className: 'curated-options' }, [this.chooseButton]),
        element('div', { className: 'curated-options merge-saved' }, [
          element('label', { className: 'curated-check' }, [
            'Your saved files ',
            this.savedList,
          ]),
          this.openSaved,
          this.forgetSaved,
        ]),
        element('label', { className: 'curated-check' }, [
          this.keep,
          ' Keep files I choose in Your saved files (only on this computer)',
        ]),
        this.info,
        this.mapRow,
        this.convertBox,
        this.mergeBox,
        element('p', {
          className: 'curated-hint',
          textContent:
            'Every row of your file is kept. Your files stay on this computer; restricted research data is never added. Each source keeps its own terms.',
        }),
      ]),
      this.statusLine,
      this.preview,
      this.fileInput,
      this.secondInput,
    );
    document.body.append(this.root);
    this.setMode(this.mode);
    this.fillChoices([]);
  }

  formatSelect(label) {
    return element(
      'select',
      { ariaLabel: label },
      Object.entries(EXPORT_FORMATS).map(([value, f]) =>
        element('option', { value, textContent: f.label }),
      ),
    );
  }

  setMode(mode) {
    this.mode = mode;
    for (const [m, b] of this.modeButtons) {
      b.classList.toggle('active', m === mode);
      b.setAttribute('aria-pressed', String(m === mode));
    }
    this.modeHint.textContent =
      mode === 'convert'
        ? 'Open a CSV, Excel, Stata, SPSS, R, GeoJSON or shapefile file and save it in another format.'
        : 'Add the map’s data (and a second file of yours) to your file, then download it with a do-file and the steps, so the merge can be checked and repeated.';
    show(this.convertBox, mode === 'convert');
    show(this.mergeBox, mode === 'merge');
    this.showInfo();
    this.sync();
  }

  open() {
    this.root.hidden = false;
    this.root.classList.add('visible');
    void this.refreshSaved();
  }

  close() {
    this.root.classList.remove('visible');
    this.root.hidden = true;
  }

  status() {
    return {
      open: !this.root.hidden,
      busy: this.busy,
      mode: this.mode,
      file: this.file?.file || null,
      rows: this.file?.rows || 0,
      columns: this.file?.columns?.length || 0,
      log: this.file?.steps || [],
    };
  }

  setStatus(text) {
    this.statusLine.textContent = text;
  }

  fail(message) {
    this.setStatus(message);
    return { ok: false, error: message };
  }

  sync() {
    const has = Boolean(this.file);
    const join = this.file?.join;
    const off = (b, cond) => {
      b.disabled = this.busy || !cond;
    };
    off(this.chooseButton, true);
    off(this.convertButton, has);
    off(this.secondButton, has);
    off(this.secondSaved, has && this.savedList.value);
    off(this.mergeButton, has && this.second);
    off(this.addButton, has && join && join.kind !== 'none');
    off(this.countButton, has && join?.kind === 'points');
    off(this.downloadButton, has);
    off(this.resetButton, has && (this.file?.steps?.length || 0) > 1);
    for (const b of this.sendButtons) off(b, has);
    off(this.openSaved, this.savedList.value);
    off(this.forgetSaved, this.savedList.value);
    show(this.countBox, join?.kind === 'points');
    show(this.secondBox, Boolean(this.second));
    show(this.mapRow, has && join && join.kind !== 'none');
  }

  // ---------- saved files ----------

  async refreshSaved() {
    const files = await listSavedFiles();
    const previous = this.savedList.value;
    this.savedList.replaceChildren(
      ...(files.length
        ? files.map((f) =>
            element('option', {
              value: f.id,
              textContent: `${f.name} (${sizeText(f.size)})`,
            }),
          )
        : [element('option', { value: '', textContent: 'None yet' })]),
    );
    if (files.some((f) => f.id === previous)) this.savedList.value = previous;
    this.sync();
  }

  async openSavedFile(which) {
    const saved = await loadSavedFile(this.savedList.value);
    if (!saved) return this.fail('That saved file is no longer here.');
    return this.readBytes(saved.name, saved.bytes, which, { keep: false });
  }

  async removeSavedFile() {
    if (!this.savedList.value) return;
    await deleteSavedFile(this.savedList.value);
    await this.refreshSaved();
    this.setStatus('Removed from Your saved files.');
  }

  // ---------- your file ----------

  async chooseFile(file, which) {
    if (!file) return { ok: false, error: 'No file chosen.' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    return this.readBytes(file.name, bytes, which, { keep: this.keep.checked });
  }

  async readBytes(name, bytes, which, { keep = false } = {}) {
    return this.work(async () => {
      this.setStatus(`Reading ${name}…`);
      if (keep) {
        const saved = await saveFile(name, bytes);
        if (!saved.ok) this.showToast(saved.problem);
        await this.refreshSaved();
      }
      const copy = bytes.slice();
      const result = await this.call(
        'open',
        { name, bytes: copy.buffer, which },
        [copy.buffer],
      );
      if (which === 'second') {
        this.second = { name, ...result };
        this.fillKeys(result.keys);
        this.secondInfo.textContent = `${name}: ${result.rows.toLocaleString('en-US')} rows, ${result.columns} columns. Choose the column that links it to your file.`;
        this.setStatus('');
        return { ok: true, rows: result.rows };
      }
      this.second = null;
      this.secondInfo.textContent = '';
      await this.afterChange(result, { redraw: true, fly: true });
      this.setStatus(
        `${result.describe}${result.notes.length ? ` ${result.notes.join(' ')}` : ''}`,
      );
      return { ok: true, rows: result.rows, columns: result.columns.length };
    });
  }

  fillKeys(suggestions = []) {
    const options = (names) =>
      names.map((n) => element('option', { value: n, textContent: n }));
    this.leftKey.replaceChildren(
      ...options(this.file.columns.map((c) => c.name)),
    );
    this.rightKey.replaceChildren(...options(this.second.columnNames || []));
    const [best] = suggestions;
    if (best) {
      this.leftKey.value = best.left;
      this.rightKey.value = best.right;
    }
  }

  /** After a step: info, data choices, preview, and the map when asked. */
  async afterChange(summary, { redraw = false, fly = false } = {}) {
    this.file = summary;
    this.showInfo();
    const numeric = summary.columns.filter(
      (c) => c.kind === 'numeric' && !/^hev_/.test(c.name),
    );
    const previous = this.shadeBy.value;
    this.shadeBy.replaceChildren(
      element('option', {
        value: '',
        textContent:
          summary.join.kind === 'points' ? 'Dots only' : 'Outlines only',
      }),
      ...numeric.map((c) =>
        element('option', { value: c.name, textContent: c.name }),
      ),
    );
    this.shadeBy.value = numeric.some((c) => c.name === previous)
      ? previous
      : redraw
        ? numeric.at(-1)?.name || ''
        : '';
    this.fillChoices(await this.call('choices'));
    await this.renderPreview();
    this.sync();
    if (redraw) void this.drawMap({ fly });
  }

  /** One line on your file: how it joins (merging), or just its size. */
  showInfo() {
    const f = this.file;
    if (!f) return;
    this.info.textContent =
      this.mode === 'convert'
        ? `${f.file}: ${f.rows.toLocaleString('en-US')} rows, ${f.columns.length} columns.${f.notes.length ? ` ${f.notes.join(' ')}` : ''}`
        : `${f.file}: ${f.describe} ${f.columns.length} columns.`;
  }

  fillChoices(groups) {
    const join = this.file?.join;
    if (!join || join.kind === 'none') {
      this.choices.replaceChildren(
        element('p', {
          className: 'curated-hint',
          textContent: join
            ? 'Your file has no census IDs or coordinates, so there is nothing on the map to attach (it can still be merged with another of your files).'
            : 'Choose your file first.',
        }),
      );
      return;
    }
    const level = (i) =>
      i.level === 'point' ? 'at each point' : `by ${LEVEL_NOUN[i.level]}`;
    this.choices.replaceChildren(
      ...groups.map(({ group, items }) =>
        element('details', { className: 'merge-group' }, [
          element('summary', { textContent: `${group} (${items.length})` }),
          ...items.map((i) =>
            element(
              'label',
              { className: 'curated-check merge-item', title: i.source },
              [
                element('input', { type: 'checkbox', value: i.id }),
                ` ${i.label} `,
                element('span', {
                  className: 'merge-level',
                  textContent: level(i),
                }),
              ],
            ),
          ),
        ]),
      ),
    );
  }

  ticked() {
    return [
      ...this.choices.querySelectorAll('input[type=checkbox]:checked'),
    ].map((c) => c.value);
  }

  async renderPreview() {
    const p = await this.call('preview');
    const fmt = (v) =>
      v === null || v === undefined
        ? '·'
        : typeof v === 'number'
          ? v.toLocaleString('en-US', { maximumFractionDigits: 3 })
          : String(v);
    this.preview.replaceChildren(
      element('details', { className: 'stata-variables' }, [
        element('summary', {
          textContent: `Preview: ${p.rows.toLocaleString('en-US')} rows × ${p.offset + p.columns.length} columns${p.offset ? ` (last ${p.columns.length} shown)` : ''}`,
        }),
        element('div', { className: 'merge-table-wrap' }, [
          element('table', { className: 'merge-table' }, [
            element('thead', {}, [
              element(
                'tr',
                {},
                p.columns.map((c) =>
                  element('th', {
                    textContent: c.name,
                    title: c.label || c.name,
                  }),
                ),
              ),
            ]),
            element(
              'tbody',
              {},
              p.sample.map((row) =>
                element(
                  'tr',
                  {},
                  row.map((v) => element('td', { textContent: fmt(v) })),
                ),
              ),
            ),
          ]),
        ]),
      ]),
    );
  }

  // ---------- option 1: convert ----------

  async convert(
    format = this.convertFormat.value,
    { codebook = this.convertCodebook.checked } = {},
  ) {
    if (!this.file) return this.fail('Choose your file first.');
    return this.work(async () => {
      this.setStatus(`Writing ${EXPORT_FORMATS[format].label}…`);
      const file = await this.call('convert', { format, codebook });
      return this.deliver(file, format);
    });
  }

  deliver(file, format) {
    download(file.fileName, file.bytes, file.mime);
    const renamed = file.renames.length
      ? ` ${file.renames.length} variable name${file.renames.length === 1 ? ' was' : 's were'} changed to fit ${EXPORT_FORMATS[format].label.split(' ')[0]}: ${file.renames
          .slice(0, 4)
          .map(([a, b]) => `${a} → ${b}`)
          .join(', ')}${file.renames.length > 4 ? ', …' : ''}.`
      : '';
    this.setStatus(
      `Downloaded ${file.fileName} (${sizeText(file.bytes.length)}).${renamed}${file.notes.length ? ` ${file.notes.join(' ')}` : ''}`,
    );
    return { ok: true, fileName: file.fileName, bytes: file.bytes.length };
  }

  // ---------- option 2: merge ----------

  async mergeSecond() {
    if (!this.file || !this.second)
      return this.fail('Choose your file and a second file first.');
    return this.work(async () => {
      const report = await this.call('merge', {
        leftKey: this.leftKey.value,
        rightKey: this.rightKey.value,
        keep: this.keepRows.value,
      });
      this.second = null;
      await this.afterChange(await this.call('summary'));
      this.setStatus(
        `Merged ${report.other} on ${report.leftKey} = ${report.rightKey} (${report.relation}): ${report.matched.toLocaleString('en-US')} matched, ${report.onlyA.toLocaleString('en-US')} only in your file, ${report.onlyB.toLocaleString('en-US')} only in ${report.other}; ${report.rows.toLocaleString('en-US')} rows.`,
      );
      return { ok: true, ...report };
    });
  }

  async addData(ids = this.ticked()) {
    if (!this.file) return this.fail('Choose your file first.');
    if (!ids.length) return this.fail('Tick the data to add first.');
    return this.work(async () => {
      const report = await this.call('attach', { ids });
      await this.afterChange(await this.call('summary'));
      this.setStatus(
        `Added ${ids.length === 1 ? 'the data' : `${ids.length} kinds of data`}: ${report.matchedRows.toLocaleString('en-US')} of ${report.rows.toLocaleString('en-US')} rows matched.${report.notes.length ? ` ${report.notes.join(' ')}` : ''}`,
      );
      return {
        ok: true,
        rows: report.rows,
        matched: report.matchedRows,
        added: report.attached,
      };
    });
  }

  async count(level = this.countLevel.value) {
    if (this.file?.join.kind !== 'points')
      return this.fail('Counting needs a file of points.');
    return this.work(async () => {
      const report = await this.call('count', { level });
      await this.afterChange(await this.call('summary'), { redraw: true });
      this.setStatus(
        `Counted the points per ${LEVEL_NOUN[level]}: ${report.withPoints.toLocaleString('en-US')} of ${report.areas.toLocaleString('en-US')} areas have points. ${report.notes.join(' ')} Data can now be added to this table.`,
      );
      return { ok: true, areas: report.areas };
    });
  }

  async reset() {
    if (!this.file) return;
    return this.work(async () => {
      await this.afterChange(await this.call('reset'), { redraw: true });
      this.setStatus('Back to your file as it was read.');
      return { ok: true };
    });
  }

  async downloadMerged(format = this.mergeFormat.value) {
    if (!this.file) return this.fail('Choose your file first.');
    return this.work(async () => {
      this.setStatus(
        'Writing the merged data, the do-file, the R script and the steps…',
      );
      return this.deliver(await this.call('exportMerged', { format }), format);
    });
  }

  /** Hand the merged table to an analysis box as its "Your own file". */
  async sendTo(engine) {
    if (!this.file) return this.fail('Choose your file first.');
    const name = ENGINES.find(([id]) => id === engine)?.[1] || engine;
    return this.work(async () => {
      this.setStatus(`Sending the data to ${name}…`);
      const file = await this.call('csv');
      const panel = await this.openAnalysis(engine);
      if (!panel?.uploadFile) return this.fail(`${name} is not available.`);
      const result = await panel.uploadFile(
        new File([file.bytes], file.fileName, { type: 'text/csv' }),
      );
      if (!result?.ok)
        return this.fail(
          result?.problems?.join(' ') || `${name} could not take the file.`,
        );
      panel.open?.();
      this.setStatus(`The data is open in ${name} as “${result.name}”.`);
      return { ok: true, engine, rows: result.rows };
    });
  }

  // ---------- the map ----------

  /** Your file on the map: outlines for a few areas, dots for many, points. */
  async drawMap({ fly = false } = {}) {
    if (!this.viewer || !this.file) return;
    if (!this.overlay) {
      const { UserDataOverlay } = await import('../curated/userOverlay.js');
      this.overlay = new UserDataOverlay({
        viewer: this.viewer,
        requestRender: () => this.viewer?.scene?.requestRender?.(),
      });
    }
    this.overlay.clear();
    if (!this.showMap.checked || this.file.join.kind === 'none') return;
    const column = this.shadeBy.value;
    let map;
    try {
      map = await this.call('map', { column });
    } catch {
      return;
    }
    if (!map.records.length) return;
    const records = map.records.map((r) =>
      r.geometry
        ? {
            geoid: r.geoid,
            level: 'area',
            point: null,
            geometry: r.geometry,
            props: { value: r.value },
          }
        : {
            geoid: null,
            level: 'point',
            point: r.point,
            geometry: { type: 'Point', coordinates: r.point },
            props: { value: r.value },
          },
    );
    try {
      this.overlay.draw(
        {
          name: this.file.file,
          kind: map.mode === 'polygons' ? 'areas' : 'points',
          level: 'area',
          records,
        },
        {
          column: column ? 'value' : null,
          label: column || this.file.file,
          clamp: map.mode === 'polygons',
        },
      );
    } catch {
      return; // the map is only a preview
    }
    if (map.mode === 'dots')
      this.setStatus(
        `${this.statusLine.textContent} The map shows a dot per area (${map.total.toLocaleString('en-US')} areas).`.trim(),
      );
    if (fly) await this.flyTo(map.records);
  }

  async flyTo(records) {
    let box = null;
    const grow = ([x, y]) => {
      box = box
        ? [
            Math.min(box[0], x),
            Math.min(box[1], y),
            Math.max(box[2], x),
            Math.max(box[3], y),
          ]
        : [x, y, x, y];
    };
    for (const r of records) {
      if (r.point) grow(r.point);
      else if (r.geometry) {
        const rings =
          r.geometry.type === 'Polygon'
            ? [r.geometry.coordinates[0]]
            : r.geometry.coordinates.map((p) => p[0]);
        for (const ring of rings)
          for (let k = 0; k < ring.length; k += 8) grow(ring[k]);
      }
    }
    if (!box || !this.viewer?.camera) return;
    const Cesium = await import('cesium');
    const pad = Math.max(
      0.02,
      (box[2] - box[0]) * 0.15,
      (box[3] - box[1]) * 0.15,
    );
    this.viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(
        box[0] - pad,
        box[1] - pad,
        box[2] + pad,
        box[3] + pad,
      ),
      duration: 2,
    });
  }

  // ---------- voice ----------

  /**
   * Voice: with no data named, convert your file to `format`; otherwise add
   * the data (after counting points, if asked) and download the merged ZIP
   * and/or send it to a box.
   */
  async voiceMerge({
    measures = [],
    countPer = null,
    format = null,
    sendTo = null,
  } = {}) {
    this.open();
    if (!this.file)
      return this.fail(
        'Choose your file in Merge & Export first (the file picker needs a click).',
      );
    if (!measures.length && !countPer && format && !sendTo) {
      this.setMode('convert');
      return this.convert(format);
    }
    this.setMode('merge');
    if (countPer) {
      const counted = await this.count(countPer);
      if (!counted.ok) return counted;
    }
    let added = [];
    if (measures.length) {
      await this.ready;
      const ids = await this.call('findItems', { phrases: measures });
      if (!ids.length)
        return this.fail(
          `None of “${measures.join(', ')}” can be added to this file.`,
        );
      const result = await this.addData(ids);
      if (!result.ok) return result;
      added = ids;
    }
    let file = null;
    if (format) {
      const result = await this.downloadMerged(format);
      if (!result.ok) return result;
      file = result.fileName;
    }
    if (sendTo) {
      const result = await this.sendTo(sendTo);
      if (!result.ok) return result;
    }
    const { file: source, ...state } = this.status();
    return { ...state, ok: true, source, added, file, sentTo: sendTo };
  }

  destroy() {
    this.overlay?.clear();
    this.worker.terminate();
    for (const reject of [...this.requests.values()].map((r) => r.reject))
      reject(new Error('Closed.'));
    for (const remove of this.removers.splice(0)) remove();
    this.root.remove();
  }
}
