# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **PUB-L7:** `CLAUDE.md`'s "Commands" section now lists every gate
  `npm run verify` actually runs (`coverage:check`, `sbom:check`,
  `workflows:check`, `workflows:drift`, `schema-pin:check`, `placeholder:check`
  were missing). `test/claude-md-commands.test.mjs` parses `package.json`'s
  `verify` script and asserts every command it chains is listed, so the two
  cannot silently drift apart again.
- **PUB-L6:** deleted the dead `verifyPackageTarballs` local-tarball-pin
  machinery from `scripts/check-pins.mjs` (and the matching `packages` loop in
  `comparePins`, the `packages` field in `pins/ledger.json`, and the fixture
  tarball `test/fixtures/local-packages/rathnasgala2-schemas-2.10.0.tgz`).
  `scripts/check-no-local-schema-pin.mjs` now forbids the LOCAL-1 local-tarball
  convention outright for every package, so a `ledger.packages` entry of this
  shape can never legitimately exist again; keeping the path permanently
  exercised only by synthetic test rows was dead weight.
- **PUB-L3:** the root README's "Working from a git worktree" section no longer
  claims `publish-action` resolves `schema`, `api` and `infra` as siblings; only
  `template` and `theme-<slug>` are ever resolved this way
  (`workspace-siblings.js` is called with nothing else).
- **PUB-L1:** `test/redaction-sentinel-agreement.test.mjs` proves
  `publish-kernel` and `adapter-github-pages` use the same redaction sentinel
  now that both import `@rathnasgala2/adapter-protocol`'s
  `REDACTION_PLACEHOLDER`.
- **PUB-M12:** `npm run placeholder:check`
  (`scripts/check-placeholder-markers.mjs`) fails if the literal
  `PLACEHOLDER (W0-01)` marker text appears anywhere in the scanned files
  (workflows, `docs/callers/`, the pin ledger, the two scripts that document the
  self-reference) without a matching entry in the script's
  `TRACKED_PLACEHOLDERS` inventory. It also checks, on every run, whether
  `rathnasgala2/publish` now resolves on GitHub while `pins/ledger.json` still
  records the all-zero self-reference placeholder, and prints a loud warning
  (not a failure — the reconciliation itself is a deliberate, separate change)
  if so. At this commit, 10 of the 13 markers the 2026-09-25 review found were
  already resolved by the earlier PUB-H5 SHA pin; the remaining 3 are the
  inherently unresolvable-until-publish self-reference, now tracked explicitly.
  Wired into `npm run verify`.
- **PUB-M10:** `.github/workflows/nightly.yml` gains a
  `spaces-minio-conformance` job that starts the digest-pinned throwaway MinIO
  container and runs `adapter-do-spaces`'s real-server conformance suite every
  night. Previously that suite ran only when a maintainer invoked
  `scripts/minio-spaces.sh` by hand, so CI only ever proved the adapter against
  a fake S3 server written by the same authors.
- **PUB-M13:** `release.yaml`'s publish loop now captures `npm view --json` and
  branches on `error.code === 'E404'` specifically instead of treating any
  non-zero exit as "not published". A registry 5xx, timeout, auth failure or
  rate limit now fails the release job instead of falling through to an
  attempted republish that fails with `EPUBLISHCONFLICT` partway through the
  dependency-ordered loop. `test/release-npm-view.test.mjs` proves the embedded
  extractor actually discriminates E404 from other failures.
- **PUB-M8:** `test/loader-admits-adapters.test.mjs` proves
  `@rathnasgala2/adapter-protocol`'s new `loadAdapterModule` specifier allowlist
  actually admits and loads the three real published adapters
  (`adapter-local-directory`, `adapter-github-pages`, `adapter-do-spaces`), from
  the repository level since `adapter-protocol` itself stays dependency-free.
- **PUB-M11:** every package manifest declares `"sideEffects": false`, and
  `scripts/check-manifest-conformance.mjs` (`npm run manifest:check`) now fails
  if a package is missing it. These are side-effect-free barrel entry points; a
  bundler can now tree-shake an unused re-export instead of conservatively
  retaining the whole package.
- **PUB-M9:** `npm run coverage:check` (`scripts/check-coverage.mjs`) runs
  `node --test --experimental-test-coverage` per workspace package and fails if
  a package's line or branch percentage drops below the floor recorded in
  `coverage-thresholds.json`, seeded at each package's currently measured value.
  Wired into `npm run verify`.
- **PUB-M5:** `test/artifact-digest-agreement.test.mjs` proves
  `adapter-local-directory`, `adapter-github-pages` and `adapter-do-spaces`
  still agree byte-for-byte on the `computeArtifactDigest` formula over a shared
  fixture set (empty files, unicode paths, nested directories, the reserved
  generation-marker coordinate), now that all three delegate to
  `@rathnasgala2/adapter-protocol`'s single implementation.
- **PUB-M1:** `.github/workflows/ci.yml` gains a `full-verify` job that runs the
  complete `npm run verify` (including `architecture`, `duplication`,
  `sbom:check`, `pins:check`, `schema-pin:check` and the Docker build-sandbox
  proof) on every push and pull request, not only nightly. A merge can no longer
  land an adapter-isolation, SBOM or pin-ledger violation that sits on `main`
  for up to 24h before nightly.yml catches it.

### Changed

- **Contract re-pin: `@rathnasgala2/schemas` moved from the LOCAL-1/LOCAL-43
  local tarball to the published registry version, exact pin `2.11.0`**
  (2026-09-22 contract re-pin packet). CI was failing with `ENOENT` on
  `local-packages/rathnasgala2-schemas-2.10.0.tgz`, a path that only ever
  existed on the owner's laptop; the package is now public on
  `registry.npmjs.org`, so all six workspace packages (`adapter-protocol`,
  `publish-action`, `adapter-do-spaces`, `adapter-github-pages`,
  `publish-kernel`, `adapter-local-directory`) declare
  `"@rathnasgala2/schemas": "2.11.0"` and the workspace root `package-lock.json`
  resolves it from the registry with a verified sha512 integrity hash.
  `pins/ledger.json`'s `packages` array (the LOCAL-1 tarball-hash pin) is now
  empty and `test/pins.test.mjs` was updated to assert the retirement and the
  new registry pin instead of the old tarball literal. Added
  `npm run schema-pin:check` (`scripts/check-no-local-schema-pin.mjs`), wired
  into `verify` alongside `pins:check`, so a `file:.../local-packages/...`
  specifier can never reappear silently. Only the `description` string of
  `adapter-capability.schema.json` changed 2.10.0->2.11.0; no adapter source
  changed.

- **PUBLISH-SECRET-RENAME-1**: pure identifier rename, no behaviour change,
  recommended by an audit and approved. Author-repo secret names in the caller
  contract docs (`docs/callers/README.md`, `docs/callers/gala-publish-v2.yml`)
  rename `DO_SPACES_ACCESS_KEY_ID` -> `DO_SPACES_DATA_ACCESS_KEY_ID` and
  `DO_SPACES_SECRET_ACCESS_KEY` -> `DO_SPACES_DATA_SECRET_ACCESS_KEY`, so the
  data-plane vs `DO_SPACES_CONTROL_*` control-plane split is explicit in the
  name authors are told to create. The reusable workflow's own fixed input names
  (`CALLER_DO_SPACES_ACCESS_KEY_ID`, `CALLER_DO_SPACES_SECRET_ACCESS_KEY`,
  `capability.js`'s `dataPlaneCredential`, and every test/fixture that asserts
  on them) are unchanged — that is a separate, digest/contract-relevant
  identifier this rename does not touch. Clean break, no transition fallback.

- **PUBLISH-S4-7 — DEC-097 Spaces closed records (C2, schema 2.10.0, LOCAL-63):
  destination-record-derived Spaces issuance through the fake, the two
  per-destination control-plane records proven against the pinned vectors, and
  the capability-decision phase partition read from the pinned schema instead of
  hard-coded.**
  - **Pin `@rathnasgala2/schemas` 2.10.0** (tarball sha256
    `822644a309ab00cdbf6bc913b6024a7240681cec6a46688288c0f2da01940e1e`, repacked
    by the schema slice's own reviewer for description-only fixes — no vector or
    digest-domain change): every workspace package, the lockfile (real sha512
    integrity, `npm install` against the repacked tarball), `pins/ledger.json`,
    the SBOM, `CLAUDE.md` and the pin tests.
  - **`capability-decision.mjs`'s
    `ISSUANCE_PHASE_MEMBERS`/`DEPLOY_PHASE_MEMBERS` are now read from the pinned
    schema's `x-gala-decision-phase` annotations**
    (`schemas/adapter-capability.schema.json`) at module load, instead of a
    hard-coded array; `test/capability-decision.test.mjs` keeps one
    hand-restated reference copy solely to catch a schema repin that silently
    reclassifies a member. **Review correction:** the schema's `decisionDigest`
    is over whatever members the record object actually carries — the pinned
    package projects away nothing but `decisionDigest` itself; issuance and
    deploy phase digest-agreement therefore holds only because the
    issuance-phase record never contains a deploy-phase member key at all
    (deploy-phase facts do not exist yet at issuance), never because of any
    phase-scoped digest mechanism. A new test
    (`test/capability-decision.test.mjs`) asserts
    `issuancePhaseDecision(...).record` carries no `DEPLOY_PHASE_MEMBERS` key,
    so the agreement holds by construction rather than by coincidence.
    `issuancePhaseDecision`/`admissionRow` gained the do-spaces-only
    `spacesWebsiteConfigurationDigest`/`spacesControlPlaneBindingDigest` (caller
    facts, DEC-097 8444-8449) and — **review correction (LOCAL-63(g)):**
    `spacesControlPlaneRequestCatalogDigest`/
    `spacesControlPlaneResponseCatalogDigest`/`spacesControlPlaneTlsProfileDigest`
    are now caller-supplied per-destination facts too, never mirrored
    admission-row constants: an earlier revision of this slice treated them as
    `(adapterId, adapterVersion)` admission constants, but
    `buildControlPlaneRequestCatalog` closes over the destination's own origins,
    so the digest is a function of the destination. `ADMISSION_ROWS` carries
    none of the three; `@rathnasgala2/adapter-do-spaces` gained
    `spacesControlPlaneCatalogDigests(origins)` (credential-free; also used by
    `describeCapabilities` now, removing a duplicated computation), and
    `recomputeSpacesClosedRecords` calls it so `verify-spaces-configuration.mjs`
    and `deploy.mjs` recompute all five Spaces digests from the intent's own
    destination, completing the do-spaces capability decision the module
    previously could not build at all.
  - **`packages/adapter-do-spaces/src/dec097-records.js` (new).** DEC-097's two
    per-destination closed records — `spacesWebsiteConfiguration` (`basePath` ->
    `errorDocumentKey`) and `spacesControlPlaneBinding` — plus
    `spacesRegionCatalog`, built and digested with the pinned schema's own
    `ACTIVE_DIGEST_PROFILES`. Distinct, documented, from the adapter's existing
    internal `WEBSITE_CONFIGURATION`/`CONTROL_PLANE_BINDING` declaration profile
    (`GALA-SPACES-*` domains; these are `GALA-DO-SPACES-*`). Proven
    byte-for-byte against the five new 2.10.0 vectors, including the chained
    realistic `destination-provider-binding-do-spaces-realistic` vector
    (`packages/adapter-do-spaces/test/dec097-records.test.js`).
  - **`recomputeSpacesClosedRecords`** (`capability-decision.mjs`, new): the one
    shared recomputation of both closed records from an authorized intent's
    `destination.providerBinding` and `rebuildRecord.basePath` — the single
    implementation `verify-spaces-configuration.mjs` and `deploy.mjs` both call,
    so the two jobs can never independently drift on what "recompute" means.
  - **`verify-spaces-configuration.mjs`** now recomputes both closed records and
    requires their digests to equal the intent's pre-authorized capability
    decision (via `requireCapabilityDecisionAgreement`) _before_ either live
    `GetBucketWebsite` call; its evidence record's `requiredConfiguration`/
    `requiredControlPlaneBinding` are now the DEC-097 records, not the adapter's
    internal profile. Live control-plane evidence stays owner-gated (W4-16).
  - **`test/fixtures/fake-gala-api.mjs`**: the seed gains
    `destination: {adapterId, spaces?: {region, servedBucket, stagingBucket, basePath}}`.
    A `do-spaces` request is refused `409 INVALID_SOURCE_STATE` with no seeded
    destination; a seeded destination for another adapter, or
    `adapter.adapterId`/`destination.baseUrl`/`rebuildRecord.basePath`
    disagreement, is `422` at `/adapter/adapterId`, `/destination/baseUrl`,
    `/rebuildRecord/basePath` respectively. `deriveDestination` builds the
    ten-member Spaces provider binding exactly like the api (real DEC-097 origin
    spellings, both record digests, `regionCatalogDigest` from a fixture
    region-catalog list) and renders the intent's `destination.providerBinding`
    as the retained three coordinates. `deriveCapabilityDecision` fills the five
    Spaces capability-decision digests.
  - **`build-provenance.mjs`**: `validateProvenanceRecord` now validates the
    partial record it emits against schema 2.10.0's promoted
    `urn:gala:metadata:build-provenance:2.0.0` root (previously an internal
    `$defs` entry no root referenced), tolerating only the documented
    not-yet-held top-level absences. This surfaced two real wire-type bugs the
    absent root had never caught: `CarrierHandoff.byteCount` is now the schema's
    canonical non-negative decimal string, not a JS number (`freeze.mjs`'s
    `handoffFromOptions` updated to match), and `REQUIRED_OIDC_CLAIMS` is now
    ASCII-sorted to byte-match the schema's `requiredOidcClaims` `const`.
  - **`build-authorization-input.mjs`** header comment reworded: the Spaces
    provider coordinates are never proposed by a deploy job at all (not "until
    C2" — C2 has landed), since the publication's destination is now a
    server-owned record set once through the App.
  - **Tests**: `workload-derivation.test.mjs` gains do-spaces destination
    derivation cases (chained realistic vector, mutation-key vector,
    missing-seed 409) and its vector count moved from eleven to sixteen;
    `deploy-destinations.test.mjs` gains a full do-spaces-through-the-fake case
    proving that `recomputeSpacesClosedRecords`,
    `requireCapabilityDecisionAgreement` and `spacesDestination` all agree end
    to end. MinIO conformance suite unchanged.

- **PUBLISH-S4-6b — the intent request carries only what the workflow holds
  (schema 2.9.0, LOCAL-60); the subject is the DEC-097 workload URN; the
  capability decision is recomputed before staging (LOCAL-62).**
  - **Pin `@rathnasgala2/schemas` 2.9.0** (tarball sha256
    `b6e420902274104d9082072e444c7798ec86c8594a01551fc659377595b1dd49`): every
    workspace package, the lockfile, `pins/ledger.json`, the SBOM, `CLAUDE.md`
    and the pin tests.
  - **`build-authorization-input.mjs` sends only workflow-held members.** The
    request-side destination is `{adapterId, adapterVersion, baseUrl}` plus
    `providerBinding: {owner, repository}` for Pages and nothing for Spaces
    (`environment`, `targetDigest` and the Spaces coordinates are the API's);
    the request-side `rebuildRecord` is the seventeen members the workflow owns,
    each from its DEC-097 section 5 owner (`deriveRebuildRecord`), and none of
    the four Gala-owned ones; no `capabilityDecisionDigest`. New honest sources:
    `prep` records the checkout's `sourceTree` and `buildEpoch`
    (`build-verified-inputs.mjs`, from git for `GITHUB_SHA`, `null` when
    unavailable); `publish-action`'s build writes `work/build-input.json` and
    `work/theme-contract.json`,
    `pack-carrier.mjs --build-input/--theme-contract` carries them as reserved
    `metadata/build-input.json`/`metadata/theme-contract.json` members, and
    `build-facts.mjs` validates both against their schema roots and ties the
    build input to the manifest (`inputDigest === buildInputDigest`).
    `freeze.mjs` validates them at freeze; `build-authorization-input.mjs` reads
    the build carrier (`--unfrozen-output-digest`). A missing workflow-held
    member is `AUTHORIZATION_INPUT_INCOMPLETE` by name and owner; a build fact
    that disagrees with its owning record is
    `AUTHORIZATION_INPUT_BUILD_DISAGREEMENT`. The child-process test proves the
    complete Pages input is written for the fixture repository.
  - **`workload-contract.mjs`** is the 2.9.0 contract: `checkRequestDestination`
    (request side, `REQUEST_DESTINATION_REQUIRED`,
    `REQUEST_PROVIDER_BINDING_FIELDS`, `ADAPTER_ENVIRONMENTS`) next to
    `checkDestination` (retained, environment = adapter constant);
    `REBUILD_RECORD_REQUIRED`/`REBUILD_RECORD_API_DERIVED`;
    `capabilityDecisionDigest` optional. `workload-requests.mjs` sends
    `capabilityDecisionDigest` only when held. The drift test pins the request
    and retained shapes against the pinned OpenAPI and JSON schema.
  - **`exchange.mjs`** refuses an intent whose `destination.adapterId` is not
    the lock's adapter or whose `environment` is not its constant
    (`WORKLOAD_INTENT_DESTINATION_MISMATCH`); `derivationsAccepted` gains
    `destination` and `rebuildRecord` (every sent member retained) and the
    journal head gains `apiDerived` (the members the API derived).
  - **`authorized-intent.mjs`** binds to the intent `subject` as the DEC-097 URN
    `urn:gala:workload:github:<repositoryId>:<runId>:<runAttempt>` against
    `GITHUB_REPOSITORY_ID`/`GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT` and requires
    `workloadBindingDigest` (the commitment to the retained
    `verifiedWorkloadBinding`, ref included); a repository _name_ is never
    compared. The OIDC `repo:…:ref:…` form is refused as
    `DEPLOY_INTENT_SUBJECT_LEGACY` — strict URN, no compatibility branch (the
    two forms bind different things; API-INTENT-DERIVATION-1 renders the URN).
    The authority's `destinationMutationKeyDigest` is no longer required to
    equal `targetDigest` (the API's fence key is its own
    `GALA-DESTINATION-MUTATION-KEY-V2` domain, DEC-097 lines 3295-3317); it is
    shape-checked and recorded in the journal.
  - **`capability-decision.mjs`** (new, LOCAL-62): the API's issuance-phase
    `capabilityDecision` record (no `pagesActionsArtifactByteCount`/`Digest`;
    `maximum*` = the admitted bounds; `pagesActionsArtifactName` =
    `gala-pages-r<runId>-a<runAttempt>`; the exact JCS marker's byte length),
    `ISSUANCE_PHASE_MEMBERS`/`DEPLOY_PHASE_MEMBERS`, and `ADMISSION_ROWS` — the
    API's `gala_core.adapter_capability` rows mirrored row for row, keyed by
    `(adapterId, adapterVersion)` exactly as the API selects them (LOCAL-64):
    release 0045's three rows at the protocol version `2.0.0` are retained as
    superseded and admit nothing; release 0046 (API-FOLLOWUPS-8) admits the same
    three at the adapter's published _package_ version `0.1.0` (the
    PUBLISH-S4-6a single-source rule), with digests recomputed by the API's
    canonical admission-text convention and pinned to both releases' seeded
    literals. `admissionRow(adapterId, adapterVersion)` (now two-arg) selects
    the unsuperseded row for that exact pair and throws
    `CAPABILITY_ADMISSION_UNKNOWN` — surfaced by the fake and the caller as
    `422 /adapter/adapterVersion` — for a superseded or never-admitted version.
    `deploy.mjs` recomputes the record before any adapter import and refuses a
    disagreeing intent (`DEPLOY_CAPABILITY_DECISION_MISMATCH`); the kernel
    journal head records `capabilityDecision` (issuance digest, member sets, the
    admission version and digest, and `deployPhase`: exact totals over the
    payload plus the marker and the Pages carrier digest).
    `test/capability-decision.test.mjs` pins both releases' digests and checks
    the member sets against the pinned schema's `x-gala-decision-phase`
    annotations wherever present (schema 2.9.1).
  - **`test/fixtures/fake-gala-api.mjs`** mirrors API-INTENT-DERIVATION-1:
    derives the destination, fence key, policy members and the issuance-phase
    capability decision from its seed with
    `@rathnasgala2/schemas/digest-profiles` (`destinationProviderBinding`,
    `destinationMutationKey`, `buildPolicyDecision`, `capabilityDecision`);
    refuses a present disagreeing request member with `422 VALIDATION_FAILED`
    naming the pointer in `errors[]`; `adapter.adapterId` ≠
    `destination.adapterId` → `/destination/adapterId`; an unadmitted
    `adapter.adapterVersion` → `/adapter/adapterVersion`;
    `destination.adapterVersion` ≠ the adapter's →
    `/destination/adapterVersion`; `local-directory` without its digests →
    `/destination/providerBinding`; `do-spaces` → `409 INVALID_SOURCE_STATE`;
    renders `subject` as the URN. `gala-api.mjs` exposes the problem's
    `errors[]` on `GalaApiError.errors`. The eleven
    `parity/digest-record-vectors.json` vectors reproduce through the same
    profiles and the fake's derivations equal them on the vectors' inputs.
  - Fixtures and suites: `authorization-input.mjs` is the 2.9.0 request
    (`PROVIDER_BINDINGS` request-side, `RETAINED_PROVIDER_BINDINGS`/
    `retainedDestinationFor` for the deploy side); `artifact-manifest.mjs`
    builds real build facts from the fixture repository (`fixtureBuildFacts`,
    `manifestFor({buildInputDigest})`); `workload-derivation.test.mjs` runs the
    round trip through the two issuable adapters plus the LOCAL-60 refusal
    matrix and the Spaces 409; `workload-sequence.test.mjs` exchanges for Pages
    (Spaces 409 proved as a child process); `kernel-run-adapters.test.mjs` uses
    the environment constants; `deploy-destinations.test.mjs` binds the retained
    identity; `publish-v2.yml` passes the two fact records to `pack-carrier.mjs`
    and the build carrier digest to `build-authorization-input.mjs`
    (`workflow-graph.test.mjs`); `publish-action`'s e2e test asserts the two
    fact records. `WORKSPACE_ROOT` resolves the `template`/`theme-default`
    siblings from a worktree.
  - Not done here (recorded): the provider-limits pre-check at freeze (the
    totals DEC-097 section 7 requires include the marker the intent's ids
    render, and the Spaces bounds are Gala's record; the kernel run enforces
    them at deploy and the API at issuance); `local-directory` freeze stays
    `AUTHORIZATION_INPUT_ADAPTER_UNMANAGED` (DEC-097 gives it no managed deploy
    job; its request shape is proved through the builder and the fake).
- **PUBLISH-S4-6a (2) — the frozen envelope is DEC-097's
  `gala-frozen-envelope-v2`, with real manifest, provenance and SBOM records.**
  - **`scripts/workflow/frozen-envelope.mjs`** (new): the codec — magic, `u32`
    record count, `kind/path/content` records, payload in path UTF-8 byte order,
    then `metadata/artifact-manifest.jcs` (`0x02`), `metadata/provenance.jcs`
    (`0x03`) and `metadata/sbom.spdx.json` (`0x04`); the decoder revalidates
    framing, reserved paths, caps, the manifest inventory one-for-one and the
    section 8 digest equalities. The schema package's own internal
    `validateFrozenEnvelope` is a test oracle: it accepts the encoder's bytes
    and computes identical digests.
  - **`build-provenance.mjs`** (new): the `buildProvenance:2.0.0` record over
    the members the freeze job holds (asserted workload, 21-claim catalog, both
    re-observed predecessor handoffs, lock/build-input/artifact/manifest/SBOM
    digests, the official SPDX schema digest, `secretInputs: []`), with a closed
    validator; every Gala-, template- or catalog-owned member is documented in
    `PROVENANCE_MEMBERS_NOT_YET_HELD` and omitted, never invented.
  - **`sbom.mjs`** (new): the SPDX 2.3 `gala-spdx-json-v2` projection from the
    payload bytes and the lock, validated against the vendored, hash-checked
    official SPDX 2.3 JSON Schema (new root devDependency `ajv@8.20.0`);
    licenses are `NOASSERTION` and `licenseListVersion` is omitted
    (`SBOM_PROFILE_DEVIATIONS`).
  - **`freeze.mjs`:** reads the manifest from the build carrier's reserved
    `metadata/artifact-manifest.json` member (`pack-carrier.mjs --manifest`),
    validates it against the schema root, refuses unmanifested files, builds the
    SBOM and provenance, encodes the envelope and prints every digest. Takes the
    two predecessor handoffs (`--verified-inputs-*`/`--unfrozen-output-*` id,
    name, byte count, expiry); `prep`/`build` expose `carrier_expires_at` (and
    `build` its name/byte count) for them.
  - **`build-authorization-input.mjs`:** `provenanceDigest`, `sbomDigest` and
    `manifestDigest` come from the decoded envelope; only `rebuildRecord`,
    `capabilityDecisionDigest` and the Gala destination members are still named
    as missing (LOCAL-60). `deriveArtifactFacts(files, manifest)` quotes the
    manifest record's digest; `computeManifestDigest` is removed.
  - **`deploy.mjs` / `build-pages-carrier.mjs`:** decode the real envelope,
    recompute the artifact digest under the installed adapter, refuse an
    envelope whose three metadata digests are not the intent's, stage payload
    records only. **`exchange.mjs`:** the journal head carries the three digests
    and `derivationsAccepted` states whether the API retained them.
  - **`extract-frozen-record.mjs`** (new) and the `attest` job: the job checks
    out the toolchain, revalidates the envelope, extracts the exact SBOM record
    and issues `attest-build-provenance` plus `actions/attest-sbom@v4.1.0` (new
    ledger pin) over the same subject with `sbom-path`.
  - `test/frozen-envelope.test.mjs`, `test/build-provenance.test.mjs`,
    `test/sbom.test.mjs` (new); `test/fixtures/artifact-manifest.mjs` builds a
    schema-valid manifest and a real envelope for any file set, and every
    workflow suite (authorization input, the three-adapter kernel runs, the
    workload derivation and sequence round trips) now binds real envelope
    digests instead of placeholders.
  - Review (PUBLISH-S4-6a merge): `deploy.mjs` exports
    `requireEnvelopeIntentAgreement(intent, envelope)`, the refusal main() runs
    before any adapter module is imported;
    `test/deploy-envelope-agreement.test.mjs` (new) proves each disagreeing or
    missing digest is refused by name and that the refusal precedes the adapter
    import, the first destination contact and the kernel run.
    `test/workload-sequence.test.mjs` asserts the intent exchange journal
    carries the three digests and `derivationsAccepted`;
    `test/adapter-version.test.mjs` proves `adapter-local-directory`'s real
    capability document (not a tautology) declares the installed version.
  - `docs/callers/README.md` states the author-build contract:
    `$GALA_OUTPUT_DIR/artifact` and
    `$GALA_OUTPUT_DIR/work/artifact-manifest.json`.
- **PUBLISH-S4-6a (1, 3) — adapter versions are the installed package versions;
  the build input's destination capabilities are the lock's adapter.**
  - Every adapter's `ADAPTER_VERSION` is read from its own `package.json`
    (`0.1.0` today) instead of a hand-written `2.0.0`, so DEC-097 section 3's
    "`adapterVersion` byte-equals the locked package version" holds by
    construction and `deploy.mjs`'s `requireAdapterVersionAgreement` can pass
    for a real managed deploy. `test/adapter-version.test.mjs` proves, per
    adapter, constant == manifest == lock row, and that any other pin is
    refused. The adapter identity digests (`adapterDigest` in each capability
    document) change with the version; no repository golden vector pinned them.
  - `publish-action` derives `destinationCapabilities` from the lock-selected
    adapter (id, locked version, locked integrity) and the publication's
    canonical base (DEC-097 section 5); the fixed `local-directory` stand-in and
    `LOCAL_BASE_URL_STANDIN` are retired.
- **PUBLISH-S4-5 (final) — `@rathnasgala2/schemas` 2.8.1 and the exported digest
  profiles.** Every workspace package, the lockfile, `pins/ledger.json`,
  `CLAUDE.md` and the pin tests move to the 2.8.1 tarball (sha256
  `26c0f5fe7c22eb16524aa234926697e51506b49242b3c3e01f39f4e80e0353c1`). The patch
  adds the public `@rathnasgala2/schemas/digest-profiles` subpath;
  `adapter-github-pages` now computes `callClassBindingDigest` with
  `ACTIVE_DIGEST_PROFILES.providerCallClassBinding` and drops its local
  `GALA-PROVIDER-CALL-CLASS-BINDING-V2` restatement, with a test proving the
  exported profile and the previous local computation agree byte-for-byte on the
  real rows (the digest on the wire is unchanged). The request-template catalog
  digests keep their adapter-specific domains (`GALA-PAGES-REQUEST-CATALOG-V2`,
  `GALA-SPACES-REQUEST-CATALOG-V2`): the exported `providerRequestTemplates`
  profile uses `GALA-PROVIDER-REQUEST-TEMPLATES-V2`, so switching those would
  change a declared digest and is a contract decision, not a refactor. Rebased
  onto PUBLISH-S4-6a: the tarball on disk hashes to
  `26c0f5fe7c22eb16524aa234926697e51506b49242b3c3e01f39f4e80e0353c1` (the sha
  recorded above supersedes the side branch's `f27bfa94…`), the lockfile and
  SBOM are refreshed against it, and the frozen-envelope codec's three section 8
  digests (`artifact`, `artifactManifest`, `buildProvenance`) are now
  `ACTIVE_DIGEST_PROFILES.<name>.digest(...)` from
  `@rathnasgala2/schemas/digest-profiles` instead of locally restated domain
  strings; `test/frozen-envelope.test.mjs` proves each exported profile equals
  the previous local domain-plus-JCS computation byte-for-byte (preimage and
  digest) on the real manifest inventory, manifest and provenance record, and
  the manifest fixture's `sourceInventory`/`artifactValidationEvidence` digests
  come from the same export.
- **PUBLISH-S4-5 — the exchanged intent is the only authority a managed job
  binds to; freeze derives from the verified source; the fence helper is no
  looser than the wire.**
  - **`scripts/workflow/authorized-intent.mjs`** (new): `bindAuthorizedIntent`
    is the one binding from the deployment-authorization carrier to a job. It
    takes adapter, destination identity, `providerBinding`, the activation fence
    (`expectedGenerationId`, or the `gala:expect-nothing-served` sentinel when
    the intent carries none — DEC-097's first publish), the operation, attempt,
    proposed-generation and artifact identities, the marker and the destination
    mutation authority _exclusively_ from the intent, cross-checks them against
    each other, refuses an intent not bound to the runner's own
    `GITHUB_REPOSITORY`/`GITHUB_REF` (`subject` and the publish ref's operation
    id) and an expired one, and returns a credential-free `journal` record of
    what was used. Closed codes: `DEPLOY_INTENT_MALFORMED`,
    `DEPLOY_INTENT_INCONSISTENT`, `DEPLOY_INTENT_IDENTITY_MISMATCH`,
    `DEPLOY_INTENT_EXPIRED`, `DEPLOY_DESTINATION_BINDING_INVALID`,
    `DEPLOY_RUNNER_IDENTITY_MISSING`. A managed intent without `providerBinding`
    (a server predating API-CONSUME-2.8) fails closed by name; `local-directory`
    must carry none.
  - **`kernel-run.mjs`:** the activation fence is the intent's, never re-derived
    from the observation (`fenceFromIntent`). It is evaluated before staging — a
    disagreement is a `REJECTED`, `skipped` staging attempt with the observed
    generation recorded and no provider mutation — and again on a fresh
    `inspectDestination` immediately before activation. Attempt inputs record
    `expectedCurrentGenerationId` and `observedGenerationId`.
  - **`deploy.mjs`:** consumes the binding; the journal head carries
    `authorization` (every member used, `intentDigest`, `fenceSource`); refuses
    an envelope whose artifact digest is not the intent's
    (`DEPLOY_ENVELOPE_INTENT_MISMATCH`) and an installed adapter release other
    than the one the intent names (`DEPLOY_ADAPTER_VERSION_MISMATCH`).
    `destinationIdentityFrom`/`providerBindingOf` moved to the binding module.
  - **`verify-spaces-configuration.mjs`:** reads the bucket coordinates from the
    bound intent's `providerBinding` (it read `destination.region` etc. directly
    before, which the 2.8.0 destination never carried) and records
    `intentDigest` in its evidence.
  - **`report.mjs`:** refuses an intent not bound to the runner's repository and
    ref, a kernel journal whose head was not produced under this intent
    (`assertJournalAgreesWithIntent`), and a `--repository-id` the intent's
    rebuild record was not bound to (`REPORT_REPOSITORY_MISMATCH`); the evidence
    record carries `intentDigest`.
  - **`freeze.mjs`** is now the envelope half only and freezes under the adapter
    the verified source's lock selects (new `verified-source.mjs`: DEC-097
    section 3's closed package-to-`adapterId` mapping, `adapterDigest` = locked
    integrity, `publisher` row, `lockDigest`; the publication's
    `canonicalBase`). The artifact digest is that adapter's projection, no
    longer `adapter-github-pages`'s for every adapter, and the envelope metadata
    records `adapterId`.
  - **`build-authorization-input.mjs`** (new) writes the authorization input
    after the envelope upload has been re-observed (new `artifact_expires_at`
    output of `observe-carrier.mjs`, which now refuses an artifact without
    `expires_at`), deriving every member with an honest source and failing
    closed with `AUTHORIZATION_INPUT_INCOMPLETE` — naming each missing member
    and its owner — instead of writing a partial document. A lock selecting
    `local-directory` is refused at freeze
    (`AUTHORIZATION_INPUT_ADAPTER_UNMANAGED`). `publish-v2.yml`'s freeze job
    gains the "Build the authorization input" step between the envelope
    re-observation and the input upload; the nine-job graph, `needs`,
    permissions and conditions are unchanged.
  - **`adapter-protocol`:** `requireGenerationFence` admits exactly the schema's
    activation fence (`GENERATION_ID_PATTERN`, a lowercase UUIDv7, or the
    sentinel) and refuses any other text with
    `EXPECTED_GENERATION_FENCE_INVALID`; the conformance kit's stale-expectation
    case fences with a well-formed foreign generation.
  - **Review fixes (PUBLISH-S4-5 reviewer):** only an _absent_
    `expectedGenerationId` is a first publish — `authorized-intent.mjs` and
    `kernel-run.mjs` no longer read a wire-invalid `null` as the sentinel (it is
    `DEPLOY_INTENT_MALFORMED`, tested). `REPORT_REPOSITORY_MISMATCH` and the
    foreign-journal refusal are now exercised through `report.mjs` itself in
    `test/workload-sequence.test.mjs` (neither reaches the API nor spends the
    capability); `test/observe-carrier.test.mjs` proves the `expires_at` refusal
    against a loopback REST stand-in.
  - **Tests:** `test/authorized-intent.test.mjs`,
    `test/authorization-input.test.mjs` (from the real minimal-repository
    fixture, including the `freeze.mjs` → `build-authorization-input.mjs` child
    processes), three-adapter fence runs in `test/kernel-run-adapters.test.mjs`,
    and in `test/workload-derivation.test.mjs` the binding of every issued
    intent plus two new Gala-side edges per adapter through the fake API
    (`state.expectedGenerationId`, `state.omitProviderBinding`).
    `test/workload-sequence.test.mjs` now hands the report the runner identity
    and a journal head, as `deploy.mjs` does.
  - **Follow-ups (recorded, not resolved here):** the 2.8.0 intent request
    requires members the workflow has no honest source for (`provenanceDigest`,
    `sbomDigest`, `rebuildRecord`, `capabilityDecisionDigest`,
    `destination.environment`, `destination.targetDigest`, Spaces
    `providerBinding`), and the API retains the request's
    `adapter`/`destination` verbatim rather than deriving them from the
    publication's destination record and policy release — so a real publish run
    now stops at freeze with the exact list rather than at authorize with the
    first name. Closing it is an API/schema decision (Gala derives the
    destination and policy members; the request carries only what the workflow
    verifies). The intent's `subject` is rendered as
    `repo:<owner>/<repository>:ref:<ref>` by the API although the schema types
    it as a `urn`; the binding matches the API. `lockDigest` is taken from the
    lock document; the independent recomputation DEC-097 requires has no
    implementation in this repository yet.
- **PUBLISH-S4-4b — schema 2.8.0: declared call-class binding, optional derived
  members, provider binding, kind-aware exchange.**
  - `@rathnasgala2/schemas` is pinned to **2.8.0** (tarball sha256
    `6352293855cdcff9054d43ced876740644f6b45bc813eda3990b646ec9bef563`) in every
    workspace package, the lockfile, `pins/ledger.json`, `CLAUDE.md` and the pin
    tests.
  - **`adapter-github-pages`:** `CALL_CLASS_ID_BINDING` (an undeclared side
    table) becomes the declared `limits.callClassBinding` rows
    `{stage, callClass, pagesDeploymentIdSource, recoveryOnly}`, JCS-sorted and
    bound by `limits.callClassBindingDigest` under the schema package's
    `GALA-PROVIDER-CALL-CLASS-BINDING-V2\0` domain (LOCAL-52 (2)). The domain is
    matched against the schema package's own golden vector, and
    `requestTemplateCatalogDigest` is byte-identical to before and pinned by a
    test (`sha256:fcfd87a6…89ecda`). `callClassIdBinding(stage, callClass)`
    returns the declared row.
  - **`workload-contract.mjs` / `workload-requests.mjs`:** `pagesBuildVersion`
    and `spacesStagePrefix` are optional on the intent request, admitted only
    for their own adapter (LOCAL-57); the builder still derives and sends them
    by default, records both under `derived`, and
    `sendDerivedConditionalMembers: false` omits them.
    `destination.providerBinding` is admitted and closed per adapter (LOCAL-55
    (2)). The drift test follows the 2.8.0 shapes: the three flat exchange
    response members on optional `kind`, the named Fit/Unfit arms on `state`,
    the provider-coordinate patterns and the single-pattern fence.
  - **`gala-api.mjs`:** `postReceiptExchange` classifies on `purpose`/`state`,
    requires a present `kind` to agree with the arm, and returns it (`null` from
    a 2.7.x server). **`exchange.mjs`** records `responseKind` in every journal
    head and carrier and the API's agreement on the derived conditional member
    in `derivationsAccepted`. **`deploy.mjs`** builds the Spaces and Pages
    destinations from the authorized `providerBinding` only (an intent without
    one fails closed), takes the Pages numeric ids from the runner's own
    identity, refuses a Pages binding naming another repository, carries the
    binding through the kernel's destination identity and records
    `authorizationResponseKind` in the kernel journal head.
  - **`test/fixtures/fake-gala-api.mjs`:** derives `artifactId`, `attemptId`,
    `proposedGenerationId`, `pagesBuildVersion` and `spacesStagePrefix` from the
    verified claims exactly as the API does, answers a sent value that disagrees
    with `422 VALIDATION_FAILED`, always renders the derived values into the
    retained intent, stamps `kind` on all three responses with an `omitKind`
    lever for a 2.7.x server, and mints a well-formed `idempotencyKey` (the
    previous `randomUUID().replace(/-4/u, '-7')` produced a non-UUIDv7 id one
    run in sixteen).
  - **Tests:** `test/gala-api.test.mjs` (kind classification, kind-less 2.7.x
    body), `test/deploy-destinations.test.mjs` (provider-binding destinations),
    `test/workload-derivation.test.mjs` (exchange → kernel run → receipt
    exchange → report → replay through all three adapters, plus the 422 and
    omission edges), `test/kernel-run-adapters.test.mjs` (binding on both
    managed intents, `local-directory` as the third run) and the sequence test
    (`responseKind` at every step, the 2.7.x replay).
- **PUBLISH-S4-3 — the real workload callers: both Gala requests are built,
  validated, sent and classified.**
  - **`exchange.mjs` sends both purposes for real.** The `deployment-intent` arm
    builds the complete closed request — both bound commits, the artifact
    identity and digests, the manifest digest, provenance and SBOM digests, the
    frozen handoff quartet, the byte and file counts, retention, the
    `verificationSubmission` fit/unfit union, the lock digest, the reproducible
    build record, publisher, adapter, destination, the capability-decision
    digest and the adapter's own conditional member — and the
    `deployment-receipt` arm sends the five-member challenge exchange. The order
    is deliberate: the body is built from the already verified carrier and
    validated against the contract _before_ the single-use OIDC assertion is
    acquired, so a request the API could not accept never spends one.
  - **`report.mjs` submits the full nineteen-member report.** Every member is
    quoted back from the retained intent or produced by the kernel run that
    actually happened, plus the two optional destination members when the run
    produced them. Both ceilings — 512 KiB of kernel journal, 1 MiB of request,
    and the intent's own `maximumReportRequestByteCount` — are applied before
    the capability is presented, because the API consumes it before it parses
    and every failure after that point is permanent. The four outcomes
    (submission recorded, the `409` fence move, the deliberately non-enumerating
    `401`, and any other refusal) are classified into secret-free job evidence.
  - **Nothing carries a credential.** The OIDC assertion is never persisted at
    all. The issued reporting capability reaches exactly one place — a masked
    `$GITHUB_OUTPUT` line — while the job's journal head records only that a
    capability of the contracted 43-character canonical shape was issued, which
    generation it is and when it expires.
  - **`deploy.mjs` no longer stops at a blocker.** `kernel-run.mjs` is the
    provider-neutral stage/observe/activate/cleanup sequence, driven by
    `publish-kernel`'s duty evaluation and adapter protocol 2.1.0's explicit
    fence sentinel, shared by all three adapters. A stage the kernel refused is
    recorded `skipped`, and an activation whose outcome could not be established
    is recorded `unknown` with `destinationChanged: unknown` — never rounded off
    to `failed`. The only fail-closed refusals left are the ones that genuinely
    cannot run without a credential: the Spaces limited-key denial proof and the
    Pages OIDC acquisition.
  - **The Gala API origin is an input.** `publish-v2.yml` gains a required
    `gala_api_origin`, threaded to both same-commit helpers; `gala-api.mjs`
    validates it as an exact scheme/host/port origin and refuses anything that
    is not HTTPS. A loopback `http` origin is admitted only under an explicit
    environment opt-in that no workflow sets and only this repository's own
    fixture tests do.
  - **`scripts/workflow/workload-contract.mjs` closes both request bodies**
    against the 2.7.1 contract and refuses with the API's own wire codes.
    `test/workload-contract.test.mjs` proves, against the pinned
    `@rathnasgala2/schemas/openapi/openapi.yaml` itself, that every declared
    member set, required set, closed vocabulary and numeric bound in that module
    is exactly the contract's — in both directions.
  - **The whole sequence runs in tests.** `test/fixtures/fake-oidc-issuer.mjs`
    mints real RS256 assertions over a real key pair at a real JWKS, and
    `test/fixtures/fake-gala-api.mjs` verifies them the way the API does and
    applies the API's own rules in the API's own order — including
    consume-before-body on the receipt route and the permanent tombstone after
    it. `test/workload-sequence.test.mjs` then runs exchange → kernel-driven
    deploy against the real `local-directory` adapter → receipt exchange →
    report as child processes, and asserts the replay path, the consumed
    capability, the masked output and the secret-free journal head.
  - **`@rathnasgala2/schemas` is pinned at 2.7.1** across every workspace
    manifest, `pins/ledger.json` and the ledger's own test.

- **PUBLISH-S4-2 — DEC-097 request-catalog fidelity, Pages OIDC and recovery,
  the activation-fence sentinel, and schemas 2.6.1.**
  - **Both provider request catalogs are now DEC-097 section 7's exact
    `(stage, callClass)` rows.** Pages declares the nine rows
    (`inspect/pages-site`, `activate`/`observe`/`rollback`
    `pages-deployment-status`, `activate`/`rollback` `pages-create-deployment`,
    `cleanup-staged/pages-cancel-deployment` and the two
    `pages-recovery-prior-*` rows); Spaces declares the 24-row union. Both carry
    the mandatory fixed `accept-encoding: identity` and `connection: close`
    headers, both sort their rows by member JCS bytes, and both resolve a call
    by the `(stage, callClass)` pair, so a call class that appears under several
    stages can no longer be issued under the wrong one. Spaces additionally
    signs `x-amz-acl: private` on every staged write and `public-read` on every
    served-root or marker write, carries the exact `cache-control` DEC-097
    assigns each object (`no-cache`, or `public, max-age=31536000, immutable`
    for an immutable manifest asset), and stores the generation marker as
    `application/json; charset=utf-8` with `no-store`.
  - **The two undeclarable signed `GET`s are gone.** DEC-097's closed Spaces
    catalog has no object-`GET` row, so the adapter no longer issues one: the
    generation marker is read over the credential-free website origin, the
    marker `ETag` the conditional pointer write needs comes from the declared
    `object-head` row, and activation writes the served root from the frozen
    envelope's own bytes instead of reading the stage back. The durable
    `stage.json` control object is gone with them — the stage token is now a
    reversible projection of the operation/attempt/generation identity, so
    resolving it needs no provider read. `rollback` without caller-supplied
    `files` now fails closed with `ROLLBACK_INPUT_UNAVAILABLE` rather than
    reading historical bytes back.
  - `request-catalog-binding.test.js` asserts **zero** undeclared requests for
    both adapters — the previous two-call `KNOWN_UNDECLARED` allowance is
    deleted — and additionally asserts that the `(stage, callClass)` the adapter
    announced matches the row the wire request actually matches.
    `spaces-list-staged-generations` is relabelled to its real stages
    (`inspect/generation-list` for this intent's own private staged prefix,
    `observe/generation-list` for the served root), and
    `spaces-head-served-object` is now the truthful `inspect`/`observe`
    `object-head` rows, which the lifecycle really issues.
  - **The Pages create body carries the mandatory `oidc_token`.** The
    `deploy-github-pages` job acquires the default-audience GitHub Actions ID
    token once from `ACTIONS_ID_TOKEN_REQUEST_URL` — which is what its
    `id-token: write` is for — through the new
    `scripts/workflow/pages-oidc.mjs`, which validates the closed request
    grammar and proves exact `githubActionsOidcOriginCatalog` membership
    _before_ the runner bearer is read. The adapter takes the token as
    caller-supplied input and never mints one; it parses the compact JWT, checks
    every binding claim (issuer, audience, both supported default environment
    subject forms with each component recomputed from the separately verified
    claims, ref/SHA/run/environment and `job_workflow_ref`/`job_workflow_sha`)
    and deliberately performs no issuer-signature or JWKS verification, making
    no such network call. Neither credential can reach the other's destination,
    and no evidence, digest, log or thrown message can contain either.
  - **DEC-097 section 6.2 Pages reconciliation recovery.** New `src/recovery.js`
    validates a server-supplied `pagesReconciliationRecovery` record — the
    `1..50`/`2..51` attempt fence, the `closed-no-destination-authority`
    tombstone set with its exact `GALA-PAGES-NO-AUTHORITY-RUN-ATTEMPT-V2`
    digest, the gap proof and the recovery digest — and never mints one. In
    recovery mode the adapter polls the prior attempt's catalog-constructed
    status endpoint before any current create: a terminal `succeed` suppresses
    the duplicate create and closes as `terminal-candidate`; an immutable
    terminal non-success permits the fresh create; a temporary status or 404
    permits exactly one cataloged cancel followed by bounded polling; and
    remaining ambiguity makes no create and returns the authority to
    `reconciliation-required`. `normal` mode forbids every recovery-prior call.
  - **LOCAL-47: `expectedCurrentGenerationId: null` no longer disables the
    activation fence.** `@rathnasgala2/adapter-protocol` (now `0.2.0`, protocol
    contract `2.1.0`) adds `EXPECT_NOTHING_SERVED`, `requireGenerationFence`,
    `fenceDisagrees` and `fenceFor`. `null` and `undefined` are now refused with
    `EXPECTED_GENERATION_FENCE_INVALID`, and the sentinel genuinely fences: a
    first-publish caller can no longer silently overwrite a live generation. The
    kernel's own `checkConcurrencyFence` carried the same defect on both sides
    (an absent `observedGenerationId` admitted an unfenced activation, and
    callers invented a `'none'` magic string) and is fixed the same way. The
    conformance kit gains two normative cases every adapter must pass, and the
    broken-adapter suite proves they are not vacuous. **Schema follow-up:** the
    `adapter-protocol` schema must make `expectedCurrentGenerationId` required,
    drop `null` from its type and admit the closed
    `generation identity | "gala:expect-nothing-served"` vocabulary, while
    leaving `null` legal on the _observation_ side (`observedGenerationId`,
    `currentGenerationId`) where it truthfully means "serves nothing".
  - **The section 6.3 limited-key denial proof runs before any mutation.**
    `adapter-do-spaces` gains DEC-097's closed four-row
    `gala-do-spaces-control-plane-http-v2` catalog and
    `proveLimitedKeyAccessDenied`, which issues the two
    `(limited-deployment, served|staging)` rows and requires an exact
    `403 AccessDenied` from each. `scripts/workflow/deploy.mjs` runs it as the
    do-spaces job's first destination contact. It fails closed in both
    directions: a limited key that _can_ read a bucket configuration is
    `SPACES_LIMITED_KEY_OVERPRIVILEGED`, and anything short of a well-formed
    denial — including a `404 NoSuchWebsiteConfiguration`, a malformed body or
    absent credentials — is `SPACES_LIMITED_KEY_DENIAL_UNPROVEN`.
  - `@rathnasgala2/schemas` is re-pinned to **2.6.1** (LOCAL-43; sha256
    `4496bac0…4928`) across every workspace package, and the SBOM is
    regenerated.
  - `npm run verify` now also runs `workflows:drift`.
  - The Pages carrier's basename and Actions artifact name are both exactly
    `gala-pages-r<runId>-a<runAttempt>`, per slice brief section 2.3; the
    `.tar.gz` suffix on the basename is gone.

### Fixed

- `npm run pins:check` now actually verifies a package pin. The ledger recorded
  the schemas tarball's `sha256` but nothing compared it to anything: a re-pin
  could name one version and install another. Package pins are now checked in
  both directions like every other pin — the recorded digest must equal the
  SHA-256 of the tarball on disk, a tarball that cannot be found fails closed
  rather than passing unverified, and a ledger entry no manifest or lockfile
  declares is refused.
- `npm run verify` could fail at `sbom:check` purely because a test had run
  first. The conformance kit's broken-adapter test wrote its scratch script
  inside a workspace package directory; creating any file there makes `npm ls`
  treat the install tree as out of date, after which it stops reporting the
  `integrity` and development-scope facts `cyclonedx-npm` records, so the
  regeneration no longer matched the committed document. The scratch script now
  lives under the OS temp directory and imports everything by absolute `file:`
  URL, so the test writes nothing inside the repository at all.

- Post-merge review of PUBLISH-S4-1 (`PUBLISH-S4-REVIEW`):
  - Spaces requests are sent on exactly the request line they were signed on.
    `src/s3.js` rendered the URL with bare `encodeURIComponent` while the signer
    canonicalised the sub-delimiters `!'()*`; both forms verify against MinIO
    (proved by running the conformance suite against the throwaway container
    with such a key both before and after the change), so this is hardening
    against a stricter intermediary rather than a defect. The shared conformance
    fixture now always stages a key carrying those bytes.
  - The Spaces stage prefix is derived only from path-safe identity segments,
    and cleanup deletes only a prefix this adapter could itself have derived
    (`SPACES_STAGE_IDENTITY_INVALID`, `SPACES_CLEANUP_PREFIX_REFUSED`), so a
    traversal-bearing identity or a stage record planted in the staging bucket
    cannot widen the reserved prefix that cleanup deletes by prefix.
  - A Spaces activation that loses the marker race now reports
    `destinationChanged: true` with its written/superseded counts: the
    served-root writes it already made cannot be undone, and no journal may
    record that outcome as leaving the destination untouched.
  - The Pages carrier refuses any member path that could extract outside its own
    root (`PAGES_CARRIER_PATH_REFUSED`), and the codec is proved to emit only
    regular-file entries with an empty linkname field.
  - The Pages REST catalog pins `x-github-api-version: 2026-03-10` and the
    create-deployment body sends `artifact_id` as a canonical JSON integer, both
    per DEC-097 section 7.
  - The carrier walker refuses a symlink instead of silently skipping it, so a
    build output that links at a host path fails the run rather than being
    published with a silently missing member.
  - `scripts/workflow/deploy.mjs` fails closed. It previously exited zero after
    writing a journal containing a `staging` attempt record for a deployment
    that had not happened; it now writes the bound, credential-free journal head
    it can actually prove, records `DEPLOY_LIVE_EXECUTION_UNAVAILABLE` and
    fails, so a deploy job that did not deploy can never report success.
  - Every carrier upload passes `archive: false`, as slice brief section 2.3
    requires. `actions/upload-artifact` v7 defaults `archive` to `true`, so
    without it the action's reported `artifact-digest` is the digest of a zip
    while `observe-carrier.mjs` rehashes the carrier bytes — every run would
    have failed at the first upload with `CARRIER_UPLOAD_DIGEST_MISMATCH`.

### Added

- Review gates (`PUBLISH-S4-REVIEW`): a request-catalog binding test that fails
  on any Spaces request no template describes, cleanup-prefix fuzzing, a
  two-activator concurrency race, a credential-hygiene scan over every artefact
  a Spaces run produces, Pages carrier containment goldens, and sandbox proofs
  that no unix socket is visible inside the container, that a timed-out build
  leaves no container behind, and that a symlink planted in the build output is
  never followed off the volume.
- `@rathnasgala2/adapter-github-pages` is implemented (S4-T04, backlog W4-11):
  deterministic gzip/POSIX.1-1988 ustar Pages carrier, the raw four-call Pages
  REST catalog, `pagesDeploymentId == pagesBuildVersion` equality, the exact
  eleven-status vocabulary with its temporary/terminal partition, the exact
  `5, 8, 12, 18, 27, 30`-then-`30` poll schedule, a never-followed `status_url`,
  and credential-free public verification. It passes the full
  `adapter-conformance-kit` suite against a local fake provider that speaks real
  HTTP and genuinely untars the carrier.
- `@rathnasgala2/adapter-do-spaces` is implemented (S4-T05, backlog W4-11): the
  exact two-bucket website binding and its origin refusals, a dependency-free
  SigV4 signer validated against the published AWS `aws-sig-v4-test-suite`
  vector, private generation-prefixed staging with multipart upload above the
  declared 5 MiB single-part ceiling, replace-in-place activation that writes
  the generation marker last under a conditional `If-None-Match`/`If-Match`
  guard, operation-scoped cleanup and reupload rollback. It passes the full
  conformance suite twice: against an in-process S3-compatible fake, and against
  a throwaway MinIO container pinned to the digest in
  `infra/release/container-images.json`.
- The reusable workflow graph (S4-T06): `.github/workflows/publish-v2.yml` with
  DEC-097's exact nine jobs, `needs`, literal job conditions, environments,
  timeouts and permission sets, plus the same-commit `authorize-v2.yml` and
  `report-v2.yml` helpers and the fixed caller example under `docs/callers/`.
  Every action is pinned to a full commit SHA.
- The build sandbox (S4-T07): `scripts/sandbox-build.sh`, a workflow job that
  uses it, and `test/sandbox.test.mjs`, which proves no network, a read-only
  source mount, an output-only writable path, non-root execution, a
  deterministic secret-free environment and hard timeout termination by running
  builds that attempt each violation.
- Pin ledgers, the caller documentation and the environment-gate documentation
  (S4-T08): `pins/ledger.json`, `npm run pins:check` (a bidirectional drift
  gate) and `docs/callers/README.md`, which names every DEC-015 secret and both
  environment gates.
- `scripts/minio-spaces.sh` starts and removes a throwaway, digest-pinned MinIO
  server for the opt-in Spaces conformance run. It is deliberately not the local
  stack's MinIO: an adapter must never be proven against a server other work
  also writes to.

### Changed

- `npm test` now also runs the repository-level suites in `test/`, and
  `npm run verify` additionally runs `npm run pins:check`.

### Known gaps

- `POST /v2/workloads/github/receipt-exchanges` and
  `POST /v2/workloads/deployment-receipts` are contract-only until backlog W4-12
  lands S4-T11/T12 (LOCAL-17). `scripts/workflow/exchange.mjs` and
  `scripts/workflow/report.mjs` assemble and bound the exact request and then
  fail closed with a typed blocker rather than fabricating an intent or claiming
  a submitted report.
- The live GitHub Pages deployment API, the live DigitalOcean Spaces API, the
  `GetBucketWebsite` control-plane checks and the limited-key `AccessDenied`
  proof need real credentials and remain backlog W4-16.

### Added (earlier, S2)

- Workspace scaffold: six `packages/*` npm workspace members (`publish-kernel`,
  `adapter-protocol`, `adapter-local-directory`, `adapter-github-pages`,
  `adapter-do-spaces`, `publish-action`), shared ESLint flat config, Prettier,
  `tsc --checkJs --noEmit` per package, dependency-cruiser adapter-isolation
  gate, `jscpd` duplication scan, the Node native test runner and a
  `cyclonedx-npm` SBOM script (S2-T15).
- `@rathnasgala2/adapter-protocol`: the mandatory eight-function adapter
  lifecycle interface, the closed lower-case three-row capability union with
  filesystem/HTTP provider limit profiles (DEC-097 §7), RFC 8785 JCS/SHA-256
  request/response/evidence digest helpers, an in-process frame/message contract
  that enforces the DEC-086 1,048,576-byte ceiling, an in-process adapter
  loader, and negotiation that issues a `TARGET_CAPABILITY_UNAVAILABLE` refusal
  before staging when policy requirements are unmet (S2-T15).
- `@rathnasgala2/publish-kernel`: all ten non-disableable publish safety kernel
  duties (DEC-016), composing only `adapter-protocol`, plus the DEC-097
  `capabilityDecision`/`capabilityDecisionDigest` record and
  `public-generation-marker:2.0.0` construction/validation (S2-T16).

- `@rathnasgala2/adapter-conformance-kit`: the reusable `node:test` suite every
  deployment adapter must pass — lifecycle shape, capability truthfulness
  against the protocol's exact admission table, staging privacy, activation
  atomicity/replace semantics, observe/verify and tamper detection, cleanup of
  staged state, rollback, idempotent re-run, a digest-mismatch activation
  refusal, and a genuine interrupted-activation recovery test (S2-T17).
- `@rathnasgala2/adapter-local-directory`: the reference POSIX local-directory
  deployment adapter implementing all eight lifecycle functions against the
  `gala-local-directory-filesystem-v2` oracle (DEC-097 §7's `local-directory`
  row) — symlink-based atomic pointer-swap activation, `fsync` discipline on
  files and directories, an on-disk symlink-escape probe at preflight, a live
  (reduced-iteration, documented) atomic-replacement/exclusive-link filesystem
  probe feeding `describeCapabilities`, generation-marker placement, digest-
  checked activation with a crash-injection test seam, and on-disk retention of
  the active generation plus five priors (a physical directory sweep, not only
  bookkeeping). Passes the conformance kit's full suite and an end-to-end test
  that takes a `@rathnasgala2/template`-rendered candidate directory through
  kernel preflight/stage/activate/observe/cleanup and asserts the public
  generation marker and byte-identical served output (S2-T17).

### Fixed

- `npm run sbom` no longer rewrites `sbom.cdx.json` with a fresh random
  `serialNumber`/`metadata.timestamp` on every run; both are normalized to fixed
  sentinel values immediately after generation (`scripts/normalize-sbom.mjs`),
  and `scripts/check-sbom-fresh.mjs` now asserts the committed file is
  byte-identical to a fresh regeneration, so `npm run verify` leaves
  `git status --porcelain` clean (S2-T16).
- The literal raw NUL byte in `packages/publish-kernel/src/path-containment.js`
  (which made git treat the file as binary) is now the `'\x00'` escape (S2-T17).

### Fixed (independent review of S2-T17)

- `adapter-conformance-kit`'s digest-mismatch activation-refusal test placed
  `assert.fail` inside the same `try` its `catch` guarded, so the suite wrongly
  passed even against an adapter with no integrity checking at all (the
  `AssertionError`'s own message happened to satisfy the catch block's loose
  match). Restructured with `assert.rejects`, renamed to describe what it
  actually tests, and every other assertion in the kit audited for the same
  pattern. Added `test/suite-catches-broken-adapter.test.js`, a standing
  regression test that runs the suite, in an isolated child process, against a
  deliberately broken adapter and asserts that run fails.
- `adapter-local-directory`'s `activate` now physically deletes
  `releases/<generationId>` directories that fall out of the retained window,
  not only the `history.json` bookkeeping (`test/retention.test.js` activates
  seven generations and counts on-disk directories).
- Added a genuine interrupted-activation test (`activate`'s optional
  `crashInjectionHook`, invoked strictly between staging completion and the
  pointer swap; `cleanupStaged`'s optional `generationId` recovers the abandoned
  candidate), and renamed the previous "crash-injection" test to describe what
  it actually exercises (a wrong expected digest, not a process crash).
- `generateUuidV7` moved from `adapter-local-directory` into `adapter-protocol`
  (both `adapter-local-directory` and `adapter-conformance-kit` already depend
  on it), removing the duplicate implementation.
