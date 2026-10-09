#!/usr/bin/env node
/**
 * Build an Excel Analysis workbook from a Husky Eye View layer on the command
 * line, the same way the Excel Analysis panel and voice tool do (no server,
 * and no Excel, needed; Excel only to open the result).
 *
 *   node scripts/excel-analysis.mjs --geography tract --state MA \
 *     "DESCRIPTIVE foreign_born_share poverty" \
 *     "REGRESSION foreign_born_share ON poverty unemployment"
 *
 *   node scripts/excel-analysis.mjs --geography county --commands my-commands.txt
 *   node scripts/excel-analysis.mjs --geography county --open    (data.xlsx in Excel)
 *   node scripts/excel-analysis.mjs --variables --geography tract
 *
 * Each run is a session folder (HEV_ANALYSIS_DIR, else
 * Documents/HuskyEyeView-Analyses) with data.csv, data.xlsx, commands.txt,
 * analysis.xlsx and analysis.log.
 */
import { readFileSync } from 'node:fs';
import { analysisVariables } from '../src/analysis/stataCommands.js';
import {
  findExcel,
  openExcelInteractive,
  prepareExcelSession,
  runExcelSession,
} from '../server/analysis/excelSession.js';

function parse(argv) {
  const options = { geography: 'county', state: null, lines: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--geography') options.geography = argv[++i];
    else if (arg === '--state') options.state = argv[++i];
    else if (arg === '--commands') options.commandsPath = argv[++i];
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
  const prepared = prepareExcelSession({
    geography: options.geography,
    state: options.state,
    commands: options.lines,
    doFile: options.commandsPath
      ? readFileSync(options.commandsPath, 'utf8')
      : null,
    interactive: Boolean(options.open),
  });
  if (!prepared.ok) {
    for (const problem of prepared.problems) console.error(problem);
    process.exitCode = 1;
    return;
  }
  const { session } = prepared;
  console.log(`Excel Analysis · ${session.title} · ${session.folder}`);
  if (options.open) {
    const opened = openExcelInteractive(session, { excel: findExcel() });
    for (const problem of opened.problems) console.error(problem);
    if (opened.ok) console.log('data.xlsx is opening.');
    return;
  }
  const result = await runExcelSession(session);
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
