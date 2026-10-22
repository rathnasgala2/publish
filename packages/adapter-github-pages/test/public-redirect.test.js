/**
 * A redirecting public origin is classified, never thrown.
 *
 * Production incident 2026-10-21: a site moved to a custom domain while its
 * repository still carried the `github.io` base URL, the origin answered
 * `301`, the adapter's `redirect: 'error'` fetch threw, and the exception
 * escaped the lifecycle. The adapter still follows no redirect; it now
 * reports `PAGES_PUBLIC_REDIRECT` with the target host.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import * as adapter from '../src/index.js';
import {
  computeArtifactDigest,
  forgetDestination,
  generateUuidV7,
} from '../src/index.js';
import { readPublic } from '../src/public-read.js';
import { startFakePagesProvider } from './fake-pages-provider.js';
import { oidcFor } from './oidc-fixture.js';

const BASE = 'https://owner.github.io/site';
const EXPECT_NOTHING_SERVED = 'gala:expect-nothing-served';

/**
 * The failure undici raises for `redirect: 'error'`.
 *
 * @returns {TypeError} the refused-redirect failure
 */
function refusedRedirect() {
  return new TypeError('fetch failed', {
    cause: new Error('unexpected redirect'),
  });
}

/**
 * A fetch that refuses to follow a redirect, and answers the `manual` probe
 * with the given response.
 *
 * @param {() => Response | Promise<Response>} manual the probe's answer
 * @returns {{fetch: typeof globalThis.fetch, calls: RequestInit[]}} the fetch
 *   and the init of every call
 */
function redirectingFetch(manual) {
  /** @type {RequestInit[]} */
  const calls = [];
  return {
    calls,
    fetch: /** @type {typeof globalThis.fetch} */ (
      async (_url, init = {}) => {
        calls.push(init);
        if (init.redirect === 'manual') {
          return manual();
        }
        throw refusedRedirect();
      }
    ),
  };
}

test('a redirect is reported with the target host and absolute location, and is never followed', async () => {
  const { fetch, calls } = redirectingFetch(
    () =>
      new Response(null, {
        status: 301,
        headers: { location: 'https://www.example.com/site/robots.txt' },
      }),
  );
  const read = await readPublic({ publicBaseUrl: BASE, fetch }, 'robots.txt');
  assert.deepEqual(read, {
    status: 'redirect',
    bytes: null,
    etag: null,
    toHost: 'www.example.com',
    location: 'https://www.example.com/site/robots.txt',
  });
  assert.deepEqual(
    calls.map((init) => init.redirect),
    ['error', 'manual'],
    'the read refuses redirects; the probe only reads the 3xx, it follows nothing',
  );
  for (const init of calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.headers, undefined, 'no credential or header is sent');
  }
});

test('a relative Location resolves against the requested URL', async () => {
  const { fetch } = redirectingFetch(
    () =>
      new Response(null, { status: 308, headers: { location: '/moved/x' } }),
  );
  const read = await readPublic({ publicBaseUrl: BASE, fetch }, 'x');
  assert.equal(read.toHost, 'owner.github.io');
  assert.equal(read.location, 'https://owner.github.io/moved/x');
});

test('a redirect with no readable Location is still classified, with an unknown target', async () => {
  for (const manual of [
    () => new Response(null, { status: 301 }),
    () => {
      throw new Error('probe failed');
    },
    () =>
      new Response(null, {
        status: 301,
        headers: { location: 'http://[bad' },
      }),
  ]) {
    const { fetch } = redirectingFetch(manual);
    const read = await readPublic({ publicBaseUrl: BASE, fetch }, 'x');
    assert.equal(read.status, 'redirect');
    assert.equal(read.toHost, null);
    assert.equal(read.location, null);
  }
});

test('the probe is bounded, its body is cancelled, and only an http(s) Location names a target', async () => {
  let cancelled = false;
  /** @type {AbortSignal | undefined} */
  let signal;
  const fetch = /** @type {typeof globalThis.fetch} */ (
    async (_url, init = {}) => {
      if (init.redirect !== 'manual') {
        throw refusedRedirect();
      }
      signal = /** @type {AbortSignal | undefined} */ (
        init.signal ?? undefined
      );
      const response = new Response(null, {
        status: 301,
        headers: { location: 'ftp://files.example.com/x' },
      });
      Object.defineProperty(response, 'body', {
        value: {
          cancel: () => {
            cancelled = true;
            return Promise.resolve();
          },
        },
      });
      return response;
    }
  );
  const read = await readPublic({ publicBaseUrl: BASE, fetch }, 'x');
  assert.equal(read.status, 'redirect');
  assert.equal(read.toHost, null, 'ftp: is not an http(s) target');
  assert.equal(read.location, null);
  assert.equal(cancelled, true);
  assert.ok(signal instanceof AbortSignal, 'the probe carries a timeout');
});

test('a real redirecting origin is classified through the platform fetch', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(301, { location: 'http://127.0.0.1:1/elsewhere' });
    response.end();
  });
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(undefined)),
  );
  try {
    const { port } = /** @type {import('node:net').AddressInfo} */ (
      server.address()
    );
    const read = await readPublic(
      { publicBaseUrl: `http://127.0.0.1:${port}/site` },
      'index.html',
    );
    assert.equal(read.status, 'redirect');
    assert.equal(read.toHost, '127.0.0.1:1');
    assert.equal(read.location, 'http://127.0.0.1:1/elsewhere');
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test('only the refused-redirect failure is a redirect: an unrelated error that mentions one still throws', async () => {
  for (const error of [
    new TypeError('redirect count exceeded'),
    new Error('redirect', { cause: new Error('unexpected redirect') }),
    new TypeError('fetch failed', { cause: new Error('too many redirects') }),
  ]) {
    const fetch = /** @type {typeof globalThis.fetch} */ (
      async () => {
        throw error;
      }
    );
    await assert.rejects(
      readPublic({ publicBaseUrl: BASE, fetch }, 'x'),
      (thrown) => thrown === error,
    );
  }
});

test('any other fetch failure still throws, and 200 and 404 reads are unchanged', async () => {
  const failing = /** @type {typeof globalThis.fetch} */ (
    async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
    }
  );
  await assert.rejects(
    readPublic({ publicBaseUrl: BASE, fetch: failing }, 'x'),
    /fetch failed/u,
  );
  const answer = (/** @type {number} */ status) =>
    /** @type {typeof globalThis.fetch} */ (
      async () =>
        new Response(status === 200 ? 'body' : null, {
          status,
          headers: { etag: '"e"' },
        })
    );
  const ok = await readPublic({ publicBaseUrl: BASE, fetch: answer(200) }, 'x');
  assert.equal(ok.status, 200);
  assert.equal(ok.bytes?.toString('utf8'), 'body');
  assert.equal(ok.etag, '"e"');
  const missing = await readPublic(
    { publicBaseUrl: BASE, fetch: answer(404) },
    'x',
  );
  assert.deepEqual(missing, {
    status: 404,
    bytes: null,
    etag: '"e"',
    cacheControl: null,
  });
});

/**
 * Bind a destination whose public reads go through `publicFetch`.
 *
 * @param {(provider: any) => typeof globalThis.fetch} publicFetchFor the
 *   public fetch, given the fake provider
 * @returns {Promise<{provider: any, destination: any, teardown: () => Promise<void>}>}
 *   the bound fixture
 */
async function bind(publicFetchFor) {
  const provider = await startFakePagesProvider({
    repository: `redirect-${generateUuidV7().slice(-8)}`,
  });
  const destination = {
    owner: provider.owner,
    repository: provider.repository,
    repositoryId: '9100',
    repositoryOwnerId: '99001',
    apiOrigin: provider.apiOrigin,
    publicBaseUrl: provider.publicBaseUrl,
    token: provider.token,
    publishCarrier: provider.publishCarrier,
    headSha: '1c14dcdff9501ef74b8b7a5897fba69c586fa76a',
    fetch: provider.fetch,
    publicFetch: publicFetchFor(provider),
    sleep: () => Promise.resolve(),
  };
  return {
    provider,
    destination,
    async teardown() {
      forgetDestination(destination);
      await provider.stop();
    },
  };
}

const MOVED = () =>
  new Response(null, {
    status: 301,
    headers: { location: 'https://www.example.com/' },
  });

test('inspectDestination and preflight report PAGES_PUBLIC_REDIRECT instead of throwing', async () => {
  const bound = await bind(() => redirectingFetch(MOVED).fetch);
  try {
    const inspected = await adapter.inspectDestination(bound.destination);
    assert.equal(inspected.currentGenerationId, null);
    assert.deepEqual(inspected.failure, {
      code: 'PAGES_PUBLIC_REDIRECT',
      toHost: 'www.example.com',
      location: 'https://www.example.com/',
    });
    assert.ok(
      inspected.findings.some((finding) =>
        /^PAGES_PUBLIC_REDIRECT: .*www\.example\.com/u.test(finding),
      ),
      JSON.stringify(inspected.findings),
    );

    const preflight = await adapter.preflight({
      destination: bound.destination,
      entries: [{ path: 'index.html' }],
    });
    assert.equal(preflight.verdict, 'refuse');
    assert.ok(
      preflight.findings.some((finding) =>
        finding.startsWith('PAGES_PUBLIC_REDIRECT: '),
      ),
    );
  } finally {
    await bound.teardown();
  }
});

test('observe reports an unverified result with the redirect, and asks for no route once the origin redirects', async () => {
  const redirecting = redirectingFetch(MOVED);
  const bound = await bind(() => redirecting.fetch);
  try {
    const observed = await adapter.observe({
      destination: bound.destination,
      generationId: generateUuidV7(),
      expectedArtifactDigest: `sha256:${'a'.repeat(64)}`,
    });
    assert.equal(observed.verified, false);
    assert.equal(observed.markerValid, false);
    assert.equal(observed.failure?.code, 'PAGES_PUBLIC_REDIRECT');
    assert.equal(observed.failure?.toHost, 'www.example.com');
    assert.equal(
      redirecting.calls.length,
      2,
      'one refused read and one probe for the marker, and no route read',
    );
  } finally {
    await bound.teardown();
  }
});

test('a route that redirects after the marker read is classified and stops the route reads', async () => {
  let redirectRoutes = false;
  const bound = await bind(
    (provider) =>
      /** @type {typeof globalThis.fetch} */ (
        async (url, init = {}) => {
          if (redirectRoutes && !String(url).includes('.well-known')) {
            return redirectingFetch(MOVED).fetch(url, init);
          }
          return provider.fetch(url, init);
        }
      ),
  );
  try {
    const files = [
      { path: 'index.html', bytes: Buffer.from('home', 'utf8') },
      { path: 'about.html', bytes: Buffer.from('about', 'utf8') },
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
    await adapter.activate({
      destination: bound.destination,
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
      ...oidcFor(bound.destination),
    });
    redirectRoutes = true;
    const observed = await adapter.observe({
      destination: bound.destination,
      generationId,
      expectedArtifactDigest: computeArtifactDigest(files),
    });
    assert.equal(observed.verified, false);
    assert.equal(observed.failure?.code, 'PAGES_PUBLIC_REDIRECT');
    const redirects = observed.findings.filter((finding) =>
      finding.includes('PAGES_PUBLIC_REDIRECT'),
    );
    assert.equal(redirects.length, 1, JSON.stringify(observed.findings));
    assert.match(redirects[0] ?? '', /^[^:]+\.html: PAGES_PUBLIC_REDIRECT/u);
  } finally {
    await bound.teardown();
  }
});
