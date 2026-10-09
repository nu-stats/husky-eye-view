/**
 * Excel Analysis, for its panel and the voice tools: /api/excel/* (see
 * analysis.js for the routes and the local-only gate). Runs are computed
 * here and written as workbooks, so Excel is needed only to open them.
 */
import { analysisProxy } from './analysis.js';
import {
  findExcel,
  openExcelInteractive,
  prepareExcelSession,
  runExcelSession,
} from '../analysis/excelSession.js';

/** @returns {import('vite').Plugin} */
export function excelProxy({ env = process.env, locate = findExcel } = {}) {
  return analysisProxy({
    name: 'Excel',
    plugin: 'hev-excel',
    prefix: '/api/excel',
    missing: 'Excel is not available.',
    locate,
    describe: (excel) => ({
      version: excel.version,
      excel: Boolean(excel.path),
    }),
    prepare: prepareExcelSession,
    run: (session) => runExcelSession(session),
    open: (session, excel) => openExcelInteractive(session, { excel }),
    env,
  });
}
