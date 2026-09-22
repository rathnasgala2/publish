import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EXPECT_NOTHING_SERVED, decideStagedActivation } from '../src/index.js';

const ID_A = '019c0000-0000-7000-8000-000000000001';
const ID_B = '019c0000-0000-7000-8000-000000000002';

test('activates when concurrency imposes no fence', () => {
  const decision = decideStagedActivation({ concurrency: 'none' });
  assert.equal(decision.decision, 'activate');
  assert.deepEqual(decision.findings, []);
});

test('activates when the expected generation matches the observed generation', () => {
  const decision = decideStagedActivation({
    concurrency: 'expected-generation',
    expectedGenerationId: ID_A,
    observedGenerationId: ID_A,
  });
  assert.equal(decision.decision, 'activate');
});

test('reconciles, never overwrites, when the destination changed since preflight', () => {
  const decision = decideStagedActivation({
    concurrency: 'expected-generation',
    expectedGenerationId: ID_A,
    observedGenerationId: ID_B,
  });
  assert.equal(decision.decision, 'reconcile');
  assert.ok(
    decision.findings.some((f) => f.code === 'STAGED_ACTIVATION_SUPERSEDED'),
  );
  assert.ok(
    decision.findings.some(
      (f) => f.code === 'CONCURRENCY_FENCE_STALE_EXPECTATION',
    ),
  );
});

test('reconciles (never activates) on a malformed fence input, without claiming supersession', () => {
  const decision = decideStagedActivation({
    concurrency: 'expected-generation',
    observedGenerationId: null,
  });
  assert.equal(decision.decision, 'reconcile');
  assert.ok(
    !decision.findings.some((f) => f.code === 'STAGED_ACTIVATION_SUPERSEDED'),
  );
});

test('LOCAL-47: a first publish states EXPECT_NOTHING_SERVED and activates only if nothing is served', () => {
  const emptyDestination = decideStagedActivation({
    concurrency: 'expected-generation',
    expectedGenerationId: EXPECT_NOTHING_SERVED,
    observedGenerationId: null,
  });
  assert.equal(emptyDestination.decision, 'activate');
  assert.deepEqual(emptyDestination.findings, []);

  // The exact bug LOCAL-47 closes: the same "this is a first publish"
  // expectation against a destination that is in fact already serving a
  // generation must reconcile, never overwrite.
  const alreadyServed = decideStagedActivation({
    concurrency: 'expected-generation',
    expectedGenerationId: EXPECT_NOTHING_SERVED,
    observedGenerationId: ID_B,
  });
  assert.equal(alreadyServed.decision, 'reconcile');
  assert.ok(
    alreadyServed.findings.some(
      (f) => f.code === 'CONCURRENCY_FENCE_STALE_EXPECTATION',
    ),
  );
  assert.ok(
    alreadyServed.findings.some(
      (f) => f.code === 'STAGED_ACTIVATION_SUPERSEDED',
    ),
  );
});

test('LOCAL-47: a null expectation reconciles as a malformed fence, never activates unfenced', () => {
  const decision = decideStagedActivation({
    concurrency: 'expected-generation',
    expectedGenerationId: /** @type {any} */ (null),
    observedGenerationId: ID_A,
  });
  assert.equal(decision.decision, 'reconcile');
  assert.ok(
    decision.findings.some(
      (f) => f.code === 'CONCURRENCY_FENCE_IDENTITY_INVALID',
    ),
  );
});

test('property: decision is never "activate" whenever any finding is TARGET_CONSTRAINT_ERROR', () => {
  /** @type {readonly import('../src/operation-fencing.js').ConcurrencyFenceInput[]} */
  const cases = [
    { concurrency: 'none' },
    { concurrency: 'best-effort' },
    {
      concurrency: 'expected-generation',
      expectedGenerationId: EXPECT_NOTHING_SERVED,
      observedGenerationId: null,
    },
    {
      concurrency: 'expected-generation',
      expectedGenerationId: ID_A,
      observedGenerationId: ID_A,
    },
    {
      concurrency: 'expected-generation',
      expectedGenerationId: ID_A,
      observedGenerationId: ID_B,
    },
  ];
  for (const fence of cases) {
    const decision = decideStagedActivation(fence);
    const hasFenceError = decision.findings.some(
      (f) => f.code === 'CONCURRENCY_FENCE_STALE_EXPECTATION',
    );
    if (hasFenceError) {
      assert.equal(decision.decision, 'reconcile');
    }
  }
});
