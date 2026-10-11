#!/usr/bin/env node
/**
 * Dormant publication guard (PUB-C4, 2026-09-25): source-only delivery keeps
 * every workspace package private and release automation holds no npm publish
 * credential. If publication is deliberately restored later,
 * `publishConfig.provenance: true` remains a manifest-level requirement that a
 * manual command cannot omit.
 *
 * This does not, and cannot, backfill an attestation onto an
 * already-published version -- attestations are per-version and immutable.
 * It guarantees that any future version can only be published with provenance.
 */
import { readFile, readdir } from 'node:fs/promises';

import { runIfMain } from './run-if-main.mjs';

/**
 * @param {string} manifestPath diagnostic path for this package's manifest
 * @param {{publishConfig?: Record<string, unknown>}} manifest parsed package.json
 * @returns {string[]} zero or one diagnostic
 */
export function provenanceDiagnostics(manifestPath, manifest) {
  if (manifest.publishConfig?.provenance !== true) {
    return [
      `${manifestPath}: publishConfig.provenance must be true so ` +
        'any future npm publication structurally refuses an unattested version.',
    ];
  }
  return [];
}

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
    diagnostics.push(...provenanceDiagnostics(manifestPath, manifest));
  }
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `publishConfig.provenance is true in all ${packageNames.length} package(s).`,
  );
}

await runIfMain(import.meta.url, main);
