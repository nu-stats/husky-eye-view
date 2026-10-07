/**
 * The Area Reports panel (Data Layers → Area Reports) and the controller the
 * voice assistant shares: rank counties, census tracts or states by any
 * layer's measure and save the result as PDF, CSV and XLSX (one ZIP).
 * Everything is computed in the browser from the map's own area files.
 */
import {
  STATES,
  planReport,
  reportFiles,
  reportRows,
  reportTitle,
  formatValue,
} from './areaReport.js';
import { loadReportAreas } from './reportData.js';
import {
  DEFAULT_REPORT,
  REPORT_GEOGRAPHIES,
  measuresFor,
} from './reportMeasures.js';

export const REPORTS_OPEN_EVENT = 'gev:area-reports-open';

/** "Cook County, IL", "Census Tract 3831.01, Middlesex County, MA", "Illinois". */
const areaLabel = (plan, r) =>
  plan.geography === 'state'
    ? r.area
    : plan.geography === 'tract'
      ? `${r.area}, ${r.county}, ${r.stateAbbr}`
      : `${r.area}, ${r.stateAbbr}`;

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

export class AreaReportsPanel {
  constructor({ showToast = () => {} } = {}) {
    this.showToast = showToast;
    this.busy = false;
    this.last = null;
    this.removers = [];
    this.build();
    const onOpen = () => this.open();
    window.addEventListener(REPORTS_OPEN_EVENT, onOpen);
    this.removers.push(() =>
      window.removeEventListener(REPORTS_OPEN_EVENT, onOpen),
    );
  }

  build() {
    this.root = element('section', {
      id: 'area-reports-panel',
      className: 'curated-panel area-reports-panel',
      role: 'dialog',
      ariaLabel: 'Area Reports',
      hidden: true,
    });
    const close = element('button', {
      type: 'button',
      className: 'curated-close',
      ariaLabel: 'Close Area Reports',
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
    this.geography = select(
      'Areas',
      Object.entries(REPORT_GEOGRAPHIES).map(([id, g]) => [
        id,
        id === 'tract' ? 'Census tracts (one state)' : g.label,
      ]),
    );
    this.state = select('State', [
      ['', 'All states'],
      ...Object.entries(STATES)
        .sort((a, b) => a[1][1].localeCompare(b[1][1]))
        .map(([fips, [, name]]) => [fips, name]),
    ]);
    this.rankBy = element('select', { ariaLabel: 'Rank by' });
    this.order = select('Order', [
      ['desc', 'Largest first'],
      ['asc', 'Smallest first'],
    ]);
    this.limit = element('input', {
      type: 'number',
      min: '1',
      max: '500',
      value: String(DEFAULT_REPORT.limit),
      ariaLabel: 'How many',
      className: 'area-reports-limit',
    });
    this.columnBox = element('div', {
      className: 'curated-layers',
      role: 'group',
      ariaLabel: 'Columns',
    });
    this.formatBoxes = ['pdf', 'csv', 'xlsx'].map((format) =>
      element('input', { type: 'checkbox', value: format, checked: true }),
    );
    this.generateButton = element('button', {
      type: 'button',
      className: 'curated-button curated-start',
      textContent: 'CREATE REPORT',
    });
    this.generateButton.addEventListener('click', () =>
      this.generate(this.readForm()),
    );
    this.statusLine = element('p', {
      className: 'curated-status',
      ariaLive: 'polite',
    });
    this.preview = element('div', { className: 'area-reports-preview' });
    this.geography.addEventListener('change', () => this.syncMeasures());
    this.root.append(
      element('header', { className: 'curated-header' }, [
        element('span', { className: 'curated-kicker', textContent: 'DATA' }),
        element('strong', { textContent: 'AREA REPORTS' }),
        close,
      ]),
      element('div', { className: 'curated-form' }, [
        element('label', { className: 'curated-check' }, [
          'Areas ',
          this.geography,
        ]),
        element('label', { className: 'curated-check' }, ['In ', this.state]),
        element('label', { className: 'curated-check' }, [
          'Rank by ',
          this.rankBy,
        ]),
        element('div', { className: 'curated-options' }, [
          element('label', { className: 'curated-check' }, [this.order]),
          element('label', { className: 'curated-check' }, [
            'Top ',
            this.limit,
          ]),
        ]),
        element('label', {
          className: 'curated-label',
          textContent: 'Columns',
        }),
        this.columnBox,
        element(
          'div',
          { className: 'curated-options' },
          this.formatBoxes.map((box) =>
            element('label', { className: 'curated-check' }, [
              box,
              ` ${box.value.toUpperCase()}`,
            ]),
          ),
        ),
        this.generateButton,
        element('p', {
          className: 'curated-hint',
          textContent:
            'Or by voice: “Make a report of the 50 counties with the largest immigrant populations, with poverty, unemployment, life expectancy and cluster status.”',
        }),
      ]),
      this.statusLine,
      this.preview,
    );
    document.body.append(this.root);
    this.syncMeasures();
  }

  /** Rank-by choices and column boxes for the chosen geography. */
  syncMeasures(checked = null) {
    const geography = this.geography.value;
    const measures = measuresFor(geography);
    const previous = this.rankBy.value;
    this.rankBy.textContent = '';
    for (const m of measures.filter((x) => x.rankable !== false))
      this.rankBy.append(
        element('option', {
          value: m.id,
          textContent: `${m.short} (${m.years})`,
        }),
      );
    this.rankBy.value = measures.some((m) => m.id === previous)
      ? previous
      : geography === 'state'
        ? 'segregation-bw'
        : DEFAULT_REPORT.rankBy;
    const keep =
      checked ||
      new Set(
        geography === 'county'
          ? DEFAULT_REPORT.columns
          : [...this.columnBox.querySelectorAll('input:checked')].map(
              (b) => b.value,
            ),
      );
    this.columnBox.textContent = '';
    for (const m of measures)
      this.columnBox.append(
        element('label', { className: 'curated-check', title: m.source }, [
          element('input', {
            type: 'checkbox',
            value: m.id,
            checked: keep.has(m.id),
          }),
          ` ${m.short}`,
        ]),
      );
  }

  readForm() {
    return {
      geography: this.geography.value,
      state: this.state.value || null,
      rankBy: this.rankBy.value,
      order: this.order.value,
      limit: this.limit.value,
      columns: [...this.columnBox.querySelectorAll('input:checked')].map(
        (b) => b.value,
      ),
      formats: this.formatBoxes.filter((b) => b.checked).map((b) => b.value),
    };
  }

  /** Put a plan's choices into the form, so a voice request shows there. */
  fillForm(plan) {
    this.geography.value = plan.geography;
    this.syncMeasures(new Set(plan.columns.map((m) => m.id)));
    this.state.value = plan.state || '';
    this.rankBy.value = plan.rankBy.id;
    this.order.value = plan.order;
    this.limit.value = String(plan.limit);
    for (const box of this.formatBoxes)
      box.checked = plan.formats.includes(box.value);
  }

  setStatus(text) {
    this.statusLine.textContent = text || '';
  }

  open() {
    this.root.hidden = false;
    this.root.classList.add('visible');
  }

  close() {
    this.root.classList.remove('visible');
    this.root.hidden = true;
  }

  /**
   * Plan, rank and save a report (panel and voice). Resolves to a summary
   * the voice assistant can read back.
   */
  async generate(request = {}) {
    const plan = planReport(request);
    if (!plan.ok) {
      this.setStatus(plan.problems.join(' '));
      return { ok: false, problems: plan.problems };
    }
    if (this.busy)
      return { ok: false, error: 'A report is already being made.' };
    this.busy = true;
    this.fillForm(plan);
    this.open();
    try {
      this.setStatus(
        `Gathering ${REPORT_GEOGRAPHIES[plan.geography].label.toLowerCase()}…`,
      );
      const areas = await loadReportAreas(plan.geography, {
        state: plan.state,
      });
      const { rows, eligible } = reportRows(plan, areas);
      if (!rows.length) {
        const problem = `No ${plan.geography} has a value for ${plan.rankBy.short}.`;
        this.setStatus(problem);
        return { ok: false, problems: [...plan.problems, problem] };
      }
      const date = new Date();
      const file = reportFiles(plan, rows, { eligible, date });
      this.save(file);
      this.renderPreview(plan, rows);
      const title = reportTitle(plan);
      this.setStatus(`${title}: saved ${file.name}.`);
      this.last = { plan, rows, eligible, file: file.name };
      return {
        ok: true,
        title,
        file: file.name,
        formats: plan.formats,
        rows: rows.length,
        ranked: eligible,
        top: rows.slice(0, 5).map((r) => ({
          rank: r.rank,
          name: areaLabel(plan, r),
          value: formatValue(plan.rankBy, r.values[plan.rankBy.id]),
        })),
        problems: plan.problems,
      };
    } catch (error) {
      this.setStatus(`Report failed: ${error.message}`);
      return { ok: false, error: error.message };
    } finally {
      this.busy = false;
    }
  }

  renderPreview(plan, rows) {
    this.preview.textContent = '';
    const shown = plan.columns.slice(0, 3);
    const table = element('table', { className: 'area-reports-table' });
    table.append(
      element('tr', {}, [
        element('th', { textContent: '#' }),
        element('th', { textContent: REPORT_GEOGRAPHIES[plan.geography].noun }),
        ...shown.map((m) => element('th', { textContent: m.short })),
      ]),
    );
    for (const r of rows.slice(0, 10))
      table.append(
        element('tr', {}, [
          element('td', { textContent: String(r.rank) }),
          element('td', { textContent: areaLabel(plan, r) }),
          ...shown.map((m) =>
            element('td', { textContent: formatValue(m, r.values[m.id]) }),
          ),
        ]),
      );
    this.preview.append(
      table,
      element('small', {
        className: 'curated-hint',
        textContent:
          rows.length > 10
            ? `First 10 of ${rows.length} rows; the files have every row and column.`
            : 'The files have every column.',
      }),
    );
  }

  save({ name, data }) {
    const type = name.endsWith('.zip')
      ? 'application/zip'
      : name.endsWith('.pdf')
        ? 'application/pdf'
        : name.endsWith('.csv')
          ? 'text/csv;charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const url = URL.createObjectURL(new Blob([data], { type }));
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
      open: !this.root.hidden,
      busy: this.busy,
      last: this.last
        ? {
            title: reportTitle(this.last.plan),
            file: this.last.file,
            rows: this.last.rows.length,
          }
        : null,
    };
  }

  destroy() {
    for (const remove of this.removers.splice(0)) remove();
    this.root.remove();
  }
}
