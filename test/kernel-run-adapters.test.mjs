/**
 * `kernel-run.mjs` against both managed adapters, driven by the fakes those
 * adapters already ship.
 *
 * `test/workload-sequence.test.mjs` proves the Gala half of the round trip
 * with `local-directory` as the oracle. This file proves the other half: that
 * the one provider-neutral run really does drive the two *managed* adapters —
 * `github-pages` against its fake provider and fake OIDC issuer, `do-spaces`
 * against its fake S3 server — and that the journal it produces from each is
 * the same shape the receipt submission requires.
 *
 * What is still not proved here, and cannot be without W4-16 credentials: the
 * Spaces limited-key denial proof (`deploy.mjs` issues it against a live
 * control plane before the first mutation) and the Pages OIDC acquisition
 * from the real runner token endpoint. Both are deliberately outside
 * `kernel-run.mjs`, in `deploy.mjs`, for exactly that reason.
 *
 * `assertJournalSatisfiesContract` closes the gap `assertJournalIsSubmittable`
 * cannot: `validateReceiptSubmission` (`workload-contract.mjs`) only checks
 * flat field/enum membership against the pinned OpenAPI request shape, never
 * the cross-field `observationClass`/`outcome`/`destinationChanged` matrix
 * (or the attempt `outcome`/`resultDigest` matrix) the real contract closes
 * with `oneOf`/`if`-`then` — which is exactly the shape of rule the kernel
 * once got wrong (a `request-accepted` staging observation the contract only
 * admits with `outcome-unknown-reconciling`, refused `409
 * INVALID_SOURCE_STATE` by the API's own `deployment_observation_matrix_ck`).
 * This assertion maps every real observation the run produced into the full
 * `deployment-observation:2.0.0` document shape and validates it with
 * `@rathnasgala2/schemas`' own `validateGalaDocument` — the package this
 * repository is pinned to (`schemaId` embeds an exact version, so a stale pin
 * would show up here as a validator that no longer recognizes the run's own
 * classes) — and embeds the run's real attempts and terminal observation in a
 * synthetic `deployment-receipt:2.0.0` envelope to prove the same real data
 * validates once assembled into the document Gala's reconciliation worker
 * would issue.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import * as pages from '@rathnasgala2/adapter-github-pages';
import * as spaces from '@rathnasgala2/adapter-do-spaces';
import * as localDirectory from '@rathnasgala2/adapter-local-directory';
import { validateGalaDocument } from '@rathnasgala2/schemas';

import { startFakePagesProvider } from '../packages/adapter-github-pages/test/fake-pages-provider.js';
import { oidcFor } from '../packages/adapter-github-pages/test/oidc-fixture.js';
import { startFakeSpaces } from '../packages/adapter-do-spaces/test/fake-s3-server.js';

import { decodeFrozenEnvelope } from '../scripts/workflow/frozen-envelope.mjs';
import { runKernelDeployment } from '../scripts/workflow/kernel-run.mjs';
import { validateReceiptSubmission } from '../scripts/workflow/workload-contract.mjs';
import { buildReceiptSubmission } from '../scripts/workflow/workload-requests.mjs';
import {
  fixtureLock,
  frozenEnvelopeFor,
} from './fixtures/artifact-manifest.mjs';

/** A filler digest for contract members this run does not itself track. */
const FILLER_DIGEST = `sha256:${'2'.repeat(64)}`;

const SOURCE_FILES = Object.freeze([
  { path: 'index.html', bytes: Buffer.from('<!doctype html><p>home', 'utf8') },
  {
    path: 'about/index.html',
    bytes: Buffer.from('<!doctype html><p>about', 'utf8'),
  },
]);

/**
 * The real frozen envelope every run here consumes, exactly as `deploy.mjs`
 * would: decoded (which recomputes every inventory and digest equality) and
 * its payload handed to the kernel run. The intent binds the envelope's own
 * manifest, provenance and SBOM digests.
 *
 * @param {string} adapterPackage the adapter the lock selects
 * @returns {ReturnType<typeof decodeFrozenEnvelope>} the decoded envelope
 */
function envelopeFor(adapterPackage) {
  return decodeFrozenEnvelope(
    frozenEnvelopeFor(SOURCE_FILES, { lock: fixtureLock(adapterPackage) })
      .bytes,
  );
}

/** The envelope every run that does not bind its own consumes. */
const DEFAULT_ENVELOPE = envelopeFor('@rathnasgala2/adapter-local-directory');
const FILES = DEFAULT_ENVELOPE.files;

/**
 * @param {string} seed a distinct seed
 * @returns {string} one UUIDv7-shaped `stableId`
 */
function idFor(seed) {
  const hex = Buffer.from(seed.padEnd(16, '0').slice(0, 16), 'utf8').toString(
    'hex',
  );
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `7${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * The retained intent the run consumes, bound to one destination identity and
 * one artifact digest the adapter itself computes.
 *
 * @param {{adapterId: string, artifactDigest: string, baseUrl: string, seed: string, envelope?: ReturnType<typeof decodeFrozenEnvelope>, providerBinding?: Record<string, string> | undefined, expectedGenerationId?: string | undefined}} binding
 *   the run binding; `providerBinding` is the 2.8.0 destination coordinate
 *   block the two managed adapters carry (LOCAL-55 (2)), and
 *   `expectedGenerationId` the generation Gala expects to be served (absent
 *   for a first publish)
 * @returns {Record<string, any>} the intent
 */
function intentFor(binding) {
  const envelope = binding.envelope ?? DEFAULT_ENVELOPE;
  const filler = `sha256:${'1'.repeat(64)}`;
  const destination = {
    // Schema 2.9.0 (LOCAL-60a): the retained environment is the adapter's
    // constant.
    environment: binding.adapterId,
    adapterId: binding.adapterId,
    adapterVersion: '0.1.1',
    targetDigest: filler,
    baseUrl: binding.baseUrl,
    ...(binding.providerBinding === undefined
      ? {}
      : { providerBinding: binding.providerBinding }),
  };
  return {
    operationId: idFor(`${binding.seed}op`),
    attemptId: idFor(`${binding.seed}at`),
    idempotencyKey: idFor(`${binding.seed}ik`),
    proposedGenerationId: idFor(`${binding.seed}gn`),
    artifactId: idFor(`${binding.seed}ar`),
    artifactDigest: binding.artifactDigest,
    manifestDigest: envelope.manifestDigest,
    artifactFileCount: envelope.files.length,
    artifactByteCount: envelope.files.reduce(
      (total, file) => total + file.bytes.byteLength,
      0,
    ),
    sourceCommit: `sha1:${'a'.repeat(40)}`,
    provenanceDigest: envelope.provenanceDigest,
    sbomDigest: envelope.sbomDigest,
    adapter: {
      adapterId: binding.adapterId,
      adapterVersion: '0.1.1',
      adapterDigest: filler,
    },
    destination,
    ...(binding.expectedGenerationId === undefined
      ? {}
      : { expectedGenerationId: binding.expectedGenerationId }),
    publisher: {
      package: '@rathnasgala2/publish-action',
      version: '0.1.0',
      integrity: filler,
      registry: 'https://registry.npmjs.org/',
    },
    marker: {
      schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
      schemaVersion: '2.0.0',
      artifactId: idFor(`${binding.seed}ar`),
      artifactDigest: binding.artifactDigest,
      generationId: idFor(`${binding.seed}gn`),
    },
    maximumReportRequestByteCount: '1048576',
  };
}

/**
 * Assert one run's journal is a journal the receipt submission can carry.
 *
 * @param {{journal: {attempts: any[], observations: any[], observedRoutes: any[]}, generationId: string | null}} outcome
 *   the run outcome
 * @param {Record<string, any>} intent the intent the run consumed
 * @returns {void}
 */
function assertJournalIsSubmittable(outcome, intent) {
  assert.deepEqual(
    outcome.journal.attempts.map((attempt) => attempt.kernelSequence),
    outcome.journal.attempts.map((_unused, index) => index + 1),
    'the attempt stream is gap-free',
  );
  const attemptIds = new Set(
    outcome.journal.attempts.map((attempt) => attempt.stageAttemptId),
  );
  for (const observation of outcome.journal.observations) {
    assert.ok(attemptIds.has(observation.stageAttemptId));
  }
  const submission = buildReceiptSubmission(
    /** @type {any} */ ({
      intent: {
        ...intent,
        artifactByteCount: String(intent.artifactByteCount),
        artifactFileCount: String(intent.artifactFileCount),
      },
      journal: {
        attempts: outcome.journal.attempts,
        observations: outcome.journal.observations,
      },
      repositoryId: '4242',
      runId: '987654321',
      runAttempt: 1,
      publisherVersion: '0.1.0',
      observedRoutes: outcome.journal.observedRoutes,
      workflowStartedAt: '2020-01-01T00:00:00.000Z',
      workflowCompletedAt: '2099-01-01T00:00:00.000Z',
      ...(outcome.generationId === null
        ? {}
        : { destinationGenerationId: outcome.generationId }),
    }),
  );
  validateReceiptSubmission(submission);
  // The report carries the envelope's own metadata digests through the
  // intent, so Gala's receipt-vs-intent equality is over real records.
  assert.equal(submission.artifactManifestDigest, intent.manifestDigest);
  assert.equal(submission.provenanceDigest, intent.provenanceDigest);
  assert.equal(submission.sbomDigest, intent.sbomDigest);
  assert.match(String(intent.provenanceDigest), /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(intent.provenanceDigest, intent.sbomDigest);
  assertJournalSatisfiesContract(outcome, intent);
}

/**
 * Map one compact `kernelJournal.observations[]` entry into the full
 * `deployment-observation:2.0.0` document shape, quoting every real fact the
 * kernel run produced (`observationClass`, `outcome`, `destinationChanged`,
 * `generationId`, `observedArtifactDigest`, `providerVersion`,
 * `evidenceDigest`) and filling the members this run never tracks
 * per-observation (they are receipt/operation-wide facts owned by the intent
 * or by Gala's own issuance) with schema-valid filler.
 *
 * @param {Record<string, any>} observation the real journal observation
 * @param {Record<string, any>} intent the intent the run consumed
 * @param {boolean} standalone whether this is validated as its own document
 *   (carries `schemaId`/`schemaVersion`) or embedded in a receipt (which
 *   declares neither on its embedded items)
 * @returns {Record<string, any>} the full document
 */
function toFullObservation(observation, intent, standalone) {
  /** @type {Record<string, any>} */
  const doc = {
    ...(standalone
      ? {
          schemaId: 'urn:gala:schema:deployment-observation:2.0.0',
          schemaVersion: '2.0.0',
        }
      : {}),
    observationId: observation.observationId,
    operationId: intent.operationId,
    attemptId: intent.attemptId,
    stageAttemptId: observation.stageAttemptId,
    sequence: observation.kernelSequence,
    intentDigest: FILLER_DIGEST,
    artifactId: intent.artifactId,
    artifactDigest: intent.artifactDigest,
    adapter: intent.adapter,
    destination: intent.destination,
    observationClass: observation.observationClass,
    outcome: observation.outcome,
    destinationChanged: observation.destinationChanged,
    observedAt: observation.observedAt,
    receivedAt: observation.observedAt,
    evidenceDigest: observation.evidenceDigest,
    probes: [],
  };
  if (observation.generationId !== undefined) {
    doc.generationId = observation.generationId;
  }
  if (observation.observedArtifactDigest !== undefined) {
    doc.observedArtifactDigest = observation.observedArtifactDigest;
  }
  if (observation.providerVersion !== undefined) {
    doc.providerVersion = observation.providerVersion;
  }
  return doc;
}

/**
 * Map one compact `kernelJournal.attempts[]` entry into the full
 * `deploymentAttempt` shape `deployment-receipt:2.0.0` embeds, quoting every
 * real fact and filling only the run-wide `attemptId` from the intent.
 *
 * @param {Record<string, any>} attempt the real journal attempt
 * @param {Record<string, any>} intent the intent the run consumed
 * @returns {Record<string, any>} the full attempt document
 */
function toFullAttempt(attempt, intent) {
  /** @type {Record<string, any>} */
  const doc = {
    attemptId: intent.attemptId,
    stageAttemptId: attempt.stageAttemptId,
    causationId: attempt.causationId,
    stage: attempt.stage,
    sequence: attempt.kernelSequence,
    outcome: attempt.outcome,
    destinationChanged: attempt.destinationChanged,
    inputDigest: attempt.inputDigest,
    retryable: attempt.retryable,
    evidenceDigest: attempt.evidenceDigest,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
  };
  if (attempt.resultDigest !== undefined) {
    doc.resultDigest = attempt.resultDigest;
  }
  if (attempt.failureCode !== undefined) {
    doc.failureCode = attempt.failureCode;
  }
  return doc;
}

/**
 * Validate the real journal a kernel run produced against the contract's own
 * validators, not this repository's flatter mirror of it: every observation,
 * standalone, against `deployment-observation:2.0.0`; and the run's real
 * attempts plus its terminal observation, embedded, against
 * `deployment-receipt:2.0.0` — the document shape Gala's reconciliation
 * worker actually issues from this same evidence. This is deliberately not
 * this repository's job to build in production (`CLAUDE.md`: "this repository
 * never constructs a `deployment-receipt`"); here it exists only to prove the
 * real journal is one the contract would accept once Gala assembles it.
 *
 * @param {{journal: {attempts: any[], observations: any[]}, generationId: string | null}} outcome
 *   the run outcome
 * @param {Record<string, any>} intent the intent the run consumed
 * @returns {void}
 */
function assertJournalSatisfiesContract(outcome, intent) {
  for (const observation of outcome.journal.observations) {
    const doc = toFullObservation(observation, intent, true);
    const verdict = validateGalaDocument(
      'urn:gala:schema:deployment-observation:2.0.0',
      doc,
    );
    assert.ok(
      verdict.valid,
      `observation ${observation.kernelSequence} (${observation.observationClass}/${observation.outcome}) ` +
        `is not a valid deployment-observation:2.0.0 document — ${JSON.stringify(verdict.diagnostics)}`,
    );
  }

  const finalObservation =
    outcome.journal.observations[outcome.journal.observations.length - 1];
  const attempts = outcome.journal.attempts.map((attempt) =>
    toFullAttempt(attempt, intent),
  );
  const receiptDoc = {
    schemaId: 'urn:gala:schema:deployment-receipt:2.0.0',
    schemaVersion: '2.0.0',
    receiptId: idFor(`${finalObservation.observationId}receipt`),
    snapshotSequence: 1,
    // Schema 2.0.0 only requires `supersedesReceiptId` when
    // `attemptSnapshotSequence` is not the first (`1`); this run's own single
    // synthesized receipt is always the first snapshot of its own evidence.
    attemptSnapshotSequence: 1,
    operationId: intent.operationId,
    organizationId: idFor('journal-contract-org'),
    issuer: 'https://gala.example.test/',
    repositoryId: '4242',
    repositoryOwnerId: '99',
    sourceCommit: intent.sourceCommit,
    workflowRef: `rathnasgala2/kernel-run/.github/workflows/gala-publish-v2.yml@refs/heads/gala/publish/${idFor('journal-contract-wf')}`,
    workflowSha: `sha1:${'b'.repeat(40)}`,
    runId: '987654321',
    runAttempt: 1,
    artifactId: intent.artifactId,
    artifactDigest: intent.artifactDigest,
    artifactManifestDigest: intent.manifestDigest,
    artifactByteCount: String(intent.artifactByteCount),
    artifactFileCount: String(intent.artifactFileCount),
    requestedArtifactRetentionDays: 1,
    effectiveArtifactExpiresAt: '2099-01-01T00:00:00.000Z',
    publisher: intent.publisher,
    intentDigest: FILLER_DIGEST,
    submissionEvidenceDigest: FILLER_DIGEST,
    evidenceJournalEntryCount:
      outcome.journal.attempts.length + outcome.journal.observations.length,
    evidenceJournalHeadDigest: FILLER_DIGEST,
    adapter: intent.adapter,
    destination: intent.destination,
    // Gala's own `destinationGenerationId` equality (2.9.0) requires
    // `succeeded` outcome pair with the destination it activated.
    destinationGenerationId: outcome.generationId,
    attempts,
    observations: [toFullObservation(finalObservation, intent, false)],
    verificationTier: 'critical-only',
    outcome: 'succeeded',
    warnings: [],
    provenanceDigest: intent.provenanceDigest,
    sbomDigest: intent.sbomDigest,
    startedAt: outcome.journal.attempts[0]?.startedAt,
    completedAt:
      outcome.journal.attempts[outcome.journal.attempts.length - 1]
        ?.completedAt,
    receiptDigest: FILLER_DIGEST,
  };
  const verdict = validateGalaDocument(
    'urn:gala:schema:deployment-receipt:2.0.0',
    receiptDoc,
  );
  assert.ok(
    verdict.valid,
    `the run's real attempts and terminal observation do not validate ` +
      `embedded in a deployment-receipt:2.0.0 document — ${JSON.stringify(verdict.diagnostics)}`,
  );
}

test('the kernel run drives github-pages end to end against its fake provider', async () => {
  const provider = await startFakePagesProvider({ repository: 'kernel-run' });
  try {
    const destination = {
      owner: provider.owner,
      repository: provider.repository,
      repositoryId: '9100',
      repositoryOwnerId: '99001',
      apiOrigin: provider.apiOrigin,
      publicBaseUrl: provider.publicBaseUrl,
      token: provider.token,
      publishCarrier: provider.publishCarrier,
      headSha: '1c14dcdff9501ef74b8b7a5897fba69c586fa76a',
      fetch: provider.fetch,
      /**
       * @returns {Promise<void>} resolves immediately
       */
      sleep: () => Promise.resolve(),
    };
    const envelope = envelopeFor('@rathnasgala2/adapter-github-pages');
    const intent = intentFor({
      adapterId: 'github-pages',
      artifactDigest: pages.computeArtifactDigest(envelope.files),
      baseUrl: `${provider.publicBaseUrl}/`,
      seed: 'pages',
      envelope,
      providerBinding: {
        owner: provider.owner,
        repository: provider.repository,
      },
    });
    const outcome = await runKernelDeployment({
      adapterModule: { ...pages },
      destination,
      destinationIdentity: intent.destination,
      intent,
      files: envelope.files,
      activateExtras: oidcFor(destination),
    });

    assert.equal(outcome.decision, 'activate');
    assert.deepEqual(
      outcome.journal.attempts.map((attempt) => attempt.stage),
      ['staging', 'activation', 'cleanup'],
    );
    assert.equal(
      provider.createCalls.length,
      1,
      'exactly one create-deployment call left this run',
    );
    assertJournalIsSubmittable(outcome, intent);
  } finally {
    await provider.stop();
  }
});

test('the kernel run drives do-spaces end to end against its fake S3 server', async () => {
  const provider = await startFakeSpaces();
  try {
    const destination = {
      region: provider.region,
      servedBucket: provider.servedBucket,
      stagingBucket: provider.stagingBucket,
      accessKeyId: provider.accessKeyId,
      secretAccessKey: provider.secretAccessKey,
      fetch: provider.fetch,
      publicFetch: provider.fetch,
    };
    // The public base URL is not free: the adapter refuses anything but the
    // served bucket's own website origin, so the intent's `destination.baseUrl`
    // is the one the adapter itself derives.
    const origins = spaces.deriveOrigins(destination);
    const envelope = envelopeFor('@rathnasgala2/adapter-do-spaces');
    const intent = intentFor({
      adapterId: 'do-spaces',
      artifactDigest: spaces.computeArtifactDigest(envelope.files),
      baseUrl: `${origins.publicOrigin}/`,
      seed: 'spaces',
      envelope,
      providerBinding: {
        region: provider.region,
        servedBucket: provider.servedBucket,
        stagingBucket: provider.stagingBucket,
      },
    });
    const outcome = await runKernelDeployment({
      adapterModule: { ...spaces },
      destination,
      destinationIdentity: intent.destination,
      intent,
      files: envelope.files,
    });

    assert.equal(outcome.decision, 'activate');
    assert.deepEqual(
      outcome.journal.attempts.map((attempt) => attempt.stage),
      ['staging', 'activation', 'cleanup'],
    );
    assert.equal(
      outcome.journal.attempts[1]?.destinationChanged,
      'yes',
      'only the activation attempt reports a changed destination',
    );
    assertJournalIsSubmittable(outcome, intent);
  } finally {
    await provider.stop?.();
  }
});

test('the kernel run drives local-directory, the oracle with no provider binding, through the same sequence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gala-kernel-local-'));
  try {
    const envelope = envelopeFor('@rathnasgala2/adapter-local-directory');
    const intent = intentFor({
      adapterId: 'local-directory',
      artifactDigest: localDirectory.computeArtifactDigest(envelope.files),
      baseUrl: 'https://example.test/',
      seed: 'local',
      envelope,
    });
    assert.equal(intent.destination.providerBinding, undefined);
    const outcome = await runKernelDeployment({
      adapterModule: { ...localDirectory },
      destination: { root },
      destinationIdentity: intent.destination,
      intent,
      files: envelope.files,
    });
    assert.equal(outcome.decision, 'activate');
    assert.equal(outcome.verified, true);
    assert.deepEqual(
      outcome.journal.attempts.map((attempt) => attempt.stage),
      ['staging', 'activation', 'cleanup'],
    );
    assertJournalIsSubmittable(outcome, intent);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a refused activation (the adapter itself losing the fence race) is journaled as unknown, never a clean failure', async () => {
  // A thin wrapper over the real local-directory lifecycle: staging,
  // activation and observation all run for real — the staged bytes really
  // are promoted and the served pointer really is (or is not) moved — but
  // the *reported* decision is forced to `reconcile`, the shape every
  // adapter returns when it discovers, at activation time, that the
  // destination no longer matches the fence it staged against (DEC-097;
  // `packages/adapter-local-directory`'s own LOCAL-47 test proves the real
  // adapter returns exactly this shape). This is deliberately not the
  // pre-staging fence refusal this file already covers elsewhere (that one
  // never reaches `activate` at all, let alone a real mutation): this
  // exercises what the kernel journals once the adapter's own activation
  // call comes back refused — including the case this test forces, where
  // the underlying mutation genuinely happened (`observed.verified` is
  // `true`) but the decision the kernel was handed says it did not, which is
  // exactly the ambiguity `do-spaces`'s own `reconcile` can carry after
  // losing a pointer race with served-root writes already made.
  const root = await mkdtemp(path.join(tmpdir(), 'gala-kernel-reconcile-'));
  try {
    const envelope = envelopeFor('@rathnasgala2/adapter-local-directory');
    const intent = intentFor({
      adapterId: 'local-directory',
      artifactDigest: localDirectory.computeArtifactDigest(envelope.files),
      baseUrl: 'https://example.test/',
      seed: 'reconcile',
      envelope,
    });
    const refusingActivate = {
      ...localDirectory,
      /**
       * @param {Record<string, unknown>} input the real activate input
       * @returns {Promise<Record<string, unknown>>} the real activation,
       *   with its decision forced to the refused shape
       */
      activate: async (input) => {
        const real = await localDirectory.activate(/** @type {any} */ (input));
        return { ...real, decision: 'reconcile' };
      },
    };
    const outcome = await runKernelDeployment({
      adapterModule: refusingActivate,
      destination: { root },
      destinationIdentity: intent.destination,
      intent,
      files: envelope.files,
    });

    assert.equal(outcome.decision, 'reconcile');
    // The underlying mutation really happened (the real `activate` ran and
    // the served bytes really do match), so `observed.verified` is `true` —
    // exactly the ambiguity this test exists to prove the journal never
    // rounds off: what actually got served and what the kernel was told
    // about the activation decision can disagree.
    assert.equal(outcome.verified, true);
    const [stagingAttempt, activationAttempt] = outcome.journal.attempts;
    assert.equal(stagingAttempt?.outcome, 'succeeded');
    const activationObservation = outcome.journal.observations.find(
      (observation) =>
        observation.stageAttemptId === activationAttempt?.stageAttemptId,
    );
    // The two facts this test exists to pin: a refused activation is
    // `unknown`, never `failed` (the contract only pairs `stage: activation`
    // + `outcome: failed` with `destinationChanged: 'no'`, which the kernel
    // cannot vouch for here), and its observation is
    // `outcome-unknown-reconciling`, never a clean `rejected` (the contract
    // only pairs `provider-state`/`rejected` with `destinationChanged: 'no'`
    // too).
    assert.equal(activationAttempt?.outcome, 'unknown');
    assert.equal(activationAttempt?.destinationChanged, 'unknown');
    assert.equal(activationAttempt?.failureCode, 'OUTCOME_UNKNOWN_RECONCILING');
    assert.ok(
      activationAttempt?.resultDigest,
      'a terminal attempt (unknown included) always carries a result digest',
    );
    assert.equal(activationObservation?.outcome, 'outcome-unknown-reconciling');
    assert.equal(activationObservation?.destinationChanged, 'unknown');
    // The real validator, not a hand check: every observation this refused
    // run produced must be one the contract accepts on its own — the
    // per-observation half of `assertJournalSatisfiesContract` (the
    // receipt-embedding half assumes a terminal `succeeded` run, which this
    // one, by construction, is not).
    for (const observation of outcome.journal.observations) {
      const verdict = validateGalaDocument(
        'urn:gala:schema:deployment-observation:2.0.0',
        toFullObservation(observation, intent, true),
      );
      assert.ok(
        verdict.valid,
        `observation ${observation.kernelSequence} (${observation.observationClass}/${observation.outcome}) ` +
          `is not a valid deployment-observation:2.0.0 document — ${JSON.stringify(verdict.diagnostics)}`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * One adapter bound to a fresh fake destination, provider-neutrally.
 *
 * @typedef {{
 *   adapterId: 'github-pages' | 'do-spaces' | 'local-directory',
 *   module: Record<string, any>,
 *   destination: Record<string, unknown>,
 *   providerBinding?: Record<string, string>,
 *   baseUrl: string,
 *   artifactDigest: string,
 *   activateExtras?: Record<string, unknown>,
 *   stop: () => Promise<void>
 * }} BoundDestination
 */

/** @type {ReadonlyArray<() => Promise<BoundDestination>>} */
const BIND_EACH = [
  async () => {
    const provider = await startFakePagesProvider({ repository: 'fence-run' });
    const destination = {
      owner: provider.owner,
      repository: provider.repository,
      repositoryId: '9100',
      repositoryOwnerId: '99001',
      apiOrigin: provider.apiOrigin,
      publicBaseUrl: provider.publicBaseUrl,
      token: provider.token,
      publishCarrier: provider.publishCarrier,
      headSha: '1c14dcdff9501ef74b8b7a5897fba69c586fa76a',
      fetch: provider.fetch,
      sleep: () => Promise.resolve(),
    };
    return {
      adapterId: 'github-pages',
      module: { ...pages },
      destination,
      providerBinding: {
        owner: provider.owner,
        repository: provider.repository,
      },
      baseUrl: `${provider.publicBaseUrl}/`,
      artifactDigest: pages.computeArtifactDigest(FILES),
      activateExtras: oidcFor(destination),
      stop: () => provider.stop(),
    };
  },
  async () => {
    const provider = await startFakeSpaces();
    const destination = {
      region: provider.region,
      servedBucket: provider.servedBucket,
      stagingBucket: provider.stagingBucket,
      accessKeyId: provider.accessKeyId,
      secretAccessKey: provider.secretAccessKey,
      fetch: provider.fetch,
      publicFetch: provider.fetch,
    };
    return {
      adapterId: 'do-spaces',
      module: { ...spaces },
      destination,
      providerBinding: {
        region: provider.region,
        servedBucket: provider.servedBucket,
        stagingBucket: provider.stagingBucket,
      },
      baseUrl: `${spaces.deriveOrigins(destination).publicOrigin}/`,
      artifactDigest: spaces.computeArtifactDigest(FILES),
      stop: async () => {
        await provider.stop?.();
      },
    };
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gala-kernel-fence-'));
    return {
      adapterId: 'local-directory',
      module: { ...localDirectory },
      destination: { root },
      baseUrl: 'https://example.test/',
      artifactDigest: localDirectory.computeArtifactDigest(FILES),
      stop: () => rm(root, { recursive: true, force: true }),
    };
  },
];

for (const [index, bind] of BIND_EACH.entries()) {
  test(`${['github-pages', 'do-spaces', 'local-directory'][index]}: the activation fence is the intent’s — first publish, then the served generation, then a stale expectation refused before staging`, async () => {
    const bound = await bind();
    let stageCalls = 0;
    const adapterModule = {
      ...bound.module,
      /**
       * @param {unknown} input the stage input
       * @returns {Promise<unknown>} the adapter's own result
       */
      stage: (input) => {
        stageCalls += 1;
        return bound.module.stage(input);
      },
    };
    /**
     * @param {string} seed a distinct seed
     * @param {string} [expectedGenerationId] the intent's fence
     * @returns {Promise<Awaited<ReturnType<typeof runKernelDeployment>>>} the run
     */
    const runWith = (seed, expectedGenerationId) =>
      runKernelDeployment({
        adapterModule,
        destination: bound.destination,
        destinationIdentity: intentFor({
          adapterId: bound.adapterId,
          artifactDigest: bound.artifactDigest,
          baseUrl: bound.baseUrl,
          seed,
          providerBinding: bound.providerBinding,
        }).destination,
        intent: intentFor({
          adapterId: bound.adapterId,
          artifactDigest: bound.artifactDigest,
          baseUrl: bound.baseUrl,
          seed,
          providerBinding: bound.providerBinding,
          expectedGenerationId,
        }),
        files: FILES,
        ...(bound.activateExtras === undefined
          ? {}
          : { activateExtras: bound.activateExtras }),
      });
    try {
      // 1. A first publish: the intent carries no expectedGenerationId, the
      //    run states the explicit sentinel, and nothing is served yet.
      const first = await runWith(`${bound.adapterId}-1`);
      assert.equal(first.decision, 'activate', bound.adapterId);
      assert.equal(
        first.journal.attempts[1]?.stage,
        'activation',
        bound.adapterId,
      );
      assert.equal(stageCalls, 1);

      // 2. The next intent names the generation Gala now expects served —
      //    the first run's — and activates over it.
      const second = await runWith(
        `${bound.adapterId}-2`,
        String(first.generationId),
      );
      assert.equal(second.decision, 'activate', bound.adapterId);
      assert.equal(stageCalls, 2);

      // 3. An intent expecting a generation that is not what is served is
      //    refused by the kernel before the adapter stages a byte.
      const stale = await runWith(`${bound.adapterId}-3`, idFor('stalegen'));
      assert.equal(stale.decision, 'reconcile', bound.adapterId);
      assert.equal(stale.generationId, null);
      assert.equal(stageCalls, 2, 'the stale run never called stage');
      assert.deepEqual(
        stale.journal.attempts.map((attempt) => [
          attempt.stage,
          attempt.outcome,
          attempt.failureCode,
        ]),
        [['staging', 'skipped', 'REJECTED']],
      );
      assert.equal(stale.journal.observations[0]?.outcome, 'rejected');
      assert.equal(
        stale.journal.observations[0]?.generationId,
        second.generationId,
        'the refusal records what the destination was observed serving',
      );
      assert.ok(
        stale.findings.some(
          (finding) =>
            String(finding.code).includes('FENCE') ||
            String(finding.code).includes('GENERATION'),
        ),
        `a fence finding names the disagreement: ${JSON.stringify(stale.findings.map((finding) => finding.code))}`,
      );
    } finally {
      await bound.stop();
    }
  });
}

/**
 * Run the real local-directory lifecycle with some of its functions
 * replaced, so a test can make exactly one stage misbehave.
 *
 * @param {string} seed a distinct run seed
 * @param {Record<string, (...args: any[]) => unknown>} overrides the replaced
 *   lifecycle functions, each given the real one first
 * @returns {Promise<{outcome: Awaited<ReturnType<typeof runKernelDeployment>>, intent: Record<string, any>}>}
 *   the outcome and the intent it consumed
 */
async function runWithOverrides(seed, overrides) {
  const root = await mkdtemp(path.join(tmpdir(), 'gala-kernel-stage-'));
  try {
    const envelope = envelopeFor('@rathnasgala2/adapter-local-directory');
    const intent = intentFor({
      adapterId: 'local-directory',
      artifactDigest: localDirectory.computeArtifactDigest(envelope.files),
      baseUrl: 'https://example.test/',
      seed,
      envelope,
    });
    /** @type {Record<string, any>} */
    const adapterModule = { ...localDirectory };
    for (const [name, replacement] of Object.entries(overrides)) {
      const real = adapterModule[name];
      adapterModule[name] = (/** @type {any[]} */ ...args) =>
        replacement(real, ...args);
    }
    const outcome = await runKernelDeployment({
      adapterModule,
      destination: { root },
      destinationIdentity: intent.destination,
      intent,
      files: envelope.files,
    });
    return { outcome, intent };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Assert every observation a run produced is a valid
 * `deployment-observation:2.0.0` document, and the journal is flat-valid for
 * the receipt submission.
 *
 * @param {Awaited<ReturnType<typeof runKernelDeployment>>} outcome the run
 * @param {Record<string, any>} intent the intent it consumed
 * @returns {void}
 */
function assertFailedJournalIsAcceptable(outcome, intent) {
  for (const observation of outcome.journal.observations) {
    const verdict = validateGalaDocument(
      'urn:gala:schema:deployment-observation:2.0.0',
      toFullObservation(observation, intent, true),
    );
    assert.ok(
      verdict.valid,
      `observation ${observation.kernelSequence} (${observation.observationClass}/${observation.outcome}) ` +
        `is not valid — ${JSON.stringify(verdict.diagnostics)}`,
    );
  }
  validateReceiptSubmission(
    buildReceiptSubmission(
      /** @type {any} */ ({
        intent: {
          ...intent,
          artifactByteCount: String(intent.artifactByteCount),
          artifactFileCount: String(intent.artifactFileCount),
        },
        journal: {
          attempts: outcome.journal.attempts,
          observations: outcome.journal.observations,
        },
        repositoryId: '4242',
        runId: '987654321',
        runAttempt: 1,
        publisherVersion: '0.1.0',
        observedRoutes: outcome.journal.observedRoutes,
        workflowStartedAt: '2020-01-01T00:00:00.000Z',
        workflowCompletedAt: '2099-01-01T00:00:00.000Z',
      }),
    ),
  );
}

/** A provider message carrying a token-like run the journal must not keep. */
const SECRETISH = 'A'.repeat(48);

/**
 * @param {string} message the throw's message
 * @returns {() => never} a lifecycle function that throws it
 */
function throwing(message) {
  return () => {
    throw Object.assign(new Error(message), { code: 'PROVIDER_BOOM' });
  };
}

/**
 * @typedef {{
 *   name: string,
 *   label: string,
 *   overrides: (message: string) => Record<string, (...args: any[]) => unknown>,
 *   attempts: readonly string[],
 *   failedAttempt: {stage: string, outcome: string, destinationChanged: string, failureCode: string},
 *   observation: {observationClass: string, outcome: string, destinationChanged: string}
 * }} StageCase
 */

/** @type {readonly StageCase[]} */
const STAGE_CASES = [
  {
    name: 'inspectDestination (the pre-stage read)',
    label: 'INSPECT',
    overrides: (message) => ({ inspectDestination: throwing(message) }),
    attempts: ['staging'],
    failedAttempt: {
      stage: 'staging',
      outcome: 'failed',
      destinationChanged: 'no',
      failureCode: 'PROVIDER_CONTRACT_VIOLATION',
    },
    observation: {
      observationClass: 'provider-error',
      outcome: 'provider-contract-violation',
      destinationChanged: 'no',
    },
  },
  {
    name: 'preflight',
    label: 'PREFLIGHT',
    overrides: (message) => ({ preflight: throwing(message) }),
    attempts: ['staging'],
    failedAttempt: {
      stage: 'staging',
      outcome: 'failed',
      destinationChanged: 'no',
      failureCode: 'PROVIDER_CONTRACT_VIOLATION',
    },
    observation: {
      observationClass: 'provider-error',
      outcome: 'provider-contract-violation',
      destinationChanged: 'no',
    },
  },
  {
    name: 'stage',
    label: 'STAGE',
    overrides: (message) => ({ stage: throwing(message) }),
    attempts: ['staging'],
    failedAttempt: {
      stage: 'staging',
      outcome: 'unknown',
      destinationChanged: 'unknown',
      failureCode: 'OUTCOME_UNKNOWN_RECONCILING',
    },
    observation: {
      observationClass: 'provider-error',
      outcome: 'outcome-unknown-reconciling',
      destinationChanged: 'unknown',
    },
  },
  {
    name: 'inspectDestination (the read before activation)',
    label: 'INSPECT',
    overrides: (message) => {
      let calls = 0;
      return {
        inspectDestination: (/** @type {any} */ real, /** @type {any} */ d) => {
          calls += 1;
          return calls === 1 ? real(d) : throwing(message)();
        },
      };
    },
    attempts: ['staging', 'activation'],
    failedAttempt: {
      stage: 'activation',
      outcome: 'failed',
      destinationChanged: 'no',
      failureCode: 'PROVIDER_CONTRACT_VIOLATION',
    },
    observation: {
      observationClass: 'provider-error',
      outcome: 'provider-contract-violation',
      destinationChanged: 'no',
    },
  },
  {
    name: 'activate',
    label: 'ACTIVATE',
    overrides: (message) => ({ activate: throwing(message) }),
    attempts: ['staging', 'activation'],
    failedAttempt: {
      stage: 'activation',
      outcome: 'unknown',
      destinationChanged: 'unknown',
      failureCode: 'OUTCOME_UNKNOWN_RECONCILING',
    },
    observation: {
      observationClass: 'provider-error',
      outcome: 'outcome-unknown-reconciling',
      destinationChanged: 'unknown',
    },
  },
];

for (const stageCase of STAGE_CASES) {
  test(`a throwing ${stageCase.name} ends the run with a journalled KERNEL_${stageCase.label}_FAILED, not a raw throw`, async () => {
    const { outcome, intent } = await runWithOverrides(
      `st${stageCase.label}`,
      stageCase.overrides(`provider said ${SECRETISH}`),
    );
    assert.equal(outcome.decision, 'reconcile');
    assert.equal(outcome.verified, false);
    assert.equal(outcome.generationId, null);
    assert.equal(outcome.failure?.code, `KERNEL_${stageCase.label}_FAILED`);
    assert.equal(outcome.failure?.stage, stageCase.label.toLowerCase());
    assert.match(outcome.failure?.message ?? '', /code=PROVIDER_BOOM/u);
    assert.ok(
      !(outcome.failure?.message ?? '').includes(SECRETISH),
      'a token-like run is redacted from the journalled message',
    );
    assert.deepEqual(
      outcome.journal.attempts.map((attempt) => attempt.stage),
      stageCase.attempts,
    );
    const failed = outcome.journal.attempts.at(-1);
    assert.equal(failed?.stage, stageCase.failedAttempt.stage);
    assert.equal(failed?.outcome, stageCase.failedAttempt.outcome);
    assert.equal(
      failed?.destinationChanged,
      stageCase.failedAttempt.destinationChanged,
    );
    assert.equal(failed?.failureCode, stageCase.failedAttempt.failureCode);
    const observation = outcome.journal.observations.find(
      (candidate) => candidate.stageAttemptId === failed?.stageAttemptId,
    );
    assert.equal(
      observation?.observationClass,
      stageCase.observation.observationClass,
    );
    assert.equal(observation?.outcome, stageCase.observation.outcome);
    assert.equal(
      observation?.destinationChanged,
      stageCase.observation.destinationChanged,
    );
    assertFailedJournalIsAcceptable(outcome, intent);
  });
}

test('a throwing observe after activation reports the activation unverified and journals the unknown observation', async () => {
  const { outcome, intent } = await runWithOverrides('stOBSERVE', {
    observe: throwing('provider said no'),
  });
  assert.equal(outcome.decision, 'activate');
  assert.equal(outcome.generationId, intent.proposedGenerationId);
  assert.equal(outcome.verified, false);
  assert.equal(outcome.failure?.code, 'KERNEL_OBSERVE_FAILED');
  assert.equal(outcome.failure?.stage, 'observe');
  const activation = outcome.journal.attempts.find(
    (attempt) => attempt.stage === 'activation',
  );
  assert.equal(activation?.outcome, 'succeeded');
  const observation = outcome.journal.observations.find(
    (candidate) => candidate.stageAttemptId === activation?.stageAttemptId,
  );
  assert.equal(observation?.observationClass, 'provider-error');
  assert.equal(observation?.outcome, 'outcome-unknown-reconciling');
  assert.equal(observation?.destinationChanged, 'yes');
  assert.ok(
    !outcome.journal.attempts.some((attempt) => attempt.stage === 'cleanup'),
    'cleanup is left to reconciliation once the destination is unverified',
  );
  assertFailedJournalIsAcceptable(outcome, intent);
});

test('a failure the adapter classified in its result becomes the run failure, and the first one wins', async () => {
  const classified = (/** @type {string} */ code) => ({
    failure: { code, toHost: 'www.example.com' },
    findings: [`${code}: moved to www.example.com ${SECRETISH}`],
  });
  const { outcome, intent } = await runWithOverrides('stADAPTER', {
    inspectDestination: (/** @type {any} */ real, /** @type {any} */ d) =>
      Promise.resolve(real(d)).then((inspected) => ({
        ...inspected,
        ...classified('PAGES_PUBLIC_REDIRECT'),
      })),
    preflight: (/** @type {any} */ real, /** @type {any} */ input) =>
      Promise.resolve(real(input)).then((checked) => ({
        ...checked,
        verdict: 'refuse',
      })),
    observe: (/** @type {any} */ real, /** @type {any} */ input) =>
      Promise.resolve(real(input)).then((observed) => ({
        ...observed,
        ...classified('LATER_FAILURE'),
      })),
  });
  assert.equal(outcome.decision, 'reconcile');
  assert.equal(outcome.verified, false);
  assert.equal(outcome.failure?.code, 'PAGES_PUBLIC_REDIRECT');
  assert.equal(outcome.failure?.stage, 'inspect');
  assert.match(outcome.failure?.message ?? '', /www\.example\.com/u);
  assert.ok(!(outcome.failure?.message ?? '').includes(SECRETISH));
  assertFailedJournalIsAcceptable(outcome, intent);

  const observed = await runWithOverrides('stOBSCLS', {
    observe: (/** @type {any} */ real, /** @type {any} */ input) =>
      Promise.resolve(real(input)).then((result) => ({
        ...result,
        verified: false,
        ...classified('PAGES_PUBLIC_REDIRECT'),
      })),
  });
  assert.equal(observed.outcome.failure?.code, 'PAGES_PUBLIC_REDIRECT');
  assert.equal(observed.outcome.failure?.stage, 'observe');
  assert.equal(observed.outcome.verified, false);
});

test('a run that fails nowhere carries no failure member', async () => {
  const { outcome } = await runWithOverrides('stCLEAN', {});
  assert.equal(outcome.verified, true);
  assert.equal('failure' in outcome, false);
});

test('a refused run (kernel duty, no stage threw) carries no failure member either', async () => {
  const { outcome } = await runWithOverrides('stREFUSED', {
    preflight: (/** @type {any} */ real, /** @type {any} */ input) =>
      Promise.resolve(real(input)).then((checked) => ({
        ...checked,
        verdict: 'refuse',
      })),
  });
  assert.equal(outcome.decision, 'reconcile');
  assert.equal('failure' in outcome, false);
});

test('a cleanup that throws after a verified activation is a warning: the journal keeps the activation and stays activated', async () => {
  const { outcome, intent } = await runWithOverrides('stCLEANUP', {
    cleanupStaged: throwing(`provider said ${SECRETISH}`),
  });
  assert.equal(outcome.decision, 'activate');
  assert.equal(outcome.verified, true);
  assert.equal(outcome.generationId, intent.proposedGenerationId);
  assert.equal('failure' in outcome, false);
  assert.equal(outcome.warnings?.length, 1);
  assert.equal(outcome.warnings?.[0]?.code, 'KERNEL_CLEANUP_FAILED');
  assert.equal(outcome.warnings?.[0]?.stage, 'cleanup');
  assert.ok(!(outcome.warnings?.[0]?.message ?? '').includes(SECRETISH));
  assert.deepEqual(
    outcome.journal.attempts.map((attempt) => [attempt.stage, attempt.outcome]),
    [
      ['staging', 'succeeded'],
      ['activation', 'succeeded'],
      ['cleanup', 'failed'],
    ],
    'staging and activation evidence is never discarded',
  );
  assertFailedJournalIsAcceptable(outcome, intent);
});

test('an inspect that classified why it cannot tell what is served refuses a first publish before staging', async () => {
  let staged = false;
  const { outcome, intent } = await runWithOverrides('stINSPECTCLS', {
    inspectDestination: (/** @type {any} */ real, /** @type {any} */ d) =>
      Promise.resolve(real(d)).then((inspected) => ({
        ...inspected,
        currentGenerationId: null,
        failure: { code: 'PAGES_PUBLIC_REDIRECT', toHost: 'www.example.com' },
        findings: ['PAGES_PUBLIC_REDIRECT: moved'],
      })),
    stage: (/** @type {any} */ real, /** @type {any} */ input) => {
      staged = true;
      return real(input);
    },
  });
  assert.equal(staged, false, 'nothing is staged');
  assert.equal(intent.expectedGenerationId, undefined, 'a first publish');
  assert.equal(outcome.decision, 'reconcile');
  assert.equal(outcome.verified, false);
  assert.equal(outcome.failure?.code, 'PAGES_PUBLIC_REDIRECT');
  assert.equal(outcome.failure?.toHost, 'www.example.com');
  assert.deepEqual(
    outcome.journal.attempts.map((attempt) => [attempt.stage, attempt.outcome]),
    [['staging', 'failed']],
  );
  assertFailedJournalIsAcceptable(outcome, intent);
});

test('an inspect that does not say what is served (undefined) is not "nothing served"', async () => {
  let staged = false;
  const { outcome } = await runWithOverrides('stINSPECTUNDEF', {
    inspectDestination: (/** @type {any} */ real, /** @type {any} */ d) =>
      Promise.resolve(real(d)).then((inspected) => ({
        ...inspected,
        currentGenerationId: undefined,
      })),
    stage: (/** @type {any} */ real, /** @type {any} */ input) => {
      staged = true;
      return real(input);
    },
  });
  assert.equal(staged, false);
  assert.equal(outcome.failure?.code, 'KERNEL_INSPECT_FAILED');
  assert.equal(outcome.decision, 'reconcile');
});

test('a defect in the kernel’s own evaluation is journalled as KERNEL_INTERNAL_FAILED, not thrown', async () => {
  const { outcome } = await runWithOverrides('stINTERNAL', {
    preflight: () => null,
  });
  assert.equal(outcome.failure?.code, 'KERNEL_INTERNAL_FAILED');
  assert.equal(outcome.failure?.stage, 'internal');
  assert.equal(outcome.decision, 'reconcile');
  assert.equal(outcome.verified, false);
});

test('journalled messages redact any 24-character base64 or URL-safe run, and keep failure codes and digests', async () => {
  const key = `${'k9Z'.repeat(10)}+/abcdefghijk`.slice(0, 43);
  assert.equal(key.length, 43);
  assert.ok(key.includes('+') && key.includes('/'));
  const { outcome } = await runWithOverrides('stREDACT', {
    stage: throwing(
      `key ${key} code DEPLOY_ENVELOPE_INTENT_MISMATCH digest sha256:${'a'.repeat(64)} short ${'b'.repeat(23)}`,
    ),
  });
  const message = outcome.failure?.message ?? '';
  assert.ok(!message.includes(key), message);
  assert.ok(!message.includes(key.slice(0, 24)), message);
  assert.match(message, /DEPLOY_ENVELOPE_INTENT_MISMATCH/u);
  assert.match(message, /sha256:a{64}/u);
  assert.match(message, /b{23}/u, 'a 23-character run is not a key');
});
