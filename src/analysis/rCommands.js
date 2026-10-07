/**
 * R analysis, the pure part shared by the panel, the voice assistant, the
 * server and the CLI: which R functions a typed line may call, checking a
 * line before R sees it, and the script each session runs. The dataset and
 * its variables are the same as for Stata (stataCommands.js); in R the data
 * frame is `d`.
 *
 * Safety: R runs any function it is given, so a typed line may only CALL the
 * functions listed here, and every bare name must be a data variable, an
 * object the session made, a listed function or a constant. That rules out
 * system(), eval(), file access and passing an unlisted function by name
 * (sapply(x, system)). No blocks, no ;, no backticks, no :: or <<-. Uploaded
 * R scripts are the user's own code and run as written; the server accepts
 * them only from this computer.
 */

/** Functions a typed line may call (and pass by name, e.g. FUN = mean). */
export const R_FUNCTIONS = Object.freeze(
  new Set([
    // describe
    'summary',
    'print',
    'head',
    'tail',
    'str',
    'nrow',
    'ncol',
    'names',
    'mean',
    'median',
    'sd',
    'var',
    'min',
    'max',
    'range',
    'quantile',
    'sum',
    'length',
    'unique',
    'sort',
    'order',
    'rank',
    'table',
    'prop.table',
    'xtabs',
    'ftable',
    'aggregate',
    'tapply',
    'sapply',
    'cor',
    'cov',
    'round',
    'signif',
    'cumsum',
    'diff',
    'is.na',
    'complete.cases',
    'which',
    // build values
    'c',
    'list',
    'seq',
    'rep',
    'ifelse',
    'factor',
    'relevel',
    'cut',
    'as.numeric',
    'as.factor',
    'as.character',
    'as.integer',
    'interaction',
    'exp',
    'log',
    'log10',
    'log2',
    'log1p',
    'sqrt',
    'abs',
    'scale',
    'I',
    'poly',
    'offset',
    'subset',
    'with',
    'droplevels',
    'paste',
    // models and tests
    'lm',
    'glm',
    'glm.nb',
    'anova',
    'AIC',
    'BIC',
    'logLik',
    'confint',
    'coef',
    'predict',
    'residuals',
    'resid',
    'fitted',
    'vcov',
    'nobs',
    'binomial',
    'poisson',
    'gaussian',
    'quasipoisson',
    'quasibinomial',
    'Gamma',
    't.test',
    'chisq.test',
    'wilcox.test',
    'cor.test',
    'shapiro.test',
    'kruskal.test',
    'aov',
    'TukeyHSD',
    // graphs (saved as PNG)
    'plot',
    'hist',
    'boxplot',
    'barplot',
    'abline',
    'lines',
    'points',
    'legend',
    'text',
    'title',
    // spatial (sf, spdep, spatialreg)
    'poly2nb',
    'nb2listw',
    'knearneigh',
    'knn2nb',
    'moran.test',
    'moran.plot',
    'localmoran',
    'geary.test',
    'lm.morantest',
    'lm.LMtests',
    'lagsarlm',
    'errorsarlm',
    'sacsarlm',
    'impacts',
  ]),
);

/** Spatial models: run on complete cases with matching weights. */
export const R_SPATIAL_MODELS = Object.freeze(
  new Set([
    'lagsarlm',
    'errorsarlm',
    'sacsarlm',
    'moran.test',
    'geary.test',
    'localmoran',
    'lm.morantest',
    'lm.LMtests',
    'moran.plot',
  ]),
);
const GRAPH_START = new Set([
  'plot',
  'hist',
  'boxplot',
  'barplot',
  'moran.plot',
]);
const GRAPH_ADD = new Set([
  'abline',
  'lines',
  'points',
  'legend',
  'text',
  'title',
]);
const MODEL_FUNCTIONS = new Set([
  'lm',
  'glm',
  'glm.nb',
  'aov',
  'lagsarlm',
  'errorsarlm',
  'sacsarlm',
]);
const CONSTANTS = new Set([
  'TRUE',
  'FALSE',
  'NA',
  'NULL',
  'Inf',
  'NaN',
  'pi',
  'T',
  'F',
  '.',
]);
/** Objects every session provides: the data, and contiguity weights. */
export const R_PROVIDED = Object.freeze(['d', 'W', 'nb', 'areas']);
const INFIX = new Set(['%in%', '%%', '%/%']);

export const MAX_R_LINES = 20;
export const MAX_R_LINE_LENGTH = 600;
export const MAX_R_SCRIPT_BYTES = 256 * 1024;

const TOKEN =
  /"[^"\\]*"|'[^'\\]*'|\d+\.?\d*(?:[eE][+-]?\d+)?L?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z.][A-Za-z0-9._]*|<<-|->>|->|<-|:::|::|==|!=|<=|>=|&&|\|\||%[^%\s]*%|\s+|\S/g;
const IDENT = /^[A-Za-z.][A-Za-z0-9._]*$/;
const NUMBER = /^(\d|\.\d)/;
const ALLOWED_SYMBOLS = /^[+\-*/^~<>=!&|()[\],$:]$/;

/** Split a line into tokens, without whitespace. Null if a string is open. */
function tokenize(line) {
  const tokens = [];
  for (const m of line.matchAll(TOKEN)) {
    if (/^\s+$/.test(m[0])) continue;
    tokens.push(m[0]);
  }
  return tokens.join('').length === line.replace(/\s+/g, '').length
    ? tokens
    : null;
}

/**
 * Check one R line. `known` holds data variables and objects made so far.
 * Returns {ok, line, error, creates, calls, vars, spatial, graph, model}.
 */
export function checkRLine(raw, known = new Set(), dataVars = known) {
  let line = String(raw ?? '').trim();
  const fail = (error) => ({ ok: false, line, error });
  if (!line) return fail('The line is empty.');
  if (line.length > MAX_R_LINE_LENGTH)
    return fail(`A line may be at most ${MAX_R_LINE_LENGTH} characters.`);
  if (/[\r\n;`\\{}@#?]/.test(line.replace(/"[^"]*"|'[^']*'/g, '""')))
    return fail(
      'A line may not contain ; ` \\ { } @ # or ? — use an uploaded R script for anything beyond one expression.',
    );
  const tokens = tokenize(line);
  if (!tokens) return fail('A quoted string is not closed.');
  const calls = [];
  const vars = new Set();
  let creates = null;
  let column = null;
  // Assignment: name <- …, name = … (made <-), or d$name <- … (a new column).
  if (IDENT.test(tokens[0]) && (tokens[1] === '<-' || tokens[1] === '=')) {
    if (
      R_PROVIDED.includes(tokens[0]) ||
      R_FUNCTIONS.has(tokens[0]) ||
      CONSTANTS.has(tokens[0])
    )
      return fail(`${tokens[0]} is taken; choose another name.`);
    creates = tokens[0];
    if (tokens[1] === '=') {
      tokens[1] = '<-';
      line = line.replace(/^([A-Za-z.][A-Za-z0-9._]*)\s*=/, '$1 <-');
    }
  } else if (
    tokens[0] === 'd' &&
    tokens[1] === '$' &&
    IDENT.test(tokens[2] || '') &&
    tokens[3] === '<-'
  ) {
    column = tokens[2];
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.startsWith('"') || t.startsWith("'") || NUMBER.test(t)) continue;
    if (t === '<-' && (i === 1 || (column && i === 3))) continue;
    if (['<<-', '->>', '->', '::', ':::', '<-'].includes(t))
      return fail(`“${t}” is not allowed in a line; use an uploaded R script.`);
    if (t.startsWith('%')) {
      if (!INFIX.has(t))
        return fail(`The operator ${t} is not allowed in a line.`);
      continue;
    }
    if (!IDENT.test(t)) {
      if (
        !ALLOWED_SYMBOLS.test(t) &&
        !['==', '!=', '<=', '>=', '&&', '||'].includes(t)
      )
        return fail(`“${t}” is not allowed in a line.`);
      continue;
    }
    const next = tokens[i + 1];
    const previous = tokens[i - 1];
    if (next === '(') {
      if (!R_FUNCTIONS.has(t))
        return fail(
          `${t}() is not one of the functions a typed line may call. Use an uploaded R script for it.`,
        );
      calls.push(t);
      continue;
    }
    if (previous === '$') {
      if (dataVars.has(t)) vars.add(t);
      continue;
    }
    if (next === '=' && i > 1) continue; // an argument name
    if (i === 0 && creates) continue;
    if (dataVars.has(t)) {
      vars.add(t);
      continue;
    }
    if (
      known.has(t) ||
      R_PROVIDED.includes(t) ||
      CONSTANTS.has(t) ||
      R_FUNCTIONS.has(t)
    )
      continue;
    return fail(
      `Not in this session: ${t}. The data frame is d; its variables are ${[...dataVars].join(', ')}.`,
    );
  }
  const spatial = calls.some((c) => R_SPATIAL_MODELS.has(c));
  return {
    ok: true,
    line,
    creates,
    column,
    calls,
    vars: [...vars],
    spatial,
    needsShapes:
      spatial ||
      calls.includes('poly2nb') ||
      tokens.some((t) => t === 'W' || t === 'nb' || t === 'areas'),
    graph: calls.some((c) => GRAPH_START.has(c))
      ? 'start'
      : calls.some((c) => GRAPH_ADD.has(c))
        ? 'add'
        : null,
    model: calls.some((c) => MODEL_FUNCTIONS.has(c)),
  };
}

/** Check every line of a session, in order (objects made count for later lines). */
export function checkRLines(lines, variables) {
  const dataVars = new Set(variables.map((v) => v.name));
  const known = new Set(dataVars);
  const checked = [];
  const problems = [];
  const list = (
    Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/)
  )
    .map((l) => String(l).trim())
    .filter(Boolean);
  if (list.length > MAX_R_LINES)
    problems.push(`At most ${MAX_R_LINES} lines per run.`);
  for (const [i, raw] of list.slice(0, MAX_R_LINES).entries()) {
    const result = checkRLine(raw, known, dataVars);
    if (!result.ok) {
      problems.push(`Line ${i + 1}: ${result.error}`);
      continue;
    }
    if (result.creates) known.add(result.creates);
    if (result.column) {
      known.add(result.column);
      dataVars.add(result.column);
    }
    checked.push(result);
  }
  return { ok: problems.length === 0, commands: checked, problems };
}

const rString = (text) => JSON.stringify(String(text));
const label = (text) =>
  String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 80);

/** Lines that load the session's data as `d`, with labels, and save data.rds. */
function loadData(variables, folder) {
  const strings = variables
    .filter((v) => v.kind === 'string')
    .map((v) => v.name);
  return [
    ...(folder && !/["\\]/.test(folder.replace(/\\/g, '/'))
      ? [`setwd(${rString(folder.replace(/\\/g, '/'))})`]
      : []),
    `d <- read.csv("data.csv", colClasses = c(${strings.map((s) => `${s} = "character"`).join(', ')}), stringsAsFactors = FALSE, na.strings = "", check.names = FALSE)`,
    `hev_labels <- c(${variables.map((v) => `${v.name} = ${rString(label(v.label))}`).join(', ')})`,
    'for (hev_n in names(hev_labels)) if (!is.null(d[[hev_n]])) attr(d[[hev_n]], "label") <- hev_labels[[hev_n]]',
    'saveRDS(d, "data.rds")',
  ];
}

/**
 * Contiguity weights from the session shapefile, when sf and spdep exist.
 * Neighbors come from planar geometry (as Stata's do): the map's simplified
 * outlines can cross themselves slightly, which spherical (s2) checks
 * reject. A failure here is reported and the rest of the script still runs.
 */
const SPATIAL_SETUP = [
  'hev_spatial <- requireNamespace("sf", quietly = TRUE) && requireNamespace("spdep", quietly = TRUE)',
  'if (hev_spatial) {',
  '  suppressPackageStartupMessages(library(spdep))',
  '  if (requireNamespace("spatialreg", quietly = TRUE)) suppressPackageStartupMessages(library(spatialreg))',
  '  tryCatch({',
  '    invisible(sf::sf_use_s2(FALSE))',
  '    areas <- sf::st_read("areas.shp", quiet = TRUE)',
  '    nb <- spdep::poly2nb(areas, queen = TRUE)',
  '    W <- spdep::nb2listw(nb, style = "W", zero.policy = TRUE)',
  '    cat("Contiguity weights W (queen, row-standardized) and neighbors nb are ready.\\n")',
  '  }, error = function(e) message("Contiguity weights could not be built: ", conditionMessage(e)))',
  '} else {',
  '  message("Spatial functions need the sf and spdep packages (and spatialreg for lagsarlm): install.packages(c(\\"sf\\", \\"spdep\\", \\"spatialreg\\"))")',
  '}',
];

/**
 * The session's R script. Each line runs in tryCatch, so one error does not
 * stop the rest; each prints a HEV_STEP marker the server reads back.
 */
export function buildRScript({
  title,
  variables,
  commands = [],
  userScript = null,
  needsShapes = false,
  folder = null,
  interactive = false,
}) {
  const out = [
    `# ${label(title)}`,
    '# Written by Husky Eye View. Runs on R 4.x; the data frame is d.',
    'options(width = 120, warn = 1)',
    ...loadData(variables, folder),
    'suppressPackageStartupMessages(library(MASS))',
  ];
  if (needsShapes || interactive) out.push('', ...SPATIAL_SETUP);
  if (interactive) {
    out.push(
      '',
      'sink("session.log", split = TRUE)',
      '.Last <- function() {',
      '  try(savehistory("session_commands.R"), silent = TRUE)',
      '  try(sink(), silent = TRUE)',
      '}',
      `cat(${rString(label(title))}, "\\nThe data frame is d (", nrow(d), " rows). Output is saved in session.log; your commands go to session_commands.R when R closes.\\n")`,
    );
    return out.join('\n') + '\n';
  }
  out.push('', 'cat("HEV_BEGIN\\n")');
  let graphs = 0;
  commands.forEach((c, i) => {
    const n = i + 1;
    out.push('', `cat("\\n> ", ${rString(c.line)}, "\\n", sep = "")`);
    if (c.graph === 'start') {
      graphs += 1;
      out.push(
        'if (dev.cur() > 1) invisible(dev.off())',
        `png("graph${graphs}.png", width = 1600, height = 1200, res = 200)`,
      );
    }
    const run = (expr) =>
      `hev_rc <- tryCatch({ hev_v <- withVisible(${expr}); if (hev_v$visible) print(hev_v$value); 0L }, error = function(e) { message("Error: ", conditionMessage(e)); 1L })`;
    if (c.spatial) {
      out.push(
        ...(c.vars.length
          ? [
              `hev_keep <- stats::complete.cases(d[, c(${c.vars.map(rString).join(', ')}), drop = FALSE])`,
            ]
          : ['hev_keep <- rep(TRUE, nrow(d))']),
        'hev_env <- new.env(parent = globalenv())',
        'hev_env$d <- d[hev_keep, , drop = FALSE]',
        'if (exists("W")) hev_env$W <- spdep::subset.listw(W, hev_keep, zero.policy = TRUE)',
        run(`eval(quote(${c.line}), hev_env)`),
        'for (hev_n in setdiff(ls(hev_env), c("d", "W"))) assign(hev_n, get(hev_n, envir = hev_env), envir = globalenv())',
      );
    } else {
      out.push(run(c.line));
    }
    out.push(`cat("HEV_STEP ${n} rc=", hev_rc, "\\n", sep = "")`);
    const nextIsAdd = commands[i + 1]?.graph === 'add';
    if (c.graph && !nextIsAdd)
      out.push('if (dev.cur() > 1) invisible(dev.off())');
  });
  if (userScript) {
    const n = commands.length + 1;
    out.push(
      '',
      `cat("\\n> source(\\"${userScript}\\")\\n")`,
      `hev_rc <- tryCatch({ source(${rString(userScript)}, echo = TRUE, max.deparse.length = Inf); 0L }, error = function(e) { message("Error: ", conditionMessage(e)); 1L })`,
      `cat("HEV_STEP ${n} rc=", hev_rc, "\\n", sep = "")`,
      'while (dev.cur() > 1) invisible(dev.off())',
    );
  }
  out.push('', 'save.image("session.RData")', 'cat("HEV_DONE\\n")', '');
  return out.join('\n');
}

/** The log from the first line on, without the markers (panel and voice). */
export function readableRLog(log) {
  const text = String(log || '');
  const at = text.indexOf('HEV_BEGIN');
  return (at >= 0 ? text.slice(at + 'HEV_BEGIN'.length) : '')
    .split(/\r?\n/)
    .filter((line) => !/^HEV_(STEP|DONE)/.test(line.trim()))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n');
}
