/**
 * `build`: consumes one immutable source snapshot plus the exact lock,
 * writes only into an explicit clean output and work directory, emits the
 * artifact directory plus `artifact-manifest:2.0.0`. Never edits source or
 * lock. Never deploys (S2 brief section 5: deployment only happens through
 * the GitHub Action path).
 *
 * @module
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { computeArtifactDigest } from '@rathnasgala2/adapter-local-directory';

import {
  assertDistinctBuildDirectories,
  assertWipeableBuildDirectory,
  writeBuildDirectoryMarker,
} from '../build-directory-safety.js';
import { findingsFromError } from '../error-findings.js';
import { buildBuildInputFromRepository } from '../normalize/repository-intake.js';
import { buildProvenance } from '../normalize/provenance.js';
import { importTemplatePublicEntry } from '../template-bridge.js';
import { resolveThemeDirectory } from '../theme-bridge.js';
import { buildResultEnvelope, classifyFindings } from '../result.js';
import { readManifestFileBytes } from '../artifact-files.js';

/**
 * @param {{
 *   repositoryDirectory: string,
 *   outputDirectory: string,
 *   workDirectory: string,
 *   routeNormalizationProfile?: 'directory-index' | 'explicit-file'
 * }} options the build's input/output directories
 * @returns {Promise<import('../types.js').ResultEnvelope & {outputDirectory?: string, manifest?: Record<string, unknown>}>}
 *   the closed result envelope, plus (only on success, for an in-process
 *   caller such as `preview`) the rendered `outputDirectory` and `manifest`
 */
export async function runBuild({
  repositoryDirectory,
  outputDirectory,
  workDirectory,
  routeNormalizationProfile,
}) {
  try {
    const buildInput = await buildBuildInputFromRepository({
      repositoryDirectory,
    });
    const packages =
      /** @type {{theme: {package: string, version: string, integrity: string, registry: string}}} */ (
        buildInput.packages
      );
    const provenance = await buildProvenance(packages.theme);
    const themeDirectory = await resolveThemeDirectory({
      repositoryDirectory,
      theme: packages.theme,
    });
    const { renderPublication } =
      /** @type {{renderPublication: (buildInput: unknown, options: unknown) => Promise<{outputDirectory: string, manifest: Record<string, unknown>}>}} */ (
        await importTemplatePublicEntry()
      );

    // This module's own contract (this file's header comment) is "writes
    // only into an explicit clean output and work directory" — enforce it
    // rather than merely stating it: a caller that reuses `outputDirectory`
    // across two `runBuild` calls (a local author's own preview build
    // followed by the Action's own build-then-deploy into the same default
    // `.gala/output`, exactly S2 brief section 5's documented flow) would
    // otherwise hand `renderPublication` a directory that still holds the
    // previous render's asset files. `renderPublication`'s own route
    // listing is a full re-scan of `outputDirectory` after Eleventy runs
    // (`template`'s `listFilesSortedByUtf8Bytes(outputDirectory)`), so a
    // leftover asset file from a prior render is picked up as an extra
    // manifest route in addition to being re-listed under `manifest.assets`
    // — an artifact-manifest file set that no longer matches the physical
    // file set one-to-one, which the Action's later stage/activate digest
    // comparison then (correctly) refuses as `STAGE_INTEGRITY_MISMATCH`.
    // Removing and recreating both directories up front makes every
    // `runBuild` call safe to repeat against the same paths.
    //
    // Both directories are caller-controlled (`--output`/`--work`, the
    // Action's `output-directory`/`work-directory` inputs, or their
    // `<repositoryDirectory>/.gala/{output,work}` defaults), so this
    // removal must never reach a path it does not unambiguously own:
    // `assertDistinctBuildDirectories` refuses one that equals or contains
    // the repository, the process's cwd, the home directory or the
    // filesystem root, or that collides with the other directory;
    // `assertWipeableBuildDirectory` refuses an existing, non-empty
    // directory that does not already carry this package's own
    // `.gala-build-directory` marker from a prior `runBuild` call into the
    // same path. Neither check removes anything; both throw
    // `UnsafeBuildDirectoryError` (a `SOURCE_ERROR`/`UNSAFE_INPUT` finding)
    // instead.
    assertDistinctBuildDirectories({
      outputDirectory,
      workDirectory,
      repositoryDirectory,
    });
    await assertWipeableBuildDirectory(outputDirectory, 'output');
    await assertWipeableBuildDirectory(workDirectory, 'work');

    await rm(outputDirectory, { recursive: true, force: true });
    await rm(workDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });
    await mkdir(workDirectory, { recursive: true });

    const rendered = await renderPublication(buildInput, {
      outputDirectory,
      workDirectory,
      sourceDirectory: repositoryDirectory,
      provenance,
      themeDirectory,
      ...(routeNormalizationProfile ? { routeNormalizationProfile } : {}),
    });

    // Only now (after `renderPublication`'s own internal
    // `outputDirectory` re-scan has already happened) is it safe to write
    // the output marker -- writing it any earlier would have made this
    // very build pick its own marker file up as a bogus extra manifest
    // route, exactly the `STAGE_INTEGRITY_MISMATCH` defect this whole
    // clean-directory precondition exists to prevent.
    await writeBuildDirectoryMarker(outputDirectory);
    await mkdir(workDirectory, { recursive: true });
    await writeBuildDirectoryMarker(workDirectory);
    const manifestPath = path.join(workDirectory, 'artifact-manifest.json');
    await writeFile(manifestPath, JSON.stringify(rendered.manifest, null, 2));
    // The two validated records the managed freeze job quotes the
    // reproducible build record from (DEC-097 section 5: the repository
    // root digest, base URL/path and render policy equal the validated
    // build input; `stylingContractDigest` equals the theme contract's).
    // Both are written next to the manifest so `pack-carrier.mjs` can carry
    // them as reserved metadata members; neither is an artifact file.
    await writeFile(
      path.join(workDirectory, 'build-input.json'),
      JSON.stringify(buildInput, null, 2),
    );
    await writeFile(
      path.join(workDirectory, 'theme-contract.json'),
      await readFile(path.join(themeDirectory, 'theme.json')),
    );

    const files = await readManifestFileBytes(
      rendered.outputDirectory,
      rendered.manifest,
    );
    const artifactDigest = computeArtifactDigest(files);
    const byteCount = files
      .reduce((sum, file) => sum + BigInt(file.bytes.byteLength), 0n)
      .toString(10);
    const routeCount = /** @type {unknown[]} */ (rendered.manifest.routes ?? [])
      .length;

    return {
      ...buildResultEnvelope({
        command: 'build',
        resultCode: 'SUCCESS',
        exitCode: 0,
        findings: [],
        manifestPath,
        manifestDigest: /** @type {string} */ (
          rendered.manifest.manifestDigest
        ),
        artifactDirectory: rendered.outputDirectory,
        artifactDigest,
        routeCount,
        byteCount,
      }),
      outputDirectory: rendered.outputDirectory,
      manifest: rendered.manifest,
    };
  } catch (error) {
    const findings = findingsFromError(error);
    const { resultCode, exitCode } = classifyFindings(findings);
    return buildResultEnvelope({
      command: 'build',
      resultCode,
      exitCode,
      findings,
    });
  }
}
