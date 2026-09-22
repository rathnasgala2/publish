/**
 * Truthfulness gate: the declared request catalog is the *only* set of
 * requests this adapter can make, and every request matches the row the
 * adapter said it was issuing.
 *
 * The adapter declares `gala-do-spaces-sigv4-v2` as data and digests it into
 * its capability declaration, which is a claim a reader cannot check by
 * reading the catalog — only by watching the wire. So this file drives a
 * complete lifecycle through a `fetch` that classifies every single request
 * against the catalog and fails on the first one no `(stage, callClass)`
 * template describes. There is no allowance list: zero undeclared requests.
 *
 * Two independent checks run on every call:
 *
 *  1. the wire request must match at least one template (method, origin,
 *     request target and canonical query profile), and
 *  2. the `(stage, callClass)` the adapter announced through its
 *     credential-free `onProviderCall` diagnostics record must be one of the
 *     templates that wire request matches — so an adapter cannot satisfy the
 *     gate by claiming one row and issuing another.
 *
 * Requests to the credential-free website origin are recognised separately
 * and asserted to carry no credential at all: the catalog deliberately has no
 * object-`GET` row, and the marker read is a public read, not a hidden signed
 * one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as adapter from '../src/index.js';
import { EXPECT_NOTHING_SERVED } from '../src/index.js';
import { deriveOrigins } from '../src/origins.js';
import { buildRequestTemplates } from '../src/request-catalog.js';
import { startFakeSpaces } from './fake-s3-server.js';

/**
 * Turn one template's request target into a matcher for a concrete request.
 *
 * @param {Readonly<Record<string, unknown>>} template the catalog template
 * @returns {RegExp} the path matcher
 */
function targetMatcher(template) {
  const source = String(template.requestTargetTemplate).replaceAll(
    '{objectKey}',
    '[^?]+',
  );
  return new RegExp(`^${source}$`, 'u');
}

/** The exact query-parameter names each canonical query profile admits. */
const QUERY_PROFILES = Object.freeze({
  none: Object.freeze({ required: [], optional: [] }),
  'spaces-list-v2': Object.freeze({
    required: ['list-type', 'max-keys', 'prefix'],
    optional: ['continuation-token'],
  }),
  'spaces-multipart-create-v2': Object.freeze({
    required: ['uploads'],
    optional: [],
  }),
  'spaces-multipart-part-v2': Object.freeze({
    required: ['partNumber', 'uploadId'],
    optional: [],
  }),
  'spaces-upload-id-v2': Object.freeze({
    required: ['uploadId'],
    optional: [],
  }),
});

/**
 * @param {Readonly<Record<string, unknown>>} template the catalog template
 * @param {URLSearchParams} search the issued query
 * @returns {boolean} whether the query matches the declared profile exactly
 */
function queryMatches(template, search) {
  const admitted = /** @type {any} */ (QUERY_PROFILES)[
    String(template.canonicalQueryProfile)
  ];
  if (admitted === undefined) {
    return false;
  }
  const issued = [...new Set([...search.keys()])];
  return (
    issued.every(
      (name) =>
        admitted.required.includes(name) || admitted.optional.includes(name),
    ) &&
    admitted.required.every((/** @type {string} */ name) =>
      issued.includes(name),
    )
  );
}

/**
 * Classify one issued request against the catalog, returning every
 * `stage/callClass` whose template describes it. Two rows can legitimately
 * describe the same bytes — `inspect`/`observe` object-head, and the
 * byte-identical `activate`/`rollback` served-root families — which is
 * precisely why the adapter's own announced pair is checked against this set
 * rather than inferred from it.
 *
 * @param {readonly Readonly<Record<string, unknown>>[]} templates the catalog
 * @param {string} url the absolute request URL
 * @param {string} method the request method
 * @returns {string[]} every matching `stage/callClass`
 */
function classify(templates, url, method) {
  const parsed = new URL(url);
  const path = decodeURIComponent(parsed.pathname);
  /** @type {string[]} */
  const matches = [];
  for (const template of templates) {
    if (String(template.method) !== method) {
      continue;
    }
    const origin = String(template.origin);
    if (!origin.endsWith(parsed.host.split(':')[0] ?? '')) {
      continue;
    }
    if (!targetMatcher(template).test(path)) {
      continue;
    }
    if (!queryMatches(template, parsed.searchParams)) {
      continue;
    }
    matches.push(`${String(template.stage)}/${String(template.callClass)}`);
  }
  if (matches.length === 0) {
    throw new Error(
      `SPACES_UNCATALOGED_REQUEST: ${method} ${parsed.host}${parsed.pathname}${parsed.search} matches no template in gala-do-spaces-sigv4-v2`,
    );
  }
  return matches;
}

/**
 * Bind one fake provider to a destination whose every request is gated.
 *
 * @param {{servedBucket: string, stagingBucket: string}} names the bucket names
 * @returns {Promise<{
 *   provider: any,
 *   destination: any,
 *   issued: Set<string>,
 *   publicReads: string[],
 *   teardown: () => Promise<void>
 * }>} the gated fixture
 */
async function gatedDestination(names) {
  const provider = await startFakeSpaces(names);
  const origins = deriveOrigins({
    region: provider.region,
    servedBucket: provider.servedBucket,
    stagingBucket: provider.stagingBucket,
  });
  const templates = buildRequestTemplates(origins);
  /** @type {Set<string>} */
  const issued = new Set();
  /** @type {string[]} */
  const publicReads = [];
  /** @type {{stage: string, callClass: string, requestTarget: string, method: string}[]} */
  const announced = [];

  const destination = {
    region: provider.region,
    servedBucket: provider.servedBucket,
    stagingBucket: provider.stagingBucket,
    accessKeyId: provider.accessKeyId,
    secretAccessKey: provider.secretAccessKey,
    /**
     * @param {any} record the credential-free diagnostics record
     * @returns {void}
     */
    onProviderCall(record) {
      announced.push(record);
    },
    /**
     * @param {any} url the request URL
     * @param {any} init the request init
     * @returns {Promise<Response>} the fake provider's response
     */
    fetch: async (url, init) => {
      const parsed = new URL(String(url));
      const method = String(init.method);
      if (parsed.host === new URL(origins.publicOrigin).host) {
        // The credential-free website origin. The whole point of moving the
        // marker read here is that it is not a signed provider call, so it
        // must carry no credential of any kind.
        const headers = new Headers(init.headers ?? {});
        for (const name of ['authorization', 'x-amz-security-token']) {
          assert.equal(
            headers.get(name),
            null,
            `a website-origin read must never carry ${name}`,
          );
        }
        assert.equal(method, 'GET');
        publicReads.push(decodeURIComponent(parsed.pathname));
        return provider.fetch(url, init);
      }

      const matches = classify(templates, String(url), method);
      const claim = announced.shift();
      assert.ok(
        claim !== undefined,
        `${method} ${parsed.pathname} reached the wire without announcing a catalog row`,
      );
      const claimed = `${claim.stage}/${claim.callClass}`;
      assert.ok(
        matches.includes(claimed),
        `the adapter announced ${claimed} but issued a request only ${matches.join(', ')} describes`,
      );
      assert.equal(
        claim.requestTarget,
        `${parsed.pathname}${parsed.search}`,
        `${claimed} announced a different request target from the one it sent`,
      );
      issued.add(claimed);
      return provider.fetch(url, init);
    },
  };

  return {
    provider,
    destination,
    issued,
    publicReads,
    async teardown() {
      adapter.forgetDestination(destination);
      await provider.stop();
    },
  };
}

test('a complete lifecycle issues zero undeclared requests, and every request matches the row the adapter announced', async () => {
  const bound = await gatedDestination({
    servedBucket: 'gala-served-catalog',
    stagingBucket: 'gala-staging-catalog',
  });
  try {
    const { destination, issued } = bound;
    const files = [
      { path: 'index.html', bytes: Buffer.from('<!doctype html>one', 'utf8') },
      { path: 'gone.html', bytes: Buffer.from('superseded later', 'utf8') },
      {
        path: "assets/photo (1)!'*.bin",
        bytes: Buffer.alloc(adapter.MAXIMUM_SINGLE_PART_BYTES + 4096, 7),
        immutable: true,
      },
    ];
    const generationId = adapter.generateUuidV7();
    const artifactDigest = adapter.computeArtifactDigest(files);
    const staged = await adapter.stage({
      destination,
      operationId: adapter.generateUuidV7(),
      attemptId: adapter.generateUuidV7(),
      idempotencyKey: adapter.generateUuidV7(),
      generationId,
      artifactId: adapter.generateUuidV7(),
      artifactDigest,
      files,
    });
    const activation = await adapter.activate({
      destination,
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
      expectedArtifactDigest: artifactDigest,
    });
    assert.equal(activation.decision, 'activate');

    // A second activation that drops one object, so the served-root delete
    // row is exercised too.
    const secondFiles = files.filter((file) => file.path !== 'gone.html');
    const secondGenerationId = adapter.generateUuidV7();
    const secondDigest = adapter.computeArtifactDigest(secondFiles);
    const secondStage = await adapter.stage({
      destination,
      operationId: adapter.generateUuidV7(),
      attemptId: adapter.generateUuidV7(),
      idempotencyKey: adapter.generateUuidV7(),
      generationId: secondGenerationId,
      artifactId: adapter.generateUuidV7(),
      artifactDigest: secondDigest,
      files: secondFiles,
    });
    const second = await adapter.activate({
      destination,
      stageToken: /** @type {string} */ (secondStage.stageToken),
      generationId: secondGenerationId,
      expectedCurrentGenerationId: generationId,
      expectedArtifactDigest: secondDigest,
    });
    assert.equal(second.supersededObjectCount, 1);

    await adapter.inspectDestination(destination);
    const observed = await adapter.observe({
      destination,
      generationId: secondGenerationId,
      expectedArtifactDigest: secondDigest,
    });
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
    await adapter.cleanupStaged({
      destination,
      stageToken: /** @type {string} */ (staged.stageToken),
    });

    // A rollback with caller-supplied bytes, including one object above the
    // single-part ceiling so the `rollback/*` multipart family is exercised
    // too, and one fewer object so a served-root delete is exercised.
    const rollbackFiles = [
      {
        path: 'index.html',
        bytes: Buffer.from('<!doctype html>rolled', 'utf8'),
      },
      {
        path: 'assets/big.bin',
        bytes: Buffer.alloc(adapter.MAXIMUM_SINGLE_PART_BYTES + 2048, 3),
      },
    ];
    const rolledBack = await adapter.rollback({
      destination,
      targetGenerationId: secondGenerationId,
      newGenerationId: adapter.generateUuidV7(),
      newArtifactId: adapter.generateUuidV7(),
      operationId: adapter.generateUuidV7(),
      attemptId: adapter.generateUuidV7(),
      idempotencyKey: adapter.generateUuidV7(),
      files: rollbackFiles,
    });
    assert.equal(rolledBack.decision, 'activate');

    // Every row this lifecycle is meant to exercise was exercised. The two
    // multipart-abort rows are exercised by the failure tests below, which is
    // the whole remainder of the 24-row catalog.
    const expected = [
      'inspect/generation-list',
      'inspect/object-head',
      'observe/generation-list',
      'observe/object-head',
      'stage/object-put',
      'stage/multipart-create',
      'stage/multipart-part',
      'stage/multipart-complete',
      'stage/generation-marker-put',
      'activate/served-root-put',
      'activate/served-root-multipart-create',
      'activate/served-root-multipart-part',
      'activate/served-root-multipart-complete',
      'activate/served-root-delete',
      'activate/generation-marker-put',
      'cleanup-staged/staged-object-delete',
      'rollback/served-root-put',
      'rollback/served-root-multipart-create',
      'rollback/served-root-multipart-part',
      'rollback/served-root-multipart-complete',
      'rollback/served-root-delete',
      'rollback/generation-marker-put',
    ];
    for (const row of expected) {
      assert.ok(issued.has(row), `${row} was never exercised`);
    }
    assert.deepEqual(
      [...issued].filter((row) => !expected.includes(row)),
      [],
      'a request outside the expected row set reached the wire',
    );

    // The marker was read over the credential-free website origin, never as a
    // signed object GET.
    assert.ok(
      bound.publicReads.includes('/.well-known/gala-generation.json'),
      'the generation marker was never read over the website origin',
    );
  } finally {
    await bound.teardown();
  }
});

test('the two list rows bind exactly the buckets and raw prefixes DEC-097 assigns them', async () => {
  const provider = await startFakeSpaces({
    servedBucket: 'gala-served-lists',
    stagingBucket: 'gala-staging-lists',
  });
  /** @type {{host: string, prefix: string, claim: string}[]} */
  const lists = [];
  /** @type {any[]} */
  const announced = [];
  const destination = {
    region: provider.region,
    servedBucket: provider.servedBucket,
    stagingBucket: provider.stagingBucket,
    accessKeyId: provider.accessKeyId,
    secretAccessKey: provider.secretAccessKey,
    /**
     * @param {any} record the diagnostics record
     * @returns {void}
     */
    onProviderCall(record) {
      announced.push(record);
    },
    /**
     * @param {any} url the request URL
     * @param {any} init the request init
     * @returns {Promise<Response>} the response
     */
    fetch(url, init) {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('list-type') === '2') {
        const claim = announced.at(-1);
        lists.push({
          host: parsed.host.split(':')[0] ?? '',
          prefix: parsed.searchParams.get('prefix') ?? '',
          claim: `${claim.stage}/${claim.callClass}`,
        });
      }
      return provider.fetch(url, init);
    },
  };

  try {
    const files = [
      { path: 'index.html', bytes: Buffer.from('listed', 'utf8') },
    ];
    const generationId = adapter.generateUuidV7();
    const staged = await adapter.stage({
      destination,
      operationId: adapter.generateUuidV7(),
      attemptId: adapter.generateUuidV7(),
      idempotencyKey: adapter.generateUuidV7(),
      generationId,
      artifactId: adapter.generateUuidV7(),
      artifactDigest: adapter.computeArtifactDigest(files),
      files,
    });
    await adapter.activate({
      destination,
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    });
    await adapter.cleanupStaged({
      destination,
      stageToken: /** @type {string} */ (staged.stageToken),
    });

    const inspectLists = lists.filter(
      (entry) => entry.claim === 'inspect/generation-list',
    );
    const observeLists = lists.filter(
      (entry) => entry.claim === 'observe/generation-list',
    );
    assert.ok(inspectLists.length > 0);
    assert.ok(observeLists.length > 0);
    assert.equal(inspectLists.length + observeLists.length, lists.length);

    for (const entry of inspectLists) {
      assert.ok(
        entry.host.startsWith(`${provider.stagingBucket}.`),
        'inspect/generation-list binds stagingBucket',
      );
      assert.match(
        entry.prefix,
        /^_gala\/staged\/v2\/[^/]+\/[^/]+\/[^/]+\/root\/$/u,
        'inspect/generation-list binds spacesStagePrefix + "root/"',
      );
    }
    for (const entry of observeLists) {
      assert.ok(
        entry.host.startsWith(`${provider.servedBucket}.`),
        'observe/generation-list binds servedBucket',
      );
      assert.equal(
        entry.prefix,
        '',
        'observe/generation-list binds the base-path-derived served-root prefix, which for "/" is empty',
      );
    }
  } finally {
    adapter.forgetDestination(destination);
    await provider.stop();
  }
});

/**
 * Drive one multipart upload to failure so its abort row is exercised.
 *
 * @param {'staging' | 'served'} bucket which bucket's multipart to break
 * @param {string} label a unique bucket-name label
 * @returns {Promise<string[]>} every `stage/callClass` the run issued
 */
async function exerciseAbort(bucket, label) {
  const provider = await startFakeSpaces({
    servedBucket: `gala-served-${label}`,
    stagingBucket: `gala-staging-${label}`,
  });
  const origins = deriveOrigins({
    region: provider.region,
    servedBucket: provider.servedBucket,
    stagingBucket: provider.stagingBucket,
  });
  const templates = buildRequestTemplates(origins);
  /** @type {string[]} */
  const issued = [];
  /** @type {any[]} */
  const announced = [];
  const breakHost =
    bucket === 'staging' ? provider.stagingBucket : provider.servedBucket;

  const destination = {
    region: provider.region,
    servedBucket: provider.servedBucket,
    stagingBucket: provider.stagingBucket,
    accessKeyId: provider.accessKeyId,
    secretAccessKey: provider.secretAccessKey,
    /**
     * @param {any} record the diagnostics record
     * @returns {void}
     */
    onProviderCall(record) {
      announced.push(record);
    },
    /**
     * @param {any} url the request URL
     * @param {any} init the request init
     * @returns {Promise<Response>} the response
     */
    fetch(url, init) {
      const parsed = new URL(String(url));
      if (parsed.host !== new URL(origins.publicOrigin).host) {
        const matches = classify(templates, String(url), String(init.method));
        const claim = announced.shift();
        assert.ok(matches.includes(`${claim.stage}/${claim.callClass}`));
        issued.push(`${claim.stage}/${claim.callClass}`);
      }
      if (
        parsed.host.startsWith(`${breakHost}.`) &&
        parsed.searchParams.get('partNumber') === '2'
      ) {
        return Promise.resolve(
          new Response('<Error><Code>InternalError</Code></Error>', {
            status: 500,
          }),
        );
      }
      return provider.fetch(url, init);
    },
  };

  const files = [
    {
      path: 'assets/big.bin',
      bytes: Buffer.alloc(adapter.MAXIMUM_SINGLE_PART_BYTES + 4096, 9),
    },
  ];
  const generationId = adapter.generateUuidV7();
  try {
    const staged = await adapter.stage({
      destination,
      operationId: adapter.generateUuidV7(),
      attemptId: adapter.generateUuidV7(),
      idempotencyKey: adapter.generateUuidV7(),
      generationId,
      artifactId: adapter.generateUuidV7(),
      artifactDigest: adapter.computeArtifactDigest(files),
      files,
    });
    await adapter.activate({
      destination,
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    });
    assert.fail('the injected part failure did not interrupt the upload');
  } catch (error) {
    assert.match(
      /** @type {Error} */ (error).message,
      /SPACES_PROVIDER_STATUS_UNEXPECTED/u,
    );
  } finally {
    adapter.forgetDestination(destination);
    await provider.stop();
  }
  return issued;
}

test('a failed staged multipart upload aborts through cleanup-staged/staged-multipart-abort', async () => {
  const issued = await exerciseAbort('staging', 'abort-staged');
  assert.ok(issued.includes('cleanup-staged/staged-multipart-abort'));
  assert.ok(!issued.includes('cleanup-staged/served-root-multipart-abort'));
});

test('a failed served-root multipart upload aborts through cleanup-staged/served-root-multipart-abort', async () => {
  const issued = await exerciseAbort('served', 'abort-served');
  assert.ok(issued.includes('cleanup-staged/served-root-multipart-abort'));
});

test('a key containing sub-delimiter bytes is signed exactly as it is sent', async () => {
  const provider = await startFakeSpaces({
    servedBucket: 'gala-served-encoding',
    stagingBucket: 'gala-staging-encoding',
  });
  const destination = {
    region: provider.region,
    servedBucket: provider.servedBucket,
    stagingBucket: provider.stagingBucket,
    accessKeyId: provider.accessKeyId,
    secretAccessKey: provider.secretAccessKey,
    fetch: provider.fetch,
  };
  // The fake provider verifies every signature the way S3 does: from the
  // request line it actually received. A key with `!'()*` in it therefore
  // only round-trips when the signer and the client encode identically.
  const files = [
    {
      path: "assets/photo (1)!'*.png",
      bytes: Buffer.from('bytes', 'utf8'),
    },
  ];
  const generationId = adapter.generateUuidV7();
  const staged = await adapter.stage({
    destination,
    operationId: adapter.generateUuidV7(),
    attemptId: adapter.generateUuidV7(),
    idempotencyKey: adapter.generateUuidV7(),
    generationId,
    artifactId: adapter.generateUuidV7(),
    artifactDigest: adapter.computeArtifactDigest(files),
    files,
  });
  const activation = await adapter.activate({
    destination,
    stageToken: /** @type {string} */ (staged.stageToken),
    generationId,
    expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    expectedArtifactDigest: adapter.computeArtifactDigest(files),
  });
  assert.equal(activation.decision, 'activate');
  adapter.forgetDestination(destination);
  await provider.stop();
});
