import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conditionParts,
  matchVariable,
  translatePlainEnglish,
} from './plainEnglish.js';
import { analysisVariables, checkCommandLines } from './stataCommands.js';
import { checkRLines } from './rCommands.js';

const vars = [
  ...analysisVariables('tract'),
  { name: 'homicide_counts', label: 'Homicides (count)', kind: 'numeric' },
];
const both = (text) => ({
  stata: translatePlainEnglish(text, vars, 'stata'),
  r: translatePlainEnglish(text, vars, 'r'),
});

test('the spatial regression example becomes the same model in Stata and R', () => {
  const { stata, r } = both(
    'spatial regression DV=homicide_counts IV:Poverty rate, unemployment rate, and percent foreign-born',
  );
  const valid =
    '!missing(homicide_counts, poverty, unemployment, foreign_born_share)';
  assert.deepEqual(stata.lines, [
    'spshape2dta areas',
    `spmatrix create contiguity W if ${valid}, normalize(row) replace`,
    `spregress homicide_counts poverty unemployment foreign_born_share if ${valid}, ml dvarlag(W)`,
  ]);
  assert.deepEqual(r.lines, [
    'm <- lagsarlm(homicide_counts ~ poverty + unemployment + foreign_born_share, data = d, listw = W, zero.policy = TRUE)',
    'summary(m)',
  ]);
  assert.deepEqual(
    stata.matched.map((m) => m.name),
    ['homicide_counts', 'poverty', 'unemployment', 'foreign_born_share'],
  );
});

test('many wordings of the same request', () => {
  const regress = 'regress foreign_born_share poverty unemployment';
  for (const text of [
    'regress percent foreign-born on poverty and unemployment',
    'OLS: outcome foreign-born share, predictors poverty rate and unemployment',
    'effect of poverty and unemployment on percent foreign born',
    'foreign born share as a function of poverty and the unemployment rate',
    'use poverty and unemployment to predict % foreign-born',
  ])
    assert.deepEqual(both(text).stata.lines, [regress], text);
});

test('conditions, options and several requests at once', () => {
  assert.deepEqual(
    both(
      'effect of poverty on homicide counts where population is at least 1,000 and poverty over 5',
    ).stata.lines,
    ['regress homicide_counts poverty if population >= 1000 & poverty > 5'],
  );
  assert.deepEqual(
    both('regress poverty on unemployment, robust').stata.lines,
    ['regress poverty unemployment, vce(robust)'],
  );
  assert.deepEqual(
    both('logit renters on poverty with odds ratios clustered by county_fips')
      .stata.lines,
    ['logit renters poverty, vce(cluster county_fips) or'],
  );
  assert.deepEqual(
    both('standardize median income then regress poverty on z_median_income')
      .stata.lines,
    [
      'egen z_median_income = std(median_income)',
      'regress poverty z_median_income',
    ],
  );
  assert.deepEqual(conditionParts('valid data only'), [{ valid: true }]);
});

test('every line it writes passes the Stata and R line checks', () => {
  for (const text of [
    'spatial regression DV=homicide_counts IV: poverty, unemployment, percent foreign-born',
    'spatial error model of poverty on unemployment with inverse distance weights',
    'regress percent foreign-born on poverty and unemployment, robust',
    'poisson model of homicides as a function of poverty rate and median income with incidence rate ratios',
    'negative binomial regression of homicide counts on poverty',
    'logistic regression outcome renters predictors poverty, income',
    'summarize poverty, unemployment and percent foreign born where population over 500',
    'correlation between poverty, unemployment and median household income',
    'scatter plot of foreign born share against poverty',
    'histogram of median income',
    'standardize median income then regress poverty on z_median_income',
    'mean of poverty by county_fips',
    'tabulate state',
    'build contiguity weights',
  ]) {
    const { stata, r } = both(text);
    assert.ok(stata.ok, `${text}: ${stata.problems}`);
    assert.ok(r.ok, `${text}: ${r.problems}`);
    const sc = checkCommandLines(stata.lines, vars);
    assert.deepEqual(sc.problems, [], `Stata: ${text}`);
    const rc = checkRLines(r.lines, vars);
    assert.deepEqual(rc.problems, [], `R: ${text}`);
  }
});

test('unknown phrases and missing parts are named, not guessed', () => {
  const out = translatePlainEnglish('regress poverty on moon phase', vars);
  assert.equal(out.ok, false);
  assert.match(out.problems.join(' '), /moon phase/);
  assert.match(
    translatePlainEnglish('what predicts poverty', vars).problems.join(' '),
    /predictors/,
  );
  assert.match(
    translatePlainEnglish('do something nice', vars).problems.join(' '),
    /say which analysis/,
  );
  // The 2020–24 share wins over the 2006–10 and 2000 ones.
  assert.equal(
    matchVariable('percent foreign-born', vars).name,
    'foreign_born_share',
  );
});

test('abbreviated field names, no variable twice, and text fields named', () => {
  // The Life Expectancy Clusters (tracts) layer's own fields.
  const layer = [
    { name: 'name', label: 'Area name', kind: 'string' },
    { name: 'life_exp_8', label: 'life_exp_8', kind: 'numeric' },
    {
      name: 'cluster_status',
      label: "Life expectancy cluster (Local Moran's I), 2015",
      kind: 'string',
    },
    { name: 'p_value', label: 'p_value', kind: 'numeric' },
  ];
  const ask = 'correlation between life expectancy and clustering';
  const out = translatePlainEnglish(ask, layer);
  assert.equal(out.ok, false);
  assert.deepEqual(
    out.matched.map((m) => m.name),
    ['life_exp_8'],
  );
  assert.match(out.problems.join(' '), /cluster_status, which is text/);
  assert.deepEqual(translatePlainEnglish('tabulate clustering', layer).lines, [
    'tab cluster_status',
  ]);
  assert.deepEqual(
    translatePlainEnglish('summarize life expectancy', layer).lines,
    ['summarize life_exp_8'],
  );
  // With a numeric cluster field (county data) the pair is two variables.
  const county = [
    {
      name: 'life_expectancy',
      label: 'Life expectancy at birth (years), 2019',
      kind: 'numeric',
    },
    { name: 'cluster_p', label: 'cluster_p', kind: 'numeric' },
  ];
  assert.deepEqual(translatePlainEnglish(ask, county).lines, [
    'correlate life_expectancy cluster_p',
  ]);
});
