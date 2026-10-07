#!/usr/bin/env node
/**
 * Run an R analysis on a Husky Eye View layer from the command line, the
 * same way the R Analysis panel and voice tool do (no server needed). The
 * data frame is d.
 *
 *   node scripts/r-analysis.mjs --geography tract --state MA \
 *     "m <- lm(foreign_born_share ~ poverty + unemployment, data = d)" \
 *     "summary(m)"
 *
 *   node scripts/r-analysis.mjs --geography county --script my-analysis.R
 *   node scripts/r-analysis.mjs --geography county --open    (RStudio / R)
 *   node scripts/r-analysis.mjs --variables --geography tract
 *
 * Each run is a session folder (HEV_ANALYSIS_DIR, else
 * Documents/HuskyEyeView-Analyses) with data.csv, data.rds, analysis.R and
 * analysis.log. HEV_R_PATH points at Rscript when it is not in a standard
 * place.
 */
import { readFileSync } from 'node:fs';
import { analysisVariables } from '../src/analysis/stataCommands.js';
import {
  findR,
  openRInteractive,
  prepareRSession,
  runRSession,
} from '../server/analysis/rSession.js';

function parse(argv) {
  const options = { geography: 'county', state: null, lines: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--geography') options.geography = argv[++i];
    else if (arg === '--state') options.state = argv[++i];
    else if (arg === '--script') options.scriptPath = argv[++i];
    else if (arg === '--open') options.open = true;
    else if (arg === '--variables') options.variables = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else options.lines.push(arg);
  }
  return options;
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
    return;
  }
  if (options.variables) {
    for (const v of analysisVariables(options.geography))
      console.log(`${v.name.padEnd(26)} ${v.label}`);
    return;
  }
  const r = findR();
  if (!r) {
    console.error(
      'R was not found. Install it from cran.r-project.org, or set HEV_R_PATH to Rscript.',
    );
    process.exitCode = 1;
    return;
  }
  const prepared = prepareRSession({
    geography: options.geography,
    state: options.state,
    commands: options.lines,
    doFile: options.scriptPath
      ? readFileSync(options.scriptPath, 'utf8')
      : null,
    interactive: Boolean(options.open),
  });
  if (!prepared.ok) {
    for (const problem of prepared.problems) console.error(problem);
    process.exitCode = 1;
    return;
  }
  const { session } = prepared;
  console.log(`R ${r.version ?? ''} · ${session.title} · ${session.folder}`);
  if (options.open) {
    const opened = openRInteractive(session, { r });
    for (const problem of opened.problems) console.error(problem);
    if (opened.ok)
      console.log(
        `${r.rstudio ? 'RStudio' : 'R'} is opening; session.log and session_commands.R record the session.`,
      );
    return;
  }
  const result = await runRSession(session, { r });
  console.log(result.log);
  for (const s of result.steps)
    console.log(`${s.rc ? 'FAILED' : 'ok'}  ${s.line}`);
  for (const problem of result.problems) console.error(problem);
  console.log(`Files: ${result.files.join(', ')}`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
