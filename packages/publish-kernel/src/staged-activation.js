/**
 * Duty 7: "Staged activation under an expected-current-generation condition
 * where the adapter declares support. If another operation changed the
 * destination, the older candidate reconciles instead of overwriting."
 *
 * @module
 */

import { checkConcurrencyFence } from './operation-fencing.js';
import { kernelFinding } from './errors.js';

/**
 * @typedef {Readonly<{
 *   decision: 'activate' | 'reconcile',
 *   findings: readonly import('./errors.js').KernelFinding[]
 * }>} ActivationDecision
 */

/**
 * Decide whether a staged candidate may activate. When the negotiated
 * adapter declares `expected-generation` (or `provider-etag`) concurrency
 * and the destination's currently observed generation disagrees with the
 * candidate's expectation, the candidate never overwrites: it reconciles
 * (the caller re-observes and either re-stages against the new current
 * generation or abandons the candidate). This function never returns
 * `activate` when a fence disagreement exists — there is no blind
 * second-mutation path, and since LOCAL-47 there is no fence *input* that
 * disables the check either: the expectation is stated in the adapter
 * protocol's fence vocabulary (a generation identity or
 * `EXPECT_NOTHING_SERVED`), and the observation is mandatory.
 *
 * @param {import('./operation-fencing.js').ConcurrencyFenceInput} fence the
 *   concurrency class and expected/observed generation identities
 * @returns {ActivationDecision} the activation decision
 */
export function decideStagedActivation(fence) {
  const fenceFindings = checkConcurrencyFence(fence);
  if (fenceFindings.length === 0) {
    return Object.freeze({ decision: 'activate', findings: Object.freeze([]) });
  }
  const blocking = fenceFindings.some(
    (finding) => finding.severity !== 'TARGET_CONSTRAINT_ERROR',
  );
  if (blocking) {
    // A malformed fence (SOURCE_ERROR) is not a reconcilable disagreement;
    // the caller must fix the input before any activation attempt.
    return Object.freeze({ decision: 'reconcile', findings: fenceFindings });
  }
  return Object.freeze({
    decision: 'reconcile',
    findings: Object.freeze([
      ...fenceFindings,
      kernelFinding(
        'STAGED_ACTIVATION_SUPERSEDED',
        'ADVISORY',
        'Another operation changed the destination since this candidate expected its generation; this candidate reconciles instead of overwriting.',
        'Re-observe the destination and either re-stage against the new current generation or abandon this candidate.',
      ),
    ]),
  });
}
