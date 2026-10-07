#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPinokioEnvironment } from './pinokio-environment.mjs';
import { isDirectInvocation } from './pinokio-install.mjs';
import { validatePinokioSharing } from './pinokio-preflight.mjs';
import { RUNTIME_KEY_DEFINES } from '../build/runtime-serving.js';

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = realpathSync(path.resolve(path.dirname(MODULE_PATH), '..'));

/** The same address every launch, so a bookmark keeps working. */
export const FIXED_PORT = 4242;

function launchPort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Pinokio did not supply a valid local port.');
  }
  return port;
}

/** Whether nothing is listening on 127.0.0.1:port. */
export function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/**
 * The fixed port (HEV_PORT, default 4242) when it is free; otherwise the
 * spare port Pinokio supplied in PORT, so a busy port never blocks a start.
 */
export async function choosePort(env = process.env, isFree = portFree) {
  const fixed = launchPort(env.HEV_PORT || FIXED_PORT);
  if (await isFree(fixed)) return fixed;
  const spare = launchPort(env.PORT);
  console.log(
    `[Pinokio] Port ${fixed} is in use; this launch uses ${spare} instead.`,
  );
  return spare;
}

export async function loadViteFromCanonicalRoot(
  root = ROOT,
  loadVite = () => import('vite'),
) {
  process.chdir(realpathSync(path.resolve(root)));
  return loadVite();
}

/** Where the launcher keeps its production build (git-ignored). */
export const BUILD_DIR = 'dist';
const STAMP_FILE = '.hev-build.json';

/** Everything that goes into the browser bundle. Tests never do. */
const BUILD_INPUTS = [
  'index.html',
  'style.css',
  'vite.config.js',
  'package.json',
  'package-lock.json',
  'src',
  'build',
  'server/standalone/vite.config.js',
];

/**
 * A fingerprint of the bundle's inputs: path, size and modification time of
 * every file (a git pull or Update rewrites what changed). Keys are not in
 * it — the build carries placeholders the server fills in as it sends the
 * scripts (build/runtime-serving.js) — so dist/ never holds a secret.
 */
export function buildFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  const visit = (relative) => {
    const full = path.join(root, relative);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(full).sort())
        visit(path.join(relative, name));
      return;
    }
    if (/\.test\.mjs$/.test(relative)) return;
    hash.update(
      `${relative.replace(/\\/g, '/')}:${stat.size}:${Math.floor(stat.mtimeMs)}\n`,
    );
  };
  for (const input of BUILD_INPUTS) visit(input);
  return hash.digest('hex');
}

/** Build into dist/ unless the last build there matches the sources. */
async function ensureProductionBuild(vite) {
  const fingerprint = buildFingerprint();
  const stampPath = path.join(ROOT, BUILD_DIR, STAMP_FILE);
  try {
    if (JSON.parse(readFileSync(stampPath, 'utf8')).fingerprint === fingerprint)
      return;
  } catch {
    // No build yet, or an unreadable stamp: build.
  }
  console.log(
    '[Pinokio] Building the app (first start after an install or update, ~10 s)...',
  );
  const started = Date.now();
  await vite.build({
    root: ROOT,
    logLevel: 'warn',
    define: RUNTIME_KEY_DEFINES,
    build: {
      outDir: BUILD_DIR,
      emptyOutDir: true,
      // public/ (map data, models) is served in place by the preview server.
      copyPublicDir: false,
      // The geoid grid and Natural Earth chunks are large on purpose and load
      // lazily; keep the Pinokio log free of Rollup's size advice.
      chunkSizeWarningLimit: 3000,
    },
  });
  writeFileSync(stampPath, JSON.stringify({ fingerprint, builtAt: new Date() }));
  console.log(
    `[Pinokio] Built in ${Math.round((Date.now() - started) / 1000)} s.`,
  );
}

async function start() {
  applyPinokioEnvironment();
  validatePinokioSharing();
  const port = await choosePort();
  // Provider Settings routes credential writes to pinokio/ENVIRONMENT (never
  // .env) when the app runs under this launcher. The marker is set here — after
  // applyPinokioEnvironment, before Vite snapshots process.env — so the
  // dev-server endpoint knows which store this launch owns.
  process.env.GEV_LAUNCHER = 'pinokio';
  console.log('[Pinokio] Local-only launch.');

  // Import Vite only after app-scoped blank fields have replaced any merged
  // Pinokio-global values. Vite snapshots process.env during configuration.
  const vite = await loadViteFromCanonicalRoot();
  let server = null;
  // The production build opens in about half the time of the dev server (one
  // minified bundle instead of ~650 source modules) and uses a quarter of
  // the memory. HEV_DEV_SERVER=1 keeps the dev server, for working on the
  // app; a failed build falls back to it so a start never fails on a build.
  if (process.env.HEV_DEV_SERVER !== '1') {
    try {
      await ensureProductionBuild(vite);
      server = await vite.preview({
        root: ROOT,
        build: { outDir: BUILD_DIR },
        preview: { host: '127.0.0.1', port, strictPort: true },
      });
      console.log('[Pinokio] Serving the production build.');
    } catch (error) {
      console.warn(
        `[Pinokio] Production build unavailable (${error.message}); using the development server.`,
      );
    }
  }
  if (!server) {
    server = await vite.createServer({
      root: ROOT,
      server: {
        host: '127.0.0.1',
        port,
        strictPort: true,
      },
    });
    await server.listen();
  }
  server.printUrls();
  console.log(`[Pinokio] Ready at http://127.0.0.1:${port}/`);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
  }
}

if (isDirectInvocation(process.argv[1], MODULE_PATH)) {
  start().catch((error) => {
    console.error(`[Pinokio] Start refused: ${error.message}`);
    process.exitCode = 1;
  });
}
