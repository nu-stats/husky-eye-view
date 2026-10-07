import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/**
 * Serve the map data files compressed: the chunked area-layer files
 * (public/context/**.geojsonl and their index.json) and the point layers'
 * GeoJSON (src/data/local_data in development, their hashed copies under
 * /assets in a build). Vite sends static files as-is, and this plain text
 * shrinks ~6x (a Los Angeles life-expectancy chunk: 1.98 MB -> ~0.34 MB).
 * Compressed bodies are cached in memory by file, modification time and
 * encoding, and each carries an ETag so a reload revalidates (304) instead
 * of downloading the file again.
 * @param {{cacheBytes?: number}} [options]
 * @returns {import('vite').Plugin}
 */
export function contextCompressionPlugin({
  cacheBytes = 96 * 1024 * 1024,
} = {}) {
  let publicRoot = path.resolve('public');
  let projectRoot = path.resolve('.');
  let outDir = path.resolve('dist');
  const server = createContextCompressionMiddleware({
    publicRoot: () => publicRoot,
    extraRoots: () => [
      {
        prefix: '/src/data/local_data/',
        dir: path.join(projectRoot, 'src', 'data', 'local_data'),
      },
    ],
    cacheBytes,
  });
  const preview = createContextCompressionMiddleware({
    publicRoot: () => publicRoot,
    extraRoots: () => [{ prefix: '/assets/', dir: path.join(outDir, 'assets') }],
    cacheBytes,
  });
  return {
    name: 'hev-context-compression',
    configResolved(config) {
      if (config.publicDir) publicRoot = config.publicDir;
      if (config.root) projectRoot = config.root;
      if (config.build?.outDir)
        outDir = path.resolve(projectRoot, config.build.outDir);
    },
    configureServer(viteServer) {
      viteServer.middlewares.use(server);
    },
    configurePreviewServer(previewServer) {
      previewServer.middlewares.use(preview);
    },
  };
}

/** Pick the best encoding the client accepts, or null. */
export function pickEncoding(acceptEncoding) {
  const accept = String(acceptEncoding || '').toLowerCase();
  if (/(^|[\s,])br($|[\s,;])/.test(accept)) return 'br';
  if (/(^|[\s,])gzip($|[\s,;])/.test(accept)) return 'gzip';
  return null;
}

/** Weak validator for one file in one encoding. */
function entityTag(stat, encoding) {
  return `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}-${encoding}"`;
}

/** Whether an If-None-Match header names `tag`. */
function matchesTag(ifNoneMatch, tag) {
  if (!ifNoneMatch) return false;
  return String(ifNoneMatch)
    .split(',')
    .some((candidate) => candidate.trim() === tag || candidate.trim() === '*');
}

/**
 * Connect-style middleware; exported for tests. `/context/` resolves under
 * publicRoot; `extraRoots` adds other URL prefixes, each mapped to a folder.
 * @param {{publicRoot: () => string,
 *   extraRoots?: () => Array<{prefix: string, dir: string}>,
 *   cacheBytes?: number}} options
 */
export function createContextCompressionMiddleware({
  publicRoot,
  extraRoots = () => [],
  cacheBytes = 96 * 1024 * 1024,
}) {
  const cache = new Map();
  let cachedBytes = 0;

  const remember = (key, body) => {
    cache.set(key, body);
    cachedBytes += body.length;
    for (const [oldKey, oldBody] of cache) {
      if (cachedBytes <= cacheBytes) break;
      cache.delete(oldKey);
      cachedBytes -= oldBody.length;
    }
  };

  /** The file a request names, or null when it is not one of ours. */
  const resolveFile = (pathname) => {
    const roots = [
      { prefix: '/context/', dir: path.join(publicRoot(), 'context') },
      ...extraRoots(),
    ];
    for (const { prefix, dir } of roots) {
      const at = pathname.indexOf(prefix);
      if (at < 0) continue;
      const file = path.resolve(dir, pathname.slice(at + prefix.length));
      const relative = path.relative(dir, file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
        return null;
      return file;
    }
    return null;
  };

  return async function contextCompression(req, res, next) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const url = new URL(req.url || '/', 'http://localhost');
      // A query (?import, ?url, ?raw, ?v=) is Vite's own module request —
      // JSON imported as code, for one — never a plain data fetch.
      if (url.search) return next();
      const pathname = decodeURIComponent(url.pathname);
      if (!/\.(geojsonl|json)$/.test(pathname)) return next();
      const encoding = pickEncoding(req.headers?.['accept-encoding']);
      if (!encoding) return next();
      const file = resolveFile(pathname);
      if (!file) return next();
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat?.isFile()) return next();

      const tag = entityTag(stat, encoding);
      res.setHeader(
        'Content-Type',
        pathname.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : 'application/x-ndjson; charset=utf-8',
      );
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('ETag', tag);
      if (matchesTag(req.headers?.['if-none-match'], tag)) {
        res.statusCode = 304;
        res.end();
        return;
      }

      const key = `${file}|${stat.mtimeMs}|${encoding}`;
      let body = cache.get(key);
      if (body) {
        // Refresh recency.
        cache.delete(key);
        cache.set(key, body);
      } else {
        const raw = await fsp.readFile(file);
        body =
          encoding === 'br'
            ? await brotli(raw, {
                params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
              })
            : await gzip(raw, { level: 6 });
        remember(key, body);
      }
      res.statusCode = 200;
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', String(body.length));
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      next(error);
    }
  };
}
