/**
 * Replication for Merge & Export: from the steps of a merge (mergeSession.js)
 * write the files that rebuild it — the inputs as the app read them, a Stata
 * do-file, an R script and a plain-language description of every step — so
 * the merged data can be checked and reproduced outside the app.
 *
 * Both scripts start from inputs/ (your file as read, the second file, the
 * app's data for exactly the areas used, and where each point fell), repeat
 * every step in order, and end by checking the rebuilt data against
 * fingerprints of the delivered file: its rows, and each variable's count
 * of values and sum (or count of text).
 */
import { programNames } from './statFiles.js';
import { LEVEL_NOUN, cellOut, fileStem } from './mergeData.js';

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const t = String(v);
  return /[",\r\n]/.test(t) || /^\s|\s$/.test(t)
    ? `"${t.replace(/"/g, '""')}"`
    : t;
};

/** CSV text without a byte-order mark (Stata and R read it as UTF-8). */
const csv = (header, rows) =>
  `${[header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')}\n`;

/** Stata names for a table's columns, by column id. */
function stataNames(table) {
  const { names } = programNames(table.columns, 'stata');
  return new Map(table.columns.map((c, j) => [c.uid, names[j]]));
}

/** R names likewise. */
function rNames(table) {
  const { names } = programNames(table.columns, 'r');
  return new Map(table.columns.map((c, j) => [c.uid, names[j]]));
}

// Stata string in compound quotes, with $ and ` kept literal.
const sq = (text) =>
  `\`"${String(text).replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/`/g, '\\`').replace(/"'/g, '" \'')}"'`;
// R string.
const rq = (text) => JSON.stringify(String(text));

const LEVEL_LENGTH = {
  state: 2,
  county: 5,
  place: 7,
  tract: 11,
  'block group': 12,
};
const numberLike = (c) => c.kind === 'numeric';

/** A table's rows as input CSV rows (dates as ISO text). */
const inputRows = (table, indexes) =>
  table.rows.map((row) =>
    indexes.map((j) => cellOut(table.columns[j], row[j])),
  );

/**
 * The replication files for a session's steps and its final table:
 * `{files: [{name, data}], stem}`.
 */
export function replicationFiles(
  steps,
  final,
  {
    format = 'dta',
    date = new Date(),
    appName = 'Husky Eye View',
    shapes = null,
  } = {},
) {
  const stem = fileStem(steps[0].name);
  const files = [];
  const stata = [];
  const r = [];
  const text = [];
  const finalNames = stataNames(final);
  const finalR = rNames(final);
  const say = (line = '') => text.push(line);
  const st = (line = '') => stata.push(line);
  const rs = (line = '') => r.push(line);
  // Every column's Stata and R name: the final name if it survives, else the
  // name it had in its own table.
  const sName = new Map(finalNames);
  const rName = new Map(finalR);
  const learn = (table) => {
    for (const [uid, n] of stataNames(table))
      if (!sName.has(uid)) sName.set(uid, n);
    for (const [uid, n] of rNames(table))
      if (!rName.has(uid)) rName.set(uid, n);
  };
  steps.forEach((s) => {
    for (const t of [s.table, s.before, s.after, s.other]) if (t) learn(t);
  });
  const S = (c) => sName.get(c.uid);
  // The R script works with the input files' (Stata) names throughout and
  // gives the columns their R names at the end, as the .RData file has them.
  const Rn = S;
  // Each row's clean GEOID as the app made it — hev__g in Stata, g in R
  // (empty / NA unless it has the digits of one of the join's levels).
  const geoidLines = (join, table) => {
    const sl = [];
    const rl = [];
    const lens =
      join.level === 'mixed'
        ? join.present.map((l) => LEVEL_LENGTH[l])
        : [LEVEL_LENGTH[join.level]];
    const source = join.column
      ? table.columns.find((c) => c.name === join.column)
      : null;
    if (source) {
      sl.push(
        `generate hev__g = ${numberLike(source) ? `string(${S(source)}, "%21.0g")` : `strtrim(${S(source)})`}`,
        'replace hev__g = ustrregexra(ustrregexra(hev__g, "^.*[Uu][Ss]", ""), "\\.0+\\$", "")',
        'replace hev__g = "" if !ustrregexm(hev__g, "^[0-9]+\\$")',
        'replace hev__g = "0" + hev__g if inlist(strlen(hev__g), 1, 4, 6, 10)',
      );
      rl.push(
        `g <- ${numberLike(source) ? `num_text(d[[${rq(Rn(source))}]])` : `d[[${rq(Rn(source))}]]`}`,
        'g <- norm_geoid(g)',
      );
    } else {
      // State / county / tract code columns.
      const parts = ['statePart', 'countyPart', 'tractPart']
        .map((p, q) => [join.parts?.[p], [2, 3, 6][q]])
        .filter(([n]) => n)
        .map(([n, w]) => [table.columns.find((c) => c.name === n), w]);
      parts.forEach(([c, w], q) => {
        sl.push(
          `generate hev__p${q} = ustrregexra(strtrim(${numberLike(c) ? `string(${S(c)}, "%21.0g")` : S(c)}), "\\.0+\\$", "")`,
          `replace hev__p${q} = "" if !ustrregexm(hev__p${q}, "^[0-9]+\\$") | strlen(hev__p${q}) > ${w}`,
          `replace hev__p${q} = substr("${'0'.repeat(w)}", 1, ${w} - strlen(hev__p${q})) + hev__p${q} if hev__p${q} != ""`,
        );
        rl.push(
          `p${q} <- sub("\\\\.0+$", "", trimws(${numberLike(c) ? `num_text(d[[${rq(Rn(c))}]])` : `d[[${rq(Rn(c))}]]`}))`,
          `p${q}[!grepl("^[0-9]+$", p${q}) | nchar(p${q}) > ${w}] <- NA; p${q} <- ifelse(is.na(p${q}), NA, paste0(strrep("0", pmax(0, ${w} - nchar(p${q}))), p${q}))`,
        );
      });
      sl.push(
        `generate hev__g = ${parts.map((_, q) => `hev__p${q}`).join(' + ')} if ${parts.map((_, q) => `hev__p${q} != ""`).join(' & ')}`,
        `drop ${parts.map((_, q) => `hev__p${q}`).join(' ')}`,
      );
      rl.push(
        `g <- ifelse(${parts.map((_, q) => `is.na(p${q})`).join(' | ')}, NA, paste0(${parts.map((_, q) => `p${q}`).join(', ')}))`,
      );
    }
    sl.push(
      `replace hev__g = "" if !inlist(strlen(hev__g), ${lens.join(', ')})`,
    );
    rl.push(`g[!is.na(g) & !(nchar(g) %in% c(${lens.join(', ')}))] <- NA`);
    return { sl, rl };
  };

  // Headers.
  st(
    `* ${stem}_merge.do — rebuilds ${stem}'s merged data from the files in inputs/`,
  );
  st(
    `* Written by ${appName} on ${date.toISOString().slice(0, 10)}. Stata 14 or later.`,
  );
  st(
    '* Run it from the folder it is in:  cd "<this folder>"  then  do ' +
      `${stem}_merge.do`,
  );
  st('* Each step below matches a step in ' + `${stem}_steps.txt.`);
  st('version 14');
  st('clear all');
  st('set more off');
  st();
  rs(
    `# ${stem}_merge.R — rebuilds ${stem}'s merged data from the files in inputs/`,
  );
  rs(
    `# Written by ${appName} on ${date.toISOString().slice(0, 10)}. Base R only (R 3.5 or later).`,
  );
  rs(
    '# Run it from the folder it is in:  setwd("<this folder>")  then  source("' +
      `${stem}_merge.R")`,
  );
  rs(
    'read_input <- function(file) read.csv(file, colClasses = "character", check.names = FALSE, na.strings = "", encoding = "UTF-8", fileEncoding = "UTF-8")',
  );
  rs('as_num <- function(x) as.numeric(x)');
  rs(
    'num_text <- function(x) vapply(x, function(v) if (is.na(v)) NA_character_ else format(v, scientific = FALSE, trim = TRUE, digits = 15), "")',
  );
  rs(
    'norm_key <- function(x) { x <- trimws(x); x <- sub("^(-?[0-9]+)\\\\.0+$", "\\\\1", x); x[x == ""] <- NA; x }',
  );
  rs('norm_geoid <- function(x, len) {');
  rs(
    '  x <- trimws(as.character(x)); x <- sub("^.*[Uu][Ss]", "", x); x <- sub("\\\\.0+$", "", x)',
  );
  rs('  x[!grepl("^[0-9]+$", x)] <- NA');
  rs(
    '  pad <- !is.na(x) & nchar(x) %in% c(1, 4, 6, 10); x[pad] <- paste0("0", x[pad])',
  );
  rs('  if (!missing(len)) x[!is.na(x) & nchar(x) != len] <- NA');
  rs('  x');
  rs('}');
  rs();
  say(`${stem}: how the merged data was made`);
  say(
    `Written by ${appName} on ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
  );
  say('');
  say(
    'Every step is listed in order, with the numbers to check it by. The same steps are in',
  );
  say(
    `${stem}_merge.do (Stata 14 or later) and ${stem}_merge.R (R): run either from this folder and it`,
  );
  say(
    'rebuilds the data from the files in inputs/ and checks the result against the delivered file.',
  );
  say('');

  let k = 0;
  for (const s of steps) {
    k += 1;
    const tag = `step${k}`;
    if (s.op === 'read') {
      const t = s.table;
      const name = `inputs/${stem}_as_read.csv`;
      const idx = t.columns.map((_, j) => j);
      files.push({ name, data: csv(t.columns.map(S), inputRows(t, idx)) });
      if (s.bytes)
        files.push({ name: `inputs/original/${s.name}`, data: s.bytes });
      say(
        `Step ${k}. Read your file ${s.name}${t.sheet ? ` (sheet ${t.sheet})` : ''}.`,
      );
      say(
        `   ${t.rows.length.toLocaleString('en-US')} rows, ${t.columns.length} columns. ${s.describe}`,
      );
      say(
        `   As read: ${name} (the original is in inputs/original/). Columns are text unless at least half`,
      );
      say(
        '   of their values are numbers; ID-like columns (GEOIDs, FIPS, codes) and values with leading',
      );
      say(
        '   zeros stay text. "1,234", "12%" and "$40,000" read as 1234, 12 and 40000.',
      );
      const dates = t.columns.filter(
        (c) => c.kind === 'date' || c.kind === 'datetime',
      );
      if (dates.length)
        say(
          `   Dates (${dates.map(S).join(', ')}) are written as YYYY-MM-DD text in the input file.`,
        );
      say('');
      st(`* ---- Step ${k}. Read ${s.name} (as ${appName} read it) ----`);
      st(
        `import delimited using "${name}", varnames(1) case(preserve) stringcols(_all) encoding("utf-8") bindquotes(strict) clear`,
      );
      const nums = t.columns.filter(numberLike).map(S);
      if (nums.length) st(`destring ${nums.join(' ')}, replace`);
      for (const c of dates) {
        st(
          `generate double hev__t = ${c.kind === 'date' ? `date(${S(c)}, "YMD")` : `clock(${S(c)}, "YMDhms")`}`,
        );
        st(`drop ${S(c)}`);
        st(`rename hev__t ${S(c)}`);
        st(`format ${S(c)} ${c.kind === 'date' ? '%td' : '%tc'}`);
      }
      st('generate long hev__row = _n');
      st();
      rs(`# ---- Step ${k}. Read ${s.name} (as ${appName} read it) ----`);
      rs(`d <- read_input(${rq(name)})`);
      for (const c of t.columns.filter(numberLike))
        rs(`d[[${rq(Rn(c))}]] <- as_num(d[[${rq(Rn(c))}]])`);
      for (const c of dates)
        rs(
          c.kind === 'date'
            ? `d[[${rq(Rn(c))}]] <- as.Date(d[[${rq(Rn(c))}]])`
            : `d[[${rq(Rn(c))}]] <- as.POSIXct(d[[${rq(Rn(c))}]], tz = "UTC")`,
        );
      rs();
    } else if (s.op === 'merge') {
      const { report: m, before: a, other: b, after } = s;
      const name = `inputs/${fileStem(m.other)}_as_read.csv`;
      const keyA = a.columns.find((c) => c.name === m.leftKey);
      const keyBIndex = b.columns.findIndex((c) => c.name === m.rightKey);
      const keyB = b.columns[keyBIndex];
      const bUid = new Map(m.bColumns.map(({ j, uid }) => [j, uid]));
      const header = b.columns.map((c, j) =>
        j === keyBIndex ? 'hev__bkey' : sName.get(bUid.get(j)),
      );
      files.push({
        name,
        data: csv(
          header,
          inputRows(
            b,
            b.columns.map((_, j) => j),
          ),
        ),
      });
      if (s.bytes)
        files.push({ name: `inputs/original/${m.other}`, data: s.bytes });
      const indicator = after.columns.find((c) => c.uid === m.indicatorUid);
      const kept = {
        left: 'every row of your file',
        inner: 'only rows found in both files',
        outer: 'every row of both files',
      }[m.keep];
      say(
        `Step ${k}. Merge with ${m.other} on ${m.leftKey} = ${m.rightKey}, keeping ${kept}.`,
      );
      say(
        `   ${b.rows.length.toLocaleString('en-US')} rows in ${m.other} (as read: ${name}). Relation ${m.relation}${m.relation === '1:m' ? ' (rows of your file repeat for each match)' : m.relation === 'm:1' ? ' (several of your rows share one row of the second file)' : ''}.`,
      );
      say(
        `   Keys compared as text, trimmed, with "12.0" read as "12"${m.geoidKeys ? '; both keys are GEOIDs, so leading zeros Excel dropped are restored first' : ''}. Empty keys never match.`,
      );
      say(
        `   Matched ${m.matched.toLocaleString('en-US')}; only in your file ${m.onlyA.toLocaleString('en-US')}; only in ${m.other} ${m.onlyB.toLocaleString('en-US')}. Rows after: ${m.rows.toLocaleString('en-US')}.`,
      );
      say(
        `   ${S(indicator)}: 1 = only in your file, 2 = only in ${m.other}, 3 = in both (as Stata's _merge).`,
      );
      say('');
      // Stata.
      const keyExpr = (col, v) =>
        numberLike(col) ? `string(${v}, "%21.0g")` : `strtrim(${v})`;
      const normalize = (v, side) => [
        `replace ${v} = ustrregexra(${v}, "^(-?[0-9]+)\\.0+\\$", "\\$1")`,
        ...(m.geoidKeys
          ? [
              `generate hev__g = ustrregexra(ustrregexra(${v}, "^.*[Uu][Ss]", ""), "\\.0+\\$", "")`,
              'replace hev__g = "0" + hev__g if ustrregexm(hev__g, "^[0-9]+\\$") & inlist(strlen(hev__g), 1, 4, 6, 10)',
              `replace ${v} = hev__g if ustrregexm(hev__g, "^[0-9]+\\$") & inlist(strlen(hev__g), 2, 5, 7, 11, 12)`,
              'drop hev__g',
            ]
          : []),
        `replace ${v} = "hev__none_${side}" + string(_n) if ${v} == ""`,
      ];
      st(
        `* ---- Step ${k}. Merge with ${m.other} on ${m.leftKey} = ${m.rightKey} ----`,
      );
      st('tempfile other');
      st('preserve');
      st(
        `import delimited using "${name}", varnames(1) case(preserve) stringcols(_all) encoding("utf-8") bindquotes(strict) clear`,
      );
      const bNums = b.columns
        .map((c, j) => (numberLike(c) ? header[j] : null))
        .filter(Boolean);
      if (bNums.length) st(`destring ${bNums.join(' ')}, replace`);
      b.columns.forEach((c, j) => {
        if (c.kind !== 'date' && c.kind !== 'datetime') return;
        const v = header[j];
        st(
          `generate double hev__t = ${c.kind === 'date' ? `date(${v}, "YMD")` : `clock(${v}, "YMDhms")`}`,
        );
        st(`drop ${v}`);
        st(`rename hev__t ${v}`);
        st(`format ${v} ${c.kind === 'date' ? '%td' : '%tc'}`);
      });
      st(`generate hev__key = ${keyExpr(keyB, 'hev__bkey')}`);
      for (const line of normalize('hev__key', 'b')) st(line);
      st('generate long hev__brow = _n');
      st("save `other'");
      st('restore');
      st(`generate hev__key = ${keyExpr(keyA, S(keyA))}`);
      for (const line of normalize('hev__key', 'a')) st(line);
      const keepOpt =
        m.keep === 'left'
          ? ', keep(master match)'
          : m.keep === 'inner'
            ? ', keep(match)'
            : '';
      st(
        `merge ${m.relation === '1:m' ? '1:m' : m.relation === 'm:1' ? 'm:1' : '1:1'} hev__key using \`other'${keepOpt}`,
      );
      if (m.keep === 'outer') {
        if (numberLike(keyA) === numberLike(keyB))
          st(`replace ${S(keyA)} = hev__bkey if _merge == 2`);
        else if (numberLike(keyA))
          st(`replace ${S(keyA)} = real(hev__bkey) if _merge == 2`);
        else
          st(`replace ${S(keyA)} = string(hev__bkey, "%21.0g") if _merge == 2`);
      }
      st('sort hev__row hev__brow');
      st(`rename _merge ${S(indicator)}`);
      st('drop hev__key hev__bkey hev__brow');
      st('replace hev__row = _n');
      st();
      // R.
      const rKey = (col, v) => (numberLike(col) ? `num_text(${v})` : v);
      rs(
        `# ---- Step ${k}. Merge with ${m.other} on ${m.leftKey} = ${m.rightKey} ----`,
      );
      rs(`b <- read_input(${rq(name)})`);
      b.columns.forEach((c, j) => {
        if (numberLike(c))
          rs(`b[[${rq(header[j])}]] <- as_num(b[[${rq(header[j])}]])`);
        if (c.kind === 'date')
          rs(`b[[${rq(header[j])}]] <- as.Date(b[[${rq(header[j])}]])`);
        if (c.kind === 'datetime')
          rs(
            `b[[${rq(header[j])}]] <- as.POSIXct(b[[${rq(header[j])}]], tz = "UTC")`,
          );
      });
      const rNorm = (v) =>
        m.geoidKeys
          ? `{ k <- norm_key(${v}); g <- norm_geoid(k); ifelse(!is.na(g) & nchar(g) %in% c(2, 5, 7, 11, 12), g, k) }`
          : `norm_key(${v})`;
      rs(`ka <- ${rNorm(rKey(keyA, `d[[${rq(Rn(keyA))}]]`))}`);
      rs(`kb <- ${rNorm(rKey(keyB, 'b[["hev__bkey"]]'))}`);
      rs(
        'hits <- split(seq_along(kb), factor(kb, levels = unique(kb[!is.na(kb)])))',
      );
      rs(
        'idx <- lapply(ka, function(x) if (is.na(x) || is.null(hits[[x]])) NA_integer_ else hits[[x]])',
      );
      rs(
        'ai <- rep(seq_along(ka), lengths(idx)); bi <- unlist(idx, use.names = FALSE)',
      );
      if (m.keep === 'inner') rs('ai <- ai[!is.na(bi)]; bi <- bi[!is.na(bi)]');
      rs('flag <- ifelse(is.na(bi), 1, 3)');
      if (m.keep === 'outer') {
        rs('extra <- setdiff(seq_len(nrow(b)), bi)');
        rs(
          'ai <- c(ai, rep(NA, length(extra))); bi <- c(bi, extra); flag <- c(flag, rep(2, length(extra)))',
        );
      }
      rs('out <- d[ai, , drop = FALSE]');
      if (m.keep === 'outer')
        rs(
          `out[[${rq(Rn(keyA))}]][is.na(ai)] <- ${numberLike(keyA) ? 'as_num' : 'as.character'}(b[["hev__bkey"]][bi[is.na(ai)]])`,
        );
      rs('for (v in setdiff(names(b), "hev__bkey")) out[[v]] <- b[[v]][bi]');
      rs(`out[[${rq(Rn(indicator))}]] <- flag`);
      rs('d <- out; rownames(d) <- NULL');
      rs();
    } else if (s.op === 'attach') {
      const { report: a, before, after, join } = s;
      const col = (uid) => after.columns.find((c) => c.uid === uid);
      const index = new Map(after.columns.map((c, j) => [c.uid, j]));
      const fields = (level) =>
        a.added
          .filter((x) => x.role === 'field' && x.level === level)
          .map((x) => col(x.uid));
      const itemsText = s.items.map((i) => i.label).join('; ');
      say(`Step ${k}. Add ${appName} data: ${itemsText}.`);
      if (join.kind === 'points') {
        say(
          `   Each point (${join.how}) was located in its state, county and 2020 census tract${a.added.some((x) => x.level === 'place' && x.role === 'located') ? ' and city' : ''} by point-in-polygon`,
        );
        say(
          '   against Census TIGER/Line boundaries; HOLC grades and enumeration districts likewise against their maps.',
        );
        say(
          `   Where each point fell is in inputs/hev_${tag}_located.csv (row number → areas). To check it in Stata,`,
        );
        say(
          '   see geoinpoly (ssc install geoinpoly) with the Census shapefiles.',
        );
      } else if (join.clean) {
        say(
          `   Rows were matched by ${join.how}, the ${LEVEL_NOUN[join.level]} GEOIDs added in an earlier step.`,
        );
        say(
          '   County and state values come from the first 5 and 2 digits of the GEOID.',
        );
      } else if (join.level === 'mixed') {
        say(
          `   Rows were matched by ${join.how}: digits only, a "…US" prefix and a trailing ".0" removed, one lost`,
        );
        say(
          `   leading zero restored (Excel), and kept (as hev_geoid) when it has the digits of one of the file's levels:`,
        );
        say(
          `   ${join.present.map((l) => `${LEVEL_LENGTH[l]} for a ${LEVEL_NOUN[l]}`).join(', ')}. Each row is matched at its own level (hev_level):`,
        );
        say(
          '   a tract row takes tract data and its county’s and state’s (the first 5 and 2 digits); a county row',
        );
        say(
          `   takes county and state data, and no tract data;${join.present.includes('place') ? ' a city row takes city and state data (and county data by its center);' : ''} a state row takes state data only.`,
        );
      } else {
        say(
          `   Rows were matched by ${join.how}: digits only, a "…US" prefix and a trailing ".0" removed, one lost`,
        );
        say(
          `   leading zero restored (Excel), and kept when it has the ${LEVEL_LENGTH[join.level]} digits of a ${LEVEL_NOUN[join.level]} GEOID (as hev_geoid).`,
        );
        say(
          '   County and state values come from the first 5 and 2 digits of the GEOID.',
        );
      }
      if (a.placeCounty)
        say(
          `   A city's county is the one its center is in (inputs/hev_${tag}_city_county.csv).`,
        );
      for (const level of ['tract', 'county', 'state', 'place']) {
        const fs = fields(level);
        if (!fs.length) continue;
        const n = a.found[level]?.size || 0;
        say(
          `   ${LEVEL_NOUN[level][0].toUpperCase()}${LEVEL_NOUN[level].slice(1)} data (inputs/hev_${tag}_${level}.csv, ${n.toLocaleString('en-US')} areas): ${fs.map(S).join(', ')}.`,
        );
      }
      const pointFields = fields('point');
      if (pointFields.length)
        say(`   At each point: ${pointFields.map(S).join(', ')}.`);
      for (const note of a.notes) say(`   ${note}`);
      say(
        `   Matched ${a.matchedRows.toLocaleString('en-US')} of ${a.rows.toLocaleString('en-US')} rows (hev_matched: 3 = matched, 1 = not). Every row is kept.`,
      );
      const sources = [...new Set(s.items.map((i) => i.source))];
      for (const src of sources) say(`   Source: ${src}`);
      say('');
      st(`* ---- Step ${k}. Add ${appName} data ----`);
      rs(`# ---- Step ${k}. Add ${appName} data ----`);
      // The area each row is in, at each level.
      const keyOf = {};
      const rKeyOf = {};
      if (join.kind === 'points') {
        const located = a.added
          .filter((x) => x.role === 'located')
          .map((x) => col(x.uid));
        const header = ['hev__row', ...located.map(S), ...pointFields.map(S)];
        const rows = after.rows.map((row, i) => [
          i + 1,
          ...[...located, ...pointFields].map((c) => row[index.get(c.uid)]),
        ]);
        files.push({
          name: `inputs/hev_${tag}_located.csv`,
          data: csv(header, rows),
        });
        st(`tempfile located`);
        st('preserve');
        st(
          `import delimited using "inputs/hev_${tag}_located.csv", varnames(1) case(preserve) stringcols(_all) encoding("utf-8") clear`,
        );
        st('destring hev__row, replace');
        st("save `located'");
        st('restore');
        st("merge 1:1 hev__row using `located', nogenerate");
        rs(`loc <- read_input("inputs/hev_${tag}_located.csv")`);
        rs('i <- match(seq_len(nrow(d)), as.integer(loc$hev__row))');
        rs(`for (v in setdiff(names(loc), "hev__row")) d[[v]] <- loc[[v]][i]`);
        for (const x of a.added.filter((y) => y.role === 'located')) {
          keyOf[x.level] = S(col(x.uid));
          rKeyOf[x.level] = `d[[${rq(Rn(col(x.uid)))}]]`;
        }
      } else {
        const { sl, rl } = geoidLines(join, before);
        for (const line of sl) st(line);
        for (const line of rl) rs(line);
        const geoidCol = a.added.find((x) => x.role === 'geoid');
        if (geoidCol) {
          st(`generate ${S(col(geoidCol.uid))} = hev__g`);
          rs(`d[[${rq(Rn(col(geoidCol.uid)))}]] <- g`);
        }
        // Mixed files: each row's level, from its GEOID's length.
        const levelCol = a.added.find((x) => x.role === 'level');
        if (levelCol) {
          const v = S(col(levelCol.uid));
          st(`generate ${v} = ""`);
          for (const l of join.present)
            st(
              `replace ${v} = "${LEVEL_NOUN[l]}" if strlen(hev__g) == ${LEVEL_LENGTH[l]}`,
            );
          rs(
            `lv_names <- c(${join.present.map((l) => `"${LEVEL_LENGTH[l]}" = "${LEVEL_NOUN[l]}"`).join(', ')})`,
          );
          rs(
            `d[[${rq(Rn(col(levelCol.uid)))}]] <- ifelse(is.na(g), NA, unname(lv_names[as.character(nchar(g))]))`,
          );
        }
        // Each row's area at each level, as the app takes it from the GEOID
        // (a tract's county and state are its first 5 and 2 digits).
        keyOf.tract =
          'cond(inlist(strlen(hev__g), 11, 12), substr(hev__g, 1, 11), "")';
        keyOf.county =
          'cond(inlist(strlen(hev__g), 5, 11, 12), substr(hev__g, 1, 5), "")';
        keyOf.state = 'substr(hev__g, 1, 2)';
        keyOf.place = 'cond(strlen(hev__g) == 7, hev__g, "")';
        rKeyOf.tract =
          'ifelse(!is.na(g) & nchar(g) %in% c(11, 12), substr(g, 1, 11), NA)';
        rKeyOf.county =
          'ifelse(!is.na(g) & nchar(g) %in% c(5, 11, 12), substr(g, 1, 5), NA)';
        rKeyOf.state = 'substr(g, 1, 2)';
        rKeyOf.place = 'ifelse(!is.na(g) & nchar(g) == 7, g, NA)';
      }
      const chosen = ['tract', 'county', 'state', 'place'].filter(
        (level) => fields(level).length,
      );
      for (const level of chosen) {
        st(`generate hev__k_${level} = ${keyOf[level]}`);
        rs(`k_${level} <- ${rKeyOf[level]}`);
      }
      // A city's county: the one its center is in.
      const cityCounty = a.placeCounty
        ? [...a.placeCounty].filter(([, c]) => c)
        : [];
      if (chosen.includes('county') && cityCounty.length) {
        const name = `inputs/hev_${tag}_city_county.csv`;
        files.push({ name, data: csv(['hev__p', 'hev__c'], cityCounty) });
        st('tempfile citycounty');
        st('preserve');
        st(
          `import delimited using "${name}", varnames(1) case(preserve) stringcols(_all) encoding("utf-8") clear`,
        );
        st("save `citycounty'");
        st('restore');
        st(`generate hev__p = ${keyOf.place}`);
        st(
          "merge m:1 hev__p using `citycounty', keep(master match) nogenerate",
        );
        st('replace hev__k_county = hev__c if hev__k_county == ""');
        st('drop hev__p hev__c');
        rs(`cc <- read_input(${rq(name)})`);
        rs(
          `k_county <- ifelse(is.na(k_county), cc$hev__c[match(${rKeyOf.place}, cc$hev__p)], k_county)`,
        );
      }
      for (const level of chosen) {
        const fs = fields(level);
        // The app's data for exactly the areas found, from the merged rows.
        const ids = a.ids[level] || [];
        const seen = new Map();
        after.rows.forEach((row, i) => {
          const g = ids[i];
          if (g && a.found[level]?.has(g) && !seen.has(g))
            seen.set(
              g,
              fs.map((c) => row[index.get(c.uid)]),
            );
        });
        const name = `inputs/hev_${tag}_${level}.csv`;
        files.push({
          name,
          data: csv(
            ['hev__k', ...fs.map(S)],
            [...seen].map(([g, vals]) => [g, ...vals]),
          ),
        });
        st(`tempfile ${level}`);
        st('preserve');
        st(
          `import delimited using "${name}", varnames(1) case(preserve) stringcols(_all) encoding("utf-8") bindquotes(strict) clear`,
        );
        const nums = fs.filter(numberLike).map(S);
        if (nums.length) st(`destring ${nums.join(' ')}, replace`);
        st(`save \`${level}'`);
        st('restore');
        st(`generate hev__k = hev__k_${level}`);
        st(`merge m:1 hev__k using \`${level}', keep(master match)`);
        st(`generate byte hev__m_${level} = _merge == 3`);
        st('drop _merge hev__k');
        rs(`lv <- read_input(${rq(name)})`);
        for (const c of fs.filter(numberLike))
          rs(`lv[[${rq(Rn(c))}]] <- as_num(lv[[${rq(Rn(c))}]])`);
        rs(`i <- match(k_${level}, lv$hev__k)`);
        rs('for (v in setdiff(names(lv), "hev__k")) d[[v]] <- lv[[v]][i]');
        rs(`m_${level} <- !is.na(i)`);
      }
      const matched = a.added.find((x) => x.role === 'matched');
      if (matched) {
        const v = S(col(matched.uid));
        if (join.kind === 'points') {
          st(`generate byte ${v} = cond(${keyOf.tract} != "", 3, 1)`);
          rs(
            `d[[${rq(Rn(col(matched.uid)))}]] <- ifelse(!is.na(${rKeyOf.tract}), 3, 1)`,
          );
        } else {
          // Matched at the row's finest level whose data was chosen.
          st('generate byte hev__m = .');
          rs('m <- rep(NA, nrow(d))');
          for (const level of a.matchOrder) {
            st(
              `replace hev__m = hev__m_${level} if missing(hev__m) & hev__k_${level} != ""`,
            );
            rs(`m <- ifelse(is.na(m) & !is.na(k_${level}), m_${level}, m)`);
          }
          st(`generate byte ${v} = cond(hev__m == 1, 3, 1)`);
          rs(`d[[${rq(Rn(col(matched.uid)))}]] <- ifelse(!is.na(m) & m, 3, 1)`);
        }
      }
      if (chosen.length)
        st(`drop ${chosen.map((l) => `hev__k_${l} hev__m_${l}`).join(' ')}`);
      if (join.kind !== 'points') st('capture drop hev__g hev__m');
      // merge sorts by its key: back to the rows' own order.
      st('sort hev__row');
      st();
      rs();
    } else if (s.op === 'expand') {
      const { report: x, before, after } = s;
      const geoCol = after.columns.find((c) => c.uid === x.geoidUid);
      const nameCol = after.columns.find((c) => c.uid === x.nameUid);
      const from = LEVEL_NOUN[x.from];
      const units = x.to === 'county' ? 'counties' : `${LEVEL_NOUN[x.to]}s`;
      const name = `inputs/hev_${tag}_${units}.csv`;
      files.push({
        name,
        data: csv(['hev__g', S(geoCol), S(nameCol)], x.pairs),
      });
      say(
        `Step ${k}. One row per ${LEVEL_NOUN[x.to]}: each ${from} row became a row for every ${x.to === 'tract' ? '2020 census tract' : 'county'} in its ${from},`,
      );
      say(
        `   keeping all of the ${from}'s values, so ${x.to === 'tract' ? 'tract' : 'county'} data can be attached to each and the ${from}'s data is on every one.`,
      );
      say(
        `   The ${from} is found by ${x.parentJoin.how} as in the next step; ${name} lists the ${units} in each`,
      );
      say(
        `   ${from} (${S(geoCol)}, ${S(nameCol)}; ${x.to === 'tract' ? 'Census TIGER/Line 2020 tracts' : 'Census counties'}), in GEOID order.`,
      );
      say(
        `   ${x.rowsBefore.toLocaleString('en-US')} ${x.rowsBefore === 1 ? 'row' : 'rows'} became ${x.rows.toLocaleString('en-US')}.${x.empty ? ` ${x.empty.toLocaleString('en-US')} row${x.empty === 1 ? '' : 's'} without a ${from} the map has stay${x.empty === 1 ? 's' : ''} one row, with ${S(geoCol)} empty.` : ''}`,
      );
      say('');
      st(
        `* ---- Step ${k}. One row per ${LEVEL_NOUN[x.to]} in each ${from} ----`,
      );
      rs(
        `# ---- Step ${k}. One row per ${LEVEL_NOUN[x.to]} in each ${from} ----`,
      );
      const { sl, rl } = geoidLines(x.parentJoin, before);
      for (const line of sl) st(line);
      for (const line of rl) rs(line);
      if (x.pairs.length) {
        st('tempfile units');
        st('preserve');
        st(
          `import delimited using "${name}", varnames(1) case(preserve) stringcols(_all) encoding("utf-8") bindquotes(strict) clear`,
        );
        st('generate long hev__u = _n');
        st("save `units'");
        st('restore');
        st("joinby hev__g using `units', unmatched(master)");
        st('sort hev__row hev__u');
        st('drop _merge hev__g hev__u');
        st('replace hev__row = _n');
        rs(`un <- read_input(${rq(name)})`);
        rs(
          'hits <- split(seq_len(nrow(un)), factor(un$hev__g, levels = unique(un$hev__g)))',
        );
        rs(
          'idx <- lapply(g, function(x) if (is.na(x) || is.null(hits[[x]])) NA_integer_ else hits[[x]])',
        );
        rs(
          'ai <- rep(seq_along(g), lengths(idx)); ui <- unlist(idx, use.names = FALSE)',
        );
        rs('d <- d[ai, , drop = FALSE]; rownames(d) <- NULL');
        for (const c of [geoCol, nameCol])
          rs(`d[[${rq(Rn(c))}]] <- un[[${rq(Rn(c))}]][ui]`);
      } else {
        st(`generate ${S(geoCol)} = ""`);
        st(`generate ${S(nameCol)} = ""`);
        st('drop hev__g');
        for (const c of [geoCol, nameCol])
          rs(`d[[${rq(Rn(c))}]] <- rep(NA_character_, nrow(d))`);
      }
      st();
      rs();
    } else if (s.op === 'count') {
      const { report: c, after } = s;
      const noun = LEVEL_NOUN[c.level];
      const located = `inputs/hev_${tag}_located.csv`;
      const areas = `inputs/hev_${tag}_areas.csv`;
      files.push({
        name: located,
        data: csv(
          ['hev__row', 'hev__area'],
          c.located.map((g, i) => [i + 1, g]),
        ),
      });
      const [cg, cn, cs, , cp] = after.columns;
      files.push({
        name: areas,
        data: csv(
          [S(cg), S(cn), S(cs), S(cp)],
          after.rows.map((row) => [row[0], row[1], row[2], row[4]]),
        ),
      });
      say(`Step ${k}. Count the points per ${noun}.`);
      say(
        `   Each point was located in its ${noun} by point-in-polygon against Census TIGER/Line boundaries (${located}).`,
      );
      say(
        `   The table has one row per ${noun} (${areas}: ${after.rows.length.toLocaleString('en-US')} ${noun === 'county' ? 'counties' : `${noun}s`}${c.level === 'tract' ? ' in the counties with points' : c.level === 'county' ? ' in the states with points' : ''}),`,
      );
      say(
        `   with the number of points, the 2020–24 population, and points per 1,000 residents (rounded to 3 decimals).`,
      );
      say(
        `   ${c.withPoints.toLocaleString('en-US')} have points.${c.outside ? ` ${c.outside.toLocaleString('en-US')} points fell outside every ${noun}.` : ''}`,
      );
      say('');
      const [vg, , , vpts, vpop, vrate] = after.columns.map(S);
      st(`* ---- Step ${k}. Count the points per ${noun} ----`);
      st('tempfile counts');
      st('preserve');
      st(
        `import delimited using "${located}", varnames(1) case(preserve) stringcols(_all) encoding("utf-8") clear`,
      );
      st('keep if hev__area != ""');
      st(`generate ${vpts} = 1`);
      st(`collapse (sum) ${vpts}, by(hev__area)`);
      st(`rename hev__area ${vg}`);
      st("save `counts'");
      st('restore');
      st(
        `import delimited using "${areas}", varnames(1) case(preserve) stringcols(_all) encoding("utf-8") bindquotes(strict) clear`,
      );
      st(`destring ${vpop}, replace`);
      st(`merge 1:1 ${vg} using \`counts', keep(master match) nogenerate`);
      st(`replace ${vpts} = 0 if missing(${vpts})`);
      st(
        `generate double ${vrate} = floor(${vpts} / ${vpop} * 1000 * 1000 + 0.5) / 1000 if ${vpop} > 0 & !missing(${vpop})`,
      );
      st(`sort ${vg}`);
      st('generate long hev__row = _n');
      st();
      const R_ = after.columns.map(Rn);
      rs(`# ---- Step ${k}. Count the points per ${noun} ----`);
      rs(`loc <- read_input(${rq(located)}); ar <- read_input(${rq(areas)})`);
      rs(`n <- table(loc$hev__area[!is.na(loc$hev__area)])`);
      rs(
        `d <- data.frame(ar[[${rq(R_[0])}]], ar[[${rq(R_[1])}]], ar[[${rq(R_[2])}]], stringsAsFactors = FALSE); names(d) <- c(${[R_[0], R_[1], R_[2]].map(rq).join(', ')})`,
      );
      rs(
        `d[[${rq(R_[3])}]] <- as.numeric(ifelse(is.na(n[d[[${rq(R_[0])}]]]), 0, n[d[[${rq(R_[0])}]]]))`,
      );
      rs(`d[[${rq(R_[4])}]] <- as_num(ar[[${rq(R_[4])}]])`);
      rs(
        `d[[${rq(R_[5])}]] <- ifelse(!is.na(d[[${rq(R_[4])}]]) & d[[${rq(R_[4])}]] > 0, floor(d[[${rq(R_[3])}]] / d[[${rq(R_[4])}]] * 1000 * 1000 + 0.5) / 1000, NA)`,
      );
      rs(
        `d <- d[order(d[[${rq(R_[0])}]]), , drop = FALSE]; rownames(d) <- NULL`,
      );
      rs();
    }
  }

  // Labels, order and the check, in Stata.
  const fin = final.columns;
  st('* ---- Labels ----');
  fin.forEach((c, j) => {
    if (c.label)
      st(`label variable ${S(c)} ${sq(String(c.label).slice(0, 80))}`);
    const codes = Object.entries(c.valueLabels || {}).filter(([v]) =>
      Number.isInteger(Number(v)),
    );
    if (c.kind !== 'string' && codes.length) {
      st(
        `label define hev_l${j + 1} ${codes.map(([v, t]) => `${v} ${sq(t)}`).join(' ')}, replace`,
      );
      st(`label values ${S(c)} hev_l${j + 1}`);
    }
  });
  st();
  st('* ---- Order, then check against the delivered file ----');
  st('sort hev__row');
  st(`keep ${fin.map(S).join(' ')}`);
  st(`order ${fin.map(S).join(' ')}`);
  st(`assert _N == ${final.rows.length}`);
  // Fingerprints of each variable: its count of values, its sum, and its sum
  // weighted by row number (so rows out of order fail too); for text, the
  // count filled in and the row-weighted sum of lengths in characters.
  // Stata counts dates from 1960 (days, or ms for times); R's POSIXct is
  // seconds.
  const shift = { date: 3653, datetime: 3653 * 86_400_000 };
  const prints = fin.map((c, j) => {
    const values = final.rows.map((row) => row[j]);
    if (c.kind === 'string') {
      let count = 0;
      let wlen = 0;
      values.forEach((v, i) => {
        if (v === null || v === '') return;
        count += 1;
        wlen += (i + 1) * [...String(v)].length;
      });
      return { c, count, wlen };
    }
    const p = { c, count: 0, stata: [0, 0], r: [0, 0] };
    values.forEach((v, i) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      p.count += 1;
      const sv = v + (shift[c.kind] || 0);
      const rv = c.kind === 'datetime' ? v / 1000 : v;
      p.stata[0] += sv;
      p.stata[1] += sv * (i + 1);
      p.r[0] += rv;
      p.r[1] += rv * (i + 1);
    });
    return p;
  });
  const close = (expected) => `reldif(r(sum), ${String(expected)}) < 1e-9`;
  for (const p of prints) {
    const v = S(p.c);
    if (p.c.kind === 'string') {
      st(`quietly count if ${v} != ""`);
      st(`assert r(N) == ${p.count}`);
      if (p.count) {
        st(`generate double hev__w = ustrlen(${v}) * _n`);
        st('quietly summarize hev__w');
        st(`assert ${close(p.wlen)}`);
        st('drop hev__w');
      }
    } else {
      st(`quietly summarize ${v}`);
      st(`assert r(N) == ${p.count}`);
      if (p.count) {
        st(`assert ${close(p.stata[0])}`);
        st(`generate double hev__w = ${v} * _n`);
        st('quietly summarize hev__w');
        st(`assert ${close(p.stata[1])}`);
        st('drop hev__w');
      }
    }
  }
  if (format === 'dta') {
    st('tempfile rebuilt');
    st("save `rebuilt'");
    st(`capture confirm file "${stem}_merged.dta"`);
    st('if _rc == 0 {');
    st(`    use "${stem}_merged.dta", clear`);
    st("    cf _all using `rebuilt'");
    st("    use `rebuilt', clear");
    st('}');
  }
  st(
    `display as result "Rebuilt ${final.rows.length} rows and ${fin.length} variables; every check passed."`,
  );
  st(`save "${stem}_merged_rebuilt.dta", replace`);
  // R: order and the same checks.
  rs('# ---- Order, then check against the delivered file ----');
  rs(`d <- d[, c(${fin.map((c) => rq(Rn(c))).join(', ')}), drop = FALSE]`);
  rs(`stopifnot(nrow(d) == ${final.rows.length})`);
  rs('near <- function(a, b) abs(a - b) <= 1e-9 * max(1, abs(b))');
  rs('check_text <- function(v, n, w) {');
  rs('  x <- d[[v]]; filled <- !is.na(x) & x != ""');
  rs(
    '  if (sum(filled) != n || (n > 0 && !near(sum(nchar(x[filled], type = "chars") * which(filled)), w))) stop("Check failed for ", v)',
  );
  rs('}');
  rs('check_number <- function(v, n, s, w) {');
  rs('  x <- as.numeric(d[[v]]); ok <- !is.na(x)');
  rs(
    '  if (sum(ok) != n || (n > 0 && (!near(sum(x[ok]), s) || !near(sum(x[ok] * which(ok)), w)))) stop("Check failed for ", v)',
  );
  rs('}');
  for (const p of prints)
    rs(
      p.c.kind === 'string'
        ? `check_text(${rq(Rn(p.c))}, ${p.count}, ${p.wlen})`
        : `check_number(${rq(Rn(p.c))}, ${p.count}, ${String(p.r[0])}, ${String(p.r[1])})`,
    );
  // R's own names (as in the .RData file), then the labels.
  rs(`names(d) <- c(${fin.map((c) => rq(rName.get(c.uid))).join(', ')})`);
  for (const c of fin)
    if (c.label)
      rs(`attr(d[[${rq(rName.get(c.uid))}]], "label") <- ${rq(c.label)}`);
  rs(
    `cat("Rebuilt ${final.rows.length} rows and ${fin.length} variables; every check passed.\\n")`,
  );
  rs(`hev_data <- d`);
  rs(`save(hev_data, file = "${stem}_merged_rebuilt.RData")`);

  if (shapes) {
    say('The shapefile');
    say(`   Its shapes are your original file's own geography: ${shapes}.`);
    say(
      '   Every row keeps the shape of the row of your file it came from; rows that came only from',
    );
    say(
      '   another file, and rows without an ID, location or matching outline, have no (null) shape.',
    );
    say(
      '   Coordinates are WGS 84 longitude/latitude (.prj). Column names are shortened to 10',
    );
    say(
      '   characters as dBase requires (codebook.csv gives each one’s full name). The do-file and',
    );
    say(
      '   R script rebuild the attribute table; in Stata, spshape2dta reads the shapefile itself.',
    );
    say('');
  }
  say('Checking it');
  say(
    `   The delivered file has ${final.rows.length.toLocaleString('en-US')} rows and ${fin.length} variables (codebook.csv lists them all).`,
  );
  say(
    `   ${stem}_merge.do and ${stem}_merge.R rebuild it from inputs/ and stop with an error unless every`,
  );
  say(
    '   variable has the same number of values, the same sum and the same sum weighted by row number',
  );
  say(
    '   (text: the same number filled in, and the same row-weighted length), so values that differ',
  );
  say(
    `   or rows out of order are caught${format === 'dta' ? "; the do-file also compares every value with Stata's cf" : ''}.`,
  );
  say(`   They save the rebuilt data as ${stem}_merged_rebuilt.dta / .RData.`);
  say('');
  say(
    'Terms: every attached dataset keeps its own terms (see the sources above and codebook.csv).',
  );
  say(
    'Mapping Inequality’s HOLC maps are CC BY-NC-SA 4.0 (non-commercial, share alike). Your own files',
  );
  say(`never left your computer: ${appName} did the merge in the browser.`);

  files.push({ name: `${stem}_merge.do`, data: `${stata.join('\r\n')}\r\n` });
  files.push({ name: `${stem}_merge.R`, data: `${r.join('\n')}\n` });
  files.push({ name: `${stem}_steps.txt`, data: `${text.join('\r\n')}\r\n` });
  return { files, stem };
}
