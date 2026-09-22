/**
 * Run the reusable `@rathnasgala2/adapter-conformance-kit` suite against
 * this package's real POSIX implementation (S2-T17 deliverable (c)): every
 * lifecycle call below goes through the actual filesystem under a fresh
 * temporary destination root, not a simulation.
 */

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runAdapterConformanceSuite } from '@rathnasgala2/adapter-conformance-kit';

import * as adapterModule from '../src/index.js';
import {
  computeArtifactDigest,
  fenceFor,
  generateUuidV7,
} from '../src/index.js';

/**
 * @param {number} seed a distinct seed
 * @returns {{path: string, bytes: Buffer}[]} a small deterministic file set
 */
function buildFiles(seed) {
  const salt = randomBytes(4).toString('hex');
  return [
    {
      path: 'index.html',
      bytes: Buffer.from(`<html>seed-${seed}-${salt}</html>`, 'utf8'),
    },
    {
      path: 'about/index.html',
      bytes: Buffer.from(`about-${seed}-${salt}`, 'utf8'),
    },
  ];
}

runAdapterConformanceSuite({
  adapterModule,
  adapterId: 'local-directory',
  computeArtifactDigest,
  async createDestination() {
    const root = await mkdtemp(
      path.join(tmpdir(), 'gala-local-directory-conformance-'),
    );
    return {
      destination: { root },
      teardown: () => rm(root, { recursive: true, force: true }),
    };
  },
  makeFiles: buildFiles,
  async tamperServedByte(destination, generationId) {
    const target = path.join(
      /** @type {{root: string}} */ (destination).root,
      'releases',
      generationId,
      'index.html',
    );
    const bytes = await fs.readFile(target);
    bytes.writeUInt8((bytes.readUInt8(0) + 1) % 256, 0);
    await fs.writeFile(target, bytes);
  },
  async simulateInterruptedActivation(destination, seed) {
    const typedDestination = /** @type {{root: string}} */ (destination);
    const files = buildFiles(seed);
    const artifactDigest = computeArtifactDigest(files);
    const generationId = generateUuidV7();
    const staged = await adapterModule.stage({
      destination: typedDestination,
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId,
      artifactId: generateUuidV7(),
      artifactDigest,
      files,
    });

    let threw = false;
    try {
      await adapterModule.activate({
        destination: typedDestination,
        stageToken: staged.stageToken,
        generationId,
        expectedCurrentGenerationId: fenceFor(
          (await adapterModule.inspectDestination(typedDestination))
            .currentGenerationId,
        ),
        crashInjectionHook: () => {
          throw new Error('INJECTED_ACTIVATION_CRASH: simulated interruption');
        },
      });
    } catch (error) {
      threw = true;
      if (
        !/INJECTED_ACTIVATION_CRASH/u.test(/** @type {Error} */ (error).message)
      ) {
        throw error;
      }
    }
    if (!threw) {
      throw new Error(
        'simulateInterruptedActivation: the crash injection hook did not interrupt activation',
      );
    }

    return { stageToken: staged.stageToken, generationId };
  },
});
