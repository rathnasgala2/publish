/**
 * Duty 6: "Operation identity, idempotency and concurrency fencing: reject
 * invalid operation or fence identity, and reject reuse of one idempotency
 * identity for different bytes. A repeated identical operation is
 * idempotent."
 *
 * The kernel keeps no ambient state of its own (no cwd, no environment, no
 * network, no hidden module-level cache): a caller supplies the prior
 * operation journal explicitly, and this module is a pure function over
 * that journal plus the candidate operation.
 *
 * @module
 */

import {
  ADAPTER_PROTOCOL_VERSION,
  EXPECT_NOTHING_SERVED,
  fenceDisagrees,
  requireGenerationFence,
} from '@rathnasgala2/adapter-protocol';

import { kernelFinding } from './errors.js';

const STABLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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
export function checkIdentitySyntax(field, value) {
  if (typeof value === 'string' && STABLE_ID_PATTERN.test(value)) {
    return Object.freeze([]);
  }
  return Object.freeze([
    kernelFinding(
      'OPERATION_IDENTITY_INVALID',
      'SOURCE_ERROR',
      `Field "${field}" is not a well-formed identity: ${JSON.stringify(value)}.`,
      'Supply a lowercase canonical UUIDv7 for this field.',
      { location: `/${field}` },
    ),
  ]);
}

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
export function decideIdempotency(journal, candidate) {
  const identityFindings = [
    ...checkIdentitySyntax('operationId', candidate.operationId),
    ...checkIdentitySyntax('attemptId', candidate.attemptId),
    ...checkIdentitySyntax('idempotencyKey', candidate.idempotencyKey),
  ];
  if (identityFindings.length > 0) {
    return Object.freeze({
      status: 'conflict',
      findings: Object.freeze(identityFindings),
    });
  }

  const priorSameKey = journal.filter(
    (entry) => entry.idempotencyKey === candidate.idempotencyKey,
  );
  if (priorSameKey.length === 0) {
    return Object.freeze({ status: 'new', findings: Object.freeze([]) });
  }

  const exactReplay = priorSameKey.find(
    (entry) =>
      entry.artifactDigest === candidate.artifactDigest &&
      entry.operationId === candidate.operationId,
  );
  if (exactReplay !== undefined) {
    return Object.freeze({
      status: 'idempotent-replay',
      findings: Object.freeze([]),
      matched: exactReplay,
    });
  }

  const conflicting = priorSameKey.find(
    (entry) => entry.artifactDigest !== candidate.artifactDigest,
  );
  if (conflicting !== undefined) {
    return Object.freeze({
      status: 'conflict',
      findings: Object.freeze([
        kernelFinding(
          'IDEMPOTENCY_KEY_REUSE_CONFLICT',
          'ARTIFACT_SAFETY_ERROR',
          `Idempotency key "${candidate.idempotencyKey}" was already used for artifact digest ${JSON.stringify(
            conflicting.artifactDigest,
          )}; a candidate with digest ${JSON.stringify(candidate.artifactDigest)} cannot reuse it.`,
          'Issue a fresh idempotency key for the new artifact bytes; an idempotency key names exactly one artifact identity for its lifetime.',
          { location: '/idempotencyKey' },
        ),
      ]),
      matched: conflicting,
    });
  }

  // Same key, same bytes, different operationId: still an idempotent replay
  // of the same underlying intent (a retried operation submission).
  return Object.freeze({
    status: 'idempotent-replay',
    findings: Object.freeze([]),
    matched: /** @type {JournaledOperation} */ (priorSameKey[0]),
  });
}

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
export function checkConcurrencyFence(input) {
  if (input.concurrency === 'none' || input.concurrency === 'best-effort') {
    return Object.freeze([]);
  }

  /** @type {{expectsNothingServed: boolean, generationId: string | null}} */
  let fence;
  try {
    fence = requireGenerationFence(
      input.expectedGenerationId,
      'publish-kernel',
    );
  } catch {
    return Object.freeze([
      kernelFinding(
        'CONCURRENCY_FENCE_IDENTITY_INVALID',
        'SOURCE_ERROR',
        `Concurrency class "${input.concurrency}" requires an expected generation identity or the ${JSON.stringify(EXPECT_NOTHING_SERVED)} sentinel; received ${JSON.stringify(input.expectedGenerationId) ?? String(input.expectedGenerationId)}. Adapter protocol ${ADAPTER_PROTOCOL_VERSION} has no fence value that means "no expectation" (LOCAL-47).`,
        `Preflight must resolve and record the currently observed generation before staging under this concurrency class; when it observes that nothing is served, state that explicitly with ${JSON.stringify(EXPECT_NOTHING_SERVED)} rather than omitting the expectation.`,
        { location: '/fence/expectedGenerationId' },
      ),
    ]);
  }

  if (input.observedGenerationId === undefined) {
    // A missing observation must never disable the fence: the caller that
    // has not observed the destination cannot be admitted past a fencing
    // concurrency class at all (LOCAL-47). "Nothing is served" is an
    // observation, and is written `null`.
    return Object.freeze([
      kernelFinding(
        'CONCURRENCY_FENCE_OBSERVATION_MISSING',
        'SOURCE_ERROR',
        `Concurrency class "${input.concurrency}" requires the destination's currently observed generation; none was supplied.`,
        'Re-run preflight and pass its observation as `observedGenerationId` — a generation identity, or `null` when the destination serves nothing. Omitting it is not an unfenced publish.',
        { location: '/fence/observedGenerationId' },
      ),
    ]);
  }

  if (fenceDisagrees(fence, input.observedGenerationId)) {
    return Object.freeze([
      kernelFinding(
        'CONCURRENCY_FENCE_STALE_EXPECTATION',
        'TARGET_CONSTRAINT_ERROR',
        `Expected generation ${JSON.stringify(input.expectedGenerationId)} disagrees with the destination's currently observed generation ${JSON.stringify(input.observedGenerationId)}.`,
        'Re-run preflight to observe the current generation, then reconcile or issue a new operation rather than overwriting blindly.',
      ),
    ]);
  }
  return Object.freeze([]);
}
