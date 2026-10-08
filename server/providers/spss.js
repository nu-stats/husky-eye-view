/**
 * IBM SPSS Statistics on this computer, for the SPSS Analysis panel and the
 * voice tools: /api/spss/* (see analysis.js for the routes and the
 * local-only gate).
 */
import { analysisProxy } from './analysis.js';
import {
  findSpss,
  openSpssInteractive,
  prepareSpssSession,
  runSpssSession,
} from '../analysis/spssSession.js';

/** @returns {import('vite').Plugin} */
export function spssProxy({ env = process.env, locate = findSpss } = {}) {
  return analysisProxy({
    name: 'SPSS',
    plugin: 'hev-spss',
    prefix: '/api/spss',
    missing:
      'IBM SPSS Statistics was not found on this computer. Set HEV_SPSS_PATH to its program (stats.exe) or install folder.',
    locate,
    describe: (spss) => ({
      version: spss.version,
      python: Boolean(spss.python),
    }),
    prepare: prepareSpssSession,
    run: (session, spss) => runSpssSession(session, { spss }),
    open: (session, spss) => openSpssInteractive(session, { spss }),
    env,
  });
}
