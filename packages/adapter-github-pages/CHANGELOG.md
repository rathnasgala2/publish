# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-10-23

### Fixed

- The shipped TypeScript declarations (`types/`) are regenerated from `src/`.
  The 0.1.2 package shipped the `observe` CDN wait and the transport error
  policy in `src/` but declarations that predated them, so a TypeScript consumer
  saw no `now` clock on the destination, no `cacheControl` on a public read and
  no `entries` on the staged and certified records. The declarations now carry
  `PagesDestination.now`, the `ObserveProgress` type, `readServedGeneration`,
  `maxAgeSeconds` and the `cacheControl` and `entries` members. There is no
  runtime change from 0.1.2.

## [0.1.2] - 2026-10-23

### Added

- `destination.verificationBaseUrl` (optional, https): the origin that is
  serving right now. Every public read used for verification (marker reads,
  `inspectDestination`, `preflight`, `activate`'s fence read, `observe` and the
  route reads) uses it when present and `publicBaseUrl` otherwise, joined the
  same way. A redirect there is still `PAGES_PUBLIC_REDIRECT`.

### Fixed

- `observe` no longer reports a freshly activated generation as unverified
  because the Pages CDN still serves the previous one. GitHub Pages serves
  `cache-control: max-age=600` and its CDN ignores query strings and request
  cache headers, so cache-busting is impossible. `observe` now re-observes the
  marker and every staged route with a backoff (5 s doubling to 30 s) until the
  marker and the artifact digest match, for at most the served `max-age`
  (default 600 s, capped at 900 s) plus a 60 s margin, and then reports the last
  observation's findings. A redirect (`PAGES_PUBLIC_REDIRECT`) and a generation
  this run never staged still fail at once without waiting. The destination
  accepts an optional `now` clock beside `sleep` for tests.

  The waiting is bounded in requests too. The first pass reads the marker and
  every staged route. Later passes re-read the marker only until it matches,
  plus a rotating sample of at most 20 still-unmatched routes; once the marker
  and the sample match, the remaining unmatched routes are read in the same
  pass. Routes that matched are kept, and a site of 50 routes or fewer re-reads
  what matched in earlier passes once more before reporting success. The digest
  is computed over the whole coherent set. The request count is about passes x
  (20 + 1) + 2 x routes; there is no request cap that can end the wait early.
  Transient transport errors (ECONNRESET, ETIMEDOUT, ECONNREFUSED, EPIPE,
  EAI_AGAIN, the undici socket and timeout codes, TimeoutError) are retried
  within the deadline and reported as findings (`verified: false`) if they
  persist, and the same code on three consecutive passes stops the wait.
  Name-resolution, certificate and TLS errors, a body over the ceiling and
  programming errors still throw at once. The declared `managedExecutionBudget`
  stays at the schema maximum of 1500 seconds, below the true worst case (1500 s
  activation poll plus up to 960 s of observe waiting).

- A redirecting public origin no longer throws out of the lifecycle. A site
  whose repository still carried the `github.io` base after moving to a custom
  domain made the public read's `redirect: 'error'` fetch throw (production
  incident 2026-10-21), so the run died without a journal. `readPublic` now
  returns `{status: 'redirect', toHost, location}` (the `Location` is read with
  one extra credential-free `redirect: 'manual'` request, still followed
  nowhere, bounded to ten seconds, body cancelled, http(s) targets only, and
  only undici's exact refused-redirect error counts); `inspectDestination` and
  `observe` carry `failure: {code: 'PAGES_PUBLIC_REDIRECT', toHost, location}`
  and a `PAGES_PUBLIC_REDIRECT:` finding, and `preflight` refuses with it.
- Accept GitHub's `deployment_queued` Pages deployment status as temporary (keep
  polling). It is in GitHub's REST reference but was missing from the accepted
  vocabulary, so a real publish on 2026-10-06 stopped with
  `PAGES_DEPLOYMENT_STATUS_UNKNOWN` and held the destination fence.

## [0.1.1] - 2026-09-26

### Added

- **PUB-L1:** `REDACTION_PLACEHOLDER` now comes from
  `@rathnasgala2/adapter-protocol`, the one redaction sentinel every package
  uses, instead of this package's own `'[redacted]'` literal. The value changes
  from `'[redacted]'` to `'[REDACTED]'`; this constant is internal and was not
  part of the published root export.
- **PUB-M11:** the manifest declares `"sideEffects": false`, so a bundler can
  tree-shake an unused re-export from this package's barrel entry point instead
  of conservatively retaining the whole thing.
- **PUB-L5:** `verifyPagesOidcToken` now checks the token's `exp`, `iat` and
  (when present) `nbf` claims, each within a new `PAGES_OIDC_CLOCK_SKEW_SECONDS`
  (300s) tolerance, raising `PAGES_OIDC_TOKEN_EXPIRED` or
  `PAGES_OIDC_TOKEN_NOT_YET_VALID`. This is a belt-and-braces check: GitHub
  Pages remains the authoritative relying party for token staleness (this
  module's own trust-boundary documentation is unchanged), but failing here
  first costs nothing and produces a far clearer diagnostic than a Pages-side
  rejection.
- **PUB-M5:** `computeArtifactDigest` (marker-coordinate exclusion aside) now
  delegates to `@rathnasgala2/adapter-protocol`'s implementation of the same
  name instead of restating the `GALA-ARTIFACT-V2 ` formula locally.
- **PUB-H6:** every refusal this package raises is now a typed
  `PagesAdapterError` (`src/errors.js`, exported from the package root) carrying
  a stable `code` property (e.g.
  `error.code === 'PAGES_OIDC_SUBJECT_MISMATCH'`), instead of a bare `Error` a
  caller had to parse `CODE: detail` out of. `.message` is unchanged, so this is
  additive, not breaking.

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
- `callClassBindingDigest` is computed with schema 2.8.1's exported
  `ACTIVE_DIGEST_PROFILES.providerCallClassBinding` (PUBLISH-S4-5); the local
  `DOMAIN_PAGES_CALL_CLASS_BINDING` constant and export are gone. A test proves
  the exported profile and the previous local `domainDigest` computation agree
  byte-for-byte (preimage and digest) on the real nine rows, so the declared
  digest is unchanged.

### Added

- `CALL_CLASS_BINDING` (PUBLISH-S4-4b, schema 2.8.0, LOCAL-52 (2)): the per-row
  `pagesDeploymentId` source and recovery-only flag that used to be an
  undeclared side table (`CALL_CLASS_ID_BINDING`) are now the declared
  `limits.callClassBinding` rows of the capability document, bound by
  `limits.callClassBindingDigest` under `GALA-PROVIDER-CALL-CLASS-BINDING-V2\0`
  (exported as `DOMAIN_PAGES_CALL_CLASS_BINDING`, matched against the schema
  package's golden vector). `requestTemplateCatalogDigest` is byte-identical to
  before and is now pinned by a test. `callClassIdBinding(stage, callClass)`
  returns the declared row; `CALL_CLASS_ID_BINDING` is gone.

- The complete DEC-097 section 7 nine-row request catalog (PUBLISH-S4-2):
  `inspect/pages-site`, `activate/pages-create-deployment`,
  `activate/pages-deployment-status`, `observe/pages-deployment-status`,
  `inspect/pages-recovery-prior-status`,
  `cleanup-staged/pages-cancel-deployment`,
  `cleanup-staged/pages-recovery-prior-cancel`,
  `rollback/pages-create-deployment` and `rollback/pages-deployment-status`,
  sorted by member JCS bytes, each carrying the mandatory
  `accept-encoding: identity` and `connection: close` headers. The
  `pagesDeploymentId` segment is now selected statically by the call class from
  either the intent's `pagesBuildVersion` or
  `pagesRecovery.priorPagesBuildVersion`, and every request is checked against
  its template before dispatch.
- `src/oidc.js`: the `gala-pages-oidc-v2` credential-source profile. The Pages
  OIDC token is now a mandatory caller-supplied input (`pagesOidcToken` /
  `destination.oidcToken`, with `pagesOidcClaims` / `destination.oidcClaims`
  carrying the expected bindings) and a mandatory `oidc_token` member of the
  create request entity. The adapter never mints it, performs no
  issuer-signature or JWKS verification and makes no discovery network call.
- `src/recovery.js`: DEC-097 section 6.2 reconciliation recovery — validation of
  the server-minted `pagesReconciliationRecovery` record, its
  `pagesRunAttemptGapProof` and every `closed-no-destination-authority`
  tombstone digest, plus the same-operation prior-attempt resolution
  (`activate({mode: 'pages-reconciliation-recovery', pagesRecovery})` and the
  separately callable `recoverPriorAttempt`).
- `src/redaction.js`: enforced, bidirectional credential redaction — the OIDC
  token can never reach a header, evidence, digest, output, log or thrown
  message, and the GitHub token can never reach the body.

### Changed

- **Breaking.** `activate`'s `expectedCurrentGenerationId` now follows adapter
  protocol `2.1.0` (LOCAL-47): it is either a generation identity or the
  `EXPECT_NOTHING_SERVED` sentinel, and `null`/`undefined` are refused with
  `EXPECTED_GENERATION_FENCE_INVALID`. `rollback` builds its fence with
  `fenceFor`. Both the sentinel and `fenceFor` are re-exported here.
- **Breaking.** `requireTemplate(templates, stage, callClass)` resolves by the
  `(stage, callClass)` pair, and `callProvider(context, stage, callClass, ...)`
  names both. The old call-class-only names (`pages-read-site`,
  `pages-poll-deployment-status`) are gone.
- **Breaking.** `activate` requires a Pages OIDC token and its expected
  bindings, and the destination must carry `repositoryId` and
  `repositoryOwnerId` so the two admitted subject forms can be recomputed.
- The create request entity is now the exact compact JCS of the three members
  `artifact_id`, `oidc_token` and `pages_build_version`; a string artifact id,
  an unsafe integer, a missing/extra/reordered member and noncanonical JSON are
  each refused locally.

- Real implementation over the adapter protocol (S4-T04, backlog W4-11),
  replacing the S2-T15 scaffold placeholder:
  - a deterministic one-member gzip/POSIX.1-1988 ustar Pages carrier whose bytes
    are identical for identical inputs (fixed mtime, ownership, mode, entry
    order, and a zeroed gzip MTIME/OS byte), with codec goldens and a lossless
    round-trip test;
  - the raw Pages REST catalog, declared as data and digested into the
    capability declaration, with no opaque `actions/deploy-pages`, no branch
    mutation and no assumed source commit (expanded to the full nine rows under
    PUBLISH-S4-2, above);
  - `pagesBuildVersion` derived from the domain-separated
    repository/operation/attempt/run/artifact/generation projection, and a
    refusal when the returned `pagesDeploymentId` does not equal it exactly;
  - the exact eleven-status vocabulary, its temporary/terminal partition (with
    `deployment_attempt_error` temporary) and the exact
    `5, 8, 12, 18, 27, 30`-then-`30` poll schedule, with an unknown status and
    an exhausted budget both holding the fence rather than releasing it;
  - a never-followed `status_url`: every poll uses an independently constructed
    suffix-free URL;
  - integrity recheck of the staged carrier against the caller's frozen artifact
    digest before promotion, and a crash-injection boundary between durable
    carrier publication and the create call;
  - credential-free public verification of the activated origin, and
    `rollback: reupload` under a new generation identity.
- The full `@rathnasgala2/adapter-conformance-kit` suite passes against a local
  fake provider that speaks real HTTP over the loopback interface and genuinely
  gunzips and untars the carrier before serving it.

### Known gaps

- The live GitHub Pages deployment API is untested here; that is backlog W4-16.
  Everything above is proven against the local fake only.

- Workspace scaffold placeholder: valid `package.json`, JSDoc-typed status
  export, hand-maintained `.d.ts`, and a passing placeholder test. No runtime
  behavior ships; implementation is scoped to S2-T19 (S2-T15).
