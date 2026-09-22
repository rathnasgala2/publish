/**
 * `@rathnasgala2/adapter-conformance-kit`: the reusable `node:test`
 * conformance suite every `@rathnasgala2` deployment adapter must pass
 * (S2-T17). It exercises the adapter calling convention this kit assumes
 * (see `README.md`) rather than any one concrete adapter's internals, so
 * `adapter-github-pages` and `adapter-do-spaces` (S2-T18/S2-T19) can reuse
 * it against their own `ConformanceFixture` implementation.
 *
 * Coverage: full lifecycle order and shape (`defineAdapter`), capability
 * truthfulness against the protocol's admission table, staging privacy,
 * activation atomicity/replace semantics, observe/verify and tamper
 * detection, cleanup of staged state, rollback, idempotent re-run, a
 * digest-mismatch activation refusal, a genuine interrupted-activation
 * (crash between staging completion and the pointer swap) recovery test, and
 * the LOCAL-47 activation-fence cases: `expectedCurrentGenerationId: null`
 * must be refused outright, and the explicit `EXPECT_NOTHING_SERVED`
 * sentinel must genuinely fence against an already-served destination.
 *
 * @module
 */

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';

import {
  DESTINATION_KINDS,
  EXPECT_NOTHING_SERVED,
  checkExactRow,
  defineAdapter,
  generateUuidV7,
  validateCapabilityDeclaration,
} from '@rathnasgala2/adapter-protocol';

/**
 * @typedef {Readonly<{path: string, bytes: Buffer}>} ConformanceFile
 */

/**
 * @typedef {object} ConformanceFixture
 * @property {Record<string, unknown>} adapterModule the adapter's imported
 *   module namespace (the object `await import(specifier)` returns)
 * @property {'local-directory' | 'github-pages' | 'do-spaces'} adapterId the
 *   adapter's declared identity, checked against `describeCapabilities()`
 * @property {() => Promise<{destination: unknown, teardown: () => Promise<void>}>} createDestination
 *   provision one fresh, isolated destination and a teardown callback
 * @property {(seed: number) => readonly ConformanceFile[]} makeFiles build a
 *   small deterministic file set for generation `seed`; two different seeds
 *   must produce different content so activation/rollback can be told apart
 * @property {(files: readonly ConformanceFile[]) => string} computeArtifactDigest
 *   compute the adapter's own artifact-digest formula over a file set, so
 *   the kit can pass `stage` a truthful `artifactDigest` that `observe` will
 *   actually verify
 * @property {(destination: unknown, generationId: string) => Promise<void>} tamperServedByte
 *   flip one byte of the currently *served* (activated) generation's
 *   content, out of band from the adapter's own lifecycle calls
 * @property {(destination: unknown, seed: number) => Promise<{stageToken: string, generationId: string}>} simulateInterruptedActivation
 *   stage a fresh generation for `seed`, then attempt to activate it in a
 *   way that is genuinely interrupted (e.g. a thrown error from an
 *   adapter-specific crash-injection hook) after staging is durably
 *   committed but strictly before the destination's activation pointer is
 *   updated. Must reject; must not change which generation is currently
 *   served. Returns the interrupted attempt's `stageToken`/`generationId`
 *   so the test can drive recovery (`cleanupStaged`) against it.
 */

/**
 * Build one fresh, unique operation identity bundle.
 *
 * @returns {{operationId: string, attemptId: string, idempotencyKey: string}}
 *   a fresh identity bundle
 */
function freshOperation() {
  return {
    operationId: randomUUID(),
    attemptId: randomUUID(),
    idempotencyKey: randomUUID(),
  };
}

/**
 * @param {readonly ConformanceFile[]} files a file set
 * @returns {ConformanceFile[]} a shallow copy, safe to pass to a mutating
 *   caller
 */
function cloneFiles(files) {
  return files.map((file) => ({ path: file.path, bytes: file.bytes }));
}

/**
 * Stage and activate one fresh generation end to end, returning every
 * identity a later assertion needs.
 *
 * @param {ConformanceFixture} fixture the adapter fixture under test
 * @param {unknown} destination the destination to publish to
 * @param {number} seed a distinct seed for `makeFiles`
 * @param {string} expectedCurrentGenerationId the activation fence: the
 *   destination's generation identity expected before this activation, or
 *   `EXPECT_NOTHING_SERVED` when nothing is expected to be served. Never
 *   `null` — adapter protocol 2.1.0 has no unfenced activation (LOCAL-47).
 * @returns {Promise<{
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   stageToken: string,
 *   activation: Record<string, unknown>
 * }>} the published generation's identities
 */
async function publishOneGeneration(
  fixture,
  destination,
  seed,
  expectedCurrentGenerationId,
) {
  const generationId = generateUuidV7();
  const artifactId = generateUuidV7();
  const files = fixture.makeFiles(seed);
  const artifactDigest = fixture.computeArtifactDigest(files);
  const operation = freshOperation();

  const adapter = /** @type {any} */ (fixture.adapterModule);
  const staged = await adapter.stage({
    destination,
    ...operation,
    generationId,
    artifactId,
    artifactDigest,
    files: cloneFiles(files),
  });
  const activation = await adapter.activate({
    destination,
    stageToken: staged.stageToken,
    generationId,
    expectedCurrentGenerationId,
  });
  return {
    generationId,
    artifactId,
    artifactDigest,
    stageToken: staged.stageToken,
    activation,
  };
}

/**
 * Register the complete reusable conformance suite as `node:test` cases for
 * one adapter fixture.
 *
 * @param {ConformanceFixture} fixture the adapter-specific fixture binding
 * @returns {void}
 */
export function runAdapterConformanceSuite(fixture) {
  const adapter = /** @type {any} */ (fixture.adapterModule);

  test(`[conformance] ${fixture.adapterId}: exposes exactly the eight mandatory lifecycle functions`, () => {
    assert.doesNotThrow(() => defineAdapter(fixture.adapterModule));
  });

  test(`[conformance] ${fixture.adapterId}: describeCapabilities is truthful against the protocol admission table`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const declaration = await adapter.describeCapabilities(destination);
      assert.ok(
        DESTINATION_KINDS.includes(fixture.adapterId),
        'fixture.adapterId must be one of the three closed adapter identities',
      );
      const result = validateCapabilityDeclaration(declaration);
      assert.equal(
        result.schemaValid,
        true,
        JSON.stringify(result.schemaDiagnostics),
      );
      assert.equal(result.exactRowValid, true, JSON.stringify(result.findings));
      assert.deepEqual(checkExactRow(declaration), []);
      assert.equal(
        /** @type {any} */ (declaration).adapter.adapterId,
        fixture.adapterId,
      );
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: full lifecycle order (inspect -> preflight -> stage -> activate -> observe -> cleanupStaged)`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const before = await adapter.inspectDestination(destination);
      assert.equal(before.currentGenerationId, null);

      const files = fixture.makeFiles(1);
      const preflightResult = await adapter.preflight({
        destination,
        entries: files.map((file) => ({ path: file.path })),
      });
      assert.equal(preflightResult.verdict, 'proceed');

      const published = await publishOneGeneration(
        fixture,
        destination,
        1,
        EXPECT_NOTHING_SERVED,
      );
      assert.equal(published.activation.decision, 'activate');

      const observed = await adapter.observe({
        destination,
        generationId: published.generationId,
        expectedArtifactDigest: published.artifactDigest,
      });
      assert.equal(observed.verified, true, JSON.stringify(observed.findings));

      // cleanupStaged is safe to call even after a successful activation:
      // an adapter that consumes (e.g. renames) its staging scratch during
      // activate may correctly report nothing left to remove here; the
      // guarantee under test is that the call never errors and never
      // disturbs the now-active generation, not that it always finds
      // leftover scratch state.
      const cleanup = await adapter.cleanupStaged({
        destination,
        stageToken: published.stageToken,
      });
      assert.equal(typeof cleanup.removed, 'boolean');

      const after = await adapter.inspectDestination(destination);
      assert.equal(after.currentGenerationId, published.generationId);
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: staging is private/unreachable before activation`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const files = fixture.makeFiles(2);
      const operation = freshOperation();
      const generationId = generateUuidV7();
      const artifactId = generateUuidV7();
      const artifactDigest = `sha256:${randomBytes(32).toString('hex')}`;
      await adapter.stage({
        destination,
        ...operation,
        generationId,
        artifactId,
        artifactDigest,
        files: cloneFiles(files),
      });

      const inspected = await adapter.inspectDestination(destination);
      assert.equal(
        inspected.currentGenerationId,
        null,
        'staging must never change the currently served generation',
      );
      assert.ok(
        !inspected.releaseGenerationsOnDisk.includes(generationId),
        'a staged-but-not-activated generation must not appear as a published release',
      );
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: activation is atomic and replaces the previous generation wholesale`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const first = await publishOneGeneration(
        fixture,
        destination,
        10,
        EXPECT_NOTHING_SERVED,
      );
      const second = await publishOneGeneration(
        fixture,
        destination,
        11,
        first.generationId,
      );
      assert.equal(second.activation.decision, 'activate');
      assert.equal(second.activation.previousGenerationId, first.generationId);

      const observedSecond = await adapter.observe({
        destination,
        generationId: second.generationId,
        expectedArtifactDigest: second.artifactDigest,
      });
      assert.equal(observedSecond.verified, true);
      assert.equal(observedSecond.currentGenerationId, second.generationId);
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: activation under a stale expected-generation fence reconciles instead of overwriting`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const first = await publishOneGeneration(
        fixture,
        destination,
        20,
        EXPECT_NOTHING_SERVED,
      );
      // A generation identity that is well-formed (the protocol admits only
      // a UUIDv7 or the sentinel as a fence) but is not what is served.
      const staleExpectation = generateUuidV7();
      const files = fixture.makeFiles(21);
      const generationId = generateUuidV7();
      const staged = await adapter.stage({
        destination,
        ...freshOperation(),
        generationId,
        artifactId: generateUuidV7(),
        artifactDigest: `sha256:${randomBytes(32).toString('hex')}`,
        files: cloneFiles(files),
      });
      const activation = await adapter.activate({
        destination,
        stageToken: staged.stageToken,
        generationId,
        expectedCurrentGenerationId: staleExpectation,
      });
      assert.equal(activation.decision, 'reconcile');

      const stillCurrent = await adapter.inspectDestination(destination);
      assert.equal(
        stillCurrent.currentGenerationId,
        first.generationId,
        'a stale fence disagreement must never mutate the served generation',
      );
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: LOCAL-47 — activate refuses expectedCurrentGenerationId: null instead of publishing unfenced`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const files = fixture.makeFiles(22);
      const generationId = generateUuidV7();
      const staged = await adapter.stage({
        destination,
        ...freshOperation(),
        generationId,
        artifactId: generateUuidV7(),
        artifactDigest: fixture.computeArtifactDigest(files),
        files: cloneFiles(files),
      });

      // Until adapter protocol 2.1.0 every adapter read `null` as "no
      // expectation, do not fence me", so the caller that meant "this is a
      // first publish, refuse if anything is already served" got no fence
      // at all. `null` is now an invalid fence value, not a weaker one.
      await assert.rejects(
        adapter.activate({
          destination,
          stageToken: staged.stageToken,
          generationId,
          expectedCurrentGenerationId: null,
        }),
        /EXPECTED_GENERATION_FENCE_INVALID|expectedCurrentGenerationId/u,
        'activate must refuse a null activation fence (LOCAL-47), never treat it as unfenced',
      );

      const untouched = await adapter.inspectDestination(destination);
      assert.equal(
        untouched.currentGenerationId,
        null,
        'a refused activation must not have published anything',
      );
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: LOCAL-47 — the EXPECT_NOTHING_SERVED fence reconciles against an already-served destination and never overwrites it`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const first = await publishOneGeneration(
        fixture,
        destination,
        23,
        EXPECT_NOTHING_SERVED,
      );
      assert.equal(first.activation.decision, 'activate');

      // This is the exact bug LOCAL-47 closes: a caller asserting "nothing
      // is served here" against a destination that *is* serving something
      // must be fenced off, not silently allowed to overwrite a live
      // generation.
      const files = fixture.makeFiles(24);
      const generationId = generateUuidV7();
      const staged = await adapter.stage({
        destination,
        ...freshOperation(),
        generationId,
        artifactId: generateUuidV7(),
        artifactDigest: fixture.computeArtifactDigest(files),
        files: cloneFiles(files),
      });
      const activation = await adapter.activate({
        destination,
        stageToken: staged.stageToken,
        generationId,
        expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
      });
      assert.equal(
        activation.decision,
        'reconcile',
        'EXPECT_NOTHING_SERVED must fence against an already-served destination',
      );

      const stillCurrent = await adapter.inspectDestination(destination);
      assert.equal(
        stillCurrent.currentGenerationId,
        first.generationId,
        'the served generation must be untouched by a fenced-off activation',
      );
      const observedFirst = await adapter.observe({
        destination,
        generationId: first.generationId,
        expectedArtifactDigest: first.artifactDigest,
      });
      assert.equal(
        observedFirst.verified,
        true,
        'the previously served generation must remain intact and verifiable',
      );
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: observe detects tampering of served bytes`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const published = await publishOneGeneration(
        fixture,
        destination,
        30,
        EXPECT_NOTHING_SERVED,
      );
      await fixture.tamperServedByte(destination, published.generationId);

      const observed = await adapter.observe({
        destination,
        generationId: published.generationId,
        expectedArtifactDigest: published.artifactDigest,
      });
      assert.equal(
        observed.verified,
        false,
        'tampering a served byte must be detected, not silently verified',
      );
      assert.ok(observed.findings.length > 0);
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: cleanupStaged removes only its own staged scratch, never the active generation`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const published = await publishOneGeneration(
        fixture,
        destination,
        40,
        EXPECT_NOTHING_SERVED,
      );
      await adapter.cleanupStaged({
        destination,
        stageToken: published.stageToken,
      });

      const observed = await adapter.observe({
        destination,
        generationId: published.generationId,
        expectedArtifactDigest: published.artifactDigest,
      });
      assert.equal(
        observed.verified,
        true,
        'cleaning up stage scratch must never disturb the already-activated generation',
      );
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: rollback (reupload) restores a prior generation's content under a new identity`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const first = await publishOneGeneration(
        fixture,
        destination,
        50,
        EXPECT_NOTHING_SERVED,
      );
      const second = await publishOneGeneration(
        fixture,
        destination,
        51,
        first.generationId,
      );

      const rolledBack = await adapter.rollback({
        destination,
        targetGenerationId: first.generationId,
        newGenerationId: generateUuidV7(),
        newArtifactId: generateUuidV7(),
        ...freshOperation(),
      });
      assert.equal(rolledBack.decision, 'activate');
      assert.notEqual(rolledBack.generationId, first.generationId);
      assert.notEqual(rolledBack.generationId, second.generationId);

      const observed = await adapter.observe({
        destination,
        generationId: rolledBack.generationId,
        expectedArtifactDigest: first.artifactDigest,
      });
      assert.equal(
        observed.verified,
        true,
        'a rolled-back generation must byte-match the original target generation',
      );
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: repeating one stage+activate operation is idempotent`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const files = fixture.makeFiles(60);
      const operation = freshOperation();
      const generationId = generateUuidV7();
      const artifactId = generateUuidV7();
      const artifactDigest = `sha256:${randomBytes(32).toString('hex')}`;

      const firstStage = await adapter.stage({
        destination,
        ...operation,
        generationId,
        artifactId,
        artifactDigest,
        files: cloneFiles(files),
      });
      const secondStage = await adapter.stage({
        destination,
        ...operation,
        generationId,
        artifactId,
        artifactDigest,
        files: cloneFiles(files),
      });
      assert.equal(secondStage.idempotent, true);
      assert.equal(secondStage.stageToken, firstStage.stageToken);

      const firstActivation = await adapter.activate({
        destination,
        stageToken: firstStage.stageToken,
        generationId,
        expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
      });
      const secondActivation = await adapter.activate({
        destination,
        stageToken: firstStage.stageToken,
        generationId,
        expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
      });
      assert.equal(firstActivation.decision, 'activate');
      assert.equal(secondActivation.decision, 'activate');
      assert.equal(secondActivation.idempotent, true);

      const releases = (await adapter.inspectDestination(destination))
        .releaseGenerationsOnDisk;
      assert.equal(
        releases.filter((/** @type {string} */ id) => id === generationId)
          .length,
        1,
        'a repeated stage+activate must never create a duplicate generation',
      );
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: activation refuses a stage whose bytes disagree with the caller's frozen artifact digest`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const files = fixture.makeFiles(70);
      const operation = freshOperation();
      const generationId = generateUuidV7();
      const artifactId = generateUuidV7();
      const artifactDigest = `sha256:${randomBytes(32).toString('hex')}`;
      const staged = await adapter.stage({
        destination,
        ...operation,
        generationId,
        artifactId,
        artifactDigest,
        files: cloneFiles(files),
      });

      // The caller's frozen artifact identity (what it expects to have
      // staged, e.g. because a torn write or a concurrent mutation left the
      // stage directory disagreeing with it) is deliberately wrong here.
      // Activation must recompute the staged bytes' own digest and refuse
      // to promote rather than serving a partial or tampered generation.
      // `assert.rejects` — not a manual try/catch around `assert.fail` —
      // is required so this test actually fails when `activate` wrongly
      // *resolves*: an `assert.fail` placed inside the same `try` a `catch`
      // guards is caught by that same `catch`, and `assert.fail`'s own
      // message can itself satisfy a loose message-matching regex,
      // silently passing a suite run against an adapter that never checks
      // integrity at all.
      await assert.rejects(
        adapter.activate({
          destination,
          stageToken: staged.stageToken,
          generationId,
          expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
          expectedArtifactDigest: `sha256:${randomBytes(32).toString('hex')}`,
        }),
        /STAGE_INTEGRITY_MISMATCH|integrity|digest/iu,
      );
    } finally {
      await teardown();
    }
  });

  test(`[conformance] ${fixture.adapterId}: an activation interrupted before the pointer swap never serves a partial generation, and recovery cleans up the abandoned attempt`, async () => {
    const { destination, teardown } = await fixture.createDestination();
    try {
      const first = await publishOneGeneration(
        fixture,
        destination,
        80,
        EXPECT_NOTHING_SERVED,
      );

      const interrupted = await fixture.simulateInterruptedActivation(
        destination,
        81,
      );

      // The interruption must have prevented the pointer swap: the
      // previously served generation is still the one observably current,
      // never a half-activated candidate and never `null`.
      const duringOutage = await adapter.inspectDestination(destination);
      assert.equal(duringOutage.currentGenerationId, first.generationId);
      const observedFirst = await adapter.observe({
        destination,
        generationId: first.generationId,
        expectedArtifactDigest: first.artifactDigest,
      });
      assert.equal(
        observedFirst.verified,
        true,
        'the previously served generation must remain fully intact and verifiable after an interrupted activation',
      );

      // Recovery: cleaning up the abandoned attempt (identified by the
      // stage token and/or generation id the interrupted call was using)
      // must not error, must not touch the still-active generation, and
      // must leave no trace of the abandoned candidate as a published
      // release.
      await adapter.cleanupStaged({
        destination,
        stageToken: interrupted.stageToken,
        generationId: interrupted.generationId,
      });

      const afterRecovery = await adapter.inspectDestination(destination);
      assert.equal(afterRecovery.currentGenerationId, first.generationId);
      assert.ok(
        !afterRecovery.releaseGenerationsOnDisk.includes(
          interrupted.generationId,
        ),
        'an abandoned, never-activated generation must not be left behind as a published release after recovery',
      );
      const observedFirstAfterRecovery = await adapter.observe({
        destination,
        generationId: first.generationId,
        expectedArtifactDigest: first.artifactDigest,
      });
      assert.equal(observedFirstAfterRecovery.verified, true);
    } finally {
      await teardown();
    }
  });
}
