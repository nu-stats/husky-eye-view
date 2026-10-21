/**
 * Pure geometry for flow arcs: great-circle interpolation with a raised
 * midpoint, and log-scale mapping of flow values to width and opacity.
 * No Cesium, DOM or network imports.
 *
 * From uxhimanshuk/ground-view (MIT), src/layers/arcs/geo.js.
 */
const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Great-circle (haversine) distance in metres between two lon/lat points. */
export function haversineM(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toVector({ lon, lat }) {
  const cl = Math.cos(lat * RAD);
  return [
    cl * Math.cos(lon * RAD),
    cl * Math.sin(lon * RAD),
    Math.sin(lat * RAD),
  ];
}

/**
 * Points along the great circle from `a` to `b`, endpoints included.
 * @param {{lon:number,lat:number}} a
 * @param {{lon:number,lat:number}} b
 * @param {number} segments Number of segments (points = segments + 1).
 * @returns {Array<{lon:number,lat:number,t:number}>}
 */
export function greatCirclePoints(a, b, segments = 32) {
  const n = Math.max(1, Math.floor(segments));
  const va = toVector(a);
  const vb = toVector(b);
  const dot = Math.max(
    -1,
    Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]),
  );
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x;
    if (sinOmega < 1e-9) {
      // Coincident or antipodal: fall back to a straight lon/lat blend.
      out.push({
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        t,
      });
      continue;
    }
    const wa = Math.sin((1 - t) * omega) / sinOmega;
    const wb = Math.sin(t * omega) / sinOmega;
    x = [
      wa * va[0] + wb * vb[0],
      wa * va[1] + wb * vb[1],
      wa * va[2] + wb * vb[2],
    ];
    out.push({
      lon: Math.atan2(x[1], x[0]) * DEG,
      lat: Math.atan2(x[2], Math.hypot(x[0], x[1])) * DEG,
      t,
    });
  }
  return out;
}

/** Peak arc height in metres, proportional to the ground distance. */
export function arcPeakHeightM(
  distanceM,
  { fraction = 0.2, maxM = 3_000_000 } = {},
) {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
  return Math.min(maxM, distanceM * fraction);
}

/** Segment count that keeps long arcs smooth and short ones cheap. */
export function segmentsForDistance(distanceM) {
  const n = Math.round((Number(distanceM) || 0) / 300_000);
  return Math.max(8, Math.min(64, n));
}

/**
 * A raised great-circle arc as lon, lat, height triples.
 * Height follows a half sine so the midpoint is the peak.
 * @returns {{positions:number[], distanceM:number, peakM:number}}
 */
export function arcPositions(a, b, options = {}) {
  const distanceM = haversineM(a, b);
  const peakM = arcPeakHeightM(distanceM, options);
  const points = greatCirclePoints(a, b, segmentsForDistance(distanceM));
  const positions = [];
  for (const p of points) {
    positions.push(
      p.lon,
      p.lat,
      (options.baseM || 0) + Math.sin(Math.PI * p.t) * peakM,
    );
  }
  return { positions, distanceM, peakM };
}

/**
 * Map a value onto [outMin, outMax] on a log10 scale between `min` and `max`.
 * Values outside the domain clamp; a degenerate domain returns the midpoint.
 */
export function logScale(value, min, max, outMin, outMax) {
  const v = Number(value);
  if (!(v > 0) || !(min > 0) || !(max > 0)) return outMin;
  if (max <= min) return (outMin + outMax) / 2;
  const t =
    (Math.log10(Math.min(Math.max(v, min), max)) - Math.log10(min)) /
    (Math.log10(max) - Math.log10(min));
  return outMin + t * (outMax - outMin);
}

/** Line width in pixels and opacity for one flow value in the shown range. */
export function arcStyle(value, range) {
  return {
    width: logScale(value, range.min, range.max, 1.2, 6),
    alpha: logScale(value, range.min, range.max, 0.35, 0.95),
  };
}
