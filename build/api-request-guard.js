/**
 * Refuse cross-site requests to the server's `/api` routes.
 *
 * The server spends the configured provider keys on the page's behalf, so
 * another site's page must not be able to call those routes through the
 * user's browser. Modern browsers label every request with `Sec-Fetch-Site`.
 * Browsers without it (Safari before 16.4, for one) still send `Origin` on
 * CORS-mode requests, but not on an `<img>`, `<video>` or navigation load, so
 * such a load passes like a non-browser client (curl, scripts, tests and the
 * MCP server's own tool calls), which sends neither header. The per-IP rate
 * limits bound those.
 *
 * The header checks reuse `admitSameSiteRequest`, the gate some routes
 * already apply themselves, but leave out its reverse-proxy rule: an
 * authentication proxy in front of the server (SECURITY.md) sends forwarding
 * headers on every request, and the browser behind it still labels the
 * request truthfully.
 */

import { admitSameSiteRequest } from '../src/localRequestGate.mjs';

/** Methods whose requests carry no body to check. */
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Routes that accept a form-encoded body. The Overpass proxy mirrors the
 * Overpass API, whose clients post `data=<query>` as a form.
 */
const FORM_ENCODED_API_PATHS = Object.freeze(['/api/overpass']);

const REFUSAL_LOG_INTERVAL_MS = 60_000;
const REFUSAL_LOG_MAX_ROUTES = 100;
/** Refusal lines per interval across all routes, so cycling paths can't flood the log. */
const REFUSAL_LOG_MAX_LINES = 20;

/** @param {string | string[] | undefined} value */
function headerValue(value) {
  return String(Array.isArray(value) ? value[0] : (value ?? '')).trim();
}

/** @param {string | undefined} path */
function pathnameOf(path) {
  return String(path ?? '').split('?')[0];
}

/** @param {string | string[] | undefined} contentType */
function mediaTypeOf(contentType) {
  return headerValue(contentType).split(';')[0].trim().toLowerCase();
}

/** @param {string} type */
function isJsonMediaType(type) {
  return type === 'application/json' || type.endsWith('+json');
}

/** @param {Record<string, string | string[] | undefined>} headers */
function hasBody(headers) {
  return (
    Number(headerValue(headers['content-length']) || 0) > 0 ||
    headerValue(headers['transfer-encoding']) !== ''
  );
}

/**
 * @param {string} path
 * @param {readonly string[]} formEncodedPaths
 */
function acceptsForm(path, formEncodedPaths) {
  // Routes match without regard to case, as the server mounts them.
  const route = pathnameOf(path).toLowerCase();
  return formEncodedPaths.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  );
}

/**
 * Replace anything that could steer a terminal when echoed to the log.
 * @param {unknown} text
 */
function printable(text, limit = 120) {
  return String(text)
    .slice(0, limit)
    .replace(/[^\x20-\x7e]/g, '?');
}

/**
 * @param {number} status
 * @param {string} reason
 * @param {string} error
 * @returns {{ok: false, status: number, reason: string, error: string}}
 */
function refusal(status, reason, error) {
  return { ok: false, status, reason, error };
}

/**
 * Decide whether one `/api` request may proceed.
 *
 * `Sec-Fetch-Site` decides when present: only `same-origin` and `none` pass.
 * Without it, an `Origin` header must name this server exactly. A request
 * with a body must declare JSON, except the form-encoded routes listed in
 * `formEncodedPaths`; a JSON body forces a CORS preflight on cross-origin
 * callers, which this server never approves.
 *
 * @param {object} [request]
 * @param {string} [request.method]
 * @param {string} [request.path] Full request path, including `/api`.
 * @param {Record<string, string|string[]|undefined>} [request.headers]
 *   Node's lower-cased request headers.
 * @param {boolean} [request.encrypted] Whether the request arrived over TLS.
 * @param {object} [options]
 * @param {readonly string[]} [options.formEncodedPaths]
 * @returns {{ok: true} | {ok: false, status: number, reason: string, error: string}}
 */
export function checkApiRequest(
  { method = 'GET', path = '', headers = {}, encrypted = false } = {},
  { formEncodedPaths = FORM_ENCODED_API_PATHS } = {},
) {
  const fetchSite = headerValue(headers['sec-fetch-site']).toLowerCase();
  const origin = headerValue(headers.origin);
  const site = fetchSite
    ? admitSameSiteRequest({ secFetchSite: fetchSite })
    : admitSameSiteRequest({
        hostHeader: headerValue(headers.host),
        protocol: encrypted ? 'https:' : 'http:',
        origin,
      });
  if (!site.ok) {
    return refusal(
      site.status,
      fetchSite ? `Sec-Fetch-Site: ${fetchSite}` : `Origin: ${origin}`,
      site.error,
    );
  }
  if (!BODYLESS_METHODS.has(String(method).toUpperCase()) && hasBody(headers)) {
    const type = mediaTypeOf(headers['content-type']);
    const form =
      type === 'application/x-www-form-urlencoded' &&
      acceptsForm(path, formEncodedPaths);
    if (!isJsonMediaType(type) && !form) {
      return refusal(
        415,
        `Content-Type: ${type || 'none'}`,
        'Content-Type must be application/json',
      );
    }
  }
  return { ok: true };
}

/**
 * Connect middleware applying {@link checkApiRequest}. Refused requests get
 * a JSON error, and each route's refusals are logged at most once a minute.
 *
 * @param {object} [options]
 * @param {readonly string[]} [options.formEncodedPaths]
 * @param {(message: string) => void} [options.log]
 * @param {() => number} [options.now]
 */
export function createApiRequestGuard({
  formEncodedPaths = FORM_ENCODED_API_PATHS,
  log = (message) => console.warn(message),
  now = Date.now,
} = {}) {
  /** @type {Map<string, number>} */
  const lastLogged = new Map();
  let windowStart = Number.NEGATIVE_INFINITY;
  let linesInWindow = 0;
  /** @type {import('vite').Connect.NextHandleFunction} */
  return (req, res, next) => {
    const path =
      /** @type {{originalUrl?: string}} */ (req).originalUrl ?? req.url ?? '';
    const verdict = checkApiRequest(
      {
        method: req.method,
        path,
        headers: req.headers ?? {},
        encrypted: Boolean(
          /** @type {{encrypted?: boolean}} */ (req.socket)?.encrypted,
        ),
      },
      { formEncodedPaths },
    );
    if (verdict.ok) {
      next();
      return;
    }

    const route = printable(pathnameOf(path));
    const at = now();
    if (at - windowStart >= REFUSAL_LOG_INTERVAL_MS) {
      windowStart = at;
      linesInWindow = 0;
    }
    const last = lastLogged.get(route);
    if (
      linesInWindow < REFUSAL_LOG_MAX_LINES &&
      (last === undefined || at - last >= REFUSAL_LOG_INTERVAL_MS)
    ) {
      linesInWindow += 1;
      lastLogged.delete(route);
      lastLogged.set(route, at);
      if (lastLogged.size > REFUSAL_LOG_MAX_ROUTES) {
        const oldest = lastLogged.keys().next().value;
        if (oldest !== undefined) lastLogged.delete(oldest);
      }
      log(
        `[API guard] Refused ${printable(req.method || 'GET', 16)} ${route} (${printable(verdict.reason)})`,
      );
    }

    res.statusCode = verdict.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: verdict.error }));
  };
}

/**
 * Vite plugin: refuse cross-site requests before any `/api` route runs.
 *
 * `enforce: 'pre'` runs this plugin's server hooks before every normal
 * plugin's, so its middleware precedes all the provider routes; only Vite's
 * own CORS and Host checks and `hostCheckPlugin` (listed first) run before
 * it. `vite preview` gets the same guard, since it serves the same routes.
 *
 * @param {Parameters<typeof createApiRequestGuard>[0]} [options]
 * @returns {import('vite').Plugin}
 */
export function apiRequestGuardPlugin(options) {
  /** @param {import('vite').ViteDevServer | import('vite').PreviewServer} server */
  const install = (server) => {
    server.middlewares.use('/api', createApiRequestGuard(options));
  };
  return {
    name: 'api-request-guard',
    enforce: 'pre',
    configureServer: install,
    configurePreviewServer: install,
  };
}
