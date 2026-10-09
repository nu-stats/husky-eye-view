/**
 * Plain English to Stata or R: "spatial regression DV=homicide_counts IV:
 * poverty rate, unemployment rate, percent foreign-born" becomes the lines
 * the analysis box runs. Rule-based (no AI service), and meant to be
 * forgiving about wording:
 *
 *  - analyses: OLS / linear regression, logistic, Poisson, negative
 *    binomial, spatial lag / error / both (contiguity or inverse-distance
 *    weights, ML or GS2SLS), summaries, correlations, frequencies, tables,
 *    scatter plots, histograms, standardizing, group means and ranks (egen),
 *    contiguity weights on their own;
 *  - roles: "DV=y IV: a, b", "dependent variable y; predictors a and b",
 *    "y on a and b", "effect of a and b on y", "y as a function of a",
 *    "y explained by a", "use a and b to predict y", "plot y against x";
 *  - conditions: "where poverty is over 20", "only tracts with population
 *    at least 1,000", "valid data only";
 *  - options: robust or clustered standard errors, odds ratios, incidence
 *    rate ratios, standardized coefficients;
 *  - several requests at once, one per line or joined with "then".
 *
 * Each phrase is matched to a variable by its name, label, short name or
 * aliases. The lines go into the box for review before anything runs;
 * phrases it cannot match are named.
 */

const STOP = new Set([
  'the',
  'of',
  'a',
  'an',
  'in',
  'for',
  'to',
  'by',
  'with',
  'all',
  'level',
  'variable',
  'variables',
  'values',
  'value',
]);

/** Words for the same idea, so "percent" meets "%" and "share". */
const SYNONYMS = new Map([
  ['percent', 'pct'],
  ['percentage', 'pct'],
  ['%', 'pct'],
  ['share', 'pct'],
  ['proportion', 'pct'],
  ['pct', 'pct'],
  ['counts', 'count'],
  ['number', 'count'],
  ['num', 'count'],
  ['homicides', 'homicide'],
  ['murders', 'homicide'],
  ['murder', 'homicide'],
  ['immigrants', 'immigrant'],
  ['immigration', 'immigrant'],
  ['renters', 'renter'],
  ['renting', 'renter'],
  ['rent', 'renter'],
  ['rental', 'renter'],
  ['rented', 'renter'],
  ['bachelor', 'bachelors'],
  ["bachelor's", 'bachelors'],
  ['college', 'bachelors'],
  ['jobless', 'unemployment'],
  ['unemployed', 'unemployment'],
  ['poor', 'poverty'],
  ['latino', 'hispanic'],
  ['latinx', 'hispanic'],
  ['african', 'black'],
  ['cars', 'vehicle'],
  ['car', 'vehicle'],
  ['vehicles', 'vehicle'],
  ['pop', 'population'],
]);

/** Words too general to pick a variable on their own. */
const GENERIC = new Set([
  'pct',
  'rate',
  'count',
  'people',
  'residents',
  'households',
  'homes',
  'total',
  'adults',
  'average',
  'mean',
  'median',
  'typical',
  'what',
  'is',
  'are',
  'show',
  'me',
]);

/** The words of a phrase, normalized ("Foreign-born, %" -> foreign born pct). */
export function phraseTokens(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/%/g, ' % ')
      .replace(/[_\-–/(),.:;'"]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => SYNONYMS.get(w) || w)
      // A light stem, the same on both sides: "clustering" meets "cluster".
      .map((w) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w))
      .map((w) =>
        w.length > 4 && w.endsWith('s') && !w.endsWith('ss')
          ? w.slice(0, -1)
          : w,
      )
      .filter((w) => !STOP.has(w) && !/^\d+$/.test(w))
  );
}

/** Whether a word agrees with a token: the same, or one abbreviates the other ("exp"). */
const wordMeets = (word, token) =>
  word === token ||
  (Math.min(word.length, token.length) >= 3 &&
    (token.startsWith(word) || word.startsWith(token)));

/**
 * The variable a phrase means, or null: an exact name first, then the best
 * word overlap with its name, label, short name and aliases (ties go to the
 * shorter name, so "foreign_born_share" beats "foreign_born_share_2010").
 */
export function matchVariable(
  phrase,
  variables,
  { exclude = new Set(), numeric = false } = {},
) {
  const clean = String(phrase || '')
    .trim()
    .replace(/^(?:the|a|an)\s+/i, '');
  if (!clean) return null;
  // Not one already used in this request; numbers only where the
  // analysis needs them (a correlation of a text field is no correlation).
  const usable = variables.filter(
    (v) => !exclude.has(v.name) && !(numeric && v.kind === 'string'),
  );
  const asName = clean.replace(/\s+/g, '_').toLowerCase();
  const exact = usable.find((v) => v.name.toLowerCase() === asName);
  if (exact) return exact;
  const words = phraseTokens(clean);
  if (!words.length) return null;
  let best = null;
  for (const v of usable) {
    const texts = [v.name, v.label, v.short, ...(v.aliases || [])].filter(
      Boolean,
    );
    let score = 0;
    for (const text of texts) {
      const theirs = [...new Set(phraseTokens(text))];
      if (!theirs.length) continue;
      const meets = (w) => theirs.some((t) => wordMeets(w, t));
      const hits = words.filter(meets).length;
      // At least one topic word must agree ("rent", not just "share").
      if (!words.some((w) => meets(w) && !GENERIC.has(w))) continue;
      const covered = theirs.filter((t) => words.some((w) => wordMeets(w, t)));
      score = Math.max(
        score,
        (hits / words.length) * 2 + covered.length / theirs.length,
      );
    }
    if (score < 1) continue; // at least about half the phrase
    if (
      !best ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) < 1e-9 &&
        v.name.length < best.v.name.length)
    )
      best = { v, score };
  }
  return best?.v || null;
}

const splitList = (text) =>
  String(text || '')
    .split(/\s*(?:,|;|\+|&|\band\b|\bplus\b|\bas well as\b)\s*/i)
    .map((s) => s.replace(/^(?:and|the|of)\s+/i, '').trim())
    .filter(Boolean);

/** A variable holding counts: "homicide_counts", "Homicides (count)", "Number of …". */
function isCount(variable) {
  if (!variable) return false;
  return (
    /(?:^|_)(?:counts?|num|number|n)(?:_|$)/i.test(variable.name) ||
    /\bcounts?\b|\bnumber of\b/i.test(variable.label || '')
  );
}

/** What kind of analysis a request asks for, with its options. */
export function analysisKind(text) {
  const t = String(text).toLowerCase();
  const options = {
    robust: /\brobust\b|heteroskedastic|huber|white standard/.test(t),
    cluster: (t.match(
      /cluster(?:ed)?(?: standard errors)?(?: by| on)?\s+([\w\s-]+?)(?:$|,|;|\bwhere\b|\bif\b)/,
    ) || [])[1],
    odds: /odds ratio/.test(t),
    irr: /incidence rate ratio|\birr\b/.test(t),
    beta: /standardi[sz]ed (?:coefficient|beta)|\bbeta coefficients?\b/.test(t),
  };
  if (/\bspatial\b|\bsar\b|\bspatially\b|\bsem\b|\bsarar\b/.test(t)) {
    const lag = /\blag\b|autoregressive|\bsar\b|durbin|\bsarar\b/.test(t);
    const error = /\berrors?\b|\bsem\b|\bsarar\b|\bboth\b/.test(t);
    if (
      /^(?:build|make|create)?\s*(?:spatial\s+)?(?:contiguity|weights)/.test(t)
    )
      return { model: 'weights', rook: /\brook\b/.test(t), ...options };
    return {
      model: 'spatial',
      lag: lag || !error,
      error,
      distance: /distance/.test(t),
      rook: /\brook\b/.test(t),
      gs2sls: /gs2sls|two[- ]stage|2sls|\bgmm\b/.test(t),
      ...options,
    };
  }
  if (/\b(?:contiguity|neighbou?r) (?:weights|matrix)\b/.test(t))
    return { model: 'weights', rook: /\brook\b/.test(t), ...options };
  if (/negative binomial|\bnbreg\b|\bnegbin\b|overdispers/.test(t))
    return { model: 'nbreg', ...options };
  if (/poisson|count model|count regression/.test(t))
    return { model: 'poisson', ...options };
  if (/logistic|\blogit\b|binary outcome/.test(t))
    return { model: 'logit', ...options };
  if (
    /regress|\bols\b|linear model|linear regression|least squares|\bpredict|effect of|impact of|influence of|as a function of|explained by|\bmodel\b/.test(
      t,
    )
  )
    return {
      model: 'regress',
      // "regress", "OLS" or "linear" asks for OLS by name; "effect of" or
      // "predict" leaves the model to the outcome (counts get Poisson).
      linear: /\bregress\b|\bols\b|linear|least squares/.test(t),
      ...options,
    };
  if (/standardi[sz]e|z[- ]?scores?/.test(t)) return { model: 'std' };
  if (/\brank\b/.test(t)) return { model: 'rank' };
  if (
    /(?:mean|average|median|total|sum) of .+ (?:by|for each|within|across)\b/.test(
      t,
    )
  )
    return { model: 'groupstat' };
  if (/correlat/.test(t)) return { model: 'correlate' };
  if (/histogram|distribution of/.test(t)) return { model: 'histogram' };
  if (/scatter|\bplot\b|\bgraph\b|against/.test(t)) return { model: 'scatter' };
  if (/cross[- ]?tab|tabulat|\btab\b|\btable\b/.test(t))
    return { model: 'tab' };
  if (/frequenc|\bfre\b|how many|counts? of/.test(t)) return { model: 'fre' };
  if (
    /summar|describe|descriptive|mean|average|median|typical|statistics|stats/.test(
      t,
    )
  )
    return { model: 'summarize' };
  return null;
}

const OPERATORS = [
  [/^(?:>=|at least|no less than|or more)$/i, '>='],
  [/^(?:<=|at most|no more than|or less)$/i, '<='],
  [/^(?:!=|<>|is not|not equal to|not)$/i, '!='],
  [
    /^(?:>|over|above|greater than|more than|higher than|exceeds?|exceeding)$/i,
    '>',
  ],
  [/^(?:<|under|below|less than|fewer than|lower than)$/i, '<'],
  [/^(?:==|=|equals?|equal to|is)$/i, '=='],
];
const OPERATOR_WORDS =
  '>=|<=|!=|<>|==|=|>|<|at least|at most|no less than|no more than|is not|not equal to|greater than|more than|higher than|less than|fewer than|lower than|exceeds|exceeding|exceed|over|above|under|below|equals|equal to|is';

/**
 * Split a request into what to run and its condition:
 * "... where poverty is over 20 and population at least 1,000".
 */
export function conditionOf(text) {
  const m = String(text).match(
    /\s*(?:,\s*)?\b(?:where|if|only (?:for |in |among )?(?:areas?|tracts?|counties|county|states?|places?|rows?|observations?)?\s*(?:with|where|that have|having)?|for (?:areas?|tracts?|counties|states?) (?:with|where)|among (?:areas?|tracts?|counties|states?)? ?(?:with|where)?|restricted to|limited to)\s+(.+)$/i,
  );
  if (!m) return { rest: String(text), condition: null };
  return { rest: String(text).slice(0, m.index), condition: m[1].trim() };
}

/** Condition text to Stata pieces: [{phrase, op, value}] or {valid: true}. */
export function conditionParts(condition) {
  if (!condition) return [];
  if (/^(?:valid|non-?missing|complete)\b/i.test(condition))
    return [{ valid: true }];
  const parts = [];
  // Commas split conditions, but not thousands ("1,000").
  for (const piece of condition.split(/\s+and\s+|\s*,(?!\d{3}\b)\s*/i)) {
    const m = piece.match(
      new RegExp(
        `^(.*?)\\s*(?<![A-Za-z])(${OPERATOR_WORDS})\\s*(-?[\\d.,]+)\\s*%?(?:\\s+or (?:more|less))?\\s*$`,
        'i',
      ),
    );
    if (!m) {
      if (/valid|missing|complete/i.test(piece)) parts.push({ valid: true });
      else parts.push({ phrase: piece.trim(), op: null, value: null });
      continue;
    }
    let op = OPERATORS.find(([re]) => re.test(m[2].trim()))?.[1] || '==';
    if (/or more\s*$/i.test(piece)) op = '>=';
    if (/or less\s*$/i.test(piece)) op = '<=';
    parts.push({
      phrase: m[1].replace(/\b(?:is|are|was)\s*$/i, '').trim(),
      op,
      value: Number(m[3].replace(/,/g, '')),
    });
  }
  return parts;
}

/**
 * The outcome and predictor phrases of a model or plot request, and the
 * plain variable list of anything else.
 */
export function rolesOf(text) {
  const t = String(text)
    .replace(/\s+/g, ' ')
    .replace(
      /,?\s*\b(?:using |with )?(?:robust|clustered|cluster(?:ed)?)\b.*$/i,
      '',
    )
    .replace(
      /,?\s*(?:reporting |show(?:ing)? |as )?(?:odds ratios|incidence rate ratios|standardi[sz]ed coefficients)\b.*$/i,
      '',
    )
    .replace(
      /,?\s*(?:with |using )?(?:queen|rook|contiguity|inverse[- ]distance|distance)(?: contiguity)?(?: weights| matrix)?\b/gi,
      '',
    )
    .trim();
  const DV =
    /\b(?:dv|d\.v\.|dependent(?: variable)?|outcomes?(?: variable)?|response(?: variable)?|y)\s*(?:=|:|is|\s)\s*/i;
  const IV =
    /\b(?:ivs?|i\.v\.s?|independent(?: variables?)?|predictors?|covariates?|controls?|controlling for|regressors?|explanatory(?: variables?)?|x)\s*(?:=|:|are|is|\s)\s*/i;
  const dv = t.match(DV);
  const iv = t.match(IV);
  if (dv || iv) {
    const dvStart = dv ? dv.index + dv[0].length : -1;
    const ivStart = iv ? iv.index + iv[0].length : -1;
    const outcome =
      dvStart >= 0
        ? t.slice(dvStart, iv && iv.index > dvStart ? iv.index : undefined)
        : '';
    const predictors =
      ivStart >= 0
        ? t.slice(ivStart, dv && dv.index > ivStart ? dv.index : undefined)
        : '';
    return {
      outcome: outcome
        .replace(/[,;\s]+$/, '')
        .replace(/\band\s*$/i, '')
        .trim(),
      predictors: splitList(predictors.replace(/[,;\s]+$/, '')),
    };
  }
  const verb =
    /^.*?\b(?:regressions?|regress|models?|ols|logit|logistic|poisson|binomial|nbreg|spatial(?: lag| error)?(?: model| regression)?|lag model|error model|sar|sem)\b(?:\s+(?:model|regression|of|for))*\s+/i;
  let m;
  // "effect of a and b on y", "relationship between a and y" (first is x).
  if (
    (m = t.match(
      /\b(?:effects?|impacts?|influence|associations?|relationships?)\s+of\s+(.+?)\s+(?:on|with)\s+(.+)$/i,
    ))
  )
    return { outcome: m[2].trim(), predictors: splitList(m[1]) };
  // "use a and b to predict y"
  if (
    (m = t.match(
      /\b(?:use|using)\s+(.+?)\s+to (?:predict|explain|model)\s+(.+)$/i,
    ))
  )
    return { outcome: m[2].trim(), predictors: splitList(m[1]) };
  // "y as a function of a", "y explained by a", "y predicted by a"
  if (
    (m = t.match(
      /^(.*?)\s+(?:as a function of|explained by|predicted by|regressed on|depending on|against|versus|vs\.?)\s+(.+)$/i,
    ))
  )
    return {
      outcome: m[1]
        .replace(verb, '')
        .replace(/^(?:plot|scatter(?: plot)?(?: of)?|graph)\s+/i, '')
        .trim(),
      predictors: splitList(m[2]),
    };
  // "regress y on a and b"
  if ((m = t.match(/^(.*?)\s+on\s+(.+)$/i)))
    return {
      outcome: m[1]
        .replace(verb, '')
        .replace(/^(?:of|for)\s+/i, '')
        .trim(),
      predictors: splitList(m[2]),
    };
  // "what predicts y" / "predictors of y" (no predictors named).
  if (
    (m = t.match(
      /\b(?:what predicts|predict|predictors of|model of|explain)\s+(.+)$/i,
    ))
  )
    return { outcome: m[1].trim(), predictors: [] };
  // Anything else: everything after the verb is the variable list.
  const list = stripFiller(t).replace(
    /^.*?\b(?:summari[sz]e|summary(?: statistics)?(?: of| for)?|descriptive statistics(?: of| for)?|describe|stats(?: of| for)?|statistics(?: of| for)?|(?:the )?(?:average|averages|mean|means|median|medians|typical)(?: values?)? (?:of|for)|correlate|correlations?(?: of| between| among)?|tabulate|cross[- ]?tab(?:ulate)?|tab|table(?: of)?|frequenc(?:y|ies)(?: of| for)?|fre|how many|histogram(?: of)?|distribution of|scatter(?: plot)?(?: of)?|plot|graph|standardi[sz]e|z[- ]?scores?(?: of| for)?|rank)\s+/i,
    '',
  );
  return { outcome: '', predictors: splitList(list) };
}

/** Words around a request that carry no meaning ("what is", "show me"). */
export function stripFiller(text) {
  return String(text)
    .trim()
    .replace(
      /^(?:(?:please|hey|ok|okay|so|now|and|then)[,\s]+)*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:what(?:'s| is| are| was| were)?|which|show(?: me)?|give(?: me)?|tell(?: me)?|display|list|compute|calculate|find|get|i (?:want|need|would like)(?: to see| to know)?|let me see|let's see|run|do)\s+/i,
      '',
    )
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/[?!.]+$/, '')
    .trim();
}

/** A new variable's name from an old one (at most 32 characters). */
const newName = (prefix, name) => `${prefix}_${name}`.slice(0, 32);

/**
 * Translate a request (one or more, by line or "then"). Returns {ok, lines,
 * matched: [{phrase, name}], problems}; `engine` is 'stata', 'r', 'spss'
 * or 'excel'.
 */
export function translatePlainEnglish(text, variables = [], engine = 'stata') {
  const requests = String(text || '')
    .split(/\n+|;\s*then\s+|,?\s+then\s+|\.\s+(?=[A-Z])/i)
    .map((s) => s.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean);
  if (!requests.length)
    return { ok: false, lines: [], matched: [], problems: ['Type a request.'] };
  const lines = [];
  const matched = [];
  const problems = [];
  const known = [...variables];
  for (const request of requests) {
    const one = translateOne(request, known, engine);
    matched.push(...one.matched);
    problems.push(...one.problems);
    lines.push(...one.lines);
    // Variables a request makes (egen) can be used by the next one.
    for (const name of one.created || [])
      known.push({ name, label: name.replace(/_/g, ' '), kind: 'numeric' });
  }
  // One shapefile link per session, before its first use.
  const seen = new Set();
  const unique = lines.filter((line) => {
    if (!/^spshape2dta /.test(line)) return true;
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });
  return {
    ok: !problems.length,
    lines: problems.length ? [] : unique,
    matched,
    problems,
  };
}

function translateOne(request, variables, engine) {
  const problems = [];
  const matched = [];
  let kind = analysisKind(request);
  // "how many tracts": the count of areas, by state when there is one.
  if (
    /\bhow many\s+(?:areas?|tracts?|counties|county|states?|rows?|places?|observations?|districts?)\b/i.test(
      request,
    ) &&
    variables.some((v) => v.name === 'state')
  )
    return {
      lines: [
        {
          r: 'table(d$state)',
          spss: 'FREQUENCIES VARIABLES=state',
          excel: 'FREQUENCY state',
        }[engine] || 'tab state',
      ],
      matched,
      problems,
    };
  // Just variable names ("median income", "show me poverty and rent"):
  // their summary statistics.
  if (!kind) {
    const phrases = splitList(stripFiller(conditionOf(request).rest));
    if (phrases.length && phrases.every((p) => matchVariable(p, variables)))
      kind = { model: 'summarize' };
  }
  if (kind?.model === 'summarize')
    kind.detail = /median|percentile|quartile|detail|distribution/i.test(
      request,
    );
  if (!kind)
    return {
      lines: [],
      matched,
      problems: [
        `“${request}”: say which analysis — regression, logistic, Poisson, negative binomial, spatial regression, summarize, correlate, frequencies, tabulate, scatter plot, histogram, standardize, or contiguity weights.`,
      ],
    };
  // Tables and frequencies take text fields; everything else needs numbers.
  const needsNumbers = !['tab', 'fre'].includes(kind.model);
  const used = new Set();
  const pick = (phrase, { numeric = needsNumbers, reuse = false } = {}) => {
    // "median income" is a variable; "average poverty" is poverty.
    const find = (opts) =>
      matchVariable(phrase, variables, opts) ||
      matchVariable(
        phrase.replace(/^(?:the\s+)?(?:average|mean|median|typical)\s+/i, ''),
        variables,
        opts,
      );
    const v = find({ exclude: reuse ? new Set() : used, numeric });
    if (v) {
      if (!reuse) used.add(v.name);
      matched.push({ phrase, name: v.name });
      return v.name;
    }
    const text = numeric && find({ exclude: used, numeric: false });
    problems.push(
      text
        ? `“${phrase}” matches ${text.name}, which is text, not a number: try “tabulate ${text.name}”.`
        : `No variable matches “${phrase}”.`,
    );
    return null;
  };
  if (kind.cluster) kind.clusterName = pick(kind.cluster, { numeric: false });
  const { rest, condition } = conditionOf(request);
  const roles = rolesOf(rest);
  const isModel = ['regress', 'logit', 'poisson', 'nbreg', 'spatial'].includes(
    kind.model,
  );
  let y = null;
  let xs = [];
  if (kind.model === 'weights') {
    // Weights only: no variables needed.
  } else if (isModel || kind.model === 'scatter') {
    let { outcome, predictors } = roles;
    if (!outcome && predictors.length >= 2)
      [outcome, ...predictors] = predictors;
    if (!outcome) problems.push('Name the outcome (for example DV = poverty).');
    else y = pick(outcome);
    // A count outcome (homicides, cases) is modeled as counts, not OLS,
    // unless OLS was asked for by name.
    if (kind.model === 'regress' && !kind.linear && y) {
      const v = variables.find((item) => item.name === y);
      if (isCount(v)) kind.model = 'poisson';
    }
    if (!predictors.length)
      problems.push(
        'Name the predictors (for example IV: unemployment, income).',
      );
    xs = predictors.map(pick).filter(Boolean);
  } else if (kind.model === 'groupstat') {
    const m = rest.match(
      /\b(mean|average|median|total|sum) of (.+?) (?:by|for each|within|across) (.+)$/i,
    );
    if (m) {
      y = pick(m[2]);
      xs = [pick(m[3], { numeric: false })].filter(Boolean);
      kind.stat = {
        mean: 'mean',
        average: 'mean',
        median: 'median',
        total: 'total',
        sum: 'total',
      }[m[1].toLowerCase()];
    } else problems.push('Say it as “mean of X by Y”.');
  } else {
    xs = roles.predictors.map(pick).filter(Boolean);
    if (!roles.predictors.length) problems.push('Name the variables.');
  }
  // The condition: comparisons, or valid data only.
  const conditions = [];
  let validOnly = false;
  for (const part of conditionParts(condition)) {
    if (part.valid) {
      validOnly = true;
      continue;
    }
    if (part.op === null) {
      problems.push(
        `Could not read the condition “${part.phrase}” (try “poverty over 20”).`,
      );
      continue;
    }
    const name = pick(part.phrase, { reuse: true });
    if (name) conditions.push({ name, op: part.op, value: part.value });
  }
  // What SPSS does not do in one line: say so instead of writing something else.
  if (engine === 'spss') {
    if (kind.model === 'spatial' || kind.model === 'weights')
      problems.push(
        'SPSS has no spatial regression or contiguity weights: use Stata or R for that, or MORAN’S I in this panel.',
      );
    if (kind.clusterName)
      problems.push(
        'Clustered standard errors are not offered in SPSS lines: use Stata (vce(cluster …)) for those.',
      );
  }
  // Excel's ToolPak has least squares only.
  if (engine === 'excel') {
    if (kind.model === 'spatial' || kind.model === 'weights')
      problems.push(
        'Excel has no spatial regression: use Stata or R for that, or MORAN’S I in this panel.',
      );
    else if (['logit', 'poisson', 'nbreg'].includes(kind.model))
      problems.push(
        'Excel Analysis has least-squares regression only: use Stata, R or SPSS for logistic, Poisson or negative binomial models.',
      );
    else if (kind.model === 'regress' && (kind.robust || kind.clusterName))
      problems.push(
        'Excel’s regression has no robust or clustered standard errors: use Stata, R or SPSS for those.',
      );
  }
  if (problems.length) return { lines: [], matched, problems };
  const all = [y, ...xs].filter(Boolean);
  const write =
    { r: rLines, spss: spssLines, excel: excelLines }[engine] || stataLines;
  return {
    lines: write(kind, y, xs, all, conditions, validOnly),
    matched,
    problems,
    created:
      kind.model === 'std'
        ? xs.map((x) => newName('z', x))
        : kind.model === 'rank'
          ? xs.map((x) => newName('rank', x))
          : kind.model === 'groupstat' && engine === 'stata'
            ? [newName(kind.stat, y)]
            : [],
  };
}

/**
 * Excel Analysis lines (src/analysis/excelCommands.js). Conditions become
 * the command's own IF clause.
 */
function excelLines(kind, y, xs, all, conditions) {
  const ops = {
    '==': '=',
    '!=': '<>',
    '>': '>',
    '<': '<',
    '>=': '>=',
    '<=': '<=',
  };
  const when = conditions.length
    ? ` IF ${conditions.map((c) => `${c.name} ${ops[c.op]} ${c.value}`).join(' AND ')}`
    : '';
  const list = xs.join(' ');
  switch (kind.model) {
    case 'regress':
      return [`REGRESSION ${y} ON ${list}${when}`];
    case 'correlate':
      return [`CORRELATION ${list}${when}`];
    case 'tab':
    case 'fre':
      return xs.map((x) => `FREQUENCY ${x}${when}`);
    case 'scatter':
      return [`SCATTER ${y} ${xs[0]}${when}`];
    case 'histogram':
      return xs.map((x) => `HISTOGRAM ${x}${when}`);
    case 'std':
      return [`STANDARDIZE ${list}${when}`];
    case 'rank':
      return [`RANK ${list}${when}`];
    case 'groupstat':
      return [
        `${{ mean: 'AVERAGE', median: 'MEDIAN', total: 'SUM' }[kind.stat] || 'AVERAGE'} ${y} BY ${xs[0]}${when}`,
      ];
    default:
      return [`DESCRIPTIVE ${list}${when}`];
  }
}

/**
 * SPSS lines. Conditions become TEMPORARY / SELECT IF for the next command
 * only; SPSS drops cases with missing values itself (listwise).
 */
function spssLines(kind, y, xs, all, conditions) {
  const ops = {
    '==': '=',
    '!=': '~=',
    '>': '>',
    '<': '<',
    '>=': '>=',
    '<=': '<=',
  };
  const select = conditions.length
    ? [
        'TEMPORARY',
        `SELECT IF (${conditions.map((c) => `${c.name} ${ops[c.op]} ${c.value}`).join(' AND ')})`,
      ]
    : [];
  // Each command gets the selection (TEMPORARY lasts for one procedure).
  const each = (lines) => lines.flatMap((line) => [...select, line]);
  const list = xs.join(' ');
  switch (kind.model) {
    case 'regress':
      // Robust standard errors: the same linear model in GENLIN.
      return each([
        kind.robust
          ? `GENLIN ${y} WITH ${list} /MODEL ${list} DISTRIBUTION=NORMAL LINK=IDENTITY /CRITERIA COVB=ROBUST /PRINT MODELINFO FIT SUMMARY SOLUTION`
          : `REGRESSION /STATISTICS COEFF OUTS CI(95) R ANOVA /DEPENDENT ${y} /METHOD=ENTER ${list}`,
      ]);
    case 'logit':
      return each([
        `LOGISTIC REGRESSION VARIABLES ${y} /METHOD=ENTER ${list}${kind.odds ? ' /PRINT=CI(95)' : ''}`,
      ]);
    case 'poisson':
    case 'nbreg':
      return each([
        `GENLIN ${y} WITH ${list} /MODEL ${list} DISTRIBUTION=${kind.model === 'poisson' ? 'POISSON' : 'NEGBIN(MLE)'} LINK=LOG${kind.robust ? ' /CRITERIA COVB=ROBUST' : ''} /PRINT MODELINFO FIT SUMMARY SOLUTION${kind.irr ? '(EXPONENTIATED)' : ''}`,
      ]);
    case 'correlate':
      return each([`CORRELATIONS /VARIABLES=${list} /PRINT=TWOTAIL NOSIG`]);
    case 'tab':
      return each([
        xs.length > 1
          ? `CROSSTABS /TABLES=${xs[0]} BY ${xs[1]}`
          : `FREQUENCIES VARIABLES=${xs[0]}`,
      ]);
    case 'fre':
      return each([`FREQUENCIES VARIABLES=${list}`]);
    case 'scatter':
      return each([`GRAPH /SCATTERPLOT(BIVAR)=${xs[0]} WITH ${y}`]);
    case 'histogram':
      return each(xs.map((x) => `GRAPH /HISTOGRAM=${x}`));
    case 'std':
      return each([
        `DESCRIPTIVES VARIABLES=${xs.map((x) => `${x} (${newName('z', x)})`).join(' ')} /SAVE`,
      ]);
    case 'rank':
      return each(
        xs.map((x) => `RANK VARIABLES=${x} /RANK INTO ${newName('rank', x)}`),
      );
    case 'groupstat':
      return each([
        `MEANS TABLES=${y} BY ${xs[0]} /CELLS=${{ mean: 'MEAN', median: 'MEDIAN', total: 'SUM' }[kind.stat] || 'MEAN'} COUNT`,
      ]);
    default:
      return each([
        kind.detail
          ? `FREQUENCIES VARIABLES=${list} /FORMAT=NOTABLE /STATISTICS=MEAN MEDIAN STDDEV MINIMUM MAXIMUM /PERCENTILES=25 75`
          : `DESCRIPTIVES VARIABLES=${list} /STATISTICS=MEAN STDDEV MIN MAX`,
      ]);
  }
}

function stataLines(kind, y, xs, all, conditions, validOnly) {
  const valid = all.length ? `!missing(${all.join(', ')})` : '';
  const pieces = conditions.map((c) => `${c.name} ${c.op} ${c.value}`);
  if (validOnly && valid) pieces.push(valid);
  const ifClause = pieces.length ? ` if ${pieces.join(' & ')}` : '';
  const options = [];
  if (kind.clusterName) options.push(`vce(cluster ${kind.clusterName})`);
  else if (kind.robust) options.push('vce(robust)');
  if (kind.odds && kind.model === 'logit') options.push('or');
  if (kind.irr && ['poisson', 'nbreg'].includes(kind.model))
    options.push('irr');
  if (kind.beta && kind.model === 'regress') options.push('beta');
  const opts = options.length ? `, ${options.join(' ')}` : '';
  const contiguity = (where) =>
    `spmatrix create contiguity W${where}, normalize(row)${kind.rook ? ' rook' : ''} replace`;
  switch (kind.model) {
    case 'regress':
    case 'logit':
    case 'poisson':
    case 'nbreg':
      return [`${kind.model} ${all.join(' ')}${ifClause}${opts}`];
    case 'spatial': {
      const lags = [
        kind.lag ? 'dvarlag(W)' : '',
        kind.error ? 'errorlag(W)' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const method = kind.gs2sls ? 'gs2sls' : 'ml';
      if (kind.distance)
        // Inverse-distance weights are built for the model automatically.
        return [`spregress ${all.join(' ')}${ifClause}, ${method} ${lags}`];
      // Contiguity weights on exactly the areas the model uses.
      const where = ` if ${[...pieces.filter((p) => p !== valid), valid].join(' & ')}`;
      return [
        'spshape2dta areas',
        contiguity(where),
        `spregress ${all.join(' ')}${where}, ${method} ${lags}`,
      ];
    }
    case 'weights':
      return [
        'spshape2dta areas',
        contiguity(ifClause),
        'spmatrix summarize W',
      ];
    case 'correlate':
      return [`correlate ${xs.join(' ')}${ifClause}`];
    case 'tab':
      return [`tab ${xs.slice(0, 2).join(' ')}${ifClause}`];
    case 'fre':
      return xs.map((x) => `fre ${x}${ifClause}`);
    case 'scatter':
      return [`twoway scatter ${y} ${xs[0]}${ifClause}`];
    case 'histogram':
      return xs.map((x) => `twoway histogram ${x}${ifClause}`);
    case 'std':
      return xs.map((x) => `egen ${newName('z', x)} = std(${x})${ifClause}`);
    case 'rank':
      return xs.map(
        (x) => `egen ${newName('rank', x)} = rank(${x})${ifClause}`,
      );
    case 'groupstat':
      return [
        `egen ${newName(kind.stat, y)} = ${kind.stat}(${y})${ifClause}, by(${xs[0]})`,
      ];
    default:
      return [
        `summarize ${xs.join(' ')}${ifClause}${kind.detail ? ', detail' : ''}`,
      ];
  }
}

// (Robust standard errors in R need the sandwich package; not offered.)
function rLines(kind, y, xs, all, conditions, validOnly) {
  const ops = {
    '==': '==',
    '!=': '!=',
    '>': '>',
    '<': '<',
    '>=': '>=',
    '<=': '<=',
  };
  const rows = conditions.map((c) => `${c.name} ${ops[c.op]} ${c.value}`);
  if (validOnly && all.length)
    rows.push(
      `stats::complete.cases(d[, c(${all.map((x) => `"${x}"`).join(', ')})])`,
    );
  const data = rows.length ? `subset(d, ${rows.join(' & ')})` : 'd';
  const formula = `${y} ~ ${xs.join(' + ')}`;
  const cols = (list) => `c(${list.map((x) => `"${x}"`).join(', ')})`;
  switch (kind.model) {
    case 'regress':
      return [`m <- lm(${formula}, data = ${data})`, 'summary(m)'];
    case 'logit':
      return [
        `m <- glm(${formula}, family = binomial, data = ${data})`,
        kind.odds ? 'exp(coef(m))' : 'summary(m)',
      ];
    case 'poisson':
      return [
        `m <- glm(${formula}, family = poisson, data = ${data})`,
        kind.irr ? 'exp(coef(m))' : 'summary(m)',
      ];
    case 'nbreg':
      return [`m <- glm.nb(${formula}, data = ${data})`, 'summary(m)'];
    case 'spatial': {
      const fn =
        kind.lag && kind.error
          ? 'sacsarlm'
          : kind.error
            ? 'errorsarlm'
            : 'lagsarlm';
      // Spatial models keep the areas with valid values and matching weights.
      return [
        `m <- ${fn}(${formula}, data = d, listw = W, zero.policy = TRUE)`,
        'summary(m)',
      ];
    }
    case 'weights':
      return ['summary(nb)'];
    case 'correlate':
      return [`cor(${data}[, ${cols(xs)}], use = "complete.obs")`];
    case 'tab':
    case 'fre':
      return [
        `table(${xs
          .slice(0, 2)
          .map((x) => `${data}$${x}`)
          .join(', ')})`,
      ];
    case 'scatter':
      return [`plot(${data}$${xs[0]}, ${data}$${y})`];
    case 'histogram':
      return xs.map((x) => `hist(${data}$${x})`);
    case 'std':
      return xs.map((x) => `d$${newName('z', x)} <- as.numeric(scale(d$${x}))`);
    case 'rank':
      return xs.map(
        (x) => `d$${newName('rank', x)} <- rank(d$${x}, na.last = "keep")`,
      );
    case 'groupstat':
      return [
        `aggregate(${y} ~ ${xs[0]}, data = ${data}, FUN = ${kind.stat === 'total' ? 'sum' : kind.stat})`,
      ];
    default:
      return [`summary(${data}[, ${cols(xs)}])`];
  }
}
