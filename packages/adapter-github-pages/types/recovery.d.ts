/**
 * Compute one intervening attempt's immutable tombstone digest:
 * `SHA256(UTF8("GALA-PAGES-NO-AUTHORITY-RUN-ATTEMPT-V2\0") ||
 * JCS({repositoryId,runId,runAttempt,authorityState}))`.
 *
 * @param {{
 *   repositoryId: string | number,
 *   runId: string | number,
 *   runAttempt: number
 * }} input the tombstone coordinates
 * @returns {string} the `decisionDigest`
 */
export function computeInterveningAttemptDigest(input: {
    repositoryId: string | number;
    runId: string | number;
    runAttempt: number;
}): string;
/**
 * Build the exact ordered tombstone set for one attempt fence: every integer
 * strictly between the prior and claiming attempts, sorted by `runAttempt`.
 * An adjacent claim carries the exact empty array.
 *
 * @param {{
 *   repositoryId: string | number,
 *   runId: string | number,
 *   priorRunAttempt: number,
 *   claimingRunAttempt: number
 * }} input the fence coordinates
 * @returns {readonly Readonly<{
 *   runAttempt: number,
 *   authorityState: string,
 *   decisionDigest: string
 * }>[]} the ordered tombstone rows
 */
export function buildInterveningAttempts(input: {
    repositoryId: string | number;
    runId: string | number;
    priorRunAttempt: number;
    claimingRunAttempt: number;
}): readonly Readonly<{
    runAttempt: number;
    authorityState: string;
    decisionDigest: string;
}>[];
/**
 * Compute a gap proof's `proofDigest` over the record with `proofDigest`
 * omitted.
 *
 * @param {Readonly<Record<string, unknown>>} proof the gap proof record
 * @returns {string} the `proofDigest`
 */
export function computeGapProofDigest(proof: Readonly<Record<string, unknown>>): string;
/**
 * Build the complete `pagesRunAttemptGapProof` the authorization
 * transaction must have produced for one fence.
 *
 * @param {{
 *   repositoryId: string | number,
 *   runId: string | number,
 *   priorRunAttempt: number,
 *   claimingRunAttempt: number
 * }} input the fence coordinates
 * @returns {Readonly<Record<string, unknown>>} the complete gap proof
 */
export function buildRunAttemptGapProof(input: {
    repositoryId: string | number;
    runId: string | number;
    priorRunAttempt: number;
    claimingRunAttempt: number;
}): Readonly<Record<string, unknown>>;
/**
 * Validate one server-supplied gap proof: exact member set, bounded
 * coordinates, set equality of the intervening attempts with every integer
 * strictly between the two coordinates, `runAttempt` ordering, every
 * tombstone digest, and the `proofDigest` itself.
 *
 * @param {unknown} proof the candidate gap proof
 * @param {{repositoryId: string | number}} binding the repository identity
 *   the tombstone digests are bound to
 * @returns {Readonly<Record<string, unknown>>} the validated proof
 */
export function validateRunAttemptGapProof(proof: unknown, binding: {
    repositoryId: string | number;
}): Readonly<Record<string, unknown>>;
/**
 * Compute a recovery record's `recoveryDigest` over the record with
 * `recoveryDigest` omitted.
 *
 * @param {Readonly<Record<string, unknown>>} recovery the recovery record
 * @returns {string} the `recoveryDigest`
 */
export function computeRecoveryDigest(recovery: Readonly<Record<string, unknown>>): string;
/**
 * Seal one otherwise complete recovery record by computing its digest. Only
 * a fixture uses this: the real record is server-minted.
 *
 * @param {Readonly<Record<string, unknown>>} withoutDigest the record with no
 *   `recoveryDigest`
 * @returns {Readonly<Record<string, unknown>>} the sealed record
 */
export function sealRecoveryRecord(withoutDigest: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
/**
 * Validate one server-supplied `pagesReconciliationRecovery` record. This
 * adapter never mints one; a malformed record is refused before any provider
 * call.
 *
 * @param {unknown} recovery the candidate record
 * @param {{repositoryId: string | number}} binding the repository identity
 * @returns {Readonly<Record<string, unknown>>} the validated record
 */
export function validateReconciliationRecovery(recovery: unknown, binding: {
    repositoryId: string | number;
}): Readonly<Record<string, unknown>>;
/**
 * Refuse a recovery-prior call outside recovery mode. `normal` forbids every
 * recovery-prior call and does not reserve that branch's budget.
 *
 * @param {string} mode the authority mode
 * @returns {void}
 */
export function assertRecoveryModePermitted(mode: string): void;
/**
 * Resolve the prior attempt before any current carrier is uploaded or
 * created (DEC-097 section 6.2).
 *
 * - terminal `succeed`: the same operation's proposed generation was already
 *   selected. No new create is performed and the current fence terminalizes
 *   as `terminal-candidate`.
 * - a terminal non-success: immutable, so the prior create can never
 *   activate. The exact prior status is recorded and the caller proceeds
 *   with the fresh current carrier/create.
 * - a temporary status or 404: exactly one cataloged cancel of that prior
 *   build version, then bounded polling.
 * - still-temporary, 404, malformed, unknown or nonterminal at the recovery
 *   deadline: truthful evidence, no current create, authority returns to
 *   `reconciliation-required`.
 *
 * @param {import('./rest.js').RestContext} context a REST context already
 *   bound to `pages-reconciliation-recovery` mode and the prior build version
 * @param {{
 *   sleep?: (seconds: number) => Promise<void>,
 *   budgetSeconds?: number
 * }} [options] bounded polling controls
 * @returns {Promise<PriorAttemptObservation>} the truthful observation
 */
export function resolvePriorAttempt(context: import("./rest.js").RestContext, options?: {
    sleep?: (seconds: number) => Promise<void>;
    budgetSeconds?: number;
}): Promise<PriorAttemptObservation>;
/** The `profile` const of a `pagesReconciliationRecovery` record. */
export const RECOVERY_RECORD_PROFILE: "gala-pages-reconciliation-recovery-v2";
/** The `profile` const of a `pagesRunAttemptGapProof` record. */
export const GAP_PROOF_PROFILE: "gala-pages-run-attempt-gap-proof-v2";
/** The single admitted `authorityState` of an intervening run attempt. */
export const NO_AUTHORITY_STATE: "closed-no-destination-authority";
/** The inclusive bounds DEC-097 places on the two fence coordinates. */
export const PRIOR_RUN_ATTEMPT_BOUNDS: Readonly<{
    minimum: 1;
    maximum: 50;
}>;
/** The inclusive bounds on a claiming run attempt. */
export const CLAIMING_RUN_ATTEMPT_BOUNDS: Readonly<{
    minimum: 2;
    maximum: 51;
}>;
export type PriorAttemptObservation = Readonly<{
    profile: "gala-pages-recovery-observation-v2";
    priorPagesBuildVersion: string;
    outcome: "prior-succeeded" | "prior-terminal-failure" | "reconciliation-required";
    authorityState: "terminal-candidate" | "proceed-with-fresh-create" | "reconciliation-required";
    priorStatus: string | null;
    observedStatuses: readonly string[];
    cancelCallCount: number;
    reason: string;
}>;
