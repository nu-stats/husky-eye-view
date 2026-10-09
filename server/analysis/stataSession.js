/**
 * Stata sessions on this computer: find Stata 18 or 19, export a dataset from
 * the map's area files, write the session folder (data.csv, analysis.do),
 * run Stata in batch mode, and read the log back. Every session keeps its
 * do-file and log in Documents/HuskyEyeView-Analyses/<session>/.
 *
 * Shared by the server endpoint (server/providers/stata.js) and the CLI
 * (scripts/stata-analysis.mjs). The command checks and the do-file itself are
 * in src/analysis/stataCommands.js.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { STATES, findState } from '../../src/reports/areaReport.js';
import { REPORT_GEOGRAPHIES } from '../../src/reports/reportMeasures.js';
import {
  MAX_DO_FILE_BYTES,
  MAX_SESSION_SHAPES,
  SESSION_SHAPES_FILE,
  SHAPEFILE_NAME,
  analysisVariables,
  buildDoFile,
  checkCommandLines,
  readableLog,
  stepResults,
} from '../../src/analysis/stataCommands.js';
import { buildZip } from '../../src/curated/curatedFiles.js';
import { buildWorkbook } from '../../src/analysis/excelWorkbook.js';
import { dataSheets } from '../../src/analysis/excelCommands.js';
import { writeShapefile } from './shapefile.js';
import { layerRows, layerVariables, readLayerAreas } from './layerData.js';
import { uploadRows } from './userTable.js';

/** data.xlsx is written up to this many cells (rows × variables). */
const MAX_XLSX_CELLS = 4_000_000;

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;
const EDITIONS = ['MP', 'SE', 'BE', ''];

/** Where sessions are kept: HEV_ANALYSIS_DIR, else Documents/HuskyEyeView-Analyses. */
export function analysisRoot(env = process.env) {
  return path.resolve(
    env.HEV_ANALYSIS_DIR ||
      path.join(os.homedir(), 'Documents', 'HuskyEyeView-Analyses'),
  );
}

/**
 * Find Stata: HEV_STATA_PATH first, then the standard install folders, newest
 * version and largest edition first. Returns {path, version, edition, batch}
 * or null. `batch(doFile)` gives the batch-mode arguments for this platform.
 */
export function findStata({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  list = (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
} = {}) {
  // Paths follow the platform being searched, not the one running this
  // (tests search a Windows install from Linux CI).
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const describe = (file) => {
    const base = paths.basename(file);
    const folder = paths.basename(paths.dirname(file));
    const version = Number((folder.match(/(\d{2})/) || [])[1]) || null;
    const edition = (base.match(/stata[-_]?(mp|se|be|ic)/i) || [])[1];
    return {
      path: file,
      version,
      edition: edition ? edition.toUpperCase() : '',
      batch: (doFile) =>
        platform === 'win32' ? ['/e', 'do', doFile] : ['-b', 'do', doFile],
      // The Stata window: the program itself on Windows and Linux; on a Mac
      // the app bundle, opened with the do-file.
      interactive: (doFile) => {
        const app = file.match(/^(.*\.app)\//)?.[1];
        return platform === 'darwin' && app
          ? { command: 'open', args: ['-a', app, doFile] }
          : { command: file, args: ['do', doFile] };
      },
    };
  };
  if (env.HEV_STATA_PATH && exists(env.HEV_STATA_PATH))
    return describe(env.HEV_STATA_PATH);
  const candidates = [];
  if (platform === 'win32') {
    for (const base of [
      env.ProgramFiles || 'C:\\Program Files',
      env['ProgramFiles(x86)'],
    ].filter(Boolean)) {
      for (const folder of list(base).filter((d) =>
        /^Stata(Now)?\s?\d{2}$/i.test(d),
      )) {
        for (const edition of EDITIONS) {
          candidates.push(paths.join(base, folder, `Stata${edition}-64.exe`));
        }
      }
    }
  } else if (platform === 'darwin') {
    for (const folder of list('/Applications').filter((d) =>
      /^Stata/i.test(d),
    )) {
      for (const edition of EDITIONS.filter(Boolean)) {
        const app = `Stata${edition}.app`;
        candidates.push(
          paths.join(
            '/Applications',
            folder,
            app,
            'Contents',
            'MacOS',
            `stata-${edition.toLowerCase()}`,
          ),
        );
      }
    }
  } else {
    for (const folder of list('/usr/local').filter((d) =>
      /^stata\d{2}$/i.test(d),
    )) {
      for (const edition of EDITIONS) {
        candidates.push(
          paths.join(
            '/usr/local',
            folder,
            edition ? `stata-${edition.toLowerCase()}` : 'stata',
          ),
        );
      }
    }
  }
  const found = candidates.filter((file) => exists(file)).map(describe);
  found.sort(
    (a, b) =>
      (b.version || 0) - (a.version || 0) ||
      EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition),
  );
  return found[0] || null;
}

/** Area-weighted centroid of a polygon's outer ring ([lon, lat]). */
function ringCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    area += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (!area) {
    const n = ring.length || 1;
    return [
      ring.reduce((s, p) => s + p[0], 0) / n,
      ring.reduce((s, p) => s + p[1], 0) / n,
      0,
    ];
  }
  return [cx / (3 * area), cy / (3 * area), Math.abs(area / 2)];
}

/** Centroid of a Polygon or MultiPolygon: the largest part's. */
export function geometryCentroid(geometry) {
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  let best = null;
  for (const polygon of polygons) {
    if (!polygon?.[0]?.length) continue;
    const c = ringCentroid(polygon[0]);
    if (!best || c[2] > best[2]) best = c;
  }
  return best ? [best[0], best[1]] : [null, null];
}

const inBox = (lon, lat, box) =>
  box &&
  lon >= box.west &&
  lon <= box.east &&
  lat >= box.south &&
  lat <= box.north;

const boxesOverlap = (a, [w, s, e, n]) =>
  !(e < a.west || w > a.east || n < a.south || s > a.north);

/**
 * The areas of a geography from public/context: properties plus centroid.
 * Tracts need a state or a view box; a view box keeps only areas whose
 * centroid is inside it.
 */
export function readAreas({
  geography,
  state = null,
  view = null,
  publicDir = path.join(ROOT, 'public'),
  withGeometry = false,
}) {
  const base = path.join(publicDir, REPORT_GEOGRAPHIES[geography].baseUrl);
  const index = JSON.parse(readFileSync(path.join(base, 'index.json'), 'utf8'));
  const chunks = index.filter(
    (entry) =>
      (!state || geography === 'state' || String(entry.id).startsWith(state)) &&
      (!view || !entry.bbox || boxesOverlap(view, entry.bbox)),
  );
  const areas = [];
  for (const entry of chunks) {
    const text = readFileSync(path.join(base, `${entry.id}.geojsonl`), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const feature = JSON.parse(line);
      const p = feature.properties || {};
      const geoid = String(p.geoid || '');
      if (
        state &&
        geography !== 'county' &&
        geography !== 'state' &&
        !geoid.startsWith(state)
      )
        continue;
      if (state && geography === 'county' && !geoid.startsWith(state)) continue;
      if (state && geography === 'state' && geoid !== state) continue;
      const [lon, lat] = geometryCentroid(feature.geometry);
      if (view && !inBox(lon, lat, view)) continue;
      areas.push({
        ...p,
        geoid,
        lon,
        lat,
        ...(withGeometry && { geometry: feature.geometry }),
      });
    }
  }
  return areas;
}

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** One dataset row per area, in `variables` order. */
export function datasetRows(geography, variables, areas) {
  return areas.map((p) => {
    const geoid = p.geoid;
    const row = {
      geoid,
      state_fips: geoid.slice(0, 2),
      county_fips: geography === 'state' ? '' : geoid.slice(2, 5),
      tract: geography === 'tract' ? geoid.slice(5) : '',
      name: p.name || '',
      state: (STATES[geoid.slice(0, 2)] || [''])[0],
      lon: Number.isFinite(p.lon) ? Math.round(p.lon * 1e5) / 1e5 : null,
      lat: Number.isFinite(p.lat) ? Math.round(p.lat * 1e5) / 1e5 : null,
    };
    return variables.map((v) => (v.key ? (p[v.key] ?? null) : row[v.name]));
  });
}

export function datasetCsv(variables, rows) {
  return [
    variables.map((v) => v.name).join(','),
    ...rows.map((r) => r.map(csvCell).join(',')),
  ].join('\r\n');
}

const pad = (n) => String(n).padStart(2, '0');

/** A new, unique session folder name and path. */
export function newSessionFolder(root, label, now = new Date()) {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let id = `${stamp}_${label}`;
  for (let n = 2; existsSync(path.join(root, id)); n += 1)
    id = `${stamp}_${label}-${n}`;
  const folder = path.join(root, id);
  mkdirSync(folder, { recursive: true });
  return { id, folder };
}

/** What a session needs from Stata; R brings its own (rSession.js). */
export const STATA_ENGINE = Object.freeze({
  name: 'Stata',
  checkLines: checkCommandLines,
  scriptBytes: MAX_DO_FILE_BYTES,
  scriptWord: 'do-file',
  userFile: 'user.do',
  script: 'analysis.do',
  openScript: 'open.do',
  build: ({ userFile, ...options }) =>
    buildDoFile({ ...options, userDoFile: userFile }),
  extraFiles: () => ({}),
});

/**
 * Validate a request and write the session folder: data.csv, the script and
 * the uploaded script. Returns {ok, problems, session} without running it.
 */
export function prepareSession(request = {}, options = {}) {
  return prepareAnalysisSession(request, { ...options, engine: STATA_ENGINE });
}

/** The same for any engine (Stata here, R in rSession.js, SPSS in spssSession.js). */
export function prepareAnalysisSession(
  request = {},
  { engine = STATA_ENGINE, env = process.env, publicDir, now } = {},
) {
  const problems = [];
  const dataDir = publicDir ?? path.join(ROOT, 'public');
  // A chosen layer (its own files, every field), your own uploaded file, or,
  // without either, every Area Reports measure for counties, a state's
  // tracts or states.
  const uploadMode = Boolean(request.uploadId);
  const layerMode = !uploadMode && Boolean(request.baseUrl);
  const geography = uploadMode
    ? 'upload'
    : layerMode
      ? 'layer'
      : ['county', 'tract', 'state'].includes(request.geography)
        ? request.geography
        : request.geography
          ? null
          : 'county';
  if (!geography)
    return {
      ok: false,
      problems: [`No ${engine.name} dataset for “${request.geography}”.`],
    };
  let state = null;
  if (request.state) {
    state = findState(request.state);
    if (!state) problems.push(`No state matches “${request.state}”.`);
  }
  const view =
    request.view &&
    ['west', 'south', 'east', 'north'].every((k) =>
      Number.isFinite(request.view[k]),
    )
      ? request.view
      : null;
  if (geography === 'tract' && !state && !view)
    problems.push(
      'Tract data needs a state or the current view (all US tracts are too many).',
    );
  let layerRead = null;
  let uploadRead = null;
  let variables;
  if (uploadMode) {
    if (problems.length) return { ok: false, problems };
    uploadRead = uploadRows(
      { uploadId: request.uploadId, state, view },
      { env, publicDir: dataDir },
    );
    if (!uploadRead.ok) return { ok: false, problems: uploadRead.problems };
    if (!uploadRead.rows.length)
      return {
        ok: false,
        problems: [
          'No rows of your file match these areas; nothing to analyze.',
        ],
      };
    variables = uploadRead.variables;
  } else if (layerMode) {
    if (problems.length) return { ok: false, problems };
    layerRead = readLayerAreas({
      baseUrl: request.baseUrl,
      publicDir: dataDir,
      state,
      view,
    });
    if (layerRead.problems.length)
      return { ok: false, problems: layerRead.problems };
    if (!layerRead.areas.length)
      return {
        ok: false,
        problems: ['No areas of this layer match; nothing to analyze.'],
      };
    variables = layerVariables(layerRead.areas);
  } else {
    variables = analysisVariables(geography);
  }
  const checked = engine.checkLines(request.commands || [], variables);
  problems.push(...checked.problems);
  let doFile = null;
  if (request.doFile) {
    const text = String(request.doFile);
    if (Buffer.byteLength(text) > engine.scriptBytes)
      problems.push(
        `A ${engine.scriptWord} may be at most ${engine.scriptBytes / 1024} KB.`,
      );
    else doFile = text;
  }
  if (
    !request.interactive &&
    !request.browse &&
    !checked.commands.length &&
    !doFile
  )
    problems.push(`Give at least one command or a ${engine.scriptWord}.`);
  if (problems.length) return { ok: false, problems };

  // Outlines only when a shapefile is written: spshape2dta, or the Stata
  // window (where GeoDa and QGIS can open the same areas too).
  const needsShapes =
    Boolean(request.interactive) || checked.commands.some((c) => c.needsShapes);
  let areas;
  let rows;
  let shapeAreas;
  // Layers whose areas are not census tracts, counties or states keep their
  // shapes with the session, so the panel can show its rows on the map.
  let saveShapes = false;
  if (uploadMode) {
    if (needsShapes && !uploadRead.census && !request.interactive)
      return {
        ok: false,
        problems: [
          'Your file has no census GEOIDs, so there are no outlines for spatial weights.',
        ],
      };
    const read =
      needsShapes && uploadRead.census
        ? uploadRows(
            { uploadId: request.uploadId, state, view, withGeometry: true },
            { env, publicDir: dataDir },
          )
        : uploadRead;
    rows = read.rows;
    areas = read.areas || [];
    shapeAreas = areas;
  } else if (layerMode) {
    const geoids = layerRead.areas.map((a) => String(a.properties.geoid ?? ''));
    const lengths = new Set(geoids.map((g) => g.length));
    const census = lengths.size === 1 && [2, 5, 11].includes([...lengths][0]);
    saveShapes = !census && layerRead.areas.length <= MAX_SESSION_SHAPES;
    const read =
      needsShapes || saveShapes
        ? readLayerAreas({
            baseUrl: request.baseUrl,
            publicDir: dataDir,
            state,
            view,
            withGeometry: true,
          })
        : layerRead;
    areas = read.areas;
    rows = layerRows(variables, areas);
    shapeAreas = areas.map((a, i) => ({
      geoid: a.properties.geoid ?? a.properties.name ?? String(i + 1),
      geometry: a.geometry,
    }));
  } else {
    areas = readAreas({
      geography,
      state,
      view,
      publicDir: dataDir,
      withGeometry: needsShapes,
    });
    if (!areas.length)
      return { ok: false, problems: ['No areas match; nothing to analyze.'] };
    rows = datasetRows(geography, variables, areas);
    shapeAreas = areas;
  }
  const stateUsed = uploadMode
    ? uploadRead.stateApplied
      ? state
      : null
    : layerMode
      ? layerRead.stateApplied
        ? state
        : null
      : state;
  const viewUsed = uploadMode && !uploadRead.census ? null : view;
  const where = stateUsed ? STATES[stateUsed][0] : viewUsed ? 'view' : 'US';
  const layerName = String(
    uploadMode ? uploadRead.name : request.layerName || 'layer',
  ).slice(0, 80);
  const plural = uploadMode
    ? 'rows'
    : layerMode
      ? 'areas'
      : { county: 'counties', tract: 'tracts', state: 'states' }[geography];
  const label =
    uploadMode || layerMode
      ? layerName
          .toLowerCase()
          .replace(/\.(xlsx|xlsm|csv|tsv|txt)$/, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'layer'
      : plural;
  const root = analysisRoot(env);
  const { id, folder } = newSessionFolder(
    root,
    uploadMode && !uploadRead.census ? label : `${label}-${where}`,
    now,
  );
  const scope = stateUsed
    ? ` in ${STATES[stateUsed][1]}`
    : viewUsed
      ? ' in the map view'
      : '';
  const title =
    uploadMode || layerMode
      ? `Husky Eye View: ${layerName}, ${rows.length} ${plural}${scope}`
      : `Husky Eye View: ${rows.length} ${plural}${scope}`;
  const notes = [
    ...new Set(
      variables.filter((v) => v.source).map((v) => `${v.name}: ${v.source}`),
    ),
  ];
  writeFileSync(
    path.join(folder, 'data.csv'),
    datasetCsv(variables, rows),
    'utf8',
  );
  // The same data for Excel, with each variable's label and source.
  if (rows.length * variables.length <= MAX_XLSX_CELLS)
    writeFileSync(
      path.join(folder, 'data.xlsx'),
      buildWorkbook(dataSheets({ title, data: { variables, rows } }), {
        title,
        deflate: deflateRawSync,
      }),
    );
  if (saveShapes)
    writeFileSync(
      path.join(folder, SESSION_SHAPES_FILE),
      areas.map((a) => JSON.stringify(a.geometry ?? null)).join('\n'),
      'utf8',
    );
  if (doFile) writeFileSync(path.join(folder, engine.userFile), doFile, 'utf8');
  if (needsShapes) {
    const shapes = writeShapefile(shapeAreas);
    for (const [ext, data] of Object.entries(shapes))
      writeFileSync(path.join(folder, `${SHAPEFILE_NAME}.${ext}`), data);
  }
  const doText = engine.build({
    title,
    variables,
    rows,
    commands: checked.commands,
    userFile: doFile ? engine.userFile : null,
    areaCount: rows.length,
    notes,
    folder,
    needsShapes,
    interactive: Boolean(request.interactive),
  });
  const doName = request.interactive ? engine.openScript : engine.script;
  writeFileSync(path.join(folder, doName), doText, 'utf8');
  for (const [name, text] of Object.entries(
    engine.extraFiles({ interactive: Boolean(request.interactive) }),
  ))
    writeFileSync(path.join(folder, name), text, 'utf8');
  return {
    ok: true,
    problems: [],
    session: {
      id,
      folder,
      doName,
      title,
      geography,
      state: stateUsed,
      layer: uploadMode || layerMode ? layerName : null,
      areas: rows.length,
      commands: checked.commands.map((c) => c.line),
      uploaded: Boolean(doFile),
      variables: variables.map((v) => ({
        name: v.name,
        label: v.label,
        kind: v.kind,
      })),
      notes: uploadMode ? uploadRead.notes : [],
    },
  };
}

/** Kill a process and its children (Windows needs taskkill for the tree). */
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32')
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  else child.kill('SIGKILL');
}

/** Run a prepared session in batch mode and read its log. */
export async function runSession(
  session,
  { stata, timeoutMs = RUN_TIMEOUT_MS } = {},
) {
  if (!stata)
    return {
      ok: false,
      problems: [
        'Stata was not found on this computer. Set HEV_STATA_PATH to its program file.',
      ],
    };
  const started = Date.now();
  const timedOut = await new Promise((resolve) => {
    const child = spawn(stata.path, stata.batch(session.doName), {
      cwd: session.folder,
      stdio: 'ignore',
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      killTree(child);
      resolve(true);
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  const logPath = path.join(
    session.folder,
    session.doName.replace(/\.do$/, '.log'),
  );
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const steps = stepResults(log).map((s) => ({
    ...s,
    line:
      s.step <= session.commands.length
        ? session.commands[s.step - 1]
        : 'uploaded do-file',
  }));
  const done = /HEV_DONE/.test(log);
  const problems = [];
  if (timedOut)
    problems.push(
      `Stata did not finish within ${Math.round(timeoutMs / 60000)} minutes and was stopped.`,
    );
  else if (!log)
    problems.push(
      'Stata ran but wrote no log. Is the license valid on this computer?',
    );
  else if (!done)
    problems.push('The do-file stopped before the end; see the log.');
  return {
    ok: !timedOut && done,
    problems,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    steps,
    log: readableLog(log),
    files: sessionFiles(session.folder),
  };
}

/**
 * Open the Stata window itself on a prepared session (open.do loads the data
 * and starts the command log and log). Stata keeps running on its own.
 */
export function openInteractive(session, { stata }) {
  if (!stata)
    return {
      ok: false,
      problems: [
        'Stata was not found on this computer. Set HEV_STATA_PATH to its program file.',
      ],
    };
  const { command, args } = stata.interactive(
    path.join(session.folder, session.doName),
  );
  const child = spawn(command, args, {
    cwd: session.folder,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return { ok: true, problems: [], files: sessionFiles(session.folder) };
}

/** The files of a session folder, newest last. */
export function sessionFiles(folder) {
  try {
    return readdirSync(folder)
      .filter((name) => statSync(path.join(folder, name)).isFile())
      .sort();
  } catch {
    return [];
  }
}

/** A session folder by id, never outside the analyses folder. */
export function sessionFolder(id, env = process.env) {
  if (!/^[\w.-]+$/.test(String(id || ''))) return null;
  const folder = path.join(analysisRoot(env), id);
  return existsSync(folder) ? folder : null;
}

/** The whole session as one ZIP. */
export function sessionZip(folder) {
  return buildZip(
    sessionFiles(folder).map((name) => ({
      name,
      data: new Uint8Array(readFileSync(path.join(folder, name))),
    })),
  );
}
