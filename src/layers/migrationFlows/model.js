/**
 * Pure model for the Migration & Refugee Flows layer: the four views, their
 * caveats and size classes, and the bundled table to arcs between the United
 * States and each other country. No Cesium, DOM or network imports.
 *
 * Every record is a country total from a published table, never a person.
 * The table is built by scripts/build-migration-flows.mjs. Arc joining and
 * capping are adapted from uxhimanshuk/ground-view (MIT),
 * src/layers/arcs/model.js, narrowed to flows to or from the US.
 */

export const MIGRATION_FLOWS_LAYER_ID = 'local-migration-flows';
export const US_ISO3 = 'USA';

/** How many of the largest flows are drawn; null draws every country. */
export const ARC_CAPS = Object.freeze([25, 50, null]);
export const DEFAULT_ARC_CAP = 25;

/**
 * The selectable views, in chip order. `bins` are size classes (lower bound,
 * largest first) that colour the arcs and the legend.
 */
export const VIEWS = Object.freeze([
  Object.freeze({
    id: 'stock',
    chip: 'Immigrants',
    valueLabel: 'Immigrants living in the US',
    shortSource: 'UN DESA International Migrant Stock 2024',
    caveat:
      'People living in the US who were born in another country (a stock, not yearly arrivals). UN DESA lists only the larger countries of birth; the rest sit in regional "other" totals and are not drawn.',
    bins: Object.freeze([
      { min: 1_000_000, color: '#f03b20' },
      { min: 500_000, color: '#fd8d3c' },
      { min: 200_000, color: '#fecc5c' },
      { min: 0, color: '#c7e9b4' },
    ]),
  }),
  Object.freeze({
    id: 'refugees',
    chip: 'Refugees & asylum',
    valueLabel: 'Refugees and asylum-seekers in the US',
    shortSource: 'UNHCR Refugee Population Statistics',
    caveat:
      'People under UNHCR mandate whose country of asylum is the US: recognised refugees plus asylum-seekers with pending claims. Not all immigrants. Many asylum-seekers have no recorded country of origin; they count in the US total but are not drawn.',
    bins: Object.freeze([
      { min: 100_000, color: '#ce1256' },
      { min: 25_000, color: '#e7298a' },
      { min: 5_000, color: '#df65b0' },
      { min: 0, color: '#d4b9da' },
    ]),
  }),
  Object.freeze({
    id: 'resettlement',
    chip: 'Resettled',
    valueLabel: 'Refugees resettled to the US',
    shortSource: 'UNHCR Refugee Population Statistics (solutions)',
    caveat:
      'Refugees resettled to the US during the year, as reported to UNHCR: a yearly flow, not a stock. Other humanitarian entries, such as parole, are not included.',
    bins: Object.freeze([
      { min: 1_000, color: '#08519c' },
      { min: 250, color: '#3182bd' },
      { min: 50, color: '#6baed6' },
      { min: 0, color: '#bdd7e7' },
    ]),
  }),
  Object.freeze({
    id: 'remittances',
    chip: 'Remittances',
    valueLabel: 'Remittances sent from the US',
    shortSource: 'KNOMAD / World Bank Bilateral Remittance Matrix',
    caveat:
      'Modelled estimates, not measured transfers: the World Bank splits each country’s remittance receipts across sending countries using migrant numbers and incomes. 2021 is the latest matrix. Informal transfers are not captured.',
    bins: Object.freeze([
      { min: 5_000, color: '#006d2c' },
      { min: 2_000, color: '#31a354' },
      { min: 500, color: '#74c476' },
      { min: 0, color: '#c7e9c0' },
    ]),
  }),
]);

export const DEFAULT_VIEW_ID = 'stock';
const VIEW_BY_ID = new Map(VIEWS.map((view) => [view.id, view]));

/** View definition by id, or undefined. */
export function viewDefinition(id) {
  return VIEW_BY_ID.get(id);
}

/** Per-country notes a reader needs next to the number. */
const COUNTRY_NOTES = Object.freeze({
  PRI: 'Puerto Rico is a US territory and people born there are US citizens; UN DESA lists it as a separate area of origin.',
});

/** Compact human number: 1.23M, 340k, 5,200. */
export function formatCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'n/a';
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e3)}k`;
  return Math.round(v).toLocaleString('en-US');
}

/** USD millions as $52.6B, $850M or $0.4M. */
export function formatUsdMillions(millions) {
  const v = Number(millions);
  if (!Number.isFinite(v)) return 'n/a';
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}B`;
  if (v >= 1) return `$${Math.round(v)}M`;
  return `$${v.toFixed(1)}M`;
}

/** Value text in a view's unit. */
export function formatValue(view, value) {
  return view?.unit === 'USD millions'
    ? formatUsdMillions(value)
    : `${formatCount(value)} people`;
}

/** Round legend numbers: 1M, 500k, 5k, 250; $5B, $500M. */
export function formatBound(unit, value) {
  const trim = (n) => String(Number(n.toFixed(1)));
  if (unit === 'USD millions')
    return value >= 1000 ? `$${trim(value / 1000)}B` : `$${trim(value)}M`;
  if (value >= 1e6) return `${trim(value / 1e6)}M`;
  if (value >= 1e3) return `${trim(value / 1e3)}k`;
  return trim(value);
}

/** A bin's legend text in the view's unit: "1M+", "500k–1M", "under 200k". */
function binLabel(view, bins, index) {
  const fmt = (v) => formatBound(view.unit, v);
  const { min } = bins[index];
  if (index === 0) return `${fmt(min)}+`;
  const upper = bins[index - 1].min;
  return min > 0 ? `${fmt(min)}–${fmt(upper)}` : `under ${fmt(upper)}`;
}

/** Index of the size class a value falls in. */
export function binIndex(bins, value) {
  const v = Number(value) || 0;
  const index = bins.findIndex((bin) => v >= bin.min);
  return index < 0 ? bins.length - 1 : index;
}

/**
 * Validate the bundled table. Returns null when it is not the expected shape.
 * @param {unknown} json
 */
export function validateBundle(json) {
  if (!json || typeof json !== 'object') return null;
  const { countries, views } = json;
  if (!countries || typeof countries !== 'object') return null;
  if (!views || typeof views !== 'object') return null;
  const us = countries[US_ISO3];
  if (!Array.isArray(us) || us.length !== 3) return null;
  for (const definition of VIEWS) {
    const view = views[definition.id];
    if (!view || typeof view.flows !== 'object' || !view.flows) return null;
    if (!Number.isInteger(view.year)) return null;
    if (view.direction !== 'to-us' && view.direction !== 'from-us') return null;
  }
  return json;
}

/**
 * One view of the bundle as arcs, largest first. Countries without an anchor
 * point, non-positive values and the US itself are skipped.
 * @param {object} bundle Validated table.
 * @param {string} viewId
 */
export function buildViewArcs(bundle, viewId) {
  const definition = viewDefinition(viewId);
  const view = bundle?.views?.[viewId];
  if (!definition || !view) return null;
  const us = bundle.countries[US_ISO3];
  const usPoint = { lon: us[2], lat: us[1] };
  const arcs = [];
  let listed = 0;
  let skipped = 0;
  for (const [iso3, raw] of Object.entries(view.flows)) {
    const value = Number(raw);
    const country = bundle.countries[iso3];
    if (iso3 === US_ISO3 || !(value > 0) || !Array.isArray(country)) {
      skipped += 1;
      continue;
    }
    listed += value;
    const point = { lon: country[2], lat: country[1] };
    const outward = view.direction === 'from-us';
    arcs.push({
      id: `${viewId}:${iso3}`,
      iso3,
      name: country[0],
      value,
      from: outward ? usPoint : point,
      to: outward ? point : usPoint,
      split: Array.isArray(view.split?.[iso3]) ? view.split[iso3] : null,
    });
  }
  arcs.sort((a, b) => b.value - a.value || a.iso3.localeCompare(b.iso3));
  const total = Number(view.total) > 0 ? Number(view.total) : listed;
  arcs.forEach((arc, index) => {
    arc.rank = index + 1;
    arc.share = total > 0 ? arc.value / total : null;
    arc.bin = binIndex(definition.bins, arc.value);
  });
  return {
    definition,
    view,
    arcs,
    total,
    listed,
    skipped,
    usPoint,
    usName: us[0],
  };
}

/** The largest `cap` arcs (all of them for a null cap). */
export function selectTopArcs(arcs, cap) {
  const list = Array.isArray(arcs) ? arcs : [];
  if (cap == null) return list.slice();
  return list.slice(0, Math.max(0, Math.floor(Number(cap) || 0)));
}

/** Legend rows for a view: size classes with how many drawn arcs each has. */
export function viewLegend(model, shown) {
  if (!model) return [];
  const { definition, view } = model;
  return definition.bins.map((bin, index) => ({
    label: binLabel(view, definition.bins, index),
    color: bin.color,
    count: shown.filter((arc) => arc.bin === index).length,
  }));
}

/** Percent text with one decimal under 10%, else whole. */
function percent(share) {
  if (!(share >= 0)) return null;
  const pct = share * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/** The year line every card and row carries. */
export function vintageText(view) {
  return view?.asOf ? `${view.asOf}` : String(view?.year ?? 'year unknown');
}

/**
 * Title and detail lines for one country's card in a view.
 * @param {ReturnType<buildViewArcs>} model
 * @param {string} iso3
 */
export function countryCard(model, iso3) {
  if (!model) return null;
  const { definition, view } = model;
  const code = String(iso3 || '').toUpperCase();
  if (code === US_ISO3) return usCard(model);
  const arc = model.arcs.find((entry) => entry.iso3 === code);
  if (!arc) return null;
  const lines = [`${definition.valueLabel}: ${formatValue(view, arc.value)}`];
  const share = percent(arc.share);
  lines.push(
    `Rank ${arc.rank} of ${model.arcs.length}${share ? ` · ${share} of the US total` : ''}`,
  );
  if (arc.split)
    lines.push(
      `Refugees ${formatCount(arc.split[0])} · asylum-seekers ${formatCount(arc.split[1])}`,
    );
  if (COUNTRY_NOTES[code]) lines.push(COUNTRY_NOTES[code]);
  lines.push(`Year: ${vintageText(view)}`);
  lines.push(`Source: ${definition.shortSource}`);
  const title =
    view.direction === 'from-us'
      ? `United States to ${arc.name}`
      : `${arc.name} to United States`;
  return { title, lines };
}

/** The US node's card: the view's national total and what is drawn. */
export function usCard(model, shownCount = null) {
  const { definition, view } = model;
  const lines = [
    `${definition.valueLabel}, all countries: ${formatValue(view, model.total)}`,
  ];
  const drawn = shownCount == null ? model.arcs.length : shownCount;
  lines.push(`Drawn: largest ${drawn} of ${model.arcs.length} countries`);
  const notDrawn = [];
  if (Number(view.unknownOrigin) > 0)
    notDrawn.push(
      `unknown or stateless origin ${formatValue(view, view.unknownOrigin)}`,
    );
  const unlisted =
    model.total - model.listed - (Number(view.unknownOrigin) || 0);
  if (unlisted > 0 && unlisted / model.total >= 0.001)
    notDrawn.push(
      `not listed by country ${formatValue(view, Math.round(unlisted * 10) / 10)}`,
    );
  if (notDrawn.length) lines.push(`Not drawn: ${notDrawn.join('; ')}`);
  lines.push(`Year: ${vintageText(view)}`);
  lines.push(`Source: ${definition.shortSource}`);
  return { title: 'United States', lines };
}

/** Rows for voice and analysis: every country in the view, largest first. */
export function analystRows(model, maxCount = 2000) {
  if (!model) return [];
  const limit = Number.isFinite(maxCount)
    ? Math.max(0, Math.floor(maxCount))
    : 2000;
  return model.arcs.slice(0, limit).map((arc) => ({
    id: arc.id,
    kind: 'flow',
    name: model.view.direction === 'from-us' ? `US to ${arc.name}` : arc.name,
    country: arc.name,
    iso3: arc.iso3,
    measure: model.definition.valueLabel,
    value: arc.value,
    unit: model.view.unit,
    rank: arc.rank,
    shareOfUsTotal: arc.share,
    year: model.view.year,
    source: model.view.source || model.definition.shortSource,
    lat: (model.view.direction === 'from-us' ? arc.to : arc.from).lat,
    lon: (model.view.direction === 'from-us' ? arc.to : arc.from).lon,
  }));
}

const CARD_LINE_CHARS = 46;

/**
 * Word-wrap one sentence into short card lines.
 * From uxhimanshuk/ground-view (MIT), src/layers/arcs/index.js.
 */
export function wrapCardLines(text, width = CARD_LINE_CHARS) {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '')
    .split(/\s+/)
    .filter(Boolean)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Nearest anchor to a lon/lat among `points` ({iso3, lon, lat}) within
 * `maxKm`, else null. Equirectangular distance is plenty at this scale.
 */
export function nearestPoint(points, lon, lat, maxKm = 450) {
  const rad = Math.PI / 180;
  let best = null;
  let bestKm = maxKm;
  for (const p of points) {
    const x = (p.lon - lon) * Math.cos(((p.lat + lat) / 2) * rad);
    const y = p.lat - lat;
    const km = Math.hypot(x, y) * 111.2;
    if (km < bestKm) {
      bestKm = km;
      best = p.iso3;
    }
  }
  return best;
}
