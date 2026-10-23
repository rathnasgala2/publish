# publish

Galascribe v2 publish workspace.

This npm workspace holds the provider-neutral publish safety kernel, the
in-process deployment adapter protocol, the three S2 destination adapters and
the single author-facing orchestration entry point. See
`orchestration/slice-briefs/S2-author-owned-publication.md` section 5 for the
full specification and `orchestration/decisions/DEC-097-*.md` section 7 for the
closed adapter-capability contract.

## Packages

| Package                                 | Status                                                |
| --------------------------------------- | ----------------------------------------------------- |
| `@rathnasgala2/publish-kernel`          | implemented (S2-T16), source-only (`private: true`)   |
| `@rathnasgala2/adapter-protocol`        | implemented (S2-T15), published to npm                |
| `@rathnasgala2/adapter-conformance-kit` | implemented (S2-T17), source-only (`private: true`)   |
| `@rathnasgala2/adapter-local-directory` | implemented (S2-T17), published to npm                |
| `@rathnasgala2/adapter-github-pages`    | implemented (S4-T04), published to npm                |
| `@rathnasgala2/adapter-do-spaces`       | implemented (S4-T05), published to npm                |
| `@rathnasgala2/publish-action`          | implemented (S2-T20/S2-T20b), source-only (`private`) |

## Commands

Node.js 24.18.0 and npm 11.16.0 are pinned (`engines`, `.nvmrc`,
`.node-version`).

```sh
nvm use
npm ci
npm run verify
```

Schemas 3.16.0, template 4.4.1 and the six generation-4 themes (all at 4.2.0)
are installed from the public npm registry at exact versions; the lockfile
carries their integrity. `THEME_CATALOG` records each theme tarball's registry
SHA-256.

`npm run verify` runs formatting, lint, `tsc --checkJs --noEmit` per package,
the dependency-cruiser architecture gate, `jscpd` duplication scan, the Node
native test suite, the CycloneDX SBOM freshness check, `npm audit`, the workflow
pin and gitleaks-fragment drift gates and the pin ledger. See `CLAUDE.md` for
the full command list and architecture boundaries.

The `do-spaces` MinIO conformance suite runs only when `SPACES_MINIO_ENDPOINT`
names a running server (`scripts/minio-spaces.sh up` starts the pinned throwaway
one and prints the variable); `test/sandbox.test.mjs` needs a Docker daemon. A
full `verify` is one with both present.

### Working from an isolated checkout

`npm ci --ignore-scripts` installs schemas, template and every generation-4
theme from the registry; no sibling checkout is required. Set
`WORKSPACE_ROOT="$PWD/node_modules/@rathnasgala2"` when directly running tests
or commands that use the template/theme bridges. The reusable workflow and owned
CI workflows set the equivalent path themselves.

## SBOM reproducibility (`sbom:check`)

`npm run sbom` normalizes `serialNumber` and `metadata.timestamp` (the two
fields `cyclonedx-npm` randomizes/stamps on every run) to fixed sentinel values
(`scripts/normalize-sbom.mjs`), and `npm run sbom:check` verifies the committed
`sbom.cdx.json` is byte-identical to a fresh regeneration in the _current_
environment.

Beyond those two normalized fields, `cyclonedx-npm` also embeds facts that are
legitimately specific to the machine and npm installation that generated it:
resolved package `integrity`/hash values can differ across registry mirrors or
npm versions, and component `properties` capture the actual dev/prod install
scope and platform-conditional optional dependencies present in that
`node_modules` tree. These are not spurious noise the same way a random UUID or
a wall-clock timestamp is — they are truthful facts about one environment's
install — so this repository does not attempt to normalize them away. The
practical consequence: `sbom:check` is a same-environment regeneration check
(does this checkout's SBOM match what this checkout's `npm ci` currently
produces), not a cross-environment reproducibility guarantee. A freshly cloned
checkout on a different machine, npm version or registry mirror can legitimately
produce a different (but equally valid) `sbom.cdx.json`, and regenerating it
there with `npm run sbom` before committing is expected, not a bug.

## The two workload callers (PUBLISH-S4-3)

`scripts/workflow/exchange.mjs` and `scripts/workflow/report.mjs` are the only
two places this repository talks to Gala, and they reach exactly two routes:
`POST /v2/workloads/github/receipt-exchanges` (both purposes) and
`POST /v2/workloads/deployment-receipts`.

- **The origin is an input.** `publish-v2.yml`'s required `gala_api_origin` is
  threaded to both same-commit helpers. `scripts/workflow/gala-api.mjs`
  validates it as an exact scheme/host/port origin, refuses embedded
  credentials, a path, a query or a fragment, and refuses any scheme but `https`
  — with one narrow exception for a loopback `http` origin gated on
  `WORKLOAD_ALLOW_LOOPBACK_ORIGIN=1`, which no workflow sets and only this
  repository's fixture tests do.
- **Validation happens before the credential is acquired.**
  `scripts/workflow/workload-contract.mjs` closes both request bodies against
  the pinned 2.8.x contract and refuses with the API's own wire codes
  (`VALIDATION_FAILED`, `REQUEST_FIELD_UNKNOWN`,
  `VERIFICATION_EVIDENCE_LIMIT_EXCEEDED`). Only then is the single-use OIDC
  assertion requested, so a body the API would refuse never spends one.
  `test/workload-contract.test.mjs` proves that module agrees with
  `@rathnasgala2/schemas/openapi/openapi.yaml` by exact equality, in both
  directions.
- **Identities are derived, not invented.**
  `scripts/workflow/workload-identity.mjs` derives the artifact, attempt and
  proposed-generation `stableId`s, the `pagesBuildVersion` (the run's head
  commit SHA, which GitHub validates as a commit) and the exact Spaces staging
  prefix from the bound run identity, so a rerun of one authorized attempt
  derives the same values and the exchange is a replay rather than a second
  claim.
- **No credential is ever written down.** The assertion is never persisted. The
  issued reporting capability reaches one masked `$GITHUB_OUTPUT` line; the
  job's journal head records only the fact of issuance, the generation and the
  expiry.
- **`kernel-run.mjs` is the provider-neutral run.** All three adapters implement
  the same lifecycle, so the stage/observe/activate/cleanup sequence is written
  once, driven by `publish-kernel`'s duty evaluation and adapter protocol
  2.1.0's explicit fence sentinel. A refused stage is recorded `skipped`; an
  activation whose outcome could not be established is recorded `unknown`, never
  rounded off.

### The 2.8.0 contract (PUBLISH-S4-4b)

- **The exchange answer is one of three flat members keyed on an optional
  `kind`** (`deployment-intent`, `deployment-receipt-capability-issued`,
  `deployment-receipt-submission-recorded`). `gala-api.mjs` classifies on
  `purpose`/`state`, which every server since 2.7.x sends, treats a present
  `kind` as a claim that must name the same arm, and returns the `kind` (or
  `null` from a 2.7.x server). `exchange.mjs` records it as `responseKind` in
  every journal head and carrier, and `deploy.mjs` records it as
  `authorizationResponseKind` in the kernel journal head, so a run states which
  contract generation authorized it. A kind-less body still parses
  (`test/gala-api.test.mjs`).
- **`pagesBuildVersion` and `spacesStagePrefix` are optional on the intent
  request** (LOCAL-57). The API derives both: `spacesStagePrefix` from the
  closed binding
  `(repositoryId, operationId, runId, runAttempt, artifactDigest)` and
  `pagesBuildVersion` as the run's head commit SHA (the OIDC `sha` claim), each
  exactly as `workload-identity.mjs` does, so the builder keeps sending its own
  derivation where it holds every input (`sendDerivedConditionalMembers: false`
  omits it where it does not), and a disagreement is `422 VALIDATION_FAILED`.
  The fake API mirrors that rule and the retained intent always carries the
  derived values; `derivationsAccepted` in the exchange journal head records the
  API's agreement.
- **`destination.providerBinding`** (LOCAL-55 (2)): `{owner, repository}` for
  `github-pages`, `{region, servedBucket, stagingBucket}` for `do-spaces`,
  forbidden for `local-directory`, closed by the contract validator per adapter.
  `deploy.mjs` builds its provider destination from the authorized binding and
  nothing else: an intent without one fails closed, and a Pages binding naming a
  repository other than the one the runner's OIDC token is minted for
  (`GITHUB_REPOSITORY`) is refused before a credential is read; the two numeric
  ids the Pages OIDC subject is recomputed against come from the runner's own
  `GITHUB_REPOSITORY_ID`/`GITHUB_REPOSITORY_OWNER_ID`.
- **The fence is one string pattern** carrying adapter protocol 2.1.0's
  `gala:expect-nothing-served` sentinel, and the verification submission's two
  arms are the named `VerificationSubmissionFit`/`VerificationSubmissionUnfit`
  components discriminated on `state`; `test/workload-contract.test.mjs` pins
  both against the pinned OpenAPI document.
- **The Pages call-class binding is declared** in the capability document
  (`limits.callClassBinding` + `callClassBindingDigest`); see
  `packages/adapter-github-pages/README.md`.
- `test/workload-derivation.test.mjs` runs exchange → kernel run → receipt
  exchange → report → replay through all three adapters against their fakes and
  asserts the `kind`, the binding and the derivation agreement at every step.

### The intent is the only authority a job binds to (PUBLISH-S4-5)

The deployment-intent exchange response _is_ the Gala-side authorization, and
`scripts/workflow/authorized-intent.mjs` is the one place a later job reads it.
`verify-spaces-configuration.mjs`, `deploy.mjs` and `report.mjs` all bind
through it, and every value they act on is the retained intent's:

| What the job uses                                                    | Where it comes from                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adapter id, version, digest                                          | `intent.adapter` (must agree with `intent.destination`)                                                                                                                                                                                                 |
| destination identity (environment, target, base URL)                 | `intent.destination`                                                                                                                                                                                                                                    |
| provider coordinates (Pages owner/repository; Spaces region/buckets) | `intent.destination.providerBinding`; absent → `DEPLOY_DESTINATION_BINDING_INVALID`, never invented                                                                                                                                                     |
| activation fence                                                     | `intent.expectedGenerationId`; absent = DEC-097's first publish = `gala:expect-nothing-served`                                                                                                                                                          |
| operation, attempt, proposed generation, artifact ids                | the intent; the marker and the destination mutation authority must name the same                                                                                                                                                                        |
| workload and publish ref                                             | the intent's `subject` is the DEC-097 URN `urn:gala:workload:github:<repositoryId>:<runId>:<runAttempt>`, checked against the runner's own ids; `workloadBindingDigest` commits the ref; the OIDC `repo:…:ref:…` form is `DEPLOY_INTENT_SUBJECT_LEGACY` |

Nothing is taken from a workflow input or from an environment variable naming a
destination; the environment contributes only the runner's own bound identity
and, in the deploy job, the credential. The binding refuses with a closed code —
`DEPLOY_INTENT_MALFORMED`, `DEPLOY_INTENT_INCONSISTENT`,
`DEPLOY_INTENT_IDENTITY_MISMATCH`, `DEPLOY_INTENT_SUBJECT_LEGACY`,
`DEPLOY_INTENT_EXPIRED`, `DEPLOY_DESTINATION_BINDING_INVALID` — and the kernel
journal head records `authorization`: every member used, its `intentDigest`,
`fenceSource`, the workload `subject` and `workloadBindingDigest`, and the
authority's `destinationMutationKeyDigest` (Gala's own
`GALA-DESTINATION-MUTATION-KEY-V2` fence key, a different domain from
`targetDigest`; recorded, never recomputed).

`kernel-run.mjs` evaluates that fence against what the destination is observed
serving _before staging_ (a disagreement is a `REJECTED` staging attempt with no
provider mutation) and again on a fresh observation immediately before
activation; the observed generation is recorded next to the expected one.
`adapter-protocol`'s `requireGenerationFence` admits exactly the schema's
`oneOf(stableId, sentinel)`, so no fence a job passes is looser than the wire.

The report path is bound the same way: `report.mjs` refuses an intent not bound
to the runner's repository and ref, a kernel journal whose head (`operationId`,
`attemptId`, `generationId`, `adapterId`, `adapterVersion`,
`authorization.intentDigest`) was not produced under that intent, and a runner
repository id the intent's rebuild record was not bound to.

**A journal on every exit.** `deploy.mjs` leaves exactly one kernel journal at
`--out` on every path, so the report job always has something to report. When
the kernel ran to an outcome that is its journal (an `outcome` of `activated` or
`failed`; a `failure: {code, stage, message}` member names the classified
failure when there is one: `KERNEL_<STAGE>_FAILED` for an adapter call that
threw, or the code the adapter put in its own result, such as
`PAGES_PUBLIC_REDIRECT`). When the job fails before or around the kernel, the
journal is a failure journal: `outcome: failed`, `failure`, empty `attempts`,
`observations` and `observedRoutes`, and every identity member known by then.
The codes are `OPTIONS_INVALID`, `ENVELOPE_INVALID`, `AUTHORIZATION_INVALID`,
`INTENT_MISMATCH`, `CAPABILITY_MISMATCH`, `CREDENTIAL_PROOF_FAILED`,
`CARRIER_UNREADABLE`, `OIDC_FAILED`, `BINDING_INVALID`, `DIGEST_MISMATCH`,
`JOURNAL_WRITE_FAILED` and `DEPLOY_CRASHED` (a defect in the run itself). A
journal that cannot be written (including `JOURNAL_WRITE_FAILED`, which is only
ever logged) prints one line, `GALA_DEPLOY_NO_JOURNAL <code>`, to stderr; the
deploy step captures it as the job's `failure_code` output.

The report job runs for every failed deploy (a cancelled one is deliberately not
reported). With a kernel journal it reports as before. With none, or with a
failure journal that has no attempts, `report.mjs` posts the journal-less
failure submission to the same route and capability: the receipt submission
without `kernelJournal`, with `observedRoutes: []`, `workflowStartedAt` equal to
`workflowCompletedAt` (the report's own cutoff; no kernel instant exists), and
`deployFailure: {journal: 'absent', failureCode, stage?}`. `failureCode` is the
failure journal's code, else the printed marker's, else `DEPLOY_CRASHED`; a code
outside `^[A-Z][A-Z0-9_]{2,63}$` is not trusted and becomes `DEPLOY_CRASHED`.
The error text stays in the journal carrier and the job log, never in the
receipt. Every journal head also records `verifiedAt: {origin, baseUrl}`: the
base URL the run's public reads were made against
(`destination.verificationBaseUrl` when the intent names one, the origin serving
right now, else `baseUrl`) and its strict origin (`https://host[:port]`, no
path); the receipt submission carries only the optional `verifiedAt: {origin}`.
A malformed `verificationBaseUrl` refuses the run as `INTENT_MISMATCH` before
any destination contact. This shape is not in the pinned schemas contract, so it
is validated here by `validateJournalAbsentSubmission` and awaits the API's
acceptance.

**Freeze, on the real path.** `freeze.mjs` freezes the envelope under the
adapter the verified source's lock selects (DEC-097 section 3's closed
package-to-`adapterId` mapping; the artifact digest is that adapter's own
projection). `build-authorization-input.mjs` then writes the authorization input
after the envelope has been uploaded and re-observed, deriving every member from
its owner — the lock (`lockDigest`, `publisher`, `adapter`, the three direct
package projections), the publication (`destination.baseUrl`), the checkout's
commit facts `prep` records (`sourceTree`, `buildEpoch`), the frozen bytes
(counts, verification plan, the envelope's own manifest, provenance and SBOM
digests, the manifest's `buildInputDigest` and `workflowIdentity`), the build's
two validated fact records (`build-facts.mjs`: the normalized `build-input.json`
and the verified `theme-contract.json` the build leaves next to its manifest,
carried as `metadata/build-input.json` and `metadata/theme-contract.json`), the
runner's bound identity (operation, repository id, run, commits and, for Pages,
the provider coordinates) and the verified upload (handoff id, name, retention,
observed expiry). Since schema 2.9.0 (LOCAL-60) the request carries only those:
`destination.environment`/`targetDigest`, the Spaces provider coordinates,
`rebuildRecord`'s four Gala-owned members (`policyReleaseId`,
`buildPolicyDecisionDigest`, `packageReleaseCatalogDigest`,
`destinationCapabilityDigest`) and `capabilityDecisionDigest` are the API's to
derive, and it refuses a present disagreeing value with `422 VALIDATION_FAILED`
naming the member. A workflow-held member the workflow does not have — a
checkout whose git object database could not state the tree or committer
instant, a build carrier without its fact records — fails the step closed with
`AUTHORIZATION_INPUT_INCOMPLETE` naming it and its owner, and writes no partial
input; a build fact that disagrees with its owning record (`baseUrl` vs the
publication, package rows vs the lock, the theme contract's `package`) is
`AUTHORIZATION_INPUT_BUILD_DISAGREEMENT`. `test/authorization-input.test.mjs`
runs `freeze.mjs` and `build-authorization-input.mjs` as child processes over
the real minimal-repository fixture and proves the complete Pages input is
written and is the exact request `authorize` sends.

### The 2.9.0 contract: Gala derives the destination, policy and capability members (PUBLISH-S4-6b)

- **The request carries what the workflow holds** (LOCAL-60, design
  `scrap/20260918_intent-request-derivation-design.md`). `workload-contract.mjs`
  keeps both shapes: `checkRequestDestination` for the request-side
  `ReceiptExchangeIntentRequestDestination` (`adapterId`, `adapterVersion`,
  `baseUrl` required; `environment` optional and, when present, the adapter's
  constant; `targetDigest` optional; `providerBinding` `{owner, repository}` for
  `github-pages`, `{rootIdentityDigest, mutationSurfaceDigest}` for
  `local-directory`, forbidden for `do-spaces` until C2) and `checkDestination`
  for the retained `destinationIdentity` (five required members, `environment`
  now the closed per-adapter constant — LOCAL-60a — and the retained
  coordinates). `checkRebuildRecord` requires the seventeen workflow-held
  members and admits the four Gala-owned ones; `capabilityDecisionDigest` is
  optional. `test/workload-contract.test.mjs` pins every set against the pinned
  OpenAPI document and the retained JSON schema.
- **`exchange.mjs` refuses an intent for another adapter** — the destination's
  `adapterId` must be the lock's and its `environment` the adapter constant
  (`WORKLOAD_INTENT_DESTINATION_MISMATCH`) — and its journal head states which
  members the API retained from this job (`derivationsAccepted.destination`,
  `.rebuildRecord`) and which it derived (`apiDerived`).
- **The intent `subject` is the DEC-097 workload URN.** `authorized-intent.mjs`
  binds to `urn:gala:workload:github:<repositoryId>:<runId>:<runAttempt>` (the
  runner's `GITHUB_REPOSITORY_ID`/`GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT`) and to
  the required `workloadBindingDigest`, never to a repository name; the OIDC
  `repo:…:ref:…` form a pre-API-INTENT-DERIVATION-1 server renders is refused as
  `DEPLOY_INTENT_SUBJECT_LEGACY`. There is no compatibility branch: the two
  forms bind different things, and the API renders the URN.
- **The capability decision is recomputed before staging (LOCAL-62).**
  `capability-decision.mjs` builds the API's issuance-phase `capabilityDecision`
  record — every member except the Pages carrier's byte count and digest, with
  the four `maximum*` members carrying the admitted bounds — from the intent,
  the runner's run identity and the API's admission row, selected by
  `(adapterId, adapterVersion)` exactly as the API selects it (LOCAL-64):
  release 0045 seeded the three adapters at the protocol version `2.0.0`
  (superseded, admits nothing); release 0046 (API-FOLLOWUPS-8) admits the same
  three at the published _package_ version `0.1.0`. Both releases' rows are
  mirrored row for row and pinned by digest to their seeded literals in
  `test/capability-decision.test.mjs`; a superseded or never-admitted version is
  `CAPABILITY_ADMISSION_UNKNOWN` (surfaced as `422 /adapter/adapterVersion` by
  the fake and the caller). `deploy.mjs` refuses an intent whose
  `capabilityDecisionDigest` is not that record's digest
  (`DEPLOY_CAPABILITY_DECISION_MISMATCH`) and records the deploy-phase facts
  (`capabilityDecision.deployPhase`: exact totals over the payload plus the
  marker, the Pages carrier digest) as journal evidence. The issuance/deploy
  member sets are read from the pinned schema's `x-gala-decision-phase`
  annotations (`capability-decision.mjs`, PUBLISH-S4-7), not hard-coded; see
  below.
- **`test/fixtures/fake-gala-api.mjs` mirrors API-INTENT-DERIVATION-1:** it
  derives the destination (`environment`, the Pages binding from the seeded
  repository, the local binding from the request's digests, the Spaces binding
  from a seeded destination record (PUBLISH-S4-7, below), `targetDigest` with
  the schema package's `destinationProviderBinding` profile and the fence key
  with `destinationMutationKey`), the four rebuild-record members
  (`buildPolicyDecision` profile over the honest `pass` decision) and the
  issuance-phase capability decision, refuses a present disagreeing member with
  `422 VALIDATION_FAILED` and `errors[0].pointer`, refuses `adapter.adapterId` ≠
  `destination.adapterId` at `/destination/adapterId`, an adapter version the
  admission row does not admit at `/adapter/adapterVersion`, a destination
  version other than the adapter's at `/destination/adapterVersion`, a
  `local-directory` request without its digests at
  `/destination/providerBinding`, and `do-spaces` with no seeded destination
  record with `409 INVALID_SOURCE_STATE`; `gala-api.mjs` surfaces the problem's
  `errors[]` pointers on `GalaApiError.errors`. The sixteen
  `parity/digest-record-vectors.json` vectors reproduce through the same
  profiles (`test/workload-derivation.test.mjs`).

### DEC-097 Spaces closed records and destination-record issuance (C2, schema 2.10.0, PUBLISH-S4-7)

- **`packages/adapter-do-spaces/src/dec097-records.js`** builds DEC-097's two
  per-destination closed records with the pinned schema's own
  `ACTIVE_DIGEST_PROFILES`: `spacesWebsiteConfiguration({basePath})` (deriving
  `errorDocumentKey` — `404.html` at the root, `<segments>/404.html` otherwise)
  and
  `spacesControlPlaneBinding({servedBucket, stagingBucket, region, websiteOrigin, websiteConfigurationDigest})`,
  plus `spacesRegionCatalog({regions})` for the server-owned compatibility
  release shape. These are distinct from, and never confused with, this
  adapter's own existing internal
  `WEBSITE_CONFIGURATION`/`CONTROL_PLANE_BINDING` declaration profile
  (`capability.js`, `GALA-SPACES-*` domains, a fixed claim about what this
  adapter always requires) — the new builders are the `GALA-DO-SPACES-*` DEC-097
  records, computed per destination and proven byte-for-byte against the five
  2.10.0 vectors including the chained realistic
  `destination-provider-binding-do-spaces-realistic` vector
  (`packages/adapter-do-spaces/test/dec097-records.test.js`).
- **`capability-decision.mjs`'s `recomputeSpacesClosedRecords(intent)`** is the
  one shared recomputation of both records from an authorized intent's
  `destination.providerBinding` (`region`, `servedBucket`, `stagingBucket` — the
  three coordinates DEC-097 keeps on the wire) and `rebuildRecord.basePath` (a
  workflow-verifiable fact, never an API derivation) — the single implementation
  both `verify-spaces-configuration.mjs` and `deploy.mjs` call, so they cannot
  independently drift on what "recompute" means.
  `requireCapabilityDecisionAgreement` takes the result as an optional third
  argument and fails closed by name
  (`CAPABILITY_DECISION_SPACES_DIGEST_MISSING`) when a do-spaces intent is
  recomputed without it.
- **`verify-spaces-configuration.mjs`** recomputes both closed records and
  requires their digests to equal the intent's pre-authorized capability
  decision _before_ either live `GetBucketWebsite` call (DEC-097 lines
  8446-8449: "must equal these pre-authorized values before staging"); its
  evidence record's `requiredConfiguration`/`requiredControlPlaneBinding` carry
  the DEC-097 records themselves. Live control-plane evidence stays owner-gated
  (W4-16).
- **The fake Gala's seeded destination**: `startFakeGalaApi`/`seedWithDefaults`
  accept
  `destination: {adapterId: 'do-spaces', spaces: {region, servedBucket, stagingBucket, basePath}}`
  — the publication_destination-equivalent record a do-spaces request is
  admitted against. No seeded destination is `409 INVALID_SOURCE_STATE`; a
  seeded destination for another adapter is `422 /adapter/adapterId`; the
  derived website origin (from the destination's own bucket/region/basePath)
  disagreeing with the request's `destination.baseUrl` is
  `422 /destination/baseUrl`; the workflow's `rebuildRecord.basePath`
  disagreeing with the destination's own base path is
  `422 /rebuildRecord/basePath`. The rendered intent's
  `destination.providerBinding` is the three retained coordinates only, never
  the complete ten-member closed record.

### The frozen envelope is DEC-097's, with its manifest, provenance and SBOM records (PUBLISH-S4-6a)

`scripts/workflow/frozen-envelope.mjs` is the `gala-frozen-envelope-v2` codec
(DEC-097 section 6, "Frozen handoff envelope"):
`ASCII("GALA-FROZEN-ENVELOPE-V2\n")`, a `u32` record count, then
`kind:u8 || pathByteCount:u32 || contentByteCount:u64 || path || content`
records — every artifact file as a `0x01` payload record in path UTF-8 byte
order, then exactly `metadata/artifact-manifest.jcs` (`0x02`, the complete
`artifact-manifest:2.0.0`), `metadata/provenance.jcs` (`0x03`,
`buildProvenance:2.0.0`) and `metadata/sbom.spdx.json` (`0x04`, SPDX 2.3), in
that order, as compact JCS. No compression, padding, trailer or timestamp; the
DEC-097 caps (200,003 records, 1 GiB envelope, 256 MiB manifest, 16 MiB
provenance and SBOM) are enforced on both sides. The decoder revalidates every
framing field, the reserved paths, the manifest inventory one-for-one against
the payload, and the section 8 digest equalities (`artifactDigest` over the
inventory, `manifestDigest`, `sbomDigest`, and the provenance record's own
copies) before a consumer sees a byte. The three section 8 digests are computed
with the schema package's exported profiles
(`@rathnasgala2/schemas/digest-profiles`, 2.8.1: `artifact`, `artifactManifest`,
`buildProvenance`), and `test/frozen-envelope.test.mjs` proves both that each
exported profile equals the previous local domain-plus-JCS computation
byte-for-byte on real rows and that the schema package's own internal
`validateFrozenEnvelope` accepts the encoder's bytes and computes identical
digests.

**What freeze puts in the records, and what it does not.**

- The manifest is the build's own: the build job's carrier carries the
  renderer's `artifact-manifest.json` as the reserved
  `metadata/artifact-manifest.json` member (`pack-carrier.mjs --manifest`), and
  freeze validates it against the pinned schema root, refuses a build file the
  manifest does not name (`FREEZE_INVENTORY_MISMATCH`) and drops only
  `publish-action`'s own `.gala-build-directory` marker. The intent's
  `manifestDigest` is the record's own digest, no longer a file-list projection.
- `scripts/workflow/build-provenance.mjs` writes exactly the `buildProvenance`
  members the freeze job holds: the runner's asserted workload (repository, ids,
  ref, commits, run identity, event, actor, the fixed caller path), the 21-claim
  binding catalog, both re-observed predecessor handoffs
  (`verifiedInputHandoff`/`unfrozenOutputHandoff`: exact id, name, byte count,
  digest, expiry), `lockDigest`, the manifest's `buildInputDigest`, the three
  envelope digests, the pinned official SPDX 2.3 schema digest and
  `secretInputs: []`. Every other DEC-097 member — `rebuildRecord`'s policy and
  catalog members, `policyReleaseId`, `buildPolicyDecisionDigest`,
  `capabilityDecisionDigest`, `workflowFiles`, `actionPins`, `sandbox`, the SPDX
  license-list release, `artifactLicenseConclusions`, `stylingContractDigest`,
  `renderPolicy`, `artifactId` — is a Gala, template or catalog fact the
  workflow does not hold; each is listed with its owner in
  `PROVENANCE_MEMBERS_NOT_YET_HELD` and is omitted, never filled with a
  placeholder (LOCAL-60: API-INTENT-DERIVATION-1 / schema 2.9.0 derive the
  policy and capability members).
- `scripts/workflow/sbom.mjs` writes the `gala-spdx-json-v2` projection: the
  artifact package with the SPDX 2.3 verification code over the payload SHA-1s,
  the seven direct rows (schemas, template, theme, publish-action,
  publish-kernel, adapter-protocol, selected adapter) and every transitive row
  and edge from the verified source's lock, one file row per payload with SHA-1
  and SHA-256, `created` = the manifest's build epoch, the sole creator
  `Tool: @rathnasgala2/publish-action-<locked version>`, and the sorted,
  deduplicated relationship union. Every SBOM is validated against the
  unmodified official SPDX 2.3 JSON Schema
  (`scripts/workflow/spdx/spdx-schema-2.3.json`, vendored from
  `spdx/spdx-spec@aadf3b0b…`, hash-checked at load against the DEC-097 digest,
  recorded in `pins/ledger.json`). License expressions are a Gala
  release-catalog fact and per-asset theme licenses need the theme contract's
  asset map, so both package license fields and every file's `licenseConcluded`
  are SPDX's own `NOASSERTION` and `creationInfo.licenseListVersion` is omitted
  (`SBOM_PROFILE_DEVIATIONS`).

`provenanceDigest` and `sbomDigest` in the authorization input are the decoder's
recomputation over exactly those records; `build-authorization-input.mjs` no
longer names them as missing (what it still names — `rebuildRecord`,
`capabilityDecisionDigest`, `destination.environment`/`targetDigest`, the Spaces
provider coordinates — is Gala's). `deploy.mjs` decodes the envelope (never
`decodeCarrier`), recomputes the artifact digest under the installed adapter,
refuses an envelope whose manifest, provenance or SBOM digest is not the
intent's, and stages only payload records; `exchange.mjs` records the three
digests and whether the API retained them. The `attest` job checks out the
toolchain, revalidates the envelope, extracts the exact SBOM record bytes
(`extract-frozen-record.mjs --record sbom`) and issues `attest-build-provenance`
over the envelope subject plus `attest-sbom` over the same subject with
`sbom-path` pointing at those bytes (predicate
`https://spdx.dev/Document/v2.3`).

### What is proved locally, and what needs credentials

`test/workload-sequence.test.mjs` runs the whole sequence — exchange →
kernel-driven deploy → receipt exchange → report — against
`test/fixtures/fake-oidc-issuer.mjs` (real RS256 assertions over a real key pair
at a real JWKS) and `test/fixtures/fake-gala-api.mjs` (the API's own rules in
the API's own order, including consume-before-body and the permanent tombstone).
The deploy leg uses the real `local-directory` adapter against a real temporary
directory: DEC-097 forbids `local-directory` from receiving a managed deployment
intent and `exchange.mjs` refuses one, so it is used here in the role it does
have — the conformance oracle that proves the run without a credential.

`test/workload-derivation.test.mjs` runs the same round trip through the two
adapters Gala can issue for today (`github-pages`, `local-directory`;
`do-spaces` is `409 INVALID_SOURCE_STATE` until C2) against their fakes, binds
each issued intent with `authorized-intent.mjs`, recomputes the issuance-phase
capability decision, and proves the Gala-side edges: an intent whose
`expectedGenerationId` names a generation the destination does not serve is
refused before staging, a server that does not retain `providerBinding` cannot
authorize a managed deploy, and every present disagreeing derived member is
`422` by pointer while the agreeing value is accepted.
`test/kernel-run-adapters.test.mjs` drives first publish → expected-generation
publish → stale-expectation refusal through every adapter;
`test/authorized-intent.test.mjs` pins every refusal code;
`test/authorization-input.test.mjs` derives the authorization input from the
real minimal-repository fixture (with `publish-action`'s own build input and the
theme's real contract) and proves the complete Pages input is written, an
incomplete one is refused by name and never written, and a disagreeing build
fact is refused.

What still needs W4-16 credentials: the Spaces limited-key denial proof, the
Pages OIDC acquisition, and both providers' live REST surfaces. The generation-4
`publish-action` suites resolve the installed `template` and selected `theme-*`
packages through `WORKSPACE_ROOT`; in an isolated checkout, set it to
`$PWD/node_modules/@rathnasgala2`.

## Workflows, sandbox and pins

`.github/workflows/publish-v2.yml` is the public reusable publish workflow
(S4-T06): the exact nine-job graph, its `authorize-v2.yml` and `report-v2.yml`
same-commit helpers, and nothing else. All three have only `workflow_call`;
trigger authority stays solely in the author-owned fixed caller documented in
`docs/callers/`. `test/workflow-graph.test.mjs` compares every job, `needs`,
condition, environment, timeout, permission set and secret mapping to DEC-097
section 6 by exact equality.

`scripts/sandbox-build.sh` is the build sandbox (S4-T07): no network after
dependency installation, a read-only source mount, exactly one writable output
directory, non-root execution with every capability dropped, bounded
memory/CPU/process count, a deterministic environment and a hard wall-clock
ceiling. `test/sandbox.test.mjs` proves each property by running a build that
attempts the violation and asserting it fails.

`pins/ledger.json` records every action SHA, container-image digest, binary
checksum and package pin this repository depends on, and `npm run pins:check`
proves the ledger and the files agree **in both directions** — a workflow pin
missing from the ledger fails, and a ledger entry nothing uses fails too. A
package pin is additionally checked against the bytes on disk: the recorded
`sha256` must equal the SHA-256 of the LOCAL-1 tarball the manifests name, and a
tarball that cannot be found fails closed rather than passing unverified.

## `adapter-protocol`

`packages/adapter-protocol` is the JavaScript interface every deployment adapter
implements plus the closed capability vocabulary, negotiation and in-process
message contract. It has no runtime dependency on any specific adapter or on
`publish-kernel`; see `packages/adapter-protocol/README.md`.

## Releasing an adapter

The adapter packages (`adapter-protocol`, `adapter-local-directory`,
`adapter-github-pages`, `adapter-do-spaces`) reach npm only through
`.github/workflows/release-adapters.yaml`, with npm trusted publishing (OIDC,
`environment: npm`, provenance, no token). `adapter-conformance-kit` is private
and is never released. An adapter release is four steps, **in this order**; each
one depends on the one before it, and a pin that moves before the API admits the
new digest strands every lock that carries it (`LOCK_ADAPTER_IDENTITY_INVALID`).

1. **Publish to npm through the workflow.** Bump the package's `version`, give
   its `CHANGELOG.md` a dated heading (`update-adapter-catalog.mjs changelog`
   does that from the `## [Unreleased]` section; `deps` moves exact workspace
   pins) and push to `main`. The workflow typechecks the package, checks its
   committed declarations, runs its tests, publishes with provenance and waits
   until npm lists the version. It publishes one package at a time, the protocol
   first. A push that changes a packed path (`src/`, `types/`, `README.md`,
   `CHANGELOG.md`, `LICENSE`, `package.json`) of a package whose declared
   version is already on npm **fails** and publishes nothing from that push:
   bump the version, then push again or dispatch the packages one at a time. To
   release a single package without a push (for example after registering its
   trusted publisher late), run Actions > Release adapters > Run workflow and
   pick the package. The job summary prints the registry tarball's SHA-256 and
   the exact catalog command for the next step.
2. **Keep the previous release admitted.** From a clean checkout of `main`, run
   `node scripts/release/update-adapter-catalog.mjs catalog --root . <package>=<version>=<sha256>`
   with the digest from the job summary (`adapter-protocol` has no catalog row).
   It moves the old installed row into `ADAPTER_PREVIOUS_RELEASES` (one previous
   row per adapter), rewrites the fixture lock, and leaves the rest to you:
   `npm run sbom`, the targeted checks (`changelog:check`, `pins:check`,
   `sbom:check`, `format:check`,
   `packages/publish-action/test/adapter-artifact-catalog.test.js`,
   `test/adapter-version.test.mjs`, `test/artifact-digest-agreement.test.mjs`)
   and one commit. Never edit the installed row by hand.
3. **API.** Add the new release to the API's `AdapterArtifactCatalog` (code),
   ship the database admission migration for it, and deploy the API, so intake
   and freeze admit the new digest.
4. **user-template.** Only after step 3 is live, move the user-template caller
   pin and lock to the new toolchain commit, and move the `user-template` ref
   that this repository's `ci.yml` and `release.yaml` check out to that same
   commit. Locks that still pin the previous release keep publishing because
   step 2 kept that release admitted.

Once per package, the owner registers the trusted publisher on npmjs.com
(package > Settings > Trusted publisher > GitHub Actions): owner `rathnasgala2`,
repository `publish`, workflow filename `release-adapters.yaml`, environment
`npm`. Until it is registered the publish step fails with a message that names
this.

`prod-adapter.sh` at the workspace root is for emergencies only, when the
workflow cannot run. It bumps, publishes and pins from a workstation with
`npm publish --access public --provenance=false` (npm's browser sign-in is the
only authentication, and the version carries no provenance attestation), then
runs the catalog step itself and commits `Release adapter packages: ...`. Steps
3 and 4 still follow it. Run `./prod-adapter.sh --dry-run` first; it requires a
clean `main` equal to `origin/main` and Node from `.nvmrc`.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
