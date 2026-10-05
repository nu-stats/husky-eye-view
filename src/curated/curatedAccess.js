/**
 * Curated Flights access: its own browser-session key (separate from the
 * research datasets key), the lock check, the city table, and the research
 * layers counted for a flight when the research key is also present.
 */
import { researchRates } from './curatedModel.js';

/** sessionStorage slot POWER UP writes (keySetup.js SESSION_KEY_SLOTS). */
export const CURATED_KEY_SLOT = 'hev.curatedKey';
const RESEARCH_KEY_SLOT = 'hev.researchKey';
/** Fired by POWER UP whenever a session key changes. */
export const SESSION_KEY_EVENT = 'hev:research-key-changed';

function readSlot(slot) {
  try {
    return globalThis.sessionStorage?.getItem(slot) || '';
  } catch {
    return '';
  }
}

export function curatedKey() {
  return readSlot(CURATED_KEY_SLOT);
}

/** Whether the server opens the table with this session's Curated Flights key. */
export async function curatedUnlocked(fetchImpl = globalThis.fetch) {
  const key = curatedKey();
  if (!key) return false;
  try {
    const response = await fetchImpl('/api/curated/status', {
      headers: { 'X-HEV-Curated-Key': key },
      cache: 'no-store',
    });
    if (!response.ok) return false;
    return (await response.json())?.unlocked === true;
  } catch {
    return false;
  }
}

let cachedTable = null;
let cachedFor = '';

/** The decrypted city table, cached for the key that opened it. */
export async function loadCuratedTable(fetchImpl = globalThis.fetch) {
  const key = curatedKey();
  if (!key) throw new Error('Enter the Curated Flights key in POWER UP first.');
  if (cachedTable && cachedFor === key) return cachedTable;
  const response = await fetchImpl('/api/curated/data', {
    headers: { 'X-HEV-Curated-Key': key },
    cache: 'no-store',
  });
  if (response.status === 403)
    throw new Error('That Curated Flights key does not open the city table.');
  if (!response.ok)
    throw new Error(`Curated Flights data unavailable (${response.status}).`);
  cachedTable = await response.json();
  cachedFor = key;
  return cachedTable;
}

/** Forget the cached table (key changed or forgotten). */
export function forgetCuratedTable() {
  cachedTable = null;
  cachedFor = '';
}

/**
 * City / county / state rates for the research layers in a plan, counted
 * from the locked datasets with this session's research key. Returns
 * `{values: {cityId: {layerKey: {city, county, state}}}, missing: [keys]}`;
 * a layer lands in `missing` when the research key is absent or refused.
 */
export async function researchValues(
  plan,
  table,
  fetchImpl = globalThis.fetch,
) {
  const wanted = plan.layers.filter((key) => table.layers[key]?.research);
  const values = {};
  const missing = [];
  if (!wanted.length) return { values, missing };
  const key = readSlot(RESEARCH_KEY_SLOT);
  for (const layerKey of wanted) {
    if (!key) {
      missing.push(layerKey);
      continue;
    }
    try {
      const response = await fetchImpl(`/api/research/${layerKey}`, {
        headers: { 'X-HEV-Research-Key': key },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(String(response.status));
      const features = (await response.text())
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      for (const city of plan.cities) {
        values[city.id] ||= {};
        values[city.id][layerKey] = researchRates(
          layerKey,
          features,
          city,
          table.counties?.[city.county?.fips],
        );
      }
    } catch {
      missing.push(layerKey);
    }
  }
  return { values, missing };
}
