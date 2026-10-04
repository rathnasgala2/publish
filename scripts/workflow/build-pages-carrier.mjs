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
/**
 * Encode the Pages carrier exactly as the adapter re-encodes it at stage time.
 *
 * The API renders the authorized marker as canonical JSON (keys sorted), while
 * the adapter serialises its own marker object in declaration order; the same
 * five values produce different bytes, and the adapter refuses a carrier whose
 * bytes are not its own (measured on production, rathnastest/g9, 2026-10-04).
 * So the marker is rebuilt through the adapter's validated builder from the
 * authorized values, never re-serialised from the authorization document.
 *
 * @param {Array<{path: string, bytes: Buffer}>} files the frozen envelope files
 * @param {Record<string, unknown>} authorizedMarker the marker the API authorized
 * @returns {Promise<Buffer>} the carrier bytes
 */
export async function buildPagesCarrier(files, authorizedMarker) {
  const {
    GENERATION_MARKER_PATH,
    buildValidatedMarker,
    encodeCarrier: encodePagesCarrier,
  } = await import('@rathnasgala2/adapter-github-pages');
  const marker = buildValidatedMarker({
    artifactId: String(authorizedMarker.artifactId),
    artifactDigest: String(authorizedMarker.artifactDigest),
    generationId: String(authorizedMarker.generationId),
  });
  return encodePagesCarrier([
    ...files,
    {
      path: GENERATION_MARKER_PATH,
      bytes: Buffer.from(JSON.stringify(marker), 'utf8'),
    },
  ]);
}

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
  const carrier = await buildPagesCarrier(
    envelope.files,
    /** @type {Record<string, unknown>} */ (authorization.marker),
  );
  await writeFile(out, carrier);
  process.stdout.write(
    `pages carrier: ${envelope.files.length + 1} member(s), ${carrier.byteLength} bytes\n`,
  );
}

await runIfMain(import.meta.url, main);
