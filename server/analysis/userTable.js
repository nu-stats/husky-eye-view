/**
 * Your own file in the analysis boxes: an Excel workbook (.xlsx) or a CSV,
 * uploaded once and kept with the sessions (Documents/HuskyEyeView-Analyses/
 * uploads/<id>/table.json), so Stata, R, SPSS and Excel Analysis can all use
 * it. A file with census GEOIDs (states, counties or tracts; Excel's lost
 * leading zeros and separate STATE/COUNTY/TRACT code columns work) is joined
 * to the app's own outlines, so the areas in the map view or one state can
 * be chosen, results go back to the map, and brushing and Moran's I work. A
 * file without them is analyzed as it is.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STATES } from '../../src/reports/areaReport.js';
import {
  detectColumns,
  normalizeGeoid,
  parseCsv,
  toNumber,
} from '../../src/curated/userData.js';
import { readXlsxTable } from '../../src/curated/xlsxRead.js';
import { analysisRoot, newSessionFolder, readAreas } from './stataSession.js';

export const MAX_UPLOAD_TABLE_BYTES = 30 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 200_000;
const CENSUS = { 2: 'state', 5: 'county', 11: 'tract' };

/** Column names as variable names Stata, R and SPSS all accept. */
function variableNames(columns) {
  const seen = new Set();
  return columns.map((column) => {
    let base =
      String(column)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/^(\d)/, 'v$1')
        .slice(0, 28) || 'v';
    if (
      /^(all|and|by|eq|ge|gt|le|lt|ne|not|or|to|with|_n|_N|in|if)$/i.test(base)
    )
      base = `${base}_v`;
    let name = base;
    for (let k = 2; seen.has(name); k += 1) name = `${base}_${k}`;
    seen.add(name);
    return name;
  });
}

/** Which column (or columns) hold census GEOIDs, and at what level. */
function findGeoids(columns, rows) {
  const found = detectColumns(columns);
  const level = (ids) => {
    const counts = {};
    let valid = 0;
    for (const id of ids) {
      if (!id) continue;
      valid += 1;
      counts[id.length] = (counts[id.length] || 0) + 1;
    }
    const [length] =
      Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
    return valid >= Math.max(1, rows.length * 0.5)
      ? CENSUS[length] || null
      : null;
  };
  const tryColumn = (column) => {
    const ids = rows.map((row) => normalizeGeoid(row[column])?.geoid || null);
    const lvl = level(ids);
    return lvl
      ? { ids, level: lvl, join: `the ${column} column`, column }
      : null;
  };
  if (found.geoid) {
    const hit = tryColumn(found.geoid);
    if (hit) return hit;
  }
  if (found.statePart && found.countyPart) {
    const digits = (value, width) => {
      const text = String(value ?? '')
        .trim()
        .replace(/\.0+$/, '');
      return /^\d+$/.test(text) && text.length <= width
        ? text.padStart(width, '0')
        : null;
    };
    const ids = rows.map((row) => {
      const s = digits(row[found.statePart], 2);
      const c = digits(row[found.countyPart], 3);
      if (!s || !c) return null;
      if (!found.tractPart) return `${s}${c}`;
      const t = digits(row[found.tractPart], 6);
      return t ? `${s}${c}${t}` : null;
    });
    const lvl = level(ids);
    if (lvl)
      return {
        ids,
        level: lvl,
        join: [found.statePart, found.countyPart, found.tractPart]
          .filter(Boolean)
          .join(' + '),
        column: null,
      };
  }
  // Any column named like an ID whose values are census GEOIDs ("tract"
  // holding 11-digit IDs, "County FIPS" holding 5-digit ones).
  for (const column of columns) {
    if (!/id|fips|geo|code|tract|county/i.test(column)) continue;
    const hit = tryColumn(column);
    if (hit) return hit;
  }
  return null;
}

/** Read an uploaded file into a table: {columns, rows: [object]}. */
export async function readUploadTable(name, bytes) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm'))
    return readXlsxTable(bytes);
  if (lower.endsWith('.xls'))
    throw new Error(
      'Save the workbook as .xlsx (Excel Workbook) or CSV, then upload it again.',
    );
  if (/\.(csv|tsv|txt)$/.test(lower))
    return parseCsv(new TextDecoder().decode(bytes));
  throw new Error('Upload an Excel workbook (.xlsx) or a CSV file.');
}

const uploadsRoot = (env) => path.join(analysisRoot(env), 'uploads');

/**
 * Store an uploaded file for the analysis boxes. Returns {ok, problems, id,
 * name, rows, geography, join, variables, notes}.
 */
export async function storeUpload(
  { name, bytes },
  { env = process.env, now } = {},
) {
  const fileName = path.basename(String(name || 'data')).slice(0, 120);
  if (!bytes?.length) return { ok: false, problems: ['The file is empty.'] };
  if (bytes.length > MAX_UPLOAD_TABLE_BYTES)
    return {
      ok: false,
      problems: [
        `The file is ${(bytes.length / 1048576).toFixed(0)} MB; the limit is ${MAX_UPLOAD_TABLE_BYTES / 1048576} MB.`,
      ],
    };
  let table;
  try {
    table = await readUploadTable(fileName, bytes);
  } catch (error) {
    return { ok: false, problems: [error.message] };
  }
  if (!table.rows.length)
    return { ok: false, problems: ['The file has no rows of data.'] };
  if (table.rows.length > MAX_UPLOAD_ROWS)
    return {
      ok: false,
      problems: [
        `The file has ${table.rows.length.toLocaleString('en-US')} rows; the limit is ${MAX_UPLOAD_ROWS.toLocaleString('en-US')}.`,
      ],
    };
  const names = variableNames(table.columns);
  const geo = findGeoids(table.columns, table.rows);
  const notes = [];
  // Numbers where at least half of the filled cells are numbers.
  const kinds = table.columns.map((column) => {
    let filled = 0;
    let numbers = 0;
    for (const row of table.rows.slice(0, 5000)) {
      const v = row[column];
      if (v === null || v === undefined || v === '') continue;
      filled += 1;
      if (toNumber(v) !== null) numbers += 1;
    }
    return filled && numbers / filled >= 0.5 ? 'numeric' : 'string';
  });
  const variables = table.columns.map((column, i) => ({
    name: names[i],
    label: String(column).slice(0, 80),
    kind: geo?.column === column ? 'string' : kinds[i],
  }));
  let rows = table.rows.map((row) =>
    table.columns.map((column, i) => {
      const v = row[column];
      if (v === null || v === undefined || v === '') return null;
      return variables[i].kind === 'numeric' ? toNumber(v) : String(v);
    }),
  );
  // The census key as `geoid` (11-digit tracts, 5-digit counties, 2-digit states).
  if (geo) {
    const at = variables.findIndex((v) => v.name === 'geoid');
    if (at >= 0) {
      variables[at] = {
        name: 'geoid',
        label: `Census GEOID (from ${geo.join})`,
        kind: 'string',
      };
      rows = rows.map((row, r) =>
        row.map((v, i) => (i === at ? geo.ids[r] : v)),
      );
    } else {
      variables.unshift({
        name: 'geoid',
        label: `Census GEOID (from ${geo.join})`,
        kind: 'string',
      });
      rows = rows.map((row, r) => [geo.ids[r], ...row]);
    }
    const missing = geo.ids.filter((id) => !id).length;
    if (missing)
      notes.push(
        `${missing.toLocaleString('en-US')} rows have no usable GEOID and are left out of map views.`,
      );
  } else {
    notes.push(
      'No census GEOID column: the whole file is analyzed, without the map.',
    );
  }
  const root = uploadsRoot(env);
  mkdirSync(root, { recursive: true });
  const slug =
    fileName
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'file';
  const { id, folder } = newSessionFolder(root, slug, now);
  writeFileSync(path.join(folder, fileName.replace(/[^\w.-]+/g, '_')), bytes);
  const stored = {
    id,
    name: fileName,
    sheet: table.sheet || null,
    geography: geo?.level || null,
    join: geo?.join || null,
    variables,
    rows,
    notes,
  };
  writeFileSync(
    path.join(folder, 'table.json'),
    JSON.stringify(stored),
    'utf8',
  );
  return {
    ok: true,
    problems: [],
    id,
    name: fileName,
    sheet: stored.sheet,
    rows: rows.length,
    geography: stored.geography,
    join: stored.join,
    variables: variables.map(({ name: n, label, kind }) => ({
      name: n,
      label,
      kind,
    })),
    notes,
  };
}

/** A stored upload by id, never outside the uploads folder. */
export function readStoredUpload(id, env = process.env) {
  if (!/^[\w.-]+$/.test(String(id || ''))) return null;
  const file = path.join(uploadsRoot(env), id, 'table.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/**
 * An upload's rows for a request: census files keep the rows whose areas are
 * in the state or the map view, with each area's centroid (lon, lat) and,
 * with `withGeometry`, its outline. Returns {ok, problems, name, variables,
 * rows, areas, census, notes, stateApplied}.
 */
export function uploadRows(
  { uploadId, state = null, view = null, withGeometry = false },
  { env = process.env, publicDir } = {},
) {
  const table = readStoredUpload(uploadId, env);
  if (!table)
    return {
      ok: false,
      problems: ['That uploaded file is no longer here; upload it again.'],
    };
  const notes = [...table.notes];
  if (!table.geography) {
    if (state || view)
      notes.push('The file has no census GEOIDs, so every row is used.');
    return {
      ok: true,
      problems: [],
      name: table.name,
      variables: table.variables,
      rows: table.rows,
      areas: null,
      census: false,
      notes,
      stateApplied: false,
    };
  }
  const geoidAt = table.variables.findIndex((v) => v.name === 'geoid');
  const geography = table.geography;
  const states = state
    ? [state]
    : geography === 'tract' && !view
      ? [
          ...new Set(
            table.rows.map((row) => String(row[geoidAt] || '').slice(0, 2)),
          ),
        ].filter((s) => STATES[s])
      : [null];
  if (geography === 'tract' && states.length > 12 && !view)
    return {
      ok: false,
      problems: [
        'This file has tracts in more than 12 states: choose one state or the map view.',
      ],
    };
  const byGeoid = new Map();
  for (const s of states)
    for (const area of readAreas({
      geography,
      state: s,
      view,
      publicDir,
      withGeometry,
    }))
      byGeoid.set(area.geoid, area);
  const rows = [];
  const areas = [];
  for (const row of table.rows) {
    const area = byGeoid.get(String(row[geoidAt] || ''));
    if (!area) continue;
    rows.push(row);
    areas.push(area);
  }
  const dropped = table.rows.length - rows.length;
  if (dropped)
    notes.push(
      `${dropped.toLocaleString('en-US')} of ${table.rows.length.toLocaleString('en-US')} rows are outside ${state ? STATES[state][1] : view ? 'the map view' : 'the app’s outlines'} and are left out.`,
    );
  let variables = table.variables;
  let out = rows;
  // Each area's centroid, as every other dataset has.
  for (const key of ['lon', 'lat'])
    if (!variables.some((v) => v.name === key)) {
      variables = [
        ...variables,
        {
          name: key,
          label:
            key === 'lon'
              ? 'Longitude of the area centroid'
              : 'Latitude of the area centroid',
          kind: 'numeric',
        },
      ];
      out = out.map((row, i) => [
        ...row,
        Number.isFinite(areas[i][key])
          ? Math.round(areas[i][key] * 1e5) / 1e5
          : null,
      ]);
    }
  return {
    ok: true,
    problems: [],
    name: table.name,
    variables,
    rows: out,
    areas,
    census: true,
    geography,
    notes,
    stateApplied: Boolean(state),
  };
}
