/**
 * Stata analysis, the pure part shared by the panel, the voice assistant,
 * the server and the CLI: which commands may run, checking a command line
 * before Stata sees it, the dataset's variables (from the Area Reports
 * measures) and the do-file each session runs. No DOM, no network, no files.
 *
 * Safety: voice and the panel's command box only run the listed commands,
 * and a line may not carry anything that reaches past the data (macros,
 * semicolons, quotes other than plain "strings", file paths, or options
 * that write files). Uploaded do-files are the user's own code and run as
 * written; the server accepts them only from this computer.
 */
import { REPORT_GEOGRAPHIES, measuresFor } from '../reports/reportMeasures.js';

/** Commands a line may start with: spelling → { name, kind, package }. */
export const STATA_COMMANDS = Object.freeze({
  regress: { name: 'regress', kind: 'model' },
  reg: { name: 'regress', kind: 'model' },
  logit: { name: 'logit', kind: 'model' },
  nbreg: { name: 'nbreg', kind: 'model' },
  poisson: { name: 'poisson', kind: 'model' },
  spregress: { name: 'spregress', kind: 'model', spatial: 'spregress' },
  spreg: { name: 'spreg', kind: 'model', spatial: 'spreg', package: 'sppack' },
  correlate: { name: 'correlate', kind: 'describe' },
  corr: { name: 'correlate', kind: 'describe' },
  summarize: { name: 'summarize', kind: 'describe' },
  summ: { name: 'summarize', kind: 'describe' },
  sum: { name: 'summarize', kind: 'describe' },
  tabulate: { name: 'tabulate', kind: 'describe' },
  tab: { name: 'tabulate', kind: 'describe' },
  fre: { name: 'fre', kind: 'describe', package: 'fre' },
  fs: { name: 'fs', kind: 'describe', package: 'fs' },
  egen: { name: 'egen', kind: 'generate' },
  twoway: { name: 'twoway', kind: 'graph' },
  // The session's own shapefile (areas.shp), linked to the data, and
  // weights matrices built from it or from the data.
  spshape2dta: { name: 'spshape2dta', kind: 'spatialsetup' },
  spmatrix: { name: 'spmatrix', kind: 'spatialsetup' },
});

/** spmatrix subcommands that neither read nor write files nor run Mata. */
const SPMATRIX_SUBCOMMANDS = new Set([
  'create',
  'summarize',
  'dir',
  'drop',
  'copy',
  'normalize',
  'note',
  'clear',
  'fromdata',
]);

/** The shapefile every session can link: areas.shp, .shx, .dbf, .prj. */
export const SHAPEFILE_NAME = 'areas';

/** The commands as offered to people (one spelling each). */
export const STATA_COMMAND_NAMES = Object.freeze([
  ...new Set(Object.values(STATA_COMMANDS).map((c) => c.name)),
]);

export const MAX_COMMAND_LINES = 20;
export const MAX_LINE_LENGTH = 600;
export const MAX_DO_FILE_BYTES = 256 * 1024;
/** Inverse-distance weights over more areas than this get too large. */
export const MAX_SPATIAL_AREAS = 5000;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
// Words that write files or reach outside the dataset, wherever they appear.
const BLOCKED_WORDS =
  /\b(saving|using|shell|winexec|xshell|erase|rm|cd|save|use|export|import|insheet|outsheet|file|copy|mkdir|rmdir|do|run|include|net|ssc|adopath|sysdir|python|java|mata|plugin|log|cmdlog|translate|graph)\b/i;

/** Stata variable name for a measure id: "foreign-born-share" → foreign_born_share. */
export const variableName = (measureId) =>
  String(measureId)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .slice(0, 32);

/** Strip characters a Stata label in "double quotes" cannot hold. */
const labelText = (text) =>
  String(text ?? '')
    .replace(/["`$\\]/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 80);

/**
 * The dataset a session exports for a geography: identity columns, then one
 * column per numeric Area Reports measure (categories as text).
 * @returns {Array<{name, label, kind: 'string'|'numeric', key?, measureId?}>}
 */
export function analysisVariables(geography) {
  if (!REPORT_GEOGRAPHIES[geography])
    throw new Error(`No Stata dataset for “${geography}”.`);
  const vars = [
    { name: 'geoid', label: 'Census GEOID', kind: 'string' },
    { name: 'state_fips', label: 'State FIPS code', kind: 'string' },
  ];
  if (geography !== 'state')
    vars.push({
      name: 'county_fips',
      label: 'County FIPS code',
      kind: 'string',
    });
  if (geography === 'tract')
    vars.push({ name: 'tract', label: 'Tract code', kind: 'string' });
  vars.push(
    { name: 'name', label: 'Area name', kind: 'string' },
    { name: 'state', label: 'State (postal code)', kind: 'string' },
    { name: 'lon', label: 'Longitude of the area centroid', kind: 'numeric' },
    { name: 'lat', label: 'Latitude of the area centroid', kind: 'numeric' },
  );
  for (const m of measuresFor(geography)) {
    if (m.key.startsWith('fbt')) continue; // encoded country lists
    vars.push({
      name: variableName(m.id),
      label: labelText(`${m.label}, ${m.years}`),
      kind: m.format === 'category' ? 'string' : 'numeric',
      key: m.key,
      measureId: m.id,
      source: m.source,
    });
  }
  return vars;
}

/** Split a line into quoted strings and everything else. */
function splitQuoted(line) {
  const parts = [];
  let rest = line;
  while (rest.length) {
    const at = rest.indexOf('"');
    if (at < 0) {
      parts.push({ text: rest, quoted: false });
      break;
    }
    if (at > 0) parts.push({ text: rest.slice(0, at), quoted: false });
    const end = rest.indexOf('"', at + 1);
    if (end < 0) return null; // unbalanced
    parts.push({ text: rest.slice(at + 1, end), quoted: true });
    rest = rest.slice(end + 1);
  }
  return parts;
}

/**
 * Check one command line. Returns {ok, line, command, name, error, creates}
 * where `creates` is the variable an egen line makes. `known` is the set of
 * variable names in the dataset so far (egen adds to it).
 */
export function checkCommandLine(raw, known = new Set()) {
  const line = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const fail = (error) => ({ ok: false, line, error });
  if (!line) return fail('The line is empty.');
  if (line.length > MAX_LINE_LENGTH)
    return fail(`A line may be at most ${MAX_LINE_LENGTH} characters.`);
  if (/[\r\n;`'$\\{}@]/.test(line) || /\/\/|\/\*/.test(line))
    return fail(
      "A line may not contain ; ` ' $ \\ { } @ or comments — use a do-file for anything beyond one command.",
    );
  const parts = splitQuoted(line);
  if (!parts) return fail('A quoted string is not closed.');
  for (const part of parts) {
    if (part.quoted) {
      if (!/^[^"]*$/.test(part.text)) return fail('Bad quoted string.');
      continue;
    }
    if (!/^[A-Za-z0-9_ .,()=<>!&|~+\-*/^#[\]:%]*$/.test(part.text))
      return fail('The line has a character Stata commands here do not use.');
    if (/:/.test(part.text))
      return fail('Colons (prefixes and paths) are not allowed in a line.');
    const blocked = part.text.match(BLOCKED_WORDS);
    if (blocked)
      return fail(
        `“${blocked[0]}” is not allowed in a line (it reads or writes files); use a do-file.`,
      );
  }
  const word = line.split(/[\s,]/)[0];
  const spec = STATA_COMMANDS[word.toLowerCase()];
  if (!spec)
    return fail(
      `“${word}” is not one of the commands this app runs: ${STATA_COMMAND_NAMES.join(', ')}. Use a do-file for others.`,
    );
  const body = line.slice(word.length).trim();
  // The variable list: everything before if / in / the options comma.
  const head = body.split(/(?:^|\s)(?:if|in)\s|,/)[0].trim();
  let creates = null;
  // The variables a line names (before if/in/options) and its if condition.
  const vars = head
    .split(/\s+/)
    .flatMap((token) => token.split(/#+/))
    .map((token) =>
      token.replace(/^(?:[icbo]+[0-9]*\.|L[0-9]*\.|D[0-9]*\.)/, ''),
    )
    .filter((token) => IDENTIFIER.test(token) && known.has(token));
  const ifClause =
    (body.match(/(?:^|\s)if\s+(.+?)(?=\s+in\s|,|$)/) || [])[1] || null;
  if (spec.name === 'spshape2dta') {
    const m = body.match(
      /^(?:([A-Za-z_][A-Za-z0-9_]*))?\s*(?:,\s*(replace)?\s*)?$/,
    );
    if (!m || (m[1] && m[1] !== SHAPEFILE_NAME))
      return fail(
        `spshape2dta reads the session's shapefile, ${SHAPEFILE_NAME}: write “spshape2dta ${SHAPEFILE_NAME}”.`,
      );
    return {
      ok: true,
      line: `spshape2dta ${SHAPEFILE_NAME}`,
      command: 'spshape2dta',
      name: 'spshape2dta',
      kind: 'spatialsetup',
      package: null,
      spatial: null,
      creates: null,
      vars: [],
      ifClause: null,
      needsShapes: true,
    };
  }
  if (spec.name === 'spmatrix') {
    const sub = (body.match(/^([A-Za-z]+)/) || [])[1]?.toLowerCase();
    if (!SPMATRIX_SUBCOMMANDS.has(sub))
      return fail(
        `spmatrix ${sub || ''} is not run here; allowed: ${[...SPMATRIX_SUBCOMMANDS].join(', ')}. Use a do-file for import, export or Mata.`,
      );
    return {
      ok: true,
      line: `spmatrix ${body}`,
      command: 'spmatrix',
      name: 'spmatrix',
      kind: 'spatialsetup',
      package: null,
      spatial: null,
      creates: null,
      vars: [],
      ifClause: null,
      // A matrix the user builds replaces the automatic distance weights.
      userWeights: sub === 'create' || sub === 'fromdata',
    };
  }
  if (spec.name === 'egen') {
    const m = head.match(
      /^(?:(byte|int|long|float|double)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
    );
    if (!m)
      return fail(
        'egen needs: egen newvar = function(arguments) [if] [in] [, options].',
      );
    if (!IDENTIFIER.test(m[2]))
      return fail(`“${m[2]}” is not a valid variable name.`);
    if (known.has(m[2]))
      return fail(`${m[2]} already exists; egen makes a new variable.`);
    creates = m[2];
  } else if (spec.name !== 'twoway' && spec.name !== 'fs') {
    const unknown = head
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((token) => token.split(/#+/))
      .map((token) =>
        token.replace(/^(?:[icbo]+[0-9]*\.|L[0-9]*\.|D[0-9]*\.)/, ''),
      )
      .filter(
        (token) =>
          IDENTIFIER.test(token) && !/[*?~-]/.test(token) && !known.has(token),
      );
    if (known.size && unknown.length)
      return fail(
        `Not in this dataset: ${unknown.join(', ')}. Variables: ${[...known].join(', ')}.`,
      );
  }
  return {
    ok: true,
    line: `${spec.name}${body ? ` ${body}` : ''}`,
    command: word.toLowerCase(),
    name: spec.name,
    kind: spec.kind,
    package: spec.package || null,
    spatial: spec.spatial || null,
    creates,
    vars,
    ifClause,
  };
}

/** Check every line of a session; stops counting variables at the first failure. */
export function checkCommandLines(lines, variables) {
  const known = new Set(variables.map((v) => v.name));
  const checked = [];
  const problems = [];
  const list = (
    Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/)
  )
    .map((l) => String(l).trim())
    .filter((l) => l && !/^\*/.test(l));
  if (list.length > MAX_COMMAND_LINES)
    problems.push(`At most ${MAX_COMMAND_LINES} command lines per run.`);
  for (const [i, raw] of list.slice(0, MAX_COMMAND_LINES).entries()) {
    const result = checkCommandLine(raw, known);
    if (!result.ok) {
      problems.push(`Line ${i + 1}: ${result.error}`);
      continue;
    }
    if (result.creates) known.add(result.creates);
    checked.push(result);
  }
  return { ok: problems.length === 0, commands: checked, problems };
}

// The step's return code goes into a local first: the marker and the model
// bookkeeping both read it, and each command would reset _rc.
const STEP = (n, rc) => [
  `local hev_rc = ${rc}`,
  `display as text "HEV_STEP ${n} rc=" \`hev_rc'`,
];

/**
 * The session's do-file. Steps run under `capture noisily`, so one failing
 * command does not stop the rest; each prints a HEV_STEP marker the server
 * reads back. `version 18` keeps results identical on Stata 18 and 19.
 */
export function buildDoFile({
  title,
  dataFile = 'data.csv',
  variables,
  commands = [],
  userDoFile = null,
  areaCount = 0,
  notes = [],
  folder = null,
  interactive = false,
}) {
  const strings = variables
    .filter((v) => v.kind === 'string')
    .map((v) => v.name);
  const out = [
    `* ${labelText(title)}`,
    '* Written by Husky Eye View. Runs on Stata 18 or later.',
    'version 18',
    'clear all',
    'set more off',
    'set linesize 120',
    // Stata's window does not always start where it was launched.
    ...(folder && !/["`$]/.test(folder) ? [`cd "${folder}"`] : []),
    `import delimited "${dataFile}", clear varnames(1) encoding("utf-8") bindquote(strict) stringcols(${strings.map((s) => variables.findIndex((v) => v.name === s) + 1).join(' ')})`,
    `label data "${labelText(title)}"`,
  ];
  for (const v of variables) out.push(`label variable ${v.name} "${v.label}"`);
  for (const note of notes) out.push(`notes: ${labelText(note)}`);
  out.push(
    'generate long hev_id = _n',
    'label variable hev_id "Row id (Husky Eye View)"',
  );
  out.push(`compress`, `save "data.dta", replace`);
  if (interactive) {
    // The Stata window itself: record the session as a log and a do-file of
    // every command typed (or made from the menus) until Stata closes.
    out.push(
      '',
      'capture log close _all',
      'log using "session.log", text replace',
      'capture cmdlog close',
      'cmdlog using "session_commands.do", replace',
      `display as result "${labelText(title)}"`,
      'display as text "Saved in this folder as you work: session.log (results) and session_commands.do (your commands)."',
      'display as text "Graphs: graph export myplot.png saves into the same folder."',
      'describe, short',
    );
    return out.join('\n') + '\n';
  }

  /**
   * A spatial model runs on the areas with valid values for its variables
   * (and its own if condition), and its weights are built on exactly those
   * areas: Stata refuses weights that cover areas the model leaves out.
   */
  const spatialSetup = (c) => {
    const keep = [
      ...(c.vars.length ? [`!missing(${c.vars.join(', ')})`] : []),
      ...(c.ifClause ? [`(${c.ifClause})`] : []),
    ];
    const lines = ['preserve'];
    if (keep.length) lines.push(`keep if ${keep.join(' & ')}`);
    if (c.spatial === 'spregress')
      lines.push(
        'capture noisily spset hev_id, coord(lon lat) coordsys(latlong, miles)',
        'capture noisily spmatrix create idistance W, replace',
      );
    else
      lines.push(
        'capture noisily spmat idistance Wsp lon lat, id(hev_id) dfunction(dhaversine) normalize(row) replace',
      );
    return lines;
  };

  // A session that builds its own weights (spmatrix create, or contiguity
  // from the shapefile) uses them; otherwise each spatial model gets
  // inverse-distance weights on its complete cases.
  const userWeights = commands.some((c) => c.userWeights || c.needsShapes);

  let graphs = 0;
  let models = 0;
  out.push('', 'local hev_models');
  commands.forEach((c, i) => {
    const n = i + 1;
    out.push('', `* Step ${n}: ${c.line}`);
    if (c.needsShapes) {
      // Read the session's shapefile and link it to the loaded data, so
      // spmatrix create contiguity works on these areas.
      out.push(
        `capture noisily spshape2dta ${SHAPEFILE_NAME}, replace`,
        ...STEP(n, '_rc'),
        `if \`hev_rc' == 0 {`,
        `  capture drop _ID _CX _CY`,
        `  merge 1:1 _n using "${SHAPEFILE_NAME}.dta", keepusing(_ID _CX _CY) nogenerate`,
        '  capture noisily spset _ID',
        `  capture noisily spset, modify shpfile(${SHAPEFILE_NAME}_shp)`,
        '}',
      );
      return;
    }
    if (c.spatial && !userWeights && areaCount > MAX_SPATIAL_AREAS) {
      out.push(
        `display as error "Spatial models need ${MAX_SPATIAL_AREAS} areas or fewer; this dataset has ${areaCount}. Choose one state or a smaller view."`,
        ...STEP(n, 198),
      );
      return;
    }
    const autoWeights =
      c.spatial && !(userWeights && c.spatial === 'spregress');
    if (autoWeights)
      out.push(
        '* Areas with valid values for this model; weights on those areas (inverse distance, miles).',
        ...spatialSetup(c),
      );
    if (c.package) {
      out.push(
        `capture which ${c.name}`,
        'if _rc {',
        `  display as error "${c.name} is a user-written command that is not installed. In Stata, run: ssc install ${c.package}"`,
        ...STEP(n, 199).map((l) => `  ${l}`),
        '}',
        'else {',
        `  capture noisily ${c.line}`,
        ...STEP(n, '_rc').map((l) => `  ${l}`),
        '}',
      );
    } else {
      out.push(`capture noisily ${c.line}`, ...STEP(n, '_rc'));
    }
    if (c.kind === 'graph') {
      graphs += 1;
      out.push(
        `if \`hev_rc' == 0 capture noisily graph export "graph${graphs}.png", replace width(1600)`,
      );
    }
    if (c.kind === 'model') {
      models += 1;
      // Only a model that ran is kept; a failed one would repeat the last.
      out.push(
        `if \`hev_rc' == 0 {`,
        `  estimates store m${models}`,
        `  local hev_models \`hev_models' m${models}`,
        '}',
      );
    }
    if (autoWeights) out.push('restore');
  });
  if (userDoFile) {
    const n = commands.length + 1;
    out.push(
      '',
      `* Step ${n}: the uploaded do-file`,
      `capture noisily do "${userDoFile}"`,
      ...STEP(n, '_rc'),
    );
  }
  if (models)
    out.push(
      '',
      '* The models that ran, side by side.',
      `if "\`hev_models'" != "" capture noisily etable, estimates(\`hev_models') export("results.xlsx", replace)`,
    );
  out.push('', 'display as text "HEV_DONE"', '');
  return out.join('\n');
}

/** Read the HEV_STEP markers from a log: [{step, rc}]. */
export function stepResults(log) {
  const steps = [];
  for (const m of String(log || '').matchAll(/HEV_STEP (\d+) rc=\s*(\d+)/g))
    steps.push({ step: Number(m[1]), rc: Number(m[2]) });
  return steps;
}

/**
 * The log from the first step on, without the do-file's own bookkeeping (for
 * the panel and voice). The start — Stata's banner with the license holder
 * and serial number, the folder path, the data import — stays in the .log
 * file only.
 */
export function readableLog(log) {
  const lines = String(log || '').split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^\. \* (Step 1:|Spatial weights|Step \d+: the uploaded)/.test(line),
  );
  return (start >= 0 ? lines.slice(start) : [])
    .filter(
      (line) =>
        !/^\s*(?:\.\s+|>\s*)?(label variable|notes:|display as text "HEV_|capture which|local hev_|if `hev_|estimates store|if _rc|else \{|\}$|\d+\. )/.test(
          line,
        ) && !/^HEV_(STEP|DONE)/.test(line.trim()),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
