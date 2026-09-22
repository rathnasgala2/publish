/**
 * `observe-carrier.mjs` re-observes an uploaded carrier by exact ID through
 * the get-artifact-by-ID REST operation (DEC-097 section 2.3) and exposes
 * it as job outputs only when the observation is complete. A response that
 * carries no `expires_at` cannot state the retention the authorization
 * input records, so it is refused by name rather than emitted as an output
 * (PUBLISH-S4-5, reviewer-added).
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'workflow',
  'observe-carrier.mjs',
);

/** @type {string} */
let workspace;
/** @type {import('node:http').Server} */
let server;
/** @type {string} */
let origin;
/** @type {Record<string, unknown>} */
let artifact = {};

before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'observe-carrier-'));
  await writeFile(path.join(workspace, 'carrier.bin'), 'carrier bytes');
  server = createServer((request, response) => {
    if (request.url !== '/repos/gala-author/site/actions/artifacts/5150') {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(artifact));
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (
    server.address()
  );
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(workspace, { recursive: true, force: true });
});

/**
 * @param {string} output the `$GITHUB_OUTPUT` file
 * @returns {Promise<{stdout: string, stderr: string}>} the child result
 */
function observe(output) {
  return run(
    process.execPath,
    [
      script,
      '--artifact-id',
      '5150',
      '--local',
      path.join(workspace, 'carrier.bin'),
    ],
    {
      env: {
        PATH: process.env.PATH ?? '',
        GH_TOKEN: 'test-token',
        GITHUB_REPOSITORY: 'gala-author/site',
        GITHUB_API_URL: origin,
        GITHUB_OUTPUT: output,
      },
    },
  );
}

test('a re-observed artifact without expires_at is refused, not emitted', async () => {
  artifact = {
    id: 5150,
    name: 'gala-r1-a1-frozen-envelope-v2',
    expired: false,
  };
  const output = path.join(workspace, 'no-expiry.txt');
  await writeFile(output, '');
  await assert.rejects(observe(output), /CARRIER_REST_EXPIRY_UNKNOWN/u);
  assert.equal(await readFile(output, 'utf8'), '', 'no output was emitted');
});

test('a complete observation emits the id, name, digest, byte count and expiry', async () => {
  artifact = {
    id: 5150,
    name: 'gala-r1-a1-frozen-envelope-v2',
    expired: false,
    expires_at: '2026-09-25T12:00:00Z',
  };
  const output = path.join(workspace, 'complete.txt');
  await writeFile(output, '');
  await observe(output);
  const lines = (await readFile(output, 'utf8')).trim().split('\n');
  assert.deepEqual(
    lines.map((line) => line.slice(0, line.indexOf('='))),
    [
      'artifact_id',
      'artifact_name',
      'artifact_digest',
      'artifact_byte_count',
      'artifact_expires_at',
    ],
  );
  assert.ok(lines.includes('artifact_expires_at=2026-09-25T12:00:00Z'));
});
