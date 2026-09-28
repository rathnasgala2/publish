# The evidence journal against the contract

`scripts/workflow/kernel-run.mjs` is the one place in this repository that
appends an observation or an attempt to the evidence journal the receipt
submission (`scripts/workflow/workload-requests.mjs`'s `buildReceiptSubmission`)
carries to Gala. This document records the audit of every value it can emit
against two independent statements of the contract — the pinned
`@rathnasgala2/schemas@2.11.0` schemas (`deployment-observation:2.0.0`,
`deployment-receipt:2.0.0`, and the OpenAPI
`KernelObservationSubmission`/`KernelAttemptSubmission` component schemas) and
the API's own database check constraints (`gala_core.deployment_observation` in
`0013-deployment-records/050-evidence-journal.yaml`'s
`deployment_observation_matrix_ck`, and `gala_core.operation_attempt` in
`0001-foundation/050-operations-outbox-inbox.yaml`'s
`operation_attempt_lifecycle_ck`) — and of every other document-building site in
`scripts/workflow/*.mjs` and `packages/*/src` for the same defect class.

## Why this matters

A journal entry the kernel appends is not observed to work until the API accepts
the receipt submission built from it. Before this audit, one call site journaled
a definite success as an ambiguous one, two others omitted a field the API's own
database requires, and two more journaled a refused activation more definitely
than the kernel could vouch for. All five passed this repository's own
`npm test` because the repository's flatter mirror of the wire contract
(`scripts/workflow/workload-contract.mjs`'s `validateReceiptSubmission`, and its
equality test against the OpenAPI document) checks flat field and enum
membership only — never the cross-field `if`/`then`/`oneOf` rules the real
contract closes with. None of the five defects below was reachable from a
fixture; each was found by validating the _real_ journal a kernel run produces
against `@rathnasgala2/schemas`' own `validateGalaDocument`
(`test/kernel-run-adapters.test.mjs`'s `assertJournalSatisfiesContract`), or by
direct validation of a constructed case against the same schema.

## Every class/outcome/destinationChanged pair `kernel-run.mjs` can emit

| Site (stage)                                                                                                      | Class / outcome / destinationChanged it emits                                                                                                                                                                                                                                                                 | Contract allows                                                                                                                                              | Verdict                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-staging fence disagreement (`fenceVerdict` before staging)                                                    | `request-not-started` / `rejected` / `no`                                                                                                                                                                                                                                                                     | `request-not-started` + one of `rejected, not-attempted-retryable, authorization-lost, rate-limited, provider-contract-violation` + `no`/`yes`               | matches                                                                                                                                                                                                                               |
| Adapter preflight refusal (`adapterPreflight.verdict !== 'proceed'`)                                              | `request-not-started` / `rejected` / `no`                                                                                                                                                                                                                                                                     | same as above                                                                                                                                                | matches                                                                                                                                                                                                                               |
| `refused()` helper (staging/activation/cleanup refused before any provider call)                                  | `request-not-started` / `rejected` / `no`                                                                                                                                                                                                                                                                     | same as above                                                                                                                                                | matches                                                                                                                                                                                                                               |
| **Staging completed** (the reported defect)                                                                       | was `request-accepted` / `succeeded` / `no`                                                                                                                                                                                                                                                                   | `request-accepted` only with `outcome-unknown-reconciling`; a definite success is only `provider-state` + `succeeded` + `no`/`yes`                           | **was a mismatch — fixed**: now emits `provider-state` / `succeeded` / `no`                                                                                                                                                           |
| Activation fence disagreement, fresh observation (before calling `activate`)                                      | (attempt only, no observation) `skipped` / `no`, `failureCode: REJECTED`                                                                                                                                                                                                                                      | attempt matrix: `skipped` + `no` + `retryable: false`                                                                                                        | matches                                                                                                                                                                                                                               |
| Activation call threw (`lifecycle.activate` failure)                                                              | `provider-error` / `outcome-unknown-reconciling` / `unknown`                                                                                                                                                                                                                                                  | `provider-error` + `outcome-unknown-reconciling` + `unknown`/`yes`                                                                                           | matches                                                                                                                                                                                                                               |
| **Activation observed, activation refused** (`activation.decision !== 'activate'`)                                | was `provider-state` / `rejected` / `unknown` (when `observed.verified` was `false`, the typical case) or `provider-state` / `succeeded` / `unknown` (when it happened to be `true` — the destination can genuinely have been mutated by an adapter that lost a pointer race after writing, e.g. `do-spaces`) | `provider-state` + `rejected` only admits `destinationChanged: 'no'`; `provider-state` + `succeeded` only admits `'no'`/`'yes'` — neither admits `'unknown'` | **was a mismatch — fixed**: now emits `provider-state` / `outcome-unknown-reconciling` / `unknown` whenever activation was not confirmed, the one pair the contract provides for "changed, but not confirmed to be what was intended" |
| Activation observed, activation confirmed (`activation.decision === 'activate'` and `observed.verified === true`) | `provider-state` / `succeeded` / `yes`                                                                                                                                                                                                                                                                        | `provider-state` + `succeeded` + `no`/`yes`                                                                                                                  | matches                                                                                                                                                                                                                               |

## Every attempt outcome / resultDigest pair `kernel-run.mjs` can emit

The API's `operation_attempt_lifecycle_ck` requires a `result_digest` on every
attempt whose outcome is `succeeded`, `failed` or `unknown` (never on
`not-started` or `running`, and permitted-but-not-required on `skipped`). The
contract's own `deploymentAttempt` definition additionally closes `stage` +
`failureCode` + `outcome` + `destinationChanged` + `retryable` into one `oneOf`
per legal combination.

| Site (stage)                                                                        | outcome      | destinationChanged | Attached a `result`?     | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------ | ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staging succeeded                                                                   | `succeeded`  | `no`               | yes (`{ fileCount }`)    | matches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Activation refused by a fresh fence check (before calling `activate`)               | `skipped`    | `no`               | no                       | matches (not required for `skipped`)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Activation call threw**                                                           | `unknown`    | `unknown`          | was: no                  | **was a mismatch — fixed**: now attaches `{ established: false }`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Activation refused by the adapter itself** (`activation.decision !== 'activate'`) | was `failed` | `unknown`          | yes (`{ generationId }`) | **was a mismatch — fixed**: the contract only pairs `stage: activation` + `outcome: failed` with `destinationChanged: 'no'` (every `failed` branch for this stage requires it); the kernel cannot vouch for `'no'` here (an adapter's `reconcile` decision is not guaranteed clean — `do-spaces` can report it after already writing served-root objects), so this is now `outcome: 'unknown'`, the pair the contract provides for `stage: activation` + `destinationChanged: 'unknown'`/`'yes'` |
| Activation confirmed                                                                | `succeeded`  | `yes`              | yes (`{ generationId }`) | matches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Cleanup succeeded**                                                               | `succeeded`  | `no`               | was: no                  | **was a mismatch — fixed**: now attaches `{ removed }`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Cleanup skipped (prior mutation unresolved)                                         | `skipped`    | `no`               | no                       | matches (not required for `skipped`)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### A contract inconsistency noted, not fixed

The OpenAPI `KernelAttemptSubmission` component schema (used for wire validation
of the `POST /v2/workloads/deployment-receipts` request body) is stricter than
both the DB constraint above and `deployment-receipt.schema.json`'s embedded
`deploymentAttempt` definition agree with each other on: for `outcome: skipped`
it requires `resultDigest` and _forbids_ `failureCode`, `startedAt` and
`completedAt` — a shape `kernel-run.mjs` has never produced (every `skipped`
attempt here carries a `failureCode` and both timestamps, by design, so the
journal explains why a stage did not run). Direct inspection of the API's
request-parsing code (`WorkloadTransportCodec.readKernelJournal`,
`src/main/java/io/gala/api/workload/application/WorkloadTransportCodec.java`)
confirms this conditional rule is not actually enforced server-side —
`resultDigest`, `failureCode`, `startedAt` and `completedAt` are read as
unconditionally optional there, and `DeploymentReceiptIngestionService`
synthesizes `startedAt`/`completedAt` from the submission's own workflow
timestamps when absent rather than requiring the caller omit them. The only
constraint actually gating this field on the API side is the lenient DB check
above. This repository is therefore left unchanged here: reshaping every
`skipped` attempt to satisfy a documented-but-unenforced wire rule would remove
information (why a stage was skipped, and when) for no contract benefit, and
risks becoming true dead-instruction-following the day the rule _is_ enforced
without the removed fields being reintroduced deliberately. A future contributor
tightening server-side validation to match the OpenAPI document should revisit
this table.

## Other document-building sites audited

| Site                                                                                                     | Document                                                                                                                                   | Has a class/outcome matrix?                                                                                                                                                                         | Verdict                                                                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/adapter-*/src/capability.js`                                                                   | `adapter-capability:2.0.0`                                                                                                                 | Discriminated on adapter kind (three-row vocabulary), not an outcome record                                                                                                                         | not applicable — covered by `adapter-protocol`'s own near-complete conformance suite |
| `packages/adapter-*/src/marker.js`                                                                       | `public-generation-marker:2.0.0`                                                                                                           | No — a flat identity declaration (`artifactId`/`artifactDigest`/`generationId`), no `allOf`/`oneOf`                                                                                                 | not applicable                                                                       |
| `scripts/workflow/workload-requests.mjs` (`buildDeploymentIntentRequest`, `buildReceiptExchangeRequest`) | deployment-intent / receipt-exchange requests                                                                                              | Discriminated on `purpose`, an authorization request, not a success/refusal/timeout/unknown/rollback outcome record                                                                                 | not applicable                                                                       |
| `scripts/workflow/kernel-run.mjs` (`observedRoutesFor`)                                                  | `observedRoutes[]` entries in the receipt submission                                                                                       | No — a plain `{route, expectedDigest}` candidate list; `routeClass`/verification-fit classification is Gala's own public verification, never built here                                             | not applicable                                                                       |
| `scripts/workflow/gala-api.mjs`                                                                          | classification of the API's own exchange response (`outcome: 'submission-recorded' \| 'fence-moved' \| 'capability-invalid' \| 'refused'`) | Classifies a _received_ document, not one this repository constructs and sends                                                                                                                      | not applicable                                                                       |
| `packages/adapter-github-pages/src/recovery.js`                                                          | internal prior-attempt recovery decision (`outcome: 'prior-succeeded' \| 'prior-terminal-failure' \| 'reconciliation-required'`)           | Internal adapter decision consumed by `lifecycle.stage()`; its result flows into the `kernel-run.mjs` staging attempt/observation already audited above, never sent to the API in this shape itself | not applicable                                                                       |

## What proves this

`test/kernel-run-adapters.test.mjs`'s `assertJournalSatisfiesContract` runs
after every one of the three adapters' end-to-end kernel runs (`github-pages`,
`do-spaces`, `local-directory`) and validates the real journal each one produces
— every observation individually against `deployment-observation:2.0.0`, and the
run's real attempts plus its terminal observation assembled into a
`deployment-receipt:2.0.0` document — with `@rathnasgala2/schemas`' own
`validateGalaDocument`.

A separate test in the same file,
`a refused activation (the adapter itself losing the fence race) is journaled as unknown, never a clean failure`,
drives a real `local-directory` run through a real `activate` call whose
reported decision is forced to `reconcile` after the underlying mutation
genuinely happened — reproducing the ambiguity `do-spaces`'s own ambiguous
`reconcile` result documents — and validates the resulting observations
individually.

All five fixes in the two tables above were confirmed against the pre-fix code:
reverting any one of them individually reproduces a failure in one of these two
tests.
