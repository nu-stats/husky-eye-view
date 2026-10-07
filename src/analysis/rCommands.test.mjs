import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analysisVariables, stepResults } from './stataCommands.js';
import {
  buildRScript,
  checkRLine,
  checkRLines,
  readableRLog,
} from './rCommands.js';
import {
  findR,
  prepareRSession,
  rProcessEnv,
} from '../../server/analysis/rSession.js';

const vars = analysisVariables('tract');
const dataVars = new Set(vars.map((v) => v.name));

test('typed R lines may call models, summaries, tests, plots and spatial tools', () => {
  for (const line of [
    'summary(d$foreign_born_share)',
    'm <- lm(foreign_born_share ~ poverty + unemployment, data = d)',
    'm2 = glm(foreign_born_count ~ poverty + offset(log(population)), family = poisson, data = d)',
    'cor(d$poverty, d$bachelors, use = "complete.obs")',
    'table(d$state)',
    'aggregate(poverty ~ state, data = d, FUN = mean)',
    'hist(d$poverty, breaks = 30, main = "Poverty")',
    'plot(d$poverty, d$foreign_born_share)',
    'with(d, cor.test(poverty, bachelors))',
    'd$pov_z <- scale(d$poverty)',
    'moran.test(d$poverty, W, zero.policy = TRUE)',
    'lagsarlm(foreign_born_share ~ poverty, data = d, listw = W)',
    'summary(subset(d, state %in% c("MA", "RI"))$poverty)',
    'lm(poverty ~ ., data = d[, c("poverty", "bachelors")])',
  ])
    assert.equal(checkRLine(line, new Set(dataVars), dataVars).ok, true, line);
});

test('anything that could reach past the data is refused', () => {
  for (const line of [
    'system("calc")',
    'system2("calc")',
    'shell("dir")',
    'eval(parse(text = "1"))',
    'sapply(d$poverty, system)',
    'x <- system',
    'do.call("system", list("calc"))',
    'get("system")("calc")',
    'base::system("calc")',
    '`system`("calc")',
    'file.remove("data.csv")',
    'source("x.R")',
    'Sys.setenv(A = 1)',
    'x <<- 1',
    'summary(d); system("calc")',
    'f <- function(x) x',
    'setwd("C:/")',
    'unlink("data.csv")',
    'readLines("secret.txt")',
    'download.file("http://example.com", "x")',
    'library(httr)',
    'd <- 1',
    'with(d, system("calc"))',
    'summary("unclosed)',
  ])
    assert.equal(checkRLine(line, new Set(dataVars), dataVars).ok, false, line);
});

test('a session remembers the objects and columns it makes', () => {
  const run = checkRLines(
    [
      'm <- lm(poverty ~ bachelors, data = d)',
      'summary(m)',
      'd$pov_z <- scale(d$poverty)',
      'summary(d$pov_z)',
      'mean(pov_z)',
    ],
    vars,
  );
  assert.equal(run.ok, true, run.problems.join('\n'));
  assert.equal(run.commands[0].creates, 'm');
  assert.equal(run.commands[0].model, true);
  const unknown = checkRLines(['summary(nothing_here)'], vars);
  assert.equal(unknown.ok, false);
  assert.match(unknown.problems[0], /nothing_here/);
});

test('the script keeps going after an error, saves graphs and fits spatial models on complete cases', () => {
  const { commands } = checkRLines(
    [
      'm <- lm(poverty ~ bachelors, data = d)',
      'plot(d$poverty, d$bachelors)',
      'abline(m)',
      'lagsarlm(poverty ~ bachelors, data = d, listw = W)',
    ],
    vars,
  );
  const script = buildRScript({
    title: 'Test',
    variables: vars,
    commands,
    needsShapes: true,
    folder: 'C:\\x\\y',
  });
  assert.match(script, /setwd\("C:\/x\/y"\)/);
  assert.match(script, /colClasses = c\(geoid = "character"/);
  assert.match(
    script,
    /tryCatch\(\{ hev_v <- withVisible\(m <- lm\(poverty ~ bachelors, data = d\)\)/,
  );
  assert.match(script, /png\("graph1\.png"/);
  // abline draws on the same plot: the device closes after it, not before.
  const plotAt = script.indexOf('png("graph1.png"');
  const ablineAt = script.indexOf('abline(m)');
  const closeAt = script.indexOf('invisible(dev.off())', plotAt + 1);
  assert.ok(closeAt > ablineAt, 'the plot stays open for abline');
  assert.match(script, /poly2nb\(areas, queen = TRUE\)/);
  assert.match(script, /complete\.cases\(d\[, c\("poverty", "bachelors"\)/);
  assert.match(script, /subset\.listw\(W, hev_keep/);
  assert.match(script, /HEV_STEP 4 rc=/);
  assert.match(script, /HEV_DONE/);
  const open = buildRScript({
    title: 'Open',
    variables: vars,
    interactive: true,
  });
  assert.match(open, /sink\("session\.log", split = TRUE\)/);
  assert.match(open, /savehistory\("session_commands\.R"\)/);
});

test('the log the panel and voice see starts at the first line', () => {
  const log =
    'R version banner\nHEV_BEGIN\n\n> summary(d$poverty)\n   Min. 1st Qu.\nHEV_STEP 1 rc=0\nHEV_DONE\n';
  assert.equal(readableRLog(log), '> summary(d$poverty)\n   Min. 1st Qu.\n');
  assert.deepEqual(stepResults(log), [{ step: 1, rc: 0 }]);
});

test('R is found in its standard places, newest version first, with RStudio', () => {
  const files = new Set([
    'C:\\Program Files\\R\\R-4.3.2\\bin\\Rscript.exe',
    'C:\\Program Files\\R\\R-4.5.1\\bin\\Rscript.exe',
    'C:\\Program Files\\R\\R-4.5.1\\bin\\x64\\Rgui.exe',
    'C:\\Program Files\\RStudio\\rstudio.exe',
  ]);
  const found = findR({
    env: { ProgramFiles: 'C:\\Program Files' },
    platform: 'win32',
    exists: (f) => files.has(f),
    list: () => ['R-4.3.2', 'R-4.5.1', 'Rtools'],
  });
  assert.equal(found.version, '4.5.1');
  assert.equal(found.rgui, 'C:\\Program Files\\R\\R-4.5.1\\bin\\x64\\Rgui.exe');
  assert.equal(found.rstudio, 'C:\\Program Files\\RStudio\\rstudio.exe');
  assert.equal(
    findR({ env: {}, platform: 'win32', exists: () => false, list: () => [] }),
    null,
  );
  assert.equal(
    findR({
      env: {},
      platform: 'linux',
      exists: (f) => f === '/usr/bin/Rscript',
      list: () => [],
    }).path,
    '/usr/bin/Rscript',
  );
});

test('an R session folder holds the data, the script and, to open it, an RStudio project', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hev-r-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { HEV_ANALYSIS_DIR: root };
  const run = prepareRSession(
    { geography: 'state', commands: ['summary(d$segregation_bw)'] },
    { env },
  );
  assert.equal(run.ok, true, run.problems?.join(' '));
  assert.equal(run.session.doName, 'analysis.R');
  assert.match(
    readFileSync(path.join(run.session.folder, 'analysis.R'), 'utf8'),
    /summary\(d\$segregation_bw\)/,
  );
  const open = prepareRSession(
    { geography: 'state', interactive: true },
    { env },
  );
  assert.equal(open.ok, true);
  assert.equal(
    readFileSync(path.join(open.session.folder, '.Rprofile'), 'utf8'),
    'source("open.R")\n',
  );
  assert.match(
    readFileSync(path.join(open.session.folder, 'session.Rproj'), 'utf8'),
    /Version: 1\.0/,
  );
  const refused = prepareRSession(
    { geography: 'state', commands: ['system("calc")'] },
    { env },
  );
  assert.equal(refused.ok, false);
});

test('R from a conda environment gets its version and its libraries on PATH', () => {
  const rscript = 'C:\\envs\\hev-r\\lib\\R\\bin\\x64\\Rscript.exe';
  const r = findR({
    env: { HEV_R_PATH: rscript },
    platform: 'win32',
    exists: (f) => f === rscript,
    list: (dir) =>
      dir.endsWith('conda-meta')
        ? ['r-base-4.4.3-h1234_0.json', 'r-sf-1.1.3.json']
        : [],
  });
  assert.equal(r.version, '4.4.3');
  assert.ok(r.pathPrefix.includes('C:\\envs\\hev-r\\Library\\bin'));
  const env = rProcessEnv(r, { Path: 'C:\\Windows' });
  assert.match(env.Path, /^C:\\envs\\hev-r;/);
  assert.match(env.Path, /C:\\Windows$/);
  // A standard install needs nothing added.
  assert.deepEqual(rProcessEnv({ pathPrefix: [] }, { Path: 'x' }), {
    Path: 'x',
  });
});
