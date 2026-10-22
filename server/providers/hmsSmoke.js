/**
 * NOAA HMS (Hazard Mapping System) daily wildfire-smoke polygons, keyless,
 * for the "Wildfire Smoke (NOAA HMS)" layer.
 *
 * Adapted from the Sheldondouthat/satwq-reality-os fork of God's Eye View
 * (MIT), which relayed the KML as is. Husky Eye View reads the KML here,
 * keeps only the polygons that touch the United States (src/data/usArea.js)
 * and sends those as JSON, so the browser never downloads smoke over Canada,
 * Mexico or the open sea.
 *
 * Upstream (no CORS headers, so the browser cannot fetch it directly):
 *   https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/{YYYY}/{MM}/hms_smoke{YYYYMMDD}.kml
 * Today's file appears once the first analysis of the UTC day is out, and
 * grows during the day; before that, yesterday's is used.
 *
 * Route: GET /api/hms-smoke → {schemaVersion, date, fetchedAt, total,
 *   dropped, polygons: [{density, ring}], stale?}
 *   on total failure → 503 {"error":"hms_unavailable"}
 * One hour server cache, one upstream read at a time, the last good day
 * served (marked stale) when NOAA is down, upstream bodies capped at 16 MB
 * with a 20 s timeout, and a per-client request limit.
 */
import {
  parseSmokeKml,
  usSmokeSnapshot,
  SMOKE_PARSE_LIMIT,
} from '../../src/layers/hmsSmoke/records.js';
import { ringTouchesUs } from '../../src/data/usArea.js';
import { readResponseTextCapped, coalesceProxyRequest } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

const HMS_KML_ROOT =
  'https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML';

export const HMS_SMOKE_ROUTE = '/api/hms-smoke';

const MIB = 1024 * 1024;
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * UTC calendar parts for a Date, plus the compact YYYYMMDD tag HMS uses in
 * file names. Pure — dates are always computed in UTC because the HMS daily
 * file rolls over at UTC midnight.
 */
export function hmsSmokeUtcDateParts(date) {
  const y = String(date.getUTCFullYear());
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  return { y, m, ymd: `${y}${m}${d}` };
}

/** KML URL for one UTC calendar day. */
export function hmsSmokeDayUrl({ y, m, ymd }) {
  return `${HMS_KML_ROOT}/${y}/${m}/hms_smoke${ymd}.kml`;
}

/**
 * Candidate upstream URLs, today first then yesterday (both in UTC).
 * Yesterday is the fallback because today's file only appears after the
 * first analysis of the day; before that today's URL 404s.
 */
export function hmsSmokeCandidateUrls(now = new Date()) {
  const today = hmsSmokeUtcDateParts(now);
  const yesterday = hmsSmokeUtcDateParts(new Date(now.getTime() - 86_400_000));
  return [
    { date: today.ymd, url: hmsSmokeDayUrl(today) },
    { date: yesterday.ymd, url: hmsSmokeDayUrl(yesterday) },
  ];
}

const KML_OPEN_RE = /<kml[\s>]/i;

/**
 * Pure fallback selection: given the probe results for each candidate URL
 * (in candidate order), return the first attempt that was both HTTP-ok and
 * looks like a KML document, or null when every candidate failed.
 * Each attempt: {date, url, ok, looksLikeKml}.
 */
export function pickHmsSmokeCandidate(attempts) {
  for (const attempt of attempts) {
    if (attempt && attempt.ok && attempt.looksLikeKml) return attempt;
  }
  return null;
}

export function looksLikeKml(text) {
  return (
    typeof text === 'string' &&
    text.length > 0 &&
    /^\s*</.test(text) &&
    KML_OPEN_RE.test(text)
  );
}

/** The US snapshot of one day's KML text. */
export function hmsSmokeSnapshotFromKml(text, { date, fetchedAt }) {
  return usSmokeSnapshot(
    parseSmokeKml(text, { maxPolygons: SMOKE_PARSE_LIMIT }),
    { date, fetchedAt, touchesUs: ringTouchesUs },
  );
}

/** GET /api/hms-smoke for the dev and preview servers. */
export function hmsSmokeProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  ttlMs = 3_600_000,
  maxBytes = 16 * MIB,
  timeoutMs = 20_000,
} = {}) {
  /** @type {?{savedAt: number, value: object}} */
  let cache = null;
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 600 });

  async function fetchCandidate(candidate, fetchedAt) {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(candidate.url, {
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const text = await readResponseTextCapped(response, maxBytes, signal);
    if (!looksLikeKml(text)) return null;
    return hmsSmokeSnapshotFromKml(text, { date: candidate.date, fetchedAt });
  }

  async function load() {
    let lastError = null;
    const fetchedAt = now();
    for (const candidate of hmsSmokeCandidateUrls(new Date(fetchedAt))) {
      try {
        const snapshot = await fetchCandidate(candidate, fetchedAt);
        if (snapshot) return snapshot;
      } catch (error) {
        lastError = error;
        console.warn(
          `[hms-smoke] ${candidate.date} fetch failed:`,
          error?.message || error,
        );
      }
    }
    throw lastError || new Error('no HMS smoke file for today or yesterday');
  }

  async function acquire() {
    if (cache && now() - cache.savedAt < ttlMs)
      return { value: cache.value, stale: false };
    try {
      const { promise } = coalesceProxyRequest(inFlight, 'smoke', load);
      const value = await promise;
      cache = { savedAt: now(), value };
      return { value, stale: false };
    } catch (error) {
      // Keep showing the last good day through a NOAA outage, marked stale.
      if (cache) return { value: cache.value, stale: true };
      throw error;
    }
  }

  async function handler(req, res) {
    const json = (status, value, headers = {}) => {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...headers,
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET')
      return json(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
    const path = (req.url || '/').split('?')[0];
    if (path !== '/' && path !== '')
      return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req)))
      return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
    try {
      const { value, stale } = await acquire();
      json(200, stale ? { ...value, stale: true } : value, {
        'X-HMS-Date': value.date,
        ...(stale ? { 'X-Data-Stale': 'true' } : {}),
      });
    } catch {
      json(503, { error: 'hms_unavailable' });
    }
  }

  return {
    name: 'hms-smoke',
    configureServer({ middlewares }) {
      middlewares.use(HMS_SMOKE_ROUTE, handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use(HMS_SMOKE_ROUTE, handler);
    },
  };
}
