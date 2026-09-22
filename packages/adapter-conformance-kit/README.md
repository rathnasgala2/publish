# @rathnasgala2/adapter-conformance-kit

A reusable `node:test` conformance suite every `@rathnasgala2` deployment
adapter must pass (S2-T17). It is adapter-agnostic: it depends only on
`@rathnasgala2/adapter-protocol` and calls adapters through one shared calling
convention (below), never a concrete adapter's package.

## What it checks

- **Lifecycle shape**: exactly the eight mandatory lifecycle functions
  (`defineAdapter`), no default export.
- **Capability truthfulness**: `describeCapabilities()` validates against the
  published `adapter-capability:2.0.0` schema and the protocol's exact three-row
  admission table (`validateCapabilityDeclaration`, `checkExactRow`) for the
  fixture's declared `adapterId`.
- **Full lifecycle order**: `inspectDestination` -> `preflight` -> `stage` ->
  `activate` -> `observe` -> `cleanupStaged` succeeds end to end against a fresh
  destination.
- **Staging privacy**: a staged-but-not-activated generation never changes the
  destination's currently served generation and never appears as a published
  release.
- **Activation atomicity/replace semantics**: activating a second generation
  wholesale replaces the first; a stale `expected-generation` fence reconciles
  instead of overwriting the currently served generation.
- **Observe/verify and tamper detection**: `observe` verifies a correctly
  activated generation and detects a byte tampered with out of band.
- **Cleanup of staged state**: `cleanupStaged` removes only its own scratch
  state, never the active generation.
- **Rollback**: `rollback` (reupload semantics) restores a prior generation's
  exact content under a new generation identity.
- **Idempotent re-run**: repeating one `stage`+`activate` operation with the
  same operation identity never re-writes bytes, never double-activates and
  never creates a duplicate generation.
- **Digest-mismatch activation refusal**: `activate` refuses to promote a stage
  whose recomputed digest disagrees with the caller's frozen artifact identity
  (standing in for a crash that left a torn write on disk). Asserted with
  `assert.rejects`, not a manual `try`/`catch` around `assert.fail` — an earlier
  version of this test placed `assert.fail` inside the same `try` its `catch`
  guarded, so the `AssertionError`'s own message (which happened to contain the
  word "digest") satisfied the catch block's loose message match even when
  `activate` never threw at all, making the test pass against an adapter with no
  integrity checking whatsoever. `test/suite-catches-broken-adapter.test.js` is
  the regression test: it runs this kit, in an isolated child `node --test`
  process, against a deliberately broken fake adapter and asserts that run
  fails.
- **Genuine interrupted activation**: a real thrown error from an
  adapter-specific crash-injection hook, invoked strictly between "staging is
  durably committed" and "the destination's activation pointer moves," must
  leave the previously served generation intact and verifiable, and recovery
  (`cleanupStaged`) must remove the abandoned, never-activated candidate.

## Guarding against a vacuously passing suite

Every assertion in this kit runs directly inside its `test()` callback (or via
`assert.rejects`/`assert.doesNotThrow`), never inside a hand-written
`try`/`catch` that could itself swallow or misclassify a real failure.
`test/suite-catches-broken-adapter.test.js` is a standing regression test for
this: it spawns the whole suite, in an isolated `node --test` child process,
against `test/broken-fake-adapter.js` (an adapter that never checks
`expectedArtifactDigest` and never honors `crashInjectionHook`) and asserts that
run fails. A future change to this file that reintroduces a vacuously-passing
assertion pattern should make that regression test itself fail (the child run
would unexpectedly exit `0`).

## The assumed adapter calling convention

This kit does not attempt to guess a concrete adapter's argument shapes (the
adapter-protocol lifecycle interface only fixes function _names_, not their
argument shapes). Instead, it assumes every in-scope adapter accepts and returns
the shapes below. `adapter-local-directory` (S2-T17) is the reference
implementation of this convention; `adapter-github-pages` and
`adapter-do-spaces` (S2-T18/S2-T19) adopt the same convention so they can reuse
this kit unchanged.

```text
describeCapabilities(destination) -> Promise<capabilityDeclaration>
inspectDestination(destination) -> Promise<{currentGenerationId, retainedHistory, releaseGenerationsOnDisk}>
preflight({destination, entries, expectedGenerationId?}) -> Promise<{verdict, observedGenerationId, findings}>
stage({destination, operationId, attemptId, idempotencyKey, generationId, artifactId, artifactDigest, files}) -> Promise<{stageToken, stagedPath, fileCount, byteCount, idempotent}>
activate({destination, stageToken, generationId, expectedCurrentGenerationId, expectedArtifactDigest?, crashInjectionHook?}) -> Promise<{decision: 'activate'|'reconcile', generationId, previousGenerationId, idempotent}>
observe({destination, generationId, expectedArtifactDigest}) -> Promise<{verified, findings, currentGenerationId, ...}>
cleanupStaged({destination, stageToken, generationId?}) -> Promise<{removed}>
rollback({destination, targetGenerationId, newGenerationId, newArtifactId, operationId, attemptId, idempotencyKey}) -> Promise<{decision, generationId, previousGenerationId, idempotent}>
```

### The activation fence (`expectedCurrentGenerationId`)

`activate`'s `expectedCurrentGenerationId` is **mandatory** and is either a
generation identity or the adapter protocol's `EXPECT_NOTHING_SERVED` sentinel
(`'gala:expect-nothing-served'`, exported by `@rathnasgala2/adapter-protocol`
together with `requireGenerationFence`, `fenceDisagrees` and `fenceFor`).

Until adapter protocol `2.1.0` the field accepted `null`, which meant two
incompatible things at once — "I expect nothing to be served here" and "I have
no expectation, do not fence me". Every adapter implemented the second reading
(`!== null` guards), so a first-publish caller got no fence and could overwrite
a live generation (LOCAL-47). Two cases in this suite are now normative for
every adapter:

- **`activate` with `expectedCurrentGenerationId: null` must reject**, with a
  diagnostic naming `EXPECTED_GENERATION_FENCE_INVALID` (or at least the field),
  and must publish nothing. Validate the fence with `requireGenerationFence`
  before any other work, including before any idempotent-replay short circuit.
- **`activate` with `EXPECT_NOTHING_SERVED` against a destination that is
  already serving a generation must return `decision: 'reconcile'`** and leave
  the served generation byte-intact. Compare with `fenceDisagrees`, never with a
  bare `!==` against the raw input.

Callers build the value with `fenceFor(observedGenerationId)` rather than
passing an observed `currentGenerationId` (which may be `null`) straight
through.

`activate`'s optional `crashInjectionHook` (a `() => void | Promise<void>`),
when supplied, is awaited after staging is durably committed but strictly before
the activation pointer moves; if it throws, `activate` propagates the error
without moving the pointer. No production caller ever supplies it — it exists
solely so a fixture's `simulateInterruptedActivation` (below) can prove a
genuine interruption at that exact boundary is handled correctly.
`cleanupStaged`'s optional `generationId`, when supplied and that generation is
neither the currently active one nor in the retained history, additionally
removes that abandoned release directory (recovery from an interrupted
activation) — never a completed, currently-retained generation.

## Usage

```js
import { runAdapterConformanceSuite } from '@rathnasgala2/adapter-conformance-kit';
import * as adapterModule from '@rathnasgala2/adapter-local-directory';

runAdapterConformanceSuite({
  adapterModule,
  adapterId: 'local-directory',
  async createDestination() {
    /* provision an isolated destination + teardown */
  },
  makeFiles(seed) {
    /* return a small deterministic file set for `seed` */
  },
  computeArtifactDigest(files) {
    /* the adapter's own artifact-digest formula, so `observe` can verify it */
  },
  async tamperServedByte(destination, generationId) {
    /* flip one byte of the currently served generation, out of band */
  },
  async simulateInterruptedActivation(destination, seed) {
    /* stage a fresh generation for `seed`, then activate it with a
       crashInjectionHook (or equivalent adapter-specific mechanism) that
       throws before the pointer moves; return {stageToken, generationId} */
  },
});
```

Call this from an adapter's own `test/*.test.js` file (`node --test` picks up
every registered case automatically).

## Commands

```sh
npm run typecheck --workspace packages/adapter-conformance-kit
npm test --workspace packages/adapter-conformance-kit
```
