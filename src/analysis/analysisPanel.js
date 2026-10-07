/**
 * The Stata Analysis panel (Data Layers → Research Data → Stata Analysis) and
 * the controller the voice assistant shares. Commands or an uploaded do-file
 * run in Stata on this computer against a layer's data (counties, a state's
 * tracts, states, or the areas in the current map view); "Open in Stata"
 * opens the Stata window itself with that data loaded. Each run is kept as
 * a session folder with its do-file and log (server/providers/stata.js).
 */
import { STATES } from '../reports/areaReport.js';
import { STATA_COMMAND_NAMES, MAX_DO_FILE_BYTES } from './stataCommands.js';

export const ANALYSIS_OPEN_EVENT = 'gev:stata-analysis-open';

/** Zoomed in closer than this, "the current view" means tracts. */
const TRACT_VIEW_HEIGHT_M = 250_000;

const EXAMPLES = [
  'summarize foreign_born_share poverty median_income',
  'regress foreign_born_share poverty unemployment bachelors if median_income != ., vce(robust)',
  'twoway scatter foreign_born_share poverty',
].join('\n');

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

export class StataAnalysisPanel {
  constructor({ readView = () => null, showToast = () => {}, fetchImpl } = {}) {
    this.readView = readView;
    this.showToast = showToast;
    this.fetch = fetchImpl || ((...args) => globalThis.fetch(...args));
    this.busy = false;
    this.last = null;
    this.doFile = null;
    this.removers = [];
    this.build();
    const onOpen = () => this.open();
    window.addEventListener(ANALYSIS_OPEN_EVENT, onOpen);
    this.removers.push(() =>
      window.removeEventListener(ANALYSIS_OPEN_EVENT, onOpen),
    );
  }

  build() {
    this.root = element('section', {
      id: 'stata-analysis-panel',
      className: 'curated-panel area-reports-panel stata-panel',
      role: 'dialog',
      ariaLabel: 'Stata Analysis',
      hidden: true,
    });
    const close = element('button', {
      type: 'button',
      className: 'curated-close',
      ariaLabel: 'Close Stata Analysis',
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
    this.geography = select('Data', [
      ['view', 'Areas in the map view'],
      ['county', 'Counties'],
      ['tract', 'Census tracts (one state)'],
      ['state', 'States'],
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
      ariaLabel: 'Stata commands, one per line',
      placeholder: EXAMPLES,
    });
    this.doInput = element('input', {
      type: 'file',
      accept: '.do,text/plain',
      ariaLabel: 'Upload a do-file',
    });
    this.doName = element('span', { className: 'curated-hint' });
    this.doInput.addEventListener('change', () => this.readDoFile());
    this.runButton = element('button', {
      type: 'button',
      className: 'curated-button curated-start',
      textContent: 'RUN IN STATA',
    });
    this.runButton.addEventListener('click', () => this.run(this.readForm()));
    this.openButton = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'OPEN IN STATA',
      title:
        'Open the Stata window with this data loaded; your commands and results are saved as you work',
    });
    this.openButton.addEventListener('click', () =>
      this.openStata(this.readForm()),
    );
    this.statusLine = element('p', {
      className: 'curated-status',
      ariaLive: 'polite',
    });
    this.variables = element('details', { className: 'stata-variables' }, [
      element('summary', { textContent: 'Variables' }),
    ]);
    this.output = element('div', { className: 'stata-output' });
    this.geography.addEventListener('change', () => this.loadVariables());
    this.root.append(
      element('header', { className: 'curated-header' }, [
        element('span', { className: 'curated-kicker', textContent: 'DATA' }),
        element('strong', { textContent: 'STATA ANALYSIS' }),
        close,
      ]),
      element('div', { className: 'curated-form' }, [
        element('label', { className: 'curated-check' }, [
          'Data ',
          this.geography,
        ]),
        element('label', { className: 'curated-check' }, ['In ', this.state]),
        element('label', {
          className: 'curated-label',
          textContent: 'Commands (one per line)',
        }),
        this.commands,
        element('p', {
          className: 'curated-hint',
          textContent: `${STATA_COMMAND_NAMES.join(', ')} — with if, in and options. Spatial models get inverse-distance weights W built on the areas with valid values. Anything else: upload a do-file.`,
        }),
        element('label', { className: 'curated-check' }, [
          'Do-file ',
          this.doInput,
        ]),
        this.doName,
        element('div', { className: 'curated-options' }, [
          this.runButton,
          this.openButton,
        ]),
        this.variables,
      ]),
      this.statusLine,
      this.output,
    );
    document.body.append(this.root);
  }

  async readDoFile() {
    const file = this.doInput.files?.[0];
    this.doFile = null;
    this.doName.textContent = '';
    if (!file) return;
    if (file.size > MAX_DO_FILE_BYTES) {
      this.setStatus(
        `A do-file may be at most ${MAX_DO_FILE_BYTES / 1024} KB.`,
      );
      this.doInput.value = '';
      return;
    }
    this.doFile = await file.text();
    this.doName.textContent = `${file.name} runs after the commands, on the same data.`;
  }

  readForm() {
    return {
      geography: this.geography.value,
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

  async loadVariables() {
    const geography =
      this.geography.value === 'view'
        ? (this.resolveRequest({ geography: 'view' }).geography ?? 'county')
        : this.geography.value;
    try {
      const response = await this.fetch(
        `/api/stata/variables?geography=${encodeURIComponent(geography)}`,
      );
      const { variables = [] } = await response.json();
      this.variables.replaceChildren(
        element('summary', { textContent: `Variables (${geography})` }),
        element(
          'ul',
          {},
          variables.map((v) =>
            element('li', {}, [
              element('code', { textContent: v.name }),
              ` ${v.label}`,
            ]),
          ),
        ),
      );
    } catch {
      /* the list is a convenience */
    }
  }

  async checkStata() {
    try {
      const response = await this.fetch('/api/stata/status');
      const status = await response.json();
      if (!response.ok) {
        this.setStatus(status.error || 'Stata is not available here.');
        return status;
      }
      this.setStatus(
        status.found
          ? `Stata ${status.version ?? ''} ${status.edition ?? ''} found. Sessions are saved in ${status.folder}.`
          : 'Stata was not found on this computer (looked for Stata 18 and 19). Set HEV_STATA_PATH to its program file.',
      );
      return status;
    } catch {
      this.setStatus('Stata is not available here.');
      return { found: false };
    }
  }

  setStatus(text) {
    this.statusLine.textContent = text || '';
  }

  open() {
    this.root.hidden = false;
    this.root.classList.add('visible');
    void this.checkStata();
    void this.loadVariables();
  }

  close() {
    this.root.classList.remove('visible');
    this.root.hidden = true;
  }

  async post(route, body) {
    const response = await this.fetch(`/api/stata/${route}`, {
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
    if (this.busy)
      return this.fail(['Stata is still working on the last run.']);
    this.busy = true;
    this.open();
    if (Array.isArray(request.commands))
      this.commands.value = request.commands.join('\n');
    this.setStatus('Running in Stata…');
    try {
      const result = await this.post('run', resolved);
      this.render(result);
      this.last = result.ok || result.id ? result : this.last;
      this.setStatus(
        result.id
          ? `${result.title}: ${result.ok ? 'done' : 'finished with problems'} in ${result.seconds}s. Saved in ${result.folder}.`
          : (result.problems || []).join(' '),
      );
      return this.summary(result);
    } catch (error) {
      return this.fail([`Stata run failed: ${error.message}`]);
    } finally {
      this.busy = false;
    }
  }

  /** Open the Stata window with the data loaded (panel and voice). */
  async openStata(request = {}) {
    const resolved = this.resolveRequest({
      ...request,
      commands: [],
      doFile: null,
    });
    if (resolved.problem) return this.fail([resolved.problem]);
    this.setStatus('Opening Stata…');
    const result = await this.post('open', resolved);
    if (!result.ok)
      return this.fail(result.problems || ['Stata did not open.']);
    this.setStatus(
      `Stata is opening with ${result.title.replace(/^Husky Eye View: /, '')}. Your commands and results are saved in ${result.folder} (session_commands.do, session.log).`,
    );
    this.showToast('Stata is opening with the data loaded.');
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
    this.output.textContent = '';
    if (!result.id) return;
    const steps = element(
      'ul',
      { className: 'stata-steps' },
      (result.steps || []).map((s) =>
        element('li', { className: s.rc ? 'failed' : 'ok' }, [
          s.rc ? `✗ r(${s.rc}) ` : '✓ ',
          element('code', { textContent: s.line }),
        ]),
      ),
    );
    const base = `/api/stata/sessions/${encodeURIComponent(result.id)}`;
    const graphs = (result.files || [])
      .filter((f) => /^graph\d+\.png$/.test(f))
      .map((f) =>
        element('img', {
          src: `${base}/${f}`,
          alt: `Stata graph ${f}`,
          loading: 'lazy',
        }),
      );
    const links = element('p', { className: 'stata-files' }, [
      element('a', {
        href: `${base}.zip`,
        download: `${result.id}.zip`,
        textContent: 'Download this session (.zip)',
      }),
      ...['analysis.do', 'analysis.log', 'results.xlsx', 'data.dta']
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
      element('pre', { className: 'stata-log', textContent: result.log || '' }),
      links,
    );
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
    for (const remove of this.removers.splice(0)) remove();
    this.root.remove();
  }
}
