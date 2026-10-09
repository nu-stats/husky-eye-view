/**
 * The Stata Analysis, R Analysis, SPSS Analysis and Excel Analysis panels
 * (the Analysis menu) and the controller the voice assistant shares.
 * Commands or an uploaded script run on this computer against a layer's
 * data (counties, a state's tracts, states, the areas in the current map
 * view) or your own Excel workbook or CSV; "Open in Stata" / "Open in R" /
 * "Open in SPSS" / "Open in Excel" opens the program itself with that data
 * loaded. Each run is kept as a
 * session folder with its script and log (server/providers/analysis.js).
 */
import { STATES } from '../reports/areaReport.js';
import {
  STATA_COMMAND_NAMES,
  MAX_DO_FILE_BYTES,
  checkCommandLines,
} from './stataCommands.js';
import { MAX_R_SCRIPT_BYTES, checkRLines } from './rCommands.js';
import {
  MAX_SPSS_SYNTAX_BYTES,
  SPSS_COMMAND_NAMES,
  checkSpssLines,
} from './spssCommands.js';
import {
  EXCEL_COMMAND_NAMES,
  MAX_EXCEL_FILE_BYTES,
  checkExcelLines,
} from './excelCommands.js';
import { LAYER_MANIFEST, layerManifestEntry } from '../data/layerManifest.js';
import { translatePlainEnglish } from './plainEnglish.js';
import {
  AnalysisMap,
  legendRows,
  mapChoices,
  tableColumns,
  variableChoices,
} from './analysisMap.js';

/** Rows the data table draws at once (filter or sort to reach the rest). */
const TABLE_ROWS = 200;

/** The datasets that are not one layer: every Area Reports measure. */
const MEASURE_CHOICES = [
  ['measures:county', 'Counties: all measures'],
  ['measures:tract', 'Census tracts: all measures'],
  ['measures:state', 'States: all measures'],
];

/** What differs between the two programs; everything else is shared. */
export const ANALYSIS_ENGINES = Object.freeze({
  stata: {
    id: 'stata',
    name: 'Stata',
    event: 'gev:stata-analysis-open',
    api: '/api/stata',
    panelId: 'stata-analysis-panel',
    lineLabel: 'Commands (one per line)',
    examples: [
      'summarize foreign_born_share poverty median_income',
      'regress foreign_born_share poverty unemployment bachelors if median_income != ., vce(robust)',
      'twoway scatter foreign_born_share poverty',
    ],
    hint: `${STATA_COMMAND_NAMES.join(', ')} — with if, in and options. Spatial models get inverse-distance weights W built on the areas with valid values. Anything else: upload a do-file.`,
    scriptLabel: 'Do-file',
    scriptAccept: '.do,text/plain',
    scriptBytes: MAX_DO_FILE_BYTES,
    files: [
      'analysis.do',
      'analysis.log',
      'results.docx',
      'results.pdf',
      'results.tex',
      'results.xlsx',
      'data.dta',
      'data.xlsx',
    ],
    sessionFiles: 'session_commands.do, session.log',
    missing:
      'Stata was not found on this computer (looked for Stata 18 and 19). Set HEV_STATA_PATH to its program file.',
    found: (s) => `Stata ${s.version ?? ''} ${s.edition ?? ''} found.`,
    failed: (rc) => `r(${rc})`,
  },
  r: {
    id: 'r',
    name: 'R',
    event: 'gev:r-analysis-open',
    api: '/api/r',
    panelId: 'r-analysis-panel',
    lineLabel: 'R lines (one per line; the data frame is d)',
    examples: [
      'summary(d$foreign_born_share)',
      'm <- lm(foreign_born_share ~ poverty + unemployment, data = d)',
      'summary(m)',
      'plot(d$poverty, d$foreign_born_share)',
    ],
    hint: 'Models (lm, glm, glm.nb), summaries, tests, plots and spatial tools (moran.test, lagsarlm with contiguity weights W). Lines may call only these functions; anything else: upload an R script.',
    scriptLabel: 'R script',
    scriptAccept: '.R,.r,text/plain',
    scriptBytes: MAX_R_SCRIPT_BYTES,
    files: [
      'analysis.R',
      'analysis.log',
      'data.rds',
      'session.RData',
      'data.xlsx',
    ],
    sessionFiles: 'session_commands.R, session.log',
    missing:
      'R was not found on this computer. Install it from cran.r-project.org, or set HEV_R_PATH to Rscript.',
    found: (s) =>
      `R ${s.version ?? ''} found${s.rstudio ? ' (RStudio too)' : ''}.`,
    failed: () => 'error',
  },
  spss: {
    id: 'spss',
    name: 'SPSS',
    event: 'gev:spss-analysis-open',
    api: '/api/spss',
    panelId: 'spss-analysis-panel',
    lineLabel: 'SPSS commands (one per line; the period is optional)',
    examples: [
      'DESCRIPTIVES VARIABLES=foreign_born_share poverty median_income',
      'REGRESSION /DEPENDENT foreign_born_share /METHOD=ENTER poverty unemployment',
      'GRAPH /SCATTERPLOT(BIVAR)=poverty WITH foreign_born_share',
    ],
    hint: `${SPSS_COMMAND_NAMES.join(', ')} — one command per line, with its subcommands. A linear REGRESSION sends its residuals and fitted values to the map. Anything else: upload a syntax file.`,
    scriptLabel: 'Syntax file',
    scriptAccept: '.sps,text/plain',
    scriptBytes: MAX_SPSS_SYNTAX_BYTES,
    files: [
      'analysis.sps',
      'analysis.log',
      'output.spv',
      'output.html',
      'results.docx',
      'results.xlsx',
      'results.doc',
      'results.xls',
      'data.sav',
      'data.xlsx',
    ],
    sessionFiles: 'data.sav, and session.log for what you run',
    openNote:
      'In SPSS, choose Run ▸ All in the syntax window (open.sps) to load and label the data.',
    missing:
      'IBM SPSS Statistics was not found on this computer. Set HEV_SPSS_PATH to its program (stats.exe) or install folder.',
    found: (s) =>
      `SPSS Statistics ${s.version ?? ''} found${s.python ? '' : ' (its Python 3 is missing: RUN needs it; OPEN IN SPSS works)'}.`,
    failed: (rc) => `error level ${rc}`,
  },
  excel: {
    id: 'excel',
    name: 'Excel',
    event: 'gev:excel-analysis-open',
    api: '/api/excel',
    panelId: 'excel-analysis-panel',
    lineLabel: 'Excel Analysis commands (one per line)',
    examples: [
      'DESCRIPTIVE foreign_born_share poverty median_income',
      'REGRESSION foreign_born_share ON poverty unemployment',
      'SCATTER foreign_born_share poverty',
      '=CORREL(poverty, bachelors)',
    ],
    hint: `${EXCEL_COMMAND_NAMES.join(', ')} — each may end with IF poverty > 5 AND …. Each command becomes a sheet of analysis.xlsx with live Excel formulas (LINEST for regressions) and charts; REGRESSION sends its residuals to the map. Excel itself is needed only to open the workbook.`,
    scriptLabel: 'Command file',
    scriptAccept: '.txt,text/plain',
    scriptBytes: MAX_EXCEL_FILE_BYTES,
    files: ['analysis.xlsx', 'data.xlsx', 'commands.txt', 'analysis.log'],
    sessionFiles: 'data.xlsx',
    openNote: 'The session’s data opens as data.xlsx.',
    missing: 'Excel Analysis is not available.',
    found: (s) =>
      s.excel
        ? `Excel ${s.version ? `(Office ${s.version}) ` : ''}found; workbooks open in it.`
        : 'Excel was not found: workbooks are still built, and open in whatever opens .xlsx files here.',
    failed: () => 'error',
  },
});

/** Each program's line check (the same one its server runs). */
const LINE_CHECKS = {
  stata: checkCommandLines,
  r: checkRLines,
  spss: checkSpssLines,
  excel: checkExcelLines,
};

/**
 * Files uploaded in any box (Excel workbooks or CSVs), by id: every box can
 * analyze them, so they are listed in all of them.
 */
const UPLOADS = new Map();
/** The largest file the boxes accept (the server checks too). */
const MAX_UPLOAD_FILE_BYTES = 30 * 1024 * 1024;

/** Kept for existing imports: the Stata panel's open event. */
export const ANALYSIS_OPEN_EVENT = ANALYSIS_ENGINES.stata.event;

/** Zoomed in closer than this, "the current view" means tracts. */
const TRACT_VIEW_HEIGHT_M = 250_000;

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

/** Drag a floating window by its title bar, kept inside the window. */
function dragBy(handle, win) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    const box = win.getBoundingClientRect();
    const dx = event.clientX - box.left;
    const dy = event.clientY - box.top;
    handle.setPointerCapture(event.pointerId);
    const move = (e) => {
      const left = Math.max(
        0,
        Math.min(window.innerWidth - 80, e.clientX - dx),
      );
      const top = Math.max(
        0,
        Math.min(window.innerHeight - 40, e.clientY - dy),
      );
      Object.assign(win.style, {
        left: `${left}px`,
        top: `${top}px`,
        right: 'auto',
        bottom: 'auto',
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, children = []) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of [].concat(children))
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  return node;
};
const fmt = (v, digits = 3) =>
  Number.isFinite(v)
    ? v.toLocaleString('en-US', { maximumFractionDigits: digits })
    : '—';
const pText = (p) => (p < 0.001 ? 'p < 0.001' : `p = ${fmt(p, 3)}`);

/** Moran's I as GeoDa shows it: the numbers and the Moran scatter plot. */
function moranCard(r) {
  const size = 260;
  const pad = 30;
  const span = Math.min(
    5,
    Math.max(2, ...r.points.flat().map((v) => Math.abs(v))),
  );
  const at = (v) => pad + ((v + span) / (2 * span)) * (size - 2 * pad);
  const flip = (v) => size - at(v);
  const clamp = (v) => Math.max(-span, Math.min(span, v));
  const dots = r.points.map(([x, y]) =>
    svg('circle', {
      cx: at(clamp(x)).toFixed(1),
      cy: flip(clamp(y)).toFixed(1),
      r: 1.8,
      class: 'moran-dot',
    }),
  );
  const ends = [-span, span].map((x) => [x, clamp(r.I * x)]);
  const plot = svg(
    'svg',
    {
      viewBox: `0 0 ${size} ${size}`,
      class: 'moran-plot',
      role: 'img',
      'aria-label': `Moran scatter plot of ${r.variable}; slope ${fmt(r.I)}`,
    },
    [
      svg('rect', {
        x: pad,
        y: pad,
        width: size - 2 * pad,
        height: size - 2 * pad,
        class: 'moran-frame',
      }),
      svg('line', {
        x1: at(0),
        y1: pad,
        x2: at(0),
        y2: size - pad,
        class: 'moran-axis',
      }),
      svg('line', {
        x1: pad,
        y1: flip(0),
        x2: size - pad,
        y2: flip(0),
        class: 'moran-axis',
      }),
      ...dots,
      svg('line', {
        x1: at(ends[0][0]),
        y1: flip(ends[0][1]),
        x2: at(ends[1][0]),
        y2: flip(ends[1][1]),
        class: 'moran-slope',
      }),
      svg(
        'text',
        {
          x: size - pad - 4,
          y: pad + 12,
          'text-anchor': 'end',
          class: 'moran-quad',
        },
        'High–High',
      ),
      svg(
        'text',
        { x: pad + 4, y: size - pad - 6, class: 'moran-quad' },
        'Low–Low',
      ),
      svg('text', { x: pad + 4, y: pad + 12, class: 'moran-quad' }, 'Low–High'),
      svg(
        'text',
        {
          x: size - pad - 4,
          y: size - pad - 6,
          'text-anchor': 'end',
          class: 'moran-quad',
        },
        'High–Low',
      ),
      svg(
        'text',
        {
          x: size / 2,
          y: size - 8,
          'text-anchor': 'middle',
          class: 'moran-label',
        },
        `${r.variable} (standardized)`,
      ),
      svg(
        'text',
        {
          x: 10,
          y: size / 2,
          'text-anchor': 'middle',
          transform: `rotate(-90 10 ${size / 2})`,
          class: 'moran-label',
        },
        'Spatial lag',
      ),
    ],
  );
  const significant = r.pseudoP <= 0.05;
  const reading = !significant
    ? 'Not significant: no clear spatial pattern.'
    : r.I > 0
      ? 'Positive and significant: similar values cluster together.'
      : 'Negative and significant: neighbors tend to differ (a checkerboard).';
  return element('div', { className: 'stata-moran-card' }, [
    element('p', { className: 'stata-moran-i' }, [
      element('strong', { textContent: `Moran’s I = ${fmt(r.I, 4)}` }),
      ` for ${r.label || r.variable}`,
    ]),
    element('p', {
      textContent: `E[I] = ${fmt(r.expected, 4)} · z = ${fmt(r.z, 2)}, ${pText(r.p)} (randomization) · pseudo ${pText(r.pseudoP)} (${r.permutations} permutations)`,
    }),
    element('p', {
      textContent: `${r.n.toLocaleString('en-US')} areas · ${r.weights} · neighbors per area ${fmt(r.neighbors.mean, 2)} (${r.neighbors.min}–${r.neighbors.max})${r.islands ? ` · ${r.islands} without neighbors` : ''}`,
    }),
    element('p', { className: 'curated-hint', textContent: reading }),
    plot,
  ]);
}

export class AnalysisPanel {
  constructor({
    engine = 'stata',
    readView = () => null,
    readDataManager = () => null,
    showToast = () => {},
    fetchImpl,
    viewer = null,
  } = {}) {
    this.engine = ANALYSIS_ENGINES[engine];
    this.readView = readView;
    this.readDataManager = readDataManager;
    this.layerChosen = false;
    this.showToast = showToast;
    this.fetch = fetchImpl || ((...args) => globalThis.fetch(...args));
    // Results back on the map (fitted values, residuals, new variables).
    this.map = new AnalysisMap({ viewer, fetchImpl: this.fetch });
    this.busy = false;
    this.last = null;
    this.doFile = null;
    this.removers = [];
    this.build();
    const onOpen = () => this.open();
    window.addEventListener(this.engine.event, onOpen);
    this.removers.push(() =>
      window.removeEventListener(this.engine.event, onOpen),
    );
  }

  build() {
    this.root = element('section', {
      id: this.engine.panelId,
      className: 'curated-panel area-reports-panel stata-panel',
      role: 'dialog',
      ariaLabel: `${this.engine.name} Analysis`,
      hidden: true,
    });
    const close = element('button', {
      type: 'button',
      className: 'curated-close',
      ariaLabel: `Close ${this.engine.name} Analysis`,
      textContent: '×',
    });
    close.addEventListener('click', () => this.close());
    const select = (label, options) =>
      element(
        'select',
        { ariaLabel: label },
        options.map(([value, text]) =>
          element('option', { value, textContent: text }),
        ),
      );
    // Which data: one of the map's area layers (all of its fields), or every
    // Area Reports measure. Filled from the loaded layers when opened.
    this.layer = element('select', { ariaLabel: 'Layer' });
    this.scope = select('Areas', [
      ['view', 'In the map view'],
      ['state', 'In one state'],
      ['all', 'Everywhere'],
    ]);
    this.state = select('State', [
      ['', 'All states'],
      ...Object.entries(STATES)
        .sort((a, b) => a[1][1].localeCompare(b[1][1]))
        .map(([fips, [, name]]) => [fips, name]),
    ]);
    this.commands = element('textarea', {
      className: 'stata-commands',
      rows: 6,
      spellcheck: false,
      ariaLabel: this.engine.lineLabel,
      placeholder: this.engine.examples.join('\n'),
    });
    // Plain English: a sentence becomes the lines above, for review.
    this.plain = element('textarea', {
      className: 'stata-plain',
      rows: 2,
      ariaLabel: 'Ask in plain English',
      placeholder:
        'e.g. spatial regression DV = poverty, IV: unemployment rate, percent foreign-born',
    });
    this.translateButton = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: `WRITE THE ${this.engine.name.toUpperCase()} CODE`,
      title: `Turn the sentence into ${this.engine.name} lines (check them, then run)`,
    });
    this.plainNote = element('p', {
      className: 'curated-hint stata-plain-note',
    });
    this.translateButton.addEventListener('click', () => this.translate());
    this.plain.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void this.translate();
      }
    });
    this.doInput = element('input', {
      type: 'file',
      accept: this.engine.scriptAccept,
      ariaLabel: `Upload a ${this.engine.scriptLabel.toLowerCase()}`,
    });
    this.doName = element('span', { className: 'curated-hint' });
    this.doInput.addEventListener('change', () => this.readDoFile());
    this.runButton = element('button', {
      type: 'button',
      className: 'curated-button curated-start',
      textContent: `RUN IN ${this.engine.name.toUpperCase()}`,
    });
    this.runButton.addEventListener('click', () => this.run(this.readForm()));
    this.openButton = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: `OPEN IN ${this.engine.name.toUpperCase()}`,
      title: `Open ${this.engine.name} with this data loaded; your commands and results are saved as you work`,
    });
    this.openButton.addEventListener('click', () =>
      this.openStata(this.readForm()),
    );
    // The layer's data in a table you can pop out and brush on the map,
    // without running anything (works for every layer, program or not).
    this.browseButton = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'BROWSE DATA',
      title:
        'Open this layer’s data as a table: click rows to highlight them on the map',
    });
    this.browseButton.addEventListener('click', () =>
      this.browse(this.readForm()),
    );
    this.statusLine = element('p', {
      className: 'curated-status',
      ariaLive: 'polite',
    });
    this.variables = element('details', { className: 'stata-variables' }, [
      element('summary', { textContent: 'Variables' }),
    ]);
    // Moran's I in one click (computed by the server, as GeoDa shows it).
    this.moranVar = element('select', { ariaLabel: 'Variable for Moran’s I' });
    this.moranButton = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'MORAN’S I',
      title:
        'Global Moran’s I for this variable: queen contiguity, row-standardized, 999 permutations',
    });
    this.moranButton.addEventListener('click', () => void this.moran());
    this.moranOut = element('div', { className: 'stata-moran' });
    this.output = element('div', { className: 'stata-output' });
    // Your own Excel workbook or CSV, chosen from the Layer list.
    this.fileInput = element('input', {
      type: 'file',
      accept: '.xlsx,.xlsm,.csv,.tsv,.txt',
      ariaLabel: 'Upload your own Excel workbook or CSV file',
      hidden: true,
    });
    this.fileInput.addEventListener('change', () => void this.uploadFile());
    this.layer.addEventListener('change', () => {
      if (this.layer.value === 'upload:new') {
        this.layer.value = this.lastChoice || this.layer.options[0]?.value;
        this.fileInput.value = '';
        this.fileInput.click();
        return;
      }
      this.lastChoice = this.layer.value;
      this.layerChosen = true;
      void this.loadVariables();
    });
    this.scope.addEventListener('change', () => this.syncScope());
    this.root.append(
      element('header', { className: 'curated-header' }, [
        element('span', { className: 'curated-kicker', textContent: 'DATA' }),
        element('strong', {
          textContent: `${this.engine.name.toUpperCase()} ANALYSIS`,
        }),
        close,
      ]),
      element('div', { className: 'curated-form' }, [
        element('label', { className: 'curated-check stata-layer' }, [
          'Layer ',
          this.layer,
        ]),
        element('div', { className: 'curated-options' }, [
          element('label', { className: 'curated-check' }, [
            'Areas ',
            this.scope,
          ]),
          (this.stateLabel = element('label', { className: 'curated-check' }, [
            'State ',
            this.state,
          ])),
        ]),
        element('label', {
          className: 'curated-label',
          textContent: 'Ask in plain English (optional)',
        }),
        this.plain,
        element('div', { className: 'curated-options' }, [
          this.translateButton,
        ]),
        this.plainNote,
        element('label', {
          className: 'curated-label',
          textContent: this.engine.lineLabel,
        }),
        this.commands,
        element('p', {
          className: 'curated-hint',
          textContent: this.engine.hint,
        }),
        element('label', { className: 'curated-check' }, [
          `${this.engine.scriptLabel} `,
          this.doInput,
        ]),
        this.doName,
        element('div', { className: 'curated-options' }, [
          this.runButton,
          this.openButton,
          this.browseButton,
        ]),
        this.variables,
        element('div', { className: 'stata-moran-row' }, [
          element('label', { className: 'curated-check' }, [
            'Spatial autocorrelation ',
            this.moranVar,
          ]),
          this.moranButton,
        ]),
        this.moranOut,
      ]),
      this.statusLine,
      this.output,
      this.fileInput,
    );
    document.body.append(this.root);
    this.refreshLayers();
    this.syncScope();
  }

  /** The area layers this box can analyze, by Data Layers group. */
  analyzableLayers() {
    const manager = this.readDataManager?.();
    const modules = manager?.layers;
    if (!modules?.get) return [];
    const rows = new Map(
      (manager.getAll?.() || []).map((row) => [row.id, row]),
    );
    return LAYER_MANIFEST.filter((entry) => entry.group && !entry.off)
      .map((entry) => {
        const module = modules.get(entry.id)?.module;
        const row = rows.get(entry.id);
        if (!module?.analysisSource || row?.showInTogglePanel === false)
          return null;
        return {
          id: entry.id,
          name: entry.label || module.name,
          group: entry.group,
          baseUrl: module.analysisSource.baseUrl,
          enabled: Boolean(row?.enabled),
        };
      })
      .filter(Boolean);
  }

  /** Fill the Layer list; until the user picks, follow a layer that is on. */
  refreshLayers() {
    const layers = this.analyzableLayers();
    this.layerInfo = new Map(layers.map((l) => [`layer:${l.id}`, l]));
    for (const [id, upload] of UPLOADS)
      this.layerInfo.set(`upload:${id}`, {
        id: `upload:${id}`,
        name: upload.name,
        uploadId: id,
      });
    const previous = this.layer.value;
    const groups = new Map();
    for (const l of layers) {
      if (!groups.has(l.group)) groups.set(l.group, []);
      groups.get(l.group).push(l);
    }
    this.layer.replaceChildren(
      ...[...groups].map(([group, list]) =>
        element(
          'optgroup',
          { label: group },
          list.map((l) =>
            element('option', {
              value: `layer:${l.id}`,
              textContent: l.enabled ? `${l.name} (on)` : l.name,
            }),
          ),
        ),
      ),
      element(
        'optgroup',
        { label: 'Every Area Reports measure' },
        MEASURE_CHOICES.map(([value, text]) =>
          element('option', { value, textContent: text }),
        ),
      ),
      element('optgroup', { label: 'Your own file' }, [
        ...[...UPLOADS].map(([id, upload]) =>
          element('option', {
            value: `upload:${id}`,
            textContent: `${upload.name} (${upload.rows.toLocaleString('en-US')} rows)`,
          }),
        ),
        element('option', {
          value: 'upload:new',
          textContent: 'Upload an Excel workbook or CSV…',
        }),
      ]),
    );
    const on = layers.find((l) => l.enabled);
    this.layer.value =
      this.layerChosen &&
      [...this.layer.options].some((o) => o.value === previous)
        ? previous
        : on
          ? `layer:${on.id}`
          : 'measures:county';
    this.lastChoice = this.layer.value;
  }

  syncScope() {
    // The label's flex display would override the hidden attribute.
    this.stateLabel.style.display = this.scope.value === 'state' ? '' : 'none';
  }

  /** Show a resolved request's data in the Layer, Areas and State lists. */
  showChoice(resolved, request = {}) {
    const choice =
      request.choice ||
      this.layerValue(request.layer) ||
      (resolved.geography && !resolved.baseUrl
        ? `measures:${resolved.geography}`
        : null);
    if (choice && [...this.layer.options].some((o) => o.value === choice))
      this.layer.value = choice;
    const wanted = String(request.state || '')
      .trim()
      .toLowerCase();
    const fips = wanted
      ? Object.entries(STATES).find(
          ([code, [abbr, name]]) =>
            code === wanted ||
            abbr.toLowerCase() === wanted ||
            name.toLowerCase() === wanted,
        )?.[0]
      : null;
    if (fips) {
      this.scope.value = 'state';
      this.state.value = fips;
    } else this.scope.value = resolved.view ? 'view' : 'all';
    this.syncScope();
  }

  /** A layer by id or name (voice), as a Layer-list value. */
  layerValue(query) {
    if (!query) return null;
    const wanted = String(query).toLowerCase();
    for (const [value, l] of this.layerInfo || [])
      if (l.id === query || l.name.toLowerCase() === wanted) return value;
    for (const [value, l] of this.layerInfo || [])
      if (l.name.toLowerCase().includes(wanted)) return value;
    return null;
  }

  /**
   * Upload your own Excel workbook or CSV (the file the picker chose, or one
   * given): the server keeps it for every box, and it becomes the Layer.
   */
  async uploadFile(file = this.fileInput.files?.[0]) {
    if (!file) return { ok: false, problems: ['No file chosen.'] };
    if (file.size > MAX_UPLOAD_FILE_BYTES)
      return this.fail([
        `The file is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_UPLOAD_FILE_BYTES / 1048576} MB.`,
      ]);
    this.setStatus(`Reading ${file.name}…`);
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const result = await this.post('upload', { name: file.name, data });
    if (!result.ok)
      return this.fail(result.problems || ['The file could not be read.']);
    UPLOADS.set(result.id, { name: result.name, rows: result.rows });
    this.refreshLayers();
    this.layer.value = `upload:${result.id}`;
    this.lastChoice = this.layer.value;
    this.layerChosen = true;
    await this.loadVariables();
    const geo = result.geography
      ? `${result.rows.toLocaleString('en-US')} rows, joined to the map's ${
          { state: 'states', county: 'counties', tract: 'census tracts' }[
            result.geography
          ]
        } by ${result.join}`
      : `${result.rows.toLocaleString('en-US')} rows`;
    this.setStatus(
      `${result.name}${result.sheet ? ` (sheet ${result.sheet})` : ''}: ${geo}. ${(result.notes || []).join(' ')}`.trim(),
    );
    return result;
  }

  async readDoFile() {
    const file = this.doInput.files?.[0];
    this.doFile = null;
    this.doName.textContent = '';
    if (!file) return;
    if (file.size > this.engine.scriptBytes) {
      this.setStatus(
        `A script may be at most ${this.engine.scriptBytes / 1024} KB.`,
      );
      this.doInput.value = '';
      return;
    }
    this.doFile = await file.text();
    this.doName.textContent = `${file.name} runs after the commands, on the same data.`;
  }

  readForm() {
    return {
      choice: this.layer.value,
      scope: this.scope.value,
      state: this.state.value || null,
      commands: this.commands.value,
      doFile: this.doFile,
    };
  }

  /**
   * The request the server gets. "view" becomes the areas in the map view:
   * tracts when zoomed in, counties when zoomed out.
   */
  resolveRequest(request) {
    const out = { ...request };
    // Voice may name a layer; the panel sends its Layer and Areas choices.
    const choice =
      request.choice || (request.layer && this.layerValue(request.layer));
    if (request.layer && !choice)
      return { ...out, problem: `No area layer matches “${request.layer}”.` };
    if (choice) {
      delete out.choice;
      delete out.layer;
      const scope =
        request.scope ||
        (request.state
          ? 'state'
          : !request.geography || request.geography === 'view'
            ? 'view'
            : 'all');
      if (choice.startsWith('upload:')) {
        const info = this.layerInfo?.get(choice);
        if (!info?.uploadId)
          return { ...out, problem: 'Upload the file again.' };
        out.uploadId = info.uploadId;
        out.layerName = info.name;
        delete out.geography;
      } else if (choice.startsWith('layer:')) {
        const info = this.layerInfo?.get(choice);
        if (!info) return { ...out, problem: 'That layer is not loaded.' };
        out.baseUrl = info.baseUrl;
        out.layerName = info.name;
        delete out.geography;
      } else {
        out.geography = choice.slice('measures:'.length);
      }
      delete out.scope;
      if (scope !== 'state') out.state = null;
      if (scope === 'state' && !out.state)
        return { ...out, problem: 'Choose a state.' };
      if (scope === 'view') out.useView = true;
    }
    if (out.geography === 'view' || out.useView) {
      const view = this.readView();
      if (!view) return { ...out, problem: 'The map view is not available.' };
      out.view = view.box;
      out.geography =
        out.geography === 'view'
          ? view.heightM < TRACT_VIEW_HEIGHT_M
            ? 'tract'
            : 'county'
          : out.geography;
    }
    delete out.useView;
    return out;
  }

  /** The Layer choice the variable list shows. */
  variablesQuery() {
    const choice = this.layer.value;
    if (choice.startsWith('upload:')) {
      const info = this.layerInfo?.get(choice);
      return info?.uploadId
        ? {
            query: `uploadId=${encodeURIComponent(info.uploadId)}`,
            title: info.name,
          }
        : null;
    }
    if (choice.startsWith('layer:')) {
      const info = this.layerInfo?.get(choice);
      return info
        ? {
            query: `baseUrl=${encodeURIComponent(info.baseUrl)}`,
            title: info.name,
          }
        : null;
    }
    const geography = choice.slice('measures:'.length) || 'county';
    return {
      query: `geography=${encodeURIComponent(geography)}`,
      title:
        MEASURE_CHOICES.find(([value]) => value === choice)?.[1] || geography,
    };
  }

  async loadVariables() {
    const query = this.variablesQuery();
    if (!query) return;
    try {
      const response = await this.fetch(
        `${this.engine.api}/variables?${query.query}`,
      );
      const { variables = [] } = await response.json();
      this.variableList = variables;
      const previous = this.moranVar.value;
      this.moranVar.replaceChildren(
        ...variables
          .filter(
            (v) => v.kind === 'numeric' && !['lon', 'lat'].includes(v.name),
          )
          .map((v) =>
            element('option', {
              value: v.name,
              textContent: v.name,
              title: v.label,
            }),
          ),
      );
      if ([...this.moranVar.options].some((o) => o.value === previous))
        this.moranVar.value = previous;
      // Names (what you type) and labels (what they mean), side by side.
      this.variables.replaceChildren(
        element('summary', {
          textContent: `Variables: ${query.title} (${variables.length})`,
        }),
        element(
          'dl',
          { className: 'stata-variable-list' },
          variables.flatMap((v) => [
            element('dt', {}, [element('code', { textContent: v.name })]),
            element('dd', { textContent: v.label === v.name ? '' : v.label }),
          ]),
        ),
      );
      this.variables.open = true;
    } catch {
      /* the list is a convenience */
    }
  }

  /**
   * Plain English to this program's lines (panel and voice): the lines
   * replace the box's contents for review; nothing runs yet.
   */
  async translate(text = this.plain.value) {
    if (!this.variableList) await this.loadVariables();
    const out = translatePlainEnglish(
      text,
      this.variableList || [],
      this.engine.id,
    );
    if (!out.ok) {
      this.plainNote.textContent = out.problems.join(' ');
      return out;
    }
    this.plain.value = text;
    this.commands.value = out.lines.join('\n');
    const unique = [
      ...new Map(out.matched.map((m) => [m.phrase, m])).values(),
    ].filter((m) => m.phrase.replace(/\s+/g, '_').toLowerCase() !== m.name);
    this.plainNote.textContent =
      (unique.length
        ? `Matched ${unique.map((m) => `“${m.phrase}” → ${m.name}`).join(', ')}. `
        : '') + `Check the lines, then run in ${this.engine.name}.`;
    return out;
  }

  async checkProgram() {
    const { name } = this.engine;
    try {
      const response = await this.fetch(`${this.engine.api}/status`);
      const status = await response.json();
      if (!response.ok) {
        this.setStatus(status.error || `${name} is not available here.`);
        return status;
      }
      this.setStatus(
        status.found
          ? `${this.engine.found(status)} Sessions are saved in ${status.folder}.`
          : this.engine.missing,
      );
      return status;
    } catch {
      this.setStatus(`${name} is not available here.`);
      return { found: false };
    }
  }

  setStatus(text) {
    this.statusLine.textContent = text || '';
  }

  open() {
    this.refreshLayers();
    this.root.hidden = false;
    this.root.classList.add('visible');
    void this.checkProgram();
    void this.loadVariables();
  }

  close() {
    this.root.classList.remove('visible');
    this.root.hidden = true;
  }

  async post(route, body) {
    const response = await this.fetch(`${this.engine.api}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && !result.problems)
      return {
        ok: false,
        problems: [result.error || `HTTP ${response.status}`],
      };
    return result;
  }

  /** Run commands and/or a do-file (panel and voice). */
  async run(request = {}) {
    const resolved = this.resolveRequest(request);
    if (resolved.problem) return this.fail([resolved.problem]);
    // A request in words (voice): the panel shows the data it asked for,
    // the sentence and the code the translator writes, then runs that code.
    if (
      request.plain &&
      !(Array.isArray(request.commands) && request.commands.length)
    ) {
      this.open();
      this.showChoice(resolved, request);
      this.variableList = null;
      await this.loadVariables();
      const out = await this.translate(request.plain);
      if (!out.ok) return this.fail(out.problems);
      request = { ...request, commands: out.lines };
      resolved.commands = out.lines;
    }
    // English typed in the Commands box: show the code it means instead of
    // an error (only when the text is not valid code already).
    if (
      typeof request.commands === 'string' &&
      request.commands.trim() &&
      !request.doFile
    ) {
      if (!this.variableList) await this.loadVariables();
      const lines = request.commands.split(/\r?\n/).filter((l) => l.trim());
      const check = LINE_CHECKS[this.engine.id](lines, this.variableList || []);
      if (check.problems.length) {
        const out = await this.translate(request.commands);
        if (out.ok) {
          this.setStatus(
            `Read as plain English — the ${this.engine.name} code is in the box. Check it, then run.`,
          );
          return { ok: false, translated: true, lines: out.lines };
        }
        this.plainNote.textContent = '';
      }
    }
    if (this.busy)
      return this.fail([
        `${this.engine.name} is still working on the last run.`,
      ]);
    this.busy = true;
    this.open();
    if (Array.isArray(request.commands))
      this.commands.value = request.commands.join('\n');
    const shown = request.choice || this.layerValue(request.layer);
    if (shown) this.layer.value = shown;
    this.setStatus(`Running in ${this.engine.name}…`);
    try {
      const result = await this.post('run', resolved);
      this.map.reset();
      this.render(result);
      this.last = result.ok || result.id ? result : this.last;
      this.setStatus(
        result.id
          ? `${result.title}: ${result.ok ? 'done' : 'finished with problems'} in ${result.seconds}s. Saved in ${result.folder}.`
          : (result.problems || []).join(' '),
      );
      return this.summary(result);
    } catch (error) {
      return this.fail([`${this.engine.name} run failed: ${error.message}`]);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Global Moran's I for one variable of the chosen data (panel and voice):
   * the statistic, its tests and the Moran scatter plot.
   */
  async moran(request = {}) {
    const variable = request.variable || this.moranVar.value;
    if (!variable) return this.fail(['Choose a variable for Moran’s I.']);
    const resolved = this.resolveRequest({
      ...this.readForm(),
      ...request,
      commands: [],
      doFile: null,
    });
    if (resolved.problem) return this.fail([resolved.problem]);
    this.open();
    this.moranButton.disabled = true;
    this.moranOut.textContent = `Computing Moran’s I for ${variable}…`;
    try {
      const result = await this.post('moran', {
        geography: resolved.geography,
        baseUrl: resolved.baseUrl,
        uploadId: resolved.uploadId,
        state: resolved.state,
        view: resolved.view,
        variable,
        rook: Boolean(request.rook),
      });
      this.moranOut.textContent = '';
      if (!result.ok) {
        this.moranOut.textContent = (result.problems || []).join(' ');
        return result;
      }
      this.moranOut.append(moranCard(result));
      return {
        ok: true,
        variable,
        I: result.I,
        expected: result.expected,
        z: result.z,
        p: result.p,
        pseudoP: result.pseudoP,
        n: result.n,
        weights: result.weights,
      };
    } catch (error) {
      this.moranOut.textContent = `Moran’s I failed: ${error.message}`;
      return { ok: false, problems: [error.message] };
    } finally {
      this.moranButton.disabled = false;
    }
  }

  /**
   * Browse the chosen layer's data (panel and voice): the table opens popped
   * out, and clicking rows highlights their areas on the map. No program runs.
   */
  async browse(request = {}) {
    const resolved = this.resolveRequest({
      ...request,
      commands: [],
      doFile: null,
    });
    if (resolved.problem) return this.fail([resolved.problem]);
    this.open();
    this.setStatus('Loading the data…');
    const result = await this.post('browse', resolved);
    if (!result.ok)
      return this.fail(result.problems || ['The data could not be loaded.']);
    this.map.reset();
    this.render(result);
    this.setStatus(
      `${result.title.replace(/^Husky Eye View: /, '')}. Click rows to show them on the map; Ctrl-click adds, Shift-click selects a range.`,
    );
    await this.popOutLast?.();
    return { ok: true, title: result.title, areas: result.areas };
  }

  /** Open the program itself with the data loaded (panel and voice). */
  async openStata(request = {}) {
    const resolved = this.resolveRequest({
      ...request,
      commands: [],
      doFile: null,
    });
    if (resolved.problem) return this.fail([resolved.problem]);
    const { name } = this.engine;
    this.setStatus(`Opening ${name}…`);
    const result = await this.post('open', resolved);
    if (!result.ok)
      return this.fail(result.problems || [`${name} did not open.`]);
    this.setStatus(
      `${name} is opening with ${result.title.replace(/^Husky Eye View: /, '')}.${this.engine.openNote ? ` ${this.engine.openNote}` : ''} Your commands and results are saved in ${result.folder} (${this.engine.sessionFiles}).`,
    );
    this.showToast(
      this.engine.openNote
        ? `${name} is opening. ${this.engine.openNote}`
        : `${name} is opening with the data loaded.`,
    );
    return {
      ok: true,
      title: result.title,
      areas: result.areas,
      folder: result.folder,
    };
  }

  fail(problems) {
    this.setStatus(problems.join(' '));
    return { ok: false, problems };
  }

  render(result) {
    // A popped-out table belongs to the last run.
    this.undock?.();
    this.popOutLast = null;
    this.output.textContent = '';
    if (!result.id) return;
    const steps = element(
      'ul',
      { className: 'stata-steps' },
      (result.steps || []).map((s) =>
        element('li', { className: s.rc ? 'failed' : 'ok' }, [
          s.rc ? `✗ ${this.engine.failed(s.rc)} ` : '✓ ',
          element('code', { textContent: s.line }),
        ]),
      ),
    );
    const base = `${this.engine.api}/sessions/${encodeURIComponent(result.id)}`;
    const graphs = (result.files || [])
      // graph1.png (Stata, R); SPSS's charts as its HTML output names them.
      .filter((f) => /^graph[\w-]*\.png$/i.test(f))
      .map((f) =>
        element('img', {
          src: `${base}/${f}`,
          alt: `${this.engine.name} graph ${f}`,
          loading: 'lazy',
        }),
      );
    const links = element('p', { className: 'stata-files' }, [
      element('a', {
        href: `${base}.zip`,
        download: `${result.id}.zip`,
        textContent: 'Download this session (.zip)',
      }),
      ...this.engine.files
        .filter((f) => result.files?.includes(f))
        .flatMap((f) => [
          ' · ',
          element('a', { href: `${base}/${f}`, download: f, textContent: f }),
        ]),
    ]);
    this.output.append(
      steps,
      ...(result.problems?.length
        ? [
            element('p', {
              className: 'curated-hint',
              textContent: result.problems.join(' '),
            }),
          ]
        : []),
      ...graphs,
      ...this.mapControls(result, base),
      ...this.dataTable(result, base),
      element('pre', { className: 'stata-log', textContent: result.log || '' }),
      links,
    );
  }

  /**
   * The session's data as a table: click a row to highlight that area on
   * the map (Ctrl/⌘-click adds or removes one, Shift-click a range); sort by
   * a column heading, filter by any text.
   */
  dataTable(result, base) {
    if (!result.files?.includes('data.csv')) return [];
    const commandText = this.commands.value;
    const details = element('details', { className: 'stata-data' });
    const summary = element('summary', {
      textContent: 'Data — click rows to show them on the map',
    });
    const filter = element('input', {
      type: 'search',
      placeholder: 'Filter rows (any text)',
      ariaLabel: 'Filter rows',
    });
    const clear = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'Clear highlight',
    });
    const pop = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'Pop out ⧉',
      title:
        'Move the table into its own window you can drag and resize, and tuck this panel away so the map shows',
    });
    const scroll = element('div', { className: 'stata-data-scroll' });
    const note = element('p', { className: 'curated-hint' });
    const tools = element('div', { className: 'stata-data-tools' }, [
      filter,
      clear,
      pop,
    ]);
    details.append(summary, tools, scroll, note);
    const state = {
      table: null,
      columns: [],
      sort: null,
      desc: false,
      selected: new Set(),
      anchor: null,
      shown: [],
    };
    const cellText = (value) => {
      if (typeof value === 'number')
        return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
      return String(value ?? '');
    };
    const numeric = (column) =>
      state.table.rows.some(
        (row) => row[column] !== '' && Number.isFinite(Number(row[column])),
      );
    const draw = () => {
      const needle = filter.value.trim().toLowerCase();
      let rows = state.table.rows;
      if (needle)
        rows = rows.filter((row) =>
          state.columns.some((c) =>
            cellText(row[c]).toLowerCase().includes(needle),
          ),
        );
      if (state.sort) {
        const c = state.sort;
        const asNumber = numeric(c);
        const missing = (row) => row[c] === '' || row[c] === undefined;
        // Missing values stay at the bottom in either direction.
        rows = [...rows].sort((a, b) => {
          if (missing(a) || missing(b)) return missing(a) - missing(b);
          const order = asNumber
            ? Number(a[c]) - Number(b[c])
            : String(a[c]).localeCompare(String(b[c]));
          return state.desc ? -order : order;
        });
      }
      state.shown = rows;
      const head = element(
        'tr',
        {},
        state.columns.map((c) => {
          const th = element('th', {
            textContent:
              c + (state.sort === c ? (state.desc ? ' ▼' : ' ▲') : ''),
            title: 'Sort',
          });
          th.addEventListener('click', () => {
            state.desc = state.sort === c ? !state.desc : false;
            state.sort = c;
            draw();
          });
          return th;
        }),
      );
      const body = rows.slice(0, TABLE_ROWS).map((row, i) => {
        const tr = element(
          'tr',
          {
            className: state.selected.has(row.hev_id) ? 'selected' : '',
          },
          state.columns.map((c) =>
            element('td', { textContent: cellText(row[c]) }),
          ),
        );
        tr.addEventListener('click', (event) => choose(row, i, event));
        return tr;
      });
      scroll.textContent = '';
      scroll.append(
        element('table', {}, [
          element('thead', {}, head),
          element('tbody', {}, body),
        ]),
      );
      const total = state.table.rows.length;
      note.textContent =
        `${rows.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows` +
        (rows.length > TABLE_ROWS
          ? ` (first ${TABLE_ROWS} shown; filter or sort to find others)`
          : '') +
        (state.selected.size
          ? ` · ${state.selected.size} highlighted on the map`
          : '') +
        '.';
    };
    // Rows are chosen by hev_id (their data.csv row), so every layer works.
    const highlight = async () => {
      const rows = state.table.rows.filter((r) => state.selected.has(r.hev_id));
      const drawn = await this.map.highlight(base, rows);
      if (drawn.problem) note.textContent = drawn.problem;
    };
    const choose = (row, index, event) => {
      const id = row.hev_id;
      if (event.shiftKey && state.anchor !== null) {
        const [from, to] = [state.anchor, index].sort((a, b) => a - b);
        for (const r of state.shown.slice(from, to + 1))
          state.selected.add(r.hev_id);
      } else if (event.ctrlKey || event.metaKey) {
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        state.anchor = index;
      } else {
        const only = state.selected.size === 1 && state.selected.has(id);
        state.selected = new Set(only ? [] : [id]);
        state.anchor = index;
      }
      draw();
      highlight();
    };
    filter.addEventListener('input', () => draw());
    clear.addEventListener('click', () => {
      state.selected.clear();
      draw();
      highlight();
    });
    const load = async () => {
      if (state.table) return;
      note.textContent = 'Loading the data…';
      try {
        state.table = await this.map.table(base, result.files);
        state.columns = tableColumns(
          state.table.columns,
          commandText,
          state.table.rows,
        );
        draw();
      } catch (error) {
        note.textContent = `Could not read the data: ${error.message}`;
      }
    };
    details.addEventListener('toggle', () => {
      if (details.open) void load();
    });
    // Pop out: the table in its own window (drag by its title bar, resize
    // from the corner) with this panel tucked away, so the highlighted
    // areas show on the map. "Back to panel" puts both back.
    const popOut = async () => {
      if (this.undock) return;
      details.open = true;
      await load();
      const back = element('button', {
        type: 'button',
        className: 'curated-button',
        textContent: 'Back to panel',
      });
      const head = element('header', { className: 'stata-data-float-head' }, [
        element('span', {
          textContent: 'Data — click rows to show them on the map',
        }),
        back,
      ]);
      const body = element('div', { className: 'stata-data-float-body' });
      const win = element(
        'section',
        {
          className: 'stata-data stata-data-float',
          role: 'dialog',
          ariaLabel: 'Data table',
        },
        [head, body],
      );
      pop.hidden = true;
      body.append(tools, scroll, note);
      document.body.append(win);
      this.root.hidden = true;
      dragBy(head, win);
      const dock = () => {
        details.append(tools, scroll, note);
        pop.hidden = false;
        win.remove();
        this.undock = null;
        this.root.hidden = false;
      };
      back.addEventListener('click', dock);
      this.undock = dock;
    };
    pop.addEventListener('click', () => void popOut());
    this.popOutLast = popOut;
    return [details];
  }

  /**
   * "Show on map": a run's fitted values, residuals and new variables tint
   * the areas it used (one way: the map shows what the program computed).
   */
  mapControls(result, base) {
    const choices = mapChoices(result);
    const varsFile = (result.files || []).find((f) => f === 'map_vars.csv');
    if (!choices.length && !varsFile) return [];
    const select = element('select', {
      ariaLabel: 'Result to show on the map',
    });
    const fill = (list) => {
      for (const choice of list)
        select.append(
          element('option', {
            value: String(select.options.length),
            textContent: choice.label,
          }),
        );
    };
    fill(choices);
    if (varsFile)
      this.map.read(`${base}/${varsFile}`).then(({ columns }) => {
        const extra = variableChoices(columns, varsFile);
        choices.push(...extra);
        fill(extra);
      });
    const show = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'Show on map',
    });
    const clear = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'Clear',
    });
    const legend = element('div', { className: 'stata-map-legend' });
    show.addEventListener('click', async () => {
      const choice = choices[Number(select.value)];
      if (!choice) return;
      show.disabled = true;
      legend.textContent = 'Drawing…';
      try {
        const drawn = await this.map.show(base, choice);
        legend.textContent = '';
        if (!drawn.ok) {
          legend.textContent = drawn.problem;
          return;
        }
        legend.append(
          element('p', {
            textContent: `${choice.label} · ${drawn.areas.toLocaleString('en-US')} areas`,
          }),
          ...legendRows(drawn.legend).map((row) =>
            element('span', { className: 'stata-map-key' }, [
              element('i', { style: `background:${row.color}` }),
              row.label,
            ]),
          ),
          ...(choice.residual
            ? [
                element('p', {
                  className: 'curated-hint',
                  textContent:
                    'Red: higher than the model predicts. Blue: lower. Gray: close to the prediction.',
                }),
              ]
            : []),
        );
      } catch (error) {
        legend.textContent = `Could not draw it: ${error.message}`;
      } finally {
        show.disabled = false;
      }
    });
    clear.addEventListener('click', () => {
      this.map.clear();
      legend.textContent = '';
    });
    return [
      element('div', { className: 'stata-map' }, [
        element('label', { className: 'stata-map-label' }, [
          'Results on the map ',
          select,
        ]),
        element('div', { className: 'stata-map-actions' }, [show, clear]),
        legend,
      ]),
    ];
  }

  /** What the voice assistant reads back: steps and the start of the output. */
  summary(result) {
    if (!result.id) return { ok: false, problems: result.problems || [] };
    return {
      ok: result.ok,
      title: result.title,
      areas: result.areas,
      steps: result.steps,
      folder: result.folder,
      files: result.files,
      output: String(result.log || '').slice(0, 6000),
      problems: result.problems,
    };
  }

  status() {
    return {
      open: !this.root.hidden,
      busy: this.busy,
      last: this.last ? { id: this.last.id, title: this.last.title } : null,
    };
  }

  destroy() {
    this.map.clear();
    for (const remove of this.removers.splice(0)) remove();
    this.root.remove();
  }
}

/** The Stata panel (kept as its own name for the shell and older imports). */
export class StataAnalysisPanel extends AnalysisPanel {
  constructor(options = {}) {
    super({ ...options, engine: 'stata' });
  }
}

/** The R panel. */
export class RAnalysisPanel extends AnalysisPanel {
  constructor(options = {}) {
    super({ ...options, engine: 'r' });
  }

  /** Voice and the panel call it the same way as Stata's. */
  openR(request) {
    return this.openStata(request);
  }
}

/** The Excel Analysis panel (workbooks built here; Excel opens them). */
export class ExcelAnalysisPanel extends AnalysisPanel {
  constructor(options = {}) {
    super({ ...options, engine: 'excel' });
  }

  /** Voice and the panel call it the same way as Stata's. */
  openExcel(request) {
    return this.openStata(request);
  }
}

/** The SPSS panel. */
export class SpssAnalysisPanel extends AnalysisPanel {
  constructor(options = {}) {
    super({ ...options, engine: 'spss' });
  }

  /** Voice and the panel call it the same way as Stata's. */
  openSpss(request) {
    return this.openStata(request);
  }
}
