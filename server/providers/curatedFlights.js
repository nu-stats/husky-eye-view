/**
 * Locked Curated Flights city table (data/curated/curated-flights.json.enc).
 *
 * Curated Flights has its own key, separate from the research datasets key.
 * The table is decrypted only for a request carrying that key in the
 * X-HEV-Curated-Key header; the key is never saved on the server (POWER UP
 * keeps it in the browser for the session).
 *
 *   GET /api/curated/status -> {configured, unlocked}
 *   GET /api/curated/data   -> the city table JSON, or
 *                              503 {error:'no_key'} / 403 {error:'bad_key'}
 *
 * Same file format and cipher as the research datasets (see research.js).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptResearchBuffer } from './research.js';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** Request header carrying the browser session's Curated Flights key. */
export const CURATED_KEY_HEADER = 'x-hev-curated-key';
export const CURATED_FILE = 'curated-flights.json.enc';

/** Vite plugin serving the locked city table to this machine's map. */
export function curatedFlightsProxy({
  dataDir = path.join(ROOT, 'data', 'curated'),
  readKey = (req) =>
    String(req?.headers?.[CURATED_KEY_HEADER] || '')
      .trim()
      .slice(0, 512),
} = {}) {
  let opened = null;
  const open = (key) => {
    if (opened && opened.key === key) return opened.text;
    const file = path.join(dataDir, CURATED_FILE);
    if (!existsSync(file)) return undefined;
    const text = decryptResearchBuffer(readFileSync(file), key);
    if (text != null) opened = { key, text };
    return text;
  };

  const installMiddleware = (server) => {
    server.middlewares.use('/api/curated', (req, res) => {
      const sendJson = (status, body) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      const route = String(req.url || '')
        .split('?')[0]
        .replace(/^\/+|\/+$/g, '');
      const key = readKey(req);
      if (route === 'status') {
        sendJson(200, {
          configured: Boolean(key),
          unlocked: Boolean(key && open(key)),
        });
        return;
      }
      if (route !== 'data') {
        sendJson(404, { error: 'unknown_route' });
        return;
      }
      if (!key) {
        sendJson(503, { error: 'no_key' });
        return;
      }
      const text = open(key);
      if (text === undefined) {
        sendJson(404, { error: 'data_missing' });
        return;
      }
      if (text == null) {
        sendJson(403, { error: 'bad_key' });
        return;
      }
      sendJson(200, text);
    });
  };
  return {
    name: 'curated-flights',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
