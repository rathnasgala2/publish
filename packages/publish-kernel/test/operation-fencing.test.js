import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EXPECT_NOTHING_SERVED,
  checkConcurrencyFence,
  checkIdentitySyntax,
  decideIdempotency,
} from '../src/index.js';
import { first } from './helpers.js';

const ID_A = '019c0000-0000-7000-8000-000000000001';
const ID_B = '019c0000-0000-7000-8000-000000000002';
const DIGEST_A = 'sha256:aaaa';
const DIGEST_B = 'sha256:bbbb';

test('checkIdentitySyntax accepts a canonical lowercase UUIDv7', () => {
  assert.deepEqual(checkIdentitySyntax('operationId', ID_A), []);
});

test('checkIdentitySyntax rejects a non-UUIDv7 value', () => {
  const findings = checkIdentitySyntax('operationId', 'not-a-uuid');
  assert.equal(findings.length, 1);
  assert.equal(first(findings).code, 'OPERATION_IDENTITY_INVALID');
  assert.equal(first(findings).severity, 'SOURCE_ERROR');
});

test('checkIdentitySyntax rejects an uppercase UUID (case-sensitive)', () => {
  assert.equal(checkIdentitySyntax('x', ID_A.toUpperCase()).length, 1);
});

test('decideIdempotency: brand-new key is "new"', () => {
  const decision = decideIdempotency([], {
    operationId: ID_A,
    attemptId: ID_A,
    idempotencyKey: ID_A,
    artifactDigest: DIGEST_A,
  });
  assert.equal(decision.status, 'new');
  assert.deepEqual(decision.findings, []);
});

test('decideIdempotency: exact replay (same operationId, same digest) is idempotent', () => {
  const prior = {
    operationId: ID_A,
    attemptId: ID_A,
    idempotencyKey: ID_A,
    artifactDigest: DIGEST_A,
  };
  const decision = decideIdempotency([prior], prior);
  assert.equal(decision.status, 'idempotent-replay');
  assert.deepEqual(decision.matched, prior);
});

test('decideIdempotency: same key and bytes, different operationId, is still idempotent replay', () => {
  const prior = {
    operationId: ID_A,
    attemptId: ID_A,
    idempotencyKey: ID_A,
    artifactDigest: DIGEST_A,
  };
  const retried = {
    operationId: ID_B,
    attemptId: ID_B,
    idempotencyKey: ID_A,
    artifactDigest: DIGEST_A,
  };
  const decision = decideIdempotency([prior], retried);
  assert.equal(decision.status, 'idempotent-replay');
});

test('decideIdempotency: same key, different bytes, is a conflict', () => {
  const prior = {
    operationId: ID_A,
    attemptId: ID_A,
    idempotencyKey: ID_A,
    artifactDigest: DIGEST_A,
  };
  const conflicting = {
    operationId: ID_B,
    attemptId: ID_B,
    idempotencyKey: ID_A,
    artifactDigest: DIGEST_B,
  };
  const decision = decideIdempotency([prior], conflicting);
  assert.equal(decision.status, 'conflict');
  assert.equal(first(decision.findings).code, 'IDEMPOTENCY_KEY_REUSE_CONFLICT');
  assert.equal(first(decision.findings).severity, 'ARTIFACT_SAFETY_ERROR');
});

test('decideIdempotency: a malformed identity is a conflict with a SOURCE_ERROR finding', () => {
  const decision = decideIdempotency([], {
    operationId: 'bad',
    attemptId: ID_A,
    idempotencyKey: ID_A,
    artifactDigest: DIGEST_A,
  });
  assert.equal(decision.status, 'conflict');
  assert.ok(decision.findings.every((f) => f.severity === 'SOURCE_ERROR'));
});

test('checkConcurrencyFence: none and best-effort never fence', () => {
  assert.deepEqual(checkConcurrencyFence({ concurrency: 'none' }), []);
  assert.deepEqual(checkConcurrencyFence({ concurrency: 'best-effort' }), []);
});

test('checkConcurrencyFence: LOCAL-47 - a missing observation refuses instead of silently proceeding', () => {
  // Before LOCAL-47 an absent `observedGenerationId` meant "nothing to
  // compare against, proceed": a caller that had never observed the
  // destination was admitted past a fencing concurrency class entirely
  // unfenced. "Nothing is served" is now an observation, written `null`.
  const findings = checkConcurrencyFence({
    concurrency: 'expected-generation',
    expectedGenerationId: ID_A,
  });
  assert.equal(first(findings).code, 'CONCURRENCY_FENCE_OBSERVATION_MISSING');
  assert.equal(first(findings).severity, 'SOURCE_ERROR');
});

test('checkConcurrencyFence: LOCAL-47 - a null expectation is an invalid fence identity, not an unfenced publish', () => {
  for (const expectedGenerationId of [null, '', 0, {}]) {
    const findings = checkConcurrencyFence({
      concurrency: 'expected-generation',
      expectedGenerationId: /** @type {any} */ (expectedGenerationId),
      observedGenerationId: ID_A,
    });
    assert.equal(
      first(findings).code,
      'CONCURRENCY_FENCE_IDENTITY_INVALID',
      `${JSON.stringify(expectedGenerationId)} must be refused`,
    );
    assert.equal(first(findings).severity, 'SOURCE_ERROR');
    assert.match(first(findings).detail, /LOCAL-47/u);
  }
});

test('checkConcurrencyFence: LOCAL-47 - EXPECT_NOTHING_SERVED admits an empty destination and fences a served one', () => {
  assert.deepEqual(
    checkConcurrencyFence({
      concurrency: 'expected-generation',
      expectedGenerationId: EXPECT_NOTHING_SERVED,
      observedGenerationId: null,
    }),
    [],
  );

  const findings = checkConcurrencyFence({
    concurrency: 'expected-generation',
    expectedGenerationId: EXPECT_NOTHING_SERVED,
    observedGenerationId: ID_A,
  });
  assert.equal(first(findings).code, 'CONCURRENCY_FENCE_STALE_EXPECTATION');
  assert.equal(first(findings).severity, 'TARGET_CONSTRAINT_ERROR');
});

test('checkConcurrencyFence: a generation expectation is not satisfied by a destination serving nothing', () => {
  const findings = checkConcurrencyFence({
    concurrency: 'expected-generation',
    expectedGenerationId: ID_A,
    observedGenerationId: null,
  });
  assert.equal(first(findings).code, 'CONCURRENCY_FENCE_STALE_EXPECTATION');
});

test('checkConcurrencyFence: expected-generation requires an expectation', () => {
  const findings = checkConcurrencyFence({
    concurrency: 'expected-generation',
    observedGenerationId: null,
  });
  assert.equal(first(findings).code, 'CONCURRENCY_FENCE_IDENTITY_INVALID');
  assert.equal(first(findings).severity, 'SOURCE_ERROR');
});

test('checkConcurrencyFence: matching expectation and observation proceeds', () => {
  const findings = checkConcurrencyFence({
    concurrency: 'expected-generation',
    expectedGenerationId: ID_A,
    observedGenerationId: ID_A,
  });
  assert.deepEqual(findings, []);
});

test('checkConcurrencyFence: stale expectation is a TARGET_CONSTRAINT_ERROR, never a blind proceed', () => {
  const findings = checkConcurrencyFence({
    concurrency: 'expected-generation',
    expectedGenerationId: ID_A,
    observedGenerationId: ID_B,
  });
  assert.equal(first(findings).code, 'CONCURRENCY_FENCE_STALE_EXPECTATION');
  assert.equal(first(findings).severity, 'TARGET_CONSTRAINT_ERROR');
});

test('checkConcurrencyFence: provider-etag behaves like expected-generation', () => {
  const findings = checkConcurrencyFence({
    concurrency: 'provider-etag',
    expectedGenerationId: ID_A,
    observedGenerationId: ID_B,
  });
  assert.equal(first(findings).code, 'CONCURRENCY_FENCE_STALE_EXPECTATION');
});

test('property: a journal of N distinct keys never conflicts with a fresh (N+1)th key', () => {
  /** @type {import('../src/operation-fencing.js').JournaledOperation[]} */
  const journal = [];
  for (let i = 0; i < 25; i += 1) {
    journal.push({
      operationId: ID_A,
      attemptId: ID_A,
      idempotencyKey: `019c0000-0000-7000-8000-${String(i).padStart(12, '0')}`,
      artifactDigest: DIGEST_A,
    });
  }
  const fresh = {
    operationId: ID_A,
    attemptId: ID_A,
    idempotencyKey: '019c0000-0000-7000-8000-000000000099',
    artifactDigest: DIGEST_B,
  };
  assert.equal(decideIdempotency(journal, fresh).status, 'new');
});
