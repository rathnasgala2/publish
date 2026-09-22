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
export function decideStagedActivation(fence: import("./operation-fencing.js").ConcurrencyFenceInput): ActivationDecision;
export type ActivationDecision = Readonly<{
    decision: "activate" | "reconcile";
    findings: readonly import("./errors.js").KernelFinding[];
}>;
