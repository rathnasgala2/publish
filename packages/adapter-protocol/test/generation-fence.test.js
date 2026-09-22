/**
 * LOCAL-47: `expectedCurrentGenerationId: null` must not disable the
 * activation fence. These tests pin the replacement contract: `null` and
 * `undefined` are refused outright, and the explicit sentinel fences
 * against a destination that is already serving something.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADAPTER_PROTOCOL_VERSION,
  AdapterProtocolError,
  EXPECT_NOTHING_SERVED,
  fenceDisagrees,
  fenceFor,
  GENERATION_ID_PATTERN,
  requireGenerationFence,
} from '../src/index.js';

test('the protocol version records the fence-sentinel revision', () => {
  assert.equal(ADAPTER_PROTOCOL_VERSION, '2.1.0');
});

test('the sentinel cannot be confused with a generation identity', () => {
  assert.equal(EXPECT_NOTHING_SERVED, 'gala:expect-nothing-served');
  assert.match(EXPECT_NOTHING_SERVED, /^gala:/u);
});

test('null is refused rather than silently disabling the fence', () => {
  assert.throws(
    () => requireGenerationFence(null, 'do-spaces'),
    (error) => {
      assert.ok(error instanceof AdapterProtocolError);
      const [first] = error.findings;
      assert.ok(first !== undefined, 'the refusal carries a typed finding');
      assert.equal(first.code, 'EXPECTED_GENERATION_FENCE_INVALID');
      assert.match(first.detail, /LOCAL-47/u);
      return true;
    },
  );
});

test('undefined, the empty string and a non-string are refused too', () => {
  for (const value of [undefined, '', 0, false, {}, []]) {
    assert.throws(
      () => requireGenerationFence(value),
      /EXPECTED_GENERATION_FENCE_INVALID|expectedCurrentGenerationId/u,
      `${JSON.stringify(value)} must be refused`,
    );
  }
});

test('a fence value that is not a UUIDv7 generation identity is refused, exactly like the wire', () => {
  // The schema's activation fence is `oneOf(stableId, sentinel)`; a helper
  // looser than that would accept a value no destination could ever have
  // been observed serving and turn it into a silent `reconcile`.
  for (const value of [
    'not-the-real-current-generation',
    '01920000-0000-4000-8000-000000000001', // version 4, not 7
    '01920000-0000-7000-c000-000000000001', // variant c
    '01920000-0000-7000-8000-00000000000G',
    '01920000000070008000000000000001',
    'GALA:EXPECT-NOTHING-SERVED',
    ' 01920000-0000-7000-8000-000000000001',
  ]) {
    assert.throws(
      () => requireGenerationFence(value, 'github-pages'),
      (error) => {
        assert.ok(error instanceof AdapterProtocolError);
        assert.equal(
          error.findings[0]?.code,
          'EXPECTED_GENERATION_FENCE_INVALID',
        );
        return true;
      },
      `${JSON.stringify(value)} must be refused`,
    );
  }
  assert.match('01920000-0000-7000-8000-000000000001', GENERATION_ID_PATTERN);
  assert.doesNotMatch(EXPECT_NOTHING_SERVED, GENERATION_ID_PATTERN);
});

test('the sentinel fences against a pre-existing generation', () => {
  const fence = requireGenerationFence(EXPECT_NOTHING_SERVED);
  assert.deepEqual(
    { ...fence },
    {
      expectsNothingServed: true,
      generationId: null,
    },
  );
  assert.equal(fenceDisagrees(fence, null), false);
  assert.equal(
    fenceDisagrees(fence, '01920000-0000-7000-8000-000000000001'),
    true,
  );
});

test('a generation fence agrees only with that exact generation', () => {
  const fence = requireGenerationFence('01920000-0000-7000-8000-000000000001');
  assert.equal(fence.expectsNothingServed, false);
  assert.equal(
    fenceDisagrees(fence, '01920000-0000-7000-8000-000000000001'),
    false,
  );
  assert.equal(fenceDisagrees(fence, null), true);
  assert.equal(
    fenceDisagrees(fence, '01920000-0000-7000-8000-000000000002'),
    true,
  );
});

test('fenceFor maps an observed destination state onto the fence vocabulary', () => {
  assert.equal(fenceFor(null), EXPECT_NOTHING_SERVED);
  assert.equal(fenceFor(undefined), EXPECT_NOTHING_SERVED);
  assert.equal(
    fenceFor('01920000-0000-7000-8000-000000000003'),
    '01920000-0000-7000-8000-000000000003',
  );
});
