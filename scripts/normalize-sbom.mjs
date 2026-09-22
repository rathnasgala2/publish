#!/usr/bin/env node
/**
 * Normalize the two volatile fields `cyclonedx-npm` writes on every run
 * (`serialNumber`, a fresh random UUID, and `metadata.timestamp`, the
 * generation wall-clock time) so the committed `sbom.cdx.json` is stable
 * across regenerations and `git status --porcelain` stays clean after
 * `npm run verify` (which runs `npm run sbom`).
 *
 * `serialNumber` and `metadata.timestamp` carry no content information (an
 * SBOM's actual inventory is its `components`/`dependencies` arrays); this
 * script replaces both with fixed sentinel values so two SBOM generations
 * over an unchanged dependency tree produce byte-identical output.
 * `scripts/check-sbom-fresh.mjs` regenerates into a scratch file the same
 * way and compares content against the committed file.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The fixed sentinel `serialNumber`, replacing the random UUID CycloneDX generates per run. */
export const NORMALIZED_SERIAL_NUMBER =
  'urn:uuid:00000000-0000-0000-0000-000000000000';

/** The fixed sentinel `metadata.timestamp`, replacing the generation wall-clock time. */
export const NORMALIZED_TIMESTAMP = '1970-01-01T00:00:00.000Z';

/**
 * Normalize the volatile fields of one parsed CycloneDX document in place
 * and return it.
 *
 * @param {Record<string, unknown>} bom the parsed CycloneDX document
 * @returns {Record<string, unknown>} the same document, mutated
 */
export function normalizeBom(bom) {
  if (typeof bom.serialNumber === 'string') {
    bom.serialNumber = NORMALIZED_SERIAL_NUMBER;
  }
  const metadata = /** @type {Record<string, unknown> | undefined} */ (
    bom.metadata
  );
  if (metadata !== undefined && typeof metadata.timestamp === 'string') {
    metadata.timestamp = NORMALIZED_TIMESTAMP;
  }
  return bom;
}

/**
 * Normalize the SBOM file at `sbomPath`, rewriting it in place with a
 * trailing newline.
 *
 * @param {string} sbomPath path to the CycloneDX JSON document
 * @returns {void}
 */
export function normalizeSbomFile(sbomPath) {
  const bom = JSON.parse(readFileSync(sbomPath, 'utf8'));
  normalizeBom(bom);
  writeFileSync(sbomPath, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  normalizeSbomFile(path.resolve(process.argv[2] ?? 'sbom.cdx.json'));
  process.stdout.write(
    'normalize-sbom: serialNumber and metadata.timestamp normalized\n',
  );
}
