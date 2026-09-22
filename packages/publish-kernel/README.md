# @rathnasgala2/publish-kernel

The provider-neutral, **non-disableable publish safety kernel** (DEC-016
§"Non-disableable publish safety kernel", doc 20 §13.2;
`orchestration/slice-briefs/S2-author-owned-publication.md` section 5). It never
clones a source repository, never installs dependencies, never executes author
build code, never interprets Gala content semantics and never writes to the
source repository.

This package implements exactly the ten kernel duties over explicit,
caller-supplied inputs. Every exported function is **pure**: no ambient `cwd`,
environment variable, network access, or hidden module-level state. A caller (a
concrete destination adapter, or `publish-action`'s composition root in a later
task) supplies every fact a duty needs and persists whatever state its own
execution context requires (the operation journal, the retained last-known-good
digest history); the kernel keeps none of it.

## The ten duties

| #   | Duty                                                                                                                             | Module                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | Artifact identity and digest agreement; reject mutation after freeze                                                             | `artifact-identity.js`     |
| 2   | Path containment (traversal, absolute/escaping paths, unsafe member kinds, destructive Unicode, case collisions, reserved paths) | `path-containment.js`      |
| 3   | Bounded resources (file count, byte count, path length)                                                                          | `bounded-resources.js`     |
| 4   | Destination authority (reject mismatch/change after preflight)                                                                   | `destination-authority.js` |
| 5   | Secret handling (structural redaction and exposure detection)                                                                    | `secret-redaction.js`      |
| 6   | Operation identity, idempotency and concurrency fencing                                                                          | `operation-fencing.js`     |
| 7   | Staged activation under an expected-current-generation condition                                                                 | `staged-activation.js`     |
| 8   | Ambiguous-outcome discipline (`UNKNOWN_RECONCILING`, never a blind retry or false failure)                                       | `ambiguous-outcome.js`     |
| 9   | Last-known-good retention (active plus five prior certified digests)                                                             | `retention.js`             |
| 10  | Truthful typed diagnostics (code, severity, location, evidence, recovery, override)                                              | `errors.js`                |

`kernel.js` composes the ten duties into one `evaluate*` function per
adapter-protocol lifecycle stage that can mutate or observe a destination:
`evaluatePreflight`, `evaluateStage`, `evaluateActivate`, `evaluateObserve`,
`evaluateCleanupStaged` and `evaluateRollback`. Each returns a frozen
`{ verdict: 'proceed' | 'refuse', findings }` result (plus a stage-specific
decision such as the idempotency or activation outcome) and never signals
`'proceed'` while a blocking finding (`SOURCE_ERROR`, `ARTIFACT_SAFETY_ERROR` or
`TARGET_CONSTRAINT_ERROR`) is present — the kernel fails closed.

`capability-decision.js` builds and verifies the DEC-097 §7/§8
`capabilityDecision` record and its `capabilityDecisionDigest`
(`SHA256(UTF8("GALA-CAPABILITY-DECISION-V2\0") || JCS(...))`), composing only
`@rathnasgala2/adapter-protocol`'s `canonicalizeJson`/`domainDigest` primitives.
`generation-marker.js` builds and validates the small
`public-generation-marker:2.0.0` document (the one wire schema a fully local S2
kernel can construct end to end) against the real published schema via
`@rathnasgala2/schemas`.

## Why `deployment-intent`/`deployment-observation` aren't validated whole

`urn:gala:schema:deployment-intent:2.0.0` and
`urn:gala:schema:deployment-observation:2.0.0` are the full S4 managed wire
records: their required fields include policy release identity, network
boundary/TLS profile digests, activation-detection plans and workload
OIDC-binding digests that only exist once Gala's managed authority (S4) is
running. S2's slice brief itself says "in S2 there is no Gala at all." This
package therefore operates over small, explicit, self-documented JSDoc input
shapes that carry exactly the fields the ten duties need (artifact identity,
destination identity, operation/idempotency identity, concurrency fence,
capability limits) rather than requiring or emitting a schema-complete
`deployment-intent`/`deployment-observation` document. `adapter-capability` and
`public-generation-marker` — the two contracts a local S2 execution context can
construct completely — are validated against the real published schema, exactly
as `adapter-protocol` already does for capability declarations.

## The concurrency fence (duty 6 / duty 7)

`checkConcurrencyFence` and `decideStagedActivation` take a
`ConcurrencyFenceInput`. Under `expected-generation` (and `provider-etag`):

- `expectedGenerationId` is the adapter protocol's fence value — a generation
  identity, or `EXPECT_NOTHING_SERVED` (`'gala:expect-nothing-served'`) when the
  caller expects the destination to be serving nothing. `null` is refused
  (`CONCURRENCY_FENCE_IDENTITY_INVALID`): it used to be written by callers who
  meant "first publish" and read by adapters as "do not fence me" (LOCAL-47).
- `observedGenerationId` is what the destination was actually observed to be
  serving: a generation identity, or `null` for "serves nothing". It is
  mandatory; omitting it is refused with
  `CONCURRENCY_FENCE_OBSERVATION_MISSING`, never treated as an unfenced proceed.

The vocabulary itself (`EXPECT_NOTHING_SERVED`, `requireGenerationFence`,
`fenceDisagrees`, `fenceFor`) lives in `@rathnasgala2/adapter-protocol` and is
re-exported here rather than re-implemented, so kernel and adapters can never
drift apart on what a fence means.

## Commands

```sh
npm run typecheck --workspace packages/publish-kernel
npm test --workspace packages/publish-kernel
npm run test:coverage --workspace packages/publish-kernel   # node --test --experimental-test-coverage
npm run declarations:generate --workspace packages/publish-kernel
npm run declarations:check --workspace packages/publish-kernel
```

## Composing this package

`publish-kernel` depends only on `@rathnasgala2/adapter-protocol` (its
capability vocabulary, digest primitives and typed-finding conventions) and
`@rathnasgala2/schemas`. It never imports a concrete adapter or
`publish-action`; `.dependency-cruiser.cjs` enforces this at the workspace
level. A concrete adapter (`adapter-local-directory`, S2-T17) or
`publish-action`'s composition root (S2-T20) calls the `evaluate*` functions
before and after its own provider-specific lifecycle calls, and persists the
operation journal and the last-known-good digest history in whatever way its own
execution context requires.
