/**
 * Curated Flights outputs: comparison charts (high-resolution PNG or JPG),
 * the data file (CSV or XLSX) and the PDF report. Built in the browser from
 * the unlocked city table; nothing leaves the machine except as a download.
 */
import {
  ROW_COLUMNS,
  compareSentence,
  comparisonRows,
  formatValue,
  layerValues,
  rowsToCsv,
} from './curatedModel.js';
import { PdfDocument, buildXlsx, buildZip, pdfWrap } from './curatedFiles.js';

/** Chart size in pixels: 16:9, sharp in print and slides. */
export const CHART_WIDTH = 2400;
export const CHART_HEIGHT = 1350;

// Validated categorical slots 1–3 (dataviz reference palette, light mode):
// city, county, state. Aqua sits below 3:1 on the surface, so every bar
// carries a visible value label (the palette's relief rule).
const SERIES = Object.freeze([
  { key: 'city', label: 'City', color: '#2a78d6' },
  { key: 'county', label: 'County', color: '#eb6834' },
  { key: 'state', label: 'State', color: '#1baf7a' },
]);
const INK = Object.freeze({
  surface: '#fcfcfb',
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#8a8984',
  grid: '#e6e5e0',
});
const FONT = '"Inter", "Segoe UI", Helvetica, Arial, sans-serif';

/** 2026-10-04 in the viewer's local time (file names, report dates). */
export function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A "nice" axis maximum and step for values up to `max`. */
export function niceScale(max, ticks = 5) {
  if (!(max > 0)) return { max: 1, step: 0.2 };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ||
    10 * magnitude;
  return { max: Math.ceil(max / step) * step, step };
}

function roundedTopRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw one layer's comparison: for each city, its city / county / state
 * values as a group of bars from a zero baseline.
 */
export function drawComparisonChart(
  canvas,
  { layer, cities, research = {}, key, date = new Date() },
) {
  canvas.width = CHART_WIDTH;
  canvas.height = CHART_HEIGHT;
  const ctx = canvas.getContext('2d');
  const W = CHART_WIDTH;
  const H = CHART_HEIGHT;
  ctx.fillStyle = INK.surface;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // Title block.
  ctx.fillStyle = INK.primary;
  ctx.font = `700 64px ${FONT}`;
  ctx.fillText(layer.label, 120, 132);
  ctx.fillStyle = INK.secondary;
  ctx.font = `400 34px ${FONT}`;
  ctx.fillText(
    `City, county and state · ${layer.unit} · data ${layer.vintage}`,
    120,
    188,
  );
  // Legend (always present for three series).
  let lx = 120;
  for (const series of SERIES) {
    ctx.fillStyle = series.color;
    ctx.fillRect(lx, 228, 30, 30);
    ctx.fillStyle = INK.primary;
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText(series.label, lx + 44, 254);
    lx += 44 + ctx.measureText(series.label).width + 56;
  }

  const left = 200;
  const right = W - 120;
  const top = 320;
  const bottom = H - 250;
  const entries = cities.map((city) => ({
    city,
    values: layerValues(city, key, research),
  }));
  const maxValue = Math.max(
    0,
    ...entries.flatMap(({ values }) =>
      SERIES.map((s) => values[s.key]).filter(Number.isFinite),
    ),
  );
  const scale = niceScale(maxValue * 1.08);
  const y = (value) => bottom - (value / scale.max) * (bottom - top);

  // Recessive grid and axis labels.
  ctx.font = `400 28px ${FONT}`;
  ctx.textAlign = 'right';
  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
    const gy = y(v);
    ctx.strokeStyle = v === 0 ? INK.secondary : INK.grid;
    ctx.lineWidth = v === 0 ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(left, gy);
    ctx.lineTo(right, gy);
    ctx.stroke();
    ctx.fillStyle = INK.muted;
    ctx.fillText(
      v.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      left - 18,
      gy + 10,
    );
  }

  const groupWidth = (right - left) / Math.max(1, entries.length);
  const barWidth = Math.min(150, groupWidth * 0.2);
  const gap = 4; // 2 px surface gap at the 2× render scale
  entries.forEach(({ city, values }, index) => {
    const groupCenter = left + groupWidth * (index + 0.5);
    const total = SERIES.length * barWidth + (SERIES.length - 1) * gap;
    let x = groupCenter - total / 2;
    for (const series of SERIES) {
      const value = values[series.key];
      ctx.textAlign = 'center';
      if (Number.isFinite(value)) {
        const barTop = y(value);
        ctx.fillStyle = series.color;
        roundedTopRect(
          ctx,
          x,
          barTop,
          barWidth,
          Math.max(2, bottom - barTop),
          8,
        );
        ctx.fillStyle = INK.primary;
        ctx.font = `600 30px ${FONT}`;
        ctx.fillText(
          formatValue({ ...layer, unit: '' }, value),
          x + barWidth / 2,
          barTop - 16,
        );
      } else {
        ctx.fillStyle = INK.muted;
        ctx.font = `400 24px ${FONT}`;
        ctx.fillText('no data', x + barWidth / 2, bottom - 14);
      }
      x += barWidth + gap;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = INK.primary;
    ctx.font = `700 38px ${FONT}`;
    ctx.fillText(`${city.name}, ${city.stateAbbr}`, groupCenter, bottom + 64);
    ctx.fillStyle = INK.secondary;
    ctx.font = `400 28px ${FONT}`;
    ctx.fillText(
      `${city.county?.name || 'County'} · ${city.state}`,
      groupCenter,
      bottom + 106,
    );
  });

  // Footer: definition and provenance in muted text.
  ctx.textAlign = 'left';
  ctx.fillStyle = INK.muted;
  ctx.font = `400 24px ${FONT}`;
  ctx.fillText(
    [layer.note, layer.table ? `Source: ${layer.table}` : '']
      .filter(Boolean)
      .join('  ·  '),
    120,
    H - 72,
  );
  ctx.fillText(
    `Husky Eye View · Curated Flights · Northeastern University · ${localDate(date)}`,
    120,
    H - 36,
  );
  return canvas;
}

export const IMAGE_TYPES = Object.freeze({
  png: { type: 'image/png', extension: 'png' },
  jpg: { type: 'image/jpeg', extension: 'jpg', quality: 0.92 },
});

export function canvasBytes(canvas, format = 'png') {
  const kind = IMAGE_TYPES[format] || IMAGE_TYPES.png;
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      async (blob) => {
        if (!blob) reject(new Error('The browser could not encode the chart.'));
        else resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      kind.type,
      kind.quality,
    ),
  );
}

const slug = (text) =>
  String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Base file name for a flight's outputs. */
export function flightFileBase(plan, date = new Date()) {
  const cities = plan.cities.map((city) => slug(city.name)).join('-vs-');
  return `husky-eye-view_curated-flight_${cities}_${localDate(date)}`;
}

/** Every chart for a flight as `[{key, name, bytes}]`. */
export async function renderCharts(
  plan,
  table,
  research,
  format,
  doc = document,
  date = new Date(),
) {
  const charts = [];
  for (const key of plan.layers) {
    const canvas = doc.createElement('canvas');
    drawComparisonChart(canvas, {
      layer: table.layers[key],
      cities: plan.cities,
      research,
      key,
      date,
    });
    charts.push({
      key,
      name: `${flightFileBase(plan, date)}_${key}.${IMAGE_TYPES[format]?.extension || 'png'}`,
      bytes: await canvasBytes(canvas, format),
    });
  }
  return charts;
}

/** All charts in one ZIP (one file per layer). */
export async function chartsZip(
  plan,
  table,
  research,
  format,
  doc,
  date = new Date(),
) {
  const charts = await renderCharts(plan, table, research, format, doc, date);
  return buildZip(
    charts.map(({ name, bytes }) => ({ name, data: bytes })),
    date,
  );
}

/**
 * Everything for a flight in one ZIP: the report, the data (CSV and XLSX),
 * every chart and the city views from the flight, plus a short README.
 */
export async function buildAllZip(
  plan,
  table,
  research,
  { snapshots = {}, format = 'png', doc = document, date = new Date() } = {},
) {
  const base = flightFileBase(plan, date);
  const files = [
    {
      name: `${base}/report.pdf`,
      data: await buildReport(plan, table, research, { snapshots, doc, date }),
    },
    { name: `${base}/data.csv`, data: dataFile(plan, table, research, 'csv') },
    {
      name: `${base}/data.xlsx`,
      data: dataFile(plan, table, research, 'xlsx'),
    },
  ];
  for (const chart of await renderCharts(
    plan,
    table,
    research,
    format,
    doc,
    date,
  ))
    files.push({
      name: `${base}/charts/${chart.key}.${IMAGE_TYPES[format]?.extension || 'png'}`,
      data: chart.bytes,
    });
  for (const city of plan.cities) {
    const shot = snapshots[city.id];
    if (shot?.bytes)
      files.push({
        name: `${base}/city-views/${slug(city.name)}-${city.stateAbbr.toLowerCase()}.jpg`,
        data: shot.bytes,
      });
  }
  const readme = [
    'Husky Eye View - Curated Flight',
    `Cities: ${plan.cities.map((c) => `${c.name}, ${c.stateAbbr}`).join('; ')}`,
    `Layers: ${plan.layers.map((k) => table.layers[k].label).join('; ')}`,
    `Generated: ${localDate(date)}`,
    '',
    'Files: report.pdf (summary, charts, city pages, methods and data sources), data.csv / data.xlsx (every city x layer with county and state values), charts/ (one image per layer), city-views/ (pictures from the flight).',
    '',
    'Data sources (Census table / dataset):',
    ...plan.layers.map(
      (k) =>
        `- ${table.layers[k].label}: ${table.layers[k].table || ''}. ${table.layers[k].source || ''}`,
    ),
    '',
    `Method: ${table.method}`,
  ].join('\r\n');
  files.push({ name: `${base}/README.txt`, data: readme });
  return buildZip(files, date);
}

/** The data download: CSV text or XLSX bytes. */
export function dataFile(plan, table, research, format = 'csv') {
  const rows = comparisonRows(plan, table, research);
  if (format === 'csv') return rowsToCsv(rows);
  const header = ROW_COLUMNS.map(([, label]) => label);
  return buildXlsx([
    {
      name: 'Comparison',
      rows: [header, ...rows.map((row) => ROW_COLUMNS.map(([k]) => row[k]))],
    },
    {
      name: 'Data sources',
      rows: [
        [
          'Layer',
          'Census table / dataset',
          'Data years',
          'Source',
          'Definition',
        ],
        ...plan.layers.map((key) => {
          const layer = table.layers[key];
          return [
            layer.label,
            layer.table || '',
            layer.vintage,
            layer.source || '',
            layer.note || '',
          ];
        }),
      ],
    },
    {
      name: 'About',
      rows: [
        ['Husky Eye View · Curated Flight data'],
        ['Generated', localDate(new Date())],
        ['Method', table.method],
        ...table.sources.map((source, i) => [i ? '' : 'Sources', source]),
      ],
    },
  ]);
}

/**
 * The PDF report: cover and summary table, one page per layer (chart and
 * comparison sentences), one page per city (flight snapshot and values),
 * then methods and sources.
 */
export async function buildReport(
  plan,
  table,
  research,
  { snapshots = {}, doc = document, date = new Date() } = {},
) {
  const pdf = new PdfDocument({
    title: 'Husky Eye View · Curated Flight report',
  });
  const M = 54;
  const W = pdf.width - M * 2;
  const footer = () => {
    pdf.line(M, pdf.height - 46, pdf.width - M, pdf.height - 46, {
      color: '#d9d8d2',
    });
    pdf.text(
      M,
      pdf.height - 30,
      'Husky Eye View · Curated Flight report · For research use',
      { size: 8, color: '#8a8984' },
    );
    pdf.text(pdf.width - M, pdf.height - 30, `Page ${pdf.pages.length}`, {
      size: 8,
      color: '#8a8984',
      align: 'right',
    });
  };
  const cityList = plan.cities
    .map((c) => `${c.name}, ${c.stateAbbr}`)
    .join(' · ');

  // Cover.
  pdf.rect(0, 0, pdf.width, 8, { fill: '#C8102E' });
  pdf.text(M, 92, 'CURATED FLIGHT REPORT', {
    size: 10,
    bold: true,
    color: '#C8102E',
  });
  let y = pdf.paragraph(M, 126, cityList, W, {
    size: 24,
    bold: true,
    leading: 1.2,
  });
  y = pdf.paragraph(
    M,
    y + 6,
    `${plan.layers.map((k) => table.layers[k].label).join(' · ')}`,
    W,
    { size: 12, color: '#52514e' },
  );
  pdf.text(
    M,
    y + 14,
    `Prepared ${localDate(date)} with Husky Eye View (Northeastern University)`,
    { size: 10, color: '#52514e' },
  );
  y += 52;
  y = pdf.paragraph(
    M,
    y,
    'Each value compares the city with its principal county (the county where most of its residents live) and its state. ' +
      'Area measures are averages of census tracts weighted by tract population; counts are rates per residents. ' +
      'Data years differ by layer and are listed with each table.',
    W,
    { size: 10.5, color: '#333333' },
  );
  y += 16;
  // Summary table.
  const cols = [M, M + 210, M + 290, M + 370, M + 450];
  const header = (yy) => {
    pdf.rect(M, yy - 13, W, 20, { fill: '#f1f0ec' });
    ['Layer · city', 'City', 'County', 'State', 'Data years'].forEach(
      (label, i) =>
        pdf.text(cols[i] + 4, yy, label, {
          size: 9,
          bold: true,
          color: '#333333',
        }),
    );
    return yy + 20;
  };
  y = header(y);
  for (const key of plan.layers) {
    const layer = table.layers[key];
    if (y > pdf.height - 120) {
      footer();
      pdf.addPage();
      y = header(70);
    }
    pdf.text(cols[0] + 4, y, `${layer.label} (${layer.unit})`, {
      size: 9.5,
      bold: true,
    });
    pdf.text(cols[4] + 4, y, layer.vintage, { size: 9, color: '#52514e' });
    y += 15;
    for (const city of plan.cities) {
      const v = layerValues(city, key, research);
      const short = { ...layer, unit: '' };
      pdf.text(cols[0] + 14, y, `${city.name}, ${city.stateAbbr}`, { size: 9 });
      pdf.text(cols[1] + 4, y, formatValue(short, v.city), { size: 9 });
      pdf.text(cols[2] + 4, y, formatValue(short, v.county), { size: 9 });
      pdf.text(cols[3] + 4, y, formatValue(short, v.state), { size: 9 });
      y += 14;
    }
    pdf.line(M, y - 6, pdf.width - M, y - 6, { color: '#e6e5e0' });
    y += 6;
  }
  footer();

  // One page per layer: chart + sentences.
  const charts = await renderCharts(plan, table, research, 'jpg', doc, date);
  for (const chart of charts) {
    const layer = table.layers[chart.key];
    pdf.addPage();
    pdf.text(M, 70, layer.label, { size: 18, bold: true });
    pdf.text(M, 88, `${layer.unit} · data ${layer.vintage}`, {
      size: 10,
      color: '#52514e',
    });
    const chartH = (W * CHART_HEIGHT) / CHART_WIDTH;
    pdf.jpeg(chart.bytes, CHART_WIDTH, CHART_HEIGHT, M, 104, W, chartH);
    let yy = 104 + chartH + 26;
    for (const city of plan.cities) {
      yy = pdf.paragraph(
        M,
        yy,
        compareSentence(layer, city, layerValues(city, chart.key, research)),
        W,
        { size: 11 },
      );
      yy += 4;
    }
    yy += 10;
    pdf.paragraph(M, yy, `Definition: ${layer.note}`, W, {
      size: 9.5,
      color: '#52514e',
    });
    footer();
  }

  // One page per city: snapshot from the flight + facts.
  for (const city of plan.cities) {
    pdf.addPage();
    pdf.text(M, 70, `${city.name}, ${city.state}`, { size: 20, bold: true });
    pdf.text(
      M,
      90,
      `Population ${city.population.toLocaleString('en-US')} (2024 estimate) · principal county: ${city.county?.name || '—'}`,
      { size: 10, color: '#52514e' },
    );
    let yy = 108;
    const shot = snapshots[city.id];
    if (shot?.bytes) {
      const h = (W * shot.height) / shot.width;
      pdf.jpeg(shot.bytes, shot.width, shot.height, M, yy, W, Math.min(h, 330));
      yy += Math.min(h, 330) + 24;
    }
    for (const key of plan.layers) {
      const layer = table.layers[key];
      const lines = pdfWrap(
        compareSentence(layer, city, layerValues(city, key, research)),
        11,
        W - 12,
      );
      if (yy + lines.length * 15 > pdf.height - 70) break;
      pdf.text(M, yy, layer.label, { size: 10, bold: true, color: '#C8102E' });
      yy = pdf.paragraph(M, yy + 15, lines.join(' '), W, { size: 11 });
      yy += 8;
    }
    footer();
  }

  // Methods.
  pdf.addPage();
  pdf.text(M, 70, 'Methods', { size: 18, bold: true });
  let yy = pdf.paragraph(M, 100, table.method, W, { size: 10.5 });
  yy += 18;

  // Data sources, one row per layer in this report, with its Census table.
  pdf.text(M, yy, 'Data sources', { size: 18, bold: true });
  yy += 24;
  const sourceCols = [M, M + 150, M + 270];
  const sourceHeader = (y0) => {
    pdf.rect(M, y0 - 13, W, 20, { fill: '#f1f0ec' });
    ['Layer', 'Census table / dataset', 'Source and data years'].forEach(
      (label, i) =>
        pdf.text(sourceCols[i] + 4, y0, label, {
          size: 9,
          bold: true,
          color: '#333333',
        }),
    );
    return y0 + 20;
  };
  yy = sourceHeader(yy);
  for (const key of plan.layers) {
    const layer = table.layers[key];
    const detail = `${layer.source || ''} Data years: ${layer.vintage}.`;
    const lines = pdfWrap(detail, 9, W - 274);
    const tableLines = pdfWrap(layer.table || '—', 9, 112);
    const rowHeight = Math.max(lines.length, tableLines.length) * 12 + 8;
    if (yy + rowHeight > pdf.height - 70) {
      footer();
      pdf.addPage();
      yy = sourceHeader(70);
    }
    pdf.text(sourceCols[0] + 4, yy, layer.label, { size: 9, bold: true });
    tableLines.forEach((line, i) =>
      pdf.text(sourceCols[1] + 4, yy + i * 12, line, { size: 9 }),
    );
    lines.forEach((line, i) =>
      pdf.text(sourceCols[2] + 4, yy + i * 12, line, {
        size: 9,
        color: '#333333',
      }),
    );
    yy += rowHeight;
    pdf.line(M, yy - 8, pdf.width - M, yy - 8, { color: '#e6e5e0' });
  }
  yy += 10;
  if (yy > pdf.height - 160) {
    footer();
    pdf.addPage();
    yy = 70;
  }
  pdf.text(M, yy, 'All sources used by Curated Flights', {
    size: 11,
    bold: true,
  });
  yy += 16;
  for (const source of table.sources)
    yy = pdf.paragraph(M, yy, `• ${source}`, W, { size: 9.5 }) + 1;
  yy += 10;
  pdf.paragraph(
    M,
    yy,
    'Research layers (GVA 2015, MKDB) are counted from the locked research datasets in this browser session; they are not stored in this report’s source files. ' +
      'Cite: Husky Eye View (Northeastern University), Curated Flights report, generated ' +
      `${localDate(date)}.`,
    W,
    { size: 9.5, color: '#52514e' },
  );
  footer();
  return pdf.build();
}
