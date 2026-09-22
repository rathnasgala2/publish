/**
 * A tiny in-memory fake adapter implementing the conformance kit's assumed
 * calling convention, used only to self-test the kit's own assertions in
 * isolation from any real filesystem or provider. It deliberately mirrors
 * `adapter-local-directory`'s semantics (staging privacy, expected-
 * generation fencing including the LOCAL-47 fence sentinel, reupload
 * rollback, digest-checked activation) using
 * plain in-memory `Map`s instead of a filesystem, so the kit can be
 * validated without any I/O.
 *
 * @module
 */

import { createHash } from 'node:crypto';

import {
  fenceDisagrees,
  fenceFor,
  requireGenerationFence,
} from '@rathnasgala2/adapter-protocol';

/**
 * @param {readonly {path: string, bytes: Buffer}[]} files a file set
 * @returns {string} a stable digest of the file set's paths and bytes
 */
function digestFiles(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(file.path);
    hash.update(file.bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Create one fresh, isolated fake destination.
 *
 * @returns {{destination: object}} the fake destination
 */
export function createFakeDestination() {
  return {
    destination: {
      current: /** @type {string | null} */ (null),
      stages:
        /** @type {Map<string, {generationId: string, files: {path: string, bytes: Buffer}[], artifactDigest: string}>} */ (
          new Map()
        ),
      releases:
        /** @type {Map<string, {files: {path: string, bytes: Buffer}[], artifactDigest: string}>} */ (
          new Map()
        ),
      journal:
        /** @type {Map<string, {artifactDigest: string, generationId: string}>} */ (
          new Map()
        ),
    },
  };
}

/**
 * Compute the same digest `describeCapabilities`-independent digest formula
 * this fake adapter's `observe` verifies against, from an in-memory file
 * set. Mirrors `adapter-local-directory`'s exported `computeArtifactDigest`
 * so this self-test can supply `fixture.computeArtifactDigest`.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the complete file
 *   set
 * @returns {string} the digest
 */
export function computeArtifactDigest(files) {
  return digestFiles(files);
}

/**
 * A schema-valid, exact-row-truthful `adapter-capability:2.0.0` document for
 * the `local-directory` row, used only so this self-test can exercise the
 * conformance kit's capability-truthfulness assertion against a document
 * that actually satisfies it (a placeholder digest string is schema-valid;
 * the kit does not recompute `capabilityDigest`/`filesystemEvidenceDigest`
 * formulas itself, only schema shape and exact-row truthfulness).
 */
const FAKE_CAPABILITY_DECLARATION = Object.freeze({
  schemaId: 'urn:gala:schema:adapter-capability:2.0.0',
  schemaVersion: '2.0.0',
  adapter: {
    adapterId: 'local-directory',
    adapterVersion: '2.0.0',
    adapterDigest:
      'sha256:0000000000000000000000000000000000000000000000000000000000000001',
  },
  contractVersion: '2.0.0',
  protocolRange: '^2.0.0',
  destinationKinds: ['local-directory'],
  operations: [
    'activate',
    'cleanup-staged',
    'inspect',
    'observe',
    'rollback',
    'stage',
  ],
  staging: 'unreachable-generation',
  activation: 'pointer-swap',
  concurrency: 'expected-generation',
  idempotencyClass: 'observable-identity',
  rollback: 'reupload',
  verification: ['artifact-digest', 'generation-marker', 'provider-state'],
  providerInventoryAssurance: 'complete-artifact-digest',
  configuration: {
    redirects: false,
    headers: false,
    customDomains: false,
    notFoundBehavior: false,
    immutableCaching: false,
  },
  cacheInvalidation: 'none',
  limits: {
    transport: 'filesystem',
    filesystemProfile: 'gala-local-directory-filesystem-v2',
    filesystemAllowlistDigest:
      'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    maximumFiles: '1',
    maximumFileBytes: '1',
    maximumArtifactBytes: '1',
    maximumProviderCallSeconds: 1,
    maximumPathBytes: 1,
    pathRuleProfile: 'gala-portable-v2',
  },
  capabilityDigest:
    'sha256:0000000000000000000000000000000000000000000000000000000000000001',
  filesystemEvidenceDigest:
    'sha256:0000000000000000000000000000000000000000000000000000000000000001',
});

export const fakeAdapterModule = Object.freeze({
  /**
   * @param {object} destination the fake destination
   * @returns {Promise<Record<string, unknown>>} a schema-valid capability
   *   declaration
   */
  async describeCapabilities(destination) {
    void destination;
    return FAKE_CAPABILITY_DECLARATION;
  },
  /**
   * @param {object} destination the fake destination
   * @returns {Promise<Record<string, unknown>>} the inspection result
   */
  async inspectDestination(destination) {
    const d = /** @type {any} */ (destination);
    return {
      currentGenerationId: d.current,
      retainedHistory: [],
      releaseGenerationsOnDisk: [...d.releases.keys()],
    };
  },
  /**
   * @param {{entries: unknown[]}} input the preflight input
   * @returns {Promise<Record<string, unknown>>} the preflight result
   */
  async preflight(input) {
    void input;
    return { verdict: 'proceed', observedGenerationId: null, findings: [] };
  },
  /**
   * @param {any} input the stage input
   * @returns {Promise<Record<string, unknown>>} the stage result
   */
  async stage(input) {
    const d = /** @type {any} */ (input.destination);
    const key = `${input.generationId}`;
    const priorJournal = d.journal.get(input.idempotencyKey);
    const idempotent =
      priorJournal !== undefined &&
      priorJournal.artifactDigest === input.artifactDigest &&
      priorJournal.generationId === input.generationId;
    if (!idempotent) {
      d.stages.set(key, {
        generationId: input.generationId,
        files: input.files,
        artifactDigest: input.artifactDigest,
      });
      d.journal.set(input.idempotencyKey, {
        artifactDigest: input.artifactDigest,
        generationId: input.generationId,
      });
    }
    return {
      stageToken: key,
      stagedPath: key,
      fileCount: input.files.length,
      idempotent,
    };
  },
  /**
   * @param {any} input the activate input
   * @returns {Promise<Record<string, unknown>>} the activation decision
   */
  async activate(input) {
    const d = /** @type {any} */ (input.destination);
    // LOCAL-47: the fence value is validated first, so `null`/`undefined`
    // are refused outright rather than silently disabling the fence, and
    // the explicit sentinel is compared against what is actually served.
    const fence = requireGenerationFence(
      input.expectedCurrentGenerationId,
      'fake-adapter',
    );
    if (d.current === input.generationId) {
      // Idempotent replay: this generation is already the served one, so
      // the operation's original fence is re-stated rather than stale.
      return {
        decision: 'activate',
        generationId: input.generationId,
        previousGenerationId: d.current,
        idempotent: true,
      };
    }
    if (fenceDisagrees(fence, d.current)) {
      return {
        decision: 'reconcile',
        generationId: input.generationId,
        previousGenerationId: d.current,
        idempotent: false,
      };
    }
    const staged = d.stages.get(input.stageToken);
    if (!d.releases.has(input.generationId) && staged) {
      if (
        input.expectedArtifactDigest !== undefined &&
        digestFiles(staged.files) !== input.expectedArtifactDigest
      ) {
        throw new Error('STAGE_INTEGRITY_MISMATCH: digest disagreement');
      }
      d.releases.set(input.generationId, staged);
    }
    if (input.crashInjectionHook !== undefined) {
      // Mirrors adapter-local-directory: staging is now durably committed
      // (present in `d.releases`) but `d.current` has not moved yet.
      await input.crashInjectionHook();
    }
    const previous = d.current;
    d.current = input.generationId;
    return {
      decision: 'activate',
      generationId: input.generationId,
      previousGenerationId: previous,
      idempotent: previous === input.generationId,
    };
  },
  /**
   * @param {any} input the observe input
   * @returns {Promise<Record<string, unknown>>} the observation result
   */
  async observe(input) {
    const d = /** @type {any} */ (input.destination);
    const release = d.releases.get(input.generationId);
    const observedArtifactDigest = release
      ? digestFiles(release.files)
      : 'sha256:missing';
    /** @type {string[]} */
    const findings = [];
    if (d.current !== input.generationId) {
      findings.push('not current');
    }
    if (observedArtifactDigest !== input.expectedArtifactDigest) {
      findings.push('digest mismatch');
    }
    return {
      verified: findings.length === 0,
      observedArtifactDigest,
      currentGenerationId: d.current,
      findings,
    };
  },
  /**
   * @param {any} input the cleanup input
   * @returns {Promise<Record<string, unknown>>} the cleanup result
   */
  async cleanupStaged(input) {
    const d = /** @type {any} */ (input.destination);
    const stageRemoved = d.stages.delete(input.stageToken);
    let releaseRemoved = false;
    if (input.generationId !== undefined && input.generationId !== d.current) {
      releaseRemoved = d.releases.delete(input.generationId);
    }
    return { removed: stageRemoved || releaseRemoved };
  },
  /**
   * @param {any} input the rollback input
   * @returns {Promise<Record<string, unknown>>} the activation decision
   */
  async rollback(input) {
    const d = /** @type {any} */ (input.destination);
    const target = d.releases.get(input.targetGenerationId);
    if (!target) {
      throw new Error('ROLLBACK_GENERATION_NOT_RETAINED');
    }
    d.stages.set(input.newGenerationId, {
      generationId: input.newGenerationId,
      files: target.files,
      artifactDigest: digestFiles(target.files),
    });
    return this.activate({
      destination: input.destination,
      stageToken: input.newGenerationId,
      generationId: input.newGenerationId,
      expectedCurrentGenerationId: fenceFor(d.current),
    });
  },
});
