# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-22

### Changed

- **PUBLISH-S4-6a — `ADAPTER_VERSION` is the installed package version.**
  DEC-097 section 3 requires the capability document's `adapter.adapterVersion`
  to byte-equal the locked package version, so the constant is now read from
  this package's own `package.json` (`0.1.0`) instead of the hand-written
  `2.0.0` no lock could ever record for a `0.1.0` package. The capability
  document's `adapter.adapterVersion` and identity digest (`adapterDigest`,
  derived from the name/version pair) change accordingly; no golden vector in
  this package pinned the previous value. The repository-level
  `test/adapter-version.test.mjs` proves the constant, the manifest and a lock
  row pinning this package agree, and that `deploy.mjs` refuses any other pin.
- **Breaking (adapter protocol `2.1.0`, LOCAL-47):** `activate`'s
  `expectedCurrentGenerationId` is now mandatory and must be either a generation
  identity or the protocol's `EXPECT_NOTHING_SERVED` sentinel. `null` and
  `undefined` — which this adapter previously read as "no expectation, do not
  fence me", silently disabling the activation fence for the caller who meant
  "refuse if anything is already served" — are refused with the
  `EXPECTED_GENERATION_FENCE_INVALID` finding code. Activating with the sentinel
  against a destination that already serves a generation now reconciles instead
  of overwriting it. `preflight`'s optional `expectedGenerationId` is validated
  as the same fence vocabulary, and a destination serving nothing no longer
  silently satisfies an expectation of some generation.
- `rollback` builds its internal activation fence with `fenceFor(...)`, so a
  rollback against a destination serving nothing states that expectation
  explicitly instead of passing `null`.

### Added

- `EXPECT_NOTHING_SERVED` and `fenceFor` are re-exported from
  `@rathnasgala2/adapter-protocol` so callers have the fence vocabulary without
  a second import.

- Workspace scaffold placeholder: valid `package.json`, JSDoc-typed status
  export, hand-maintained `.d.ts`, and a passing placeholder test. No runtime
  behavior ships; implementation is scoped to S2-T17 (S2-T15).
- Full implementation of all eight adapter-protocol lifecycle functions against
  the `gala-local-directory-filesystem-v2` oracle: symlink-based atomic
  `current` pointer-swap activation with an `expected-generation` concurrency
  fence, `fsync` discipline on every written file and directory, an on-disk
  symlink-escape probe at `preflight` (the corroborating check
  `publish-kernel`'s path-containment module defers to a concrete adapter), a
  live (reduced-iteration, documented) atomic-replacement and exclusive-link
  filesystem probe feeding `describeCapabilities`' `filesystemEvidenceDigest`,
  `public-generation-marker:2.0.0` placement and validation, digest-checked
  activation that refuses a partial or tampered stage, `reupload`-semantics
  rollback, and on-disk retention of the active generation plus five priors.
  Passes the reusable `@rathnasgala2/adapter-conformance-kit` suite in full and
  an end-to-end test through `publish-kernel` and a
  `@rathnasgala2/template`-rendered candidate directory (S2-T17).

### Fixed (S2-T17 review)

- `activate` now physically sweeps `releases/<generationId>` directories that
  fall out of the retained window (active generation plus five priors) after
  every successful activation, not only the abstract `history.json` bookkeeping.
  `test/retention.test.js` activates seven generations in sequence and asserts
  exactly six release directories remain on disk.
- `activate` accepts an optional `crashInjectionHook`, invoked after staging is
  durably committed but strictly before the `current` pointer swap; a real
  thrown error there never mutates `current`. `cleanupStaged` accepts an
  optional `generationId` to recover an abandoned release directory left by such
  an interruption (only ever one that is neither current nor retained).
  `test/conformance.test.js`'s `simulateInterruptedActivation` drives both
  through the reusable conformance kit's genuine interrupted-activation test.
- `generateUuidV7` moved to `@rathnasgala2/adapter-protocol` (already a
  dependency), removing the duplicate implementation.
