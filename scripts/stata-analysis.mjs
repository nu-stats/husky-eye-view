#!/usr/bin/env node
/**
 * Run a Stata analysis on a Husky Eye View layer from the command line, the
 * same way the Stata Analysis panel and voice tool do (no server needed).
 *
 *   node scripts/stata-analysis.mjs --geography tract --state MA \
 *     "regress foreign_born_share poverty unemployment if median_income != ." \
 *     "twoway scatter foreign_born_share poverty"
 *
 *   node scripts/stata-analysis.mjs --geography county --do my-analysis.do
 *   node scripts/stata-analysis.mjs --geography county --open     (Stata window)
 *   node scripts/stata-analysis.mjs --variables --geography tract
 *
 * Each run is a session folder (HEV_ANALYSIS_DIR, else
 * Documents/HuskyEyeView-Analyses) with data.csv, data.dta, the do-file and
 * the log. HEV_STATA_PATH points at Stata when it is not in a standard place.
 */
import { readFileSync } from 'node:fs';
import { analysisVariables } from '../src/analysis/stataCommands.js';
import {
  findStata,
  openInteractive,
  prepareSession,
  runSession,
} from '../server/analysis/stataSession.js';

function parse(argv) {
  const options = { geography: 'county', state: null, commands: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--geography') options.geography = argv[++i];
    else if (arg === '--state') options.state = argv[++i];
    else if (arg === '--do') options.doPath = argv[++i];
    else if (arg === '--open') options.open = true;
    else if (arg === '--variables') options.variables = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else options.commands.push(arg);
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
  const stata = findStata();
  if (!stata) {
    console.error(
      'Stata was not found (looked for Stata 18 and 19). Set HEV_STATA_PATH to its program file.',
    );
    process.exitCode = 1;
    return;
  }
  const prepared = prepareSession({
    geography: options.geography,
    state: options.state,
    commands: options.commands,
    doFile: options.doPath ? readFileSync(options.doPath, 'utf8') : null,
    interactive: Boolean(options.open),
  });
  if (!prepared.ok) {
    for (const problem of prepared.problems) console.error(problem);
    process.exitCode = 1;
    return;
  }
  const { session } = prepared;
  console.log(
    `Stata ${stata.version ?? ''} ${stata.edition} · ${session.title} · ${session.folder}`,
  );
  if (options.open) {
    openInteractive(session, { stata });
    console.log(
      'Stata is opening; session.log and session_commands.do record the session.',
    );
    return;
  }
  const result = await runSession(session, { stata });
  console.log(result.log);
  for (const s of result.steps)
    console.log(`${s.rc ? `FAILED r(${s.rc})` : 'ok'}  ${s.line}`);
  for (const problem of result.problems) console.error(problem);
  console.log(`Files: ${result.files.join(', ')}`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
