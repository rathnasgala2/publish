/**
 * Behavioural unit tests for the managed Pages adapter: the exact poll
 * schedule and status partition, `pagesDeploymentId == pagesBuildVersion`,
 * the never-followed `status_url`, fail-closed refusals when a required
 * capability is absent, and the preflight route rules (brief section 6.2).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PAGES_DEPLOYMENT_STATUSES,
  POLL_SCHEDULE_SECONDS,
  SUCCESS_STATUS,
  TEMPORARY_STATUSES,
  TERMINAL_FAILURE_STATUSES,
} from '../src/constants.js';
import { pollDeployment } from '../src/deployment.js';
import * as adapter from '../src/index.js';
import {
  computeArtifactDigest,
  forgetDestination,
  generateUuidV7,
} from '../src/index.js';
import { buildRequestTemplates } from '../src/request-catalog.js';
import { expectedStatusUrl } from '../src/rest.js';
import { startFakePagesProvider } from './fake-pages-provider.js';
import { oidcFor } from './oidc-fixture.js';

/**
 * The adapter-protocol `2.1.0` fence sentinel, spelled out so this suite
 * does not depend on the protocol package's generated declarations.
 */
const EXPECT_NOTHING_SERVED = 'gala:expect-nothing-served';

let sequence = 0;

/**
 * Start one fake provider and build the destination bound to it.
 *
 * @param {{statusSequence?: readonly string[]}} [options] provider options
 * @returns {Promise<{provider: any, destination: any, waited: number[], teardown: () => Promise<void>}>}
 *   the bound fixture
 */
async function bind(options = {}) {
  sequence += 1;
  const provider = await startFakePagesProvider({
    repository: `unit-pages-${sequence}`,
    ...options,
  });
  /** @type {number[]} */
  const waited = [];
  const destination = {
    owner: provider.owner,
    repository: provider.repository,
    repositoryId: String(9000 + sequence),
    repositoryOwnerId: '99001',
    apiOrigin: provider.apiOrigin,
    publicBaseUrl: provider.publicBaseUrl,
    token: provider.token,
    publishCarrier: provider.publishCarrier,
    fetch: provider.fetch,
    /**
     * @param {number} seconds the scheduled wait
     * @returns {Promise<void>} resolves immediately, recording the wait
     */
    sleep(seconds) {
      waited.push(seconds);
      return Promise.resolve();
    },
  };
  return {
    provider,
    destination,
    waited,
    async teardown() {
      forgetDestination(destination);
      await provider.stop();
    },
  };
}

/**
 * Publish one generation end to end.
 *
 * @param {any} destination the bound destination
 * @param {string} body the page body
 * @returns {Promise<{generationId: string, artifactDigest: string, activation: any}>}
 *   the published identities
 */
async function publish(destination, body) {
  const files = [{ path: 'index.html', bytes: Buffer.from(body, 'utf8') }];
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
    expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    ...oidcFor(destination),
  });
  return { generationId, artifactDigest, activation };
}

test('the accepted status vocabulary is exactly the eleven DEC-097 values, partitioned without overlap', () => {
  assert.equal(PAGES_DEPLOYMENT_STATUSES.length, 11);
  assert.equal(TEMPORARY_STATUSES.length, 6);
  assert.equal(TERMINAL_FAILURE_STATUSES.length, 4);
  assert.ok(
    TEMPORARY_STATUSES.includes('deployment_attempt_error'),
    'deployment_attempt_error is temporary: GitHub retries it automatically',
  );
  const partition = [
    ...TEMPORARY_STATUSES,
    ...TERMINAL_FAILURE_STATUSES,
    SUCCESS_STATUS,
  ];
  assert.equal(new Set(partition).size, 11);
  assert.deepEqual(
    [...partition].sort(),
    [...PAGES_DEPLOYMENT_STATUSES].sort(),
  );
});

test('the poll schedule is exactly 5, 8, 12, 18, 27, 30 and then repeats 30', async () => {
  const bound = await bind({
    statusSequence: [
      ...Array.from({ length: 8 }, () => 'deployment_in_progress'),
      'succeed',
    ],
  });
  try {
    await publish(bound.destination, 'polled');
    assert.deepEqual(bound.waited, [5, 8, 12, 18, 27, 30, 30, 30]);
    assert.deepEqual([...POLL_SCHEDULE_SECONDS], [5, 8, 12, 18, 27, 30]);
  } finally {
    await bound.teardown();
  }
});

test('a deployment id that disagrees with the requested pages_build_version is refused', async () => {
  const bound = await bind();
  try {
    const lying = {
      ...bound.destination,
      /**
       * @param {string | URL | Request} input the request target
       * @param {RequestInit} [init] the request init
       * @returns {Promise<Response>} the response, with a forged create id
       */
      async fetch(input, init) {
        const response = await bound.destination.fetch(input, init);
        if (!String(input).endsWith('/pages/deployments')) {
          return response;
        }
        const body = await response.json();
        return new Response(
          JSON.stringify({ ...body, id: 'not-the-version' }),
          {
            status: response.status,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    };
    await assert.rejects(
      publish(lying, 'forged'),
      /PAGES_DEPLOYMENT_ID_MISMATCH/u,
    );
  } finally {
    await bound.teardown();
  }
});

test('polling uses the independently constructed suffix-free URL, never the create response status_url', async () => {
  const bound = await bind();
  try {
    /** @type {string[]} */
    const requested = [];
    const watched = {
      ...bound.destination,
      /**
       * @param {string | URL | Request} input the request target
       * @param {RequestInit} [init] the request init
       * @returns {Promise<Response>} the response
       */
      fetch(input, init) {
        requested.push(String(input));
        return bound.destination.fetch(input, init);
      },
    };
    const published = await publish(watched, 'polled-url');
    assert.equal(published.activation.decision, 'activate');

    const context = {
      apiOrigin: bound.destination.apiOrigin,
      owner: bound.destination.owner,
      repository: bound.destination.repository,
      token: bound.destination.token,
      requestTemplates: buildRequestTemplates(bound.destination.apiOrigin),
    };
    const statusUrl = expectedStatusUrl(
      context,
      bound.provider.createCalls[0].pagesBuildVersion,
    );
    assert.ok(statusUrl.endsWith('/status'));
    assert.ok(
      !requested.includes(statusUrl),
      'the provider-supplied status_url must never be followed',
    );
    assert.ok(
      requested.some((url) =>
        url.endsWith(
          `/pages/deployments/${bound.provider.createCalls[0].pagesBuildVersion}`,
        ),
      ),
      'the suffix-free poll URL must be constructed independently',
    );
  } finally {
    await bound.teardown();
  }
});

test('every terminal failure status fails the activation and never claims a served generation', async () => {
  for (const status of TERMINAL_FAILURE_STATUSES) {
    const bound = await bind({ statusSequence: [status] });
    try {
      await assert.rejects(
        publish(bound.destination, `terminal-${status}`),
        new RegExp(`PAGES_DEPLOYMENT_FAILED.*${status}`, 'u'),
      );
      const inspected = await adapter.inspectDestination(bound.destination);
      assert.equal(inspected.currentGenerationId, null);
    } finally {
      await bound.teardown();
    }
  }
});

test('an unknown status can never release the fence', async () => {
  const bound = await bind({ statusSequence: ['definitely_not_a_status'] });
  try {
    await assert.rejects(
      publish(bound.destination, 'unknown'),
      /PAGES_DEPLOYMENT_STATUS_UNKNOWN/u,
    );
  } finally {
    await bound.teardown();
  }
});

test('an exhausted poll budget is ambiguous and never reported as success', async () => {
  const bound = await bind();
  try {
    const context = {
      apiOrigin: bound.destination.apiOrigin,
      owner: bound.destination.owner,
      repository: bound.destination.repository,
      token: bound.destination.token,
      fetch: bound.destination.fetch,
      pagesBuildVersion: 'c'.repeat(40),
      requestTemplates: buildRequestTemplates(bound.destination.apiOrigin),
    };
    const staged = await adapter.stage({
      destination: bound.destination,
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId: generateUuidV7(),
      artifactId: generateUuidV7(),
      artifactDigest: computeArtifactDigest([]),
      files: [],
    });
    assert.equal(typeof staged.stageToken, 'string');
    bound.provider.seedDeployment('c'.repeat(40), ['deployment_in_progress']);
    await assert.rejects(
      pollDeployment(context, 'c'.repeat(40), {
        sleep: () => Promise.resolve(),
        budgetSeconds: 10,
      }),
      /PAGES_DEPLOYMENT_POLL_BUDGET_EXHAUSTED/u,
    );
  } finally {
    await bound.teardown();
  }
});

test('the adapter refuses a destination with no installation token or no carrier publisher', async () => {
  const bound = await bind();
  try {
    const noToken = { ...bound.destination };
    delete noToken.token;
    await assert.rejects(
      adapter.describeCapabilities(/** @type {any} */ (noToken)),
      /destination\.token/u,
    );
    const noPublisher = { ...bound.destination };
    delete noPublisher.publishCarrier;
    await assert.rejects(
      adapter.describeCapabilities(/** @type {any} */ (noPublisher)),
      /publishCarrier/u,
    );
    await assert.rejects(
      adapter.describeCapabilities(
        /** @type {any} */ ({
          ...bound.destination,
          apiOrigin: 'http://api.github.com',
        }),
      ),
      /https origin/u,
    );
  } finally {
    await bound.teardown();
  }
});

test('preflight refuses the reserved marker coordinate and non-portable routes', async () => {
  const bound = await bind();
  try {
    const result = await adapter.preflight({
      destination: bound.destination,
      entries: [
        { path: '.well-known/gala-generation.json' },
        { path: '/absolute.html' },
        { path: 'a/../b.html' },
        { path: 'duplicate.html' },
        { path: 'duplicate.html' },
      ],
    });
    assert.equal(result.verdict, 'refuse');
    const findings = /** @type {readonly string[]} */ (result.findings);
    assert.ok(
      findings.some((entry) =>
        /reserved public-generation-marker/u.test(entry),
      ),
    );
    assert.ok(
      findings.some((entry) => /portable relative POSIX path/u.test(entry)),
    );
    assert.ok(findings.some((entry) => /dot path segment/u.test(entry)));
    assert.ok(findings.some((entry) => /declared more than once/u.test(entry)));

    const clean = await adapter.preflight({
      destination: bound.destination,
      entries: [{ path: 'index.html' }],
    });
    assert.equal(clean.verdict, 'proceed');
  } finally {
    await bound.teardown();
  }
});

test('the capability declaration never claims complete inventory, a cache purge or a provider fence', async () => {
  const bound = await bind();
  try {
    const declaration = /** @type {any} */ (
      await adapter.describeCapabilities(bound.destination)
    );
    assert.equal(declaration.providerInventoryAssurance, 'none');
    assert.equal(declaration.cacheInvalidation, 'none');
    assert.equal(declaration.concurrency, 'none');
    assert.equal(declaration.activation, 'provider-promotion');
    assert.equal(declaration.rollback, 'reupload');
    assert.equal(
      declaration.limits.requestTemplateProfile,
      'gala-github-pages-http-v2',
    );
    assert.equal(declaration.limits.requestTemplates.length, 9);
    assert.ok(
      declaration.limits.requestTemplates.every(
        (/** @type {any} */ template) =>
          template.origin === bound.destination.apiOrigin,
      ),
      'every cataloged call targets the single declared control-plane origin',
    );
  } finally {
    await bound.teardown();
  }
});

test('observe reports unverified rather than verified when Pages is disabled mid-run', async () => {
  const bound = await bind();
  try {
    const published = await publish(bound.destination, 'site-state');
    bound.provider.pagesEnabled = false;
    const inspected = await adapter.inspectDestination(bound.destination);
    assert.equal(inspected.providerSiteObserved, false);
    assert.equal(inspected.currentGenerationId, published.generationId);
  } finally {
    await bound.teardown();
  }
});

test('rollback refuses when the historical bytes are unavailable to this run', async () => {
  const bound = await bind();
  try {
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

test('a reused idempotency key with a different artifact digest is a conflict', async () => {
  const bound = await bind();
  try {
    const key = generateUuidV7();
    const files = [{ path: 'index.html', bytes: Buffer.from('one', 'utf8') }];
    await adapter.stage({
      destination: bound.destination,
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: key,
      generationId: generateUuidV7(),
      artifactId: generateUuidV7(),
      artifactDigest: computeArtifactDigest(files),
      files,
    });
    await assert.rejects(
      adapter.stage({
        destination: bound.destination,
        operationId: generateUuidV7(),
        attemptId: generateUuidV7(),
        idempotencyKey: key,
        generationId: generateUuidV7(),
        artifactId: generateUuidV7(),
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

test('LOCAL-47: null and undefined activation fences are refused, never treated as unfenced', async () => {
  const bound = await bind();
  try {
    const files = [{ path: 'index.html', bytes: Buffer.from('f', 'utf8') }];
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
    for (const fence of [null, undefined, '']) {
      await assert.rejects(
        adapter.activate({
          destination: bound.destination,
          stageToken: /** @type {string} */ (staged.stageToken),
          generationId,
          expectedCurrentGenerationId: /** @type {any} */ (fence),
          ...oidcFor(bound.destination),
        }),
        /EXPECTED_GENERATION_FENCE_INVALID|expectedCurrentGenerationId/u,
        `${String(fence)} must be refused`,
      );
    }
    assert.equal(bound.provider.createCalls.length, 0);
  } finally {
    await bound.teardown();
  }
});

test('LOCAL-47: the EXPECT_NOTHING_SERVED sentinel fences against an already-served destination', async () => {
  const bound = await bind();
  try {
    const first = await publish(bound.destination, 'already-served');
    assert.equal(first.activation.decision, 'activate');

    const files = [
      { path: 'index.html', bytes: Buffer.from('second', 'utf8') },
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
    const createsBefore = bound.provider.createCalls.length;
    const decision = await adapter.activate({
      destination: bound.destination,
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
      ...oidcFor(bound.destination),
    });
    assert.equal(decision.decision, 'reconcile');
    assert.equal(decision.destinationChanged, false);
    assert.equal(bound.provider.createCalls.length, createsBefore);

    const inspected = await adapter.inspectDestination(bound.destination);
    assert.equal(inspected.currentGenerationId, first.generationId);
  } finally {
    await bound.teardown();
  }
});

test('neither credential can reach a header it does not own, the body it does not own, or any evidence', async () => {
  const bound = await bind();
  try {
    const credentials = oidcFor(bound.destination);
    const files = [{ path: 'index.html', bytes: Buffer.from('r', 'utf8') }];
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
    const decision = await adapter.activate({
      destination: bound.destination,
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
      ...credentials,
    });

    // No evidence object `createDeployment` produced carries either secret.
    const serialized = JSON.stringify(decision);
    assert.ok(!serialized.includes(credentials.pagesOidcToken));
    assert.ok(!serialized.includes(bound.destination.token));
    const identity = /** @type {any} */ (decision).providerIdentity;
    assert.equal(
      identity.requestBodyProfile,
      'gala-pages-create-deployment-jcs-v2',
    );
    assert.equal(typeof identity.requestBodyByteCount, 'number');
    assert.ok(!JSON.stringify(identity).includes(credentials.pagesOidcToken));

    // The OIDC token reached exactly one destination: the body.
    for (const row of bound.provider.requestLog) {
      assert.ok(
        !JSON.stringify(row.headers).includes(credentials.pagesOidcToken),
      );
      assert.equal(row.headers['accept-encoding'], 'identity');
      assert.equal(row.headers.connection, 'close');
      assert.equal(row.headers['x-github-api-version'], '2026-03-10');
    }
    const create = bound.provider.createCalls[0];
    assert.equal(create.oidcToken, credentials.pagesOidcToken);
    assert.ok(!create.bodyText.includes(bound.destination.token));
    assert.deepEqual(create.memberNames, [
      'artifact_id',
      'oidc_token',
      'pages_build_version',
    ]);
  } finally {
    await bound.teardown();
  }
});

test('a missing OIDC token fails closed before any provider call', async () => {
  const bound = await bind();
  try {
    const files = [{ path: 'index.html', bytes: Buffer.from('m', 'utf8') }];
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
    const before = bound.provider.requestLog.length;
    await assert.rejects(
      adapter.activate({
        destination: bound.destination,
        stageToken: /** @type {string} */ (staged.stageToken),
        generationId,
        expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
        pagesOidcClaims: oidcFor(bound.destination).pagesOidcClaims,
      }),
      /PAGES_OIDC_TOKEN_REQUIRED/u,
    );
    assert.equal(bound.provider.requestLog.length, before);
    assert.equal(bound.provider.createCalls.length, 0);
  } finally {
    await bound.teardown();
  }
});
