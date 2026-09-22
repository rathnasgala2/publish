/**
 * Package-level assertions, plus the LOCAL-47 activation-fence regressions
 * this adapter is the reference implementation of: `null` is refused, and
 * the explicit `EXPECT_NOTHING_SERVED` sentinel genuinely fences.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  EXPECT_NOTHING_SERVED,
  PACKAGE_STATUS,
  activate,
  computeArtifactDigest,
  generateUuidV7,
  inspectDestination,
  observe,
  stage,
} from '../src/index.js';

test('package reports itself as implemented (S2-T17)', () => {
  assert.equal(PACKAGE_STATUS.implemented, true);
  assert.equal(PACKAGE_STATUS.implementingTask, 'S2-T17');
  assert.equal(PACKAGE_STATUS.name, '@rathnasgala2/adapter-local-directory');
});

/**
 * Build a small deterministic file set for one generation.
 *
 * @param {number} seed a distinct seed
 * @returns {{path: string, bytes: Buffer}[]} the file set
 */
function buildFiles(seed) {
  const salt = randomBytes(4).toString('hex');
  return [
    {
      path: 'index.html',
      bytes: Buffer.from(`<html>seed-${seed}-${salt}</html>`, 'utf8'),
    },
  ];
}

/**
 * Stage one fresh generation into a destination without activating it.
 *
 * @param {{root: string}} destination the destination
 * @param {number} seed a distinct seed
 * @returns {Promise<{stageToken: string, generationId: string, artifactDigest: string}>}
 *   the staged generation's identities
 */
async function stageOne(destination, seed) {
  const files = buildFiles(seed);
  const artifactDigest = computeArtifactDigest(files);
  const generationId = generateUuidV7();
  const staged = await stage({
    destination,
    operationId: generateUuidV7(),
    attemptId: generateUuidV7(),
    idempotencyKey: generateUuidV7(),
    generationId,
    artifactId: generateUuidV7(),
    artifactDigest,
    files,
  });
  return { stageToken: staged.stageToken, generationId, artifactDigest };
}

/**
 * Provision a fresh temporary destination root and a teardown callback.
 *
 * @returns {Promise<{destination: {root: string}, teardown: () => Promise<void>}>}
 *   the destination and its teardown
 */
async function createDestination() {
  const root = await mkdtemp(path.join(tmpdir(), 'gala-local-fence-'));
  return {
    destination: { root },
    teardown: () => rm(root, { recursive: true, force: true }),
  };
}

test('LOCAL-47: activate refuses expectedCurrentGenerationId: null instead of publishing unfenced', async () => {
  const { destination, teardown } = await createDestination();
  try {
    const staged = await stageOne(destination, 1);

    // Until adapter protocol 2.1.0 this adapter's `!== null` guard read
    // `null` as "no expectation, do not fence me", so the caller that meant
    // "this is a first publish, refuse if anything is already served" got
    // no fence at all. `null` is now an invalid fence value.
    await assert.rejects(
      activate({
        destination,
        stageToken: staged.stageToken,
        generationId: staged.generationId,
        expectedCurrentGenerationId: /** @type {any} */ (null),
      }),
      (/** @type {any} */ error) => {
        assert.equal(
          error.findings[0].code,
          'EXPECTED_GENERATION_FENCE_INVALID',
        );
        assert.equal(error.findings[0].severity, 'TARGET_CONSTRAINT_ERROR');
        assert.match(error.findings[0].detail, /LOCAL-47/u);
        return true;
      },
    );

    assert.equal(
      (await inspectDestination(destination)).currentGenerationId,
      null,
      'a refused activation must not have published anything',
    );
  } finally {
    await teardown();
  }
});

test('LOCAL-47: undefined and a non-string fence are refused the same way', async () => {
  const { destination, teardown } = await createDestination();
  try {
    const staged = await stageOne(destination, 2);
    for (const value of [undefined, '', 0, {}]) {
      await assert.rejects(
        activate({
          destination,
          stageToken: staged.stageToken,
          generationId: staged.generationId,
          expectedCurrentGenerationId: /** @type {any} */ (value),
        }),
        /EXPECTED_GENERATION_FENCE_INVALID|expectedCurrentGenerationId/u,
        `${JSON.stringify(value)} must be refused as a fence value`,
      );
    }
  } finally {
    await teardown();
  }
});

test('LOCAL-47: EXPECT_NOTHING_SERVED reconciles against an already-served destination and leaves it untouched', async () => {
  const { destination, teardown } = await createDestination();
  try {
    // A generation is already live at this destination.
    const first = await stageOne(destination, 10);
    const firstActivation = await activate({
      destination,
      stageToken: first.stageToken,
      generationId: first.generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    });
    assert.equal(firstActivation.decision, 'activate');

    // This is the exact bug LOCAL-47 closes: a caller asserting "nothing is
    // served here" — previously written `null`, and therefore previously no
    // fence at all — must now be fenced off rather than allowed to
    // overwrite the live generation.
    const second = await stageOne(destination, 11);
    const secondActivation = await activate({
      destination,
      stageToken: second.stageToken,
      generationId: second.generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    });
    assert.equal(
      secondActivation.decision,
      'reconcile',
      'EXPECT_NOTHING_SERVED must fence against a destination that is already serving a generation',
    );
    assert.equal(secondActivation.previousGenerationId, first.generationId);
    assert.equal(secondActivation.idempotent, false);

    const stillCurrent = await inspectDestination(destination);
    assert.equal(
      stillCurrent.currentGenerationId,
      first.generationId,
      'the served generation must be untouched by the fenced-off activation',
    );
    const observed = await observe({
      destination,
      generationId: first.generationId,
      expectedArtifactDigest: first.artifactDigest,
    });
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
  } finally {
    await teardown();
  }
});

test('LOCAL-47: EXPECT_NOTHING_SERVED activates normally against a destination that genuinely serves nothing', async () => {
  const { destination, teardown } = await createDestination();
  try {
    const staged = await stageOne(destination, 20);
    const activation = await activate({
      destination,
      stageToken: staged.stageToken,
      generationId: staged.generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    });
    assert.equal(activation.decision, 'activate');
    assert.equal(activation.previousGenerationId, null);
    assert.equal(
      (await inspectDestination(destination)).currentGenerationId,
      staged.generationId,
    );
  } finally {
    await teardown();
  }
});
