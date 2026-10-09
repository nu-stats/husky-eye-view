/**
 * Excel Analysis sessions: the same session folder as Stata, R and SPSS
 * (data.csv, data.xlsx), and a run builds analysis.xlsx here — one sheet per
 * command with live formulas and charts (src/analysis/excelCommands.js) —
 * so Excel itself is needed only to open it. "Open in Excel" opens the
 * session's data.xlsx in Excel (or whatever opens .xlsx files here).
 *
 * Shared by the server endpoint (server/providers/excel.js) and the CLI
 * (scripts/excel-analysis.mjs).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
  MAX_EXCEL_FILE_BYTES,
  buildExcelAnalysis,
  checkExcelLines,
} from '../../src/analysis/excelCommands.js';
import { buildWorkbook } from '../../src/analysis/excelWorkbook.js';
import { parseCsv } from '../../src/curated/userData.js';
import { prepareAnalysisSession, sessionFiles } from './stataSession.js';

/** What a session needs from Excel Analysis (see STATA_ENGINE). */
export const EXCEL_ENGINE = Object.freeze({
  name: 'Excel',
  checkLines: checkExcelLines,
  scriptBytes: MAX_EXCEL_FILE_BYTES,
  scriptWord: 'command file',
  userFile: 'user.txt',
  script: 'commands.txt',
  openScript: 'open.txt',
  build: ({ title, commands, userFile, interactive }) =>
    interactive
      ? `${title}\r\nOpened in Excel: data.xlsx (the data, its variables and sources).\r\n`
      : [
          `# ${title}`,
          '# Excel commands; the results are in analysis.xlsx.',
          ...commands.map((c) => c.line),
          ...(userFile ? [`# then the lines of ${userFile}`] : []),
          '',
        ].join('\r\n'),
  extraFiles: () => ({}),
});

/**
 * Find Excel (to open workbooks; runs need nothing): HEV_EXCEL_PATH, then
 * the Office folders. Always returns an object: {path|null, version}.
 */
export function findExcel({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  list = (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
} = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (env.HEV_EXCEL_PATH && exists(env.HEV_EXCEL_PATH))
    return { path: env.HEV_EXCEL_PATH, version: null };
  if (platform === 'win32') {
    for (const base of [
      env.ProgramFiles || 'C:\\Program Files',
      env['ProgramFiles(x86)'],
    ].filter(Boolean)) {
      const office = paths.join(base, 'Microsoft Office');
      const folders = [paths.join(office, 'root'), office];
      for (const folder of folders)
        for (const sub of list(folder)
          .filter((d) => /^Office\d{2}$/i.test(d))
          .sort()
          .reverse()) {
          const exe = paths.join(folder, sub, 'EXCEL.EXE');
          if (exists(exe))
            return { path: exe, version: Number(sub.slice(6)) || null };
        }
    }
    return { path: null, version: null };
  }
  if (platform === 'darwin') {
    const app = '/Applications/Microsoft Excel.app';
    return { path: exists(app) ? app : null, version: null };
  }
  return { path: null, version: null };
}

/** Validate a request and write an Excel Analysis session folder. */
export function prepareExcelSession(request = {}, options = {}) {
  return prepareAnalysisSession(request, { ...options, engine: EXCEL_ENGINE });
}

/** The session's data (data.csv with the session's variable types). */
export function readSessionData(session) {
  const { rows } = parseCsv(
    readFileSync(path.join(session.folder, 'data.csv'), 'utf8'),
  );
  const variables = session.variables.map((v) => ({
    ...v,
    kind: v.kind || 'numeric',
  }));
  return {
    variables,
    rows: rows.map((row) =>
      variables.map((v) => {
        const value = row[v.name];
        if (value === undefined || value === '') return null;
        if (v.kind === 'string') return value;
        const x = Number(value);
        return Number.isFinite(x) ? x : null;
      }),
    ),
  };
}

/** Run a prepared session: analysis.xlsx, the log and the map files. */
export async function runExcelSession(session) {
  const started = Date.now();
  const data = readSessionData(session);
  const lines = [...session.commands];
  const userPath = path.join(session.folder, EXCEL_ENGINE.userFile);
  const problems = [];
  if (session.uploaded && existsSync(userPath)) {
    const extra = checkExcelLines(
      readFileSync(userPath, 'utf8'),
      data.variables,
    );
    problems.push(...extra.problems.map((p) => `Command file: ${p}`));
    lines.push(...extra.commands.map((c) => c.line));
  }
  const checked = checkExcelLines(lines, data.variables);
  const result = buildExcelAnalysis({
    title: session.title,
    data,
    commands: checked.commands,
  });
  writeFileSync(
    path.join(session.folder, 'analysis.xlsx'),
    buildWorkbook(result.sheets, {
      title: session.title,
      deflate: deflateRawSync,
    }),
  );
  for (const file of result.mapFiles)
    writeFileSync(path.join(session.folder, file.name), file.csv, 'utf8');
  writeFileSync(path.join(session.folder, 'analysis.log'), result.log, 'utf8');
  const steps = result.steps.map((s) => ({
    ...s,
    line: checked.commands[s.step - 1]?.line || '',
  }));
  if (steps.some((s) => s.rc))
    problems.push('A line could not be computed; see the log.');
  return {
    ok: !steps.some((s) => s.rc) && !problems.length,
    problems,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    steps,
    log: result.log,
    files: sessionFiles(session.folder),
  };
}

/** Open the session's data.xlsx in Excel (or the program that opens .xlsx). */
export function openExcelInteractive(session, { excel } = {}) {
  const file = path.join(session.folder, 'data.xlsx');
  if (!existsSync(file))
    return {
      ok: false,
      problems: ['This data is too large for a workbook; use data.csv.'],
      files: sessionFiles(session.folder),
    };
  let command;
  let args;
  if (excel?.path && process.platform === 'win32')
    [command, args] = [excel.path, [file]];
  // Without Excel: whatever this computer opens .xlsx files with.
  else if (process.platform === 'win32')
    [command, args] = ['explorer.exe', [file]];
  else if (process.platform === 'darwin')
    [command, args] = ['open', excel?.path ? ['-a', excel.path, file] : [file]];
  else [command, args] = ['xdg-open', [file]];
  const child = spawn(command, args, {
    cwd: session.folder,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return { ok: true, problems: [], files: sessionFiles(session.folder) };
}
