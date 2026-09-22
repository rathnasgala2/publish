#!/usr/bin/env node
/**
 * Assert the committed CycloneDX SBOM (`sbom.cdx.json`) is present,
 * structurally valid, and byte-identical to a fresh regeneration (WORKSPACE.md
 * section 5, item 9: "a release without an SBOM does not publish"; carried
 * warning fix: `npm run sbom` used to rewrite `serialNumber`/`metadata.timestamp`
 * on every run even when the dependency tree was unchanged, so `npm run
 * verify` never left `git status --porcelain` clean).
 *
 * `npm run sbom` now normalizes those two volatile fields
 * (`scripts/normalize-sbom.mjs`) immediately after `cyclonedx-npm` writes
 * the file, so two generations over an unchanged dependency tree are
 * byte-identical. This script proves that: it regenerates into a scratch
 * file the same way, normalizes it the same way, and compares content
 * against the committed file rather than only checking gross shape.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSbomFile } from './normalize-sbom.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '..');
const committedPath = path.join(workspaceRoot, 'sbom.cdx.json');

/**
 * Validate the CycloneDX document has the expected shape.
 *
 * @param {Record<string, unknown>} bom parsed CycloneDX document
 * @returns {void}
 */
function checkShape(bom) {
  if (bom.bomFormat !== 'CycloneDX') {
    throw new Error('sbom.cdx.json is not a CycloneDX document');
  }
  if (typeof bom.specVersion !== 'string') {
    throw new Error('sbom.cdx.json is missing specVersion');
  }
}

/**
 * Run the freshness check: read the committed SBOM, regenerate a fresh one
 * into a scratch directory with the same normalization `npm run sbom`
 * applies, and assert the two are byte-identical.
 *
 * @returns {void}
 */
function check() {
  /** @type {string} */
  let committedRaw;
  try {
    committedRaw = readFileSync(committedPath, 'utf8');
  } catch {
    throw new Error(
      `Missing ${committedPath}. Run "npm run sbom" before "npm run verify".`,
    );
  }
  const committedBom = JSON.parse(committedRaw);
  checkShape(committedBom);

  const scratch = mkdtempSync(path.join(tmpdir(), 'gala-sbom-'));
  try {
    const scratchPath = path.join(scratch, 'sbom.cdx.json');
    const result = spawnSync(
      process.execPath,
      [
        path.join(workspaceRoot, 'node_modules', '.bin', 'cyclonedx-npm'),
        '--output-file',
        scratchPath,
        '--output-format',
        'json',
        '--spec-version',
        '1.6',
      ],
      { stdio: 'inherit', cwd: workspaceRoot },
    );
    if (result.status !== 0) {
      throw new Error('Fresh SBOM regeneration failed');
    }
    normalizeSbomFile(scratchPath);

    const freshRaw = readFileSync(scratchPath, 'utf8');
    if (freshRaw !== committedRaw) {
      throw new Error(
        'sbom.cdx.json is stale: it differs from a fresh "npm run sbom" regeneration. Run "npm run sbom" and commit the result.',
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  process.stdout.write(
    `sbom:check: CycloneDX ${committedBom.specVersion} document at ${committedPath} is byte-identical to a fresh regeneration\n`,
  );
}

check();
