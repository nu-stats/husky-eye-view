import { applicationHtmlPlugin } from './application-html.js';
import { contextCompressionPlugin } from './context-compression.js';
import { runtimeServingPlugin } from './runtime-serving.js';
import { readFileSync } from 'node:fs';

/** The release shown in the title plate. */
const APP_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
import cesium from 'vite-plugin-cesium';
import { DEFAULT_ALLOWED_HOSTS, hostCheckPlugin } from './allowedHosts.js';

/**
 * Content-Security-Policy for every document the dev/preview server serves.
 * No inline script is permitted, and the only foreign script origins are the
 * three that the Bhote Koshi event's embedded media needs (YouTube, Facebook
 * and X), which frame-src matches for their players and posts. 'unsafe-eval' is
 * required: Knockout (bundled inside @cesium/widgets) resolves the global
 * object with `(0, eval)("this")` at module load, and without it the Cesium
 * widget never initializes (verified in headless Chrome). It also covers
 * Cesium's WASM decoders. `blob:` is required in the built app: Cesium's
 * bundled workers bootstrap through `importScripts(blob:...)`, which a worker
 * checks against script-src (the dev server loads them by URL instead).
 * Widen any other directive only for a real violation.
 */
export const BROWSER_CSP = [
  "default-src 'self'",
  // The Bhote Koshi event's embedded media: the YouTube player API, the
  // Facebook video SDK and X's post widget (src/data/bhoteKoshiEmbeddedMedia.js).
  "script-src 'self' 'unsafe-eval' blob: https://www.youtube.com https://connect.facebook.net https://platform.twitter.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' blob: data: https: wss: ws:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  // The same media's players and posts, which load in frames.
  "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.youtube.com https://www.facebook.com https://platform.twitter.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Response headers shared by the dev and preview servers. */
export const BROWSER_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': BROWSER_CSP,
  // Responses are only ever used as the type the server declares.
  'X-Content-Type-Options': 'nosniff',
});

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  host = 'localhost',
  port = 4173,
  allowedHosts = DEFAULT_ALLOWED_HOSTS,
} = {}) {
  return {
    plugins: [
      // First, so no provider route answers a Host the server does not allow.
      hostCheckPlugin(),
      cesium(),
      applicationHtmlPlugin(),
      contextCompressionPlugin(),
      runtimeServingPlugin(),
      ...plugins,
    ],
    ...(publicDir === undefined ? {} : { publicDir }),
    server: {
      host: host || 'localhost',
      port: parseInt(port, 10) || 4173,
      // A wildcard bind only chooses interfaces; it never disables Vite's
      // Host-header check. LAN hostnames are added explicitly (see
      // build/allowedHosts.js); IP addresses are always accepted.
      allowedHosts: [...allowedHosts],
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
      // Build inputs under data/ are never served; watching a large file
      // while it is being written crashed the dev server (EBUSY on Windows).
      watch: {
        ignored: ['**/data/source/**', '**/data/restricted/**'],
      },
      // These headers protect the document containing Provider Settings and
      // give the whole page a real Content-Security-Policy (BROWSER_CSP).
      headers: BROWSER_HEADERS,
    },
    // The preview server serves the same documents, so it carries the same
    // framing + CSP hardening (one constant, no drift).
    preview: { headers: BROWSER_HEADERS },
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
      'import.meta.env.HEV_VERSION': JSON.stringify(APP_VERSION),
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
}
