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
      short: labelText(m.short),
      tableLabel: labelText(m.tableLabel || m.label),
      aliases: m.aliases || [],
      kind: m.format === 'category' ? 'string' : 'numeric',
      key: m.key,
      measureId: m.id,
      source: m.source,
    });
  }
  return vars;
}

/**
 * A line's `if` condition: from "if" to " in " or the options comma, where
 * that comma is outside parentheses and quotes (`!missing(a, b)` keeps its
 * commas). Null when there is none.
 */
export function readIfClause(body) {
  const start = String(body).search(/(?:^|\s)if\s/);
  if (start < 0) return null;
  const text = body.slice(start).replace(/^\s*if\s+/, '');
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (depth === 0 && c === ',') return text.slice(0, i).trim() || null;
    else if (depth === 0 && /^\s+in\s/.test(text.slice(i)))
      return text.slice(0, i).trim() || null;
  }
  return text.trim() || null;
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
  const ifClause = readIfClause(body);
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
  // Results go back to the map by row (hev_id) and, for census areas, GEOID.
  const mapKeys = variables.some((v) => v.name === 'geoid')
    ? 'hev_id geoid'
    : 'hev_id';

  let graphs = 0;
  let models = 0;
  out.push('', 'local hev_models', 'local hev_n = 0');
  // How the results table names a model's estimation and its outcome.
  const methodOf = (c) => {
    const options = c.line.split(',').slice(1).join(',');
    if (c.name === 'regress')
      return /vce\(\s*(robust|r|cluster)/.test(options)
        ? 'OLS regression (robust standard errors)'
        : 'OLS regression';
    if (c.name === 'spregress') {
      const lag = /dvarlag\(/.test(options);
      const error = /errorlag\(/.test(options);
      const kind =
        lag && error
          ? 'Spatial autoregressive model with spatial errors'
          : lag
            ? 'Spatial lag model'
            : error
              ? 'Spatial error model'
              : 'Spatial regression';
      return `${kind} (${/\bml\b/.test(options) ? 'maximum likelihood' : 'GS2SLS'})`;
    }
    return (
      {
        logit: 'Logistic regression',
        poisson: 'Poisson regression',
        nbreg: 'Negative binomial regression',
        spreg: 'Spatial regression',
      }[c.name] || c.name
    );
  };
  const outcomeOf = (c) => {
    const v = variables.find((x) => x.name === c.vars[0]);
    return labelText(v?.tableLabel || v?.label || c.vars[0] || '');
  };
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
        "  local hev_n = `hev_n' + 1",
        `  local hev_col\`hev_n' "(\`hev_n') ${methodOf(c)}"`,
        // For the map: each area's fitted value and residual.
        '  capture drop hev_fit hev_res',
        '  capture predict double hev_fit if e(sample)',
        "  capture generate double hev_res = `e(depvar)' - hev_fit if e(sample)",
        `  capture export delimited ${mapKeys} hev_fit hev_res using "${MAP_FILE_PREFIX}m${models}.csv" if e(sample), replace`,
        '  capture drop hev_fit hev_res',
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
  // One row per regressor across models: each model's main equation is
  // named after its dependent variable, so those are merged (W rows stay).
  const depvars = [
    ...new Set(
      commands
        .filter((c) => c.kind === 'model' && c.vars[0])
        .map((c) => c.vars[0]),
    ),
  ];
  // Outcomes of spatial lag models: their W row is the spatial lag.
  const spatialDepvars = [
    ...new Set(
      commands
        .filter((c) => c.name === 'spregress' && /dvarlag\(/.test(c.line))
        .map((c) => c.vars[0])
        .filter(Boolean),
    ),
  ];
  const eqrecode = depvars.length
    ? ` eqrecode(${depvars.map((d) => `${d} = xb`).join(' ')})`
    : '';
  // Title: the estimation, then the dependent variable.
  const modelCommands = commands.filter((c) => c.kind === 'model');
  const methods = [...new Set(modelCommands.map(methodOf))];
  const outcomes = [...new Set(modelCommands.map(outcomeOf))];
  // Titles and notes may run past a variable label's 80 characters.
  const tableText = (text) =>
    String(text ?? '')
      .replace(/["`$\\]/g, "'")
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 240);
  const tableTitle = tableText(
    `Table 1. ${methods.join('; ')}: ${outcomes.join(', ')}`,
  );
  // The PDF table is wide enough to keep the title on one line (a 65%-wide
  // table holds about 67 characters of the bold title).
  const pdfWidth = Math.min(100, Math.max(65, Math.ceil(tableTitle.length)));
  // One heading per model: the outcome for a single model, "(n) method"
  // when there are several (the outcome is in the title).
  const singleHeading = modelCommands.length === 1 ? outcomes[0] : null;
  // Notes, one per line: stars, standard errors, sources, spatial weights.
  const usedVars = new Set(modelCommands.flatMap((c) => c.vars));
  const sources = [
    ...new Set(
      variables
        .filter((v) => usedVars.has(v.name) && v.source)
        .map((v) => v.source),
    ),
  ];
  const contiguity = commands.find(
    (c) =>
      c.name === 'spmatrix' && /^spmatrix\s+create\s+contiguity/.test(c.line),
  );
  const weightsNote = modelCommands.some((c) => c.spatial)
    ? contiguity
      ? `Spatial weights: ${/\brook\b/.test(contiguity.line) ? 'rook' : 'queen'} contiguity, ${/normalize\(\s*row/.test(contiguity.line) ? 'row-standardized' : 'spectral normalization'}.`
      : userWeights
        ? null
        : 'Spatial weights: inverse distance (miles), on the areas with valid values.'
    : null;
  const tableNotes = [
    '*** p < .001, ** p < .01, * p < .05.',
    'Standard errors in parentheses.',
    sources.length ? `Data: ${sources.join('; ')}.` : null,
    weightsNote,
  ]
    .filter(Boolean)
    .map(tableText);
  if (models)
    out.push(
      '',
      '* The models that ran, side by side, as a publication table: estimation',
      '* and outcome in the title, variable labels, coefficients to 3 decimals',
      '* with stars, standard errors in parentheses, observations and fit, and',
      '* notes one per line. Saved for Word, LaTeX, PDF and Excel.',
      `if "\`hev_models'" != "" {`,
      ...variables
        .filter((v) => v.tableLabel && usedVars.has(v.name))
        .map(
          (v) =>
            `  capture label variable ${v.name} "${labelText(v.tableLabel)}"`,
        ),
      `  capture noisily etable, estimates(\`hev_models')${eqrecode} column(index) cstat(_r_b, nformat(%9.3f)) cstat(_r_se, nformat(%9.3f) sformat("(%s)")) cstat(_r_p) mstat(N, nformat(%12.0fc) label("Observations")) mstat(r2, nformat(%5.3f) label("R²")) mstat(r2_p, nformat(%5.3f) label("Pseudo R²")) mstat(ll, nformat(%12.1fc) label("Log likelihood")) title("${tableTitle}")`,
      '  if _rc == 0 {',
      '    capture collect stars _r_p 0.001 "***" 0.01 "**" 0.05 "*", attach(_r_b)',
      ...tableNotes.map((n) => `    capture collect notes "${n}"`),
      ...(singleHeading
        ? [
            `    capture collect label levels cmdset 1 "${singleHeading}", modify`,
          ]
        : [
            "    forvalues hev_i = 1/`hev_n' {",
            "      capture collect label levels cmdset `hev_i' \"`hev_col`hev_i''\", modify",
            '    }',
          ]),
      '    capture collect style header cmdset, level(label)',
      // The spatial lag row named as such; the residual variance left out
      // (moved off the row dimension, so the layout skips it).
      ...spatialDepvars.flatMap((d) => [
        `    capture collect recode colname ${d} = hev_rho, fortags(coleq[W])`,
        `    capture collect recode colname "var(e.${d})" = hev_sigma2`,
      ]),
      ...(spatialDepvars.length
        ? ['    capture collect remap colname[hev_sigma2] = hev_omitted']
        : []),
      '    capture collect label levels colname hev_rho "Spatial lag (ρ)" _cons "Constant", modify',
      '    capture collect layout (coleq#colname#result[_r_b _r_se] result[N r2 r2_p ll]) (cmdset#stars)',
      '    capture collect style header stars, level(hide)',
      '    capture collect style cell, font("Times New Roman", size(10))',
      '    capture collect style title, font("Times New Roman", size(11) bold)',
      '    capture collect style notes, font("Times New Roman", size(9))',
      '    capture collect style cell cell_type[column-header], halign(center)',
      '    capture collect style cell cell_type[item]#stars[value], halign(right)',
      '    capture collect style cell cell_type[item]#stars[label], halign(left)',
      '    capture collect style cell stars[label], margin(left, width(0))',
      '    capture collect style cell stars[value], margin(right, width(0))',
      `    capture collect style putpdf, width(${pdfWidth}%)`,
      '    capture collect style putdocx, layout(autofitcontents)',
      '    capture noisily collect export "results.docx", replace',
      '    capture noisily collect export "results.tex", tableonly replace',
      '    capture noisily collect export "results.pdf", replace',
      '    capture noisily collect export "results.xlsx", replace',
      '  }',
      '}',
    );
  // Variables the session made (egen), for the map too.
  const created = [...new Set(commands.map((c) => c.creates).filter(Boolean))];
  if (created.length)
    out.push(
      '',
      `capture export delimited ${mapKeys} ${created.join(' ')} using "${MAP_FILE_PREFIX}vars.csv", replace`,
    );
  out.push('', 'display as text "HEV_DONE"', '');
  return out.join('\n');
}

/**
 * Results the map can show, written by the do-file: map_m<k>.csv (hev_id —
 * the data.csv row — and geoid when the areas have one, then hev_fit and
 * hev_res for model k) and map_vars.csv (the same keys and the variables
 * egen made).
 */
export const MAP_FILE_PREFIX = 'map_';

/**
 * One geometry (JSON) per data.csv row, saved for layers whose areas are not
 * census tracts, counties or states, so their rows can be shown on the map.
 */
export const SESSION_SHAPES_FILE = 'shapes.geojsonl';

/** More areas than this are not saved as session shapes (too large). */
export const MAX_SESSION_SHAPES = 20000;

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
        !/^\s*(?:\.\s+|>\s*)?((?:capture )?label variable|capture collect|forvalues hev_|notes:|display as text "HEV_|capture which|local hev_|if `hev_|estimates store|if _rc|else \{|\}$|\d+\. |capture (?:drop hev_|predict double hev_|generate double hev_|export delimited hev_id))/.test(
          line,
        ) &&
        !/^HEV_(STEP|DONE)/.test(line.trim()) &&
        !/^\(?file map_\S+ saved/.test(line.trim()),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
