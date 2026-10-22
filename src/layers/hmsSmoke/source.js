import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { validateSmokeSnapshot } from './records.js';

export const SMOKE_RESPONSE_LIMIT = 8 * 1024 * 1024;

/**
 * NOAA HMS daily smoke polygons over the United States, through the
 * same-origin proxy (/api/hms-smoke). The upstream host sends no CORS
 * headers, and the proxy also drops the smoke outside the US before it
 * reaches the browser.
 * Adapted from the Sheldondouthat/satwq-reality-os fork of God's Eye View (MIT).
 */
export function createHmsSmokeSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = '/api/hms-smoke',
  timeoutMs = 30_000,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error('HMS smoke request timed out')),
        timeoutMs,
      );
      try {
        signal?.throwIfAborted();
        const response = await fetchImpl(apiUrl, {
          signal: controller.signal,
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel?.();
          throw new Error(
            response.status === 503
              ? 'NOAA HMS smoke unavailable'
              : `HMS smoke HTTP ${response.status}`,
          );
        }
        let payload;
        try {
          payload = await readResponseJsonCapped(
            response,
            SMOKE_RESPONSE_LIMIT,
            controller.signal,
          );
        } catch (error) {
          if (controller.signal.aborted) throw error;
          throw new Error(`Malformed HMS smoke snapshot: ${error?.message}`);
        }
        controller.signal.throwIfAborted();
        return validateSmokeSnapshot(payload);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
