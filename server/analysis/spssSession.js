/**
 * SPSS sessions on this computer: find IBM SPSS Statistics, write the
 * session folder (data.csv, analysis.sps) through the same preparation as
 * Stata and R, run the syntax with SPSS's own Python (external mode, no
 * window), and read the log back. "Open in SPSS" opens SPSS itself on
 * open.sps, which loads the data and keeps a session log.
 *
 * The run: run_spss.py (written into the session folder) submits
 * analysis.sps one block at a time — the data, then each line, then the
 * results for the map — so every line gets its own ✓ or ✗ (SPSS's error
 * level), as Stata's and R's do. Output is also kept as output.spv (open it
 * in SPSS), output.html with the charts as graph*.png, and the tables as
 * results.xlsx and results.docx.
 *
 * Shared by the server endpoint (server/providers/spss.js) and the CLI
 * (scripts/spss-analysis.mjs). The line checks and the syntax itself are in
 * src/analysis/spssCommands.js.
 */
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  MAX_SPSS_SYNTAX_BYTES,
  SPSS_BLOCK_MARK,
  buildSpssSyntax,
  checkSpssLines,
  readableSpssLog,
} from '../../src/analysis/spssCommands.js';
import { stepResults } from '../../src/analysis/stataCommands.js';
import {
  RUN_TIMEOUT_MS,
  prepareAnalysisSession,
  sessionFiles,
} from './stataSession.js';

const MISSING =
  'IBM SPSS Statistics was not found on this computer. Set HEV_SPSS_PATH to its program (stats.exe) or install folder.';

/** What a session needs from SPSS (see STATA_ENGINE). */
export const SPSS_ENGINE = Object.freeze({
  name: 'SPSS',
  checkLines: checkSpssLines,
  scriptBytes: MAX_SPSS_SYNTAX_BYTES,
  scriptWord: 'syntax file',
  userFile: 'user.sps',
  script: 'analysis.sps',
  openScript: 'open.sps',
  // With a UTF-8 byte-order mark: SPSS reads a syntax file without one in
  // the system's encoding, which garbles labels such as "2020–24".
  build: ({
    title,
    variables,
    rows,
    commands,
    userFile,
    folder,
    interactive,
  }) =>
    `﻿${buildSpssSyntax({
      title,
      variables,
      rows,
      commands,
      userSyntax: userFile,
      folder,
      interactive,
    })}`,
  extraFiles: () => ({}),
});

/**
 * Find SPSS: HEV_SPSS_PATH (stats.exe or its folder) first, then the
 * standard install folders, newest version first. Returns {path, root,
 * version, python, app} or null: `path` is the program, `python` SPSS's own
 * Python 3 (HEV_SPSS_PYTHON overrides it), `app` the Mac app bundle.
 */
export function findSpss({
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
  const describe = (root, program, app = null) => {
    const version =
      Number(
        (`${paths.basename(root)} ${app ? paths.basename(paths.dirname(app)) : ''}`.match(
          /\b(\d{2})\b/,
        ) || [])[1],
      ) || null;
    const python =
      (env.HEV_SPSS_PYTHON && exists(env.HEV_SPSS_PYTHON)
        ? env.HEV_SPSS_PYTHON
        : null) ||
      (platform === 'win32'
        ? [paths.join(root, 'Python3', 'python.exe')]
        : [
            paths.join(root, 'Python3', 'bin', 'python3'),
            ...(app
              ? [paths.join(app, 'Contents', 'Python3', 'bin', 'python3')]
              : []),
          ]
      ).find((file) => exists(file)) ||
      null;
    return { path: program, root, version, python, app };
  };
  const fromProgram = (program) => {
    if (platform === 'darwin') {
      const app = program.match(/^(.*\.app)(?:\/|$)/)?.[1];
      if (app) return describe(paths.dirname(app), program, app);
    }
    return describe(paths.dirname(program), program);
  };
  const exe = platform === 'win32' ? 'stats.exe' : 'stats';
  if (env.HEV_SPSS_PATH) {
    const given = env.HEV_SPSS_PATH;
    if (/\.app\/?$/.test(given) && exists(given))
      return describe(paths.dirname(given), given, given.replace(/\/$/, ''));
    const program = /stats(\.exe)?$/i.test(given)
      ? given
      : paths.join(given, exe);
    if (exists(program)) return fromProgram(program);
  }
  const found = [];
  if (platform === 'win32') {
    for (const base of [
      env.ProgramFiles || 'C:\\Program Files',
      env['ProgramFiles(x86)'],
    ].filter(Boolean)) {
      const ibm = paths.join(base, 'IBM');
      // SPSS 27 and later: IBM\SPSS Statistics[\<version>]; earlier:
      // IBM\SPSS\Statistics\<version>.
      for (const folder of list(ibm).filter((d) =>
        /^SPSS Statistics/i.test(d),
      )) {
        const root = paths.join(ibm, folder);
        found.push(paths.join(root, exe));
        for (const sub of list(root).filter((d) => /^\d{2}$/.test(d)))
          found.push(paths.join(root, sub, exe));
      }
      const old = paths.join(ibm, 'SPSS', 'Statistics');
      for (const sub of list(old).filter((d) => /^\d{2}$/.test(d)))
        found.push(paths.join(old, sub, exe));
    }
    const programs = found.filter((file) => exists(file)).map(fromProgram);
    programs.sort((a, b) => (b.version || 0) - (a.version || 0));
    return programs[0] || null;
  }
  if (platform === 'darwin') {
    const apps = [];
    for (const folder of list('/Applications').filter((d) =>
      /^IBM SPSS Statistics/i.test(d),
    )) {
      const root = paths.join('/Applications', folder);
      for (const app of list(root).filter(
        (d) => /\.app$/i.test(d) && /SPSS/i.test(d),
      ))
        apps.push(describe(root, paths.join(root, app), paths.join(root, app)));
    }
    apps.sort((a, b) => (b.version || 0) - (a.version || 0));
    return apps[0] || null;
  }
  const roots = [];
  for (const sub of list('/opt/IBM/SPSS/Statistics').filter((d) =>
    /^\d{2}$/.test(d),
  ))
    roots.push(paths.join('/opt/IBM/SPSS/Statistics', sub));
  const programs = roots
    .map((root) => paths.join(root, 'bin', exe))
    .filter((file) => exists(file))
    .map((program) => describe(paths.dirname(paths.dirname(program)), program));
  programs.sort((a, b) => (b.version || 0) - (a.version || 0));
  return programs[0] || null;
}

/** Validate a request and write an SPSS session folder (no SPSS run yet). */
export function prepareSpssSession(request = {}, options = {}) {
  return prepareAnalysisSession(request, { ...options, engine: SPSS_ENGINE });
}

/**
 * The Python driver for a run (written into the session folder): submits
 * analysis.sps block by block and prints each step's output and error level.
 */
export const SPSS_DRIVER = `# Written by Husky Eye View: runs analysis.sps in IBM SPSS Statistics one
# block at a time (the data, each line, the results for the map) and prints
# each step's output with its error level (0 = it ran).
import io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
try:
    import spss
except Exception as error:
    print("HEV_NO_SPSS " + str(error))
    sys.exit(2)
try:
    spss.SetOutput("OFF")
except Exception:
    pass

MARK = ${JSON.stringify(SPSS_BLOCK_MARK)}
blocks = []
with open("analysis.sps", encoding="utf-8-sig") as f:
    for line in f:
        if line.startswith(MARK):
            blocks.append([line[len(MARK):].strip(" .\\r\\n"), []])
        elif blocks:
            blocks[-1][1].append(line.rstrip("\\r\\n"))

def q(name):
    return "'" + os.path.join(HERE, name).replace("'", "''") + "'"

def submit(code):
    try:
        spss.Submit(code)
        return 0
    except Exception:
        try:
            level = spss.GetLastErrorLevel()
        except Exception:
            level = 0
        return level or 1

STEP_OUT = os.path.join(HERE, "hev_step.txt")

def with_output(code):
    if os.path.exists(STEP_OUT):
        os.remove(STEP_OUT)
    submit("OMS /SELECT ALL /EXCEPTIF SUBTYPES=['Notes'] /DESTINATION FORMAT=TEXT OUTFILE=" + q("hev_step.txt") + " /TAG='hev_step'.")
    rc = submit(code)
    submit("OMSEND TAG=['hev_step'].")
    if os.path.exists(STEP_OUT):
        with open(STEP_OUT, encoding="utf-8-sig", errors="replace") as f:
            print(f.read().rstrip())
        os.remove(STEP_OUT)
    return rc

# The whole session's output: a viewer file, HTML with the charts, and the
# tables for Excel and Word (older SPSS: .xls / .doc).
submit("OMS /SELECT ALL /EXCEPTIF SUBTYPES=['Notes'] /DESTINATION FORMAT=SPV OUTFILE=" + q("output.spv") + " /TAG='hev_spv'.")
submit("OMS /SELECT ALL /EXCEPTIF SUBTYPES=['Notes'] /DESTINATION FORMAT=HTML OUTFILE=" + q("output.html") + " IMAGES=YES CHARTFORMAT=PNG IMAGEROOT='graph' /TAG='hev_html'.")
for new, old in (("XLSX", "XLS"), ("DOCX", "DOC")):
    name = "results." + new.lower()
    if submit("OMS /SELECT TABLES /EXCEPTIF SUBTYPES=['Notes'] /DESTINATION FORMAT=" + new + " OUTFILE=" + q(name) + " /TAG='hev_" + new.lower() + "'."):
        submit("OMS /SELECT TABLES /EXCEPTIF SUBTYPES=['Notes'] /DESTINATION FORMAT=" + old + " OUTFILE=" + q("results." + old.lower()) + " /TAG='hev_" + old.lower() + "'.")

print("HEV_LOAD rc=%d" % submit("\\n".join(blocks[0][1]) if blocks else ""))
print("HEV_BEGIN")
for name, lines in blocks[1:]:
    code = "\\n".join(lines).strip()
    if name.startswith("step"):
        n = int(name.split()[1])
        shown = code[:-1] if code.endswith(".") else code
        print("")
        print("> " + shown)
        rc = with_output(code)
        print("HEV_STEP %d rc=%d" % (n, rc))
    else:
        submit(code)
submit("OMSEND.")
print("HEV_DONE")
try:
    spss.StopSPSS()
except Exception:
    pass
`;

/** The environment SPSS's Python runs in: the SPSS folder on PATH (its libraries). */
export function spssProcessEnv(spssInfo, base = process.env) {
  const key =
    Object.keys(base).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const extra = [
    spssInfo.root,
    spssInfo.python && path.dirname(spssInfo.python),
  ].filter(Boolean);
  return {
    ...base,
    [key]: [...extra, base[key] || ''].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
  };
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32')
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  else child.kill('SIGKILL');
}

/** Run a prepared session with SPSS's Python; its output is analysis.log. */
export async function runSpssSession(
  session,
  { spss, timeoutMs = RUN_TIMEOUT_MS } = {},
) {
  if (!spss) return { ok: false, problems: [MISSING] };
  if (!spss.python)
    return {
      ok: false,
      problems: [
        "SPSS's Python 3 (Python Essentials, installed with SPSS 24 and later) was not found next to SPSS. Repair the SPSS installation, set HEV_SPSS_PYTHON to its python program, or use OPEN IN SPSS and Run ▸ All.",
      ],
      files: sessionFiles(session.folder),
    };
  const started = Date.now();
  writeFileSync(path.join(session.folder, 'run_spss.py'), SPSS_DRIVER, 'utf8');
  const logPath = path.join(session.folder, 'analysis.log');
  const fd = openSync(logPath, 'w');
  const timedOut = await new Promise((resolve) => {
    const child = spawn(spss.python, ['run_spss.py'], {
      cwd: session.folder,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      env: spssProcessEnv(spss),
    });
    const timer = setTimeout(() => {
      killTree(child);
      resolve(true);
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  closeSync(fd);
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const steps = stepResults(log).map((s) => ({
    ...s,
    line:
      s.step <= session.commands.length
        ? session.commands[s.step - 1]
        : 'uploaded syntax file',
  }));
  const done = /HEV_DONE/.test(log);
  const problems = [];
  const load = Number(log.match(/HEV_LOAD rc=(\d+)/)?.[1] ?? 0);
  if (timedOut)
    problems.push(
      `SPSS did not finish within ${Math.round(timeoutMs / 60000)} minutes and was stopped.`,
    );
  else if (/HEV_NO_SPSS/.test(log))
    problems.push(
      `SPSS's Python could not start SPSS (${log.match(/HEV_NO_SPSS (.*)/)?.[1]?.trim() || 'no spss module'}). Is the license valid on this computer?`,
    );
  else if (!log) problems.push('SPSS ran but wrote nothing.');
  else if (!done)
    problems.push('The syntax stopped before the end; see the log.');
  if (load)
    problems.push(
      'SPSS could not read the data (GET DATA); see analysis.log in the session folder.',
    );
  return {
    ok: !timedOut && done && !load,
    problems,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    steps,
    log: readableSpssLog(log),
    files: sessionFiles(session.folder),
  };
}

/**
 * Open SPSS itself on open.sps (it loads and labels the data and keeps a
 * session log once run with Run ▸ All). SPSS keeps running on its own.
 */
export function openSpssInteractive(session, { spss }) {
  if (!spss) return { ok: false, problems: [MISSING] };
  const syntax = path.join(session.folder, session.doName);
  const [command, args] = spss.app
    ? ['open', ['-a', spss.app, syntax]]
    : [spss.path, [syntax]];
  const child = spawn(command, args, {
    cwd: session.folder,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return { ok: true, problems: [], files: sessionFiles(session.folder) };
}
