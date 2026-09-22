/**
 * `deploy-github-pages`: build the deterministic Pages carrier from the
 * verified frozen envelope plus the authorized public generation marker.
 *
 * The Pages carrier is a separate identity from the frozen envelope; frozen
 * payload identity can never substitute for Pages carrier identity
 * (brief section 2.3).
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findCarrier } from './decode-carrier.mjs';
import { parseOptions, requireOption } from './carrier.mjs';
import { decodeFrozenEnvelope } from './frozen-envelope.mjs';
import { runIfMain } from '../run-if-main.mjs';

/**
 * Find the deployment-authorization carrier in an inbox.
 *
 * @param {string} inbox the download directory
 * @returns {Promise<Record<string, unknown>>} the parsed authorization
 */
export async function readAuthorization(inbox) {
  const entries = await readdir(inbox, {
    withFileTypes: true,
    recursive: true,
  });
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.includes('deployment-authorization-v2')
    ) {
      continue;
    }
    return JSON.parse(
      (
        await readFile(path.join(entry.parentPath ?? inbox, entry.name))
      ).toString('utf8'),
    );
  }
  throw new Error(
    `DEPLOYMENT_AUTHORIZATION_NOT_FOUND: no deployment-authorization carrier in ${inbox}`,
  );
}

/**
 * @returns {Promise<void>} resolves once the Pages carrier is written
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const inbox = requireOption(options, 'inbox');
  const out = requireOption(options, 'out');

  // Only the payload records are staged: the manifest, provenance and SBOM
  // records are never artifact inventory (DEC-097 section 6).
  const envelope = decodeFrozenEnvelope(
    (await findCarrier(inbox, requireOption(options, 'envelope-digest'))).bytes,
  );
  const authorization = await readAuthorization(inbox);
  const marker = /** @type {Record<string, unknown>} */ (authorization.marker);

  const { GENERATION_MARKER_PATH, encodeCarrier: encodePagesCarrier } =
    await import('@rathnasgala2/adapter-github-pages');
  const carrier = encodePagesCarrier([
    ...envelope.files,
    {
      path: GENERATION_MARKER_PATH,
      bytes: Buffer.from(JSON.stringify(marker), 'utf8'),
    },
  ]);
  await writeFile(out, carrier);
  process.stdout.write(
    `pages carrier: ${envelope.files.length + 1} member(s), ${carrier.byteLength} bytes\n`,
  );
}

await runIfMain(import.meta.url, main);
