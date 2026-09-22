/**
 * The Action-path deploy composition: `publish-kernel`'s provider-neutral
 * duty evaluation composed with `adapter-local-directory`'s real lifecycle
 * calls, wired exactly like
 * `packages/adapter-local-directory/test/e2e-kernel-template.test.js`'s
 * proven sequence (S2-T20 deliverable (3): "a Node 24 runner entry that
 * composes normalization -> `renderPublication` -> kernel -> selected
 * adapter"). This module is only ever reached from the GitHub Action entry
 * point; the `npx` subcommands never call it (S2 brief section 5: "a local
 * author previews locally and deploys through the Action").
 *
 * @module
 */

import { createHash } from 'node:crypto';

import { readManifestFileBytes } from './artifact-files.js';
import { fenceFor } from '@rathnasgala2/adapter-protocol';
import {
  evaluateActivate,
  evaluateCleanupStaged,
  evaluateObserve,
  evaluatePreflight,
  evaluateStage,
  hasBlockingFinding,
} from '@rathnasgala2/publish-kernel';
import {
  ADAPTER_VERSION,
  activate,
  cleanupStaged,
  computeArtifactDigest,
  generateUuidV7,
  inspectDestination,
  observe,
  preflight as adapterPreflight,
  stage as adapterStage,
} from '@rathnasgala2/adapter-local-directory';

/**
 * Deploy a rendered candidate directory to a `local-directory` destination
 * through the kernel/adapter composition, and return every fact the
 * Action's result envelope and outputs need.
 *
 * @param {{
 *   outputDirectory: string,
 *   manifest: Record<string, unknown>,
 *   destinationRoot: string
 * }} input the rendered candidate and its deploy destination
 * @returns {Promise<{
 *   decision: 'activate' | 'reconcile',
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   byteCount: string,
 *   routeCount: number,
 *   findings: readonly import('./index.d.ts').PublishActionFinding[]
 * }>} the deploy outcome
 */
export async function deployToLocalDirectory({
  outputDirectory,
  manifest,
  destinationRoot,
}) {
  const files = await readManifestFileBytes(outputDirectory, manifest);
  const destination = { root: destinationRoot };

  const before = await inspectDestination(destination);

  const entries = files.map((file) => ({
    path: file.path,
    kind: /** @type {const} */ ('file'),
  }));
  const totalBytes = files.reduce(
    (sum, file) => sum + BigInt(file.bytes.byteLength),
    0n,
  );
  const destinationIdentity = {
    environment: 'local',
    adapterId: 'local-directory',
    adapterVersion: ADAPTER_VERSION,
    targetDigest: `sha256:${createHash('sha256').update(destinationRoot, 'utf8').digest('hex')}`,
    baseUrl: `file://${destinationRoot}`,
  };

  const kernelPreflight = evaluatePreflight({
    entries,
    totals: {
      artifactFileCount: files.length,
      artifactByteCount: totalBytes.toString(10),
      longestPathBytes: Math.max(
        ...files.map((file) => Buffer.byteLength(file.path, 'utf8')),
      ),
    },
    limits: {
      maximumFiles: 1_000_000,
      maximumArtifactBytes: '10737418240',
      maximumPathBytes: 4096,
    },
    authorizedDestination: destinationIdentity,
    candidateDestination: destinationIdentity,
    intent: { manifestDigest: manifest.manifestDigest },
  });
  if (hasBlockingFinding(kernelPreflight.findings)) {
    return failed(kernelPreflight.findings);
  }

  const adapterPreflightResult = await adapterPreflight({
    destination,
    entries: files.map((file) => ({ path: file.path })),
  });
  if (adapterPreflightResult.verdict !== 'proceed') {
    return failed(
      adapterPreflightResult.findings.map((detail) =>
        sourceConstraintFinding('LOCAL_DIRECTORY_PREFLIGHT_REFUSED', detail),
      ),
    );
  }

  const artifactId = generateUuidV7();
  const artifactDigest = computeArtifactDigest(files);
  const generationId = generateUuidV7();
  const operationId = generateUuidV7();
  const attemptId = generateUuidV7();
  const idempotencyKey = generateUuidV7();

  const kernelStage = evaluateStage({
    frozenArtifact: null,
    candidateArtifact: {
      artifactId,
      artifactDigest,
      manifestDigest: /** @type {string} */ (manifest.manifestDigest),
      artifactFileCount: files.length,
      artifactByteCount: Number(totalBytes),
    },
    preflightDestination: destinationIdentity,
    currentDestination: destinationIdentity,
    journal: [],
    candidateOperation: {
      operationId,
      attemptId,
      idempotencyKey,
      artifactDigest,
    },
  });
  if (hasBlockingFinding(kernelStage.findings)) {
    return failed(kernelStage.findings);
  }

  const staged = await adapterStage({
    destination,
    operationId,
    attemptId,
    idempotencyKey,
    generationId,
    artifactId,
    artifactDigest,
    files,
  });

  const marker = {
    schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
    schemaVersion: '2.0.0',
    artifactId,
    artifactDigest,
    generationId,
  };
  const kernelActivate = evaluateActivate({
    preflightDestination: destinationIdentity,
    currentDestination: destinationIdentity,
    fence: {
      // LOCAL-47: a first publish states "nothing is served here" with the
      // protocol's explicit sentinel (via `fenceFor`), never with `null` or
      // an invented placeholder, and the observation is always passed so
      // the fence is never silently disabled.
      concurrency: 'expected-generation',
      expectedGenerationId: fenceFor(before.currentGenerationId),
      observedGenerationId: before.currentGenerationId,
    },
    marker,
  });
  if (hasBlockingFinding(kernelActivate.findings)) {
    return failed(kernelActivate.findings);
  }

  const activation = await activate({
    destination,
    stageToken: staged.stageToken,
    generationId,
    expectedCurrentGenerationId: fenceFor(before.currentGenerationId),
    expectedArtifactDigest: artifactDigest,
  });

  const kernelObserve = evaluateObserve({
    outcome: { attempted: true, providerResponded: true, timedOut: false },
    observation: { generationId, artifactDigest },
  });

  const observed = await observe({
    destination,
    generationId: activation.generationId,
    expectedArtifactDigest: artifactDigest,
  });

  const kernelCleanup = evaluateCleanupStaged({
    authorizedDestination: destinationIdentity,
    candidateDestination: destinationIdentity,
    priorDisposition: kernelObserve.disposition,
  });
  if (!hasBlockingFinding(kernelCleanup.findings)) {
    await cleanupStaged({ destination, stageToken: staged.stageToken });
  }

  /** @type {import('./index.d.ts').PublishActionFinding[]} */
  const findings = [];
  if (!observed.verified) {
    findings.push(
      ...observed.findings.map((detail) =>
        sourceConstraintFinding('LOCAL_DIRECTORY_OBSERVE_UNVERIFIED', detail),
      ),
    );
  }

  return {
    decision: activation.decision,
    generationId: activation.generationId,
    artifactId,
    artifactDigest,
    byteCount: totalBytes.toString(10),
    routeCount: /** @type {unknown[]} */ (manifest.routes ?? []).length,
    findings,
  };
}

/**
 * @param {readonly import('./index.d.ts').PublishActionFinding[]} findings the blocking findings
 * @returns {{decision: 'reconcile', generationId: string, artifactId: string, artifactDigest: string, byteCount: string, routeCount: number, findings: readonly import('./index.d.ts').PublishActionFinding[]}}
 *   a failed/reconciled deploy result
 */
function failed(findings) {
  return {
    decision: 'reconcile',
    generationId: '',
    artifactId: '',
    artifactDigest: '',
    byteCount: '0',
    routeCount: 0,
    findings,
  };
}

/**
 * @param {string} code stable finding code
 * @param {string} detail human-readable detail
 * @returns {import('./index.d.ts').PublishActionFinding} one typed `TARGET_CONSTRAINT_ERROR` finding
 */
function sourceConstraintFinding(code, detail) {
  return {
    code,
    severity: 'TARGET_CONSTRAINT_ERROR',
    detail,
    recovery: 'Inspect the local-directory destination and retry.',
    overridable: false,
  };
}
