/**
 * `preview`: builds, then serves the candidate directory read-only on
 * localhost for author inspection. Performs no deployment, mints no
 * credential, reaches no network beyond the loopback socket it itself
 * listens on (S2 brief section 5).
 *
 * @module
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { runBuild } from './build.js';
import { buildResultEnvelope } from '../result.js';

/** @type {Readonly<Record<string, string>>} */
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
});

/**
 * Serve `rootDirectory` read-only, bound to loopback only (`127.0.0.1`) on
 * an OS-assigned ephemeral port (`port: 0`) so `preview` never claims a
 * fixed, potentially-in-use port and never becomes reachable off the local
 * machine.
 *
 * @param {string} rootDirectory the absolute directory to serve
 * @returns {Promise<{url: string, close: () => Promise<void>}>} the bound
 *   preview server's URL and a teardown callback
 */
export function serveDirectoryReadOnly(rootDirectory) {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        let relativePath = decodeURIComponent(requestUrl.pathname).replace(
          /^\/+/u,
          '',
        );
        if (relativePath === '' || relativePath.endsWith('/')) {
          relativePath += 'index.html';
        }
        if (relativePath.includes('..')) {
          response.writeHead(400).end('Bad request');
          return;
        }
        const absolutePath = path.join(rootDirectory, relativePath);
        if (!absolutePath.startsWith(rootDirectory)) {
          response.writeHead(400).end('Bad request');
          return;
        }
        const fileStats = await stat(absolutePath).catch(() => null);
        if (!fileStats || !fileStats.isFile()) {
          response.writeHead(404).end('Not found');
          return;
        }
        const contentType =
          CONTENT_TYPES[path.extname(absolutePath)] ??
          'application/octet-stream';
        response.writeHead(200, {
          'Content-Type': contentType,
          'X-Gala-Preview': 'local-only',
        });
        createReadStream(absolutePath).pipe(response);
      } catch {
        response.writeHead(500).end('Internal error');
      }
    })();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (
        server.address()
      );
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}

/**
 * Build the repository, then serve the rendered candidate directory
 * read-only on loopback. Returns immediately once the server is listening;
 * the caller (the CLI, or a test) owns the server's lifetime through the
 * returned `close()`.
 *
 * @param {{
 *   repositoryDirectory: string,
 *   outputDirectory: string,
 *   workDirectory: string
 * }} options build inputs, identical to `build`
 * @returns {Promise<{
 *   envelope: Record<string, unknown>,
 *   server?: {url: string, close: () => Promise<void>}
 * }>} the build's result envelope (stamped with `previewUrl` on success) and
 *   the running server, when the build succeeded
 */
export async function runPreview({
  repositoryDirectory,
  outputDirectory,
  workDirectory,
}) {
  const buildResult = await runBuild({
    repositoryDirectory,
    outputDirectory,
    workDirectory,
  });
  if (buildResult.resultCode !== 'SUCCESS' || !buildResult.outputDirectory) {
    return {
      envelope: buildResultEnvelope({ ...buildResult, command: 'preview' }),
    };
  }
  const server = await serveDirectoryReadOnly(buildResult.outputDirectory);
  return {
    envelope: buildResultEnvelope({
      ...buildResult,
      command: 'preview',
      previewUrl: server.url,
    }),
    server,
  };
}
