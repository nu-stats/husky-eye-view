/**
 * Read an Excel workbook (.xlsx) into rows, without libraries: the ZIP
 * container (readZip), the workbook's sheet list, shared strings and one
 * worksheet's cells. Values come back as Excel stores them: numbers as
 * numbers (dates stay serial numbers), text as text, TRUE/FALSE as 1/0, and
 * errors (#N/A…) as empty. Works in the browser and in Node 18+.
 */
import { readZip } from './userData.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML text with its entities decoded. */
function xmlText(text) {
  return String(text).replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_, code) =>
      code[0] === '#'
        ? String.fromCodePoint(
            code[1].toLowerCase() === 'x'
              ? parseInt(code.slice(2), 16)
              : Number(code.slice(1)),
          )
        : ENTITIES[code.toLowerCase()],
  );
}

/** All text runs (<t>…</t>) inside an element, joined. */
const runsOf = (xml) =>
  [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((m) => xmlText(m[1]))
    .join('');

const attr = (tag, name) =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

/** "BC12" → 54 (0-based column index). */
export function columnIndex(ref) {
  const letters =
    String(ref)
      .match(/^[A-Z]+/i)?.[0]
      .toUpperCase() || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The workbook's sheets: [{name, rows}] where rows are arrays of cell values
 * (null for empty), in sheet order. `only` reads just the first sheet that
 * has data.
 */
export async function readXlsx(bytes, { only = false } = {}) {
  const entries = new Map(
    readZip(bytes).map((entry) => [entry.name.replace(/^\/+/, ''), entry]),
  );
  const text = async (name) => {
    const entry = entries.get(name);
    return entry ? new TextDecoder().decode(await entry.read()) : null;
  };
  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new Error('This file is not an Excel workbook (.xlsx).');
  const rels = (await text('xl/_rels/workbook.xml.rels')) || '';
  const targets = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      attr(m[0], 'Id'),
      attr(m[0], 'Target'),
    ]),
  );
  const shared = [];
  const strings = await text('xl/sharedStrings.xml');
  if (strings)
    for (const m of strings.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g))
      shared.push(m[1] ? runsOf(m[1]) : '');
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = xmlText(attr(m[0], 'name') || `Sheet${sheets.length + 1}`);
    const target = targets.get(attr(m[0], 'r:id'));
    if (!target) continue;
    const file = target.startsWith('/')
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, '')}`;
    const xml = await text(file);
    if (!xml) continue;
    const rows = [];
    // Empty rows (<row r="5"/>) first, or one would swallow the next row.
    for (const row of xml.matchAll(
      /<row\b([^>]*?)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g,
    )) {
      const r = Number(attr(row[1] ?? row[2] ?? '', 'r')) || rows.length + 1;
      const cells = [];
      for (const cell of (row[3] || '').matchAll(
        /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const tag = cell[1];
        const body = cell[2] || '';
        const type = attr(tag, 't') || 'n';
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = null;
        if (type === 's')
          value = raw === undefined ? null : shared[Number(raw)];
        else if (type === 'inlineStr') value = runsOf(body);
        else if (type === 'str')
          value = raw === undefined ? null : xmlText(raw);
        else if (type === 'b') value = raw === undefined ? null : Number(raw);
        else if (type === 'e') value = null;
        else if (raw !== undefined && raw !== '') {
          const number = Number(raw);
          value = Number.isFinite(number) ? number : xmlText(raw);
        }
        const ref = attr(tag, 'r');
        const c = ref ? columnIndex(ref) : cells.length;
        cells[c] = value === '' ? null : value;
      }
      rows[r - 1] = Array.from(cells, (v) => (v === undefined ? null : v));
    }
    const filled = Array.from(rows, (row) => row || []);
    sheets.push({ name, rows: filled });
    if (only && filled.some((row) => row.some((v) => v !== null))) break;
  }
  if (!sheets.length) throw new Error('This workbook has no worksheets.');
  return sheets;
}

/**
 * The first sheet with data as a table: the first non-empty row is the
 * header; `{sheet, columns, rows}` with rows as objects keyed by column.
 */
export async function readXlsxTable(bytes) {
  const sheets = await readXlsx(bytes, { only: true });
  const sheet =
    sheets.find((s) => s.rows.some((row) => row.some((v) => v !== null))) ||
    sheets[0];
  const start = sheet.rows.findIndex((row) => row.some((v) => v !== null));
  if (start < 0) throw new Error('The workbook is empty.');
  const header = sheet.rows[start];
  const width = Math.max(...sheet.rows.map((row) => row.length));
  const seen = new Map();
  const columns = Array.from({ length: width }, (_, i) => {
    const base = String(header[i] ?? '').trim() || `column_${i + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}_${n}` : base;
  });
  const rows = sheet.rows
    .slice(start + 1)
    .filter((row) => row.some((v) => v !== null && v !== ''))
    .map((row) =>
      Object.fromEntries(columns.map((column, i) => [column, row[i] ?? ''])),
    );
  return { sheet: sheet.name, columns, rows };
}
