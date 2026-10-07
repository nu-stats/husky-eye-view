/**
 * Stata on this computer, for the Stata Analysis panel and the voice tools.
 *
 *   GET  /api/stata/status                    -> {found, version, edition, folder}
 *   GET  /api/stata/variables?geography=tract -> the dataset's variables
 *   POST /api/stata/run   {geography, state?, view?, commands[], doFile?}
 *        -> runs Stata in batch mode; {ok, id, steps, log, files, problems}
 *   POST /api/stata/open  {geography, state?, view?}
 *        -> opens the Stata window with the data loaded; {ok, id, files}
 *   GET  /api/stata/sessions/<id>/<file>      -> one file of a session
 *   GET  /api/stata/sessions/<id>.zip         -> the whole session
 *
 * Everything answers only the machine running the server (the same gate as
 * Provider Settings: loopback socket, local Host, same Origin and JSON on
 * POST, no proxy headers): Stata, its license and the uploaded do-files are
 * this computer's, and a do-file is code.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { admitKeySetupRequest } from '../../src/keySetupCore.mjs';
import { analysisVariables } from '../../src/analysis/stataCommands.js';
import {
  analysisRoot,
  findStata,
  openInteractive,
  prepareSession,
  runSession,
  sessionFiles,
  sessionFolder,
  sessionZip,
} from '../analysis/stataSession.js';

const MAX_BODY = 512 * 1024;
const TYPES = {
  '.csv': 'text/csv; charset=utf-8',
  '.do': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.dta': 'application/x-stata-dta',
};

/** @returns {import('vite').Plugin} */
export function stataProxy({ env = process.env, locate = findStata } = {}) {
  let busy = false;
  let stata;
  const stataNow = () =>
    stata === undefined ? (stata = locate({ env })) : stata;

  const sendJson = (res, status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };
  const admit = (req) =>
    admitKeySetupRequest({
      method: req.method,
      remoteAddress: req.socket?.remoteAddress,
      hostHeader: req.headers?.host,
      protocol: req.socket?.encrypted ? 'https:' : 'http:',
      origin: req.headers?.origin,
      contentType: req.headers?.['content-type'],
      proxyHeaders: req.headers || {},
      env,
    });
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) {
          reject(new Error('too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });

  const install = (server) => {
    server.middlewares.use('/api/stata', async (req, res) => {
      const admission = admit(req);
      if (!admission.ok)
        return sendJson(res, admission.status, {
          error: 'Stata runs only for the computer running Husky Eye View.',
        });
      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/^\/+|\/+$/g, '');
      try {
        if (req.method === 'GET' && route === 'status') {
          const found = stataNow();
          return sendJson(res, 200, {
            found: Boolean(found),
            version: found?.version ?? null,
            edition: found?.edition ?? null,
            folder: analysisRoot(env),
          });
        }
        if (req.method === 'GET' && route === 'variables') {
          return sendJson(res, 200, {
            variables: analysisVariables(
              url.searchParams.get('geography') || 'county',
            ).map(({ name, label, kind }) => ({ name, label, kind })),
          });
        }
        const file = route.match(/^sessions\/([\w.-]+?)(?:\.zip|\/([\w.-]+))$/);
        if (req.method === 'GET' && file) {
          const folder = sessionFolder(file[1], env);
          if (!folder) return sendJson(res, 404, { error: 'No such session.' });
          if (!file[2]) {
            const zip = sessionZip(folder);
            res.writeHead(200, {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename="${file[1]}.zip"`,
              'Cache-Control': 'no-store',
            });
            return res.end(Buffer.from(zip));
          }
          if (!sessionFiles(folder).includes(file[2]))
            return sendJson(res, 404, { error: 'No such file.' });
          const full = path.join(folder, file[2]);
          if (!existsSync(full))
            return sendJson(res, 404, { error: 'No such file.' });
          res.writeHead(200, {
            'Content-Type':
              TYPES[path.extname(full).toLowerCase()] ||
              'application/octet-stream',
            'Cache-Control': 'no-store',
          });
          return res.end(readFileSync(full));
        }
        if (req.method === 'POST' && (route === 'run' || route === 'open')) {
          if (busy)
            return sendJson(res, 409, {
              ok: false,
              problems: ['Stata is still working on the last request.'],
            });
          const request = await readBody(req);
          const found = stataNow();
          if (!found)
            return sendJson(res, 200, {
              ok: false,
              problems: [
                'Stata was not found on this computer (looked for Stata 18 and 19). Set HEV_STATA_PATH to its program file.',
              ],
            });
          busy = true;
          try {
            const interactive = route === 'open';
            const prepared = prepareSession(
              {
                geography: request.geography,
                state: request.state,
                view: request.view,
                commands: interactive ? [] : request.commands,
                doFile: interactive ? null : request.doFile,
                interactive,
              },
              { env },
            );
            if (!prepared.ok) return sendJson(res, 200, prepared);
            const session = prepared.session;
            const result = interactive
              ? openInteractive(session, { stata: found })
              : await runSession(session, { stata: found });
            return sendJson(res, 200, {
              ...result,
              id: session.id,
              title: session.title,
              areas: session.areas,
              folder: session.folder,
              stata: { version: found.version, edition: found.edition },
            });
          } finally {
            busy = false;
          }
        }
        return sendJson(res, 404, { error: 'Unknown Stata route' });
      } catch (error) {
        return sendJson(res, 400, { ok: false, problems: [error.message] });
      }
    });
  };
  return {
    name: 'hev-stata',
    configureServer: install,
    configurePreviewServer: install,
  };
}
