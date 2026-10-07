/**
 * Stata results and the session's data on the map, for any layer a run
 * used:
 *
 *  - Results on the map: each model's fitted values and residuals
 *    (map_m<k>.csv) and the variables egen made (map_vars.csv) tint the
 *    areas. Residuals use a diverging ramp centered on zero (red: higher
 *    than the model predicts, blue: lower); other values the gold quantile
 *    ramp of the Curated Flights upload overlay, which draws them.
 *  - Highlighting: rows chosen in the panel's data table light up on the
 *    map (bright fill, thick outline) and the camera brings them into view.
 *
 * Rows are matched by hev_id (the data.csv row, which Stata keeps as a
 * variable). Census areas are drawn from the app's own tract, county and
 * state outlines by GEOID; any other layer from the shapes the server saved
 * with the session (shapes.geojsonl, one geometry per data row). One way
 * only: the map shows what the table and Stata hold; choosing on the map does
 * not go back to them.
 */
import {
  MAP_FILE_PREFIX,
  SESSION_SHAPES_FILE,
  STATA_COMMANDS,
} from './stataCommands.js';
import { geometryBbox, parseCsv } from '../curated/userData.js';

/** Selected rows on the map: a bright fill with a thick outline. */
const HIGHLIGHT_FILL = '#00E5FF';
const HIGHLIGHT_LINE = '#FFEA00';

/** Blue (below the prediction) through a neutral gray to red (above). */
export const RESIDUAL_RAMP = Object.freeze([
  '#2166ac',
  '#67a9cf',
  '#e6e6e6',
  '#ef8a62',
  '#b2182b',
]);

/** Tract outlines are read per county; more than this is too much to draw. */
export const MAX_MAP_COUNTIES = 400;

const MODEL_FILE = new RegExp(`^${MAP_FILE_PREFIX}m(\\d+)\\.csv$`);

const polygonsOf = (geometry) =>
  geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];

const pointsOf = (geometry) =>
  geometry?.type === 'Point'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPoint'
      ? geometry.coordinates
      : [];

/**
 * A Stata export delimited file: {columns, rows: [{hev_id, geoid?, ...}]}
 * (numbers, missing as null; `columns` leaves out the keys).
 */
export function parseMapCsv(text) {
  const { columns: header, rows: raw } = parseCsv(text);
  if (!header.includes('hev_id') && !header.includes('geoid'))
    return { columns: [], rows: [] };
  const columns = header.filter((c) => c !== 'hev_id' && c !== 'geoid');
  const rows = raw.map((r) => {
    const row = {};
    if ('hev_id' in r) row.hev_id = Number(r.hev_id);
    if ('geoid' in r) row.geoid = r.geoid;
    for (const c of columns) {
      const number = r[c] === '' ? NaN : Number(r[c]);
      row[c] = Number.isFinite(number) ? number : null;
    }
    return row;
  });
  return { columns, rows };
}

/**
 * The session's data for the table under the results: data.csv (each row
 * numbered as hev_id), with each model's residual and fitted value joined on.
 * @returns {{columns: string[], rows: object[]}}
 */
export function sessionTable(dataText, results = []) {
  const { columns, rows } = parseCsv(dataText);
  rows.forEach((row, i) => {
    row.hev_id = i + 1;
  });
  const byId = new Map(rows.map((row) => [row.hev_id, row]));
  const byGeoid = new Map(rows.map((row) => [row.geoid, row]));
  const extra = [];
  for (const { k, table } of results) {
    for (const [column, name] of [
      ['hev_res', `m${k} residual`],
      ['hev_fit', `m${k} fitted`],
    ]) {
      if (!table.columns.includes(column)) continue;
      extra.push(name);
      for (const r of table.rows) {
        const row =
          r.hev_id !== undefined ? byId.get(r.hev_id) : byGeoid.get(r.geoid);
        if (row && Number.isFinite(r[column])) row[name] = r[column];
      }
    }
  }
  return { columns: [...columns, ...extra], rows };
}

/**
 * The columns the table shows: the area's name and GEOID, the variables the
 * commands mention, and the model results; the first few numeric columns
 * when the commands name none (an uploaded do-file).
 */
export function tableColumns(columns, commandText = '', rows = []) {
  const ids = ['name', 'geoid'].filter((c) => columns.includes(c));
  const words = new Set(String(commandText).match(/[A-Za-z_]\w*/g) || []);
  const results = columns.filter((c) => /^m\d+ (residual|fitted)$/.test(c));
  let named = columns.filter(
    (c) => words.has(c) && !ids.includes(c) && !results.includes(c),
  );
  if (!named.length)
    named = columns
      .filter(
        (c) =>
          !ids.includes(c) &&
          !results.includes(c) &&
          ![
            'state_fips',
            'county_fips',
            'tract',
            'state',
            'lon',
            'lat',
          ].includes(c) &&
          rows.some((row) => row[c] !== '' && Number.isFinite(Number(row[c]))),
      )
      .slice(0, 6);
  return [...ids, ...named, ...results];
}

/** The command lines of the models that ran, in order (model k is map_mk). */
export function modelLines(steps = []) {
  return steps
    .filter((s) => !s.rc)
    .map((s) => String(s.line || ''))
    .filter(
      (line) => STATA_COMMANDS[line.trim().split(/\s+/)[0]]?.kind === 'model',
    );
}

/**
 * What a run can show on the map:
 * [{file, column, label, residual}] — residuals first for each model.
 */
export function mapChoices(result = {}) {
  const lines = modelLines(result.steps);
  const choices = [];
  for (const file of result.files || []) {
    const m = file.match(MODEL_FILE);
    if (!m) continue;
    const k = Number(m[1]);
    const model = lines[k - 1]
      ? `Model ${k} (${lines[k - 1].split(/\s+/).slice(0, 3).join(' ')}…)`
      : `Model ${k}`;
    choices.push(
      {
        file,
        column: 'hev_res',
        label: `${model}: residuals (observed − fitted)`,
        residual: true,
      },
      { file, column: 'hev_fit', label: `${model}: fitted values` },
    );
  }
  choices.sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }));
  return choices;
}

/** The variables a run made (map_vars.csv columns), as map choices. */
export function variableChoices(columns, file = `${MAP_FILE_PREFIX}vars.csv`) {
  return columns.map((column) => ({
    file,
    column,
    label: `${column} (made in this session)`,
  }));
}

/** Residual classes, symmetric about zero: ±0.5 and ±1.5 standard deviations. */
export function residualBreaks(values) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return [0];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(
    v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1),
  );
  if (!(sd > 0)) return [0];
  return [-1.5 * sd, -0.5 * sd, 0.5 * sd, 1.5 * sd];
}

/** Which census geography a set of GEOIDs is: 'state', 'county', 'tract' or null. */
export function geographyOf(geoids) {
  if (!geoids.length || geoids.some((g) => !g)) return null;
  const lengths = new Set(geoids.map((g) => String(g).length));
  if (lengths.size !== 1) return null;
  return { 2: 'state', 5: 'county', 11: 'tract' }[[...lengths][0]] || null;
}

const formatValue = (value, span) =>
  value.toLocaleString('en-US', {
    maximumFractionDigits: span < 1 ? 3 : span < 10 ? 2 : 1,
    minimumFractionDigits: 0,
  });

/** Legend rows [{color, label}] for a drawn legend {breaks, colors}. */
export function legendRows({ breaks = [], colors = [] } = {}) {
  if (!breaks.length) return colors.map((color) => ({ color, label: '' }));
  const span = Math.abs(breaks[breaks.length - 1] - breaks[0]);
  const f = (v) => formatValue(v, span);
  return colors.map((color, i) => ({
    color,
    label:
      i === 0
        ? `below ${f(breaks[0])}`
        : i >= breaks.length
          ? `${f(breaks[breaks.length - 1])} and above`
          : `${f(breaks[i - 1])} to ${f(breaks[i])}`,
  }));
}

/** Census outlines (GEOID -> geometry) from the app's own files. */
async function censusOutlines(geoids, fetchImpl) {
  const shapes = await import('../curated/userShapes.js');
  const geography = geographyOf(geoids);
  const outlines = new Map();
  const add = (map) => {
    for (const id of geoids) if (map.has(id)) outlines.set(id, map.get(id));
  };
  if (geography === 'state') add(await shapes.stateShapes(fetchImpl));
  else if (geography === 'county') {
    for (const state of new Set(geoids.map((g) => g.slice(0, 2))))
      add(await shapes.countyShapes(state, fetchImpl));
  } else {
    const counties = [...new Set(geoids.map((g) => g.slice(0, 5)))];
    if (counties.length > MAX_MAP_COUNTIES)
      return {
        outlines,
        problem: 'Too many tracts to draw; choose one state.',
      };
    const maps = await Promise.all(
      counties.map((county) => shapes.tractShapes(county, fetchImpl)),
    );
    maps.forEach(add);
  }
  return { outlines, problem: null };
}

/** The overlay itself: one result and one highlight at a time. */
export class AnalysisMap {
  constructor({ viewer, fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
    this.viewer = viewer;
    this.fetch = fetchImpl;
    this.overlay = null;
    this.files = new Map();
    this.highlighted = [];
    this.highlightToken = 0;
  }

  /** A session file, fetched once per run (`parse` turns its text into data). */
  cached(url, parse) {
    if (!this.files.has(url))
      this.files.set(
        url,
        this.fetch(url)
          .then((r) => (r.ok ? r.text() : null))
          .then(parse),
      );
    return this.files.get(url);
  }

  /** A result file's columns and rows. */
  read(url) {
    return this.cached(url, (text) => parseMapCsv(text || ''));
  }

  /** The session's data.csv (with model results joined on). */
  async table(base, files = []) {
    const results = [];
    for (const file of files) {
      const m = file.match(MODEL_FILE);
      if (m)
        results.push({
          k: Number(m[1]),
          table: await this.read(`${base}/${file}`),
        });
    }
    return this.cached(`${base}/data.csv`, (text) =>
      sessionTable(text || '', results),
    );
  }

  /**
   * Shapes for rows ({hev_id, geoid?}): census outlines by GEOID, else the
   * session's own shapes by row. Returns {keyOf, outlines, problem}.
   */
  async shapesFor(base, rows) {
    const geoids = rows.map((r) => r.geoid);
    if (geographyOf(geoids)) {
      const { outlines, problem } = await censusOutlines(geoids, this.fetch);
      return { keyOf: (r) => r.geoid, outlines, problem };
    }
    const byRow = await this.cached(
      `${base}/${SESSION_SHAPES_FILE}`,
      (text) =>
        text &&
        new Map(
          text
            .split('\n')
            .map((line, i) => [
              `#${i + 1}`,
              line.trim() ? JSON.parse(line) : null,
            ])
            .filter(([, geometry]) => geometry),
        ),
    );
    if (!byRow)
      return {
        keyOf: () => null,
        outlines: new Map(),
        problem:
          'The shapes of these areas were not saved with this session (too many areas); choose one state or a smaller view.',
      };
    return { keyOf: (r) => `#${r.hev_id}`, outlines: byRow, problem: null };
  }

  /**
   * Highlight rows chosen in the table and bring them into view. An empty
   * list takes the highlight off.
   */
  async highlight(base, rows, { fly = true } = {}) {
    const token = ++this.highlightToken;
    this.clearHighlight();
    if (!this.viewer || !rows.length) return { ok: true, areas: 0 };
    const [{ keyOf, outlines, problem }, Cesium] = await Promise.all([
      this.shapesFor(base, rows),
      import('cesium'),
    ]);
    if (token !== this.highlightToken) return { ok: false, stale: true };
    if (problem) return { ok: false, problem };
    const fills = [];
    const lines = [];
    const dots = [];
    let box = null;
    const degrees = (positions) => {
      const flat = [];
      for (const [lon, lat] of positions || [])
        if (Number.isFinite(lon) && Number.isFinite(lat)) flat.push(lon, lat);
      const n = flat.length;
      if (n >= 4 && flat[0] === flat[n - 2] && flat[1] === flat[n - 1])
        flat.length = n - 2;
      return Cesium.Cartesian3.fromDegreesArray(flat);
    };
    let found = 0;
    for (const row of rows) {
      const geometry = outlines.get(keyOf(row));
      if (!geometry) continue;
      found += 1;
      const b = geometryBbox(geometry);
      if (b)
        box = box
          ? [
              Math.min(box[0], b[0]),
              Math.min(box[1], b[1]),
              Math.max(box[2], b[2]),
              Math.max(box[3], b[3]),
            ]
          : b;
      dots.push(...pointsOf(geometry));
      for (const rings of polygonsOf(geometry)) {
        const [outer, ...holes] = rings.map(degrees);
        if (!outer || outer.length < 3) continue;
        fills.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: new Cesium.PolygonHierarchy(
                outer,
                holes
                  .filter((h) => h.length >= 3)
                  .map((h) => new Cesium.PolygonHierarchy(h)),
              ),
              height: -120_000,
              extrudedHeight: 8_000,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString(HIGHLIGHT_FILL).withAlpha(0.9),
              ),
            },
          }),
        );
        lines.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.GroundPolylineGeometry({
              positions: [...outer, outer[0]],
              width: 6,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString(HIGHLIGHT_LINE),
              ),
            },
          }),
        );
      }
    }
    const scene = this.viewer.scene;
    if (fills.length)
      this.highlighted.push(
        scene.primitives.add(
          new Cesium.ClassificationPrimitive({
            geometryInstances: fills,
            appearance: new Cesium.PerInstanceColorAppearance({
              flat: true,
              translucent: true,
            }),
            classificationType: Cesium.ClassificationType.BOTH,
            asynchronous: true,
          }),
        ),
      );
    if (lines.length)
      this.highlighted.push(
        scene.primitives.add(
          new Cesium.GroundPolylinePrimitive({
            geometryInstances: lines,
            appearance: new Cesium.PolylineColorAppearance(),
            classificationType: Cesium.ClassificationType.BOTH,
            asynchronous: true,
          }),
        ),
      );
    if (dots.length) {
      const points = scene.primitives.add(
        new Cesium.PointPrimitiveCollection(),
      );
      for (const [lon, lat] of dots)
        points.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString(HIGHLIGHT_FILL),
          outlineColor: Cesium.Color.fromCssColorString(HIGHLIGHT_LINE),
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      this.highlighted.push(points);
    }
    if (fly && box) {
      // Some room around the areas, so their neighbors show too.
      const padX = Math.max(0.02, (box[2] - box[0]) * 0.6);
      const padY = Math.max(0.02, (box[3] - box[1]) * 0.6);
      this.viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(
          box[0] - padX,
          box[1] - padY,
          box[2] + padX,
          box[3] + padY,
        ),
        duration: 1.2,
      });
    }
    scene.requestRender?.();
    return {
      ok: found > 0,
      areas: found,
      problem: found ? null : 'These rows have no shapes to show.',
    };
  }

  clearHighlight() {
    const primitives = this.viewer?.scene?.primitives;
    for (const p of this.highlighted.splice(0)) primitives?.remove(p);
    this.viewer?.scene?.requestRender?.();
  }

  /** Draw one result choice; returns {ok, areas, legend, problem}. */
  async show(base, choice) {
    if (!this.viewer)
      return { ok: false, problem: 'The map is not available here.' };
    const { rows } = await this.read(`${base}/${choice.file}`);
    const valued = rows.filter((r) => Number.isFinite(r[choice.column]));
    if (!valued.length)
      return { ok: false, problem: 'That result has no values to draw.' };
    const { keyOf, outlines, problem } = await this.shapesFor(base, valued);
    if (problem) return { ok: false, problem };
    if (!this.overlay) {
      const { UserDataOverlay } = await import('../curated/userOverlay.js');
      const viewer = this.viewer;
      this.overlay = new UserDataOverlay({
        viewer,
        requestRender: () => viewer?.scene?.requestRender?.(),
      });
    }
    const values = valued.map((r) => r[choice.column]);
    const drawn = this.overlay.draw(
      {
        records: valued.map((r) => ({
          geoid: keyOf(r),
          level: 'area',
          props: { value: r[choice.column] },
        })),
      },
      {
        column: 'value',
        label: choice.label,
        ...(choice.residual
          ? { ramp: RESIDUAL_RAMP, breaks: residualBreaks(values) }
          : {}),
      },
      outlines,
    );
    const shown = drawn.areas + drawn.points;
    return {
      ok: shown > 0,
      areas: shown,
      legend: this.overlay.legend,
      problem: shown ? null : 'None of these areas could be drawn.',
    };
  }

  clear() {
    this.overlay?.clear();
  }

  /** A new run: forget the last session's files and take its drawing off. */
  reset() {
    this.files.clear();
    this.clear();
    this.highlightToken += 1;
    this.clearHighlight();
  }
}
