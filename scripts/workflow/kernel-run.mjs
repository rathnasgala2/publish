/**
 * The kernel-driven deployment run, shared by every adapter.
 *
 * The three S2/S4 adapters implement the same eight-function adapter
 * protocol with the same input shapes, so the stage/verify/activate/cleanup
 * sequence is written once here, provider-neutrally, and parameterized only
 * by the adapter module namespace and its own destination value. What the
 * caller supplies is the already issued deployment intent; what it gets back
 * is the credential-free kernel journal the receipt submission carries.
 *
 * Three properties this module is responsible for and the deploy jobs are
 * not:
 *
 * - **The kernel decides, the adapter acts.** Every provider call is
 *   preceded by its `publish-kernel` evaluation, and a refusing verdict
 *   means the call is not made. The adapter is never asked to enforce a
 *   duty; it is only ever allowed to run once the duties passed.
 * - **The activation fence is the intent's, never the observation's.** The
 *   retained intent's `expectedGenerationId` names the generation Gala
 *   expects the destination to be serving, and its absence means "a first
 *   publish", which adapter protocol 2.1.0 spells as the explicit
 *   `EXPECT_NOTHING_SERVED` sentinel (LOCAL-47). The run observes what the
 *   destination serves and hands both to the kernel; a disagreement is a
 *   refusal recorded in the journal, not a fence quietly re-derived from
 *   whatever happened to be there.
 * - **A stage that did not run is never recorded as succeeded.** Each
 *   attempt is appended with the outcome that actually happened, including
 *   `skipped` for a stage the kernel refused and `unknown` for a provider
 *   call whose outcome could not be established — which is the input the
 *   ambiguous-outcome duty needs, and the one thing a journal must never
 *   round off.
 *
 * @module
 */

import { createHash } from 'node:crypto';

import {
  EXPECT_NOTHING_SERVED,
  defineAdapter,
  requireGenerationFence,
} from '@rathnasgala2/adapter-protocol';
import {
  evaluateActivate,
  evaluateCleanupStaged,
  evaluateObserve,
  evaluatePreflight,
  evaluateStage,
  hasBlockingFinding,
} from '@rathnasgala2/publish-kernel';

import { deriveStableId, taggedDigest } from './workload-identity.mjs';
import { canonicalJson } from './workload-identity.mjs';

/** The provider resource limits the kernel's duty 3 is evaluated against. */
export const PROVIDER_LIMITS = Object.freeze({
  maximumFiles: 1000000,
  maximumArtifactBytes: '10737418240',
  maximumPathBytes: 4096,
});

/**
 * The activation fence the intent states: its `expectedGenerationId`, or the
 * explicit sentinel when the intent carries none (DEC-097: absent exactly
 * for a first publish). Validated to the protocol's exact fence shape, so a
 * malformed intent is refused here rather than turned into a fence.
 *
 * @param {Record<string, unknown>} intent the retained intent
 * @param {string} adapterId the adapter, for the diagnostic
 * @returns {string} the fence value to hand to the kernel and the adapter
 */
export function fenceFromIntent(intent, adapterId) {
  const fence = requireGenerationFence(
    intent.expectedGenerationId === undefined
      ? EXPECT_NOTHING_SERVED
      : intent.expectedGenerationId,
    adapterId,
  );
  return fence.expectsNothingServed
    ? EXPECT_NOTHING_SERVED
    : String(fence.generationId);
}

/**
 * rfc3339 with exactly three fractional digits.
 *
 * @param {Date} at the instant
 * @returns {string} the rendered instant
 */
function instant(at) {
  return `${at.toISOString().slice(0, 19)}.${String(at.getUTCMilliseconds()).padStart(3, '0')}Z`;
}

/**
 * One journal recorder. It owns the two gap-free per-stream sequences the
 * API re-derives on ingestion, so no caller can append an entry that leaves
 * a hole.
 */
class KernelJournal {
  /**
   * @param {{operationId: string, attemptId: string, generationId: string, now: () => Date}} binding
   *   the operation binding and the clock
   */
  constructor(binding) {
    this.binding = binding;
    /** @type {Record<string, unknown>[]} */
    this.attempts = [];
    /** @type {Record<string, unknown>[]} */
    this.observations = [];
  }

  /**
   * The stable stage-attempt identity for one stage of this attempt. It is
   * derived, so a retried stage of the same authorized attempt reuses it.
   *
   * @param {string} stage the lifecycle stage
   * @returns {string} the stage-attempt id
   */
  stageAttemptId(stage) {
    return deriveStableId('gala-stage-attempt-v2', {
      operationId: this.binding.operationId,
      attemptId: this.binding.attemptId,
      stage,
    });
  }

  /**
   * Append one attempt record.
   *
   * @param {{
   *   stage: 'staging' | 'activation' | 'cleanup',
   *   outcome: 'succeeded' | 'failed' | 'skipped' | 'unknown',
   *   destinationChanged: 'yes' | 'no' | 'unknown',
   *   retryable: boolean,
   *   input: unknown,
   *   evidence: unknown,
   *   result?: unknown,
   *   failureCode?: string,
   *   startedAt: Date
   * }} record the attempt facts
   * @returns {string} the appended attempt's stage-attempt id
   */
  appendAttempt(record) {
    const stageAttemptId = this.stageAttemptId(record.stage);
    /** @type {Record<string, unknown>} */
    const attempt = {
      stageAttemptId,
      causationId: this.binding.attemptId,
      stage: record.stage,
      kernelSequence: this.attempts.length + 1,
      outcome: record.outcome,
      destinationChanged: record.destinationChanged,
      inputDigest: taggedDigest(canonicalJson(record.input)),
      retryable: record.retryable,
      evidenceDigest: taggedDigest(canonicalJson(record.evidence)),
      startedAt: instant(record.startedAt),
      completedAt: instant(this.binding.now()),
    };
    if (record.result !== undefined) {
      attempt.resultDigest = taggedDigest(canonicalJson(record.result));
    }
    if (record.failureCode !== undefined) {
      attempt.failureCode = record.failureCode;
    }
    this.attempts.push(attempt);
    return stageAttemptId;
  }

  /**
   * Append one observation record, always witnessing one of this journal's
   * own stage attempts.
   *
   * @param {{
   *   stageAttemptId: string,
   *   observationClass: 'request-not-started' | 'request-accepted' | 'provider-state' | 'timeout' | 'provider-error',
   *   outcome: string,
   *   destinationChanged: 'yes' | 'no' | 'unknown',
   *   evidence: unknown,
   *   generationId?: string,
   *   observedArtifactDigest?: string,
   *   providerVersion?: string
   * }} record the observation facts
   * @returns {void}
   */
  appendObservation(record) {
    /** @type {Record<string, unknown>} */
    const observation = {
      observationId: deriveStableId('gala-observation-v2', {
        operationId: this.binding.operationId,
        attemptId: this.binding.attemptId,
        stageAttemptId: record.stageAttemptId,
        sequence: this.observations.length + 1,
      }),
      stageAttemptId: record.stageAttemptId,
      kernelSequence: this.observations.length + 1,
      observationClass: record.observationClass,
      outcome: record.outcome,
      destinationChanged: record.destinationChanged,
      observedAt: instant(this.binding.now()),
      evidenceDigest: taggedDigest(canonicalJson(record.evidence)),
    };
    for (const name of [
      'generationId',
      'observedArtifactDigest',
      'providerVersion',
    ]) {
      const value = /** @type {Record<string, unknown>} */ (record)[name];
      if (value !== undefined) {
        observation[name] = value;
      }
    }
    this.observations.push(observation);
  }
}

/**
 * Run one complete kernel-driven deployment against one destination.
 *
 * @param {{
 *   adapterModule: Record<string, unknown>,
 *   destination: Record<string, unknown>,
 *   destinationIdentity: Record<string, unknown>,
 *   intent: Record<string, unknown>,
 *   files: readonly {path: string, bytes: Buffer}[],
 *   activateExtras?: Record<string, unknown>,
 *   now?: () => Date
 * }} run the run inputs
 * @returns {Promise<{
 *   journal: {attempts: Record<string, unknown>[], observations: Record<string, unknown>[], observedRoutes: Record<string, unknown>[]},
 *   decision: string,
 *   generationId: string | null,
 *   verified: boolean,
 *   findings: readonly Record<string, unknown>[]
 * }>} the run outcome and its journal
 */
export async function runKernelDeployment(run) {
  const lifecycle = defineAdapter(run.adapterModule);
  const now = run.now ?? (() => new Date());
  const intent = run.intent;
  const operationId = String(intent.operationId);
  const attemptId = String(intent.attemptId);
  const generationId = String(intent.proposedGenerationId);
  const artifactId = String(intent.artifactId);
  const artifactDigest = String(intent.artifactDigest);
  const idempotencyKey = String(intent.idempotencyKey);
  const adapterId = String(
    /** @type {Record<string, unknown>} */ (intent.adapter ?? {}).adapterId ??
      'adapter',
  );
  const expectedGenerationId = fenceFromIntent(intent, adapterId);
  const journal = new KernelJournal({
    operationId,
    attemptId,
    generationId,
    now,
  });
  /** @type {Record<string, unknown>[]} */
  const findings = [];

  const entries = run.files.map((file) => ({
    path: file.path,
    kind: /** @type {const} */ ('file'),
  }));
  const totals = {
    artifactFileCount: run.files.length,
    artifactByteCount: run.files
      .reduce((sum, file) => sum + BigInt(file.bytes.byteLength), 0n)
      .toString(10),
    longestPathBytes: Math.max(
      ...run.files.map((file) => Buffer.byteLength(file.path, 'utf8')),
    ),
  };

  // --- duty evaluation before the first provider contact -----------------
  const preflightVerdict = evaluatePreflight({
    entries,
    totals,
    limits: PROVIDER_LIMITS,
    authorizedDestination: /** @type {any} */ (run.destinationIdentity),
    candidateDestination: /** @type {any} */ (run.destinationIdentity),
    intent: { manifestDigest: intent.manifestDigest },
  });
  if (hasBlockingFinding(preflightVerdict.findings)) {
    return refused(journal, preflightVerdict.findings, 'staging', now);
  }

  /**
   * @returns {Promise<string | null>} the generation the destination is
   *   observed serving right now, or `null` when it serves none
   */
  async function observeServedGeneration() {
    const observed = /** @type {Record<string, unknown>} */ (
      await lifecycle.inspectDestination(run.destination)
    );
    return typeof observed.currentGenerationId === 'string'
      ? observed.currentGenerationId
      : null;
  }
  const marker = intent.marker;
  /**
   * The kernel's activation verdict for the intent's fence against one
   * observation. It is evaluated before staging — so a destination already
   * serving something the intent did not expect is refused before any
   * private coordinate is written — and again, on a fresh observation,
   * immediately before activation.
   *
   * @param {string | null} observedGenerationId the observed generation
   * @returns {ReturnType<typeof evaluateActivate>} the verdict
   */
  function fenceVerdict(observedGenerationId) {
    return evaluateActivate({
      preflightDestination: /** @type {any} */ (run.destinationIdentity),
      currentDestination: /** @type {any} */ (run.destinationIdentity),
      fence: {
        concurrency: 'expected-generation',
        expectedGenerationId,
        observedGenerationId,
      },
      marker,
    });
  }
  let observedGenerationId = await observeServedGeneration();
  const preStageVerdict = fenceVerdict(observedGenerationId);
  if (hasBlockingFinding(preStageVerdict.findings)) {
    findings.push(...preStageVerdict.findings);
    const stageAttemptId = journal.appendAttempt({
      stage: 'staging',
      outcome: 'skipped',
      destinationChanged: 'no',
      retryable: false,
      failureCode: 'REJECTED',
      input: {
        generationId,
        expectedCurrentGenerationId: expectedGenerationId,
        observedGenerationId,
      },
      evidence: {
        findingCount: preStageVerdict.findings.length,
        refusedBefore: 'staging',
      },
      startedAt: now(),
    });
    journal.appendObservation({
      stageAttemptId,
      observationClass: 'request-not-started',
      outcome: 'rejected',
      destinationChanged: 'no',
      evidence: { fence: 'disagrees' },
      ...(observedGenerationId === null
        ? {}
        : { generationId: observedGenerationId }),
    });
    return complete(journal, findings, 'reconcile', null, false, run);
  }

  const adapterPreflight = /** @type {Record<string, unknown>} */ (
    await lifecycle.preflight({
      destination: run.destination,
      entries: run.files.map((file) => ({ path: file.path })),
    })
  );
  if (adapterPreflight.verdict !== 'proceed') {
    const stageAttemptId = journal.appendAttempt({
      stage: 'staging',
      outcome: 'skipped',
      destinationChanged: 'no',
      retryable: false,
      failureCode: 'TARGET_CAPABILITY_UNAVAILABLE',
      input: { artifactDigest, fileCount: run.files.length },
      evidence: { verdict: adapterPreflight.verdict },
      startedAt: now(),
    });
    journal.appendObservation({
      stageAttemptId,
      observationClass: 'request-not-started',
      outcome: 'rejected',
      destinationChanged: 'no',
      evidence: { verdict: adapterPreflight.verdict },
    });
    return complete(journal, [], 'reconcile', null, false, run);
  }

  // --- stage -------------------------------------------------------------
  const stageVerdict = evaluateStage({
    frozenArtifact: {
      artifactId,
      artifactDigest,
      manifestDigest: String(intent.manifestDigest),
      artifactFileCount: Number(intent.artifactFileCount),
      artifactByteCount: Number(intent.artifactByteCount),
    },
    candidateArtifact: {
      artifactId,
      artifactDigest,
      manifestDigest: String(intent.manifestDigest),
      artifactFileCount: run.files.length,
      artifactByteCount: Number(totals.artifactByteCount),
    },
    preflightDestination: /** @type {any} */ (run.destinationIdentity),
    currentDestination: /** @type {any} */ (run.destinationIdentity),
    journal: [],
    candidateOperation: {
      operationId,
      attemptId,
      idempotencyKey,
      artifactDigest,
    },
  });
  if (hasBlockingFinding(stageVerdict.findings)) {
    return refused(journal, stageVerdict.findings, 'staging', now);
  }

  const stageStartedAt = now();
  const staged = /** @type {Record<string, unknown>} */ (
    await lifecycle.stage({
      destination: run.destination,
      operationId,
      attemptId,
      idempotencyKey,
      generationId,
      artifactId,
      artifactDigest,
      files: run.files,
    })
  );
  const stagingAttemptId = journal.appendAttempt({
    stage: 'staging',
    outcome: 'succeeded',
    // Staging writes only into this operation's own private staged
    // coordinate; nothing served has changed yet, and saying otherwise
    // would make every stage look like a destination mutation.
    destinationChanged: 'no',
    retryable: false,
    input: { artifactDigest, fileCount: run.files.length, generationId },
    evidence: { idempotent: staged.idempotent === true },
    result: { fileCount: staged.fileCount ?? run.files.length },
    startedAt: stageStartedAt,
  });
  journal.appendObservation({
    stageAttemptId: stagingAttemptId,
    observationClass: 'request-accepted',
    outcome: 'succeeded',
    destinationChanged: 'no',
    evidence: { idempotent: staged.idempotent === true },
    generationId,
  });

  // --- activate ----------------------------------------------------------
  // A fresh observation: what was served before staging may have moved.
  observedGenerationId = await observeServedGeneration();
  const activateVerdict = fenceVerdict(observedGenerationId);
  if (hasBlockingFinding(activateVerdict.findings)) {
    findings.push(...activateVerdict.findings);
    journal.appendAttempt({
      stage: 'activation',
      outcome: 'skipped',
      destinationChanged: 'no',
      retryable: false,
      failureCode: 'REJECTED',
      input: {
        generationId,
        expectedCurrentGenerationId: expectedGenerationId,
        observedGenerationId,
      },
      evidence: { findingCount: activateVerdict.findings.length },
      startedAt: now(),
    });
    return complete(journal, findings, 'reconcile', null, false, run);
  }

  const activateStartedAt = now();
  /** @type {Record<string, unknown>} */
  let activation;
  try {
    activation = /** @type {Record<string, unknown>} */ (
      await lifecycle.activate({
        destination: run.destination,
        stageToken: staged.stageToken,
        generationId,
        expectedCurrentGenerationId: expectedGenerationId,
        expectedArtifactDigest: artifactDigest,
        ...(run.activateExtras ?? {}),
      })
    );
  } catch (failure) {
    // An activation whose outcome cannot be established is `unknown`, never
    // `failed`: the mutation may have landed. Duty 8 forbids a blind retry
    // from here, and the journal must say so rather than imply nothing
    // happened.
    const stageAttemptId = journal.appendAttempt({
      stage: 'activation',
      outcome: 'unknown',
      destinationChanged: 'unknown',
      retryable: false,
      failureCode: 'OUTCOME_UNKNOWN_RECONCILING',
      input: { generationId },
      evidence: { failureName: nameOf(failure) },
      startedAt: activateStartedAt,
    });
    journal.appendObservation({
      stageAttemptId,
      observationClass: 'provider-error',
      outcome: 'outcome-unknown-reconciling',
      destinationChanged: 'unknown',
      evidence: { failureName: nameOf(failure) },
    });
    return complete(journal, findings, 'reconcile', null, false, run);
  }

  const activated = activation.decision === 'activate';
  const activationAttemptId = journal.appendAttempt({
    stage: 'activation',
    outcome: activated ? 'succeeded' : 'failed',
    destinationChanged: activated ? 'yes' : 'unknown',
    retryable: false,
    ...(activated ? {} : { failureCode: 'OUTCOME_UNKNOWN_RECONCILING' }),
    input: {
      generationId,
      expectedCurrentGenerationId: expectedGenerationId,
      observedGenerationId,
    },
    evidence: {
      decision: activation.decision,
      idempotent: activation.idempotent === true,
    },
    result: { generationId: activation.generationId },
    startedAt: activateStartedAt,
  });

  // --- observe -----------------------------------------------------------
  const observed = /** @type {Record<string, unknown>} */ (
    await lifecycle.observe({
      destination: run.destination,
      generationId: activation.generationId,
      expectedArtifactDigest: artifactDigest,
    })
  );
  const observeVerdict = evaluateObserve({
    outcome: { attempted: true, providerResponded: true, timedOut: false },
    observation: {
      generationId: activation.generationId,
      artifactDigest: observed.observedArtifactDigest,
    },
  });
  journal.appendObservation({
    stageAttemptId: activationAttemptId,
    observationClass: 'provider-state',
    outcome: observed.verified === true ? 'succeeded' : 'rejected',
    destinationChanged: activated ? 'yes' : 'unknown',
    evidence: {
      verified: observed.verified === true,
      markerValid: observed.markerValid === true,
    },
    generationId: String(activation.generationId),
    ...(typeof observed.observedArtifactDigest === 'string'
      ? { observedArtifactDigest: observed.observedArtifactDigest }
      : {}),
  });

  // --- cleanup -----------------------------------------------------------
  const cleanupVerdict = evaluateCleanupStaged({
    authorizedDestination: /** @type {any} */ (run.destinationIdentity),
    candidateDestination: /** @type {any} */ (run.destinationIdentity),
    priorDisposition: observeVerdict.disposition,
  });
  const cleanupStartedAt = now();
  if (hasBlockingFinding(cleanupVerdict.findings)) {
    journal.appendAttempt({
      stage: 'cleanup',
      outcome: 'skipped',
      destinationChanged: 'no',
      retryable: true,
      failureCode: 'NOT_ATTEMPTED_RETRYABLE',
      input: { stageToken: typeof staged.stageToken === 'string' },
      evidence: { reason: 'prior-mutation-unresolved' },
      startedAt: cleanupStartedAt,
    });
  } else {
    const cleaned = /** @type {Record<string, unknown>} */ (
      await lifecycle.cleanupStaged({
        destination: run.destination,
        stageToken: staged.stageToken,
        generationId,
      })
    );
    journal.appendAttempt({
      stage: 'cleanup',
      outcome: 'succeeded',
      destinationChanged: 'no',
      retryable: false,
      input: { stageToken: typeof staged.stageToken === 'string' },
      evidence: { removed: cleaned.removed === true },
      startedAt: cleanupStartedAt,
    });
  }

  if (observed.verified !== true) {
    findings.push({
      code: 'DEPLOY_OBSERVATION_UNVERIFIED',
      severity: 'TARGET_CONSTRAINT_ERROR',
    });
  }

  return complete(
    journal,
    findings,
    String(activation.decision),
    String(activation.generationId),
    observed.verified === true,
    run,
  );
}

/**
 * @param {unknown} failure the thrown value
 * @returns {string} its constructor name, and never its message — an adapter
 *   failure message can quote a provider response body
 */
function nameOf(failure) {
  return failure instanceof Error ? failure.name : 'UnknownFailure';
}

/**
 * Finish a run that the kernel refused before any provider mutation.
 *
 * @param {KernelJournal} journal the journal so far
 * @param {readonly unknown[]} findings the blocking findings
 * @param {'staging' | 'activation' | 'cleanup'} stage the refused stage
 * @param {() => Date} now the clock
 * @returns {{journal: {attempts: Record<string, unknown>[], observations: Record<string, unknown>[], observedRoutes: Record<string, unknown>[]}, decision: string, generationId: null, verified: false, findings: readonly Record<string, unknown>[]}}
 *   the refused outcome
 */
function refused(journal, findings, stage, now) {
  const stageAttemptId = journal.appendAttempt({
    stage,
    outcome: 'skipped',
    destinationChanged: 'no',
    retryable: false,
    failureCode: 'REJECTED',
    input: { refusedBefore: stage },
    evidence: { findingCount: findings.length },
    startedAt: now(),
  });
  journal.appendObservation({
    stageAttemptId,
    observationClass: 'request-not-started',
    outcome: 'rejected',
    destinationChanged: 'no',
    evidence: { findingCount: findings.length },
  });
  return {
    journal: {
      attempts: journal.attempts,
      observations: journal.observations,
      observedRoutes: [],
    },
    decision: 'reconcile',
    generationId: null,
    verified: false,
    findings: /** @type {readonly Record<string, unknown>[]} */ (findings),
  };
}

/**
 * @param {KernelJournal} journal the completed journal
 * @param {readonly unknown[]} findings the run's findings
 * @param {string} decision the activation decision
 * @param {string | null} generationId the activated generation
 * @param {boolean} verified whether observation verified the artifact
 * @param {{files: readonly {path: string, bytes: Buffer}[]}} run the run inputs
 * @returns {{journal: {attempts: Record<string, unknown>[], observations: Record<string, unknown>[], observedRoutes: Record<string, unknown>[]}, decision: string, generationId: string | null, verified: boolean, findings: readonly Record<string, unknown>[]}}
 *   the completed outcome
 */
function complete(journal, findings, decision, generationId, verified, run) {
  return {
    journal: {
      attempts: journal.attempts,
      observations: journal.observations,
      observedRoutes: observedRoutesFor(run.files),
    },
    decision,
    generationId,
    verified,
    findings: /** @type {readonly Record<string, unknown>[]} */ (findings),
  };
}

/**
 * The bounded `observedRoutes` sample the submission carries: the artifact's
 * own HTML routes, in path order, capped at the contract's sixteen. Only the
 * expected digest is asserted here — the workflow proves what it served, and
 * Gala's own public verification is what establishes what is being served.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the artifact files
 * @returns {Record<string, unknown>[]} the observed-route entries
 */
export function observedRoutesFor(files) {
  return [...files]
    .filter((file) => file.path.endsWith('.html'))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
    .slice(0, 16)
    .map((file) => ({
      route: `/${file.path}`,
      expectedDigest: createHash('sha256').update(file.bytes).digest('hex'),
    }));
}
