/**
 * Run the reusable `@rathnasgala2/adapter-conformance-kit` suite against
 * this package's real implementation, bound to a local S3-compatible fake
 * (S4-T05). Every call is a real, SigV4-signed HTTP request; the served
 * bytes are read back over a separate public website origin. The identical
 * fixture runs against a throwaway MinIO container in
 * `minio-conformance.test.js`.
 */

import { runAdapterConformanceSuite } from '@rathnasgala2/adapter-conformance-kit';

import { startFakeSpaces } from './fake-s3-server.js';
import { buildSpacesFixture } from './spaces-fixture.js';

let sequence = 0;

runAdapterConformanceSuite(
  buildSpacesFixture(async () => {
    sequence += 1;
    const provider = await startFakeSpaces({
      servedBucket: `gala-served-fake-${sequence}`,
      stagingBucket: `gala-staging-fake-${sequence}`,
    });
    return {
      ...provider,
      /**
       * Flip one byte of a served object, out of band from the adapter.
       *
       * @param {string} key the served object key
       * @returns {Promise<void>} resolves once the byte is flipped
       */
      tamper(key) {
        const store = provider.buckets.get(provider.servedBucket);
        const object = store?.get(key);
        if (object === undefined) {
          throw new Error(`tamper: ${key} is not served`);
        }
        const mutated = Buffer.from(object.bytes);
        mutated.writeUInt8((mutated.readUInt8(0) + 1) % 256, 0);
        store?.set(key, { ...object, bytes: mutated });
        return Promise.resolve();
      },
    };
  }, 'fake'),
);
