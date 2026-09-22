/**
 * Duty 8: "Ambiguous-outcome discipline: timeout after a possible mutation
 * yields `UNKNOWN_RECONCILING`, never a blind second mutation and never a
 * false failure."
 *
 * @module
 */

import { kernelFinding } from './errors.js';

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
export function classifyMutationOutcome(outcome) {
  if (!outcome.attempted) {
    return Object.freeze({
      disposition: 'not-attempted-retryable',
      findings: Object.freeze([]),
    });
  }
  if (outcome.providerResponded) {
    return Object.freeze({
      disposition: 'succeeded',
      findings: Object.freeze([]),
    });
  }
  return Object.freeze({
    disposition: 'unknown-reconciling',
    findings: Object.freeze([
      kernelFinding(
        'UNKNOWN_RECONCILING',
        'WARNING',
        outcome.timedOut
          ? 'The mutating call timed out without a definitive provider response after possibly mutating the destination.'
          : 'The mutating call ended without a definitive provider response after possibly mutating the destination.',
        'Observe the destination out of band before any further mutation; never retry blindly and never report this as a failure.',
      ),
    ]),
  });
}

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
export function checkNoBlindRetry(priorDisposition) {
  if (priorDisposition !== 'unknown-reconciling') {
    return Object.freeze([]);
  }
  return Object.freeze([
    kernelFinding(
      'UNKNOWN_RECONCILING_RETRY_BLOCKED',
      'ARTIFACT_SAFETY_ERROR',
      'A prior mutation against this destination is still unknown-reconciling; a second mutation cannot be attempted blindly.',
      'Observe the destination out of band to resolve the prior attempt before issuing a new mutating call.',
    ),
  ]);
}
