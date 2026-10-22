/**
 * The map's area files (public/context/<folder>/index.json and its
 * <chunk>.geojsonl files) for the analysis boxes: Stata, R, SPSS, Excel,
 * Moran's I and your own uploads all read them through here.
 *
 * Files are read asynchronously, a few at a time, so the server's other
 * requests keep moving while a large state's tracts load. Parsed files are
 * kept in one shared cache, keyed by path and modification time (a rebuilt
 * file is read afresh) and bounded by the files' size on disk, least
 * recently used first out, to about CHUNK_CACHE_BYTES of memory (a few
 * large states' tracts).
 *
 * Cached values are shared between requests: callers read them and never
 * change them (features, their properties and geometry are frozen).
 */
import { readFile, stat } from 'node:fs/promises';

/** The shared cache's memory budget for parsed files. */
export const CHUNK_CACHE_BYTES = 64 * 1024 * 1024;
/**
 * Parsed features take about this many times their size on disk in memory
 * (2.5× measured on tracts-2020), so each file is charged size × this.
 */
export const PARSED_BYTES_PER_FILE_BYTE = 2.5;
/** Files read at the same time. */
const CONCURRENCY = 8;

const parseJson = (text) => {
  const value = JSON.parse(text);
  return value && typeof value === 'object' ? Object.freeze(value) : value;
};

/** One feature per non-blank line, in file order. */
const parseLines = (text) => {
  const features = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    if (feature && typeof feature === 'object') {
      if (feature.properties && typeof feature.properties === 'object')
        Object.freeze(feature.properties);
      if (feature.geometry && typeof feature.geometry === 'object')
        Object.freeze(feature.geometry);
      Object.freeze(feature);
    }
    features.push(feature);
  }
  return Object.freeze(features);
};

/** A cache of parsed files, about `maxBytes` of memory at most. */
export function createChunkCache({ maxBytes = CHUNK_CACHE_BYTES } = {}) {
  /** key -> {mtimeMs, size, cost, value}; least recently used first. */
  const entries = new Map();
  /** Reads in progress, so two requests for one file read it once. */
  const pending = new Map();
  let bytes = 0;
  let reads = 0;

  const forget = (key) => {
    const old = entries.get(key);
    if (!old) return;
    entries.delete(key);
    bytes -= old.cost;
  };

  const remember = (key, entry) => {
    forget(key);
    if (entry.cost > maxBytes) return;
    entries.set(key, entry);
    bytes += entry.cost;
    for (const [oldest] of entries) {
      if (bytes <= maxBytes) break;
      forget(oldest);
    }
  };

  async function load(kind, file, parse) {
    const key = `${kind}\0${file}`;
    const info = await stat(file);
    const hit = entries.get(key);
    if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
      // Most recently used last.
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
    }
    const version = `${key}\0${info.mtimeMs}\0${info.size}`;
    let reading = pending.get(version);
    if (!reading) {
      reading = readFile(file, 'utf8')
        .then((text) => {
          reads += 1;
          const value = parse(text);
          remember(key, {
            mtimeMs: info.mtimeMs,
            size: info.size,
            cost: info.size * PARSED_BYTES_PER_FILE_BYTE,
            value,
          });
          return value;
        })
        .finally(() => pending.delete(version));
      pending.set(version, reading);
    }
    return reading;
  }

  const features = (file) => load('lines', file, parseLines);

  return {
    /** A parsed JSON file (index.json). */
    json: (file) => load('json', file, parseJson),
    /** A .geojsonl file's features (one per non-blank line). */
    features,
    /** Several .geojsonl files' features, in the order given. */
    async manyFeatures(files) {
      const out = new Array(files.length);
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const at = next;
          next += 1;
          out[at] = await features(files[at]);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker),
      );
      return out;
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
    stats: () => ({ entries: entries.size, bytes, maxBytes, reads }),
  };
}

/** The one cache every analysis box shares. */
export const chunkCache = createChunkCache();
