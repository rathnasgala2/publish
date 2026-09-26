import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ARTIFACT_DIGEST_DOMAIN,
  canonicalizeJson,
  computeArtifactDigest,
  domainDigest,
  isDigestString,
  projectArtifactEntry,
  sha256Hex,
} from '../src/digest.js';
import {
  createSeededRandom,
  fisherYatesShuffle,
  pickSeed,
} from './helpers/seeded-random.js';

test('computeArtifactDigest matches domainDigest over the manually projected, path-sorted entry list', () => {
  const bBytes = Buffer.from('two', 'utf8');
  const aBytes = Buffer.from('one', 'utf8');
  const files = [
    { path: 'b.txt', bytes: bBytes },
    { path: 'a.txt', bytes: aBytes },
  ];
  const expected = domainDigest(ARTIFACT_DIGEST_DOMAIN, [
    projectArtifactEntry('a.txt', aBytes),
    projectArtifactEntry('b.txt', bBytes),
  ]);
  assert.equal(computeArtifactDigest(files), expected);
});

test('computeArtifactDigest is independent of input file order', () => {
  const files = [
    { path: 'a.txt', bytes: Buffer.from('one', 'utf8') },
    { path: 'b.txt', bytes: Buffer.from('two', 'utf8') },
  ];
  assert.equal(
    computeArtifactDigest(files),
    computeArtifactDigest([...files].reverse()),
  );
});

test('computeArtifactDigest of an empty file set is stable and non-empty', () => {
  assert.ok(isDigestString(computeArtifactDigest([])));
});

test('canonicalizeJson sorts object keys by UTF-16 code unit', () => {
  assert.equal(canonicalizeJson({ b: 1, a: 2, c: 3 }), '{"a":2,"b":1,"c":3}');
});

test('canonicalizeJson is stable regardless of input key order', () => {
  const first = canonicalizeJson({ zebra: 1, apple: 2, mango: 3 });
  const second = canonicalizeJson({ mango: 3, zebra: 1, apple: 2 });
  assert.equal(first, second);
});

test('canonicalizeJson omits undefined-valued keys', () => {
  assert.equal(canonicalizeJson({ a: 1, b: undefined }), '{"a":1}');
});

test('canonicalizeJson preserves array order', () => {
  assert.equal(canonicalizeJson([3, 1, 2]), '[3,1,2]');
});

test('canonicalizeJson emits primitives per the JSON grammar', () => {
  assert.equal(canonicalizeJson(null), 'null');
  assert.equal(canonicalizeJson(true), 'true');
  assert.equal(canonicalizeJson(false), 'false');
  assert.equal(canonicalizeJson('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(canonicalizeJson(0), '0');
  assert.equal(canonicalizeJson(-0), '0');
  assert.equal(canonicalizeJson(42), '42');
});

test('canonicalizeJson rejects non-finite numbers', () => {
  assert.throws(() => canonicalizeJson(Number.NaN), TypeError);
  assert.throws(() => canonicalizeJson(Number.POSITIVE_INFINITY), TypeError);
});

test('canonicalizeJson rejects a value with no JSON representation', () => {
  assert.throws(() => canonicalizeJson(() => {}), TypeError);
  assert.throws(() => canonicalizeJson(undefined), TypeError);
});

test('canonicalizeJson recurses through nested arrays and objects', () => {
  assert.equal(
    canonicalizeJson({ list: [{ b: 1, a: 2 }, 'x'] }),
    '{"list":[{"a":2,"b":1},"x"]}',
  );
});

test('domainDigest is deterministic for the same domain and value', () => {
  const value = { a: 1, b: [1, 2, 3] };
  const first = domainDigest('EXAMPLE-V1\0', value);
  const second = domainDigest('EXAMPLE-V1\0', value);
  assert.equal(first, second);
  assert.ok(isDigestString(first));
});

test('domainDigest changes when the domain separator changes', () => {
  const value = { a: 1 };
  const first = domainDigest('EXAMPLE-A\0', value);
  const second = domainDigest('EXAMPLE-B\0', value);
  assert.notEqual(first, second);
});

test('domainDigest changes when the value changes', () => {
  const first = domainDigest('EXAMPLE-V1\0', { a: 1 });
  const second = domainDigest('EXAMPLE-V1\0', { a: 2 });
  assert.notEqual(first, second);
});

test('domainDigest is insensitive to object key order (JCS canonicalization)', () => {
  const first = domainDigest('EXAMPLE-V1\0', { a: 1, b: 2 });
  const second = domainDigest('EXAMPLE-V1\0', { b: 2, a: 1 });
  assert.equal(first, second);
});

test('sha256Hex produces the well-known empty-string digest', () => {
  const digest = sha256Hex(Buffer.alloc(0));
  assert.equal(
    digest,
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('isDigestString accepts only sha256:<64 lowercase hex>', () => {
  assert.equal(
    isDigestString(
      'sha256:0000000000000000000000000000000000000000000000000000000000000001'.slice(
        0,
        71,
      ),
    ),
    true,
  );
  assert.equal(isDigestString('sha256:00'), false);
  assert.equal(isDigestString('SHA256:' + '0'.repeat(64)), false);
  assert.equal(isDigestString('not-a-digest'), false);
  assert.equal(isDigestString(42), false);
});

test('property: canonicalizeJson round-trips through JSON.parse to an equal value', (t) => {
  const seed = pickSeed();
  t.diagnostic(`seed=${seed} (rerun with TEST_SEED=${seed} to replay)`);
  const random = createSeededRandom(seed);
  for (let i = 0; i < 200; i += 1) {
    const value = randomJsonValue(3, random);
    const canonical = canonicalizeJson(value);
    assert.deepEqual(JSON.parse(canonical), stripUndefined(value));
  }
});

test('property: canonicalizeJson is invariant under key permutation', (t) => {
  const seed = pickSeed();
  t.diagnostic(`seed=${seed} (rerun with TEST_SEED=${seed} to replay)`);
  const random = createSeededRandom(seed);
  for (let i = 0; i < 200; i += 1) {
    const object = randomFlatObject(random);
    const shuffled = shuffleEntries(object, random);
    assert.equal(canonicalizeJson(object), canonicalizeJson(shuffled));
  }
});

test('property: canonicalizeJson is invariant under a known reverse key permutation', () => {
  // A deterministic case alongside the random one above, so the
  // order-independence property is proven at least once without relying on
  // any PRNG outcome.
  const object = { alpha: 1, beta: 2, gamma: 3, delta: 4, epsilon: 5 };
  const reversed = Object.fromEntries(Object.entries(object).reverse());
  assert.equal(canonicalizeJson(object), canonicalizeJson(reversed));
});

/**
 * @param {number} depth remaining recursion depth
 * @param {() => number} random a `Math.random`-shaped generator
 * @returns {unknown} a random JSON-compatible value
 */
function randomJsonValue(depth, random) {
  const choice = Math.floor(random() * (depth > 0 ? 5 : 3));
  switch (choice) {
    case 0:
      return Math.floor(random() * 1000) - 500;
    case 1:
      return random().toString(36).slice(2, 8);
    case 2:
      return random() > 0.5;
    case 3:
      return Array.from({ length: 3 }, () =>
        randomJsonValue(depth - 1, random),
      );
    default:
      return randomFlatObject(random);
  }
}

/**
 * @param {() => number} random a `Math.random`-shaped generator
 * @returns {Record<string, number>} a small random flat object
 */
function randomFlatObject(random) {
  /** @type {Record<string, number>} */
  const object = {};
  const keys = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  for (const key of keys) {
    if (random() > 0.3) {
      object[key] = Math.floor(random() * 100);
    }
  }
  return object;
}

/**
 * @param {Record<string, number>} object object to shuffle
 * @param {() => number} random a `Math.random`-shaped generator
 * @returns {Record<string, number>} a new object with the same entries in a
 *   randomized insertion order
 */
function shuffleEntries(object, random) {
  const entries = fisherYatesShuffle(Object.entries(object), random);
  return Object.fromEntries(entries);
}

/**
 * @param {unknown} value value to strip
 * @returns {unknown} value with undefined object members removed, matching
 *   what JSON.parse(canonicalizeJson(value)) can represent
 */
function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry));
  }
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        out[key] = stripUndefined(entry);
      }
    }
    return out;
  }
  return value;
}
