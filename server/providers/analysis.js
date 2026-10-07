/**
 * A statistics program on this computer (Stata or R), for its Analysis panel
 * and voice tools. One endpoint per program, under its own prefix:
 *
 *   GET  <prefix>/status                    -> {found, version, …, folder}
 *   GET  <prefix>/variables?geography=tract -> the dataset's variables
 *   POST <prefix>/run   {geography, state?, view?, commands[], doFile?}
 *        -> runs the program in batch mode; {ok, id, steps, log, files, problems}
 *   POST <prefix>/open  {geography, state?, view?}
 *        -> opens the program itself with the data loaded; {ok, id, files}
 *   GET  <prefix>/sessions/<id>/<file>      -> one file of a session
 *   GET  <prefix>/sessions/<id>.zip         -> the whole session
 *
 * Everything answers only the machine running the server (the same gate as
 * Provider Settings: loopback socket, local Host, same Origin and JSON on
 * POST, no proxy headers): the program, its license and the uploaded scripts
 * are this computer's, and a script is code.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { admitKeySetupRequest } from '../../src/keySetupCore.mjs';
import { analysisVariables } from '../../src/analysis/stataCommands.js';
import { sampleLayerVariables } from '../analysis/layerData.js';
import {
  analysisRoot,
  sessionFiles,
  sessionFolder,
  sessionZip,
} from '../analysis/stataSession.js';

const MAX_BODY = 512 * 1024;
const TYPES = {
  '.csv': 'text/csv; charset=utf-8',
  '.do': 'text/plain; charset=utf-8',
  '.r': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.dta': 'application/x-stata-dta',
  '.rds': 'application/octet-stream',
  '.rdata': 'application/octet-stream',
};

/**
 * @param {{name: string, plugin: string, prefix: string, missing: string,
 *   locate: Function, describe: Function, prepare: Function, run: Function,
 *   open: Function, env?: object}} program
 * @returns {import('vite').Plugin}
 */
export function analysisProxy({
  name,
  plugin,
  prefix,
  missing,
  locate,
  describe,
  prepare,
  run,
  open,
  env = process.env,
}) {
  let busy = false;
  let found;
  const program = () =>
    found === undefined ? (found = locate({ env })) : found;

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
    server.middlewares.use(prefix, async (req, res) => {
      const admission = admit(req);
      if (!admission.ok)
        return sendJson(res, admission.status, {
          error: `${name} runs only for the computer running Husky Eye View.`,
        });
      const url = new URL(req.url || '/', 'http://localhost');
      const route = url.pathname.replace(/^\/+|\/+$/g, '');
      try {
        if (req.method === 'GET' && route === 'status') {
          const current = program();
          return sendJson(res, 200, {
            found: Boolean(current),
            ...(current ? describe(current) : {}),
            folder: analysisRoot(env),
          });
        }
        if (req.method === 'GET' && route === 'variables') {
          const baseUrl = url.searchParams.get('baseUrl');
          return sendJson(res, 200, {
            variables: (baseUrl
              ? sampleLayerVariables({ baseUrl })
              : analysisVariables(url.searchParams.get('geography') || 'county')
            ).map(({ name: variable, label, kind }) => ({
              name: variable,
              label,
              kind,
            })),
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
              problems: [`${name} is still working on the last request.`],
            });
          const request = await readBody(req);
          const current = program();
          if (!current)
            return sendJson(res, 200, { ok: false, problems: [missing] });
          busy = true;
          try {
            const interactive = route === 'open';
            const prepared = prepare(
              {
                geography: request.geography,
                baseUrl: request.baseUrl,
                layerName: request.layerName,
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
              ? open(session, current)
              : await run(session, current);
            return sendJson(res, 200, {
              ...result,
              id: session.id,
              title: session.title,
              areas: session.areas,
              folder: session.folder,
              program: describe(current),
            });
          } finally {
            busy = false;
          }
        }
        return sendJson(res, 404, { error: `Unknown ${name} route` });
      } catch (error) {
        return sendJson(res, 400, { ok: false, problems: [error.message] });
      }
    });
  };
  return {
    name: plugin,
    configureServer: install,
    configurePreviewServer: install,
  };
}
