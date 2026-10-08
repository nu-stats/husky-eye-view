#!/usr/bin/env node
/**
 * Run an SPSS analysis on a Husky Eye View layer from the command line, the
 * same way the SPSS Analysis panel and voice tool do (no server needed).
 *
 *   node scripts/spss-analysis.mjs --geography tract --state MA \
 *     "REGRESSION /DEPENDENT foreign_born_share /METHOD=ENTER poverty unemployment" \
 *     "DESCRIPTIVES VARIABLES=poverty median_income"
 *
 *   node scripts/spss-analysis.mjs --geography county --syntax my-analysis.sps
 *   node scripts/spss-analysis.mjs --geography county --open    (SPSS itself)
 *   node scripts/spss-analysis.mjs --variables --geography tract
 *
 * Each run is a session folder (HEV_ANALYSIS_DIR, else
 * Documents/HuskyEyeView-Analyses) with data.csv, data.sav, analysis.sps,
 * analysis.log and SPSS's output (output.spv, output.html, results.docx and
 * results.xlsx). HEV_SPSS_PATH points at stats.exe (or the SPSS folder) when
 * it is not in a standard place; HEV_SPSS_PYTHON at SPSS's own Python 3.
 */
import { readFileSync } from 'node:fs';
import { analysisVariables } from '../src/analysis/stataCommands.js';
import {
  findSpss,
  openSpssInteractive,
  prepareSpssSession,
  runSpssSession,
} from '../server/analysis/spssSession.js';

function parse(argv) {
  const options = { geography: 'county', state: null, lines: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--geography') options.geography = argv[++i];
    else if (arg === '--state') options.state = argv[++i];
    else if (arg === '--syntax') options.syntaxPath = argv[++i];
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
  const spss = findSpss();
  if (!spss) {
    console.error(
      'IBM SPSS Statistics was not found. Set HEV_SPSS_PATH to its program (stats.exe) or install folder.',
    );
    process.exitCode = 1;
    return;
  }
  const prepared = prepareSpssSession({
    geography: options.geography,
    state: options.state,
    commands: options.lines,
    doFile: options.syntaxPath
      ? readFileSync(options.syntaxPath, 'utf8')
      : null,
    interactive: Boolean(options.open),
  });
  if (!prepared.ok) {
    for (const problem of prepared.problems) console.error(problem);
    process.exitCode = 1;
    return;
  }
  const { session } = prepared;
  console.log(
    `SPSS ${spss.version ?? ''} · ${session.title} · ${session.folder}`,
  );
  if (options.open) {
    const opened = openSpssInteractive(session, { spss });
    for (const problem of opened.problems) console.error(problem);
    if (opened.ok)
      console.log(
        'SPSS is opening on open.sps: choose Run ▸ All to load the data; session.log records what you run.',
      );
    return;
  }
  const result = await runSpssSession(session, { spss });
  console.log(result.log);
  for (const s of result.steps || [])
    console.log(`${s.rc ? 'FAILED' : 'ok'}  ${s.line}`);
  for (const problem of result.problems) console.error(problem);
  console.log(`Files: ${(result.files || []).join(', ')}`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
