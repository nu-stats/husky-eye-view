/**
 * Stata on this computer, for the Stata Analysis panel and the voice tools:
 * /api/stata/* (see analysis.js for the routes and the local-only gate).
 */
import { analysisProxy } from './analysis.js';
import {
  findStata,
  openInteractive,
  prepareSession,
  runSession,
} from '../analysis/stataSession.js';

/** @returns {import('vite').Plugin} */
export function stataProxy({ env = process.env, locate = findStata } = {}) {
  return analysisProxy({
    name: 'Stata',
    plugin: 'hev-stata',
    prefix: '/api/stata',
    missing:
      'Stata was not found on this computer (looked for Stata 18 and 19). Set HEV_STATA_PATH to its program file.',
    locate,
    describe: (stata) => ({ version: stata.version, edition: stata.edition }),
    prepare: prepareSession,
    run: (session, stata) => runSession(session, { stata }),
    open: (session, stata) => openInteractive(session, { stata }),
    env,
  });
}
