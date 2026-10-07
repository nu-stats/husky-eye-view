/**
 * Global Moran's I in one click, the way GeoDa shows it: queen (or rook)
 * contiguity among the areas with a value, row-standardized weights, the
 * statistic with its expected value, a z-score under randomization (as R's
 * spdep::moran.test reports it), a pseudo p-value from 999 random
 * permutations (as GeoDa reports it), and the Moran scatter plot's points.
 * Computed here in Node, so it needs neither Stata nor R.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findState } from '../../src/reports/areaReport.js';
import { analysisVariables } from '../../src/analysis/stataCommands.js';
import { layerRows, layerVariables, readLayerAreas } from './layerData.js';
import { datasetRows, readAreas } from './stataSession.js';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
export const MORAN_PERMUTATIONS = 999;
/** More areas than this take too long to permute in a request. */
export const MAX_MORAN_AREAS = 20000;
/** Points sent for the scatter plot (a sample beyond this). */
const MAX_PLOT_POINTS = 4000;

const ringsOf = (geometry) =>
  geometry?.type === 'Polygon'
    ? geometry.coordinates
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates.flat()
      : [];

/**
 * Contiguity neighbors: areas that share a vertex (queen) or an edge
 * (rook). Shared boundaries in the app's area files share exact vertices,
 * so this matches spdep::poly2nb on the same shapes.
 * @returns {number[][]} neighbor indexes per area
 */
export function contiguityNeighbors(geometries, { rook = false } = {}) {
  const owners = new Map();
  const key = ([x, y]) => `${x.toFixed(7)},${y.toFixed(7)}`;
  geometries.forEach((geometry, i) => {
    const mine = new Set();
    for (const ring of ringsOf(geometry)) {
      for (let k = 0; k < ring.length; k += 1) {
        if (!rook) mine.add(key(ring[k]));
        else if (k + 1 < ring.length) {
          const a = key(ring[k]);
          const b = key(ring[k + 1]);
          if (a !== b) mine.add(a < b ? `${a}|${b}` : `${b}|${a}`);
        }
      }
    }
    for (const k of mine) {
      const list = owners.get(k);
      if (list) list.push(i);
      else owners.set(k, [i]);
    }
  });
  const neighbors = geometries.map(() => new Set());
  for (const list of owners.values())
    if (list.length > 1)
      for (const a of list)
        for (const b of list) if (a !== b) neighbors[a].add(b);
  return neighbors.map((s) => [...s].sort((a, b) => a - b));
}

/** A seeded random generator, so a result can be repeated exactly. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Moran's I with row-standardized weights. Areas without neighbors keep a
 * zero row (spdep's zero.policy = TRUE).
 */
export function moransI(
  values,
  neighbors,
  { permutations = MORAN_PERMUTATIONS, seed = 12345 } = {},
) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const z = values.map((v) => v - mean);
  const m2 = z.reduce((a, b) => a + b * b, 0);
  const m4 = z.reduce((a, b) => a + b ** 4, 0);
  const lagOf = (zs) =>
    neighbors.map((list) =>
      list.length ? list.reduce((a, j) => a + zs[j], 0) / list.length : 0,
    );
  const lag = lagOf(z);
  const linked = neighbors.filter((l) => l.length).length;
  const S0 = linked; // each non-empty row sums to 1
  const statistic = (zs, lags) =>
    (n / S0) * (zs.reduce((a, v, i) => a + v * lags[i], 0) / m2);
  const I = statistic(z, lag);
  // Variance under randomization (Cliff and Ord), as spdep::moran.test.
  let S1 = 0;
  const colSums = new Array(n).fill(0);
  const weight = new Map();
  neighbors.forEach((list, i) => {
    for (const j of list) {
      const w = 1 / list.length;
      weight.set(i * n + j, w);
      colSums[j] += w;
    }
  });
  for (const [ij, w] of weight) {
    const i = Math.floor(ij / n);
    const j = ij % n;
    const back = weight.get(j * n + i) || 0;
    S1 += (w + back) ** 2;
  }
  S1 /= 2;
  let S2 = 0;
  neighbors.forEach((list, i) => {
    const row = list.length ? 1 : 0;
    S2 += (row + colSums[i]) ** 2;
  });
  const expected = -1 / (n - 1);
  const b2 = (n * m4) / (m2 * m2);
  const variance =
    (n * ((n * n - 3 * n + 3) * S1 - n * S2 + 3 * S0 * S0) -
      b2 * ((n * n - n) * S1 - 2 * n * S2 + 6 * S0 * S0)) /
      ((n - 1) * (n - 2) * (n - 3) * S0 * S0) -
    expected * expected;
  const zScore = (I - expected) / Math.sqrt(variance);
  // Pseudo p-value: the share of random relabelings at least as extreme.
  const random = mulberry32(seed);
  const shuffled = [...z];
  let extreme = 0;
  const draws = [];
  for (let r = 0; r < permutations; r += 1) {
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const value = statistic(shuffled, lagOf(shuffled));
    draws.push(value);
    if (I >= expected ? value >= I : value <= I) extreme += 1;
  }
  const drawMean = draws.reduce((a, b) => a + b, 0) / (draws.length || 1);
  const drawSd = Math.sqrt(
    draws.reduce((a, b) => a + (b - drawMean) ** 2, 0) /
      Math.max(1, draws.length - 1),
  );
  // Standardized values for the scatter plot (its slope is I).
  const sd = Math.sqrt(m2 / n);
  const counts = neighbors.map((l) => l.length);
  return {
    I,
    expected,
    variance,
    z: zScore,
    // One-sided, as moran.test's default (alternative = "greater").
    p: 0.5 * erfc(zScore / Math.SQRT2),
    pseudoP: (extreme + 1) / (permutations + 1),
    permutations,
    permutationMean: drawMean,
    permutationSd: drawSd,
    n,
    islands: counts.filter((c) => c === 0).length,
    neighbors: {
      mean: counts.reduce((a, b) => a + b, 0) / n,
      min: Math.min(...counts),
      max: Math.max(...counts),
    },
    points: z.map((v, i) => [v / sd, lag[i] / sd]),
  };
}

/** The complementary error function (Numerical Recipes erfcc). */
function erfc(x) {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t *
                                  (1.48851587 +
                                    t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? y : 2 - y;
}

/**
 * Moran's I for a request like the analysis box's (layer or measures, state,
 * view) and one numeric variable.
 */
export function moranForRequest(request = {}, { publicDir } = {}) {
  const dataDir = publicDir ?? path.join(ROOT, 'public');
  const variable = String(request.variable || '');
  const state = request.state ? findState(request.state) : null;
  if (request.state && !state)
    return { ok: false, problems: [`No state matches “${request.state}”.`] };
  const view =
    request.view &&
    ['west', 'south', 'east', 'north'].every((k) =>
      Number.isFinite(request.view[k]),
    )
      ? request.view
      : null;
  let variables;
  let rows;
  let geometries;
  if (request.baseUrl) {
    const read = readLayerAreas({
      baseUrl: request.baseUrl,
      publicDir: dataDir,
      state,
      view,
      withGeometry: true,
    });
    if (read.problems.length) return { ok: false, problems: read.problems };
    variables = layerVariables(read.areas);
    rows = layerRows(variables, read.areas);
    geometries = read.areas.map((a) => a.geometry);
  } else {
    const geography = ['county', 'tract', 'state'].includes(request.geography)
      ? request.geography
      : 'county';
    if (geography === 'tract' && !state && !view)
      return {
        ok: false,
        problems: ['Tracts need a state or the map view.'],
      };
    variables = analysisVariables(geography);
    const areas = readAreas({
      geography,
      state,
      view,
      publicDir: dataDir,
      withGeometry: true,
    });
    rows = datasetRows(geography, variables, areas);
    geometries = areas.map((a) => a.geometry);
  }
  const at = variables.findIndex((v) => v.name === variable);
  if (at < 0)
    return { ok: false, problems: [`No variable named “${variable}”.`] };
  const keep = [];
  rows.forEach((row, i) => {
    const value = Number(row[at]);
    if (row[at] !== null && row[at] !== '' && Number.isFinite(value))
      keep.push(i);
  });
  if (keep.length < 4)
    return {
      ok: false,
      problems: ['Moran’s I needs at least four areas with values.'],
    };
  if (keep.length > MAX_MORAN_AREAS)
    return {
      ok: false,
      problems: [
        `Too many areas (${keep.length}); choose one state or the map view.`,
      ],
    };
  const neighbors = contiguityNeighbors(
    keep.map((i) => geometries[i]),
    { rook: Boolean(request.rook) },
  );
  const result = moransI(
    keep.map((i) => Number(rows[i][at])),
    neighbors,
  );
  if (!(result.neighbors.max > 0))
    return {
      ok: false,
      problems: ['These areas do not touch one another (no neighbors).'],
    };
  const step = Math.max(1, Math.ceil(result.points.length / MAX_PLOT_POINTS));
  return {
    ok: true,
    problems: [],
    variable,
    label: variables[at].label,
    weights: `${request.rook ? 'Rook' : 'Queen'} contiguity, row-standardized`,
    ...result,
    points: result.points.filter((_, i) => i % step === 0),
  };
}
