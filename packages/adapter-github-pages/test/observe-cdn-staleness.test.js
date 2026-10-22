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
 * @param {string[]} [names] the route paths
 * @returns {Promise<{generationId: string, artifactDigest: string}>} identities
 */
async function publish(destination, body, expected, names = ['index.html']) {
  const files = names.map((name) => ({
    path: name,
    bytes: Buffer.from(`${name}:${body}`, 'utf8'),
  }));
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
 * @param {{names?: string[], cacheControl?: string | null, intercept?: (path: string, seconds: number, count: number) => Response | Error | undefined}} [options]
 *   extra routes, the stale `cache-control`, and a fault hook
 * @returns {Promise<{destination: any, sleeps: number[], reads: string[], second: {generationId: string, artifactDigest: string}, teardown: () => Promise<void>}>} the fixture
 */
async function bind(staleUntil, options = {}) {
  const names = options.names ?? ['index.html'];
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
        const count = reads.filter((read) => read === path).length;
        const injected = options.intercept?.(path, clock.seconds, count);
        if (injected instanceof Error) {
          throw injected;
        }
        if (injected !== undefined) {
          return injected;
        }
        const key = `/${path}` === MARKER ? 'marker' : path;
        const stale = previous.get(key);
        if (
          cdnOn &&
          stale !== undefined &&
          clock.seconds < (staleUntil[key] ?? 0)
        ) {
          return new Response(new Uint8Array(stale), {
            status: 200,
            headers:
              options.cacheControl === null
                ? {}
                : {
                    'cache-control': options.cacheControl ?? 'max-age=600',
                  },
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
  const first = await publish(destination, 'old', EXPECT_NOTHING_SERVED, names);
  for (const [key, path] of /** @type {[string, string][]} */ ([
    ...names.map((name) => [name, name]),
    ['marker', MARKER.slice(1)],
  ])) {
    const response = await provider.fetch(
      `${provider.publicBaseUrl}/${path}`,
      {},
    );
    previous.set(key, Buffer.from(await response.arrayBuffer()));
  }
  const second = await publish(destination, 'new', first.generationId, names);
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
    assert.ok(bound.reads.length <= 2 * (bound.sleeps.length + 1) + 4);
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
    assert.ok(bound.reads.length <= 2 * (bound.sleeps.length + 1) + 4);
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
          throw Object.assign(transport('ECONNRESET'), {
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

/**
 * @param {Awaited<ReturnType<typeof bind>>} bound the fixture
 * @returns {ReturnType<typeof adapter.observe>} the observation
 */
function observeBound(bound) {
  return adapter.observe({
    destination: bound.destination,
    generationId: bound.second.generationId,
    expectedArtifactDigest: bound.second.artifactDigest,
  });
}

test('a retry re-reads only the routes that do not yet match, not the whole site', async () => {
  const names = ['index.html', 'a.html', 'b.html', 'c.html', 'd.html'];
  const bound = await bind({ 'b.html': 400, marker: 60 }, { names });
  try {
    const observed = await observeBound(bound);
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
    const count = (/** @type {string} */ path) =>
      bound.reads.filter((read) => read === path).length;
    for (const settled of ['index.html', 'a.html', 'c.html', 'd.html']) {
      assert.ok(
        count(settled) <= 2,
        `${settled} read once, plus a confirmation`,
      );
    }
    assert.ok(count('b.html') > 5, 'the failing route is re-read');
    assert.ok(
      count(MARKER.slice(1)) > 2,
      'the marker is re-read until it matches',
    );
    assert.ok(
      count(MARKER.slice(1)) < count('b.html'),
      'then it is left alone',
    );
  } finally {
    await bound.teardown();
  }
});

/**
 * @param {string} code the network error code
 * @returns {TypeError} a fetch failure wrapping that code
 */
function transport(code) {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(code), { code }),
  });
}

/**
 * @param {number} count the route count
 * @returns {string[]} the route names
 */
function routeNames(count) {
  return Array.from({ length: count }, (_, index) => `p${index}.html`);
}

for (const [count, perPass] of /** @type {[number, number][]} */ ([
  [3, 4],
  [100, 21],
  [2000, 21],
])) {
  test(`${count} routes and the marker all stale for 600 s still verify before the deadline`, async () => {
    const names = routeNames(count);
    const stale = Object.fromEntries(names.map((name) => [name, 600]));
    const bound = await bind({ ...stale, marker: 600 }, { names });
    try {
      const observed = await observeBound(bound);
      assert.equal(observed.verified, true, JSON.stringify(observed.findings));
      const total = bound.sleeps.reduce((a, b) => a + b, 0);
      assert.ok(total >= 600 && total <= 660, `slept ${total}s`);
      const passes = bound.sleeps.length + 1;
      assert.ok(
        bound.reads.length <= passes * perPass + 2 * count + 2,
        `${bound.reads.length} reads over ${passes} passes`,
      );
    } finally {
      await bound.teardown();
    }
  });
}

test('a route that never matches is unverified at the deadline and named', async () => {
  const names = routeNames(30);
  const bound = await bind({ 'p7.html': Infinity, marker: 0 }, { names });
  try {
    const observed = await observeBound(bound);
    assert.equal(observed.verified, false);
    assert.ok(
      observed.findings.some((finding) => finding.startsWith('p7.html: ')),
      JSON.stringify(observed.findings),
    );
    assert.equal(
      bound.sleeps.reduce((a, b) => a + b, 0),
      660,
    );
  } finally {
    await bound.teardown();
  }
});

test('the deadline holds when reads are slow and the clock moves on its own', async () => {
  const bound = await bind({ 'index.html': Infinity, marker: 0 });
  try {
    let ms = 0;
    const base = bound.destination;
    let total = 0;
    const observed = await adapter.observe({
      destination: {
        ...base,
        now: () => ms,
        publicFetch: async (
          /** @type {any} */ url,
          /** @type {any} */ init,
        ) => {
          ms += 50_000;
          return base.publicFetch(url, init);
        },
        sleep: (/** @type {number} */ seconds) => {
          total += seconds;
          return base.sleep(seconds);
        },
      },
      generationId: bound.second.generationId,
      expectedArtifactDigest: bound.second.artifactDigest,
    });
    assert.equal(observed.verified, false);
    assert.ok(total < 660, `slept ${total}s of an exhausted clock`);
    assert.ok(ms / 1000 < 660 + 300, `clock ${ms / 1000}s`);
  } finally {
    await bound.teardown();
  }
});

for (const code of [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]) {
  test(`${code} is transient: waited out once, then verified`, async () => {
    const bound = await bind(
      { 'index.html': 0, marker: 0 },
      {
        intercept: (path, _seconds, count) =>
          path === 'index.html' && count === 1 ? transport(code) : undefined,
      },
    );
    try {
      const observed = await observeBound(bound);
      assert.equal(observed.verified, true, JSON.stringify(observed.findings));
      assert.ok(bound.sleeps.length >= 1);
    } finally {
      await bound.teardown();
    }
  });
}

test('a per-request TimeoutError is transient', async () => {
  const bound = await bind(
    { 'index.html': 0, marker: 0 },
    {
      intercept: (path, _seconds, count) =>
        path === 'index.html' && count === 1
          ? new DOMException('timed out', 'TimeoutError')
          : undefined,
    },
  );
  try {
    const observed = await observeBound(bound);
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
  } finally {
    await bound.teardown();
  }
});

for (const code of [
  'ENOTFOUND',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]) {
  test(`${code} fails fast without sleeping`, async () => {
    const bound = await bind(
      { 'index.html': 0, marker: 0 },
      {
        intercept: (path) =>
          path === 'index.html' ? transport(code) : undefined,
      },
    );
    try {
      await assert.rejects(observeBound(bound), /fetch failed/u);
      assert.deepEqual(bound.sleeps, []);
    } finally {
      await bound.teardown();
    }
  });
}

test('a plain programming error fails fast', async () => {
  const bound = await bind(
    { 'index.html': 0, marker: 0 },
    {
      intercept: (path) =>
        path === 'index.html'
          ? new TypeError('x is not a function')
          : undefined,
    },
  );
  try {
    await assert.rejects(observeBound(bound), /x is not a function/u);
    assert.deepEqual(bound.sleeps, []);
  } finally {
    await bound.teardown();
  }
});

test('the same transient code on three consecutive passes stops the wait', async () => {
  const bound = await bind(
    { 'index.html': 0, marker: 0 },
    {
      intercept: (path) =>
        path === 'index.html' ? transport('ECONNRESET') : undefined,
    },
  );
  try {
    const observed = await observeBound(bound);
    assert.equal(observed.verified, false);
    assert.ok(
      observed.findings.some((finding) =>
        finding.includes('consecutive passes'),
      ),
      JSON.stringify(observed.findings),
    );
    assert.equal(bound.sleeps.length, 2);
  } finally {
    await bound.teardown();
  }
});

test('a transport error on a later pass is waited out and then verifies', async () => {
  const bound = await bind(
    { 'index.html': 100, marker: 0 },
    {
      intercept: (path, _seconds, count) =>
        path === 'index.html' && count === 2
          ? transport('ECONNRESET')
          : undefined,
    },
  );
  try {
    const observed = await observeBound(bound);
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
  } finally {
    await bound.teardown();
  }
});

test('persistent transport errors end as findings after the deadline, not as an exception', async () => {
  const bound = await bind(
    { 'index.html': 0, marker: 0 },
    {
      intercept: (path, _seconds, count) =>
        path === 'index.html'
          ? transport(count % 2 === 0 ? 'ECONNRESET' : 'ETIMEDOUT')
          : undefined,
    },
  );
  try {
    const observed = await observeBound(bound);
    assert.equal(observed.verified, false);
    assert.ok(
      observed.findings.some((finding) =>
        finding.includes('public read failed'),
      ),
      JSON.stringify(observed.findings),
    );
    assert.equal(
      bound.sleeps.reduce((a, b) => a + b, 0),
      660,
    );
  } finally {
    await bound.teardown();
  }
});

test('an oversized body still throws at once', async () => {
  const bound = await bind(
    { 'index.html': 0, marker: 0 },
    {
      intercept: (path) =>
        path === 'index.html'
          ? new adapter.PagesAdapterError('PAGES_PUBLIC_BODY_TOO_LARGE', 'x')
          : undefined,
    },
  );
  try {
    await assert.rejects(observeBound(bound), /PAGES_PUBLIC_BODY_TOO_LARGE/u);
    assert.deepEqual(bound.sleeps, []);
  } finally {
    await bound.teardown();
  }
});

test('a route that stays 404 is unverified with that finding', async () => {
  const bound = await bind(
    { 'index.html': 0, marker: 0 },
    {
      intercept: (path) =>
        path === 'index.html' ? new Response('', { status: 404 }) : undefined,
    },
  );
  try {
    const observed = await observeBound(bound);
    assert.equal(observed.verified, false);
    assert.ok(
      observed.findings.includes('index.html: public read returned HTTP 404'),
      JSON.stringify(observed.findings),
    );
  } finally {
    await bound.teardown();
  }
});

for (const [
  label,
  cacheControl,
  total,
] of /** @type {[string, string | null, number][]} */ ([
  ['max-age=0', 'max-age=0', 60],
  ['no max-age', null, 660],
  ['a huge max-age', 'max-age=99999999', 960],
  ['a malformed max-age', 'max-age=soon', 660],
])) {
  test(`the deadline follows ${label}`, async () => {
    const bound = await bind(
      { 'index.html': Infinity, marker: 0 },
      { cacheControl },
    );
    try {
      const observed = await observeBound(bound);
      assert.equal(observed.verified, false);
      assert.equal(
        bound.sleeps.reduce((a, b) => a + b, 0),
        total,
      );
    } finally {
      await bound.teardown();
    }
  });
}

test('a generation this run never staged fails at once without sleeping', async () => {
  const bound = await bind({ 'index.html': 0, marker: 0 });
  try {
    const observed = await adapter.observe({
      destination: bound.destination,
      generationId: generateUuidV7(),
      expectedArtifactDigest: bound.second.artifactDigest,
    });
    assert.equal(observed.verified, false);
    assert.ok(
      observed.findings.some((finding) => finding.includes('did not stage')),
    );
    assert.deepEqual(bound.sleeps, []);
  } finally {
    await bound.teardown();
  }
});
