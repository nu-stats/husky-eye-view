/**
 * Locked research datasets (GVA 2015 gun deaths, MKDB mass killings).
 *
 * The repository only carries these layers encrypted (data/research/*.enc),
 * so a public copy of the code does not publish the data. This middleware
 * decrypts a dataset for the map only when the request carries the research
 * key it was locked with, in the X-HEV-Research-Key header. The key is never
 * saved on the server: POWER UP keeps it in the browser for that session
 * only, so the layers are locked again whenever a new session starts.
 *
 *   GET /api/research/status -> {configured, datasets: {id: 'unlocked'|'locked'}}
 *   GET /api/research/<id>   -> GeoJSON Lines, or
 *                               503 {error:'no_key'}  no key sent
 *                               403 {error:'bad_key'} key does not open it
 *
 * File format: "HEVR1" | salt (16) | iv (12) | GCM tag (16) | ciphertext of
 * the gzipped GeoJSON Lines. The key is scrypt(passphrase, salt).
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const MAGIC = Buffer.from('HEVR1', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SCRYPT = Object.freeze({ N: 2 ** 14, r: 8, p: 1 });

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** Request header carrying the browser session's key (Node lowercases it). */
export const RESEARCH_KEY_HEADER = 'x-hev-research-key';

/** Dataset id -> encrypted file under data/research/. */
export const RESEARCH_DATASETS = Object.freeze({
  'gva-2015': 'gva_2015.geojsonl.enc',
  mkdb: 'mkdb.geojsonl.enc',
  // Its own key (scripts/build-chicago-homicides.mjs), sent in its own header.
  'chicago-homicides': 'chicago_homicides.geojsonl.enc',
});

/** Datasets locked with a key of their own, and the header that carries it. */
export const DATASET_KEY_HEADERS = Object.freeze({
  'chicago-homicides': 'x-hev-chicago-homicides-key',
});

/** The header a dataset's key arrives in (the research key by default). */
export const keyHeaderFor = (id) =>
  DATASET_KEY_HEADERS[id] || RESEARCH_KEY_HEADER;

function deriveKey(passphrase, salt) {
  return scryptSync(String(passphrase), salt, 32, SCRYPT);
}

/** Encrypt text with a passphrase (used by scripts/lock-research-data.mjs). */
export function encryptResearchText(text, passphrase) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const body = Buffer.concat([
    cipher.update(gzipSync(Buffer.from(text, 'utf8'))),
    cipher.final(),
  ]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

/**
 * Decrypt a locked file. Returns null when the passphrase is wrong (the GCM
 * tag does not verify) or the file is not a locked dataset.
 */
export function decryptResearchBuffer(buffer, passphrase) {
  if (!Buffer.isBuffer(buffer) || !String(passphrase || '')) return null;
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  let offset = MAGIC.length;
  const salt = buffer.subarray(offset, (offset += SALT_BYTES));
  const iv = buffer.subarray(offset, (offset += IV_BYTES));
  const tag = buffer.subarray(offset, (offset += TAG_BYTES));
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(passphrase, salt),
      iv,
    );
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(buffer.subarray(offset)),
      decipher.final(),
    ]);
    return gunzipSync(plain).toString('utf8');
  } catch {
    return null;
  }
}

/** Vite plugin serving the locked datasets to this machine's map. */
export function researchDataProxy({
  dataDir = path.join(ROOT, 'data', 'research'),
  readKey = (req, id) =>
    String(req?.headers?.[keyHeaderFor(id)] || '')
      .trim()
      .slice(0, 512),
} = {}) {
  // Decrypted text per dataset, remembered with the key that opened it.
  const opened = new Map();
  const open = (id, key) => {
    const cached = opened.get(id);
    if (cached && cached.key === key) return cached.text;
    const file = path.join(dataDir, RESEARCH_DATASETS[id]);
    if (!existsSync(file)) return undefined;
    const text = decryptResearchBuffer(readFileSync(file), key);
    if (text != null) opened.set(id, { key, text });
    return text;
  };

  const installMiddleware = (server) => {
    server.middlewares.use('/api/research', (req, res) => {
      const sendJson = (status, body) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(body));
      };
      const id = String(req.url || '')
        .split('?')[0]
        .replace(/^\/+|\/+$/g, '');
      const key = readKey(req, id);
      if (id === 'status') {
        // Each dataset is tried with the key from its own header.
        const datasets = {};
        let configured = false;
        for (const name of Object.keys(RESEARCH_DATASETS)) {
          const datasetKey = readKey(req, name);
          if (datasetKey) configured = true;
          datasets[name] =
            datasetKey && open(name, datasetKey) ? 'unlocked' : 'locked';
        }
        sendJson(200, { configured, datasets });
        return;
      }
      if (!Object.hasOwn(RESEARCH_DATASETS, id)) {
        sendJson(404, { error: 'unknown_dataset' });
        return;
      }
      if (!key) {
        sendJson(503, { error: 'no_key' });
        return;
      }
      const text = open(id, key);
      if (text === undefined) {
        sendJson(404, { error: 'dataset_missing' });
        return;
      }
      if (text == null) {
        sendJson(403, { error: 'bad_key' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(text);
    });
  };
  return {
    name: 'research-data',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
