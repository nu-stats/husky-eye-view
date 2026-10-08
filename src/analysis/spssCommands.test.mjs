import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analysisVariables, stepResults } from './stataCommands.js';
import {
  SPSS_BLOCK_MARK,
  buildSpssSyntax,
  checkSpssLine,
  checkSpssLines,
  isSpssModelLine,
  readableSpssLog,
  spssName,
} from './spssCommands.js';
import { translatePlainEnglish } from './plainEnglish.js';
import { mapChoices } from './analysisMap.js';
import {
  SPSS_DRIVER,
  findSpss,
  prepareSpssSession,
  spssProcessEnv,
} from '../../server/analysis/spssSession.js';

const vars = analysisVariables('tract');
const known = () => new Set(vars.map((v) => v.name));

test('typed SPSS lines may run models, descriptives, tests, graphs and new variables', () => {
  for (const line of [
    'DESCRIPTIVES VARIABLES=foreign_born_share poverty median_income',
    'desc poverty /statistics=mean stddev.',
    'FREQUENCIES VARIABLES=state /ORDER=FREQ',
    'CORRELATIONS /VARIABLES=poverty unemployment bachelors /PRINT=TWOTAIL NOSIG',
    'CROSSTABS /TABLES=state BY name',
    'REGRESSION /DEPENDENT foreign_born_share /METHOD=ENTER poverty unemployment',
    'LOGISTIC REGRESSION VARIABLES renters /METHOD=ENTER poverty',
    'GENLIN poverty WITH bachelors /MODEL bachelors DISTRIBUTION=POISSON LINK=LOG /PRINT SOLUTION(EXPONENTIATED)',
    "T-TEST GROUPS=state('MA' 'RI') /VARIABLES=poverty",
    'GRAPH /SCATTERPLOT(BIVAR)=poverty WITH foreign_born_share',
    'GRAPH /HISTOGRAM=poverty',
    'COMPUTE pov_share = poverty / 100',
    "IF (state = 'MA') ma_poverty = poverty",
    'RECODE poverty (LO THRU 10=1) (10 THRU HI=2) INTO poverty_band',
    'RANK VARIABLES=poverty /RANK INTO rank_poverty',
    'DESCRIPTIVES VARIABLES=poverty (z_poverty) /SAVE',
    'TEMPORARY',
    'SELECT IF (poverty > 5 AND population >= 1000)',
    'SPLIT FILE BY state',
    "VARIABLE LABELS poverty 'Poverty, % of residents. ACS'",
    'MEANS TABLES=poverty BY state /CELLS=MEAN COUNT',
    'COMPUTE x = 0.5 * poverty',
  ])
    assert.equal(checkSpssLine(line, known()).ok, true, line);
});

test('anything that reads or writes files, runs programs or ends early is refused', () => {
  for (const line of [
    "HOST COMMAND=['calc']",
    "GET FILE='C:\\secret.sav'",
    "SAVE OUTFILE='x.sav'",
    "SAVE TRANSLATE OUTFILE='x.csv' /TYPE=CSV",
    "INSERT FILE='evil.sps'",
    "INCLUDE 'evil.sps'",
    'BEGIN PROGRAM PYTHON3',
    'DESCRIPTIVES poverty. HOST COMMAND=calc',
    'FREQUENCIES poverty /WRITE',
    "REGRESSION /DEPENDENT poverty /METHOD=ENTER bachelors /OUTFILE=COVB('x.sav')",
    "CORRELATIONS /VARIABLES=poverty bachelors /MATRIX=OUT('x.sav')",
    "OMS /DESTINATION OUTFILE='x.txt'",
    "OUTPUT EXPORT /PDF DOCUMENTFILE='x.pdf'",
    'SET MXWARNS=0',
    'DEFINE !evil () HOST !ENDDEFINE',
    'DESCRIPTIVES poverty; HOST',
    "CD 'C:\\'",
    "SCRIPT 'x.wwd'",
    'DATASET ACTIVATE x',
    'ERASE FILE=x',
    'DO IF poverty > 5',
    'DESCRIPTIVES "unclosed',
    'NEW FILE',
  ])
    assert.equal(checkSpssLine(line, known()).ok, false, line);
});

test('a session remembers the variables it makes, case-insensitively', () => {
  const run = checkSpssLines(
    [
      'COMPUTE pov_z = poverty / 10.',
      'DESCRIPTIVES VARIABLES=POV_Z',
      'REGRESSION /DEPENDENT foreign_born_share /METHOD=ENTER pov_z',
    ],
    vars,
  );
  assert.equal(run.ok, true, run.problems.join('\n'));
  assert.deepEqual(run.commands[0].creates, ['pov_z']);
  assert.deepEqual(run.commands[1].vars, ['pov_z']);
  assert.equal(run.commands[2].saveFit, true);
  assert.equal(run.commands[2].kind, 'model');
  const bad = checkSpssLines(['TABULATE poverty'], vars);
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /not one of the commands/);
});

test('the syntax loads the data with labels, runs each line as a block and sends models to the map', () => {
  const { commands } = checkSpssLines(
    [
      'REGRESSION /DEPENDENT foreign_born_share /METHOD=ENTER poverty',
      'GENLIN poverty WITH bachelors /MODEL bachelors DISTRIBUTION=POISSON LINK=LOG',
      'COMPUTE pov2 = poverty * 2',
    ],
    vars,
  );
  const rows = [vars.map((v) => (v.kind === 'string' ? 'abcdefghij' : 12.345))];
  const syntax = buildSpssSyntax({
    title: "Husky Eye View: 1 tract in O'Brien. MA",
    variables: vars,
    rows,
    commands,
    folder: 'C:\\x\\y',
  });
  assert.match(syntax, /^\* Husky Eye View: 1 tract in O'Brien, MA\./);
  assert.match(
    syntax,
    /GET DATA\n {2}\/TYPE=TXT\n {2}\/FILE='C:\\x\\y\\data\.csv'/,
  );
  assert.match(syntax, /\n {4}geoid A10\n/);
  assert.match(syntax, /\n {4}poverty F40\.0\n/);
  // 12.345: two digits, three decimals, the point and a sign.
  assert.match(syntax, /FORMATS [^\n]*poverty \(F7\.3\)/);
  assert.match(syntax, /\n {2}\/poverty '/);
  assert.match(syntax, /COMPUTE hev_id = \$CASENUM\./);
  assert.match(syntax, /SAVE OUTFILE='C:\\x\\y\\data\.sav'\./);
  // One block per line, the model given /SAVE for the map.
  assert.match(
    syntax,
    /\* HEV_BLOCK step 1\.\nREGRESSION \/DEPENDENT foreign_born_share \/METHOD=ENTER poverty \/SAVE PRED\(hev_fit1\) RESID\(hev_res1\)\./,
  );
  assert.match(syntax, /\* HEV_BLOCK step 2\.\nGENLIN /);
  assert.doesNotMatch(syntax, /hev_fit2/);
  assert.match(
    syntax,
    /\* HEV_BLOCK results 1\.\nTEMPORARY\.\nSELECT IF NOT MISSING\(hev_res1\)\.\nSAVE TRANSLATE OUTFILE='C:\\x\\y\\map_m1\.csv' [^\n]*\/KEEP=hev_id geoid hev_fit1 hev_res1 \/RENAME=\(hev_fit1 hev_res1 = hev_fit hev_res\)\./,
  );
  assert.match(
    syntax,
    /\* HEV_BLOCK results 2\.\nSAVE TRANSLATE OUTFILE='C:\\x\\y\\map_vars\.csv' [^\n]*\/KEEP=hev_id geoid pov2\./,
  );
  // Every block starts with the marker the driver splits on.
  assert.equal(
    syntax.split('\n').filter((l) => l.startsWith(SPSS_BLOCK_MARK)).length,
    6,
  );
  const open = buildSpssSyntax({
    title: 'Open',
    variables: vars,
    rows,
    folder: 'C:\\x\\y',
    interactive: true,
  });
  assert.match(open, /OMS \/SELECT ALL [^\n]*OUTFILE='C:\\x\\y\\session\.log'/);
  assert.doesNotMatch(open, /HEV_BLOCK step/);
});

test('the driver submits each block, prints its error level and keeps the output files', () => {
  assert.match(SPSS_DRIVER, /import spss/);
  assert.match(SPSS_DRIVER, /MARK = "\* HEV_BLOCK"/);
  assert.match(SPSS_DRIVER, /HEV_STEP %d rc=%d/);
  assert.match(SPSS_DRIVER, /FORMAT=SPV OUTFILE=" \+ q\("output\.spv"\)/);
  assert.match(SPSS_DRIVER, /IMAGEROOT='graph'/);
  assert.match(SPSS_DRIVER, /spss\.StopSPSS\(\)/);
});

test('the log the panel and voice see starts at the first line', () => {
  const log =
    'HEV_LOAD rc=0\nHEV_BEGIN\n\n> DESCRIPTIVES poverty\nDescriptive Statistics\nHEV_STEP 1 rc=0\n\n> REGRESSION /DEPENDENT x\nError # 701\nHEV_STEP 2 rc=3\nHEV_DONE\n';
  assert.equal(
    readableSpssLog(log),
    '> DESCRIPTIVES poverty\nDescriptive Statistics\n\n> REGRESSION /DEPENDENT x\nError # 701\n',
  );
  assert.deepEqual(stepResults(log), [
    { step: 1, rc: 0 },
    { step: 2, rc: 3 },
  ]);
});

test('SPSS is found in its standard places, newest version first, with its Python', () => {
  const files = new Set([
    'C:\\Program Files\\IBM\\SPSS\\Statistics\\26\\stats.exe',
    'C:\\Program Files\\IBM\\SPSS Statistics\\stats.exe',
    'C:\\Program Files\\IBM\\SPSS Statistics\\Python3\\python.exe',
    'C:\\Program Files\\IBM\\SPSS Statistics 30\\stats.exe',
    'C:\\Program Files\\IBM\\SPSS Statistics 30\\Python3\\python.exe',
  ]);
  const listing = {
    'C:\\Program Files\\IBM': ['SPSS', 'SPSS Statistics', 'SPSS Statistics 30'],
    'C:\\Program Files\\IBM\\SPSS\\Statistics': ['26'],
  };
  const found = findSpss({
    env: { ProgramFiles: 'C:\\Program Files' },
    platform: 'win32',
    exists: (f) => files.has(f),
    list: (dir) => listing[dir] || [],
  });
  assert.equal(
    found.path,
    'C:\\Program Files\\IBM\\SPSS Statistics 30\\stats.exe',
  );
  assert.equal(found.version, 30);
  assert.equal(
    found.python,
    'C:\\Program Files\\IBM\\SPSS Statistics 30\\Python3\\python.exe',
  );
  const given = findSpss({
    env: { HEV_SPSS_PATH: 'D:\\SPSS' },
    platform: 'win32',
    exists: (f) => f === 'D:\\SPSS\\stats.exe',
    list: () => [],
  });
  assert.equal(given.path, 'D:\\SPSS\\stats.exe');
  assert.equal(given.python, null);
  assert.equal(
    findSpss({
      env: {},
      platform: 'win32',
      exists: () => false,
      list: () => [],
    }),
    null,
  );
  const env = spssProcessEnv(found, { Path: 'C:\\Windows' });
  assert.match(env.Path, /^C:\\Program Files\\IBM\\SPSS Statistics 30;/);
});

test('an SPSS session folder holds the data and the syntax; a bad line is refused', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hev-spss-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { HEV_ANALYSIS_DIR: root };
  const run = prepareSpssSession(
    { geography: 'state', commands: ['DESCRIPTIVES VARIABLES=segregation_bw'] },
    { env },
  );
  assert.equal(run.ok, true, run.problems?.join(' '));
  assert.equal(run.session.doName, 'analysis.sps');
  const syntax = readFileSync(
    path.join(run.session.folder, 'analysis.sps'),
    'utf8',
  );
  // A byte-order mark, so SPSS reads the labels as UTF-8.
  assert.equal(syntax.charCodeAt(0), 0xfeff);
  assert.match(syntax, /DESCRIPTIVES VARIABLES=segregation_bw\./);
  // States: two-letter codes, so the string widths come from the data.
  assert.match(syntax, /\n {4}state A2\n/);
  const open = prepareSpssSession(
    { geography: 'state', interactive: true },
    { env },
  );
  assert.equal(open.ok, true);
  assert.equal(open.session.doName, 'open.sps');
  const refused = prepareSpssSession(
    { geography: 'state', commands: ["HOST COMMAND=['calc']"] },
    { env },
  );
  assert.equal(refused.ok, false);
});

test('plain English becomes SPSS syntax that passes the line checks', () => {
  const both = (text) => translatePlainEnglish(text, vars, 'spss');
  assert.deepEqual(
    both('regress percent foreign-born on poverty and unemployment').lines,
    [
      'REGRESSION /STATISTICS COEFF OUTS CI(95) R ANOVA /DEPENDENT foreign_born_share /METHOD=ENTER poverty unemployment',
    ],
  );
  assert.deepEqual(
    both(
      'effect of poverty on percent foreign born where population is at least 1,000',
    ).lines,
    [
      'TEMPORARY',
      'SELECT IF (population >= 1000)',
      'REGRESSION /STATISTICS COEFF OUTS CI(95) R ANOVA /DEPENDENT foreign_born_share /METHOD=ENTER poverty',
    ],
  );
  assert.deepEqual(
    both('what is the average %foreign-born and poverty rate').lines,
    [
      'DESCRIPTIVES VARIABLES=foreign_born_share poverty /STATISTICS=MEAN STDDEV MIN MAX',
    ],
  );
  assert.match(
    both('spatial regression DV = poverty, IV: unemployment').problems[0],
    /no spatial regression/,
  );
  for (const text of [
    'regress percent foreign-born on poverty and unemployment, robust',
    'logistic regression outcome renters predictors poverty, median income with odds ratios',
    'correlation between poverty, unemployment and median household income',
    'scatter plot of foreign born share against poverty',
    'histogram of poverty',
    'standardize median income then regress poverty on z_median_income',
    'rank poverty',
    'frequencies of state',
    'mean of poverty by state',
    'summarize poverty and unemployment in detail',
    'how many tracts',
  ]) {
    const out = both(text);
    assert.equal(out.ok, true, `${text}: ${out.problems.join(' ')}`);
    const check = checkSpssLines(out.lines, vars);
    assert.equal(check.ok, true, `${text}: ${check.problems.join(' ')}`);
  }
});

test('SPSS model lines number the map’s models, and names stay valid', () => {
  assert.equal(
    isSpssModelLine('REGRESSION /DEPENDENT y /METHOD=ENTER x'),
    true,
  );
  assert.equal(isSpssModelLine('genlin y WITH x'), true);
  assert.equal(isSpssModelLine('DESCRIPTIVES x'), false);
  const choices = mapChoices({
    steps: [
      { line: 'DESCRIPTIVES poverty', rc: 0 },
      { line: 'REGRESSION /DEPENDENT poverty /METHOD=ENTER bachelors', rc: 0 },
    ],
    files: ['analysis.sps', 'map_m1.csv'],
  });
  assert.match(
    choices[0].label,
    /^Model 1 \(REGRESSION \/DEPENDENT poverty…\)/,
  );
  assert.equal(spssName('with'), 'with_');
  assert.equal(spssName('2000_rate'), 'v2000_rate');
  assert.equal(spssName('poverty'), 'poverty');
});
