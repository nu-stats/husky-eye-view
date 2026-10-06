#!/usr/bin/env node
/**
 * Census enumeration districts (EDs) for ten Northern cities, 1900–1930.
 *
 * Source: Allison Shertzer, Randall P. Walsh and John R. Logan (2016),
 * "Segregation and Neighborhood Change in Northern Cities: New Historical GIS
 * Data from 1900–1930", Historical Methods 49(4): 187–197; shapefiles from
 * the Urban Transition Historical GIS Project, Spatial Structures in the
 * Social Sciences (S4), Brown University:
 * https://s4.ad.brown.edu/Projects/UTP2/ncities.htm
 * (Final_Version_All_ED_Maps.zip, unzipped into data/source/s4-enumeration-districts).
 *
 * The final files carry each district's number, city and year only, so each
 * district is shaded by its land area: EDs were drawn so that one enumerator
 * could count each in about two weeks, which makes small districts the
 * crowded ones.
 *
 * 1900 is in NAD83 longitude/latitude; 1910–1930 are in USA Contiguous Albers
 * Equal Area Conic (ESRI:102003) and are projected back to longitude/latitude
 * here (Snyder, Map Projections — A Working Manual, pp. 101–102).
 *
 * Outputs: public/context/enumeration-districts-<year>/<city>.geojsonl and
 * public/context/enumeration-district-cities/ (one outline per city and
 * decade, drawn from far out).
 *
 *   node scripts/build-enumeration-districts.mjs
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readShapefile } from './lib/shapefile.mjs';
import {
  convexHull,
  ringArea,
  simplifyRing,
} from './build-overview-layers.mjs';

const SOURCE =
  'data/source/s4-enumeration-districts/Final_Version_All_ED_Maps/All_cities';
const CONTEXT = 'public/context';
export const ED_YEARS = [1900, 1910, 1920, 1930];
/** Square kilometres in one square degree at the equator. */
const SQ_DEGREE_KM2 = 111.32 * 111.32;
/** ~3 m: removes digitizing noise without moving any boundary visibly. */
const SIMPLIFY_DEGREES = 0.00003;

export const CITY_NAMES = {
  Allegheny: 'Allegheny, PA',
  Baltimore: 'Baltimore, MD',
  Boston: 'Boston, MA',
  Brooklyn: 'Brooklyn, NY',
  Chicago: 'Chicago, IL',
  Cincinnati: 'Cincinnati, OH',
  Cleveland: 'Cleveland, OH',
  Detroit: 'Detroit, MI',
  Manhattan: 'Manhattan, NY',
  Philadelphia: 'Philadelphia, PA',
  Pittsburgh: 'Pittsburgh, PA',
  Saint_Louis: 'St. Louis, MO',
};

// ---- USA Contiguous Albers Equal Area Conic (GRS 1980), inverse -----------
const A = 6378137;
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;
const qOf = (phi) => {
  const s = Math.sin(phi);
  return (
    (1 - E2) *
    (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)))
  );
};
const mOf = (phi) => Math.cos(phi) / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
const LON0 = -96 * RAD;
const [M1, M2] = [mOf(29.5 * RAD), mOf(45.5 * RAD)];
const [Q1, Q2, Q0] = [qOf(29.5 * RAD), qOf(45.5 * RAD), qOf(37.5 * RAD)];
const N = (M1 * M1 - M2 * M2) / (Q2 - Q1);
const C = M1 * M1 + N * Q1;
const RHO0 = (A * Math.sqrt(C - N * Q0)) / N;

/** [x, y] metres in ESRI:102003 -> [lon, lat] degrees. */
export function albersToLonLat([x, y]) {
  const rho = Math.hypot(x, RHO0 - y);
  const theta = Math.atan2(x, RHO0 - y);
  const q = (C - (rho * rho * N * N) / (A * A)) / N;
  let phi = Math.asin(q / 2);
  for (let i = 0; i < 10; i++) {
    const s = Math.sin(phi);
    const step =
      ((1 - E2 * s * s) ** 2 / (2 * Math.cos(phi))) *
      (q / (1 - E2) -
        s / (1 - E2 * s * s) +
        (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
    phi += step;
    if (Math.abs(step) < 1e-12) break;
  }
  return [(LON0 + theta / N) / RAD, phi / RAD];
}

const polygonsOf = (geometry) =>
  geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];
const round = (ring) =>
  ring.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);

/** Project, simplify and round one geometry; null when nothing is left. */
function cleanGeometry(geometry, project) {
  const polygons = [];
  for (const polygon of polygonsOf(geometry)) {
    const rings = polygon
      .map((ring) => simplifyRing(ring.map(project), SIMPLIFY_DEGREES))
      .filter(Boolean)
      .map(round);
    if (rings.length && rings[0].length >= 4) polygons.push(rings);
  }
  if (!polygons.length) return null;
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

const areaKm2 = (geometry) =>
  polygonsOf(geometry).reduce(
    (total, [outer, ...holes]) =>
      total +
      (ringArea(outer) - holes.reduce((h, ring) => h + ringArea(ring), 0)) *
        SQ_DEGREE_KM2,
    0,
  );

function bboxOf(features) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features)
    for (const [outer] of polygonsOf(feature.geometry))
      for (const [x, y] of outer) {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
  return box.map((v) => Number(v.toFixed(5)));
}

function writeChunks(directory, byChunk) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const index = [];
  for (const [id, features] of [...byChunk].sort()) {
    writeFileSync(
      path.join(directory, `${id}.geojsonl`),
      features.map((feature) => JSON.stringify(feature)).join('\n'),
    );
    index.push({ id, bbox: bboxOf(features), count: features.length });
  }
  writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index));
  return index;
}

function main() {
  if (!existsSync(`${SOURCE}/allcities_1900.shp`))
    throw new Error(
      `missing ${SOURCE}: download Final_Version_All_ED_Maps.zip from https://s4.ad.brown.edu/Projects/UTP2/ncities.htm and unzip it into data/source/s4-enumeration-districts`,
    );
  const outlines = [];
  for (const year of ED_YEARS) {
    const project = year === 1900 ? (point) => point : albersToLonLat;
    const byCity = new Map();
    for (const { properties, geometry } of readShapefile(
      `${SOURCE}/allcities_${year}`,
    )) {
      const clean = cleanGeometry(geometry, project);
      if (!clean) continue;
      const city = String(properties.city);
      const ed = String(properties.ED).trim();
      const name = CITY_NAMES[city] || city.replace(/_/g, ' ');
      if (!byCity.has(city)) byCity.set(city, []);
      byCity.get(city).push({
        type: 'Feature',
        id: `ed-${year}-${city}-${ed}`,
        properties: {
          name: `ED ${ed}, ${name} (${year})`,
          city: name,
          ed,
          year,
          area_km2: Number(areaKm2(clean).toFixed(3)),
        },
        geometry: clean,
      });
    }
    const index = writeChunks(
      path.join(CONTEXT, `enumeration-districts-${year}`),
      byCity,
    );
    for (const [city, features] of byCity) {
      const hull = convexHull(
        features.flatMap((f) =>
          polygonsOf(f.geometry).flatMap(([outer]) => outer),
        ),
      );
      if (!hull) continue;
      const name = CITY_NAMES[city] || city;
      outlines.push({
        type: 'Feature',
        id: `ed-city-${year}-${city}`,
        properties: {
          name: `${name}, ${year} census`,
          city: name,
          year,
          ed_count: features.length,
          summary: `${name}: ${features.length.toLocaleString('en-US')} enumeration districts mapped for the ${year} census. Zoom in to see each district.`,
        },
        geometry: { type: 'Polygon', coordinates: [round(hull)] },
      });
    }
    const total = index.reduce((sum, chunk) => sum + chunk.count, 0);
    console.log(
      `${year}: ${total} enumeration districts in ${index.length} cities`,
    );
  }
  writeChunks(
    path.join(CONTEXT, 'enumeration-district-cities'),
    new Map([['cities', outlines]]),
  );
  console.log(`enumeration-district-cities: ${outlines.length} city outlines`);
}

if (process.argv[1]?.endsWith('build-enumeration-districts.mjs')) main();
