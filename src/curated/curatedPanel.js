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
import {
  USER_LAYER_KEY,
  defaultOptions,
  methodsFor,
  METHODS,
  LEVEL_PLURAL,
  readUpload,
  tableWithUpload,
  userLayerValues,
} from './userData.js';
import { shapesForFlight } from './userShapes.js';
import { UserDataOverlay } from './userOverlay.js';
import {
  CLIP_MAX_SECONDS,
  ViewCapture,
  formatClipTime,
} from '../ui/viewCapture.js';

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
    this.baseTable = null;
    // The user's own file: {dataset, options}; read and kept in this tab only.
    this.upload = null;
    this.keepUpload = true;
    this.overlay = new UserDataOverlay({
      viewer,
      requestRender: () => viewer?.scene?.requestRender?.(),
    });
    this.unlocked = false;
    this.plan = null;
    this.result = null;
    this.card = null;
    this.chartFormat = 'png';
    this.busy = false;
    this.removers = [];
    const describe = () => ({
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
    });
    const paintOverlay = (ctx, width, height) =>
      paintCard(ctx, width, height, this.card);
    // Records the whole flight when "Record the flight" is ticked.
    this.capture = new ViewCapture({
      viewer,
      describe,
      holdRender,
      releaseRender,
      maxSeconds: FLIGHT_CLIP_MAX_SECONDS,
      paintOverlay,
      onState: (state) => {
        if (state.saved) this.showToast(`Saved to Downloads: ${state.saved}`);
        if (state.error) this.showToast(`Recording: ${state.error}`);
      },
    });
    // PHOTO and REC on the flight bar: a high-resolution image of the current
    // view, or a clip of up to a minute, to document part of the flight.
    this.shotCapture = new ViewCapture({
      viewer,
      describe,
      holdRender,
      releaseRender,
      maxSeconds: CLIP_MAX_SECONDS,
      paintOverlay,
      onState: (state) => this.renderShotState(state),
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
      setUserLayer: (step) => this.showUpload(step),
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
      this.baseTable = null;
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
    this.buildUpload();
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
      this.uploadBox,
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
    this.photoButton = element('button', {
      type: 'button',
      className: 'curated-button curated-photo',
      textContent: 'PHOTO',
      title: 'Save a high-resolution image of this view',
    });
    this.photoButton.addEventListener('click', () => this.takePhoto());
    this.clipButton = element('button', {
      type: 'button',
      className: 'curated-button curated-clip',
      textContent: 'REC',
      title: `Record a clip of up to ${CLIP_MAX_SECONDS / 60} minute`,
    });
    this.clipButton.setAttribute('aria-pressed', 'false');
    this.clipButton.addEventListener('click', () => this.toggleClip());
    this.captureControls = element(
      'div',
      {
        className: 'curated-capture',
        role: 'group',
        ariaLabel: 'Photo and clip',
      },
      [this.photoButton, this.clipButton],
    );
    // Show or hide the upload on the map at any point of the tour.
    this.myDataButton = element('button', {
      type: 'button',
      className: 'curated-button curated-mydata',
      textContent: 'MY DATA',
      title: 'Show or hide your uploaded data on the map',
      hidden: true,
    });
    this.myDataButton.setAttribute('aria-pressed', 'false');
    this.myDataButton.addEventListener('click', () => {
      this.overlay.setVisible(!this.overlay.visible);
      this.syncUploadVisibility();
    });
    this.captureControls.append(this.myDataButton);
    this.legendEl = element('aside', {
      className: 'curated-legend',
      hidden: true,
      ariaLabel: 'Your data legend',
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
        this.captureControls,
        this.layerJump,
      ],
    );
    this.controls.hidden = false;
    document.body.append(this.root, this.cardEl, this.flightBar, this.legendEl);
  }

  // ---------- your data ----------

  buildUpload() {
    this.fileInput = element('input', {
      type: 'file',
      className: 'curated-file',
      accept: '.csv,.tsv,.txt,.xlsx,.xlsm,.geojson,.json,.geojsonl,.zip',
      ariaLabel: 'Add your own data',
    });
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) this.addUpload(file);
    });
    this.uploadInfo = element('p', { className: 'curated-upload-info' });
    this.columnSelect = element('select', { ariaLabel: 'Value column' });
    this.methodSelect = element('select', { ariaLabel: 'How to combine' });
    this.labelInput = element('input', {
      type: 'text',
      className: 'curated-upload-label',
      ariaLabel: 'Layer name',
      spellcheck: false,
    });
    this.unitInput = element('input', {
      type: 'text',
      className: 'curated-upload-label',
      ariaLabel: 'Unit',
      placeholder: 'e.g. % of adults',
      spellcheck: false,
    });
    this.keepBox = element('input', { type: 'checkbox', checked: true });
    const changed = () => {
      if (!this.upload) return;
      const column = this.columnSelect.value || null;
      this.upload.options = {
        ...this.upload.options,
        column,
        method: this.methodSelect.value,
        label: this.labelInput.value.trim() || 'My data',
        unit: this.unitInput.value.trim(),
      };
      this.applyUpload();
    };
    for (const control of [this.columnSelect, this.methodSelect])
      control.addEventListener('change', changed);
    this.labelInput.addEventListener('change', changed);
    this.unitInput.addEventListener('change', changed);
    this.keepBox.addEventListener('change', () => {
      this.keepUpload = this.keepBox.checked;
    });
    const show = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'SHOW ON MAP',
      title: 'Draw your data on the map now, with any other layers',
    });
    show.addEventListener('click', () => this.previewUpload());
    const remove = element('button', {
      type: 'button',
      className: 'curated-button',
      textContent: 'REMOVE',
    });
    remove.addEventListener('click', () => this.removeUpload());
    this.uploadOptions = element(
      'div',
      { className: 'curated-upload-options', hidden: true },
      [
        element('label', { className: 'curated-check' }, [
          'Value ',
          this.columnSelect,
        ]),
        element('label', { className: 'curated-check' }, [
          'Combine ',
          this.methodSelect,
        ]),
        element('label', { className: 'curated-check' }, [
          'Name ',
          this.labelInput,
        ]),
        element('label', { className: 'curated-check' }, [
          'Unit ',
          this.unitInput,
        ]),
        element('label', { className: 'curated-check' }, [
          this.keepBox,
          ' Keep it on the map with every layer',
        ]),
        element('div', { className: 'curated-upload-actions' }, [show, remove]),
      ],
    );
    this.uploadBox = element('div', { className: 'curated-upload' }, [
      element('label', {
        className: 'curated-label',
        textContent: 'Your data (optional)',
      }),
      element('small', {
        className: 'curated-hint',
        textContent:
          'CSV, GeoJSON or a zipped shapefile, with census GEOIDs (tract, county, place, state) or latitude/longitude. It stays in this browser tab.',
      }),
      this.fileInput,
      this.uploadInfo,
      this.uploadOptions,
    ]);
  }

  async addUpload(file) {
    this.uploadInfo.textContent = `Reading ${file.name}…`;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dataset = await readUpload(file.name, bytes);
      this.overlay.clear();
      this.upload = { dataset, options: defaultOptions(dataset) };
      this.fillUploadControls();
      this.applyUpload({ check: true });
    } catch (error) {
      this.uploadInfo.textContent = error.message;
      this.fileInput.value = '';
    }
  }

  fillUploadControls() {
    const { dataset, options } = this.upload;
    this.columnSelect.textContent = '';
    if (dataset.kind === 'points' || !dataset.numeric.length)
      this.columnSelect.append(
        element('option', { value: '', textContent: '(none: count them)' }),
      );
    for (const column of dataset.numeric)
      this.columnSelect.append(
        element('option', { value: column, textContent: column }),
      );
    this.columnSelect.value = options.column || '';
    this.methodSelect.textContent = '';
    for (const method of methodsFor(dataset))
      this.methodSelect.append(
        element('option', { value: method, textContent: METHODS[method] }),
      );
    this.methodSelect.value = options.method;
    this.labelInput.value = options.label;
    this.unitInput.value = options.unit;
    this.keepBox.checked = this.keepUpload;
    this.uploadOptions.hidden = false;
    const count = dataset.records.length.toLocaleString('en-US');
    const what = LEVEL_PLURAL[dataset.level] || 'records';
    this.uploadInfo.textContent = [
      `${dataset.name}: ${count} ${what}, joined by ${dataset.join}.`,
      ...dataset.notes,
    ].join(' ');
  }

  /** Put the upload into the flight table (as a layer) and the form. */
  applyUpload({ check = false } = {}) {
    if (!this.baseTable) return;
    const checked = new Set(this.readForm().layers);
    if (check && this.upload) checked.add(USER_LAYER_KEY);
    this.table = this.upload
      ? tableWithUpload(
          this.baseTable,
          this.upload.dataset,
          this.upload.options,
        )
      : this.baseTable;
    this.renderLayerChoices();
    for (const box of this.layerBox.querySelectorAll('input'))
      box.checked =
        checked.has(box.value) && Boolean(this.table.layers[box.value]);
    // A new upload never pushes the flight past the layer limit.
    const boxes = [...this.layerBox.querySelectorAll('input:checked')];
    if (boxes.length > MAX_LAYERS)
      boxes.find((box) => box.value === USER_LAYER_KEY).checked = false;
    this.syncLayerCount();
    if (this.plan?.ok)
      this.plan = {
        ...this.plan,
        layers: this.plan.layers.filter((key) => this.table.layers[key]),
      };
    if (this.overlay.drawn) this.previewUpload();
  }

  removeUpload() {
    this.upload = null;
    this.overlay.clear();
    this.fileInput.value = '';
    this.uploadInfo.textContent = '';
    this.uploadOptions.hidden = true;
    this.applyUpload();
    this.syncUploadVisibility();
  }

  /** Draw the upload now (shapes for ID-only files: the cities in the form). */
  async previewUpload() {
    if (!this.upload) return;
    const { dataset, options } = this.upload;
    const plan = planFlight(this.readForm(), this.table);
    let outlines = new Map();
    if (dataset.records.some((record) => record.geoid && !record.geometry)) {
      if (!plan.cities.length) {
        this.uploadInfo.textContent =
          'Enter a city first: files with IDs only are drawn with the census shapes around the flight’s cities.';
        return;
      }
      ({ outlines } = await shapesForFlight(dataset, plan.cities));
    }
    const drawn = this.overlay.draw(dataset, options, outlines);
    this.syncUploadVisibility();
    if (!drawn.areas && !drawn.points)
      this.showToast(
        'None of your data falls on the shapes around these cities.',
      );
  }

  /**
   * The flight's call at each step: true on the upload's own stop, false on
   * any other layer, null when the tour ends.
   */
  showUpload(step) {
    if (!this.overlay.drawn) return;
    if (step === null) this.overlay.setVisible(false);
    else {
      // Its own stop fills the areas; beside another layer, dots.
      this.overlay.setMode(step ? 'fill' : 'dots');
      this.overlay.setVisible(step || this.keepUpload);
    }
    this.syncUploadVisibility();
  }

  syncUploadVisibility() {
    const on = this.overlay.visible && Boolean(this.overlay.legend);
    this.myDataButton.hidden = !this.overlay.drawn || !this.flight?.running;
    this.myDataButton.setAttribute('aria-pressed', String(on));
    this.myDataButton.classList.toggle('active', on);
    this.legendEl.hidden = !on;
    this.legendEl.textContent = '';
    if (!on) return;
    const { label, breaks = [], colors } = this.overlay.legend;
    const digits = this.upload?.options.decimals ?? 1;
    const fmt = (value) =>
      value.toLocaleString('en-US', { maximumFractionDigits: digits });
    this.legendEl.append(element('strong', { textContent: label }));
    colors.forEach((color, i) => {
      const swatch = element('i', { className: 'curated-swatch' });
      swatch.style.background = color;
      const text = !breaks.length
        ? 'Your data'
        : i === 0
          ? `below ${fmt(breaks[0])}`
          : i === breaks.length
            ? `${fmt(breaks[i - 1])} and above`
            : `${fmt(breaks[i - 1])} to ${fmt(breaks[i])}`;
      this.legendEl.append(element('span', {}, [swatch, ` ${text}`]));
    });
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
        this.baseTable = await loadCuratedTable();
        this.table = this.upload
          ? tableWithUpload(
              this.baseTable,
              this.upload.dataset,
              this.upload.options,
            )
          : this.baseTable;
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

  /** PHOTO during a flight: a high-resolution image of the current view. */
  takePhoto() {
    if (!this.flight.running) return false;
    return this.shotCapture.snapshot();
  }

  /** REC during a flight: start or stop a clip (up to a minute). */
  toggleClip() {
    if (!this.shotCapture.recording) {
      if (!this.flight.running) return false;
      // One recorder at a time: the whole flight is already being recorded.
      if (this.capture.recording) {
        this.showToast('The whole flight is already being recorded.');
        return false;
      }
    }
    return this.shotCapture.toggleClip();
  }

  renderShotState(state) {
    if (!this.photoButton) return;
    this.photoButton.disabled = Boolean(state.busy);
    this.clipButton.classList.toggle('recording', Boolean(state.recording));
    this.clipButton.setAttribute(
      'aria-pressed',
      String(Boolean(state.recording)),
    );
    this.clipButton.textContent = state.recording
      ? `STOP ${formatClipTime(state.elapsedSeconds, state.maxSeconds)}`
      : 'REC';
    if (state.saved) this.showToast(`Saved to Downloads: ${state.saved}`);
    if (state.error) this.showToast(`Capture: ${state.error}`);
  }

  renderFlightState(state) {
    this.flightBar.hidden = !state.running;
    // Landing (or stopping) ends and saves a clip in progress.
    if (!state.running) this.shotCapture?.stopClip();
    this.startButton.disabled = state.running;
    if (state.running) this.renderLayerJump();
    this.syncUploadVisibility();
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
    // Your data: its city / county / state values, and its shapes on the map
    // (kept with every layer when asked, else on its own stop only).
    if (this.upload) {
      this.setStatus('Matching your data to the cities…');
      const { dataset, options } = this.upload;
      try {
        const shapes = await shapesForFlight(dataset, plan.cities);
        if (plan.layers.includes(USER_LAYER_KEY))
          for (const city of plan.cities) {
            research[city.id] ||= {};
            research[city.id][USER_LAYER_KEY] = userLayerValues(
              dataset,
              options,
              city,
              {
                county: table.counties?.[city.county?.fips],
                stateGeometry: shapes.states.get(city.stateFips),
                tractPoints: shapes.tractPoints,
              },
            );
          }
        this.overlay.draw(dataset, options, shapes.outlines);
        this.overlay.setMode('dots');
        this.overlay.setVisible(this.keepUpload);
      } catch (error) {
        this.showToast(`Your data: ${error.message}`);
      }
    }
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
    this.shotCapture.destroy();
    this.overlay.clear();
    for (const remove of this.removers.splice(0)) remove();
    this.root.remove();
    this.cardEl.remove();
    this.flightBar.remove();
    this.legendEl.remove();
  }
}
