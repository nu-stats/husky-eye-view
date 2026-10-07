/**
 * R on this computer, for the R Analysis panel and the voice tools:
 * /api/r/* (see analysis.js for the routes and the local-only gate).
 */
import { analysisProxy } from './analysis.js';
import {
  findR,
  openRInteractive,
  prepareRSession,
  runRSession,
} from '../analysis/rSession.js';

/** @returns {import('vite').Plugin} */
export function rProxy({ env = process.env, locate = findR } = {}) {
  return analysisProxy({
    name: 'R',
    plugin: 'hev-r',
    prefix: '/api/r',
    missing:
      'R was not found on this computer. Install it from cran.r-project.org, or set HEV_R_PATH to Rscript.',
    locate,
    describe: (r) => ({ version: r.version, rstudio: Boolean(r.rstudio) }),
    prepare: prepareRSession,
    run: (session, r) => runRSession(session, { r }),
    open: (session, r) => openRInteractive(session, { r }),
    env,
  });
}
