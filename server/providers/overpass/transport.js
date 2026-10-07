import {
  OVERPASS_MAX_RESPONSE_BYTES,
  OVERPASS_UPSTREAMS,
  OVERPASS_USER_AGENT,
  OVERPASS_TIMEOUT_MS,
  OVERPASS_STAGGER_MS,
} from './constants.js';
import { readResponseTextCapped } from '../common/http.js';
import { simplifyOverpassPayloadBody } from './geometry.js';

/**
 * Detect whether an Overpass API response body indicates rate-limiting.
 *
 * Checks for known rate-limit phrases in the body text regardless of
 * HTTP status code, since some mirrors return 200 with an error payload.
 *
 * @param {string} bodyText - Upstream response body.
 * @returns {boolean} True if the body looks rate-limited.
 */
function overpassLooksRateLimited(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return (
    text.includes('rate_limited') ||
    text.includes('quota of your ip address') ||
    text.includes('dispatcher_client::request_read_and_idx::rate_limited') ||
    text.includes('too many requests')
  );
}

/**
 * Detect an Overpass HTTP-200 body that is actually a runtime FAILURE (server-side
 * timeout / out-of-memory) via its `remark`. These are transient upstream failures,
 * not authoritative empty results, so they must not be returned or cached.
 */
function overpassLooksRuntimeError(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return (
    text.includes('runtime error') ||
    text.includes('timed out') ||
    text.includes('out of memory')
  );
}

/**
 * True only for an upstream response that is actually Overpass data.
 *
 * The proxy caches on this and serves stale on its negation, so the two
 * decisions cannot drift apart: a payload that is not data must never be
 * written to the cache and must always be eligible for a stale replacement.
 * @param {{status: number, rateLimited?: boolean, runtimeError?: boolean}} payload
 * @returns {boolean}
 */
function overpassPayloadIsData(payload) {
  const status = Number(payload?.status);
  return (
    Number.isFinite(status) &&
    status >= 200 &&
    status < 300 &&
    !payload.rateLimited &&
    !payload.runtimeError
  );
}

/**
 * Ask the mirrors, retaining response-size and per-mirror timeout caps. A
 * mirror that fails starts the next at once; one still silent after
 * `staggerMs` is joined by the next, and the first real answer wins (the
 * others are cancelled). Refusals and body-level failures never win; total
 * failure returns the last rate-limit payload, otherwise the first refusal,
 * or throws a network error.
 * @param {string} body URL-encoded Overpass QL query body.
 * @param {number} [maxResponseBytes] Endpoint-specific response cap.
 * @param {object} [options] Server-only endpoint and I/O overrides for tests.
 * @returns {Promise<{status:number,body:string,contentType:string,endpoint:string,rateLimited:boolean}>}
 */
function fetchOverpassPayload(
  body,
  maxResponseBytes = OVERPASS_MAX_RESPONSE_BYTES,
  {
    endpoints = OVERPASS_UPSTREAMS,
    fetchImpl = fetch,
    readBody = readResponseTextCapped,
    simplify = simplifyOverpassPayloadBody,
    staggerMs = OVERPASS_STAGGER_MS,
  } = {},
) {
  let lastError = null;
  let lastRateLimitPayload = null;
  let lastRefusalPayload = null;
  const controllers = new Set();

  /** One mirror: the data payload, or null after recording why not. */
  const ask = async (endpoint) => {
    const controller = new AbortController();
    controllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

    try {
      const upstream = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
        },
        body,
        signal: controller.signal,
      });

      const responseBody = await readBody(upstream, maxResponseBytes);
      const contentType =
        upstream.headers.get('content-type') || 'application/json';
      const status = upstream.status;
      const rateLimited =
        status === 429 || overpassLooksRateLimited(responseBody);
      const runtimeError = overpassLooksRuntimeError(responseBody);
      const payload = {
        status,
        body: responseBody,
        contentType,
        endpoint,
        rateLimited,
        runtimeError,
      };

      if (rateLimited) {
        lastRateLimitPayload = payload;
        return null;
      }
      // A 200 body carrying a runtime error / timeout is a transient upstream
      // failure — skip to the next mirror rather than returning or caching it.
      if (runtimeError) {
        lastError = new Error(`Overpass runtime error (${endpoint})`);
        return null;
      }
      // Anything but 2xx is this mirror declining, not an answer. Only 5xx used
      // to rotate, so a 4xx ended the fan-out and was returned — and cached —
      // as data: a mirror refusing this client answers 406 while the others
      // answer 200 to the very same request, so every Overpass-backed layer
      // failed on an error page with healthy mirrors untried. The first
      // refusal is kept so a genuinely bad query still reports what upstream
      // said, but only after every mirror has had the chance to answer it.
      if (status < 200 || status >= 300) {
        if (!lastRefusalPayload) lastRefusalPayload = payload;
        lastError = new Error(
          `Overpass upstream returned ${status} (${endpoint})`,
        );
        return null;
      }

      // Success: decimate giant boundary geometry before it reaches the cache,
      // the disk, or the client (what makes the 32 MB read cap safe to hold).
      payload.body = simplify(payload.body);
      return payload;
    } catch (error) {
      lastError = error;
      return null;
    } finally {
      clearTimeout(timeoutId);
      controllers.delete(controller);
    }
  };

  return new Promise((resolve, reject) => {
    let next = 0;
    let running = 0;
    let settled = false;
    let staggerTimer = null;
    const settleIfDone = () => {
      if (settled || running || next < endpoints.length) return;
      settled = true;
      if (lastRateLimitPayload) resolve(lastRateLimitPayload);
      else if (lastRefusalPayload) resolve(lastRefusalPayload);
      else reject(lastError || new Error('All Overpass upstreams failed'));
    };
    const start = () => {
      clearTimeout(staggerTimer);
      if (settled || next >= endpoints.length) return settleIfDone();
      const endpoint = endpoints[next++];
      running += 1;
      ask(endpoint).then((payload) => {
        running -= 1;
        if (settled) return;
        if (payload) {
          settled = true;
          clearTimeout(staggerTimer);
          for (const controller of controllers) controller.abort();
          resolve(payload);
          return;
        }
        start();
      });
      if (next < endpoints.length) staggerTimer = setTimeout(start, staggerMs);
    };
    start();
  });
}

export { overpassPayloadIsData, fetchOverpassPayload };
