import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVATION,
  ADAPTER_CAPABILITY_ROWS,
  CACHE_INVALIDATION,
  CONCURRENCY,
  DESTINATION_KINDS,
  IDEMPOTENCY_CLASS,
  OPERATIONS,
  PROVIDER_INVENTORY_ASSURANCE,
  ROLLBACK,
  STAGING,
  VERIFICATION,
  isSameSet,
} from '../src/capability-vocabulary.js';

test('the destination-kind vocabulary is exactly the three admitted adapters', () => {
  assert.deepEqual([...DESTINATION_KINDS].sort(), [
    'do-spaces',
    'github-pages',
    'local-directory',
  ]);
});

test('rollback and cacheInvalidation are the closed single-value constants', () => {
  assert.equal(ROLLBACK, 'reupload');
  assert.equal(CACHE_INVALIDATION, 'none');
});

test('every closed vocabulary array is frozen', () => {
  for (const vocabulary of [
    DESTINATION_KINDS,
    OPERATIONS,
    STAGING,
    ACTIVATION,
    CONCURRENCY,
    IDEMPOTENCY_CLASS,
    VERIFICATION,
    PROVIDER_INVENTORY_ASSURANCE,
  ]) {
    assert.ok(Object.isFrozen(vocabulary));
  }
});

test('ADAPTER_CAPABILITY_ROWS has exactly the three admitted adapter identities', () => {
  assert.deepEqual(Object.keys(ADAPTER_CAPABILITY_ROWS).sort(), [
    'do-spaces',
    'github-pages',
    'local-directory',
  ]);
});

test('the do-spaces row is the sole row requiring notFoundBehavior: true', () => {
  for (const [adapterId, row] of Object.entries(ADAPTER_CAPABILITY_ROWS)) {
    assert.equal(row.notFoundBehavior, adapterId === 'do-spaces');
  }
});

test('every row declares rollback-equivalent behavior only through the closed set', () => {
  for (const row of Object.values(ADAPTER_CAPABILITY_ROWS)) {
    assert.ok(STAGING.includes(row.staging));
    assert.ok(ACTIVATION.includes(row.activation));
    assert.ok(CONCURRENCY.includes(row.concurrency));
    assert.ok(IDEMPOTENCY_CLASS.includes(row.idempotencyClass));
    assert.ok(
      PROVIDER_INVENTORY_ASSURANCE.includes(row.providerInventoryAssurance),
    );
    for (const capability of row.verification) {
      assert.ok(VERIFICATION.includes(capability));
    }
  }
});

test('isSameSet ignores order', () => {
  assert.equal(isSameSet(['a', 'b', 'c'], ['c', 'a', 'b']), true);
});

test('isSameSet rejects a different length', () => {
  assert.equal(isSameSet(['a', 'b'], ['a', 'b', 'c']), false);
});

test('isSameSet rejects a different membership at equal length', () => {
  assert.equal(isSameSet(['a', 'b'], ['a', 'c']), false);
});

test('property: isSameSet(x, shuffle(x)) is always true', () => {
  for (let trial = 0; trial < 100; trial += 1) {
    const base = [
      'inspect',
      'stage',
      'activate',
      'observe',
      'cleanup-staged',
      'rollback',
    ];
    const shuffled = base.toSorted(() => Math.random() - 0.5);
    assert.equal(isSameSet(base, shuffled), true);
  }
});

test('property: isSameSet is false whenever one member is swapped out', () => {
  const alphabet = ['p', 'q', 'r', 's', 't', 'u', 'v'];
  for (let trial = 0; trial < 100; trial += 1) {
    const base = OPERATIONS.slice(0, 4);
    const replaceIndex = Math.floor(Math.random() * base.length);
    const replacement =
      alphabet[Math.floor(Math.random() * alphabet.length)] ?? 'p';
    const mutated = base.map((value, index) =>
      index === replaceIndex ? replacement : value,
    );
    assert.equal(isSameSet(base, mutated), mutated.join() === base.join());
  }
});
