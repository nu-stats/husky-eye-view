/**
 * SPSS analysis, the pure part shared by the panel, the voice assistant, the
 * server and the CLI: which SPSS commands a typed line may run, checking a
 * line before SPSS sees it, and the syntax file (analysis.sps) each session
 * runs. The dataset and its variables are the same as for Stata and R
 * (stataCommands.js).
 *
 * Safety: a typed line is one command from the list below. It may not read
 * or write files (OUTFILE, FILE, GET, SAVE, INSERT…), run programs (HOST,
 * BEGIN PROGRAM, SCRIPT), define macros (DEFINE, !) or end itself early (a
 * period inside the line would start a second command). Uploaded syntax
 * files are the user's own code and run as written; the server accepts them
 * only from this computer.
 */
import { MAP_FILE_PREFIX } from './stataCommands.js';

/**
 * Commands a line may start with: spelling → {name, kind}. Longer spellings
 * are matched first ("LOGISTIC REGRESSION" before "LOGISTIC").
 */
export const SPSS_COMMANDS = Object.freeze({
  REGRESSION: { name: 'REGRESSION', kind: 'model' },
  REGR: { name: 'REGRESSION', kind: 'model' },
  'LOGISTIC REGRESSION': { name: 'LOGISTIC REGRESSION', kind: 'model' },
  LOGISTIC: { name: 'LOGISTIC REGRESSION', kind: 'model' },
  GENLIN: { name: 'GENLIN', kind: 'model' },
  UNIANOVA: { name: 'UNIANOVA', kind: 'model' },
  GLM: { name: 'GLM', kind: 'model' },
  DESCRIPTIVES: { name: 'DESCRIPTIVES', kind: 'describe' },
  DESC: { name: 'DESCRIPTIVES', kind: 'describe' },
  FREQUENCIES: { name: 'FREQUENCIES', kind: 'describe' },
  FREQ: { name: 'FREQUENCIES', kind: 'describe' },
  CORRELATIONS: { name: 'CORRELATIONS', kind: 'describe' },
  CORR: { name: 'CORRELATIONS', kind: 'describe' },
  'NONPAR CORR': { name: 'NONPAR CORR', kind: 'describe' },
  'PARTIAL CORR': { name: 'PARTIAL CORR', kind: 'describe' },
  CROSSTABS: { name: 'CROSSTABS', kind: 'describe' },
  MEANS: { name: 'MEANS', kind: 'describe' },
  EXAMINE: { name: 'EXAMINE', kind: 'describe' },
  SUMMARIZE: { name: 'SUMMARIZE', kind: 'describe' },
  'T-TEST': { name: 'T-TEST', kind: 'test' },
  ONEWAY: { name: 'ONEWAY', kind: 'test' },
  'NPAR TESTS': { name: 'NPAR TESTS', kind: 'test' },
  FACTOR: { name: 'FACTOR', kind: 'test' },
  RELIABILITY: { name: 'RELIABILITY', kind: 'test' },
  GRAPH: { name: 'GRAPH', kind: 'graph' },
  COMPUTE: { name: 'COMPUTE', kind: 'generate' },
  RECODE: { name: 'RECODE', kind: 'generate' },
  IF: { name: 'IF', kind: 'generate' },
  RANK: { name: 'RANK', kind: 'generate' },
  'SELECT IF': { name: 'SELECT IF', kind: 'transform' },
  TEMPORARY: { name: 'TEMPORARY', kind: 'transform' },
  EXECUTE: { name: 'EXECUTE', kind: 'transform' },
  'SORT CASES': { name: 'SORT CASES', kind: 'transform' },
  FILTER: { name: 'FILTER', kind: 'transform' },
  'SPLIT FILE': { name: 'SPLIT FILE', kind: 'transform' },
  WEIGHT: { name: 'WEIGHT', kind: 'transform' },
  'VARIABLE LABELS': { name: 'VARIABLE LABELS', kind: 'transform' },
  'VALUE LABELS': { name: 'VALUE LABELS', kind: 'transform' },
  'MISSING VALUES': { name: 'MISSING VALUES', kind: 'transform' },
  FORMATS: { name: 'FORMATS', kind: 'transform' },
});

/** The commands as offered to people (one spelling each). */
export const SPSS_COMMAND_NAMES = Object.freeze([
  ...new Set(Object.values(SPSS_COMMANDS).map((c) => c.name)),
]);

const SPELLINGS = Object.keys(SPSS_COMMANDS).sort(
  (a, b) => b.length - a.length,
);

export const MAX_SPSS_LINES = 20;
export const MAX_SPSS_LINE_LENGTH = 600;
export const MAX_SPSS_SYNTAX_BYTES = 256 * 1024;

// Words that read or write files, run programs or change SPSS itself,
// wherever they appear outside quotes. SPLIT FILE is allowed (see below).
const BLOCKED_WORDS =
  /\b(outfile|file|host|insert|include|program|python\d*|script|erase|matrix|define|write|xsave|save\s+translate|oms|omsend|output|get|cd|permissions|set|show|dataset|export|import|translate|journal|preserve|restore|extension|spssinc|stats|cache|new|begin|end|exit|finish|xmlfile)\b/i;

/** SPSS words that cannot name a variable. */
const RESERVED = new Set([
  'ALL',
  'AND',
  'BY',
  'EQ',
  'GE',
  'GT',
  'LE',
  'LT',
  'NE',
  'NOT',
  'OR',
  'TO',
  'WITH',
]);

/** A variable name SPSS accepts (the dataset's names already almost all are). */
export function spssName(name) {
  let out = String(name).replace(/[^A-Za-z0-9_.]/g, '_');
  if (!/^[A-Za-z]/.test(out)) out = `v${out}`;
  if (RESERVED.has(out.toUpperCase())) out = `${out}_`;
  return out.slice(0, 64);
}

/** Split a line into quoted strings ('…' or "…") and everything else. */
function splitQuoted(line) {
  const parts = [];
  let rest = line;
  while (rest.length) {
    const at = rest.search(/['"]/);
    if (at < 0) {
      parts.push({ text: rest, quoted: false });
      break;
    }
    if (at > 0) parts.push({ text: rest.slice(0, at), quoted: false });
    const quote = rest[at];
    const end = rest.indexOf(quote, at + 1);
    if (end < 0) return null; // unbalanced
    parts.push({ text: rest.slice(at + 1, end), quoted: true });
    rest = rest.slice(end + 1);
  }
  return parts;
}

const IDENT = /[A-Za-z#@$][A-Za-z0-9_.#@$]*/g;

/**
 * Check one SPSS command line. `known` is the set of variable names in the
 * dataset so far (COMPUTE, RECODE INTO, RANK INTO and DESCRIPTIVES /SAVE add
 * to it). Returns {ok, line, name, kind, vars, creates, error, saveFit}.
 */
export function checkSpssLine(raw, known = new Set()) {
  const line = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*\.$/, '');
  const fail = (error) => ({ ok: false, line, error });
  if (!line) return fail('The line is empty.');
  if (line.length > MAX_SPSS_LINE_LENGTH)
    return fail(`A line may be at most ${MAX_SPSS_LINE_LENGTH} characters.`);
  if (/[\r\n;`\\{}!]/.test(line))
    return fail(
      'A line may not contain ; ` \\ { } or ! — use a syntax file for anything beyond one command.',
    );
  const parts = splitQuoted(line);
  if (!parts) return fail('A quoted string is not closed.');
  const bare = parts
    .filter((p) => !p.quoted)
    .map((p) => p.text)
    .join(' ');
  // A period followed by a space ends a command in SPSS: one command a line.
  if (/\.(\s|$)/.test(bare))
    return fail(
      'One command per line: a period inside the line would end it early.',
    );
  const blocked = bare
    .replace(/\bsplit\s+file\b/gi, 'split_')
    .match(BLOCKED_WORDS);
  if (blocked)
    return fail(
      `“${blocked[0]}” is not allowed in a line (it reads or writes files, or changes SPSS itself); use a syntax file.`,
    );
  const upper = line.toUpperCase();
  const spelling = SPELLINGS.find(
    (s) =>
      upper === s || upper.startsWith(`${s} `) || upper.startsWith(`${s}/`),
  );
  if (!spelling)
    return fail(
      `“${line.split(/[\s/]/)[0]}” is not one of the commands this app runs: ${SPSS_COMMAND_NAMES.join(', ')}. Use a syntax file for others.`,
    );
  const spec = SPSS_COMMANDS[spelling];
  const body = line.slice(spelling.length).trim();
  const lowerKnown = new Map([...known].map((v) => [v.toLowerCase(), v]));
  const vars = [
    ...new Set(
      (bare.slice(spelling.length).match(IDENT) || [])
        .map((t) => lowerKnown.get(t.toLowerCase()))
        .filter(Boolean),
    ),
  ];
  // New variables: COMPUTE x = …, IF (…) x = …, RECODE … INTO a b,
  // RANK … /RANK INTO r, DESCRIPTIVES x (zx) /SAVE.
  const creates = [];
  const newVar = (name) => {
    if (!name || lowerKnown.has(name.toLowerCase())) return;
    if (
      !/^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(name) ||
      RESERVED.has(name.toUpperCase())
    )
      return;
    creates.push(name);
  };
  if (spec.name === 'COMPUTE') {
    const m = body.match(/^([A-Za-z][A-Za-z0-9_.]*)\s*=/);
    if (!m) return fail('COMPUTE needs: COMPUTE newvar = expression.');
    newVar(m[1]);
  } else if (spec.name === 'IF') {
    const m = body.match(/\)\s*([A-Za-z][A-Za-z0-9_.]*)\s*=/);
    if (!m) return fail('IF needs: IF (condition) var = expression.');
    newVar(m[1]);
  } else if (spec.name === 'RECODE' || spec.name === 'RANK') {
    for (const m of body.matchAll(/\bINTO\s+([A-Za-z0-9_.\s]+?)(?=\/|\(|$)/gi))
      m[1].trim().split(/\s+/).forEach(newVar);
  } else if (spec.name === 'DESCRIPTIVES' && /\/\s*SAVE\b/i.test(body)) {
    for (const m of body.matchAll(
      /([A-Za-z][A-Za-z0-9_.]*)\s*\(\s*([A-Za-z][A-Za-z0-9_.]*)\s*\)/g,
    ))
      if (lowerKnown.has(m[1].toLowerCase())) newVar(m[2]);
  }
  // A linear regression with one dependent variable can send its fitted
  // values and residuals to the map (the syntax adds /SAVE for it).
  const dependent = body.match(/\/\s*DEPENDENT\s*=?\s*([^/]+)/i)?.[1].trim();
  const saveFit =
    spec.name === 'REGRESSION' &&
    !/\/\s*SAVE\b/i.test(body) &&
    Boolean(dependent) &&
    !/\s|\bTO\b/i.test(dependent);
  return {
    ok: true,
    line: body ? `${spelling} ${body}` : spelling,
    name: spec.name,
    kind: spec.kind,
    vars,
    creates,
    saveFit,
  };
}

/** Check every line of a session, in order (new variables count for later lines). */
export function checkSpssLines(lines, variables) {
  const known = new Set(variables.map((v) => v.name));
  const checked = [];
  const problems = [];
  const list = (
    Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/)
  )
    .map((l) => String(l).trim())
    .filter((l) => l && !/^\*/.test(l));
  if (list.length > MAX_SPSS_LINES)
    problems.push(`At most ${MAX_SPSS_LINES} command lines per run.`);
  for (const [i, raw] of list.slice(0, MAX_SPSS_LINES).entries()) {
    const result = checkSpssLine(raw, known);
    if (!result.ok) {
      problems.push(`Line ${i + 1}: ${result.error}`);
      continue;
    }
    for (const name of result.creates) known.add(name);
    checked.push(result);
  }
  return { ok: problems.length === 0, commands: checked, problems };
}

/** Is this the line of a model (for the map's model numbering)? */
export function isSpssModelLine(line) {
  const upper = String(line || '')
    .trim()
    .toUpperCase();
  const spelling = SPELLINGS.find(
    (s) =>
      upper === s || upper.startsWith(`${s} `) || upper.startsWith(`${s}/`),
  );
  return spelling ? SPSS_COMMANDS[spelling].kind === 'model' : false;
}

/** A 'single-quoted' SPSS string. */
const quote = (text) => `'${String(text ?? '').replace(/'/g, "''")}'`;
const label = (text) =>
  String(text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 120);
const joinPath = (folder, name) =>
  folder
    ? `${folder.replace(/[\\/]+$/, '')}${folder.includes('\\') ? '\\' : '/'}${name}`
    : name;

const UTF8 = new TextEncoder();

/** The marker line that starts each block of analysis.sps (run_spss.py splits on it). */
export const SPSS_BLOCK_MARK = '* HEV_BLOCK';

/**
 * Input and display formats from the data: strings as wide as their longest
 * value, numbers with as many decimals as they have (up to 6).
 */
function formatsFor(variables, rows = []) {
  return variables.map((v, i) => {
    const values = rows
      .map((r) => r[i])
      .filter((x) => x !== null && x !== undefined && x !== '');
    if (v.kind === 'string') {
      const width = Math.min(
        32767,
        Math.max(1, ...values.map((x) => UTF8.encode(String(x)).length)),
      );
      return { input: `A${width}`, display: null };
    }
    let decimals = 0;
    let digits = 1;
    for (const x of values) {
      const n = Number(x);
      if (!Number.isFinite(n)) continue;
      const text = String(Math.abs(n));
      const [whole, frac = ''] = text.includes('e')
        ? [text, '000000']
        : text.split('.');
      decimals = Math.max(decimals, Math.min(6, frac.length));
      digits = Math.max(digits, text.includes('e') ? 1 : whole.length);
    }
    const width = Math.min(40, digits + decimals + (decimals ? 2 : 1));
    return { input: 'F40.0', display: `F${Math.max(width, 3)}.${decimals}` };
  });
}

/** The syntax that loads data.csv with labels and saves data.sav. */
function loadData(variables, rows, folder) {
  const names = variables.map((v) => spssName(v.name));
  const formats = formatsFor(variables, rows);
  const numeric = variables
    .map((v, i) =>
      formats[i].display ? `${names[i]} (${formats[i].display})` : null,
    )
    .filter(Boolean);
  return [
    'GET DATA',
    '  /TYPE=TXT',
    `  /FILE=${quote(joinPath(folder, 'data.csv'))}`,
    "  /ENCODING='UTF8'",
    '  /DELCASE=LINE',
    '  /DELIMITERS=","',
    `  /QUALIFIER='"'`,
    '  /ARRANGEMENT=DELIMITED',
    '  /FIRSTCASE=2',
    '  /VARIABLES=',
    ...names.map((name, i) => `    ${name} ${formats[i].input}`),
    '.',
    ...(numeric.length ? [`FORMATS ${numeric.join(' ')}.`] : []),
    'VARIABLE LABELS',
    ...variables.map(
      (v, i) =>
        `  ${i ? '/' : ''}${names[i]} ${quote(label(v.label || v.name))}`,
    ),
    '.',
    // Results go back to the map by row (hev_id), as in Stata.
    'COMPUTE hev_id = $CASENUM.',
    'FORMATS hev_id (F8.0).',
    "VARIABLE LABELS hev_id 'Row of data.csv'.",
    'EXECUTE.',
    `SAVE OUTFILE=${quote(joinPath(folder, 'data.sav'))}.`,
  ];
}

/**
 * The session's syntax (analysis.sps), in blocks run_spss.py submits one at
 * a time: load, one per line, the uploaded syntax, then the results for the
 * map. Opened in SPSS and run with Run ▸ All it repeats the whole analysis.
 * With `interactive`, open.sps: the data and a session log only.
 */
export function buildSpssSyntax({
  title,
  variables,
  rows = [],
  commands = [],
  userSyntax = null,
  folder = null,
  interactive = false,
}) {
  const out = [
    `* ${label(title).replace(/\./g, ',')}.`,
    '* Written by Husky Eye View for IBM SPSS Statistics. Run ▸ All repeats the analysis.',
    `${SPSS_BLOCK_MARK} load.`,
    ...loadData(variables, rows, folder),
  ];
  if (interactive) {
    out.push(
      '',
      '* Everything SPSS shows from here on is also saved as session.log (text).',
      `OMS /SELECT ALL /EXCEPTIF SUBTYPES=['Notes'] /DESTINATION FORMAT=TEXT OUTFILE=${quote(joinPath(folder, 'session.log'))} /TAG='hev_session'.`,
      `TITLE ${quote(label(title))}.`,
      '',
    );
    return out.join('\n');
  }
  const hasGeoid = variables.some((v) => v.name === 'geoid');
  const keys = hasGeoid ? 'hev_id geoid' : 'hev_id';
  const exports = [];
  const created = [];
  let models = 0;
  commands.forEach((c, i) => {
    let text = c.line;
    if (c.kind === 'model') {
      models += 1;
      if (c.saveFit) {
        text += ` /SAVE PRED(hev_fit${models}) RESID(hev_res${models})`;
        exports.push([
          'TEMPORARY.',
          `SELECT IF NOT MISSING(hev_res${models}).`,
          `SAVE TRANSLATE OUTFILE=${quote(joinPath(folder, `${MAP_FILE_PREFIX}m${models}.csv`))} /TYPE=CSV /ENCODING='UTF8' /REPLACE /FIELDNAMES /CELLS=VALUES /KEEP=${keys} hev_fit${models} hev_res${models} /RENAME=(hev_fit${models} hev_res${models} = hev_fit hev_res).`,
        ]);
      }
    }
    created.push(...(c.creates || []));
    out.push('', `${SPSS_BLOCK_MARK} step ${i + 1}.`, `${text}.`);
  });
  if (userSyntax)
    out.push(
      '',
      `${SPSS_BLOCK_MARK} step ${commands.length + 1}.`,
      `INSERT FILE=${quote(joinPath(folder, userSyntax))} SYNTAX=INTERACTIVE ERROR=CONTINUE ENCODING='UTF8'.`,
    );
  if (created.length)
    exports.push([
      `SAVE TRANSLATE OUTFILE=${quote(joinPath(folder, `${MAP_FILE_PREFIX}vars.csv`))} /TYPE=CSV /ENCODING='UTF8' /REPLACE /FIELDNAMES /CELLS=VALUES /KEEP=${keys} ${created.join(' ')}.`,
    ]);
  // For the map: each model's fitted values and residuals, and the new
  // variables, one block each (a model that failed skips only its own).
  exports.forEach((block, k) =>
    out.push('', `${SPSS_BLOCK_MARK} results ${k + 1}.`, ...block),
  );
  out.push('');
  return out.join('\n');
}

/** The log from the first step on, without the markers (panel and voice). */
export function readableSpssLog(log) {
  const text = String(log || '');
  const at = text.indexOf('HEV_BEGIN');
  return (at >= 0 ? text.slice(at + 'HEV_BEGIN'.length) : '')
    .split(/\r?\n/)
    .filter((line) => !/^HEV_(STEP|DONE|LOAD)/.test(line.trim()))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n');
}
