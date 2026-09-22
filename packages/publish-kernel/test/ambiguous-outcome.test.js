import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkNoBlindRetry, classifyMutationOutcome } from '../src/index.js';
import { first } from './helpers.js';

test('an unattempted call is safely retryable', () => {
  const result = classifyMutationOutcome({
    attempted: false,
    providerResponded: false,
    timedOut: false,
  });
  assert.equal(result.disposition, 'not-attempted-retryable');
  assert.deepEqual(result.findings, []);
});

test('an attempted call with a definitive provider response is a success', () => {
  const result = classifyMutationOutcome({
    attempted: true,
    providerResponded: true,
    timedOut: false,
  });
  assert.equal(result.disposition, 'succeeded');
  assert.deepEqual(result.findings, []);
});

test('a timed-out call with no provider response is unknown-reconciling, never a false failure', () => {
  const result = classifyMutationOutcome({
    attempted: true,
    providerResponded: false,
    timedOut: true,
  });
  assert.equal(result.disposition, 'unknown-reconciling');
  assert.equal(first(result.findings).code, 'UNKNOWN_RECONCILING');
  assert.equal(first(result.findings).severity, 'WARNING');
});

test('an attempted call with no response and no timeout flag is still unknown-reconciling', () => {
  const result = classifyMutationOutcome({
    attempted: true,
    providerResponded: false,
    timedOut: false,
  });
  assert.equal(result.disposition, 'unknown-reconciling');
});

test('checkNoBlindRetry blocks a fresh mutation while the prior one is unresolved', () => {
  const findings = checkNoBlindRetry('unknown-reconciling');
  assert.equal(first(findings).code, 'UNKNOWN_RECONCILING_RETRY_BLOCKED');
  assert.equal(first(findings).severity, 'ARTIFACT_SAFETY_ERROR');
});

test('checkNoBlindRetry admits a fresh mutation once the prior disposition resolved', () => {
  /** @type {readonly (import('../src/ambiguous-outcome.js').MutationDisposition | null)[]} */
  const dispositions = ['succeeded', 'not-attempted-retryable', null];
  for (const disposition of dispositions) {
    assert.deepEqual(checkNoBlindRetry(disposition), []);
  }
});

test('property: disposition is never "succeeded" unless providerResponded is true', () => {
  const bools = [true, false];
  for (const attempted of bools) {
    for (const providerResponded of bools) {
      for (const timedOut of bools) {
        const result = classifyMutationOutcome({
          attempted,
          providerResponded,
          timedOut,
        });
        if (result.disposition === 'succeeded') {
          assert.equal(attempted, true);
          assert.equal(providerResponded, true);
        }
      }
    }
  }
});
