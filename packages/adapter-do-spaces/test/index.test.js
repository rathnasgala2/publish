/**
 * Behavioural unit tests for the managed Spaces adapter: the exact
 * two-bucket/website origin binding and its refusals, private staging under
 * the reserved prefix, multipart upload above the declared single-part
 * ceiling, marker-last activation, the best-effort conditional pointer
 * guard, operation-scoped cleanup, and the capability declaration's honest
 * negative claims (brief section 6.3).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_CACHE_CONTROL,
  DEPLOYMENT_MEDIA_TYPES,
  EXPECT_NOTHING_SERVED,
  IMMUTABLE_CACHE_CONTROL,
  MAXIMUM_SINGLE_PART_BYTES,
  WEBSITE_CONFIGURATION,
  computeArtifactDigest,
  deriveOrigins,
  generateUuidV7,
  mediaTypeFor,
} from '../src/index.js';
import * as adapter from '../src/index.js';
import { STAGE_PREFIX } from '../src/constants.js';
import { startFakeSpaces } from './fake-s3-server.js';

let sequence = 0;

/**
 * Start one fake provider and build the destination bound to it.
 *
 * @returns {Promise<{provider: any, destination: any, teardown: () => Promise<void>}>}
 *   the bound fixture
 */
async function bind() {
  sequence += 1;
  const provider = await startFakeSpaces({
    servedBucket: `gala-served-unit-${sequence}`,
    stagingBucket: `gala-staging-unit-${sequence}`,
  });
  return {
    provider,
    destination: {
      region: provider.region,
      servedBucket: provider.servedBucket,
      stagingBucket: provider.stagingBucket,
      accessKeyId: provider.accessKeyId,
      secretAccessKey: provider.secretAccessKey,
      fetch: provider.fetch,
    },
    teardown: () => provider.stop(),
  };
}

/**
 * Publish one generation end to end.
 *
 * @param {any} destination the bound destination
 * @param {readonly {path: string, bytes: Buffer, immutable?: boolean}[]} files
 *   the file set
 * @param {string} [expectedCurrentGenerationId] the activation fence; defaults
 *   to the explicit "nothing is served" sentinel
 * @returns {Promise<{generationId: string, artifactDigest: string, activation: any}>}
 *   the published identities
 */
async function publish(destination, files, expectedCurrentGenerationId) {
  const generationId = generateUuidV7();
  const artifactDigest = computeArtifactDigest(files);
  const staged = await adapter.stage({
    destination,
    operationId: generateUuidV7(),
    attemptId: generateUuidV7(),
    idempotencyKey: generateUuidV7(),
    generationId,
    artifactId: generateUuidV7(),
    artifactDigest,
    files,
  });
  const activation = await adapter.activate({
    destination,
    stageToken: /** @type {string} */ (staged.stageToken),
    generationId,
    expectedCurrentGenerationId:
      expectedCurrentGenerationId ?? EXPECT_NOTHING_SERVED,
  });
  return { generationId, artifactDigest, activation };
}

test('the origin binding is exactly the two Spaces API origins and the one website origin', () => {
  const origins = deriveOrigins({
    region: 'nyc3',
    servedBucket: 'served',
    stagingBucket: 'staging',
  });
  assert.equal(
    origins.servedApiOrigin,
    'https://served.nyc3.digitaloceanspaces.com',
  );
  assert.equal(
    origins.stagingApiOrigin,
    'https://staging.nyc3.digitaloceanspaces.com',
  );
  assert.equal(
    origins.publicOrigin,
    'https://served.nyc3-static.digitaloceanspaces.com',
  );
});

test('one bucket for both roles, a dotted bucket name and a bad region are refused before any credential is used', () => {
  assert.throws(
    () =>
      deriveOrigins({
        region: 'nyc3',
        servedBucket: 'same',
        stagingBucket: 'same',
      }),
    /SPACES_BUCKET_BINDING_INVALID/u,
  );
  assert.throws(
    () =>
      deriveOrigins({
        region: 'nyc3',
        servedBucket: 'has.dots',
        stagingBucket: 'staging',
      }),
    /dot-free/u,
  );
  assert.throws(
    () =>
      deriveOrigins({
        region: 'not-a-region',
        servedBucket: 'served',
        stagingBucket: 'staging',
      }),
    /admitted DigitalOcean Spaces region/u,
  );
});

test('a CDN endpoint, a custom domain or a plain object origin is refused as the public base URL', async () => {
  const bound = await bind();
  try {
    for (const rejected of [
      'https://served.nyc3.cdn.digitaloceanspaces.com',
      'https://docs.example.com',
      `https://${bound.destination.servedBucket}.${bound.destination.region}.digitaloceanspaces.com`,
    ]) {
      await assert.rejects(
        adapter.describeCapabilities({
          ...bound.destination,
          publicBaseUrl: rejected,
        }),
        /SPACES_PUBLIC_ORIGIN_REJECTED/u,
      );
    }
  } finally {
    await bound.teardown();
  }
});

test('the adapter refuses a destination with no access key', async () => {
  const bound = await bind();
  try {
    const noKey = { ...bound.destination };
    delete noKey.accessKeyId;
    await assert.rejects(
      adapter.describeCapabilities(/** @type {any} */ (noKey)),
      /never mints or discovers a credential/u,
    );
  } finally {
    await bound.teardown();
  }
});

test('staging writes only under the reserved prefix in the private bucket, and never touches the served bucket', async () => {
  const bound = await bind();
  try {
    const files = [
      { path: 'index.html', bytes: Buffer.from('staged only', 'utf8') },
    ];
    await adapter.stage({
      destination: bound.destination,
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId: generateUuidV7(),
      artifactId: generateUuidV7(),
      artifactDigest: computeArtifactDigest(files),
      files,
    });

    const staging = bound.provider.buckets.get(bound.destination.stagingBucket);
    const served = bound.provider.buckets.get(bound.destination.servedBucket);
    assert.equal(
      served.size,
      0,
      'staging must never write to the served bucket',
    );
    assert.ok(staging.size > 0);
    for (const key of staging.keys()) {
      assert.ok(
        key.startsWith(STAGE_PREFIX),
        `${key} escapes the reserved staging prefix`,
      );
    }
  } finally {
    await bound.teardown();
  }
});

test('an object above the declared single-part ceiling is uploaded through the multipart calls', async () => {
  const bound = await bind();
  try {
    const big = Buffer.alloc(MAXIMUM_SINGLE_PART_BYTES + 4096, 0x62);
    big.write('multipart-head', 0, 'utf8');
    const files = [
      { path: 'index.html', bytes: Buffer.from('small', 'utf8') },
      { path: 'assets/big.bin', bytes: big },
    ];
    const published = await publish(bound.destination, files);
    assert.equal(published.activation.decision, 'activate');

    const served = bound.provider.buckets.get(bound.destination.servedBucket);
    assert.deepEqual(served.get('assets/big.bin').bytes, big);

    const observed = await adapter.observe({
      destination: bound.destination,
      generationId: published.generationId,
      expectedArtifactDigest: published.artifactDigest,
    });
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
  } finally {
    await bound.teardown();
  }
});

test('activation writes the generation marker last and supersedes removed objects', async () => {
  const bound = await bind();
  try {
    const first = await publish(bound.destination, [
      { path: 'index.html', bytes: Buffer.from('one', 'utf8') },
      { path: 'gone.html', bytes: Buffer.from('to be removed', 'utf8') },
    ]);
    assert.equal(first.activation.writtenObjectCount, 2);

    const second = await publish(
      bound.destination,
      [{ path: 'index.html', bytes: Buffer.from('two', 'utf8') }],
      first.generationId,
    );
    assert.equal(second.activation.supersededObjectCount, 1);

    const served = bound.provider.buckets.get(bound.destination.servedBucket);
    assert.equal(served.has('gone.html'), false);
    const pointer = served.get('.well-known/gala-generation.json');
    assert.ok(pointer !== undefined, 'the activation pointer must be served');
    assert.equal(
      JSON.parse(pointer.bytes.toString('utf8')).generationId,
      second.generationId,
    );
    assert.equal(
      typeof pointer.headers['cache-control'],
      'string',
      'the pointer is stored with an explicit cache directive',
    );
  } finally {
    await bound.teardown();
  }
});

test('a pointer precondition failure reconciles instead of overwriting the served generation', async () => {
  const bound = await bind();
  try {
    const first = await publish(bound.destination, [
      { path: 'index.html', bytes: Buffer.from('first', 'utf8') },
    ]);

    const files = [
      { path: 'index.html', bytes: Buffer.from('racing', 'utf8') },
    ];
    const generationId = generateUuidV7();
    const staged = await adapter.stage({
      destination: bound.destination,
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId,
      artifactId: generateUuidV7(),
      artifactDigest: computeArtifactDigest(files),
      files,
    });

    // Another writer replaces the pointer strictly between this
    // activation's read and its conditional write, so the retained ETag no
    // longer matches when the guard is evaluated.
    const served = bound.provider.buckets.get(bound.destination.servedBucket);
    const racing = {
      ...bound.destination,
      /**
       * @param {string | URL | Request} input the request target
       * @param {RequestInit} [init] the request init
       * @returns {Promise<Response>} the response
       */
      fetch(input, init) {
        if (
          init?.method === 'PUT' &&
          String(input).endsWith('/.well-known/gala-generation.json')
        ) {
          const pointer = served.get('.well-known/gala-generation.json');
          served.set('.well-known/gala-generation.json', {
            ...pointer,
            etag: 'someone-else-wrote-this',
          });
        }
        return bound.destination.fetch(input, init);
      },
    };

    const decision = await adapter.activate({
      destination: racing,
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId,
      expectedCurrentGenerationId: first.generationId,
    });
    assert.equal(decision.decision, 'reconcile');
    assert.equal(decision.pointerPreconditionFailed, true);
  } finally {
    await bound.teardown();
  }
});

test('cleanup deletes exactly this operation prefix and never a served object', async () => {
  const bound = await bind();
  try {
    const files = [{ path: 'index.html', bytes: Buffer.from('kept', 'utf8') }];
    const generationId = generateUuidV7();
    const staged = await adapter.stage({
      destination: bound.destination,
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId,
      artifactId: generateUuidV7(),
      artifactDigest: computeArtifactDigest(files),
      files,
    });
    const other = await publish(bound.destination, [
      { path: 'index.html', bytes: Buffer.from('served', 'utf8') },
    ]);

    const cleanup = await adapter.cleanupStaged({
      destination: bound.destination,
      stageToken: /** @type {string} */ (staged.stageToken),
    });
    assert.equal(cleanup.removed, true);
    assert.ok(cleanup.deletedObjectCount >= 2);

    const staging = bound.provider.buckets.get(bound.destination.stagingBucket);
    for (const key of staging.keys()) {
      assert.ok(!key.includes(`/${generationId}/`));
    }
    const observed = await adapter.observe({
      destination: bound.destination,
      generationId: other.generationId,
      expectedArtifactDigest: other.artifactDigest,
    });
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
  } finally {
    await bound.teardown();
  }
});

test('preflight refuses the reserved marker coordinate and the reserved control prefix', async () => {
  const bound = await bind();
  try {
    const refused = await adapter.preflight({
      destination: bound.destination,
      entries: [
        { path: '.well-known/gala-generation.json' },
        { path: '_gala/staged/v2/sneaky' },
        { path: 'a/../b.html' },
      ],
    });
    assert.equal(refused.verdict, 'refuse');
    const proceed = await adapter.preflight({
      destination: bound.destination,
      entries: [{ path: 'index.html' }],
    });
    assert.equal(proceed.verdict, 'proceed');
  } finally {
    await bound.teardown();
  }
});

test('the capability declaration states only the guarantees Spaces actually offers', async () => {
  const bound = await bind();
  try {
    const declaration = /** @type {any} */ (
      await adapter.describeCapabilities(bound.destination)
    );
    assert.equal(declaration.activation, 'replace-in-place');
    assert.equal(declaration.concurrency, 'best-effort');
    assert.equal(declaration.providerInventoryAssurance, 'none');
    assert.equal(declaration.cacheInvalidation, 'none');
    assert.equal(declaration.rollback, 'reupload');
    assert.equal(declaration.configuration.notFoundBehavior, true);
    assert.equal(
      declaration.limits.requestTemplateProfile,
      'gala-do-spaces-sigv4-v2',
    );
    assert.equal(declaration.limits.maximumProviderRequestBodyBytes, '5242880');
    const origins = new Set(
      declaration.limits.requestTemplates.map(
        (/** @type {any} */ template) => template.origin,
      ),
    );
    assert.deepEqual(
      [...origins].sort(),
      [
        `https://${bound.destination.servedBucket}.nyc3.digitaloceanspaces.com`,
        `https://${bound.destination.stagingBucket}.nyc3.digitaloceanspaces.com`,
      ].sort(),
      'no cataloged call may target the public website origin or anything else',
    );
  } finally {
    await bound.teardown();
  }
});

test('the required website configuration is exactly index/404 with no redirect-all and no routing rules', () => {
  const configuration = /** @type {any} */ (WEBSITE_CONFIGURATION);
  assert.equal(configuration.servedBucket.indexDocument, 'index.html');
  assert.equal(configuration.servedBucket.errorDocument, '404.html');
  assert.equal(configuration.servedBucket.redirectAllRequestsTo, null);
  assert.deepEqual(configuration.servedBucket.routingRules, []);
  assert.equal(
    configuration.stagingBucket.websiteConfiguration,
    null,
    'the private staging bucket must have no website configuration at all',
  );
});

test('rollback reuploads the caller-supplied historical bytes under a new generation identity', async () => {
  const bound = await bind();
  try {
    const originalFiles = [
      { path: 'index.html', bytes: Buffer.from('original', 'utf8') },
    ];
    const first = await publish(bound.destination, originalFiles);
    await publish(
      bound.destination,
      [{ path: 'index.html', bytes: Buffer.from('regrettable', 'utf8') }],
      first.generationId,
    );

    const newGenerationId = generateUuidV7();
    const rolledBack = await adapter.rollback({
      destination: bound.destination,
      targetGenerationId: first.generationId,
      newGenerationId,
      newArtifactId: generateUuidV7(),
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      files: originalFiles,
    });
    assert.equal(rolledBack.decision, 'activate');
    assert.equal(rolledBack.generationId, newGenerationId);

    const served = bound.provider.buckets.get(bound.destination.servedBucket);
    assert.equal(served.get('index.html').bytes.toString('utf8'), 'original');
  } finally {
    await bound.teardown();
  }
});

test('rollback of a generation this run never staged fails closed instead of inventing bytes', async () => {
  const bound = await bind();
  try {
    await publish(bound.destination, [
      { path: 'index.html', bytes: Buffer.from('served', 'utf8') },
    ]);
    // DEC-097's closed Spaces catalog has no object-GET row, so there is no
    // honest way to read a generation this process did not stage back out of
    // the provider. The adapter must say so rather than guess.
    await assert.rejects(
      adapter.rollback({
        destination: bound.destination,
        targetGenerationId: generateUuidV7(),
        newGenerationId: generateUuidV7(),
        newArtifactId: generateUuidV7(),
        operationId: generateUuidV7(),
        attemptId: generateUuidV7(),
        idempotencyKey: generateUuidV7(),
      }),
      /ROLLBACK_INPUT_UNAVAILABLE/u,
    );
  } finally {
    await bound.teardown();
  }
});

test('the activation fence refuses null and undefined, and the sentinel fences a destination that already serves a generation (LOCAL-47)', async () => {
  const bound = await bind();
  try {
    const first = await publish(bound.destination, [
      { path: 'index.html', bytes: Buffer.from('already served', 'utf8') },
    ]);

    const files = [{ path: 'index.html', bytes: Buffer.from('new', 'utf8') }];
    const generationId = generateUuidV7();
    const staged = await adapter.stage({
      destination: bound.destination,
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId,
      artifactId: generateUuidV7(),
      artifactDigest: computeArtifactDigest(files),
      files,
    });

    for (const refused of [null, undefined, '']) {
      await assert.rejects(
        adapter.activate({
          destination: bound.destination,
          stageToken: /** @type {string} */ (staged.stageToken),
          generationId,
          expectedCurrentGenerationId: /** @type {any} */ (refused),
        }),
        /EXPECTED_GENERATION_FENCE_INVALID|expectedCurrentGenerationId/u,
        `${String(refused)} was accepted as a fence`,
      );
    }

    // The sentinel is a real fence, not the old silently-unfenced `null`:
    // this destination already serves a generation, so activation reconciles
    // and leaves the destination exactly as it was.
    const decision = await adapter.activate({
      destination: bound.destination,
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    });
    assert.equal(decision.decision, 'reconcile');
    assert.equal(decision.destinationChanged, false);

    const still = await adapter.inspectDestination(bound.destination);
    assert.equal(still.currentGenerationId, first.generationId);
  } finally {
    await bound.teardown();
  }
});

test('every media type the adapter can label an object with is a member of the closed DEC-097 list', () => {
  for (const key of [
    'index.html',
    'app.css',
    'app.js',
    'app.mjs',
    'data.json',
    'site.webmanifest',
    'feed.atom',
    'feed.rss',
    'sitemap.xml',
    'notes.txt',
    'logo.svg',
    'a.png',
    'a.jpg',
    'a.jpeg',
    'a.webp',
    'a.avif',
    'a.woff2',
    'no-extension',
    'archive.tar.gz',
  ]) {
    assert.ok(
      DEPLOYMENT_MEDIA_TYPES.includes(mediaTypeFor(key)),
      `${key} was labelled ${mediaTypeFor(key)}, which is outside the closed list`,
    );
  }
  // The three values today's table got wrong.
  assert.equal(mediaTypeFor('a.js'), 'application/javascript; charset=utf-8');
  assert.equal(mediaTypeFor('a.json'), 'application/json; charset=utf-8');
  assert.equal(mediaTypeFor('a.xml'), 'application/xml; charset=utf-8');
});

test('an immutable manifest asset is served immutable and everything else is no-cache', async () => {
  const bound = await bind();
  try {
    await publish(bound.destination, [
      { path: 'index.html', bytes: Buffer.from('<!doctype html>', 'utf8') },
      {
        path: 'assets/app.abc123.js',
        bytes: Buffer.from('console.log(1)', 'utf8'),
        immutable: true,
      },
    ]);
    const served = bound.provider.buckets.get(bound.destination.servedBucket);
    assert.equal(
      served.get('index.html').headers['cache-control'],
      DEFAULT_CACHE_CONTROL,
    );
    assert.equal(
      served.get('assets/app.abc123.js').headers['cache-control'],
      IMMUTABLE_CACHE_CONTROL,
    );
    assert.equal(
      served.get('assets/app.abc123.js').headers['content-type'],
      'application/javascript; charset=utf-8',
    );
    const pointer = served.get('.well-known/gala-generation.json');
    assert.equal(pointer.headers['cache-control'], 'no-store');
    assert.equal(
      pointer.headers['content-type'],
      'application/json; charset=utf-8',
    );
    assert.match(
      pointer.headers['x-amz-meta-gala-sha256'],
      /^[0-9a-f]{64}$/u,
      'the metadata digest is the untagged 64-hex payload SHA-256',
    );
  } finally {
    await bound.teardown();
  }
});

test('a reused operation identity with a different artifact digest is a conflict', async () => {
  const bound = await bind();
  try {
    const identity = {
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId: generateUuidV7(),
      artifactId: generateUuidV7(),
    };
    const files = [{ path: 'index.html', bytes: Buffer.from('one', 'utf8') }];
    await adapter.stage({
      destination: bound.destination,
      ...identity,
      artifactDigest: computeArtifactDigest(files),
      files,
    });
    await assert.rejects(
      adapter.stage({
        destination: bound.destination,
        ...identity,
        artifactDigest: computeArtifactDigest([
          { path: 'index.html', bytes: Buffer.from('two', 'utf8') },
        ]),
        files,
      }),
      /IDEMPOTENCY_KEY_REUSE_CONFLICT/u,
    );
  } finally {
    await bound.teardown();
  }
});
