# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-22

### Changed

- The stale-expectation activation case fences with a well-formed UUIDv7 that is
  not the served generation (PUBLISH-S4-5): the protocol helper now refuses free
  text, so `'not-the-real-current-generation'` would prove a refusal, not a
  `reconcile`.

- **Breaking for adapters under test (LOCAL-47, adapter protocol `2.1.0`):**
  every `activate` call the suite makes now passes `EXPECT_NOTHING_SERVED` where
  it used to pass `null`. An adapter that still reads `null` as "no fence" fails
  the suite.

### Added

- Two normative conformance cases every adapter must now satisfy:
  - `activate` with `expectedCurrentGenerationId: null` must **reject** (with a
    diagnostic naming `EXPECTED_GENERATION_FENCE_INVALID` or the field) and must
    publish nothing.
  - `activate` with `EXPECT_NOTHING_SERVED` against a destination that is
    already serving a generation must return `decision: 'reconcile'` and leave
    the served generation byte-intact and verifiable.
- `broken-fake-adapter.js` gained the matching deliberate defect (the abolished
  `!== null` guard) and `suite-catches-broken-adapter.test.js` now asserts the
  null-fence case is among the child run's failures, so the new cases are proven
  non-vacuous.
- Initial reusable adapter conformance suite (S2-T17): lifecycle shape,
  capability truthfulness, staging privacy, activation atomicity/replace
  semantics, observe/verify, staged-state cleanup, rollback, idempotent re-run,
  and tamper detection.
- A genuine interrupted-activation test (`simulateInterruptedActivation`): a
  real thrown error from an adapter-specific crash-injection hook between
  "staging durably committed" and "the activation pointer moves" must leave the
  previously served generation intact, and `cleanupStaged` recovery must remove
  the abandoned candidate.
- `test/suite-catches-broken-adapter.test.js`: a standing regression test that
  runs this suite, in an isolated child `node --test` process, against a
  deliberately broken fake adapter and asserts that run fails — guarding against
  a future vacuously-passing assertion.

### Fixed

- The digest-mismatch activation-refusal test placed `assert.fail` inside the
  same `try` its `catch` guarded, so `assert.fail`'s own message (which happened
  to contain "digest") satisfied the catch block's loose message match even when
  `activate` never threw — the suite passed even against an adapter with no
  integrity checking at all. Restructured with `assert.rejects` and renamed to
  describe what it actually tests. Audited every other assertion in the kit for
  the same pattern; none other used a `catch` block at all (S2-T17 review fix).
- `generateUuidV7` moved to `@rathnasgala2/adapter-protocol` (both this package
  and `adapter-local-directory` already depended on it), removing the duplicate
  implementation (S2-T17 review fix).
