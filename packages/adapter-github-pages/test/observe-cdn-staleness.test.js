/**
 * `observe` waits out the Pages CDN.
 *
 * GitHub Pages serves `cache-control: max-age=600` through a CDN that ignores
 * query strings and request cache headers, so a page read in the last ten
 * minutes is served stale after a new generation activates. The adapter
 * therefore re-observes with a bounded backoff until the marker and the
 * artifact digest match. The fake origin here models the CDN with a simulated
 * clock that only the injected `sleep` advances.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as adapter from '../src/index.js';
import {
  computeArtifactDigest,
  forgetDestination,
  generateUuidV7,
} from '../src/index.js';
import { startFakePagesProvider } from './fake-pages-provider.js';
import { oidcFor } from './oidc-fixture.js';

const EXPECT_NOTHING_SERVED = 'gala:expect-nothing-served';
const MARKER = '/.well-known/gala-generation.json';

/**
 * @param {any} destination the destination
 * @param {string} body the home page body
 * @param {string} expected the generation currently served
 * @returns {Promise<{generationId: string, artifactDigest: string}>} identities
 */
async function publish(destination, body, expected) {
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
  await adapter.activate({
    destination,
    stageToken: /** @type {string} */ (staged.stageToken),
    generationId,
    expectedCurrentGenerationId: expected,
    ...oidcFor(destination),
  });
  return { generationId, artifactDigest };
}

/**
 * Two published generations behind a CDN that serves the first one's bytes
 * for a path until a simulated time.
 *
 * @param {Record<string, number>} staleUntil seconds each path stays stale
 *   (keys: 'index.html', 'marker')
 * @returns {Promise<{destination: any, sleeps: number[], reads: string[], second: {generationId: string, artifactDigest: string}, teardown: () => Promise<void>}>} the fixture
 */
async function bind(staleUntil) {
  const provider = await startFakePagesProvider({
    repository: `cdn-${generateUuidV7().slice(-8)}`,
  });
  const clock = { seconds: 0 };
  /** @type {number[]} */
  const sleeps = [];
  /** @type {string[]} */
  const reads = [];
  /** @type {Map<string, Buffer>} */
  const previous = new Map();
  let cdnOn = false;
  const destination = {
    owner: provider.owner,
    repository: provider.repository,
    repositoryId: '9300',
    repositoryOwnerId: '99001',
    apiOrigin: provider.apiOrigin,
    publicBaseUrl: provider.publicBaseUrl,
    token: provider.token,
    publishCarrier: provider.publishCarrier,
    headSha: '1c14dcdff9501ef74b8b7a5897fba69c586fa76a',
    fetch: provider.fetch,
    publicFetch: /** @type {typeof globalThis.fetch} */ (
      async (url, init) => {
        const path = new URL(String(url)).pathname.replace(
          new RegExp(`^/${provider.repository}/?`, 'u'),
          '',
        );
        reads.push(path);
        const key = `/${path}` === MARKER ? 'marker' : path;
        const stale = previous.get(key);
        if (
          cdnOn &&
          stale !== undefined &&
          clock.seconds < (staleUntil[key] ?? 0)
        ) {
          return new Response(new Uint8Array(stale), {
            status: 200,
            headers: { 'cache-control': 'max-age=600' },
          });
        }
        return provider.fetch(url, init);
      }
    ),
    sleep: (/** @type {number} */ seconds) => {
      sleeps.push(seconds);
      clock.seconds += seconds;
      return Promise.resolve();
    },
    now: () => 0,
  };
  const first = await publish(destination, 'old', EXPECT_NOTHING_SERVED);
  for (const [key, path] of /** @type {[string, string][]} */ ([
    ['index.html', 'index.html'],
    ['marker', MARKER.slice(1)],
  ])) {
    const response = await provider.fetch(
      `${provider.publicBaseUrl}/${path}`,
      {},
    );
    previous.set(key, Buffer.from(await response.arrayBuffer()));
  }
  const second = await publish(destination, 'new', first.generationId);
  cdnOn = true;
  reads.length = 0;
  sleeps.length = 0;
  clock.seconds = 0;
  return {
    destination,
    sleeps,
    reads,
    second,
    async teardown() {
      forgetDestination(destination);
      await provider.stop();
    },
  };
}

test('stale route bytes are polled until the CDN serves the new generation', async () => {
  const bound = await bind({ 'index.html': 400, marker: 0 });
  try {
    const observed = await adapter.observe({
      destination: bound.destination,
      generationId: bound.second.generationId,
      expectedArtifactDigest: bound.second.artifactDigest,
    });
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
    assert.equal(observed.markerValid, true);
    assert.deepEqual(bound.sleeps.slice(0, 5), [5, 10, 20, 30, 30]);
    assert.ok(bound.sleeps.every((seconds) => seconds <= 30));
    const total = bound.sleeps.reduce((a, b) => a + b, 0);
    assert.ok(total >= 400 && total < 440, `slept ${total}s`);
    assert.ok(bound.reads.length <= 2 * (bound.sleeps.length + 1));
  } finally {
    await bound.teardown();
  }
});

test('a stale marker is polled too', async () => {
  const bound = await bind({ 'index.html': 0, marker: 90 });
  try {
    const observed = await adapter.observe({
      destination: bound.destination,
      generationId: bound.second.generationId,
      expectedArtifactDigest: bound.second.artifactDigest,
    });
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
    assert.ok(bound.sleeps.length >= 3 && bound.sleeps.length <= 6);
  } finally {
    await bound.teardown();
  }
});

test('content that never matches is reported unverified after the deadline with the last findings', async () => {
  const bound = await bind({ 'index.html': Infinity, marker: 0 });
  try {
    const observed = await adapter.observe({
      destination: bound.destination,
      generationId: bound.second.generationId,
      expectedArtifactDigest: bound.second.artifactDigest,
    });
    assert.equal(observed.verified, false);
    assert.ok(
      observed.findings.some((finding) => finding.includes('artifact digest')),
      JSON.stringify(observed.findings),
    );
    const total = bound.sleeps.reduce((a, b) => a + b, 0);
    assert.equal(total, 660, 'the deadline is max-age 600 plus a 60 s margin');
    assert.ok(bound.reads.length <= 2 * (bound.sleeps.length + 1));
  } finally {
    await bound.teardown();
  }
});

test('a redirect fails at once without sleeping', async () => {
  const bound = await bind({ 'index.html': 0, marker: 0 });
  try {
    /** @type {number[]} */
    const sleeps = [];
    const observed = await adapter.observe({
      destination: {
        ...bound.destination,
        sleep: (/** @type {number} */ seconds) => {
          sleeps.push(seconds);
          return Promise.resolve();
        },
        publicFetch: () => {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: new Error('unexpected redirect'),
          });
        },
      },
      generationId: bound.second.generationId,
      expectedArtifactDigest: bound.second.artifactDigest,
    });
    assert.equal(observed.verified, false);
    assert.equal(observed.failure?.code, 'PAGES_PUBLIC_REDIRECT');
    assert.deepEqual(sleeps, []);
  } finally {
    await bound.teardown();
  }
});
