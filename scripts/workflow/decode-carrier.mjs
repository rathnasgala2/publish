/**
 * Rehash, revalidate and decode exactly one downloaded carrier.
 *
 * A consumer never trusts a downloaded file because the download succeeded:
 * it recomputes the tagged digest, compares it to the producer's job
 * output, and only then decodes — and the decode itself re-verifies every
 * member digest.
 */

import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  carrierDigest,
  decodeCarrier,
  materialize,
  parseOptions,
  requireOption,
} from './carrier.mjs';
import { runIfMain } from '../run-if-main.mjs';

/**
 * Locate one downloaded carrier file inside an inbox directory.
 *
 * @param {string} inbox the download directory
 * @param {string} expectedDigest the producer's tagged digest
 * @returns {Promise<{file: string, bytes: Buffer}>} the matching carrier
 */
export async function findCarrier(inbox, expectedDigest) {
  const entries = await readdir(inbox, {
    withFileTypes: true,
    recursive: true,
  });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const file = path.join(entry.parentPath ?? inbox, entry.name);
    const bytes = await readFile(file);
    if (carrierDigest(bytes) === expectedDigest) {
      return { file, bytes };
    }
  }
  throw new Error(
    `CARRIER_DIGEST_NOT_FOUND: no downloaded file in ${inbox} digests to ${expectedDigest}`,
  );
}

/**
 * @returns {Promise<void>} resolves once the carrier has been materialized
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const inbox = requireOption(options, 'inbox');
  const expectedDigest = requireOption(options, 'expected-digest');
  const out = requireOption(options, 'out');

  const { bytes } = await findCarrier(inbox, expectedDigest);
  const envelope = decodeCarrier(bytes);
  await mkdir(out, { recursive: true });
  await materialize(out, envelope.files);
  process.stdout.write(
    `decoded ${envelope.purpose} carrier: ${envelope.files.length} file(s) into ${out}\n`,
  );
}

await runIfMain(import.meta.url, main);
