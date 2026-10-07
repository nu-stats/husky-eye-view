/**
 * Any area layer's own data as a dataset: every field in the files the layer
 * draws from (public/context/<folder>/), for one state, the map view or
 * everywhere, plus each area's centroid. Names follow the Area Reports
 * measures where a field is one of them (fb24 → foreign_born_share), so the
 * same variable has the same name in every session; other fields keep their
 * own (sanitized) names. Presentation text (summary, source_note) is left
 * out.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORT_MEASURES } from '../../src/reports/reportMeasures.js';
import { STATES } from '../../src/reports/areaReport.js';
import { variableName } from '../../src/analysis/stataCommands.js';
import { geometryCentroid } from './stataSession.js';

const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
);

/** Fields that are card text, not data. */
const SKIPPED = new Set(['summary', 'source_note']);
/** Above this many chunk files, a layer needs a state or the map view. */
export const MAX_CHUNKS_WITHOUT_LIMIT = 120;

const EXTRA_LABELS = {
  name: 'Area name',
  geoid: 'Census GEOID',
  fbt00: 'Largest countries of birth, 2000 (country index:percent list)',
  fbt10: 'Largest countries of birth, 2006–10 (country index:percent list)',
  fbt24: 'Largest countries of birth, 2020–24 (country index:percent list)',
  abbr: 'State postal code',
  holc_grade: 'HOLC grade (A best to D "hazardous")',
  holc_id: 'HOLC area id',
  city: 'City',
};

/** Measure name and label for each property key (first measure wins). */
const MEASURE_BY_KEY = new Map();
for (const m of REPORT_MEASURES)
  if (!MEASURE_BY_KEY.has(m.key)) MEASURE_BY_KEY.set(m.key, m);

/** A layer folder, only inside public/context. */
export function layerFolder(baseUrl, publicDir = PUBLIC_DIR) {
  const match = String(baseUrl || '').match(
    /^context\/([a-z0-9][a-z0-9-]*)\/?$/,
  );
  if (!match) return null;
  const folder = path.join(publicDir, 'context', match[1]);
  return existsSync(path.join(folder, 'index.json')) ? folder : null;
}

/** Whether a chunk id belongs to a state (FIPS or postal code prefixes). */
function chunkInState(id, fips, abbr) {
  const text = String(id);
  if (/^\d/.test(text)) return text.startsWith(fips);
  return (
    text === abbr || text.startsWith(`${abbr}-`) || text.startsWith(`${abbr}_`)
  );
}

const boxesOverlap = (a, [w, s, e, n]) =>
  !(e < a.west || w > a.east || n < a.south || s > a.north);
const inBox = (lon, lat, box) =>
  lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north;

/**
 * Read a layer's areas. Returns {areas, problems, stateApplied}; areas carry
 * their properties, centroid and (on request) geometry.
 */
export function readLayerAreas({
  baseUrl,
  publicDir,
  state = null,
  view = null,
  withGeometry = false,
}) {
  const folder = layerFolder(baseUrl, publicDir);
  if (!folder)
    return { areas: [], problems: [`No layer data at “${baseUrl}”.`] };
  const index = JSON.parse(
    readFileSync(path.join(folder, 'index.json'), 'utf8'),
  );
  const abbr = state ? STATES[state]?.[0] : null;
  const byState = state
    ? index.filter((entry) => chunkInState(entry.id, state, abbr))
    : index;
  // A layer whose files are not named by state (cities) is used whole.
  const stateApplied = Boolean(state && byState.length);
  let chunks = stateApplied ? byState : index;
  if (view)
    chunks = chunks.filter(
      (entry) => !entry.bbox || boxesOverlap(view, entry.bbox),
    );
  if (!stateApplied && !view && chunks.length > MAX_CHUNKS_WITHOUT_LIMIT)
    return {
      areas: [],
      problems: [
        'This layer is too large to use everywhere at once: choose a state or the map view.',
      ],
    };
  const areas = [];
  for (const entry of chunks) {
    const text = readFileSync(
      path.join(folder, `${entry.id}.geojsonl`),
      'utf8',
    );
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const feature = JSON.parse(line);
      const p = feature.properties || {};
      if (stateApplied && p.geoid && !String(p.geoid).startsWith(state))
        continue;
      const [lon, lat] = geometryCentroid(feature.geometry);
      if (view && !(Number.isFinite(lon) && inBox(lon, lat, view))) continue;
      areas.push({
        properties: p,
        lon,
        lat,
        ...(withGeometry && { geometry: feature.geometry }),
      });
    }
  }
  return { areas, problems: [], stateApplied };
}

/**
 * The variables for a layer's areas: every field (in first-seen order) plus
 * lon/lat, each with a Stata/R-safe unique name, a label and a kind.
 */
export function layerVariables(areas) {
  const keys = [];
  const seen = new Set();
  const numeric = new Map();
  for (const { properties } of areas) {
    for (const [key, value] of Object.entries(properties)) {
      if (SKIPPED.has(key)) continue;
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
        numeric.set(key, true);
      }
      if (value !== null && value !== undefined && typeof value !== 'number')
        numeric.set(key, false);
    }
  }
  const used = new Set(['lon', 'lat', 'hev_id', 'd', 'W', 'nb', 'areas']);
  const unique = (raw) => {
    let base =
      String(raw)
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/^(\d)/, 'v$1')
        .slice(0, 28) || 'v';
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${base}_${n}`;
    used.add(name);
    return name;
  };
  const variables = keys.map((key) => {
    const measure = MEASURE_BY_KEY.get(key);
    const name = unique(measure ? variableName(measure.id) : key);
    const label = measure
      ? `${measure.label}, ${measure.years}`
      : EXTRA_LABELS[key] || key;
    return {
      name,
      key,
      label: label.replace(/["`$\\]/g, "'").slice(0, 80),
      kind: numeric.get(key) ? 'numeric' : 'string',
      source: measure?.source,
      ...(measure && {
        short: measure.short.replace(/["`$\\]/g, "'"),
        tableLabel: (measure.tableLabel || measure.label)
          .replace(/["`$\\]/g, "'")
          .slice(0, 80),
      }),
    };
  });
  variables.push(
    {
      name: 'lon',
      label: 'Longitude of the area centroid',
      kind: 'numeric',
      centroid: 'lon',
    },
    {
      name: 'lat',
      label: 'Latitude of the area centroid',
      kind: 'numeric',
      centroid: 'lat',
    },
  );
  return variables;
}

/** Rows in `variables` order. */
export function layerRows(variables, areas) {
  return areas.map((area) =>
    variables.map((v) => {
      if (v.centroid)
        return Number.isFinite(area[v.centroid])
          ? Math.round(area[v.centroid] * 1e5) / 1e5
          : null;
      const value = area.properties[v.key];
      return value === undefined ? null : value;
    }),
  );
}

/** The variables of a layer, from a few of its files (for the panel's list). */
export function sampleLayerVariables({ baseUrl, publicDir = PUBLIC_DIR }) {
  const folder = layerFolder(baseUrl, publicDir);
  if (!folder) return [];
  const index = JSON.parse(
    readFileSync(path.join(folder, 'index.json'), 'utf8'),
  );
  const areas = [];
  for (const entry of index.slice(0, 3)) {
    const text = readFileSync(
      path.join(folder, `${entry.id}.geojsonl`),
      'utf8',
    );
    for (const line of text.split(/\r?\n/).slice(0, 400)) {
      if (!line.trim()) continue;
      areas.push({ properties: JSON.parse(line).properties || {} });
    }
  }
  return layerVariables(areas);
}
