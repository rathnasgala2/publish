/**
 * Kernel stage composition: the ten non-disableable duties (S2-author-owned-
 * publication.md section 5), wired into one evaluation function per
 * adapter-protocol lifecycle stage that mutates or observes a destination
 * (`preflight`, `stage`, `activate`, `observe`, `cleanupStaged`,
 * `rollback`). Every function here is pure over its explicit input: no
 * ambient `cwd`, environment variable, clock read beyond a caller-supplied
 * timestamp, or network access. A caller (a concrete adapter, or
 * `publish-action`'s composition root) supplies every fact the duties need
 * and persists whatever state (the operation journal, the retained digest
 * history) its own execution context requires; the kernel keeps none of it.
 *
 * Each `evaluate*` function fails closed: it always returns every applicable
 * finding rather than stopping at the first duty, and it never signals
 * `'proceed'` while any blocking finding is present.
 *
 * @module
 */

import { checkArtifactIdentityAgreement } from './artifact-identity.js';
import { checkBoundedResources } from './bounded-resources.js';
import {
  checkDestinationAuthority,
  checkDestinationOwnership,
} from './destination-authority.js';
import { checkPathContainment } from './path-containment.js';
import { checkGenerationMarker } from './generation-marker.js';
import { decideIdempotency } from './operation-fencing.js';
import { decideStagedActivation } from './staged-activation.js';
import {
  classifyMutationOutcome,
  checkNoBlindRetry,
} from './ambiguous-outcome.js';
import { findSecretExposure } from './secret-redaction.js';
import { hasBlockingFinding } from './errors.js';

/**
 * @typedef {Readonly<{
 *   verdict: 'proceed' | 'refuse',
 *   findings: readonly import('./errors.js').KernelFinding[]
 * }>} StageEvaluation
 */

/**
 * @param {readonly import('./errors.js').KernelFinding[]} findings
 * @returns {StageEvaluation}
 */
function evaluation(findings) {
  const frozen = Object.freeze([...findings]);
  return Object.freeze({
    verdict: hasBlockingFinding(frozen) ? 'refuse' : 'proceed',
    findings: frozen,
  });
}

/**
 * Evaluate `preflight`: duty 3 (bounded resources), duty 2 (path
 * containment) and duty 5 (secret handling) over the candidate artifact,
 * plus duty 4's destination-ownership check against the operation's
 * authorized destination.
 *
 * @param {{
 *   entries: readonly import('./path-containment.js').ArtifactPathEntry[],
 *   totals: import('./bounded-resources.js').ArtifactResourceTotals,
 *   limits: import('./bounded-resources.js').ProviderResourceLimits,
 *   authorizedDestination: import('./destination-authority.js').DestinationIdentity,
 *   candidateDestination: import('./destination-authority.js').DestinationIdentity,
 *   intent: unknown
 * }} input every fact preflight needs
 * @returns {StageEvaluation} the preflight verdict
 */
export function evaluatePreflight(input) {
  return evaluation([
    ...checkPathContainment(input.entries),
    ...checkBoundedResources(input.totals, input.limits),
    ...checkDestinationOwnership(
      input.authorizedDestination,
      input.candidateDestination,
    ),
    ...findSecretExposure(input.intent),
  ]);
}

/**
 * Evaluate `stage`: duty 1 (artifact identity agreement with whatever was
 * frozen at handoff time), duty 4 (destination unchanged since preflight)
 * and duty 6 (idempotency fencing).
 *
 * @param {{
 *   frozenArtifact: import('./artifact-identity.js').ArtifactIdentityRecord | null,
 *   candidateArtifact: import('./artifact-identity.js').ArtifactIdentityRecord,
 *   preflightDestination: import('./destination-authority.js').DestinationIdentity,
 *   currentDestination: import('./destination-authority.js').DestinationIdentity,
 *   journal: readonly import('./operation-fencing.js').JournaledOperation[],
 *   candidateOperation: import('./operation-fencing.js').JournaledOperation
 * }} input every fact stage needs
 * @returns {StageEvaluation & { idempotency: import('./operation-fencing.js').IdempotencyDecision }}
 *   the stage verdict, plus the idempotency decision a caller uses to skip
 *   re-staging an exact replay
 */
export function evaluateStage(input) {
  const idempotency = decideIdempotency(
    input.journal,
    input.candidateOperation,
  );
  const evaluated = evaluation([
    ...checkArtifactIdentityAgreement(
      input.frozenArtifact,
      input.candidateArtifact,
    ),
    ...checkDestinationAuthority(
      input.preflightDestination,
      input.currentDestination,
    ),
    ...idempotency.findings,
  ]);
  return Object.freeze({ ...evaluated, idempotency });
}

/**
 * Evaluate `activate`: duty 4 (destination still unchanged), duty 7
 * (staged activation under the negotiated concurrency fence) and duty 2's
 * generation-marker construction (validated as a `public-generation-
 * marker:2.0.0` document before it is ever written).
 *
 * @param {{
 *   preflightDestination: import('./destination-authority.js').DestinationIdentity,
 *   currentDestination: import('./destination-authority.js').DestinationIdentity,
 *   fence: import('./operation-fencing.js').ConcurrencyFenceInput,
 *   marker: unknown
 * }} input every fact activate needs
 * @returns {StageEvaluation & { activation: import('./staged-activation.js').ActivationDecision }}
 *   the activate verdict, plus the staged-activation decision
 */
export function evaluateActivate(input) {
  const activation = decideStagedActivation(input.fence);
  const evaluated = evaluation([
    ...checkDestinationAuthority(
      input.preflightDestination,
      input.currentDestination,
    ),
    ...(activation.decision === 'activate'
      ? checkGenerationMarker(input.marker)
      : []),
    ...activation.findings,
  ]);
  return Object.freeze({ ...evaluated, activation });
}

/**
 * Evaluate `observe`: duty 8 (ambiguous-outcome discipline) and duty 5
 * (secret handling) over the observation record about to be retained.
 *
 * @param {{
 *   outcome: import('./ambiguous-outcome.js').MutationAttemptOutcome,
 *   observation: unknown
 * }} input every fact observe needs
 * @returns {StageEvaluation & { disposition: import('./ambiguous-outcome.js').MutationDisposition }}
 *   the observe verdict, plus the classified mutation disposition
 */
export function evaluateObserve(input) {
  const classified = classifyMutationOutcome(input.outcome);
  const evaluated = evaluation([
    ...classified.findings,
    ...findSecretExposure(input.observation),
  ]);
  return Object.freeze({ ...evaluated, disposition: classified.disposition });
}

/**
 * Evaluate `cleanupStaged`: duty 4 (only the operation's own destination may
 * be touched) and duty 8 (never clean up while a prior mutation on this
 * destination is still unresolved-ambiguous, since cleanup itself is a
 * mutating provider call).
 *
 * @param {{
 *   authorizedDestination: import('./destination-authority.js').DestinationIdentity,
 *   candidateDestination: import('./destination-authority.js').DestinationIdentity,
 *   priorDisposition: import('./ambiguous-outcome.js').MutationDisposition | null
 * }} input every fact cleanup needs
 * @returns {StageEvaluation} the cleanup verdict
 */
export function evaluateCleanupStaged(input) {
  return evaluation([
    ...checkDestinationOwnership(
      input.authorizedDestination,
      input.candidateDestination,
    ),
    ...checkNoBlindRetry(input.priorDisposition),
  ]);
}

/**
 * Evaluate `rollback`: duty 9 (the target generation must be in the
 * retained last-known-good history), duty 4 (destination ownership) and
 * duty 1 (the rebuilt candidate must agree with the retained record it
 * claims to reconstruct).
 *
 * @param {{
 *   authorizedDestination: import('./destination-authority.js').DestinationIdentity,
 *   candidateDestination: import('./destination-authority.js').DestinationIdentity,
 *   retainedFindings: readonly import('./errors.js').KernelFinding[],
 *   retainedRecord: import('./retention.js').CertifiedDigestRecord | null,
 *   rebuiltArtifact: import('./artifact-identity.js').ArtifactIdentityRecord | null
 * }} input every fact rollback needs
 * @returns {StageEvaluation} the rollback verdict
 */
export function evaluateRollback(input) {
  /** @type {import('./errors.js').KernelFinding[]} */
  const findings = [
    ...checkDestinationOwnership(
      input.authorizedDestination,
      input.candidateDestination,
    ),
    ...input.retainedFindings,
  ];
  if (
    input.retainedRecord !== null &&
    input.rebuiltArtifact !== null &&
    input.retainedRecord.artifactDigest !== input.rebuiltArtifact.artifactDigest
  ) {
    findings.push(
      ...checkArtifactIdentityAgreement(
        {
          artifactId: input.rebuiltArtifact.artifactId,
          artifactDigest: input.retainedRecord.artifactDigest,
          manifestDigest: input.rebuiltArtifact.manifestDigest,
          artifactFileCount: input.rebuiltArtifact.artifactFileCount,
          artifactByteCount: input.rebuiltArtifact.artifactByteCount,
        },
        input.rebuiltArtifact,
      ),
    );
  }
  return evaluation(findings);
}
