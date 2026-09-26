# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-26

### Changed

- **PUB-L2:** `checkPathContainment`'s doc comment no longer claims a
  cross-entry NFC-collision check that cannot occur by construction (any
  individual non-NFC path is already rejected, so two distinct NFC-form paths
  cannot collapse to the same one). Only the case-folded cross-entry check is
  real; the doc now says so and explains why the NFC half was unreachable rather
  than implying a second check exists.
- **PUB-L1:** the internal `REDACTED` placeholder now comes from
  `@rathnasgala2/adapter-protocol`'s `REDACTION_PLACEHOLDER`, the one redaction
  sentinel every package uses, instead of this package's own `'[REDACTED]'`
  literal (the value is unchanged).

### Added

- **PUB-M11:** the manifest declares `"sideEffects": false`, so a bundler can
  tree-shake an unused re-export from this package's barrel entry point instead
  of conservatively retaining the whole thing.

## [0.1.0] - 2026-09-22

### Changed

- **Breaking (LOCAL-47, adapter protocol `2.1.0`):** duty 6's
  `checkConcurrencyFence` (and therefore duty 7's `decideStagedActivation` and
  `evaluateActivate`) now states its expectation in the adapter protocol's fence
  vocabulary, consumed from `@rathnasgala2/adapter-protocol` rather than
  re-implemented. Under a fencing concurrency class:
  - `expectedGenerationId` must be a generation identity or
    `EXPECT_NOTHING_SERVED`; `null`, `''` and non-strings are refused with
    `CONCURRENCY_FENCE_IDENTITY_INVALID` (`SOURCE_ERROR`).
  - `observedGenerationId` is mandatory and is `string | null` (`null` means the
    destination serves nothing). An **omitted** observation previously meant
    "nothing to compare against, proceed" — an unfenced publish for any caller
    that had not observed the destination — and is now refused with the new
    `CONCURRENCY_FENCE_OBSERVATION_MISSING` (`SOURCE_ERROR`) finding code. There
    is no longer any fence input that silently disables the fence.

### Added

- `ADAPTER_PROTOCOL_VERSION`, `EXPECT_NOTHING_SERVED`, `fenceDisagrees`,
  `fenceFor` and `requireGenerationFence` are re-exported from
  `@rathnasgala2/adapter-protocol` so a caller assembling a
  `ConcurrencyFenceInput` has the fence vocabulary from one import.

- Implemented all ten non-disableable kernel duties (DEC-016; S2-author-owned-
  publication.md section 5) as pure, deterministic, fail-closed functions over
  explicit inputs: artifact identity/digest agreement, path containment, bounded
  resources, destination authority, secret handling (structural redaction and
  exposure detection), operation identity/idempotency/concurrency fencing,
  staged activation, ambiguous- outcome discipline, last-known-good retention,
  and typed diagnostics (S2-T16).
- `kernel.js`: per-lifecycle-stage composition (`evaluatePreflight`,
  `evaluateStage`, `evaluateActivate`, `evaluateObserve`,
  `evaluateCleanupStaged`, `evaluateRollback`).
- `capability-decision.js`: the DEC-097 §7/§8 `capabilityDecision`/
  `capabilityDecisionDigest` record, built and verified using
  `@rathnasgala2/adapter-protocol`'s `canonicalizeJson`/`domainDigest`
  primitives.
- `generation-marker.js`: `public-generation-marker:2.0.0` construction and
  schema validation via `@rathnasgala2/schemas`.
- Generated, checked `types/*.d.ts` declarations (`declarations:generate`/
  `declarations:check`), near-complete unit and property test coverage
  (`node --test --experimental-test-coverage`), and this README's design note on
  why the full `deployment-intent`/`deployment-observation` wire schemas are not
  validated whole in S2.

### Removed

- The S2-T15 scaffold placeholder (`PACKAGE_STATUS`) and its placeholder test.

### Fixed

- Workspace: `npm run sbom` no longer leaves `git status --porcelain` dirty on
  every run. `scripts/normalize-sbom.mjs` normalizes the two volatile CycloneDX
  fields (`serialNumber`, `metadata.timestamp`) immediately after generation,
  and `scripts/check-sbom-fresh.mjs` now compares the committed `sbom.cdx.json`
  against a fresh regeneration byte-for-byte instead of only checking gross
  shape.
