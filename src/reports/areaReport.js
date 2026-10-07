/**
 * Area Reports, the pure part: read a request (from the panel or the voice
 * assistant), rank counties, tracts or states by one measure, and build the
 * PDF, CSV and XLSX files. No DOM, no network: reportData.js loads the areas
 * and the panel saves the files.
 */
import {
  PdfDocument,
  buildXlsx,
  buildZip,
  pdfTextWidth,
  pdfWrap,
} from '../curated/curatedFiles.js';
import { FOREIGN_BORN_COUNTRIES } from '../data/foreignBornCountries.js';
import {
  DEFAULT_REPORT,
  REPORT_GEOGRAPHIES,
  REPORT_MEASURES,
} from './reportMeasures.js';

export const MAX_REPORT_ROWS = 500;
export const REPORT_FORMATS = Object.freeze(['pdf', 'csv', 'xlsx']);

/** State FIPS -> [postal code, name]. */
export const STATES = Object.freeze({
  '01': ['AL', 'Alabama'],
  '02': ['AK', 'Alaska'],
  '04': ['AZ', 'Arizona'],
  '05': ['AR', 'Arkansas'],
  '06': ['CA', 'California'],
  '08': ['CO', 'Colorado'],
  '09': ['CT', 'Connecticut'],
  10: ['DE', 'Delaware'],
  11: ['DC', 'District of Columbia'],
  12: ['FL', 'Florida'],
  13: ['GA', 'Georgia'],
  15: ['HI', 'Hawaii'],
  16: ['ID', 'Idaho'],
  17: ['IL', 'Illinois'],
  18: ['IN', 'Indiana'],
  19: ['IA', 'Iowa'],
  20: ['KS', 'Kansas'],
  21: ['KY', 'Kentucky'],
  22: ['LA', 'Louisiana'],
  23: ['ME', 'Maine'],
  24: ['MD', 'Maryland'],
  25: ['MA', 'Massachusetts'],
  26: ['MI', 'Michigan'],
  27: ['MN', 'Minnesota'],
  28: ['MS', 'Mississippi'],
  29: ['MO', 'Missouri'],
  30: ['MT', 'Montana'],
  31: ['NE', 'Nebraska'],
  32: ['NV', 'Nevada'],
  33: ['NH', 'New Hampshire'],
  34: ['NJ', 'New Jersey'],
  35: ['NM', 'New Mexico'],
  36: ['NY', 'New York'],
  37: ['NC', 'North Carolina'],
  38: ['ND', 'North Dakota'],
  39: ['OH', 'Ohio'],
  40: ['OK', 'Oklahoma'],
  41: ['OR', 'Oregon'],
  42: ['PA', 'Pennsylvania'],
  44: ['RI', 'Rhode Island'],
  45: ['SC', 'South Carolina'],
  46: ['SD', 'South Dakota'],
  47: ['TN', 'Tennessee'],
  48: ['TX', 'Texas'],
  49: ['UT', 'Utah'],
  50: ['VT', 'Vermont'],
  51: ['VA', 'Virginia'],
  53: ['WA', 'Washington'],
  54: ['WV', 'West Virginia'],
  55: ['WI', 'Wisconsin'],
  56: ['WY', 'Wyoming'],
});

export const CLUSTER_LABELS = Object.freeze({
  HH: 'High–High (long-life cluster)',
  LL: 'Low–Low (short-life cluster)',
  HL: 'High–Low outlier',
  LH: 'Low–High outlier',
});
const NOT_SIGNIFICANT = 'Not significant';

const normalize = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();

/** A measure by id, label or spoken name, among those a geography has. */
export function findReportMeasure(query, geography = 'county') {
  const wanted = normalize(query);
  if (!wanted) return null;
  const pool = REPORT_MEASURES.filter((m) => m.geographies.includes(geography));
  const exact = pool.find(
    (m) =>
      m.id === String(query).trim() ||
      normalize(m.id) === wanted ||
      normalize(m.label) === wanted ||
      normalize(m.short) === wanted ||
      m.aliases?.some((a) => normalize(a) === wanted),
  );
  if (exact) return exact;
  return (
    pool.find((m) =>
      [m.short, ...(m.aliases || [])].some((a) => {
        const alias = normalize(a);
        return wanted.includes(alias) || alias.includes(wanted);
      }),
    ) || null
  );
}

/** "MA", "Massachusetts" or "25" -> "25". */
export function findState(query) {
  const wanted = normalize(query);
  if (!wanted) return null;
  for (const [fips, [abbr, name]] of Object.entries(STATES))
    if (
      wanted === fips ||
      wanted === abbr.toLowerCase() ||
      wanted === normalize(name)
    )
      return fips;
  return null;
}

const GEOGRAPHY_WORDS = {
  county: 'county',
  counties: 'county',
  tract: 'tract',
  tracts: 'tract',
  'census tracts': 'tract',
  neighborhoods: 'tract',
  state: 'state',
  states: 'state',
};

/**
 * Validate a report request. Unknown names come back in `problems` rather
 * than being dropped silently. Returns {ok, problems, geography, rankBy,
 * order, limit, columns, formats, state}.
 */
export function planReport(request = {}) {
  const problems = [];
  const geography =
    GEOGRAPHY_WORDS[normalize(request.geography)] ||
    (request.geography ? null : DEFAULT_REPORT.geography);
  if (!geography) {
    problems.push(
      `Reports cover counties, census tracts or states, not “${request.geography}”.`,
    );
    return { ok: false, problems };
  }
  const fallbackRank =
    geography === 'state' ? 'segregation-bw' : DEFAULT_REPORT.rankBy;
  let rankBy = findReportMeasure(request.rankBy || fallbackRank, geography);
  if (rankBy && rankBy.rankable === false) {
    problems.push(
      `${rankBy.short} is a category, so the report cannot rank by it.`,
    );
    rankBy = null;
  }
  if (!rankBy)
    problems.push(
      `No ${REPORT_GEOGRAPHIES[geography].noun} measure matches “${request.rankBy}”.`,
    );
  const word = normalize(request.order);
  const order = /^(asc|smallest|lowest|fewest|least|bottom)/.test(word)
    ? 'asc'
    : 'desc';
  const asked = Number.parseInt(request.limit, 10);
  const limit = Number.isFinite(asked)
    ? Math.min(MAX_REPORT_ROWS, Math.max(1, asked))
    : DEFAULT_REPORT.limit;
  if (Number.isFinite(asked) && asked > MAX_REPORT_ROWS)
    problems.push(`A report lists at most ${MAX_REPORT_ROWS} rows.`);
  const columns = [];
  // Default columns a geography lacks (life expectancy for tracts) are
  // skipped quietly; asked-for ones that do not exist are reported.
  const chosen = Array.isArray(request.columns);
  const wanted = chosen ? request.columns : DEFAULT_REPORT.columns;
  for (const name of wanted) {
    const m = findReportMeasure(name, geography);
    if (!m) {
      if (chosen)
        problems.push(
          `No ${REPORT_GEOGRAPHIES[geography].noun} measure matches “${name}”; left out.`,
        );
      continue;
    }
    if (!columns.includes(m)) columns.push(m);
  }
  if (rankBy && !columns.includes(rankBy)) columns.unshift(rankBy);
  let state = null;
  if (request.state) {
    state = findState(request.state);
    if (!state) problems.push(`No state matches “${request.state}”.`);
  }
  if (geography === 'tract' && !state)
    problems.push(
      'Tract reports need a state (all US tracts are too many to load).',
    );
  const formats = (
    Array.isArray(request.formats) && request.formats.length
      ? request.formats
      : DEFAULT_REPORT.formats
  )
    .map((f) => normalize(f).replace(/^excel$/, 'xlsx'))
    .filter((f) => REPORT_FORMATS.includes(f));
  const ok =
    Boolean(rankBy) &&
    !(geography === 'tract' && !state) &&
    !(request.state && !state);
  return {
    ok,
    problems,
    geography,
    rankBy,
    order,
    limit,
    columns,
    formats: formats.length ? [...new Set(formats)] : [...REPORT_FORMATS],
    state,
  };
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Name parts from an area's "Census Tract 1, Suffolk County, MA" name. */
function areaNames(geography, p) {
  const parts = String(p.name || '')
    .split(',')
    .map((s) => s.trim());
  if (geography === 'state') return { area: p.name || '' };
  if (geography === 'county')
    return {
      area: parts.length > 1 ? parts.slice(0, -1).join(', ') : parts[0],
    };
  return { area: parts[0] || '', county: parts[1] || '' };
}

/**
 * The ranked rows: areas (map properties) with a value for the ranked
 * measure, in the state when one is given, largest (or smallest) first.
 * Returns {rows, eligible} where eligible counts the areas ranked.
 */
export function reportRows(plan, areas) {
  const key = plan.rankBy.key;
  const pool = areas.filter((p) => {
    const id = String(p.geoid || '');
    if (plan.state && !id.startsWith(plan.state)) return false;
    return finite(p[key]) !== null;
  });
  const sign = plan.order === 'asc' ? 1 : -1;
  pool.sort(
    (a, b) =>
      sign * (a[key] - b[key]) ||
      String(a.name || '').localeCompare(String(b.name || '')),
  );
  const rows = pool.slice(0, plan.limit).map((p, i) => {
    const geoid = String(p.geoid);
    const stateFips = geoid.slice(0, 2);
    const [abbr, stateName] = STATES[stateFips] || ['', ''];
    return {
      rank: i + 1,
      geoid,
      stateFips,
      countyFips: plan.geography === 'state' ? '' : geoid.slice(2, 5),
      tract: plan.geography === 'tract' ? geoid.slice(5) : '',
      stateName,
      stateAbbr: abbr,
      ...areaNames(plan.geography, p),
      values: Object.fromEntries(
        plan.columns.map((m) => [m.id, p[m.key] ?? null]),
      ),
    };
  });
  return { rows, eligible: pool.length };
}

/** "Mexico 12.3%; China 4.1%; …" from the encoded top countries. */
export function decodeCountries(encoded, countries = FOREIGN_BORN_COUNTRIES) {
  return String(encoded || '')
    .split(',')
    .filter(Boolean)
    .map((pair) => {
      const [index, pct] = pair.split(':');
      return `${countries[Number(index)] || 'Unknown'} ${Number(pct).toFixed(1)}%`;
    })
    .join('; ');
}

/** A cell as the reader sees it (PDF): "12,345", "12.3%", "$54,000". */
export function formatValue(measure, raw) {
  if (measure.format === 'category') return categoryText(measure, raw);
  const v = finite(raw);
  if (v === null) return '—';
  const digits = measure.decimals ?? 1;
  const n = (x, d) =>
    x.toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  if (measure.format === 'count') return n(Math.round(v), 0);
  if (measure.format === 'percent') return `${n(v, digits)}%`;
  if (measure.format === 'dollars') return `$${n(Math.round(v), 0)}`;
  return n(v, digits);
}

function categoryText(measure, raw) {
  if (measure.key === 'cluster') return CLUSTER_LABELS[raw] || NOT_SIGNIFICANT;
  if (measure.key.startsWith('fbt')) return decodeCountries(raw) || '—';
  return raw === null || raw === undefined ? '—' : String(raw);
}

/** A cell for data files: numbers stay numbers, categories become text. */
export function dataValue(measure, raw) {
  if (measure.format === 'category') return categoryText(measure, raw);
  const v = finite(raw);
  if (v === null) return null;
  return measure.format === 'count' ? Math.round(v) : v;
}

const plural = (geography) =>
  ({ county: 'counties', tract: 'census tracts', state: 'states' })[geography];

/** How a title names a measure ("…with the highest <phrase>"). */
const TITLE_PHRASES = Object.freeze({
  population: 'population',
  'foreign-born-count': 'foreign-born population',
  'foreign-born-share': 'share of foreign-born residents',
  'foreign-born-share-2010': 'share of foreign-born residents in 2006–10',
  'foreign-born-share-2000': 'share of foreign-born residents in 2000',
  bachelors: "share of adults with a bachelor's degree",
  renters: 'share of renter-occupied homes',
  black: 'share of Black residents',
  hispanic: 'share of Hispanic or Latino residents',
  'no-vehicle': 'share of households without a vehicle',
  internet: 'share of households with internet at home',
  broadband: 'share of households with broadband',
  'life-expectancy-2000': 'life expectancy in 2000',
  pm25: 'fine-particle (PM2.5) levels',
  ozone: 'ozone levels',
  'park-access': 'share of residents near a park',
  'asu-broadband': 'broadband at home (ASU estimates)',
  'ntia-internet-use': 'adult internet use',
});

/** "The 50 counties with the largest foreign-born population". */
export function reportTitle(plan) {
  const m = plan.rankBy;
  const desc = plan.order === 'desc';
  const phrase =
    TITLE_PHRASES[m.id] ||
    m.label
      .replace(/\s*\(.*?\)\s*/g, ' ')
      .trim()
      .toLowerCase();
  const most = desc ? 'highest' : 'lowest';
  const what = `${m.format === 'count' ? (desc ? 'largest' : 'smallest') : most} ${phrase}`;
  const where = plan.state ? ` in ${STATES[plan.state][1]}` : '';
  return `The ${plan.limit} ${plural(plan.geography)}${where} with the ${what}`;
}

/** Header labels and row cells for the data files. */
export function reportTable(plan, rows) {
  const id =
    plan.geography === 'state'
      ? [
          ['State FIPS', (r) => r.stateFips],
          ['State', (r) => r.stateName],
        ]
      : plan.geography === 'county'
        ? [
            ['State FIPS', (r) => r.stateFips],
            ['County FIPS', (r) => r.countyFips],
            ['State', (r) => r.stateName],
            ['County', (r) => r.area],
          ]
        : [
            ['State FIPS', (r) => r.stateFips],
            ['County FIPS', (r) => r.countyFips],
            ['Tract code', (r) => r.tract],
            ['State', (r) => r.stateName],
            ['County', (r) => r.county],
            ['Tract', (r) => r.area],
          ];
  const header = [
    'Rank',
    ...id.map(([label]) => label),
    ...plan.columns.map((m) => `${m.label}, ${m.years}`),
  ];
  const body = rows.map((r) => [
    r.rank,
    ...id.map(([, get]) => get(r)),
    ...plan.columns.map((m) => dataValue(m, r.values[m.id])),
  ]);
  return { header, body };
}

/** RFC 4180 CSV, UTF-8 with BOM so Excel reads the dashes and µ. */
export function reportCsv(plan, rows) {
  const { header, body } = reportTable(plan, rows);
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const text = String(v);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${[header, ...body].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** The notes every file carries: the request, the method and each source. */
export function reportNotes(plan, { eligible, date = new Date() } = {}) {
  const noun = REPORT_GEOGRAPHIES[plan.geography].noun;
  return [
    ['Report', reportTitle(plan)],
    [
      'Prepared',
      `${date.toISOString().slice(0, 10)} with Husky Eye View (Northeastern University)`,
    ],
    [
      'Ranked by',
      `${plan.rankBy.label}, ${plan.rankBy.years} (${plan.order === 'desc' ? 'largest first' : 'smallest first'})`,
    ],
    [
      'Areas ranked',
      `${Number(eligible || 0).toLocaleString('en-US')} ${plural(plan.geography)} with a value${plan.state ? ` in ${STATES[plan.state][1]}` : ''}`,
    ],
    ...plan.columns.map((m) => [
      m.short,
      `${m.label}, ${m.years}. ${m.source}.`,
    ]),
    ...(plan.columns.some((m) => m.key === 'cluster')
      ? [
          [
            'Reading clusters',
            `Local Moran's I on 2015 county life expectancy: High–High counties have long lives and long-lived neighbors; Low–Low short lives among short-lived neighbors; outliers differ from their neighbors. "${NOT_SIGNIFICANT}" means no significant local cluster (p of 0.05 or more).`,
          ],
        ]
      : []),
    ...(plan.columns.some((m) => m.key.startsWith('fb'))
      ? [
          [
            'About foreign-born',
            'Residents born outside the United States. Countries of birth are as the Census tables name them; each country is a share of all residents.',
          ],
        ]
      : []),
    [
      'Note',
      `ACS values are survey estimates with margins of error, wider for smaller ${noun === 'tract' ? 'areas such as tracts' : 'areas'}. Data years differ by column.`,
    ],
  ];
}

export function reportXlsx(plan, rows, meta) {
  const { header, body } = reportTable(plan, rows);
  return buildXlsx([
    { name: 'Report', rows: [header, ...body] },
    { name: 'About', rows: [['Item', 'Details'], ...reportNotes(plan, meta)] },
  ]);
}

/** A landscape PDF: title, ranked table (header on every page), notes. */
export function reportPdf(plan, rows, meta = {}) {
  const date = meta.date || new Date();
  const pdf = new PdfDocument({
    width: 792,
    height: 612,
    title: `Husky Eye View · ${reportTitle(plan)}`,
  });
  const M = 36;
  const W = pdf.width - M * 2;
  const footer = () => {
    pdf.line(M, pdf.height - 30, pdf.width - M, pdf.height - 30, {
      color: '#d9d8d2',
    });
    pdf.text(
      M,
      pdf.height - 18,
      'Husky Eye View · Area report · For research use',
      {
        size: 7.5,
        color: '#8a8984',
      },
    );
    pdf.text(pdf.width - M, pdf.height - 18, `Page ${pdf.pages.length}`, {
      size: 7.5,
      color: '#8a8984',
      align: 'right',
    });
  };
  pdf.rect(0, 0, pdf.width, 6, { fill: '#C8102E' });
  pdf.text(M, 40, 'AREA REPORT', { size: 9, bold: true, color: '#C8102E' });
  let y = pdf.paragraph(M, 64, reportTitle(plan), W, {
    size: 18,
    bold: true,
    leading: 1.2,
  });
  pdf.text(
    M,
    y + 2,
    `Prepared ${date.toISOString().slice(0, 10)} with Husky Eye View · ranked among ${Number(meta.eligible || 0).toLocaleString('en-US')} ${plural(plan.geography)} with a value · sources and notes on the last page`,
    { size: 8.5, color: '#52514e' },
  );
  y += 22;

  // Columns: identifiers, then the measures; widths from their contents.
  const SIZE = 7.5;
  const idCols =
    plan.geography === 'state'
      ? [
          ['Rank', (r) => String(r.rank)],
          ['FIPS', (r) => r.stateFips],
          ['State', (r) => r.stateName],
        ]
      : plan.geography === 'county'
        ? [
            ['Rank', (r) => String(r.rank)],
            ['State FIPS', (r) => r.stateFips],
            ['County FIPS', (r) => r.countyFips],
            ['State', (r) => r.stateName],
            ['County', (r) => r.area],
          ]
        : [
            ['Rank', (r) => String(r.rank)],
            ['County FIPS', (r) => r.countyFips],
            ['Tract', (r) => r.tract],
            ['County', (r) => r.county],
            ['Name', (r) => r.area],
          ];
  const columns = [
    ...idCols.map(([label, get]) => ({
      label,
      get,
      right: label !== 'State' && label !== 'County' && label !== 'Name',
    })),
    ...plan.columns.map((m) => ({
      label: m.short,
      get: (r) => formatValue(m, r.values[m.id]),
      right: m.format !== 'category',
      wrap: m.format === 'category',
    })),
  ];
  for (const col of columns) {
    const widest = Math.max(
      ...rows.map((r) => pdfTextWidth(col.get(r), SIZE)),
      ...pdfWrap(col.label, SIZE, 70, true).map((l) =>
        pdfTextWidth(l, SIZE, true),
      ),
    );
    col.width = Math.min(col.wrap ? 190 : 120, widest + 8);
  }
  const total = columns.reduce((s, c) => s + c.width, 0);
  const scale = total > W ? W / total : 1;
  let x = M;
  for (const col of columns) {
    col.width *= scale;
    col.x = x;
    x += col.width;
  }
  const header = (top) => {
    const lines = columns.map((c) => pdfWrap(c.label, SIZE, c.width - 6, true));
    const h = Math.max(...lines.map((l) => l.length)) * SIZE * 1.25 + 8;
    pdf.rect(M, top, W, h, { fill: '#f1f0ec' });
    columns.forEach((c, i) =>
      lines[i].forEach((line, j) =>
        pdf.text(
          c.right ? c.x + c.width - 3 : c.x + 3,
          top + 10 + j * SIZE * 1.25,
          line,
          {
            size: SIZE,
            bold: true,
            color: '#333333',
            align: c.right ? 'right' : 'left',
          },
        ),
      ),
    );
    return top + h + 2;
  };
  y = header(y);
  rows.forEach((r, index) => {
    const cells = columns.map((c) =>
      c.wrap ? pdfWrap(c.get(r), SIZE, c.width - 6) : [c.get(r)],
    );
    const h = Math.max(...cells.map((l) => l.length)) * SIZE * 1.25 + 4;
    if (y + h > pdf.height - 40) {
      footer();
      pdf.addPage();
      y = header(28);
    }
    if (index % 2 === 1) pdf.rect(M, y - 1, W, h, { fill: '#f8f7f4' });
    columns.forEach((c, i) =>
      cells[i].forEach((line, j) =>
        pdf.text(
          c.right ? c.x + c.width - 3 : c.x + 3,
          y + SIZE + j * SIZE * 1.25,
          line,
          {
            size: SIZE,
            align: c.right ? 'right' : 'left',
          },
        ),
      ),
    );
    y += h;
  });
  footer();

  // Sources and notes.
  pdf.addPage();
  pdf.text(M, 44, 'Sources and notes', { size: 14, bold: true });
  y = 66;
  for (const [label, text] of reportNotes(plan, { ...meta, date })) {
    if (y > pdf.height - 60) {
      footer();
      pdf.addPage();
      y = 44;
    }
    pdf.text(M, y, label, { size: 9, bold: true });
    y =
      pdf.paragraph(M + 130, y, text, W - 130, { size: 9, color: '#333333' }) +
      6;
  }
  footer();
  return pdf.build();
}

/** husky-eye-view_report_counties_foreign-born-count_top-50_2026-10-06 */
export function reportFileBase(plan, date = new Date()) {
  const where = plan.state ? `_${STATES[plan.state][0].toLowerCase()}` : '';
  return `husky-eye-view_report_${plural(plan.geography).replace(/ /g, '-')}${where}_${plan.rankBy.id}_${plan.order === 'desc' ? 'top' : 'bottom'}-${plan.limit}_${date.toISOString().slice(0, 10)}`;
}

/** The asked-for files, in one ZIP when there is more than one. */
export function reportFiles(plan, rows, meta = {}) {
  const base = reportFileBase(plan, meta.date);
  const files = [];
  if (plan.formats.includes('pdf'))
    files.push({ name: `${base}.pdf`, data: reportPdf(plan, rows, meta) });
  if (plan.formats.includes('csv'))
    files.push({ name: `${base}.csv`, data: reportCsv(plan, rows) });
  if (plan.formats.includes('xlsx'))
    files.push({ name: `${base}.xlsx`, data: reportXlsx(plan, rows, meta) });
  return files.length === 1
    ? files[0]
    : { name: `${base}.zip`, data: buildZip(files, meta.date) };
}
