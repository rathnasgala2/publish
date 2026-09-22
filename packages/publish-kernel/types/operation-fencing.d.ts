/**
 * @typedef {Readonly<{
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   artifactDigest: string
 * }>} JournaledOperation
 */
/**
 * @typedef {Readonly<{
 *   status: 'new' | 'idempotent-replay' | 'conflict',
 *   findings: readonly import('./errors.js').KernelFinding[],
 *   matched?: JournaledOperation
 * }>} IdempotencyDecision
 */
/**
 * Validate that an identity string is a syntactically well-formed stable
 * identifier (lowercase canonical UUIDv7).
 *
 * @param {string} field the field name, used only in the finding detail
 * @param {unknown} value candidate identity value
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when the
 *   value is a well-formed identity
 */
export function checkIdentitySyntax(field: string, value: unknown): readonly import("./errors.js").KernelFinding[];
/**
 * Decide whether a candidate operation is new, an idempotent replay of an
 * already-journaled operation, or a conflicting reuse of one idempotency
 * key against different artifact bytes.
 *
 * @param {readonly JournaledOperation[]} journal the prior operation
 *   journal, supplied explicitly by the caller
 * @param {JournaledOperation} candidate the candidate operation
 * @returns {IdempotencyDecision} the fencing decision
 */
export function decideIdempotency(journal: readonly JournaledOperation[], candidate: JournaledOperation): IdempotencyDecision;
/**
 * The concurrency fence a mutating operation is evaluated under.
 *
 * `expectedGenerationId` is the adapter protocol's activation fence value:
 * a generation identity, or {@link EXPECT_NOTHING_SERVED} when the caller
 * expects the destination to be serving nothing at all. `null` is not a
 * member of that vocabulary (LOCAL-47) and neither is any other
 * non-generation string.
 *
 * `observedGenerationId` is what the destination was actually observed to
 * be serving: a generation identity, or `null` when it serves none. It is
 * mandatory under a fencing concurrency class — a missing observation is a
 * `SOURCE_ERROR`, never a silent proceed.
 *
 * @typedef {Readonly<{
 *   concurrency: 'none' | 'best-effort' | 'expected-generation' | 'provider-etag',
 *   expectedGenerationId?: string,
 *   observedGenerationId?: string | null
 * }>} ConcurrencyFenceInput
 */
/**
 * Check a concurrency fence: under `expected-generation` (and, identically,
 * `provider-etag`, which the S2 adapter rows never declare but which this
 * function treats the same way for forward compatibility), the candidate's
 * expected generation must agree with the destination's currently observed
 * generation. `none` and `best-effort` impose no fence.
 *
 * The expectation is stated in the adapter protocol's fence vocabulary
 * (protocol `2.1.0`, resolved with `requireGenerationFence` and
 * `fenceDisagrees` rather than re-implemented here), so there is no value —
 * neither `null` nor a missing observation —
 * that silently turns the fence off (LOCAL-47). A caller publishing to a
 * destination it believes serves nothing states that expectation with
 * {@link EXPECT_NOTHING_SERVED} and is genuinely fenced against a
 * destination that turns out to be serving something.
 *
 * @param {ConcurrencyFenceInput} input the concurrency class and the
 *   expected/observed generation identities
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when the
 *   fence admits the operation
 */
export function checkConcurrencyFence(input: ConcurrencyFenceInput): readonly import("./errors.js").KernelFinding[];
export type JournaledOperation = Readonly<{
    operationId: string;
    attemptId: string;
    idempotencyKey: string;
    artifactDigest: string;
}>;
export type IdempotencyDecision = Readonly<{
    status: "new" | "idempotent-replay" | "conflict";
    findings: readonly import("./errors.js").KernelFinding[];
    matched?: JournaledOperation;
}>;
/**
 * The concurrency fence a mutating operation is evaluated under.
 *
 * `expectedGenerationId` is the adapter protocol's activation fence value:
 * a generation identity, or {@link EXPECT_NOTHING_SERVED} when the caller
 * expects the destination to be serving nothing at all. `null` is not a
 * member of that vocabulary (LOCAL-47) and neither is any other
 * non-generation string.
 *
 * `observedGenerationId` is what the destination was actually observed to
 * be serving: a generation identity, or `null` when it serves none. It is
 * mandatory under a fencing concurrency class — a missing observation is a
 * `SOURCE_ERROR`, never a silent proceed.
 */
export type ConcurrencyFenceInput = Readonly<{
    concurrency: "none" | "best-effort" | "expected-generation" | "provider-etag";
    expectedGenerationId?: string;
    observedGenerationId?: string | null;
}>;
