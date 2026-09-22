# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Added

- Real implementation over the S3-compatible API (S4-T05, backlog W4-11),
  replacing the S2-T15 scaffold placeholder:
  - the exact two-bucket website binding and its refusals (one bucket for both
    roles, a dotted bucket name, an unrecognised region, and a CDN endpoint,
    custom domain or plain object origin as the public base URL), all before a
    credential is used;
  - a dependency-free AWS SigV4 signer over `node:crypto`, validated against the
    published AWS `aws-sig-v4-test-suite` `get-vanilla` vector, signing only
    `host`, the `x-amz-*` family and `content-type` so an HTTP client's
    legitimate rewriting of conditional and cache headers cannot invalidate a
    signature;
  - the exact `gala-do-spaces-sigv4-v2` request catalog covering all eight
    declared response profiles, declared as data and digested into the
    capability declaration;
  - private generation-prefixed staging under the reserved
    `_gala/staged/v2/<operationId>/<attemptId>/<generationId>/root/` prefix,
    with multipart upload above the declared 5 MiB single-part ceiling and an
    abort on failure;
  - replace-in-place activation with an exact inventory diff against the
    retained predecessor, superseded-object deletion, and the generation marker
    written **last** under a conditional `If-None-Match`/`If-Match` guard plus a
    confirming re-read;
  - public verification through the website origin, operation-scoped cleanup
    that refuses any prefix outside the reserved staging prefix, and
    `rollback: reupload` from the retained private stage or caller-supplied
    bytes.
- The full conformance suite passes twice: against an in-process S3-compatible
  fake, and against a throwaway MinIO container pinned to the digest in
  `infra/release/container-images.json`, which validates every signature
  independently (`scripts/minio-spaces.sh`, `SPACES_MINIO_ENDPOINT`).

### Changed

- The request catalog is now DEC-097 section 7's exact 24-row Spaces union — one
  row per `(stage, callClass)`, sorted by member JCS bytes, with the two fixed
  headers (`accept-encoding: identity`, `connection: close`), the four universal
  derived headers, the object metadata set and signed `x-amz-acl` on every
  full-object write, and the optional `x-amz-security-token` credential row
  present iff that credential is. `requireTemplate` refuses an undeclared pair
  with `SPACES_CALL_NOT_IN_CATALOG`, and `src/s3.js` renders every request from
  its row rather than from caller arguments, refusing a wrong origin, an
  undeclared query parameter, an undeclared metadata set or any undeclared
  header before egress.
- The two undeclarable signed object-`GET` families are gone. The generation
  marker is read over the credential-free website origin and its ETag comes from
  the declared `inspect/object-head` row; the served root is written from the
  frozen envelope's own bytes (`activate`/`rollback` accept `files`, with a
  run-scoped stage store as the fallback); and the `stage.json` control object
  is replaced by a pure, reversible stage-token projection, preserving the
  "never delete a prefix this adapter could not have derived" property.
- `rollback` without caller-supplied `files` now fails closed with
  `ROLLBACK_INPUT_UNAVAILABLE` unless this run itself staged the target
  generation, and re-promotes through the `rollback/*` rows.
- `mediaTypeFor` now only ever returns a member of DEC-097's closed
  deployment-media-type list (`.js` is `application/javascript; charset=utf-8`,
  `.json` and `.xml` carry their charset), cache control is
  `public, max-age=31536000, immutable` exactly for a staged file marked
  `immutable: true` and `no-cache` otherwise, `x-amz-meta-gala-sha256` is the
  untagged 64-hex digest, and the marker is written as compact JCS with
  `application/json; charset=utf-8` and a signed `no-store`.
- The `spaces-list-staged-generations` mislabel is gone: the private staged
  listing is `inspect/generation-list` (`stagingBucket`,
  `spacesStagePrefix + "root/"`) and the served-root enumeration is
  `observe/generation-list` (`servedBucket`, the base-path-derived prefix). No
  other call class uses `spaces-list-v2`.

- New `src/control-plane.js`: DEC-097's closed four-row
  `gala-do-spaces-control-plane-http-v2` request catalog and its three response
  profiles, now the real source of `spacesControlPlaneRequestCatalogDigest` and
  `spacesControlPlaneResponseCatalogDigest` (previously two ad-hoc string
  lists), plus `proveLimitedKeyAccessDenied`, which fails closed with
  `SPACES_LIMITED_KEY_OVERPRIVILEGED` or `SPACES_LIMITED_KEY_DENIAL_UNPROVEN`
  before any mutation and returns credential-free evidence.

### Breaking

- `activate`'s `expectedCurrentGenerationId` is mandatory and no longer accepts
  `null`/`undefined` (adapter protocol 2.1.0, LOCAL-47): pass a generation
  identity or the newly exported `EXPECT_NOTHING_SERVED` sentinel, or be refused
  with `EXPECTED_GENERATION_FENCE_INVALID`.
- `activate` and `rollback` accept an optional `files` (and `activate` an
  optional `artifactId`/`artifactDigest`); `stage` accepts an optional per-file
  `immutable: true`. `stageToken` values from an earlier release do not resolve,
  because the token is now a reversible projection rather than a digest.
- New exports: `EXPECT_NOTHING_SERVED`, `DEPLOYMENT_MEDIA_TYPES`,
  `IMMUTABLE_CACHE_CONTROL`, `DEFAULT_CACHE_CONTROL`, `cacheControlFor` and
  `forgetDestination`, plus an optional credential-free
  `destination.onProviderCall` diagnostics hook.

### Known gaps

- DigitalOcean Spaces itself is untested here: the served/staging website
  configuration, the control-key `GetBucketWebsite` evidence and the real
  `-static` website origin all need live credentials and remain backlog W4-16.
  `proveLimitedKeyAccessDenied` is exercised against the in-process fake only.
- `cleanup-staged/staged-multipart-abort` and
  `cleanup-staged/served-root-multipart-abort` are only reached when a multipart
  upload fails; both are exercised by injected-failure tests rather than by the
  happy-path lifecycle.

- Workspace scaffold placeholder: valid `package.json`, JSDoc-typed status
  export, hand-maintained `.d.ts`, and a passing placeholder test. No runtime
  behavior ships; implementation is scoped to S2-T18 (S2-T15).
