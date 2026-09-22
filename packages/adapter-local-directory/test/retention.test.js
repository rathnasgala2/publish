/**
 * Duty-9 retention (S2-T17 review fix): `activate` must physically sweep
 * `releases/<generationId>` directories that fall out of the retained
 * window (the active generation plus five priors), never the active one,
 * never anything outside the destination root. This test activates seven
 * distinct generations in sequence and counts the release directories left
 * on disk, rather than only inspecting the abstract retained-history
 * bookkeeping (which `inspectDestination` already covers elsewhere).
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  activate,
  computeArtifactDigest,
  fenceFor,
  generateUuidV7,
  inspectDestination,
  stage,
} from '../src/index.js';

/**
 * @param {number} seed a distinct seed
 * @returns {{path: string, bytes: Buffer}[]} a tiny deterministic file set
 */
function filesFor(seed) {
  return [{ path: 'index.html', bytes: Buffer.from(`seed-${seed}`, 'utf8') }];
}

/**
 * @param {{root: string}} destination the destination
 * @param {number} seed a distinct seed
 * @returns {Promise<string>} the newly activated generation id
 */
async function publishGeneration(destination, seed) {
  const files = filesFor(seed);
  const artifactDigest = computeArtifactDigest(files);
  const generationId = generateUuidV7();
  const before = await inspectDestination(destination);
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
  const activation = await activate({
    destination,
    stageToken: staged.stageToken,
    generationId,
    expectedCurrentGenerationId: fenceFor(before.currentGenerationId),
  });
  assert.equal(activation.decision, 'activate');
  return generationId;
}

/**
 * List the `releases/*` directory names physically present on disk,
 * excluding staging scratch directories.
 *
 * @param {string} root the destination root
 * @returns {Promise<string[]>} the release directory names
 */
async function listReleaseDirsOnDisk(root) {
  const entries = await fs.readdir(path.join(root, 'releases'), {
    withFileTypes: true,
  });
  return entries
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.gala-stage-'),
    )
    .map((entry) => entry.name);
}

test('activating seven generations in sequence physically retains only the active generation plus five priors on disk', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gala-local-retention-'));
  const destination = { root };
  try {
    /** @type {string[]} */
    const generationIds = [];
    for (let seed = 0; seed < 7; seed += 1) {
      generationIds.push(await publishGeneration(destination, seed));
    }
    assert.equal(generationIds.length, 7);

    const onDisk = await listReleaseDirsOnDisk(root);
    assert.equal(
      onDisk.length,
      6,
      `expected exactly 6 release directories on disk (active + 5 priors), found ${onDisk.length}: ${JSON.stringify(onDisk)}`,
    );

    const retainedIds = new Set(onDisk);
    const [oldest, ...rest] = generationIds;
    assert.ok(oldest !== undefined, 'expected a non-empty generationIds array');
    assert.ok(
      !retainedIds.has(oldest),
      'the oldest (8th-from-active) generation must have been physically removed',
    );
    for (const generationId of rest) {
      assert.ok(
        retainedIds.has(generationId),
        `generation ${generationId} should still be retained on disk`,
      );
    }

    const inspected = await inspectDestination(destination);
    assert.equal(
      inspected.currentGenerationId,
      generationIds[generationIds.length - 1],
    );
    assert.equal(inspected.releaseGenerationsOnDisk.length, 6);
    assert.deepEqual(
      [...inspected.releaseGenerationsOnDisk].sort(),
      [...onDisk].sort(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the retention sweep never removes anything outside the destination root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gala-local-retention-'));
  const destination = { root };
  try {
    for (let seed = 0; seed < 7; seed += 1) {
      await publishGeneration(destination, seed);
    }
    // The root itself, its parent and every root-owned control name besides
    // `releases/*` must be untouched by the sweep.
    const rootStat = await fs.stat(root);
    assert.ok(rootStat.isDirectory());
    const controlStat = await fs.stat(path.join(root, '.gala-local-v2'));
    assert.ok(controlStat.isDirectory());
    const currentLinkStat = await fs.lstat(path.join(root, 'current'));
    assert.ok(currentLinkStat.isSymbolicLink());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
