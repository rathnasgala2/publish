/**
 * The shared `do-spaces` conformance fixture.
 *
 * It is parameterised by an S3-compatible endpoint factory so exactly the
 * same fixture drives the always-on in-process fake (`conformance.test.js`)
 * and the opt-in throwaway MinIO container (`minio-conformance.test.js`):
 * a divergence between the two is then a real difference in the server, not
 * a difference in what was asked of it.
 */

import { randomBytes } from 'node:crypto';

import * as adapterModule from '../src/index.js';
import {
  EXPECT_NOTHING_SERVED,
  computeArtifactDigest,
  forgetDestination,
  generateUuidV7,
} from '../src/index.js';

/**
 * Build the conformance fixture for one S3-compatible endpoint factory.
 *
 * @param {() => Promise<Record<string, any>>} startProvider provisions one
 *   isolated S3-compatible endpoint with two empty buckets
 * @param {string} label the fixture label, used to keep bucket names unique
 * @returns {import('@rathnasgala2/adapter-conformance-kit').ConformanceFixture}
 *   the fixture
 */
export function buildSpacesFixture(startProvider, label) {
  /** @type {Map<string, Record<string, any>>} */
  const providers = new Map();

  /**
   * @param {number} seed a distinct seed
   * @returns {{path: string, bytes: Buffer}[]} a deterministic file set
   */
  function makeFiles(seed) {
    const salt = randomBytes(4).toString('hex');
    return [
      {
        path: 'index.html',
        bytes: Buffer.from(
          `<!doctype html><title>${label} ${seed} ${salt}</title>`,
          'utf8',
        ),
      },
      {
        path: 'about/index.html',
        bytes: Buffer.from(`about ${seed} ${salt}`, 'utf8'),
      },
      {
        // A key carrying the RFC 3986 sub-delimiters an S3 client must
        // percent-encode exactly as the signer does. Ordinary site assets
        // have names like this, and getting it wrong is a provider-side
        // `SignatureDoesNotMatch` that no fake with a lenient verifier
        // would ever show.
        path: `assets/photo (${seed})!*.bin`,
        bytes: Buffer.from(`asset ${seed} ${salt}`, 'utf8'),
      },
    ];
  }

  return {
    adapterModule,
    adapterId: /** @type {'do-spaces'} */ ('do-spaces'),
    computeArtifactDigest,
    makeFiles,
    async createDestination() {
      const provider = await startProvider();
      const destination = {
        region: provider.region,
        servedBucket: provider.servedBucket,
        stagingBucket: provider.stagingBucket,
        accessKeyId: provider.accessKeyId,
        secretAccessKey: provider.secretAccessKey,
        fetch: provider.fetch,
      };
      providers.set(provider.servedBucket, provider);
      return {
        destination,
        async teardown() {
          providers.delete(provider.servedBucket);
          forgetDestination(destination);
          await provider.stop();
        },
      };
    },
    async tamperServedByte(destination) {
      const served = /** @type {{servedBucket: string}} */ (destination)
        .servedBucket;
      const provider = providers.get(served);
      if (provider === undefined) {
        throw new Error(`no provider registered for ${served}`);
      }
      await provider.tamper('index.html');
    },
    async simulateInterruptedActivation(destination, seed) {
      const typed = /** @type {any} */ (destination);
      const files = makeFiles(seed);
      const generationId = generateUuidV7();
      const staged = await adapterModule.stage({
        destination: typed,
        operationId: generateUuidV7(),
        attemptId: generateUuidV7(),
        idempotencyKey: generateUuidV7(),
        generationId,
        artifactId: generateUuidV7(),
        artifactDigest: computeArtifactDigest(files),
        files,
      });

      // The fence is mandatory (LOCAL-47), so the interruption must be
      // driven against the generation the destination is actually serving —
      // otherwise activation honestly reconciles before it ever reaches the
      // crash boundary this fixture exists to exercise.
      const servedNow = await adapterModule.inspectDestination(typed);
      let threw = false;
      try {
        await adapterModule.activate({
          destination: typed,
          stageToken: /** @type {string} */ (staged.stageToken),
          generationId,
          expectedCurrentGenerationId:
            /** @type {string | null} */ (servedNow.currentGenerationId) ??
            EXPECT_NOTHING_SERVED,
          crashInjectionHook: () => {
            throw new Error(
              'INJECTED_ACTIVATION_CRASH: simulated interruption',
            );
          },
        });
      } catch (error) {
        threw = true;
        if (
          !/INJECTED_ACTIVATION_CRASH/u.test(
            /** @type {Error} */ (error).message,
          )
        ) {
          throw error;
        }
      }
      if (!threw) {
        throw new Error(
          'simulateInterruptedActivation: the crash injection hook did not interrupt activation',
        );
      }
      return {
        stageToken: /** @type {string} */ (staged.stageToken),
        generationId,
      };
    },
  };
}
