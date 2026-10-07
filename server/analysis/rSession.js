/**
 * R sessions on this computer: find R (and RStudio), write the session
 * folder (data.csv, analysis.R) through the same preparation as Stata, run
 * the script with Rscript, and read the log back. "Open in R" opens RStudio
 * on the session folder (or R's own window) with the data loaded as d.
 *
 * Shared by the server endpoint (server/providers/r.js) and the CLI
 * (scripts/r-analysis.mjs). The line checks and the script itself are in
 * src/analysis/rCommands.js.
 */
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  MAX_R_SCRIPT_BYTES,
  buildRScript,
  checkRLines,
  readableRLog,
} from '../../src/analysis/rCommands.js';
import { stepResults } from '../../src/analysis/stataCommands.js';
import {
  RUN_TIMEOUT_MS,
  prepareAnalysisSession,
  sessionFiles,
} from './stataSession.js';

/** What a session needs from R (see STATA_ENGINE). */
export const R_ENGINE = Object.freeze({
  name: 'R',
  checkLines: checkRLines,
  scriptBytes: MAX_R_SCRIPT_BYTES,
  scriptWord: 'R script',
  userFile: 'user.R',
  script: 'analysis.R',
  openScript: 'open.R',
  build: ({
    title,
    variables,
    commands,
    userFile,
    needsShapes,
    folder,
    interactive,
  }) =>
    buildRScript({
      title,
      variables,
      commands,
      userScript: userFile,
      needsShapes,
      folder,
      interactive,
    }),
  // RStudio opens the folder as a project, which runs .Rprofile (and so
  // open.R) and keeps its own history; R's window reads .Rprofile too.
  extraFiles: ({ interactive }) =>
    interactive
      ? {
          '.Rprofile': 'source("open.R")\n',
          'session.Rproj':
            'Version: 1.0\n\nRestoreWorkspace: No\nSaveWorkspace: No\nAlwaysSaveHistory: Yes\n',
        }
      : {},
});

const versionOf = (text) =>
  (String(text).match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
const newer = (a, b) => {
  for (let i = 0; i < 3; i += 1)
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
};

/**
 * Find R: HEV_R_PATH (Rscript or its folder) first, then the standard
 * places, newest version first. Returns {path, version, rgui, rstudio} or
 * null; `path` is Rscript.
 */
export function findR({
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
  const exe = platform === 'win32' ? '.exe' : '';
  const rstudio =
    (platform === 'win32'
      ? [
          paths.join(
            env.ProgramFiles || 'C:\\Program Files',
            'RStudio',
            'rstudio.exe',
          ),
          paths.join(
            env.ProgramFiles || 'C:\\Program Files',
            'RStudio',
            'bin',
            'rstudio.exe',
          ),
          ...(env.LOCALAPPDATA
            ? [
                paths.join(
                  env.LOCALAPPDATA,
                  'Programs',
                  'RStudio',
                  'rstudio.exe',
                ),
              ]
            : []),
        ]
      : platform === 'darwin'
        ? ['/Applications/RStudio.app']
        : ['/usr/bin/rstudio', '/usr/local/bin/rstudio']
    ).find((file) => exists(file)) || null;
  const describe = (rscript) => {
    const bin = paths.dirname(rscript);
    const gui =
      platform === 'win32'
        ? [
            paths.join(bin, 'Rgui.exe'),
            paths.join(bin, 'x64', 'Rgui.exe'),
          ].find((f) => exists(f)) || null
        : null;
    // R from a conda environment (<prefix>/lib/R/bin/...) needs that
    // environment's libraries on PATH, or Windows cannot load its DLLs; its
    // version is in the r-base package record rather than the folder name.
    const condaPrefix =
      (rscript.match(
        /^(.*?)[\\/]lib[\\/]R[\\/]bin(?:[\\/]x64)?[\\/][^\\/]+$/i,
      ) || [])[1] || null;
    const condaVersion = condaPrefix
      ? (list(paths.join(condaPrefix, 'conda-meta'))
          .map((name) => name.match(/^r-base-(\d+\.\d+\.\d+)-/)?.[1])
          .find(Boolean) ?? null)
      : null;
    return {
      path: rscript,
      version: versionOf(rscript).join('.') || condaVersion,
      rgui: gui,
      rstudio,
      pathPrefix: condaPrefix
        ? platform === 'win32'
          ? [
              condaPrefix,
              paths.join(condaPrefix, 'Library', 'mingw-w64', 'bin'),
              paths.join(condaPrefix, 'Library', 'usr', 'bin'),
              paths.join(condaPrefix, 'Library', 'bin'),
              paths.join(condaPrefix, 'Scripts'),
            ]
          : [paths.join(condaPrefix, 'bin')]
        : [],
    };
  };
  if (env.HEV_R_PATH) {
    const given = env.HEV_R_PATH;
    const rscript = /rscript(\.exe)?$/i.test(given)
      ? given
      : paths.join(given, `Rscript${exe}`);
    if (exists(rscript)) return describe(rscript);
  }
  const candidates = [];
  if (platform === 'win32') {
    for (const base of [
      env.ProgramFiles || 'C:\\Program Files',
      env['ProgramFiles(x86)'],
    ].filter(Boolean)) {
      const root = paths.join(base, 'R');
      for (const folder of list(root).filter((d) =>
        /^R-\d+\.\d+\.\d+$/.test(d),
      )) {
        candidates.push(paths.join(root, folder, 'bin', 'Rscript.exe'));
        candidates.push(paths.join(root, folder, 'bin', 'x64', 'Rscript.exe'));
      }
    }
  } else if (platform === 'darwin') {
    candidates.push(
      '/Library/Frameworks/R.framework/Resources/bin/Rscript',
      '/opt/homebrew/bin/Rscript',
      '/usr/local/bin/Rscript',
    );
  } else {
    candidates.push('/usr/bin/Rscript', '/usr/local/bin/Rscript');
  }
  const found = candidates.filter((file) => exists(file));
  found.sort((a, b) => newer(versionOf(b), versionOf(a)));
  if (found.length) return describe(found[0]);
  // R in a conda environment (Pinokio's miniforge, or the conda this server
  // runs under): <root>/envs/<env>/lib/R/bin/[x64/]Rscript.
  const roots = [
    env.CONDA_PREFIX,
    env.CONDA_ROOT,
    env.CONDA_EXE && paths.dirname(paths.dirname(env.CONDA_EXE)),
    env.PINOKIO_HOME && paths.join(env.PINOKIO_HOME, 'bin', 'miniforge'),
    platform === 'win32' ? 'C:\\pinokio\\bin\\miniforge' : null,
  ].filter(Boolean);
  const prefixes = [];
  for (const root of new Set(roots)) {
    prefixes.push(root);
    for (const name of list(paths.join(root, 'envs')))
      prefixes.push(paths.join(root, 'envs', name));
  }
  for (const prefix of prefixes) {
    const rscript = (
      platform === 'win32'
        ? [
            paths.join(prefix, 'lib', 'R', 'bin', 'x64', 'Rscript.exe'),
            paths.join(prefix, 'lib', 'R', 'bin', 'Rscript.exe'),
          ]
        : [paths.join(prefix, 'lib', 'R', 'bin', 'Rscript')]
    ).find((file) => exists(file));
    if (rscript) return describe(rscript);
  }
  return null;
}

/** Validate a request and write an R session folder (no R run yet). */
export function prepareRSession(request = {}, options = {}) {
  return prepareAnalysisSession(request, { ...options, engine: R_ENGINE });
}

/** The environment R runs in: its own conda libraries first, when it has them. */
export function rProcessEnv(r, base = process.env) {
  if (!r?.pathPrefix?.length) return base;
  const key =
    Object.keys(base).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  return {
    ...base,
    [key]: [...r.pathPrefix, base[key] || ''].join(path.delimiter),
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

/** Run a prepared session with Rscript; its output is analysis.log. */
export async function runRSession(
  session,
  { r, timeoutMs = RUN_TIMEOUT_MS } = {},
) {
  if (!r)
    return {
      ok: false,
      problems: [
        'R was not found on this computer. Install it from cran.r-project.org, or set HEV_R_PATH to Rscript.',
      ],
    };
  const started = Date.now();
  const logPath = path.join(session.folder, 'analysis.log');
  const fd = openSync(logPath, 'w');
  const timedOut = await new Promise((resolve) => {
    const child = spawn(r.path, ['--vanilla', session.doName], {
      cwd: session.folder,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      env: rProcessEnv(r),
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
        : 'uploaded R script',
  }));
  const done = /HEV_DONE/.test(log);
  const problems = [];
  if (timedOut)
    problems.push(
      `R did not finish within ${Math.round(timeoutMs / 60000)} minutes and was stopped.`,
    );
  else if (!log) problems.push('R ran but wrote nothing.');
  else if (!done)
    problems.push('The script stopped before the end; see the log.');
  return {
    ok: !timedOut && done,
    problems,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    steps,
    log: readableRLog(log),
    files: sessionFiles(session.folder),
  };
}

/**
 * Open RStudio on the session folder (its .Rprofile loads the data), or R's
 * own window when RStudio is not installed. R keeps running on its own.
 */
export function openRInteractive(session, { r }) {
  if (!r)
    return {
      ok: false,
      problems: [
        'R was not found on this computer. Install it from cran.r-project.org, or set HEV_R_PATH to Rscript.',
      ],
    };
  const project = path.join(session.folder, 'session.Rproj');
  let command;
  let args;
  let env = rProcessEnv(r);
  if (r.rstudio) {
    if (r.rstudio.endsWith('.app'))
      [command, args] = ['open', ['-a', r.rstudio, project]];
    else [command, args] = [r.rstudio, [project]];
  } else if (r.rgui) {
    [command, args] = [r.rgui, ['--no-restore', '--no-save']];
    env = {
      ...env,
      R_PROFILE_USER: path.join(session.folder, '.Rprofile'),
    };
  } else {
    return {
      ok: false,
      problems: [
        `Neither RStudio nor R's window was found. In R, run: setwd("${session.folder.replace(/\\/g, '/')}"); source("open.R")`,
      ],
      files: sessionFiles(session.folder),
    };
  }
  const child = spawn(command, args, {
    cwd: session.folder,
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();
  return { ok: true, problems: [], files: sessionFiles(session.folder) };
}
