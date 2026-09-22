/**
 * Pack one directory into a deterministic carrier. Used by `build` for the
 * unfrozen-output carrier.
 *
 * The build's `artifact-manifest.json` travels in the same carrier as a
 * member at `metadata/artifact-manifest.json` (`--manifest <file>`), where
 * `freeze` reads it as the envelope's manifest record; since PUBLISH-S4-6b
 * the build's normalized `build-input.json` (`--build-input <file>`) and
 * the verified `theme-contract.json` (`--theme-contract <file>`) travel the
 * same way at `metadata/build-input.json` and
 * `metadata/theme-contract.json`, where the authorization input quotes the
 * rebuild-record members the manifest does not carry. Every one of them is
 * a carrier member, never an artifact file, and an artifact directory that
 * itself contains one of those paths is refused.
 */

import { readFile, writeFile } from 'node:fs/promises';

import {
  BUILD_INPUT_MEMBER,
  THEME_CONTRACT_MEMBER,
  UNFROZEN_METADATA_MEMBERS,
} from './build-facts.mjs';
import {
  carrierDigest,
  encodeCarrier,
  parseOptions,
  requireOption,
  walkDirectory,
} from './carrier.mjs';
import { runIfMain } from '../run-if-main.mjs';

/** The carrier member the build manifest travels at. */
export const MANIFEST_MEMBER = 'metadata/artifact-manifest.json';

/** Option name to reserved member path. */
const METADATA_OPTIONS = Object.freeze({
  manifest: MANIFEST_MEMBER,
  'build-input': BUILD_INPUT_MEMBER,
  'theme-contract': THEME_CONTRACT_MEMBER,
});

/**
 * @returns {Promise<void>} resolves once the carrier has been written
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const directory = requireOption(options, 'directory');
  const out = requireOption(options, 'out');
  const files = await walkDirectory(directory);
  for (const reserved of UNFROZEN_METADATA_MEMBERS) {
    if (files.some((file) => file.path === reserved)) {
      throw new Error(
        `CARRIER_MEMBER_PATH_REFUSED: ${reserved} is reserved for the build's metadata`,
      );
    }
  }
  for (const [option, member] of Object.entries(METADATA_OPTIONS)) {
    if (options[option] !== undefined) {
      files.push({ path: member, bytes: await readFile(options[option]) });
    }
  }
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const carrier = encodeCarrier({
    purpose: options.purpose ?? 'unfrozen-output',
    metadata: {
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      fileCount: files.length,
    },
    files,
  });
  await writeFile(out, carrier);
  process.stdout.write(
    `${options.purpose ?? 'unfrozen-output'} carrier: ${files.length} file(s), ${carrierDigest(carrier)}\n`,
  );
}

await runIfMain(import.meta.url, main);
