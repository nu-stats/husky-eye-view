import { applicationHtmlPlugin } from './application-html.js';
import { contextCompressionPlugin } from './context-compression.js';
import { runtimeServingPlugin } from './runtime-serving.js';
import { readFileSync } from 'node:fs';

/** The release shown in the title plate. */
const APP_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
import cesium from 'vite-plugin-cesium';

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  host = 'localhost',
  port = 4173,
} = {}) {
  return {
    plugins: [
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
      allowedHosts:
        host === '0.0.0.0' || host === '::'
          ? true
          : ['localhost', '127.0.0.1', '.local'],
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
      // Build inputs under data/ are never served; watching a large file
      // while it is being written crashed the dev server (EBUSY on Windows).
      watch: {
        ignored: ['**/data/source/**', '**/data/restricted/**'],
      },
      // These headers protect the document containing Provider Settings.
      headers: {
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
      'import.meta.env.HEV_VERSION': JSON.stringify(APP_VERSION),
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
}
