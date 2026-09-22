import { randomUUID } from 'node:crypto';

import { fenceFor, generateUuidV7 } from '@rathnasgala2/adapter-protocol';

import { runAdapterConformanceSuite } from '../src/index.js';
import {
  computeArtifactDigest,
  createFakeDestination,
  fakeAdapterModule,
} from './fake-adapter.js';

/**
 * @param {number} seed a distinct seed
 * @returns {{path: string, bytes: Buffer}[]} a small deterministic file set
 */
function buildFiles(seed) {
  return [
    { path: 'index.html', bytes: Buffer.from(`<html>seed-${seed}</html>`) },
    { path: 'about/index.html', bytes: Buffer.from(`about-${seed}`) },
  ];
}

runAdapterConformanceSuite({
  adapterModule: fakeAdapterModule,
  adapterId: 'local-directory',
  async createDestination() {
    const { destination } = createFakeDestination();
    return { destination, teardown: async () => undefined };
  },
  computeArtifactDigest,
  makeFiles: buildFiles,
  async tamperServedByte(destination, generationId) {
    const d = /** @type {any} */ (destination);
    const release = d.releases.get(generationId);
    if (release && release.files.length > 0) {
      const file = release.files[0];
      const tampered = Buffer.from(file.bytes);
      tampered.writeUInt8((tampered.readUInt8(0) + 1) % 256, 0);
      file.bytes = tampered;
    }
  },
  async simulateInterruptedActivation(destination, seed) {
    const files = buildFiles(seed);
    const artifactDigest = computeArtifactDigest(files);
    const generationId = generateUuidV7();
    const staged = /** @type {{stageToken: string}} */ (
      await fakeAdapterModule.stage({
        destination,
        operationId: randomUUID(),
        attemptId: randomUUID(),
        idempotencyKey: randomUUID(),
        generationId,
        artifactId: generateUuidV7(),
        artifactDigest,
        files,
      })
    );

    let threw = false;
    try {
      await fakeAdapterModule.activate({
        destination,
        stageToken: staged.stageToken,
        generationId,
        expectedCurrentGenerationId: fenceFor(
          /** @type {any} */ (destination).current,
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
