/**
 * Excel Analysis, the pure part shared by the panel, the voice assistant,
 * the server and the CLI: the commands a line may give (modeled on Excel's
 * Analysis ToolPak), checking them, and turning a session into a workbook —
 * one sheet per command, with live Excel formulas (AVERAGE, CORREL, LINEST,
 * COUNTIFS…) and native charts — plus the text log the panel shows and the
 * residuals the map shows. No Excel is needed to build it; Excel only to
 * open it. The statistics are computed here too, so the log and the cached
 * cell values match what Excel recalculates.
 *
 * Commands (one per line, any case; IF … limits the rows):
 *   DESCRIPTIVE a b c                     summary statistics
 *   CORRELATION a b c                     correlation matrix
 *   REGRESSION y ON x1 x2                 least squares, as the ToolPak shows it, plus LINEST
 *   HISTOGRAM x [BINS n]                  frequency table and column chart
 *   SCATTER y x                           scatter chart with a trendline
 *   FREQUENCY x                           counts of each value
 *   AVERAGE|MEDIAN|SUM y BY group         a value per group
 *   STANDARDIZE a b · RANK a b            new columns z_a, rank_a (shown on the map)
 *   =CORREL(a, b) · =AVERAGE(a) …         one Excel formula
 * Each may end with: IF a > 5 AND b <= 10
 */
import { MAP_FILE_PREFIX } from './stataCommands.js';
import { rangeRef, safeSheetName } from './excelWorkbook.js';

export const MAX_EXCEL_LINES = 20;
export const MAX_EXCEL_LINE_LENGTH = 600;
export const MAX_EXCEL_FILE_BYTES = 64 * 1024;

/** Command words → command (several spellings each). */
const SPELLINGS = [
  ['DESCRIPTIVE STATISTICS', 'DESCRIPTIVE'],
  ['DESCRIPTIVES', 'DESCRIPTIVE'],
  ['DESCRIPTIVE', 'DESCRIPTIVE'],
  ['DESCRIBE', 'DESCRIPTIVE'],
  ['SUMMARY', 'DESCRIPTIVE'],
  ['CORRELATIONS', 'CORRELATION'],
  ['CORRELATION', 'CORRELATION'],
  ['REGRESSION', 'REGRESSION'],
  ['REGRESS', 'REGRESSION'],
  ['HISTOGRAM', 'HISTOGRAM'],
  ['SCATTER', 'SCATTER'],
  ['FREQUENCIES', 'FREQUENCY'],
  ['FREQUENCY', 'FREQUENCY'],
  ['AVERAGE', 'GROUP'],
  ['MEDIAN', 'GROUP'],
  ['SUM', 'GROUP'],
  ['STANDARDIZE', 'STANDARDIZE'],
  ['RANK', 'RANK'],
];

/** The commands as offered to people. */
export const EXCEL_COMMAND_NAMES = Object.freeze([
  'DESCRIPTIVE',
  'CORRELATION',
  'REGRESSION … ON …',
  'HISTOGRAM',
  'SCATTER',
  'FREQUENCY',
  'AVERAGE / MEDIAN / SUM … BY …',
  'STANDARDIZE',
  'RANK',
  '=FORMULA(…)',
]);

/** Excel functions a formula line may use, with how to compute each here. */
const FORMULAS = {
  AVERAGE: { args: 'vars', f: (vs) => mean(vs[0]) },
  MEDIAN: { args: 'vars', f: (vs) => quantile(vs[0], 0.5) },
  'STDEV.S': { args: 'vars', f: (vs) => sd(vs[0]) },
  STDEV: { args: 'vars', f: (vs) => sd(vs[0]) },
  'VAR.S': { args: 'vars', f: (vs) => variance(vs[0]) },
  VAR: { args: 'vars', f: (vs) => variance(vs[0]) },
  MIN: { args: 'vars', f: (vs) => Math.min(...vs[0]) },
  MAX: { args: 'vars', f: (vs) => Math.max(...vs[0]) },
  SUM: { args: 'vars', f: (vs) => vs[0].reduce((a, b) => a + b, 0) },
  COUNT: { args: 'vars', f: (vs) => vs[0].length },
  KURT: { args: 'vars', f: (vs) => kurtosis(vs[0]) },
  SKEW: { args: 'vars', f: (vs) => skewness(vs[0]) },
  CORREL: { args: 'pair', f: (_, pairs) => correlation(pairs[0], pairs[1]) },
  PEARSON: { args: 'pair', f: (_, pairs) => correlation(pairs[0], pairs[1]) },
  RSQ: { args: 'pair', f: (_, pairs) => correlation(pairs[0], pairs[1]) ** 2 },
  SLOPE: { args: 'pair', f: (_, pairs) => simpleFit(pairs[0], pairs[1]).slope },
  INTERCEPT: {
    args: 'pair',
    f: (_, pairs) => simpleFit(pairs[0], pairs[1]).intercept,
  },
  'COVARIANCE.S': {
    args: 'pair',
    f: (_, pairs) => covariance(pairs[0], pairs[1]),
  },
  'PERCENTILE.INC': { args: 'var+number', f: (vs, _, k) => quantile(vs[0], k) },
  PERCENTILE: { args: 'var+number', f: (vs, _, k) => quantile(vs[0], k) },
  'QUARTILE.INC': {
    args: 'var+number',
    f: (vs, _, k) => quantile(vs[0], k / 4),
  },
};

// ---------- statistics ----------

export const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
export function variance(v) {
  const m = mean(v);
  return v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1);
}
export const sd = (v) => Math.sqrt(variance(v));
/** Excel's PERCENTILE.INC / MEDIAN. */
export function quantile(v, p) {
  const s = [...v].sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
}
/** Excel's KURT. */
export function kurtosis(v) {
  const n = v.length;
  const m = mean(v);
  const s = sd(v);
  const sum = v.reduce((a, b) => a + ((b - m) / s) ** 4, 0);
  return (
    ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum -
    (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
  );
}
/** Excel's SKEW. */
export function skewness(v) {
  const n = v.length;
  const m = mean(v);
  const s = sd(v);
  return (
    (n / ((n - 1) * (n - 2))) * v.reduce((a, b) => a + ((b - m) / s) ** 3, 0)
  );
}
/** Excel's MODE.SNGL: the first most frequent value, or null when none repeats. */
export function mode(v) {
  const counts = new Map();
  let best = null;
  let most = 1;
  for (const x of v) {
    const c = (counts.get(x) || 0) + 1;
    counts.set(x, c);
    if (c > most) {
      most = c;
      best = x;
    }
  }
  return best;
}
export function covariance(x, y) {
  const mx = mean(x);
  const my = mean(y);
  return x.reduce((a, b, i) => a + (b - mx) * (y[i] - my), 0) / (x.length - 1);
}
export const correlation = (x, y) => covariance(x, y) / (sd(x) * sd(y));
function simpleFit(y, x) {
  const slope = covariance(x, y) / variance(x);
  return { slope, intercept: mean(y) - slope * mean(x) };
}

// The t and F distributions, through the regularized incomplete beta.
function lgamma(z) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < 8; i += 1) x += g[i] / (z + i + 1);
  const t = z + 7.5;
  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
  );
}
function betacf(a, b, x) {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-16) break;
  }
  return h;
}
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lgamma(a + b) -
      lgamma(a) -
      lgamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(a, b, x)) / a
    : 1 - (front * betacf(b, a, 1 - x)) / b;
}
/** Two-tailed p for t with df degrees of freedom (Excel's T.DIST.2T). */
export const tTwoTailed = (t, df) => betai(df / 2, 0.5, df / (df + t * t));
/** Upper-tail p for F (Excel's F.DIST.RT). */
export const fUpper = (f, d1, d2) =>
  f > 0 ? betai(d2 / 2, d1 / 2, d2 / (d2 + d1 * f)) : 1;
/** Excel's T.INV.2T. */
export function tInverse(p, df) {
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (tTwoTailed(mid, df) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Ordinary least squares with an intercept, as LINEST and the ToolPak report it. */
export function leastSquares(y, xs) {
  const n = y.length;
  const k = xs.length;
  const p = k + 1;
  const row = (i) => [1, ...xs.map((x) => x[i])];
  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty = new Array(p).fill(0);
  for (let i = 0; i < n; i += 1) {
    const r = row(i);
    for (let a = 0; a < p; a += 1) {
      xty[a] += r[a] * y[i];
      for (let b = 0; b < p; b += 1) xtx[a][b] += r[a] * r[b];
    }
  }
  // Gauss-Jordan inverse of X'X.
  const m = xtx.map((r, i) => [
    ...r,
    ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let c = 0; c < p; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < p; r += 1)
      if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-12)
      throw new Error(
        'The predictors are collinear (one is a combination of the others).',
      );
    [m[c], m[pivot]] = [m[pivot], m[c]];
    const div = m[c][c];
    for (let j = 0; j < 2 * p; j += 1) m[c][j] /= div;
    for (let r = 0; r < p; r += 1) {
      if (r === c) continue;
      const f = m[r][c];
      for (let j = 0; j < 2 * p; j += 1) m[r][j] -= f * m[c][j];
    }
  }
  const inv = m.map((r) => r.slice(p));
  const b = inv.map((r) => r.reduce((a, v, j) => a + v * xty[j], 0));
  const fitted = Array.from({ length: n }, (_, i) =>
    row(i).reduce((a, v, j) => a + v * b[j], 0),
  );
  const residuals = y.map((v, i) => v - fitted[i]);
  const my = mean(y);
  const sst = y.reduce((a, v) => a + (v - my) ** 2, 0);
  const sse = residuals.reduce((a, v) => a + v * v, 0);
  const ssr = sst - sse;
  const dfResidual = n - p;
  const mse = sse / dfResidual;
  const se = inv.map((r, j) => Math.sqrt(r[j] * mse));
  const t = b.map((v, j) => v / se[j]);
  const tCrit = tInverse(0.05, dfResidual);
  const f = ssr / k / mse;
  return {
    n,
    k,
    b,
    se,
    t,
    p: t.map((v) => tTwoTailed(Math.abs(v), dfResidual)),
    lower: b.map((v, j) => v - tCrit * se[j]),
    upper: b.map((v, j) => v + tCrit * se[j]),
    r2: ssr / sst,
    adjR2: 1 - (1 - ssr / sst) * ((n - 1) / dfResidual),
    seY: Math.sqrt(mse),
    f,
    pF: fUpper(f, k, dfResidual),
    ssr,
    sse,
    sst,
    dfResidual,
    fitted,
    residuals,
  };
}

// ---------- checking lines ----------

const OPS = {
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
  '=': '=',
  '==': '=',
  '<>': '<>',
  '!=': '<>',
};

/** "a > 5 AND b <= 10" → [{name, op, value}] or an error string. */
function readCondition(text, lookup) {
  const parts = [];
  for (const piece of text.split(/\s+AND\s+/i)) {
    const m = piece
      .trim()
      .match(
        /^([A-Za-z_][\w.]*)\s*(>=|<=|<>|!=|==|>|<|=)\s*(-?[\d.]+(?:e-?\d+)?)$/i,
      );
    if (!m)
      return `Could not read the condition “${piece.trim()}” (write it like poverty > 5).`;
    const name = lookup(m[1]);
    if (!name) return `Not in this dataset: ${m[1]}.`;
    parts.push({ name, op: OPS[m[2]], value: Number(m[3]) });
  }
  return parts;
}

/**
 * Check one line. `vars` maps lower-case names to {name, kind}. Returns
 * {ok, line, name, vars, y, xs, group, stat, bins, func, args, cond,
 * creates, error}.
 */
export function checkExcelLine(raw, vars) {
  const line = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const fail = (error) => ({ ok: false, line, error });
  if (!line) return fail('The line is empty.');
  if (line.length > MAX_EXCEL_LINE_LENGTH)
    return fail(`A line may be at most ${MAX_EXCEL_LINE_LENGTH} characters.`);
  const lookup = (word) => vars.get(String(word).toLowerCase())?.name || null;
  const numeric = (word) =>
    vars.get(String(word).toLowerCase())?.kind === 'numeric';
  // A formula line: =FUNC(arg, arg).
  if (line.startsWith('=')) {
    const m = line.match(/^=\s*([A-Za-z][A-Za-z0-9.]*)\s*\(([^()]*)\)\s*$/);
    if (!m)
      return fail(
        'A formula line is one function of variables, like =CORREL(poverty, bachelors).',
      );
    const func = m[1].toUpperCase();
    const spec = FORMULAS[func];
    if (!spec)
      return fail(
        `${func} is not one of the formulas offered here: ${Object.keys(FORMULAS).join(', ')}.`,
      );
    const args = m[2]
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const want = { vars: 1, pair: 2, 'var+number': 2 }[spec.args];
    if (args.length !== want)
      return fail(
        `${func} takes ${spec.args === 'pair' ? 'two variables' : spec.args === 'vars' ? 'one variable' : 'a variable and a number'}.`,
      );
    const names = [];
    for (const [i, a] of args.entries()) {
      if (spec.args === 'var+number' && i === 1) {
        if (!/^-?[\d.]+$/.test(a))
          return fail(`${func}'s second argument is a number.`);
        continue;
      }
      const name = lookup(a);
      if (!name) return fail(`Not in this dataset: ${a}.`);
      if (!numeric(name)) return fail(`${name} is text, not a number.`);
      names.push(name);
    }
    return {
      ok: true,
      line: `=${func}(${args.map((a, i) => (spec.args === 'var+number' && i === 1 ? a : lookup(a))).join(', ')})`,
      name: 'FORMULA',
      func,
      vars: names,
      number: spec.args === 'var+number' ? Number(args[1]) : null,
      cond: [],
      creates: [],
    };
  }
  // The condition, from IF to the end.
  let body = line;
  let cond = [];
  const at = body.search(/\sIF\s/i);
  if (at >= 0) {
    const read = readCondition(body.slice(at + 4), lookup);
    if (typeof read === 'string') return fail(read);
    cond = read;
    body = body.slice(0, at).trim();
  }
  const upper = body.toUpperCase();
  const found = SPELLINGS.find(
    ([s]) => upper === s || upper.startsWith(`${s} `),
  );
  if (!found)
    return fail(
      `“${body.split(' ')[0]}” is not one of the Excel commands: ${EXCEL_COMMAND_NAMES.join(', ')}.`,
    );
  const [spelling, name] = found;
  const rest = body.slice(spelling.length).trim();
  const words = rest.split(/[\s,]+/).filter(Boolean);
  const named = (list, { needNumbers = true } = {}) => {
    const out = [];
    for (const w of list) {
      const v = lookup(w);
      if (!v)
        return `Not in this dataset: ${w}. The variables are in the list below.`;
      if (needNumbers && !numeric(v))
        return `${v} is text, not a number: try FREQUENCY ${v}.`;
      if (!out.includes(v)) out.push(v);
    }
    return out;
  };
  const done = (fields) => ({
    ok: true,
    line: `${name === 'GROUP' ? spelling : name}${rest ? ` ${rest}` : ''}${cond.length ? ` IF ${cond.map((c) => `${c.name} ${c.op} ${c.value}`).join(' AND ')}` : ''}`,
    name,
    cond,
    creates: [],
    ...fields,
  });
  switch (name) {
    case 'DESCRIPTIVE':
    case 'CORRELATION':
    case 'STANDARDIZE':
    case 'RANK': {
      if (!words.length) return fail(`${name} needs at least one variable.`);
      const list = named(words);
      if (typeof list === 'string') return fail(list);
      if (name === 'CORRELATION' && list.length < 2)
        return fail('CORRELATION needs at least two variables.');
      const prefix = name === 'STANDARDIZE' ? 'z' : 'rank';
      return done({
        vars: list,
        creates:
          name === 'STANDARDIZE' || name === 'RANK'
            ? list.map((v) => `${prefix}_${v}`.slice(0, 32))
            : [],
      });
    }
    case 'REGRESSION': {
      const [lhs, rhs] = /\sON\s/i.test(` ${rest} `)
        ? rest.split(/\s+ON\s+/i)
        : [words[0], words.slice(1).join(' ')];
      const y = named([lhs].filter(Boolean));
      const xs = named(
        String(rhs || '')
          .split(/[\s,]+/)
          .filter(Boolean),
      );
      if (typeof y === 'string') return fail(y);
      if (typeof xs === 'string') return fail(xs);
      if (y.length !== 1 || !xs.length)
        return fail('REGRESSION needs: REGRESSION y ON x1 x2.');
      if (xs.includes(y[0])) return fail(`${y[0]} cannot predict itself.`);
      if (xs.length > 15) return fail('At most 15 predictors (as in Excel).');
      return done({ vars: [y[0], ...xs], y: y[0], xs });
    }
    case 'HISTOGRAM': {
      const m = rest.match(/^(\S+)(?:\s+BINS\s+(\d+))?$/i);
      if (!m) return fail('HISTOGRAM needs: HISTOGRAM x [BINS n].');
      const list = named([m[1]]);
      if (typeof list === 'string') return fail(list);
      const bins = m[2] ? Number(m[2]) : null;
      if (bins !== null && (bins < 2 || bins > 60))
        return fail('BINS is 2 to 60.');
      return done({ vars: list, bins });
    }
    case 'SCATTER': {
      const pair = rest
        .split(/\s+(?:AGAINST|VS\.?|WITH)\s+|[\s,]+/i)
        .filter(Boolean);
      if (pair.length !== 2)
        return fail('SCATTER needs: SCATTER y x (y against x).');
      const list = named(pair);
      if (typeof list === 'string') return fail(list);
      return done({ vars: list, y: list[0], xs: [list[1]] });
    }
    case 'FREQUENCY': {
      if (words.length !== 1) return fail('FREQUENCY needs one variable.');
      const list = named(words, { needNumbers: false });
      if (typeof list === 'string') return fail(list);
      return done({ vars: list });
    }
    case 'GROUP': {
      const m = rest.match(/^(\S+)\s+BY\s+(\S+)$/i);
      if (!m) return fail(`${spelling} needs: ${spelling} y BY group.`);
      const y = named([m[1]]);
      const g = named([m[2]], { needNumbers: false });
      if (typeof y === 'string') return fail(y);
      if (typeof g === 'string') return fail(g);
      return done({ vars: [y[0], g[0]], y: y[0], group: g[0], stat: spelling });
    }
    default:
      return fail('Unknown command.');
  }
}

/** Check every line of a session, in order (new columns count for later lines). */
export function checkExcelLines(lines, variables) {
  const vars = new Map(
    variables.map((v) => [
      v.name.toLowerCase(),
      { name: v.name, kind: v.kind || 'numeric' },
    ]),
  );
  const checked = [];
  const problems = [];
  const list = (
    Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/)
  )
    .map((l) => String(l).trim())
    .filter((l) => l && !/^(#|\/\/|')/.test(l));
  if (list.length > MAX_EXCEL_LINES)
    problems.push(`At most ${MAX_EXCEL_LINES} lines per run.`);
  for (const [i, raw] of list.slice(0, MAX_EXCEL_LINES).entries()) {
    const result = checkExcelLine(raw, vars);
    if (!result.ok) {
      problems.push(`Line ${i + 1}: ${result.error}`);
      continue;
    }
    for (const name of result.creates)
      vars.set(name.toLowerCase(), { name, kind: 'numeric' });
    checked.push(result);
  }
  return { ok: problems.length === 0, commands: checked, problems };
}

/** Is this the line of a model (for the map's model numbering)? */
export const isExcelModelLine = (line) =>
  /^\s*REGRESS(ION)?\s/i.test(String(line || ''));

// ---------- the workbook ----------

const fmt = (v, digits = 4) =>
  Number.isFinite(v)
    ? Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)
      ? v.toExponential(3)
      : String(Number(v.toFixed(digits)))
    : '—';
const pad = (text, width) => String(text).padEnd(width);
const textTable = (rows) => {
  const widths = rows[0].map(
    (_, c) => Math.max(...rows.map((r) => String(r[c] ?? '').length)) + 2,
  );
  return rows
    .map((r) =>
      r
        .map((v, c) => pad(v ?? '', widths[c]))
        .join('')
        .trimEnd(),
    )
    .join('\n');
};

const test = (v, { op, value }) =>
  op === '>'
    ? v > value
    : op === '<'
      ? v < value
      : op === '>='
        ? v >= value
        : op === '<='
          ? v <= value
          : op === '='
            ? v === value
            : v !== value;

/**
 * Build the session's workbook from its data and checked commands.
 * `data`: {variables: [{name, label, kind}], rows: [[value]]} (rows in
 * data.csv order; hev_id is the row number). Returns {sheets, log, steps,
 * mapFiles: [{name, csv}]}.
 */
export function buildExcelAnalysis({ title, data, commands }) {
  const { variables } = data;
  const n = data.rows.length;
  const index = new Map(variables.map((v, i) => [v.name, i]));
  // Column values as numbers (null when empty) for the numeric variables.
  const values = new Map();
  const columnOf = (name) => {
    if (!values.has(name)) {
      const i = index.get(name);
      values.set(
        name,
        data.rows.map((row) => {
          const v = row[i];
          if (v === null || v === undefined || v === '') return null;
          const x = Number(v);
          return Number.isFinite(x) ? x : null;
        }),
      );
    }
    return values.get(name);
  };
  const hasGeoid = index.has('geoid');
  const geoidAt = index.get('geoid');
  const dataSheet = 'Data';
  const dataRef = (name) => {
    const c = index.get(name);
    return rangeRef(dataSheet, c, 1, c, n);
  };
  const keepRows = (cond, names) =>
    data.rows
      .map((_, i) => i)
      .filter(
        (i) =>
          names.every((v) => columnOf(v)[i] !== null) &&
          cond.every((c) => {
            const x = columnOf(c.name)[i];
            return x !== null && test(x, c);
          }),
      );
  const condText = (cond) =>
    cond.length
      ? ` (rows where ${cond.map((c) => `${c.name} ${c.op} ${c.value}`).join(' and ')})`
      : '';

  const sheets = [];
  const log = [];
  const steps = [];
  const mapFiles = [];
  const created = []; // [{name, source, kind, values}]
  const sheetNames = new Set(['About', 'Data', 'Variables']);
  const sheetName = (base) => {
    let name = safeSheetName(base);
    for (let k = 2; sheetNames.has(name); k += 1)
      name = safeSheetName(`${base} ${k}`);
    sheetNames.add(name);
    return name;
  };
  const formulaRows = [];
  let models = 0;

  commands.forEach((c, i) => {
    const step = i + 1;
    log.push('', `> ${c.line}`);
    try {
      const keep = keepRows(
        c.cond || [],
        c.name === 'FREQUENCY' || c.name === 'GROUP'
          ? [c.vars[0]].filter((v) => c.name !== 'FREQUENCY')
          : c.vars,
      );
      const live = !(c.cond || []).length;
      const note = live
        ? 'Formulas refer to the Data sheet and recalculate in Excel.'
        : `Values computed for ${keep.length} rows${condText(c.cond)}.`;
      if (c.name === 'DESCRIPTIVE') {
        const name = sheetName(`${step} Descriptive`);
        const labels = [
          'Mean',
          'Standard Error',
          'Median',
          'Mode',
          'Standard Deviation',
          'Sample Variance',
          'Kurtosis',
          'Skewness',
          'Range',
          'Minimum',
          'Maximum',
          'Sum',
          'Count',
        ];
        const rows = [
          [{ v: `Descriptive statistics${condText(c.cond)}`, s: 'title' }],
          [{ v: note, s: 'note' }],
          [],
          [{ v: '', s: 'header' }, ...c.vars.map((v) => ({ v, s: 'header' }))],
        ];
        const stats = c.vars.map((v) => {
          const x = keepRows(c.cond || [], [v]).map((r) => columnOf(v)[r]);
          if (!x.length) throw new Error(`${v} has no values.`);
          const r = dataRef(v);
          const m = mode(x);
          // Undefined for too few values (Excel shows #DIV/0!; here a dash).
          const atLeast = (k, value) => (x.length >= k ? value : '—');
          return [
            [mean(x), `AVERAGE(${r})`],
            [
              atLeast(2, sd(x) / Math.sqrt(x.length)),
              `IFERROR(STDEV.S(${r})/SQRT(COUNT(${r})),"—")`,
            ],
            [quantile(x, 0.5), `MEDIAN(${r})`],
            [m ?? 'none', `IFERROR(MODE.SNGL(${r}),"none")`],
            [atLeast(2, sd(x)), `IFERROR(STDEV.S(${r}),"—")`],
            [atLeast(2, variance(x)), `IFERROR(VAR.S(${r}),"—")`],
            [atLeast(4, kurtosis(x)), `IFERROR(KURT(${r}),"—")`],
            [atLeast(3, skewness(x)), `IFERROR(SKEW(${r}),"—")`],
            [Math.max(...x) - Math.min(...x), `MAX(${r})-MIN(${r})`],
            [Math.min(...x), `MIN(${r})`],
            [Math.max(...x), `MAX(${r})`],
            [x.reduce((a, b) => a + b, 0), `SUM(${r})`],
            [x.length, `COUNT(${r})`],
          ];
        });
        labels.forEach((label, k) =>
          rows.push([
            { v: label, s: 'bold' },
            ...stats.map((s) => ({
              v: s[k][0],
              ...(live && { f: s[k][1] }),
              s:
                k === 12
                  ? 'int'
                  : typeof s[k][0] === 'number'
                    ? 'num'
                    : undefined,
            })),
          ]),
        );
        sheets.push({ name, rows, widths: [20, ...c.vars.map(() => 16)] });
        log.push(
          textTable([
            ['', ...c.vars],
            ...labels.map((label, k) => [
              label,
              ...stats.map((s) =>
                typeof s[k][0] === 'number' ? fmt(s[k][0]) : s[k][0],
              ),
            ]),
          ]),
        );
      } else if (c.name === 'CORRELATION') {
        const name = sheetName(`${step} Correlation`);
        const rows = [
          [{ v: `Correlation (Pearson)${condText(c.cond)}`, s: 'title' }],
          [
            {
              v: `${note} Each pair uses the rows where both have values.`,
              s: 'note',
            },
          ],
          [],
          [{ v: '', s: 'header' }, ...c.vars.map((v) => ({ v, s: 'header' }))],
        ];
        const matrix = c.vars.map((a) =>
          c.vars.map((b) => {
            const both = keepRows(c.cond || [], [a, b]);
            const r =
              a === b
                ? 1
                : correlation(
                    both.map((k) => columnOf(a)[k]),
                    both.map((k) => columnOf(b)[k]),
                  );
            return {
              v: r,
              ...(live && { f: `CORREL(${dataRef(a)},${dataRef(b)})` }),
              s: 'num',
            };
          }),
        );
        c.vars.forEach((a, k) =>
          rows.push([{ v: a, s: 'bold' }, ...matrix[k]]),
        );
        sheets.push({ name, rows, widths: [24, ...c.vars.map(() => 14)] });
        log.push(
          textTable([
            ['', ...c.vars],
            ...c.vars.map((a, k) => [
              a,
              ...matrix[k].map((cell) => fmt(cell.v, 3)),
            ]),
          ]),
        );
      } else if (c.name === 'REGRESSION') {
        models += 1;
        const name = sheetName(`${step} Regression`);
        const y = keep.map((r) => columnOf(c.y)[r]);
        const xs = c.xs.map((x) => keep.map((r) => columnOf(x)[r]));
        if (keep.length <= c.xs.length + 1)
          throw new Error('Too few rows with values for this model.');
        const fit = leastSquares(y, xs);
        const k = c.xs.length;
        const labels = ['Intercept', ...c.xs];
        const rows = [
          [{ v: 'SUMMARY OUTPUT', s: 'title' }],
          [
            {
              v: `${c.y} on ${c.xs.join(', ')}: ${fit.n} rows with values${condText(c.cond)}.`,
              s: 'note',
            },
          ],
          [],
          [
            { v: 'Regression Statistics', s: 'header' },
            { v: '', s: 'header' },
          ],
          ['Multiple R', { v: Math.sqrt(fit.r2), s: 'num' }],
          ['R Square', { v: fit.r2, s: 'num' }],
          ['Adjusted R Square', { v: fit.adjR2, s: 'num' }],
          ['Standard Error', { v: fit.seY, s: 'num' }],
          ['Observations', { v: fit.n, s: 'int' }],
          [],
          [
            { v: 'ANOVA', s: 'header' },
            ...['df', 'SS', 'MS', 'F', 'Significance F'].map((v) => ({
              v,
              s: 'header',
            })),
          ],
          [
            'Regression',
            k,
            { v: fit.ssr, s: 'num' },
            { v: fit.ssr / k, s: 'num' },
            { v: fit.f, s: 'num' },
            { v: fit.pF, s: 'num' },
          ],
          [
            'Residual',
            fit.dfResidual,
            { v: fit.sse, s: 'num' },
            { v: fit.sse / fit.dfResidual, s: 'num' },
          ],
          ['Total', fit.n - 1, { v: fit.sst, s: 'num' }],
          [],
          [
            { v: '', s: 'header' },
            ...[
              'Coefficients',
              'Standard Error',
              't Stat',
              'P-value',
              'Lower 95%',
              'Upper 95%',
            ].map((v) => ({ v, s: 'header' })),
          ],
          ...labels.map((label, j) => [
            { v: label, s: 'bold' },
            ...[
              fit.b[j],
              fit.se[j],
              fit.t[j],
              fit.p[j],
              fit.lower[j],
              fit.upper[j],
            ].map((v) => ({ v, s: 'num' })),
          ]),
          [],
        ];
        // LINEST on the rows the model used (kept below), recalculated by Excel.
        const dataTop = rows.length + 9; // the model's data block, after LINEST
        const linestRow = rows.length + 1;
        rows.push([
          {
            v: 'LINEST (recalculated by Excel; coefficients in reverse order, then the intercept)',
            s: 'bold',
          },
        ]);
        const yCol = 1;
        const xFrom = 2;
        const yRange = rangeRef(name, yCol, dataTop + 1, yCol, dataTop + fit.n);
        const xRange = rangeRef(
          name,
          xFrom,
          dataTop + 1,
          xFrom + k - 1,
          dataTop + fit.n,
        );
        const linest = [
          [...fit.b.slice(1).reverse(), fit.b[0]],
          [...fit.se.slice(1).reverse(), fit.se[0]],
          [fit.r2, fit.seY],
          [fit.f, fit.dfResidual],
          [fit.ssr, fit.sse],
        ];
        const arrayRef = `A${linestRow + 1}:${String.fromCharCode(65 + k)}${linestRow + 5}`;
        for (let r = 0; r < 5; r += 1)
          rows.push(
            Array.from({ length: k + 1 }, (_, col) => ({
              v: linest[r][col] ?? null,
              s: 'num',
              ...(r === 0 &&
                col === 0 && {
                  f: `LINEST(${yRange},${xRange},TRUE,TRUE)`,
                  array: arrayRef,
                }),
            })),
          );
        rows.push(
          [],
          [
            {
              v: 'Rows used by the model (with predicted values and residuals)',
              s: 'bold',
            },
          ],
        );
        while (rows.length < dataTop) rows.push([]);
        rows.push([
          { v: 'hev_id', s: 'header' },
          { v: c.y, s: 'header' },
          ...c.xs.map((v) => ({ v, s: 'header' })),
          { v: 'Predicted', s: 'header' },
          { v: 'Residual', s: 'header' },
          ...(hasGeoid ? [{ v: 'geoid', s: 'header' }] : []),
        ]);
        keep.forEach((r, j) =>
          rows.push([
            r + 1,
            y[j],
            ...xs.map((x) => x[j]),
            { v: fit.fitted[j], s: 'num' },
            { v: fit.residuals[j], s: 'num' },
            ...(hasGeoid ? [String(data.rows[r][geoidAt] ?? '')] : []),
          ]),
        );
        const charts = [];
        if (k === 1)
          charts.push({
            type: 'scatter',
            title: `${c.y} against ${c.xs[0]}`,
            xTitle: c.xs[0],
            yTitle: c.y,
            trendline: true,
            at: { col: k + 6, row: 3, cols: 8, rows: 18 },
            series: { name: c.y, xRef: xRange, yRef: yRange, x: xs[0], y },
          });
        sheets.push({
          name,
          rows,
          widths: [26, 14, ...c.xs.map(() => 14), 14, 14, 14],
          charts,
        });
        log.push(
          `Regression: ${c.y} on ${c.xs.join(', ')} — ${fit.n} rows`,
          `R Square ${fmt(fit.r2)} · Adjusted ${fmt(fit.adjR2)} · Standard Error ${fmt(fit.seY)} · F ${fmt(fit.f)} (p ${fmt(fit.pF)})`,
          textTable([
            [
              '',
              'Coefficients',
              'Std. Error',
              't Stat',
              'P-value',
              'Lower 95%',
              'Upper 95%',
            ],
            ...labels.map((label, j) => [
              label,
              ...[
                fit.b[j],
                fit.se[j],
                fit.t[j],
                fit.p[j],
                fit.lower[j],
                fit.upper[j],
              ].map((v) => fmt(v)),
            ]),
          ]),
        );
        // For the map: fitted values and residuals by row.
        const keys = hasGeoid ? 'hev_id,geoid' : 'hev_id';
        mapFiles.push({
          name: `${MAP_FILE_PREFIX}m${models}.csv`,
          csv: [
            `${keys},hev_fit,hev_res`,
            ...keep.map((r, j) =>
              [
                r + 1,
                ...(hasGeoid ? [String(data.rows[r][geoidAt] ?? '')] : []),
                fit.fitted[j],
                fit.residuals[j],
              ].join(','),
            ),
          ].join('\r\n'),
        });
      } else if (c.name === 'HISTOGRAM') {
        const v = c.vars[0];
        const x = keep.map((r) => columnOf(v)[r]);
        if (x.length < 2) throw new Error(`${v} has too few values.`);
        const lo = Math.min(...x);
        const hi = Math.max(...x);
        const bins = c.bins || Math.min(30, Math.ceil(Math.log2(x.length)) + 1);
        const width = (hi - lo) / bins || 1;
        // The last edge is the maximum itself, so rounding never drops it.
        const edges = Array.from({ length: bins + 1 }, (_, b) =>
          b === bins ? hi : lo + b * width,
        );
        const name = sheetName(`${step} Histogram`);
        const r = dataRef(v);
        const counts = edges
          .slice(0, -1)
          .map(
            (a, b) =>
              x.filter(
                (value) =>
                  (b === 0 ? value >= a : value > a) && value <= edges[b + 1],
              ).length,
          );
        const label = (b) => `${fmt(edges[b], 3)} – ${fmt(edges[b + 1], 3)}`;
        const rows = [
          [{ v: `Histogram of ${v}${condText(c.cond)}`, s: 'title' }],
          [{ v: note, s: 'note' }],
          [],
          [
            { v: 'Bin', s: 'header' },
            { v: 'From', s: 'header' },
            { v: 'To', s: 'header' },
            { v: 'Frequency', s: 'header' },
          ],
          ...counts.map((count, b) => [
            label(b),
            edges[b],
            edges[b + 1],
            {
              v: count,
              ...(live && {
                f: `COUNTIFS(${r},"${b === 0 ? '>=' : '>'}"&B${b + 5},${r},"<="&C${b + 5})`,
              }),
            },
          ]),
        ];
        sheets.push({
          name,
          rows,
          widths: [22, 12, 12, 12],
          charts: [
            {
              type: 'column',
              title: `Histogram of ${v}`,
              xTitle: v,
              yTitle: 'Frequency',
              at: { col: 5, row: 3, cols: 9, rows: 18 },
              series: {
                name: 'Frequency',
                catRef: rangeRef(name, 0, 4, 0, 3 + bins),
                valRef: rangeRef(name, 3, 4, 3, 3 + bins),
                categories: counts.map((_, b) => label(b)),
                values: counts,
              },
            },
          ],
        });
        log.push(
          textTable([
            ['Bin', 'Frequency'],
            ...counts.map((count, b) => [label(b), count]),
          ]),
        );
      } else if (c.name === 'SCATTER') {
        const name = sheetName(`${step} Scatter`);
        const y = keep.map((r) => columnOf(c.y)[r]);
        const x = keep.map((r) => columnOf(c.xs[0])[r]);
        const rows = [
          [{ v: `${c.y} against ${c.xs[0]}${condText(c.cond)}`, s: 'title' }],
          [
            {
              v: `${keep.length} rows with both values. The chart's dashed line is Excel's linear trendline.`,
              s: 'note',
            },
          ],
          [],
          [
            { v: c.xs[0], s: 'header' },
            { v: c.y, s: 'header' },
          ],
          ...keep.map((_, j) => [x[j], y[j]]),
        ];
        sheets.push({
          name,
          rows,
          widths: [16, 16],
          charts: [
            {
              type: 'scatter',
              title: `${c.y} against ${c.xs[0]}`,
              xTitle: c.xs[0],
              yTitle: c.y,
              trendline: true,
              at: { col: 3, row: 3, cols: 9, rows: 20 },
              series: {
                name: c.y,
                xRef: rangeRef(name, 0, 4, 0, 3 + keep.length),
                yRef: rangeRef(name, 1, 4, 1, 3 + keep.length),
                x,
                y,
              },
            },
          ],
        });
        const fit = simpleFit(y, x);
        log.push(
          `Scatter chart of ${c.y} against ${c.xs[0]}: ${keep.length} rows · r = ${fmt(correlation(x, y), 3)} · trendline y = ${fmt(fit.slope)}x + ${fmt(fit.intercept)}`,
        );
      } else if (c.name === 'FREQUENCY') {
        const v = c.vars[0];
        const col = index.get(v);
        const rowsUsed = (c.cond || []).length
          ? keep
          : data.rows.map((_, i) => i);
        const counts = new Map();
        for (const r of rowsUsed) {
          const value = data.rows[r][col];
          if (value === null || value === undefined || value === '') continue;
          counts.set(value, (counts.get(value) || 0) + 1);
        }
        const list = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 500);
        const total = list.reduce((a, [, k]) => a + k, 0);
        const name = sheetName(`${step} Frequency`);
        const r = dataRef(v);
        const rows = [
          [{ v: `Frequency of ${v}${condText(c.cond)}`, s: 'title' }],
          [
            {
              v:
                counts.size > 500
                  ? `The 500 most frequent of ${counts.size} values.`
                  : note,
              s: 'note',
            },
          ],
          [],
          [
            { v: v, s: 'header' },
            { v: 'Count', s: 'header' },
            { v: 'Percent', s: 'header' },
          ],
          ...list.map(([value, k], j) => [
            value,
            { v: k, ...(live && { f: `COUNTIF(${r},A${j + 5})` }) },
            { v: (100 * k) / total, s: 'num' },
          ]),
        ];
        sheets.push({ name, rows, widths: [28, 10, 10] });
        log.push(
          textTable([
            [v, 'Count', 'Percent'],
            ...list
              .slice(0, 40)
              .map(([value, k]) => [value, k, fmt((100 * k) / total, 1)]),
          ]) +
            (list.length > 40
              ? `\n… ${list.length - 40} more values in the workbook`
              : ''),
        );
      } else if (c.name === 'GROUP') {
        const groups = new Map();
        const gCol = index.get(c.group);
        for (const r of keep) {
          const g = data.rows[r][gCol];
          if (g === null || g === undefined || g === '') continue;
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(columnOf(c.y)[r]);
        }
        const stat = c.stat.toUpperCase();
        const value = (list) =>
          stat === 'MEDIAN'
            ? quantile(list, 0.5)
            : stat === 'SUM'
              ? list.reduce((a, b) => a + b, 0)
              : mean(list);
        const list = [...groups]
          .sort((a, b) =>
            String(a[0]).localeCompare(String(b[0]), 'en', { numeric: true }),
          )
          .slice(0, 1000);
        const name = sheetName(
          `${step} ${stat[0]}${stat.slice(1).toLowerCase()} by`,
        );
        const gr = dataRef(c.group);
        const yr = dataRef(c.y);
        const rows = [
          [
            {
              v: `${stat[0]}${stat.slice(1).toLowerCase()} of ${c.y} by ${c.group}${condText(c.cond)}`,
              s: 'title',
            },
          ],
          [
            {
              v:
                stat === 'MEDIAN'
                  ? 'Medians are values (Excel has no MEDIANIF); counts are formulas.'
                  : note,
              s: 'note',
            },
          ],
          [],
          [
            { v: c.group, s: 'header' },
            { v: `${stat.toLowerCase()} of ${c.y}`, s: 'header' },
            { v: 'Rows', s: 'header' },
          ],
          ...list.map(([g, vs], j) => [
            g,
            {
              v: value(vs),
              s: 'num',
              ...(live &&
                stat !== 'MEDIAN' && {
                  f: `${stat === 'SUM' ? 'SUMIF' : 'AVERAGEIF'}(${gr},A${j + 5},${yr})`,
                }),
            },
            {
              v: vs.length,
              ...(live && { f: `COUNTIFS(${gr},A${j + 5},${yr},"<>")` }),
            },
          ]),
        ];
        sheets.push({ name, rows, widths: [28, 18, 10] });
        log.push(
          textTable([
            [c.group, `${stat.toLowerCase()} of ${c.y}`, 'Rows'],
            ...list
              .slice(0, 40)
              .map(([g, vs]) => [g, fmt(value(vs)), vs.length]),
          ]),
        );
      } else if (c.name === 'STANDARDIZE' || c.name === 'RANK') {
        for (const [k, v] of c.vars.entries()) {
          const x = columnOf(v);
          const used = keepRows(c.cond || [], [v]);
          const vals = used.map((r) => x[r]);
          const m = mean(vals);
          const s = sd(vals);
          // RANK.EQ: ties share the best rank (1 = largest).
          const firstAt = new Map();
          [...vals]
            .sort((a, b) => b - a)
            .forEach((value, j) => {
              if (!firstAt.has(value)) firstAt.set(value, j + 1);
            });
          const out = new Array(n).fill(null);
          for (const r of used)
            out[r] =
              c.name === 'STANDARDIZE' ? (x[r] - m) / s : firstAt.get(x[r]);
          created.push({
            name: c.creates[k],
            source: v,
            kind: c.name,
            values: out,
            live,
          });
        }
        log.push(
          `New columns on the "New variables" sheet: ${c.creates.join(', ')}${c.name === 'STANDARDIZE' ? ' (z-scores)' : ' (1 = largest)'}.`,
        );
      } else if (c.name === 'FORMULA') {
        const spec = FORMULAS[c.func];
        const x = c.vars.map((v) =>
          keepRows([], [v]).map((r) => columnOf(v)[r]),
        );
        const both = keepRows([], c.vars);
        const pairs = c.vars.map((v) => both.map((r) => columnOf(v)[r]));
        const value = spec.f(x, pairs, c.number);
        const args = c.vars.map(dataRef);
        if (c.number !== null) args.push(String(c.number));
        formulaRows.push([
          c.line,
          { v: value, f: `${c.func}(${args.join(',')})`, s: 'num' },
        ]);
        log.push(`${c.line} = ${fmt(value, 6)}`);
      }
      steps.push({ step, rc: 0 });
    } catch (error) {
      log.push(`Error: ${error.message}`);
      steps.push({ step, rc: 1 });
    }
  });

  if (formulaRows.length)
    sheets.push({
      name: sheetName('Formulas'),
      rows: [
        [{ v: 'Formulas', s: 'title' }],
        [{ v: 'Each recalculates in Excel from the Data sheet.', s: 'note' }],
        [],
        [
          { v: 'Line', s: 'header' },
          { v: 'Value', s: 'header' },
        ],
        ...formulaRows,
      ],
      widths: [44, 16],
    });
  if (created.length) {
    const name = sheetName('New variables');
    const header = [
      { v: 'hev_id', s: 'header' },
      ...(hasGeoid ? [{ v: 'geoid', s: 'header' }] : []),
      ...created.map((cv) => ({ v: cv.name, s: 'header' })),
    ];
    const rows = [header];
    for (let r = 0; r < n; r += 1)
      rows.push([
        r + 1,
        ...(hasGeoid ? [String(data.rows[r][geoidAt] ?? '')] : []),
        ...created.map((cv) => {
          const cell = `Data!${rangeRef(dataSheet, index.get(cv.source), r + 1).split('!')[1]}`;
          const all = dataRef(cv.source);
          return {
            v: cv.values[r],
            s: 'num',
            ...(cv.live &&
              cv.values[r] !== null && {
                f:
                  cv.kind === 'STANDARDIZE'
                    ? `STANDARDIZE(${cell},AVERAGE(${all}),STDEV.S(${all}))`
                    : `RANK.EQ(${cell},${all},0)`,
              }),
          };
        }),
      ]);
    sheets.push({ name, rows, freeze: 1 });
    const keys = hasGeoid ? 'hev_id,geoid' : 'hev_id';
    mapFiles.push({
      name: `${MAP_FILE_PREFIX}vars.csv`,
      csv: [
        `${keys},${created.map((cv) => cv.name).join(',')}`,
        ...Array.from({ length: n }, (_, r) =>
          [
            r + 1,
            ...(hasGeoid ? [String(data.rows[r][geoidAt] ?? '')] : []),
            ...created.map((cv) => cv.values[r] ?? ''),
          ].join(','),
        ),
      ].join('\r\n'),
    });
  }
  return {
    sheets: [
      ...dataSheets({ title, data, commands: commands.map((c) => c.line) }),
      ...sheets,
    ],
    log: log.join('\n').replace(/^\n+/, ''),
    steps,
    mapFiles,
  };
}

/**
 * The About, Data and Variables sheets: the session's data with labels and
 * sources (also data.xlsx in every Stata, R and SPSS session).
 */
export function dataSheets({ title, data, commands = [] }) {
  const numeric = (v) => v.kind !== 'string';
  const about = [
    [{ v: title, s: 'title' }],
    [{ v: 'Written by Husky Eye View.', s: 'note' }],
    [],
    [{ v: 'Rows', s: 'bold' }, data.rows.length],
    [{ v: 'Variables', s: 'bold' }, data.variables.length],
    [
      { v: 'Created', s: 'bold' },
      new Date().toISOString().slice(0, 16).replace('T', ' '),
    ],
    [],
    ...(commands.length
      ? [
          [{ v: 'Commands', s: 'bold' }],
          ...commands.map((line, i) => [i + 1, line]),
        ]
      : []),
    [],
    [
      {
        v: 'Data: one row per area, the same as data.csv. Variables: each column’s label and source.',
        s: 'note',
      },
    ],
  ];
  return [
    { name: 'About', rows: about, widths: [14, 80] },
    {
      name: 'Data',
      freeze: 1,
      rows: [
        data.variables.map((v) => ({ v: v.name, s: 'header' })),
        ...data.rows.map((row) =>
          data.variables.map((v, i) => {
            const value = row[i];
            if (value === null || value === undefined || value === '')
              return null;
            if (!numeric(v)) return String(value);
            const x = Number(value);
            return Number.isFinite(x) ? x : String(value);
          }),
        ),
      ],
    },
    {
      name: 'Variables',
      freeze: 1,
      widths: [26, 60, 10, 60],
      rows: [
        ['Variable', 'Label', 'Type', 'Source'].map((v) => ({
          v,
          s: 'header',
        })),
        ...data.variables.map((v) => [
          v.name,
          v.label || '',
          v.kind === 'string' ? 'text' : 'number',
          v.source || '',
        ]),
      ],
    },
  ];
}
