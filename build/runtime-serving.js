import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';

/**
 * Browser keys as placeholders. A build made with these defines carries no
 * secret: the preview server below writes the current values into the
 * scripts as it sends them, so dist/ stays key-free on disk and a key saved
 * in Provider Settings applies on the next page load, without a rebuild.
 */
export const RUNTIME_KEYS = Object.freeze({
  GOOGLE_MAPS_API_KEY: '__HEV_RUNTIME_GOOGLE_MAPS_API_KEY__',
  CESIUM_ION_TOKEN: '__HEV_RUNTIME_CESIUM_ION_TOKEN__',
});

/** `define` entries that put the placeholders where the keys would go. */
export const RUNTIME_KEY_DEFINES = Object.freeze(
  Object.fromEntries(
    Object.entries(RUNTIME_KEYS).map(([name, placeholder]) => [
      `import.meta.env.${name}`,
      JSON.stringify(placeholder),
    ]),
  ),
);

/**
 * Replace each placeholder with the live value (inside a JS string literal,
 * so the value is escaped as one). Exported for tests.
 */
export function fillRuntimeKeys(source, env = process.env) {
  let text = source;
  for (const [name, placeholder] of Object.entries(RUNTIME_KEYS)) {
    if (!text.includes(placeholder)) continue;
    const value = JSON.stringify(String(env[name] ?? '').trim()).slice(1, -1);
    text = text.split(placeholder).join(value);
  }
  return text;
}

/**
 * Preview middleware: built scripts that carry a key placeholder are sent
 * with the current keys filled in. Never cached by content address (the
 * file name stays the same when a key changes), so it revalidates by ETag.
 */
export function createRuntimeKeysMiddleware({ assetsDir }) {
  const sources = new Map(); // file → { mtimeMs, text, hasPlaceholder }
  return async function runtimeKeys(req, res, next) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.search || !/^\/assets\/[^/]+\.js$/.test(url.pathname))
        return next();
      const file = path.join(assetsDir(), path.basename(url.pathname));
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat?.isFile()) return next();
      let source = sources.get(file);
      if (source?.mtimeMs !== stat.mtimeMs) {
        const text = await fsp.readFile(file, 'utf8');
        source = {
          mtimeMs: stat.mtimeMs,
          text,
          hasPlaceholder: Object.values(RUNTIME_KEYS).some((p) =>
            text.includes(p),
          ),
        };
        sources.set(file, source);
      }
      if (!source.hasPlaceholder) return next();
      const body = Buffer.from(fillRuntimeKeys(source.text), 'utf8');
      const tag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('ETag', tag);
      if (req.headers?.['if-none-match'] === tag) {
        res.statusCode = 304;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Length', String(body.length));
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      next(error);
    }
  };
}

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.geojson': 'application/geo+json',
  '.geojsonl': 'application/x-ndjson; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

/**
 * Preview middleware: serve public/ in place. Builds made by the Pinokio
 * launcher skip copying public/ (228 MB of map data) into dist/, so the
 * preview server reads those files from where they live. Revalidates by
 * ETag; never serves outside the folder.
 */
export function createPublicDirMiddleware({ publicDir }) {
  return async function publicFiles(req, res, next) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const root = publicDir();
      if (!root) return next();
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/' || pathname.endsWith('/')) return next();
      const file = path.resolve(root, `.${pathname}`);
      const relative = path.relative(root, file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
        return next();
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat?.isFile()) return next();
      const tag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
      res.setHeader(
        'Content-Type',
        CONTENT_TYPES[path.extname(file).toLowerCase()] ||
          'application/octet-stream',
      );
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('ETag', tag);
      if (req.headers?.['if-none-match'] === tag) {
        res.statusCode = 304;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Length', String(stat.size));
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', next).pipe(res);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Both preview middlewares as one plugin. In development Vite serves public/
 * and injects the keys itself, so this only touches the preview server.
 * @returns {import('vite').Plugin}
 */
export function runtimeServingPlugin() {
  let publicDir = path.resolve('public');
  let outDir = path.resolve('dist');
  return {
    name: 'hev-runtime-serving',
    configResolved(config) {
      publicDir = config.publicDir || '';
      outDir = path.resolve(config.root || '.', config.build?.outDir || 'dist');
    },
    configurePreviewServer(server) {
      server.middlewares.use(
        createRuntimeKeysMiddleware({
          assetsDir: () => path.join(outDir, 'assets'),
        }),
      );
      server.middlewares.use(
        createPublicDirMiddleware({ publicDir: () => publicDir }),
      );
    },
  };
}
