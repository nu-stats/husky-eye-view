/**
 * Area Reports: the areas a report ranks, read from the same files the map
 * draws (properties only; outlines are dropped as each line is read).
 * Counties and states load whole; tracts load one state at a time.
 */
import { REPORT_GEOGRAPHIES } from './reportMeasures.js';

const cache = new Map();

const resolve = (path) => {
  try {
    return new URL(path, globalThis.document?.baseURI).href;
  } catch {
    return `/${path}`;
  }
};

async function chunkProperties(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const out = [];
  for (const line of (await response.text()).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const properties = JSON.parse(line).properties;
    if (properties) out.push(properties);
  }
  return out;
}

/**
 * The properties of every area of a geography (tracts: of one state's
 * counties), cached for the session.
 */
export async function loadReportAreas(
  geography,
  { state = null, fetchImpl = globalThis.fetch } = {},
) {
  const key = `${geography}:${geography === 'tract' ? state : ''}`;
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const base = resolve(REPORT_GEOGRAPHIES[geography].baseUrl);
    const index = await (await fetchImpl(`${base}index.json`)).json();
    const ids = index
      .map((entry) => entry.id)
      .filter((id) => geography !== 'tract' || String(id).startsWith(state));
    const batches = [];
    // A few files at a time: tract states can have hundreds of counties.
    for (let i = 0; i < ids.length; i += 12)
      batches.push(
        ...(await Promise.all(
          ids
            .slice(i, i + 12)
            .map((id) =>
              chunkProperties(
                `${base}${encodeURIComponent(id)}.geojsonl`,
                fetchImpl,
              ),
            ),
        )),
      );
    return batches.flat();
  })();
  cache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}
