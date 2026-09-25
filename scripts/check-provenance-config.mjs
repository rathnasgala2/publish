#!/usr/bin/env node
/**
 * CI guard (PUB-C4, 2026-09-25): `release.yaml` passes `--provenance` to
 * `npm publish`, but that flag is a workflow argument a manual `npm
 * publish` can simply omit. `publishConfig.provenance: true` in the
 * manifest makes provenance a manifest fact instead: `npm publish` refuses
 * to proceed without it, from any machine, run by anyone.
 *
 * This does not, and cannot, backfill an attestation onto an
 * already-published version -- attestations are per-version and immutable.
 * It only guarantees that every version published from this point forward
 * carries one.
 */
import { readFile, readdir } from 'node:fs/promises';

import { runIfMain } from './run-if-main.mjs';

/**
 * @returns {Promise<void>} resolves when every package manifest declares
 *   publishConfig.provenance === true
 */
async function main() {
  const packageNames = (await readdir('packages')).sort();
  /** @type {string[]} */
  const diagnostics = [];
  for (const name of packageNames) {
    const manifestPath = `packages/${name}/package.json`;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.publishConfig?.provenance !== true) {
      diagnostics.push(
        `${manifestPath}: publishConfig.provenance must be true so ` +
          'npm publish structurally refuses to ship an unattested version.',
      );
    }
  }
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `publishConfig.provenance is true in all ${packageNames.length} package(s).`,
  );
}

await runIfMain(import.meta.url, main);
