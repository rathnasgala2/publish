/**
 * @typedef {Readonly<{
 *   attempted: boolean,
 *   providerResponded: boolean,
 *   timedOut: boolean
 * }>} MutationAttemptOutcome
 */
/**
 * @typedef {'succeeded' | 'not-attempted-retryable' | 'unknown-reconciling'} MutationDisposition
 */
/**
 * Classify the disposition of a mutating call (stage, activate or
 * rollback). A call that was never attempted is safely retryable. A call
 * that was attempted and the provider responded is either a success or a
 * definite rejection (the caller supplies `providerResponded` alongside the
 * provider's own outcome; this function only distinguishes the ambiguous
 * case). A call that was attempted, timed out and the provider never
 * definitively responded is `unknown-reconciling`: the kernel never treats
 * it as a failure (which could cause a retry that double-mutates) and never
 * treats it as a success (which could skip a needed reconciliation).
 *
 * @param {MutationAttemptOutcome} outcome the raw attempt facts
 * @returns {Readonly<{
 *   disposition: MutationDisposition,
 *   findings: readonly import('./errors.js').KernelFinding[]
 * }>} the classified disposition
 */
export function classifyMutationOutcome(outcome: MutationAttemptOutcome): Readonly<{
    disposition: MutationDisposition;
    findings: readonly import("./errors.js").KernelFinding[];
}>;
/**
 * Assert that a caller may attempt a fresh mutation: it never may while the
 * prior attempt against the same destination is still `unknown-reconciling`
 * and has not since been resolved by an out-of-band observation.
 *
 * @param {MutationDisposition | null} priorDisposition the most recent
 *   disposition recorded for this destination, or `null` when none exists
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when a
 *   fresh mutation attempt is admitted
 */
export function checkNoBlindRetry(priorDisposition: MutationDisposition | null): readonly import("./errors.js").KernelFinding[];
export type MutationAttemptOutcome = Readonly<{
    attempted: boolean;
    providerResponded: boolean;
    timedOut: boolean;
}>;
export type MutationDisposition = "succeeded" | "not-attempted-retryable" | "unknown-reconciling";
