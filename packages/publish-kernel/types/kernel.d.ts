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
export function evaluatePreflight(input: {
    entries: readonly import("./path-containment.js").ArtifactPathEntry[];
    totals: import("./bounded-resources.js").ArtifactResourceTotals;
    limits: import("./bounded-resources.js").ProviderResourceLimits;
    authorizedDestination: import("./destination-authority.js").DestinationIdentity;
    candidateDestination: import("./destination-authority.js").DestinationIdentity;
    intent: unknown;
}): StageEvaluation;
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
export function evaluateStage(input: {
    frozenArtifact: import("./artifact-identity.js").ArtifactIdentityRecord | null;
    candidateArtifact: import("./artifact-identity.js").ArtifactIdentityRecord;
    preflightDestination: import("./destination-authority.js").DestinationIdentity;
    currentDestination: import("./destination-authority.js").DestinationIdentity;
    journal: readonly import("./operation-fencing.js").JournaledOperation[];
    candidateOperation: import("./operation-fencing.js").JournaledOperation;
}): StageEvaluation & {
    idempotency: import("./operation-fencing.js").IdempotencyDecision;
};
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
export function evaluateActivate(input: {
    preflightDestination: import("./destination-authority.js").DestinationIdentity;
    currentDestination: import("./destination-authority.js").DestinationIdentity;
    fence: import("./operation-fencing.js").ConcurrencyFenceInput;
    marker: unknown;
}): StageEvaluation & {
    activation: import("./staged-activation.js").ActivationDecision;
};
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
export function evaluateObserve(input: {
    outcome: import("./ambiguous-outcome.js").MutationAttemptOutcome;
    observation: unknown;
}): StageEvaluation & {
    disposition: import("./ambiguous-outcome.js").MutationDisposition;
};
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
export function evaluateCleanupStaged(input: {
    authorizedDestination: import("./destination-authority.js").DestinationIdentity;
    candidateDestination: import("./destination-authority.js").DestinationIdentity;
    priorDisposition: import("./ambiguous-outcome.js").MutationDisposition | null;
}): StageEvaluation;
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
export function evaluateRollback(input: {
    authorizedDestination: import("./destination-authority.js").DestinationIdentity;
    candidateDestination: import("./destination-authority.js").DestinationIdentity;
    retainedFindings: readonly import("./errors.js").KernelFinding[];
    retainedRecord: import("./retention.js").CertifiedDigestRecord | null;
    rebuiltArtifact: import("./artifact-identity.js").ArtifactIdentityRecord | null;
}): StageEvaluation;
export type StageEvaluation = Readonly<{
    verdict: "proceed" | "refuse";
    findings: readonly import("./errors.js").KernelFinding[];
}>;
