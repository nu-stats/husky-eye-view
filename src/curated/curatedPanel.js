/**
 * The Curated Flights panel (opened from Data Layers → Research Data) and the
 * controller behind it. The same methods serve the panel and voice:
 * plan(), start(), control(), download(), status().
 */
import {
  MAX_CITIES,
  MAX_LAYERS,
  findLayer,
  planFlight,
} from './curatedModel.js';
import {
  SESSION_KEY_EVENT,
  curatedKey,
  curatedUnlocked,
  forgetCuratedTable,
  loadCuratedTable,
  researchValues,
} from './curatedAccess.js';
import { CuratedFlight, paintCard } from './curatedFlight.js';
import {
  buildAllZip,
  buildReport,
  chartsZip,
  dataFile,
  flightFileBase,
} from './curatedOutputs.js';
import { ViewCapture } from '../ui/viewCapture.js';

export const OPEN_EVENT = 'gev:curated-flights-open';
const FLIGHT_CLIP_MAX_SECONDS = 15 * 60;

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children))
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  return node;
}

export class CuratedFlightsPanel {
  constructor({
    viewer,
    readDataManager,
    holdRender = () => {},
    releaseRender = () => {},
    showToast = () => {},
  }) {
    Object.assign(this, {
      viewer,
      readDataManager,
      holdRender,
      releaseRender,
      showToast,
    });
    this.table = null;
    this.unlocked = false;
    this.plan = null;
    this.result = null;
    this.card = null;
    this.chartFormat = 'png';
    this.busy = false;
    this.removers = [];
    this.capture = new ViewCapture({
      viewer,
      describe: () => ({
        view: 'CURATED FLIGHT',
        place: this.card?.city
          ? `${this.card.city.name}, ${this.card.city.stateAbbr}`
          : this.card?.kind === 'city'
            ? this.card.title
            : // Before the first card (the clip's file name): the tour itself.
              this.plan?.ok
              ? `${this.plan.cities.map((city) => city.name).join(' vs ')} curated flight`
              : '',
        layers: this.card?.layer ? [this.card.layer.label] : [],
      }),
      holdRender,
      releaseRender,
      maxSeconds: FLIGHT_CLIP_MAX_SECONDS,
      paintOverlay: (ctx, width, height) =>
        paintCard(ctx, width, height, this.card),
      onState: (state) => {
        if (state.saved) this.showToast(`Saved to Downloads: ${state.saved}`);
        if (state.error) this.showToast(`Recording: ${state.error}`);
      },
    });
    this.flight = new CuratedFlight({
      viewer,
      setLayerEnabled: (id, on) =>
        this.readDataManager()?.setEnabled(id, on, {
          origin: 'curated-flight',
        }),
      isLayerEnabled: (id) => this.readDataManager()?.isEnabled(id),
      holdRender,
      releaseRender,
      onCard: (card) => this.renderCard(card),
      onState: (state) => this.renderFlightState(state),
      capture: this.capture,
    });
    this.build();
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler);
      this.removers.push(() => target.removeEventListener(type, handler));
    };
    listen(window, OPEN_EVENT, () => this.open());
    listen(window, SESSION_KEY_EVENT, () => {
      forgetCuratedTable();
      this.table = null;
      if (this.root.classList.contains('visible')) this.refreshLock();
    });
  }

  // ---------- DOM ----------

  build() {
    this.root = element('section', {
      id: 'curated-flights-panel',
      className: 'curated-panel',
      role: 'dialog',
      ariaLabel: 'Curated Flights',
      hidden: true,
    });
    const close = element('button', {
      type: 'button',
      className: 'curated-close',
      ariaLabel: 'Close Curated Flights',
      textContent: '×',
    });
    close.addEventListener('click', () => this.close());
    this.statusLine = element('p', {
      className: 'curated-status',
      ariaLive: 'polite',
    });
    this.lockedView = element('div', { className: 'curated-locked' }, [
      element('p', {
        textContent:
          'Curated Flights has its own key, separate from the research datasets. Enter it under POWER UP → CURATED FLIGHTS.',
      }),
    ]);
    const powerUp = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'OPEN POWER UP',
    });
    powerUp.addEventListener('click', () =>
      document.getElementById('key-setup-chip')?.click(),
    );
    this.lockedView.append(powerUp);

    this.cityInputs = Array.from({ length: MAX_CITIES }, (_, i) =>
      element('input', {
        type: 'text',
        className: 'curated-city',
        placeholder:
          i === 0 ? 'City, e.g. Detroit, MI' : `City ${i + 1} (optional)`,
        autocomplete: 'off',
        spellcheck: false,
      }),
    );
    this.cityList = element('datalist', { id: 'curated-city-list' });
    for (const input of this.cityInputs)
      input.setAttribute('list', 'curated-city-list');
    this.layerBox = element('div', {
      className: 'curated-layers',
      role: 'group',
      ariaLabel: 'Layers to show',
    });
    this.layerCount = element('small', { className: 'curated-layer-count' });
    this.recordBox = element('input', {
      type: 'checkbox',
      id: 'curated-record',
    });
    this.formatSelect = element(
      'select',
      { id: 'curated-chart-format', ariaLabel: 'Chart image format' },
      [
        element('option', { value: 'png', textContent: 'PNG' }),
        element('option', { value: 'jpg', textContent: 'JPG' }),
      ],
    );
    this.formatSelect.addEventListener('change', () => {
      this.chartFormat = this.formatSelect.value;
    });
    this.startButton = element('button', {
      type: 'button',
      className: 'curated-button curated-start',
      textContent: 'START FLIGHT',
    });
    this.startButton.addEventListener('click', () => this.startFromForm());
    this.controls = element('div', {
      className: 'curated-controls',
      hidden: true,
    });
    for (const [action, label] of [
      ['pause', 'PAUSE'],
      ['skip', 'SKIP'],
      ['stop', 'STOP'],
    ]) {
      const button = element('button', {
        type: 'button',
        className: 'curated-button',
        textContent: label,
        dataset: { action },
      });
      button.addEventListener('click', () =>
        this.control(
          action === 'pause' && this.flight.paused ? 'resume' : action,
        ),
      );
      this.controls.append(button);
    }
    this.downloads = element('div', {
      className: 'curated-downloads',
      hidden: true,
    });
    for (const [kind, format, label] of [
      ['all', null, 'ALL (ZIP)'],
      ['report', 'pdf', 'REPORT (PDF)'],
      ['data', 'csv', 'DATA (CSV)'],
      ['data', 'xlsx', 'DATA (XLSX)'],
      ['charts', null, 'CHARTS (ZIP)'],
    ]) {
      const button = element('button', {
        type: 'button',
        className: 'curated-button',
        textContent: label,
      });
      button.addEventListener('click', () =>
        this.download(kind, format || this.chartFormat),
      );
      this.downloads.append(button);
    }
    this.form = element('div', { className: 'curated-form' }, [
      element('label', {
        className: 'curated-label',
        textContent: `Cities (up to ${MAX_CITIES}, 100,000+ people)`,
      }),
      ...this.cityInputs,
      this.cityList,
      element('label', { className: 'curated-label' }, [
        `Layers (up to ${MAX_LAYERS}) `,
        this.layerCount,
      ]),
      this.layerBox,
      element('div', { className: 'curated-options' }, [
        element('label', { className: 'curated-check' }, [
          this.recordBox,
          ' Record the flight (MP4)',
        ]),
        element('label', { className: 'curated-check' }, [
          'Chart images ',
          this.formatSelect,
        ]),
      ]),
      this.startButton,
      this.downloads,
      element('p', {
        className: 'curated-hint',
        textContent:
          'Or by voice: “Plan a curated flight comparing life expectancy and park access in Detroit and Omaha, and record it.”',
      }),
    ]);
    this.root.append(
      element('header', { className: 'curated-header' }, [
        element('span', {
          className: 'curated-kicker',
          textContent: 'RESEARCH DATA',
        }),
        element('strong', { textContent: 'CURATED FLIGHTS' }),
        close,
      ]),
      this.lockedView,
      this.form,
      this.statusLine,
    );
    this.cardEl = element('aside', {
      id: 'curated-card',
      className: 'curated-card',
      hidden: true,
      ariaLive: 'polite',
    });
    // While a tour runs the panel is closed; this bar steers it and lets the
    // user switch to any of the tour's layers (which pauses on that layer).
    this.layerJump = element('div', {
      className: 'curated-jump',
      role: 'group',
      ariaLabel: 'Show a layer',
    });
    this.flightBar = element(
      'div',
      { className: 'curated-flight-bar', hidden: true },
      [
        element('span', {
          className: 'curated-kicker',
          textContent: 'CURATED FLIGHT',
        }),
        this.controls,
        this.layerJump,
      ],
    );
    this.controls.hidden = false;
    document.body.append(this.root, this.cardEl, this.flightBar);
  }

  renderLayerJump(activeKey = this.card?.key) {
    this.layerJump.textContent = '';
    if (!this.plan?.ok) return;
    for (const key of this.plan.layers) {
      const button = element('button', {
        type: 'button',
        className: `curated-button curated-chip${key === activeKey ? ' active' : ''}`,
        textContent: this.table.layers[key].label,
        title: 'Show this layer here (pauses the tour)',
      });
      button.setAttribute('aria-pressed', String(key === activeKey));
      button.addEventListener('click', () => this.control('show_layer', key));
      this.layerJump.append(button);
    }
  }

  renderLayerChoices() {
    this.layerBox.textContent = '';
    if (!this.table) return;
    let group = null;
    for (const [key, layer] of Object.entries(this.table.layers)) {
      if (layer.group && layer.group !== group) {
        group = layer.group;
        this.layerBox.append(
          element('small', {
            className: 'curated-layer-group',
            textContent: group,
          }),
        );
      }
      const box = element('input', { type: 'checkbox', value: key });
      box.addEventListener('change', () => this.syncLayerCount());
      this.layerBox.append(
        element('label', { className: 'curated-check', title: layer.note }, [
          box,
          ` ${layer.label}${layer.research ? ' 🔒' : ''}`,
        ]),
      );
    }
    this.syncLayerCount();
  }

  syncLayerCount() {
    const boxes = [...this.layerBox.querySelectorAll('input')];
    const checked = boxes.filter((box) => box.checked).length;
    for (const box of boxes)
      box.disabled = !box.checked && checked >= MAX_LAYERS;
    this.layerCount.textContent = `${checked}/${MAX_LAYERS}`;
  }

  setStatus(text) {
    this.statusLine.textContent = text || '';
  }

  async open() {
    this.root.hidden = false;
    this.root.classList.add('visible');
    await this.refreshLock();
  }

  close() {
    this.root.classList.remove('visible');
    this.root.hidden = true;
  }

  async refreshLock() {
    this.unlocked = await curatedUnlocked();
    this.lockedView.hidden = this.unlocked;
    this.form.hidden = !this.unlocked;
    if (!this.unlocked) {
      this.setStatus(
        curatedKey() ? 'That key does not unlock Curated Flights.' : '',
      );
      return false;
    }
    if (!this.table) {
      this.setStatus('Loading the city table…');
      try {
        this.table = await loadCuratedTable();
      } catch (error) {
        this.setStatus(error.message);
        return false;
      }
      this.cityList.textContent = '';
      for (const city of this.table.cities)
        this.cityList.append(
          element('option', { value: `${city.name}, ${city.stateAbbr}` }),
        );
      this.renderLayerChoices();
      this.setStatus(`${this.table.cities.length} cities ready.`);
    }
    return true;
  }

  renderCard(card) {
    this.card = card;
    if (this.flight?.running) this.renderLayerJump(card?.key);
    this.cardEl.hidden = !card;
    this.cardEl.textContent = '';
    if (!card) return;
    this.cardEl.append(
      element('strong', { textContent: card.title }),
      element('small', { textContent: card.subtitle || '' }),
      ...(card.lines || []).map((line) => element('p', { textContent: line })),
    );
  }

  renderFlightState(state) {
    this.flightBar.hidden = !state.running;
    this.startButton.disabled = state.running;
    if (state.running) this.renderLayerJump();
    const pause = this.controls.querySelector('[data-action="pause"]');
    if (pause) pause.textContent = state.paused ? 'RESUME' : 'PAUSE';
    if (state.step === 'flying') this.setStatus(`Flying to ${state.city}…`);
    else if (state.step === 'layer')
      this.setStatus(`${state.city}: ${state.layer}`);
    else if (state.paused) this.setStatus('Paused.');
  }

  // ---------- shared actions (panel + voice) ----------

  async ensureTable() {
    if (this.table) return this.table;
    if (!(await this.refreshLock())) {
      throw new Error(
        curatedKey()
          ? 'The Curated Flights key in this session does not unlock it.'
          : 'Curated Flights is locked: enter its key under POWER UP → CURATED FLIGHTS.',
      );
    }
    return this.table;
  }

  /** Validate and remember a plan; fills the form so the user can see it. */
  async planFlight({ cities = [], layers = [], record = false } = {}) {
    const table = await this.ensureTable();
    const plan = planFlight({ cities, layers, record }, table);
    if (plan.ok) {
      this.plan = plan;
      this.result = null;
      this.downloads.hidden = true;
      this.cityInputs.forEach((input, i) => {
        const city = plan.cities[i];
        input.value = city ? `${city.name}, ${city.stateAbbr}` : '';
      });
      for (const box of this.layerBox.querySelectorAll('input'))
        box.checked = plan.layers.includes(box.value);
      this.recordBox.checked = plan.record;
      this.syncLayerCount();
    }
    return plan;
  }

  readForm() {
    return {
      cities: this.cityInputs
        .map((input) => input.value.trim())
        .filter(Boolean),
      layers: [...this.layerBox.querySelectorAll('input:checked')].map(
        (box) => box.value,
      ),
      record: this.recordBox.checked,
    };
  }

  async startFromForm() {
    try {
      const plan = await this.planFlight(this.readForm());
      if (!plan.ok) {
        this.setStatus(plan.problems.join(' '));
        return;
      }
      if (plan.problems.length) this.showToast(plan.problems[0]);
      await this.start();
    } catch (error) {
      this.setStatus(error.message);
    }
  }

  /** Run the remembered plan. */
  async start() {
    if (!this.plan?.ok)
      throw new Error('Plan a flight first (cities and layers).');
    if (this.flight.running)
      throw new Error('A curated flight is already running.');
    const plan = this.plan;
    const table = this.table;
    this.close();
    this.setStatus('Counting research layers…');
    const { values: research, missing } = await researchValues(plan, table);
    if (missing.length)
      this.showToast(
        'GVA / MKDB need the research key; those layers show as locked.',
      );
    const run = this.flight.run(plan, table, research, {
      record: plan.record,
      missing,
    });
    run
      .then(({ completed, snapshots }) => {
        this.result = { plan, table, research, snapshots, completed };
        this.downloads.hidden = false;
        this.setStatus(
          completed
            ? 'Flight complete. Download the report, data and charts below.'
            : 'Flight stopped. Downloads use the values for every chosen city.',
        );
        this.open();
      })
      .catch((error) => this.setStatus(error.message));
    return { ok: true, plan };
  }

  control(action, layer) {
    if (action === 'show_layer') {
      const key = this.table ? findLayer(this.table.layers, layer) : null;
      if (!key || !this.flight.running)
        return {
          ok: false,
          running: this.flight.running,
          error: key
            ? 'No tour is running.'
            : `No flight layer matches “${layer}”.`,
        };
      this.flight.showLayer(key);
      return {
        ok: true,
        running: true,
        paused: true,
        layer: this.table.layers[key].label,
      };
    }
    const ok =
      action === 'pause'
        ? this.flight.pause()
        : action === 'resume'
          ? this.flight.resume()
          : action === 'skip'
            ? this.flight.skip()
            : action === 'stop'
              ? this.flight.stop()
              : false;
    return { ok, running: this.flight.running, paused: this.flight.paused };
  }

  /** Download an output: report (pdf), data (csv|xlsx), charts (png|jpg in a ZIP). */
  async download(kind, format) {
    const source =
      this.result ||
      (this.plan?.ok
        ? { plan: this.plan, table: this.table, research: {}, snapshots: {} }
        : null);
    if (!source) throw new Error('Run or plan a curated flight first.');
    if (this.busy) return { ok: false, error: 'Busy' };
    this.busy = true;
    const { plan, table, research, snapshots } = source;
    const base = flightFileBase(plan);
    try {
      if (kind === 'all') {
        const imageFormat = format === 'jpg' ? 'jpg' : 'png';
        this.setStatus('Building the report, data and charts…');
        const zip = await buildAllZip(plan, table, research, {
          snapshots,
          format: imageFormat,
          doc: document,
        });
        this.save(zip, `${base}.zip`, 'application/zip');
      } else if (kind === 'report') {
        this.setStatus('Building the report…');
        const bytes = await buildReport(plan, table, research, { snapshots });
        this.save(bytes, `${base}_report.pdf`, 'application/pdf');
      } else if (kind === 'data') {
        const xlsx = format === 'xlsx';
        const content = dataFile(plan, table, research, xlsx ? 'xlsx' : 'csv');
        this.save(
          content,
          `${base}_data.${xlsx ? 'xlsx' : 'csv'}`,
          xlsx
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv;charset=utf-8',
        );
      } else if (kind === 'charts') {
        const imageFormat = format === 'jpg' ? 'jpg' : 'png';
        this.setStatus('Drawing the charts…');
        const zip = await chartsZip(
          plan,
          table,
          research,
          imageFormat,
          document,
        );
        this.save(zip, `${base}_charts-${imageFormat}.zip`, 'application/zip');
      } else {
        throw new Error(`Unknown download: ${kind}`);
      }
      this.setStatus('Saved to Downloads.');
      return { ok: true };
    } finally {
      this.busy = false;
    }
  }

  save(content, name, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = element('a', { href: url, download: name });
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    this.showToast(`Saved to Downloads: ${name}`);
  }

  status() {
    return {
      unlocked: this.unlocked,
      running: this.flight.running,
      paused: this.flight.paused,
      plan: this.plan?.ok
        ? {
            cities: this.plan.cities.map(
              (city) => `${city.name}, ${city.stateAbbr}`,
            ),
            layers: this.plan.layers.map((key) => this.table.layers[key].label),
            record: this.plan.record,
          }
        : null,
      downloadsReady: Boolean(this.result),
    };
  }

  destroy() {
    this.flight.stop();
    this.capture.destroy();
    for (const remove of this.removers.splice(0)) remove();
    this.root.remove();
    this.cardEl.remove();
  }
}
