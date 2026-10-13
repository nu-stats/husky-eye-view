/**
 * Merge & Export (Analysis menu): your own file on the map, merged with a
 * second file of yours and with the app's data, then downloaded as CSV,
 * Excel, Stata, SPSS or R, with a codebook, or sent straight to the Stata,
 * R, SPSS or Excel box. Everything runs in the browser (mergeData.js); the
 * files never leave the computer unless sent to an analysis box, which runs
 * on this computer's own server.
 */
import {
  EXPORT_FORMATS,
  attachData,
  countPoints,
  describeJoin,
  exportBundle,
  exportTable,
  findJoin,
  findMergeItems,
  LEVEL_NOUN,
  mergeChoices,
  mergeTables,
  readTable,
  suggestKeys,
} from './mergeData.js';
import {
  deleteSavedFile,
  listSavedFiles,
  loadSavedFile,
  saveFile,
} from './savedFiles.js';

export const MERGE_OPEN_EVENT = 'gev:merge-export-open';
const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,.geojson,.json,.geojsonl,.zip';
const ENGINES = [
  ['stata', 'Stata'],
  ['r', 'R'],
  ['spss', 'SPSS'],
  ['excel', 'Excel'],
];
const MAX_MAP_COUNTIES = 400;
/** Dots drawn at most (a preview; every row is still exported). */
const MAX_MAP_POINTS = 50_000;
const PREVIEW_ROWS = 6;
const PREVIEW_COLUMNS = 12;

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

/** Save bytes as a download. */
function download(fileName, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = element('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A file from the app (public/), relative to the page. */
function contextReader(fetchImpl) {
  return async (path) => {
    const response = await fetchImpl(new URL(path, document.baseURI).href);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  };
}

export class MergePanel {
  constructor({
    viewer = null,
    showToast = () => {},
    openAnalysis = async () => null,
    fetchImpl,
  } = {}) {
    this.viewer = viewer;
    this.showToast = showToast;
    this.openAnalysis = openAnalysis;
    this.fetch = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.readContext = contextReader(this.fetch);
    this.base = null; // {table, join, bytes, name}
    this.current = null; // {table, join}
    this.second = null; // {table}
    this.log = [];
    this.busy = false;
    this.overlay = null;
    this.removers = [];
    this.build();
    const onOpen = () => this.open();
    window.addEventListener(MERGE_OPEN_EVENT, onOpen);
    this.removers.push(() =>
      window.removeEventListener(MERGE_OPEN_EVENT, onOpen),
    );
  }

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

    // 1. Your file.
    this.fileInput = element('input', {
      type: 'file',
      accept: ACCEPT,
      hidden: true,
      ariaLabel: 'Choose your file',
    });
    this.fileInput.addEventListener(
      'change',
      () => void this.chooseFile(this.fileInput.files?.[0], 'first'),
    );
    this.chooseButton = button(
      'CHOOSE YOUR FILE',
      'A CSV, Excel workbook, GeoJSON or zipped shapefile',
      true,
    );
    this.chooseButton.addEventListener('click', () => {
      this.fileInput.value = '';
      this.fileInput.click();
    });
    this.savedList = element('select', { ariaLabel: 'Your saved files' });
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

    // 2. A second file of yours.
    this.secondInput = element('input', {
      type: 'file',
      accept: ACCEPT,
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
    this.secondBox = element(
      'div',
      { className: 'merge-second', hidden: true },
      [
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
      ],
    );

    // 3. The app's data.
    this.choices = element('div', { className: 'merge-choices' });
    this.addButton = button(
      'ADD THE DATA',
      'Attach the ticked data to every row of your file',
      true,
    );
    this.addButton.addEventListener('click', () => void this.addData());
    this.countLevel = element('select', { ariaLabel: 'Count points per' }, [
      element('option', { value: 'tract', textContent: 'tract' }),
      element('option', { value: 'county', textContent: 'county' }),
      element('option', { value: 'state', textContent: 'state' }),
    ]);
    this.countButton = button(
      'COUNT POINTS',
      'Make a table of areas with the number of your points in each, and a rate per 1,000 residents',
    );
    this.countButton.addEventListener('click', () => void this.count());
    this.countBox = element(
      'div',
      { className: 'curated-options', hidden: true },
      [
        element('label', { className: 'curated-check' }, [
          'Or count your points per ',
          this.countLevel,
        ]),
        this.countButton,
      ],
    );

    // 4. Export or send.
    this.format = element(
      'select',
      { ariaLabel: 'File format' },
      Object.entries(EXPORT_FORMATS).map(([value, f]) =>
        element('option', { value, textContent: f.label }),
      ),
    );
    this.bundle = element('input', {
      type: 'checkbox',
      checked: true,
      ariaLabel: 'With the codebook and README (ZIP)',
    });
    this.downloadButton = button(
      'DOWNLOAD',
      'Download your data with everything attached',
      true,
    );
    this.downloadButton.addEventListener(
      'click',
      () => void this.downloadData(),
    );
    this.sendButtons = ENGINES.map(([id, name]) => {
      const b = button(
        name.toUpperCase(),
        `Open the merged data in the ${name} box, ready to analyze`,
      );
      b.addEventListener('click', () => void this.sendTo(id));
      return b;
    });
    this.resetButton = button('START OVER', 'Back to your file as it was read');
    this.resetButton.addEventListener('click', () => this.reset());
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
        element('div', { className: 'curated-options' }, [
          element('label', { className: 'curated-check' }, [
            this.showMap,
            ' Show on the map',
          ]),
          element('label', { className: 'curated-check' }, [
            'Shade by ',
            this.shadeBy,
          ]),
        ]),
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
            this.format,
          ]),
          element('label', { className: 'curated-check' }, [
            this.bundle,
            ' With codebook and README (ZIP)',
          ]),
        ]),
        element('div', { className: 'curated-options' }, [
          this.downloadButton,
          this.resetButton,
        ]),
        element('div', { className: 'curated-options merge-send' }, [
          element('span', {
            className: 'curated-hint',
            textContent: 'Analyze in ',
          }),
          ...this.sendButtons,
        ]),
        element('p', {
          className: 'curated-hint',
          textContent:
            'Every row of your file is kept. Your files stay on this computer; restricted research data is never added. Each source keeps its own terms (see the README).',
        }),
      ]),
      this.statusLine,
      this.preview,
      this.fileInput,
      this.secondInput,
    );
    document.body.append(this.root);
    this.fillChoices();
    this.sync();
  }

  /** Show or hide a block (a flex row's display would override `hidden`). */
  static show(node, on) {
    node.hidden = !on;
    node.style.display = on ? '' : 'none';
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
      file: this.base?.name || null,
      rows: this.current?.table.rows.length || 0,
      columns: this.current?.table.columns.length || 0,
      log: [...this.log],
    };
  }

  setStatus(text) {
    this.statusLine.textContent = text;
  }

  fail(message) {
    this.setStatus(message);
    return { ok: false, error: message };
  }

  /** Enable the steps that apply. */
  sync() {
    const has = Boolean(this.current);
    const join = this.current?.join;
    for (const b of [
      this.secondButton,
      this.secondSaved,
      this.downloadButton,
      this.resetButton,
      ...this.sendButtons,
    ])
      b.disabled = !has || this.busy;
    this.addButton.disabled =
      !has || this.busy || !join || join.kind === 'none';
    MergePanel.show(this.countBox, join?.kind === 'points');
    this.countButton.disabled = this.busy;
    this.mergeButton.disabled = !this.second || this.busy;
    this.chooseButton.disabled = this.busy;
    this.openSaved.disabled = this.busy || !this.savedList.value;
    this.forgetSaved.disabled = this.busy || !this.savedList.value;
    this.secondSaved.disabled = !has || this.busy || !this.savedList.value;
  }

  async refreshSaved() {
    const files = await listSavedFiles();
    const previous = this.savedList.value;
    this.savedList.replaceChildren(
      ...(files.length
        ? files.map((f) =>
            element('option', {
              value: f.id,
              textContent: `${f.name} (${f.size < 1048576 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1048576).toFixed(1)} MB`})`,
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
    const id = this.savedList.value;
    if (!id) return;
    await deleteSavedFile(id);
    await this.refreshSaved();
    this.setStatus('Removed from Your saved files.');
  }

  async chooseFile(file, which) {
    if (!file) return { ok: false, error: 'No file chosen.' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    return this.readBytes(file.name, bytes, which, { keep: this.keep.checked });
  }

  /** Read a file (yours, or the second one) and show what it joins by. */
  async readBytes(name, bytes, which, { keep = false } = {}) {
    this.busy = true;
    this.sync();
    this.setStatus(`Reading ${name}…`);
    try {
      const table = await readTable(name, bytes);
      if (keep) {
        const saved = await saveFile(name, bytes);
        if (!saved.ok) this.showToast(saved.problem);
        await this.refreshSaved();
      }
      if (which === 'second') {
        this.second = { table };
        this.fillKeys();
        this.secondInfo.textContent = `${name}: ${table.rows.length.toLocaleString('en-US')} rows, ${table.columns.length} columns. Choose the column that links it to your file.`;
        MergePanel.show(this.secondBox, true);
        this.setStatus('');
      } else {
        const join = findJoin(table);
        this.base = { name, table, join };
        this.second = null;
        MergePanel.show(this.secondBox, false);
        this.secondInfo.textContent = '';
        this.log = [
          `Read ${name}${table.sheet ? ` (sheet ${table.sheet})` : ''}: ${describeJoin(table, join)}`,
        ];
        this.current = { table, join };
        this.flyPending = true;
        this.afterChange();
        this.setStatus(describeJoin(table, join));
      }
      return {
        ok: true,
        rows: table.rows.length,
        columns: table.columns.length,
      };
    } catch (error) {
      return this.fail(error.message);
    } finally {
      this.busy = false;
      this.sync();
    }
  }

  fillKeys() {
    const a = this.current.table;
    const b = this.second.table;
    const options = (table) =>
      table.columns.map((c) =>
        element('option', { value: c.name, textContent: c.name }),
      );
    this.leftKey.replaceChildren(...options(a));
    this.rightKey.replaceChildren(...options(b));
    const [best] = suggestKeys(a, b);
    if (best) {
      this.leftKey.value = best.left;
      this.rightKey.value = best.right;
    }
  }

  async mergeSecond() {
    if (!this.current || !this.second)
      return this.fail('Choose your file and a second file first.');
    try {
      const { table, report } = mergeTables(
        this.current.table,
        this.second.table,
        {
          leftKey: this.leftKey.value,
          rightKey: this.rightKey.value,
          keep: this.keepRows.value,
        },
      );
      const kept = {
        left: 'every row of your file',
        inner: 'only rows in both files',
        outer: 'every row of both files',
      }[report.keep];
      const line = `Merged ${report.other} on ${report.leftKey} = ${report.rightKey} (${report.relation}), keeping ${kept}: ${report.matched.toLocaleString('en-US')} matched, ${report.onlyA.toLocaleString('en-US')} only in your file, ${report.onlyB.toLocaleString('en-US')} only in ${report.other}; ${report.rows.toLocaleString('en-US')} rows.`;
      this.log.push(line);
      this.current = { table, join: findJoin(table) };
      this.second = null;
      MergePanel.show(this.secondBox, false);
      this.secondInfo.textContent = '';
      this.afterChange();
      this.setStatus(
        `${line}${report.relation === '1:m' ? ' Rows of your file repeat where the second file has the same key more than once.' : ''}`,
      );
      return { ok: true, ...report };
    } catch (error) {
      return this.fail(error.message);
    }
  }

  /** The data choices for the current join, as ticks by group. */
  fillChoices() {
    const join = this.current?.join;
    if (!join || join.kind === 'none') {
      this.choices.replaceChildren(
        element('p', {
          className: 'curated-hint',
          textContent: join
            ? 'Your file has no census IDs or coordinates, so there is nothing on the map to attach.'
            : 'Choose your file first.',
        }),
      );
      return;
    }
    const level = (i) =>
      i.level === 'point' ? 'at each point' : `by ${LEVEL_NOUN[i.level]}`;
    this.choices.replaceChildren(
      ...mergeChoices(join).map(({ group, items }) =>
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

  async addData(ids = this.ticked()) {
    if (!this.current) return this.fail('Choose your file first.');
    if (!ids.length) return this.fail('Tick the data to add first.');
    this.busy = true;
    this.sync();
    try {
      const { table, report } = await attachData(
        this.current.table,
        this.current.join,
        ids,
        {
          readContext: this.readContext,
          onProgress: (text) => this.setStatus(text),
        },
      );
      const labels =
        ids.length <= 4
          ? ids.map((id) => id.split(':')[1]).join(', ')
          : `${ids.length} kinds of data`;
      const line = `Added ${labels} from Husky Eye View: ${report.matchedRows.toLocaleString('en-US')} of ${report.rows.toLocaleString('en-US')} rows matched.${report.notes.length ? ` ${report.notes.join(' ')}` : ''}`;
      this.log.push(line);
      this.current = { table, join: this.current.join };
      this.afterChange({ keepChoices: true });
      this.setStatus(line);
      return {
        ok: true,
        rows: report.rows,
        matched: report.matchedRows,
        added: report.attached,
      };
    } catch (error) {
      return this.fail(error.message);
    } finally {
      this.busy = false;
      this.sync();
    }
  }

  async count(level = this.countLevel.value) {
    if (this.current?.join.kind !== 'points')
      return this.fail('Counting needs a file of points.');
    this.busy = true;
    this.sync();
    try {
      const result = await countPoints(
        this.current.table,
        this.current.join,
        level,
        {
          readContext: this.readContext,
          onProgress: (text) => this.setStatus(text),
        },
      );
      const line = `Counted the points per ${LEVEL_NOUN[level]}: ${result.report.withPoints.toLocaleString('en-US')} of ${result.report.areas.toLocaleString('en-US')} areas have points. ${result.report.notes.join(' ')}`;
      this.log.push(line);
      this.current = { table: result.table, join: result.join };
      this.afterChange();
      this.setStatus(`${line} Data can now be added to this table.`);
      return { ok: true, areas: result.report.areas };
    } catch (error) {
      return this.fail(error.message);
    } finally {
      this.busy = false;
      this.sync();
    }
  }

  reset() {
    if (!this.base) return;
    this.current = { table: this.base.table, join: this.base.join };
    this.log = this.log.slice(0, 1);
    this.afterChange();
    this.setStatus('Back to your file as it was read.');
  }

  afterChange({ keepChoices = false } = {}) {
    if (!keepChoices) this.fillChoices();
    else
      for (const box of this.choices.querySelectorAll('input:checked'))
        box.checked = false;
    const { table, join } = this.current;
    this.info.textContent = `${this.base.name}: ${describeJoin(table, join)} ${table.columns.length} columns.`;
    const numeric = table.columns.filter(
      (c) => c.kind === 'numeric' && !/^hev_/.test(c.name),
    );
    const previous = this.shadeBy.value;
    this.shadeBy.replaceChildren(
      element('option', {
        value: '',
        textContent: join.kind === 'points' ? 'Dots only' : 'Outlines only',
      }),
      ...numeric.map((c) =>
        element('option', { value: c.name, textContent: c.name }),
      ),
    );
    if (numeric.some((c) => c.name === previous)) this.shadeBy.value = previous;
    else this.shadeBy.value = numeric.at(-1)?.name || '';
    this.renderPreview();
    this.sync();
    void this.drawMap();
  }

  renderPreview() {
    const { table } = this.current;
    const cols = table.columns.slice(-PREVIEW_COLUMNS);
    const offset = table.columns.length - cols.length;
    this.preview.replaceChildren(
      element('details', { className: 'stata-variables', open: false }, [
        element('summary', {
          textContent: `Preview: ${table.rows.length.toLocaleString('en-US')} rows × ${table.columns.length} columns${offset ? ` (last ${cols.length} shown)` : ''}`,
        }),
        element('div', { className: 'merge-table-wrap' }, [
          element('table', { className: 'merge-table' }, [
            element('thead', {}, [
              element(
                'tr',
                {},
                cols.map((c) =>
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
              table.rows.slice(0, PREVIEW_ROWS).map((row) =>
                element(
                  'tr',
                  {},
                  cols.map((_, j) => {
                    const v = row[offset + j];
                    return element('td', {
                      textContent:
                        v === null || v === undefined
                          ? '·'
                          : typeof v === 'number'
                            ? v.toLocaleString('en-US', {
                                maximumFractionDigits: 3,
                              })
                            : String(v),
                    });
                  }),
                ),
              ),
            ),
          ]),
        ]),
      ]),
    );
  }

  /** Your file on the map: areas shaded (or outlined), points as dots. */
  async drawMap() {
    if (!this.viewer || !this.current) return;
    const { table, join } = this.current;
    if (!this.overlay) {
      const { UserDataOverlay } = await import('../curated/userOverlay.js');
      this.overlay = new UserDataOverlay({
        viewer: this.viewer,
        requestRender: () => this.viewer?.scene?.requestRender?.(),
      });
    }
    this.overlay.clear();
    if (!this.showMap.checked || join.kind === 'none') return;
    const column = this.shadeBy.value;
    const j = table.columns.findIndex((c) => c.name === column);
    const records = [];
    table.rows.forEach((row, i) => {
      const props = { value: j >= 0 ? row[j] : null };
      if (join.kind === 'points') {
        const p = join.points[i];
        if (p)
          records.push({
            geoid: null,
            level: 'point',
            point: p,
            geometry: { type: 'Point', coordinates: p },
            props,
          });
      } else if (join.ids[i])
        records.push({
          geoid: join.ids[i],
          level: join.level,
          point: null,
          geometry: null,
          props,
        });
    });
    let outlines = new Map();
    if (join.kind === 'geoid') {
      const shapes = await import('../curated/userShapes.js');
      const ids = [
        ...new Set(
          records.map((r) =>
            join.level === 'block group' ? r.geoid.slice(0, 11) : r.geoid,
          ),
        ),
      ];
      const add = (map) => {
        for (const id of ids) if (map.has(id)) outlines.set(id, map.get(id));
      };
      try {
        if (join.level === 'state') add(await shapes.stateShapes(this.fetch));
        else if (join.level === 'county')
          for (const s of new Set(ids.map((g) => g.slice(0, 2))))
            add(await shapes.countyShapes(s, this.fetch));
        else if (join.level === 'tract' || join.level === 'block group') {
          const counties = [...new Set(ids.map((g) => g.slice(0, 5)))];
          if (counties.length > MAX_MAP_COUNTIES) {
            this.setStatus(
              `${this.statusLine.textContent} Too many tracts to draw at once; the data is all there for export.`.trim(),
            );
            return;
          }
          (
            await Promise.all(
              counties.map((c) => shapes.tractShapes(c, this.fetch)),
            )
          ).forEach(add);
        } else return; // cities: no outlines to draw
      } catch {
        return;
      }
    }
    const drawn = records.slice(0, MAX_MAP_POINTS);
    const dataset = {
      name: this.base.name,
      kind: join.kind === 'points' ? 'points' : 'areas',
      level: join.level || 'point',
      records: drawn,
    };
    try {
      this.overlay.draw(
        dataset,
        { column: j >= 0 ? 'value' : null, label: column || this.base.name },
        outlines,
      );
      if (this.flyPending) {
        this.flyPending = false;
        await this.flyTo(drawn, outlines);
      }
    } catch {
      // The map is a preview: the data is unaffected.
    }
  }

  /** Fly to the drawn data (once per new file). */
  async flyTo(records, outlines) {
    const { geometryBbox } = await import('../curated/userData.js');
    let box = null;
    const grow = (b) => {
      if (!b) return;
      box = box
        ? [
            Math.min(box[0], b[0]),
            Math.min(box[1], b[1]),
            Math.max(box[2], b[2]),
            Math.max(box[3], b[3]),
          ]
        : [...b];
    };
    for (const r of records) {
      if (r.point) grow([r.point[0], r.point[1], r.point[0], r.point[1]]);
      else if (r.geoid && outlines.has(r.geoid))
        grow(geometryBbox(outlines.get(r.geoid)));
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

  async downloadData(
    format = this.format.value,
    { bundle = this.bundle.checked } = {},
  ) {
    if (!this.current) return this.fail('Choose your file first.');
    this.busy = true;
    this.sync();
    try {
      this.setStatus(`Writing ${EXPORT_FORMATS[format].label}…`);
      const file = bundle
        ? await exportBundle(this.current.table, format, { log: this.log })
        : await exportTable(this.current.table, format);
      download(file.fileName, file.bytes, file.mime);
      const renamed = file.renames.length
        ? ` ${file.renames.length} variable name${file.renames.length === 1 ? ' was' : 's were'} changed to fit ${EXPORT_FORMATS[format].label.split(' ')[0]} (see the codebook).`
        : '';
      const size =
        file.bytes.length < 1048576
          ? `${Math.max(1, Math.round(file.bytes.length / 1024))} KB`
          : `${(file.bytes.length / 1048576).toFixed(1)} MB`;
      this.setStatus(
        `Downloaded ${file.fileName} (${size}).${renamed}${file.notes.length ? ` ${file.notes.join(' ')}` : ''}`,
      );
      return { ok: true, fileName: file.fileName, bytes: file.bytes.length };
    } catch (error) {
      return this.fail(error.message);
    } finally {
      this.busy = false;
      this.sync();
    }
  }

  /** Hand the merged table to an analysis box as its "Your own file". */
  async sendTo(engine) {
    if (!this.current) return this.fail('Choose your file first.');
    const name = ENGINES.find(([id]) => id === engine)?.[1] || engine;
    this.busy = true;
    this.sync();
    try {
      this.setStatus(`Sending the merged data to ${name}…`);
      const file = await exportTable(this.current.table, 'csv');
      const panel = await this.openAnalysis(engine);
      if (!panel?.uploadFile) return this.fail(`${name} is not available.`);
      const result = await panel.uploadFile(
        new File([file.bytes], file.fileName.replace(/\.csv$/, '_merged.csv'), {
          type: 'text/csv',
        }),
      );
      if (!result?.ok)
        return this.fail(
          result?.problems?.join(' ') || `${name} could not take the file.`,
        );
      panel.open?.();
      this.setStatus(`The merged data is open in ${name} as “${result.name}”.`);
      return { ok: true, engine, rows: result.rows };
    } catch (error) {
      return this.fail(error.message);
    } finally {
      this.busy = false;
      this.sync();
    }
  }

  /**
   * Voice: add data by name ("poverty", "life expectancy"), optionally count
   * points first, then download in a format and/or send to a box.
   */
  async voiceMerge({
    measures = [],
    countPer = null,
    format = null,
    sendTo = null,
  } = {}) {
    this.open();
    if (!this.current)
      return this.fail(
        'Choose your file in Merge & Export first (the file picker needs a click).',
      );
    if (countPer) {
      const counted = await this.count(countPer);
      if (!counted.ok) return counted;
    }
    let added = [];
    if (measures.length) {
      const ids = findMergeItems(this.current.join, measures);
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
      const result = await this.downloadData(format);
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
    for (const remove of this.removers.splice(0)) remove();
    this.root.remove();
  }
}
