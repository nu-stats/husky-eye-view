/**
 * Census shapes for an upload that carries only IDs: tract centers (to tell
 * which tracts lie in a city) and tract / county / state outlines (to draw
 * the upload on the map). All come from the app's own files under
 * public/context/, fetched on demand for the flight's cities only.
 */
import { geometryBbox, geometryPoint } from './userData.js';

const base = () => {
  try {
    return new URL('context/', globalThis.document?.baseURI).href;
  } catch {
    return '/context/';
  }
};

const cache = new Map();

async function lines(path, fetchImpl) {
  if (cache.has(path)) return cache.get(path);
  const promise = (async () => {
    const response = await fetchImpl(`${base()}${path}`);
    if (!response.ok) return [];
    return (await response.text())
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  })().catch(() => []);
  cache.set(path, promise);
  return promise;
}

const intersects = (a, b) =>
  a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** The state outlines, by two-digit FIPS. */
export async function stateShapes(fetchImpl = globalThis.fetch) {
  const features = await lines('states/states.geojsonl', fetchImpl);
  return new Map(features.map((f) => [f.properties.geoid, f.geometry]));
}

/** County outlines of a state, by five-digit FIPS. */
export async function countyShapes(stateFips, fetchImpl = globalThis.fetch) {
  const features = await lines(
    `county-life-expectancy/${stateFips}.geojsonl`,
    fetchImpl,
  );
  return new Map(features.map((f) => [f.properties.geoid, f.geometry]));
}

/** 2020 tract outlines of a county, by eleven-digit GEOID. */
export async function tractShapes(countyFips, fetchImpl = globalThis.fetch) {
  const features = await lines(`tracts-2020/${countyFips}.geojsonl`, fetchImpl);
  return new Map(features.map((f) => [f.properties.geoid, f.geometry]));
}

/**
 * What a flight needs for an upload, for its cities: state outlines (point
 * uploads), tract centers (tract uploads without shapes) and the outlines to
 * draw ID-only uploads. Counties loaded are those that touch a city and
 * appear in the file.
 */
export async function shapesForFlight(
  dataset,
  cities,
  fetchImpl = globalThis.fetch,
) {
  const states = await stateShapes(fetchImpl);
  const tractPoints = new Map();
  const outlines = new Map();
  const idOnly = dataset.records.some((r) => r.geoid && !r.geometry);
  if (!idOnly) return { states, tractPoints, outlines };
  const ids = new Set(dataset.records.map((r) => r.geoid).filter(Boolean));
  const counties = new Set([...ids].map((id) => id.slice(0, 5)));
  for (const city of cities) {
    if (dataset.level === 'state') {
      const shape = states.get(city.stateFips);
      if (shape && ids.has(city.stateFips)) outlines.set(city.stateFips, shape);
      continue;
    }
    if (dataset.level === 'place') {
      if (ids.has(city.id)) outlines.set(city.id, city.boundary);
      continue;
    }
    const countyMap = await countyShapes(city.stateFips, fetchImpl);
    const near = [...countyMap.entries()].filter(([fips, geometry]) =>
      intersects(geometryBbox(geometry), city.bbox),
    );
    for (const [fips, geometry] of near) {
      if (dataset.level === 'county') {
        if (ids.has(fips)) outlines.set(fips, geometry);
        continue;
      }
      if (!counties.has(fips)) continue;
      const tracts = await tractShapes(fips, fetchImpl);
      for (const [geoid, shape] of tracts) {
        tractPoints.set(geoid, geometryPoint(shape));
        if (ids.has(geoid)) outlines.set(geoid, shape);
        else if (dataset.level === 'block group') {
          // Block groups are drawn with their tract's outline.
          for (const id of ids)
            if (id.startsWith(geoid)) outlines.set(geoid, shape);
        }
      }
    }
  }
  return { states, tractPoints, outlines };
}
