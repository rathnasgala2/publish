# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **PUB-M11:** the manifest declares `"sideEffects": false`, so a bundler can
  tree-shake an unused re-export from this package's barrel entry point instead
  of conservatively retaining the whole thing.
- **PUB-M3:** `canonicalizeJson` now throws a `TypeError` for a value whose
  prototype is neither `Object.prototype` nor `null` (a `Date`, `Map`, `Set` or
  class instance), instead of silently canonicalizing it as `{}` via
  `Object.keys`. Every DEC-097 contract digest in this repository is built from
  this primitive, so a `Date`-bearing record (the most likely mistake, given how
  many records carry timestamps) previously produced a well-formed, stable,
  wrong digest with no diagnostic.
- **PUB-M4:** the property tests in `test/digest.test.js`,
  `test/capability-vocabulary.test.js` and `test/frame.test.js` now draw from a
  seeded PRNG (`test/helpers/seeded-random.js`) instead of bare `Math.random()`,
  printing the seed as a test diagnostic so a CI failure can be replayed with
  `TEST_SEED=<seed>`. The two key-order/set-equality properties that used
  `array.toSorted(() => Math.random() - 0.5)` — a comparator-as-shuffle that is
  non-uniform and, for small arrays, often returns the input order unchanged —
  now use an unbiased Fisher-Yates shuffle, plus a new deterministic
  reverse-order case that proves the property at least once independent of any
  PRNG outcome.
- **PUB-M5:** `computeArtifactDigest`, `projectArtifactEntry` and
  `ARTIFACT_DIGEST_DOMAIN` are now exported. This is the single implementation
  of the DEC-097 section 8 `GALA-ARTIFACT-V2 ` artifact digest;
  `adapter-local-directory`, `adapter-github-pages` and `adapter-do-spaces` each
  delegate to it instead of restating the path-sort-and-hash formula
  independently.

## [0.2.0] - 2026-09-22

### Changed

- **`requireGenerationFence` is no looser than the wire (PUBLISH-S4-5).** The
  helper now admits exactly the schema's activation fence — a lowercase UUIDv7
  `stableId` or `EXPECT_NOTHING_SERVED` — and refuses any other string with
  `EXPECTED_GENERATION_FENCE_INVALID`, where it used to accept any non-empty
  text. `GENERATION_ID_PATTERN` is exported as the exact shape. A caller that
  fenced with free text never fenced against anything a destination could be
  observed serving; it only ever produced a silent `reconcile`.

### Added

- The mandatory eight-function adapter lifecycle interface and `defineAdapter`
  validation (`lifecycle.js`).
- The closed lower-case capability vocabulary and the exact `local-directory` /
  `github-pages` / `do-spaces` three-row admission table
  (`capability-vocabulary.js`, DEC-097 section 7).
- Capability declaration validation against `@rathnasgala2/schemas`' exported
  validator plus a local exact-row truthfulness check (`capability.js`).
- Filesystem/HTTP provider limit-profile discrimination (`limits.js`).
- RFC 8785 JCS canonicalization and domain-separated SHA-256 digest primitives
  (`digest.js`).
- An in-process frame/message contract enforcing the DEC-086 1,048,576-byte
  ceiling (`frame.js`).
- In-process adapter loading (`loader.js`).
- Capability negotiation producing an evidence-bearing decision, and a
  `TARGET_CAPABILITY_UNAVAILABLE` pre-stage refusal helper (`negotiation.js`).

(S2-T15)

- `generateUuidV7()` (`uuid.js`), moved here from `adapter-local-directory` and
  `adapter-conformance-kit` (both already depend on this package) to remove the
  duplicate implementation (S2-T17 review fix).
