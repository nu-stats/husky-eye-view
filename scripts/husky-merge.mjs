#!/usr/bin/env node
/**
 * MergeCraft, the stand-alone Merge & Export app (husky-merge/index.html),
 * served or built from this repository's own files — no bundler and no npm
 * packages: the page loads its modules as they are.
 *
 *   node scripts/husky-merge.mjs serve [--host 127.0.0.1] [--port 4300]
 *   node scripts/husky-merge.mjs build [--out dist-husky-merge]
 *
 * `serve` prints "[MergeCraft] Ready at http://…/" once listening (the
 * Pinokio launcher waits for it). `build` writes the same files as a static
 * site (about 200 MB, most of it Census outlines) for any web host.
 *
 * Both publish only what the app uses: the page, the modules its script
 * imports (followed from src/analysis/huskyMerge.js), two stylesheets, the
 * logo, and the app's own Census data folders under context/.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/analysis/huskyMerge.js';

/** The data the merge engine reads (public/context/<folder>). */
export const CONTEXT_FOLDERS = Object.freeze([
  'tracts-2020',
  'county-life-expectancy',
  'states',
  'life-expectancy',
  'segregation',
  'holc',
  'enumeration-districts-1900',
  'enumeration-districts-1910',
  'enumeration-districts-1920',
  'enumeration-districts-1930',
]);

const STATIC = Object.freeze({
  'index.html': 'husky-merge/index.html',
  'husky-merge.css': 'husky-merge/husky-merge.css',
  'logo.svg': 'husky-merge/logo.svg',
  'src/ui/styles/curated.css': 'src/ui/styles/curated.css',
});

/**
 * Every module the page loads, repo-relative: static imports and workers
 * (`new URL('./x.js', import.meta.url)`) followed from `entry`. Dynamic
 * imports are left out — the only ones are Husky Eye View's globe, which the
 * app never uses. Throws on a bare specifier (it would need a bundler).
 */
export function moduleGraph(entry = ENTRY, root = ROOT) {
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const text = readFileSync(path.join(root, rel), 'utf8');
    const specs = [
      ...text.matchAll(
        /(?:^|\n)\s*(?:import|export)\s(?:[^;'"]*?\sfrom\s)?['"]([^'"]+)['"]/g,
      ),
      ...text.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      if (!spec.startsWith('.'))
        throw new Error(`${rel} imports "${spec}", which needs a bundler.`);
      walk(
        path
          .relative(root, path.resolve(root, path.dirname(rel), spec))
          .split(path.sep)
          .join('/'),
      );
    }
  };
  walk(entry);
  return [...seen].sort();
}

/** Published path → repo file, for everything but the data folders. */
export function siteFiles(root = ROOT) {
  const files = new Map(Object.entries(STATIC));
  for (const rel of moduleGraph(ENTRY, root)) files.set(rel, rel);
  return files;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.geojsonl': 'application/x-ndjson; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
};

/** The repo file for a request path, or null (outside what is published). */
export function resolveRequest(urlPath, files = siteFiles(), root = ROOT) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (rel === '') rel = 'index.html';
  if (rel.split('/').some((part) => part === '..' || part === '')) return null;
  if (files.has(rel)) return path.join(root, files.get(rel));
  const [top, folder, ...rest] = rel.split('/');
  if (top === 'context' && CONTEXT_FOLDERS.includes(folder) && rest.length) {
    const file = path.join(root, 'public', 'context', folder, ...rest);
    return existsSync(file) && statSync(file).isFile() ? file : null;
  }
  return null;
}

function serve({ host, port }) {
  const files = siteFiles();
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = resolveRequest(req.url || '/', files);
    if (!file || !existsSync(file)) {
      // A plain 404 (never the page), so a missing area reads as missing.
      res
        .writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type':
        TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': statSync(file).size,
      'Cache-Control': file.includes(`${path.sep}context${path.sep}`)
        ? 'max-age=86400'
        : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  server.listen(port, host, () => {
    const { port: actual } = server.address();
    console.log(`[MergeCraft] Ready at http://${host}:${actual}/`);
  });
}

async function build({ out }) {
  const dest = path.resolve(ROOT, out);
  if (dest === ROOT || !dest.startsWith(ROOT + path.sep))
    throw new Error('Build into a folder inside the repository.');
  await rm(dest, { recursive: true, force: true });
  let count = 0;
  for (const [published, source] of siteFiles()) {
    const target = path.join(dest, published);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(ROOT, source), target);
    count += 1;
  }
  for (const folder of CONTEXT_FOLDERS) {
    const from = path.join(ROOT, 'public', 'context', folder);
    await cp(from, path.join(dest, 'context', folder), { recursive: true });
    count += (await readdir(from, { recursive: true })).length;
  }
  // GitHub Pages: serve files as they are (no Jekyll).
  await writeFile(path.join(dest, '.nojekyll'), '');
  console.log(
    `[MergeCraft] Built ${count} files into ${path.relative(ROOT, dest)}/`,
  );
}

function option(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'serve')
    serve({
      host: option(args, 'host', process.env.HOST || '127.0.0.1'),
      port: Number(option(args, 'port', process.env.PORT || 4300)),
    });
  else if (command === 'build')
    build({ out: option(args, 'out', 'dist-husky-merge') }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  else {
    console.log(
      'Usage: node scripts/husky-merge.mjs serve [--host 127.0.0.1] [--port 4300]\n       node scripts/husky-merge.mjs build [--out dist-husky-merge]',
    );
    process.exitCode = command ? 1 : 0;
  }
}
