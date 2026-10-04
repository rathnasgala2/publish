/**
 * The `gala-pages-oidc-v2` acquisition gate.
 *
 * DEC-097 section 7 fixes every byte of this one request before the runner
 * bearer is read: the origin must match the closed origin grammar, the path must
 * match the closed grammar, the query must be exactly `api-version=2.0`
 * with no `audience` in any ASCII case, and the response must be a 200
 * `application/json` body carrying exactly one `value` string. Each of
 * those is asserted here against an injected `fetch`, so no test ever needs
 * a real runner or a real credential.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GITHUB_ACTIONS_OIDC_ORIGIN_HOST_PATTERN,
  MAXIMUM_OIDC_TOKEN_BYTES,
  PagesOidcError,
  acquirePagesOidcToken,
  validateTokenRequestUrl,
} from '../scripts/workflow/pages-oidc.mjs';

const VALID_URL =
  'https://pipelinesghubeus2.actions.githubusercontent.com/ORG/PROJ/_apis/distributedtask/hubs/Actions/plans/PLAN/jobs/JOB/idtoken?api-version=2.0';

/** A structurally valid three-segment unpadded-base64url compact JWT. */
const FAKE_TOKEN = ['eyJhbGciOiJSUzI1NiJ9', 'eyJpc3MiOiJmYWtlIn0', 'c2ln'].join(
  '.',
);

/**
 * Build an injected `fetch` that records the one request it receives.
 *
 * @param {{status?: number, contentType?: string, body?: string}} reply the
 *   canned reply
 * @returns {{fetch: typeof globalThis.fetch, calls: Record<string, unknown>[]}}
 *   the injected fetch and its call log
 */
function stubFetch(reply) {
  /** @type {Record<string, unknown>[]} */
  const calls = [];
  return {
    calls,
    fetch: /** @type {any} */ (
      async (/** @type {any} */ url, /** @type {any} */ init) => {
        calls.push({ url: String(url), init });
        return new Response(
          reply.body ?? JSON.stringify({ value: FAKE_TOKEN }),
          {
            status: reply.status ?? 200,
            headers: {
              'content-type': reply.contentType ?? 'application/json',
            },
          },
        );
      }
    ),
  };
}

/**
 * @param {Record<string, string | undefined>} [overrides] env overrides
 * @returns {Record<string, string | undefined>} the environment
 */
function env(overrides = {}) {
  return {
    ACTIONS_ID_TOKEN_REQUEST_URL: VALID_URL,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-bearer-value',
    ...overrides,
  };
}

test('the origin catalog is a closed grammar', () => {
  assert.ok(
    GITHUB_ACTIONS_OIDC_ORIGIN_HOST_PATTERN.test(
      'pipelines.actions.githubusercontent.com',
    ),
  );
  assert.ok(
    !GITHUB_ACTIONS_OIDC_ORIGIN_HOST_PATTERN.test(
      'a.b.actions.githubusercontent.com',
    ),
  );
});

test('the previous literal origins and rotated shards are admitted', () => {
  for (const origin of [
    'https://pipelines.actions.githubusercontent.com',
    'https://pipelinesghubeus2.actions.githubusercontent.com',
    'https://pipelinesghubeus26.actions.githubusercontent.com',
    'https://run-actions-3-azure-eastus.actions.githubusercontent.com',
    'https://pipelinesghubeus99.actions.githubusercontent.com',
  ]) {
    const url = VALID_URL.replace(
      'https://pipelinesghubeus2.actions.githubusercontent.com',
      origin,
    );
    assert.equal(validateTokenRequestUrl(url).origin, origin);
  }
});

test('hosts outside the closed grammar are refused', () => {
  const base = 'https://pipelinesghubeus2.actions.githubusercontent.com';
  /** @type {Array<[string, string]>} */
  const cases = [
    [
      'https://evil.actions.githubusercontent.com.attacker.example',
      'PAGES_OIDC_ORIGIN_UNCATALOGED',
    ],
    ['https://actions.githubusercontent.com', 'PAGES_OIDC_ORIGIN_UNCATALOGED'],
    [
      'https://a.b.actions.githubusercontent.com',
      'PAGES_OIDC_ORIGIN_UNCATALOGED',
    ],
    [
      'https://Pipelines.actions.githubusercontent.com',
      'PAGES_OIDC_SOURCE_URL_INVALID',
    ],
    [
      'https://pipelines.actions.githubusercontent.com:8443',
      'PAGES_OIDC_SOURCE_URL_INVALID',
    ],
    [
      'http://pipelines.actions.githubusercontent.com',
      'PAGES_OIDC_SOURCE_URL_INVALID',
    ],
  ];
  for (const [origin, code] of cases) {
    assert.throws(
      () => validateTokenRequestUrl(VALID_URL.replace(base, origin)),
      (error) => error instanceof PagesOidcError && error.code === code,
      `${origin} must reject with ${code}`,
    );
  }
});

test('a foreign suffix, userinfo, a port, uppercase bytes and an empty shard label all reject', () => {
  for (const url of [
    VALID_URL.replace(
      'pipelinesghubeus2.actions.githubusercontent.com',
      'pipelines.actions.githubusercontent.com.evil.example',
    ),
    VALID_URL.replace('https://', 'https://user:pass@'),
    VALID_URL.replace('githubusercontent.com/', 'githubusercontent.com:443/'),
    VALID_URL.replace('pipelinesghubeus2', 'PipelinesGhubEus2'),
    VALID_URL.replace('pipelinesghubeus2.', '.'),
  ]) {
    assert.throws(
      () => validateTokenRequestUrl(url),
      PagesOidcError,
      `${url} must be refused`,
    );
  }
});

test('an audience parameter in any position or case is refused', () => {
  for (const query of [
    'api-version=2.0&audience=https%3A%2F%2Fgithub.com%2Fowner',
    'audience=x&api-version=2.0',
    'api-version=2.0&AUDIENCE=x',
    'api-version=2.0&api-version=2.0',
    'api-version=2.1',
    '',
  ]) {
    assert.throws(
      () =>
        validateTokenRequestUrl(
          `${VALID_URL.split('?')[0]}${query === '' ? '' : `?${query}`}`,
        ),
      /PAGES_OIDC_SOURCE_URL_INVALID/u,
      `query ${JSON.stringify(query)} must be refused`,
    );
  }
});

test('a path outside the closed grammar is refused', () => {
  for (const path of [
    '/ORG/PROJ/_apis/distributedtask/hubs/Actions/plans/PLAN/jobs/JOB/idtoken/',
    '/ORG/PROJ/_apis/distributedtask/hubs/Actions/plans/PLAN/jobs/idtoken',
    '/ORG//PROJ/_apis/distributedtask/hubs/Actions/plans/PLAN/jobs/JOB/idtoken',
    '/ORG/../_apis/distributedtask/hubs/Actions/plans/PLAN/jobs/JOB/idtoken',
    '/ORG/PROJ/_apis/distributedtask/hubs/actions/plans/PLAN/jobs/JOB/idtoken',
    '/ORG/PR%4FJ/_apis/distributedtask/hubs/Actions/plans/PLAN/jobs/JOB/idtoken',
  ]) {
    assert.throws(
      () =>
        validateTokenRequestUrl(
          `https://pipelinesghubeus2.actions.githubusercontent.com${path}?api-version=2.0`,
        ),
      /PAGES_OIDC_SOURCE_URL_INVALID/u,
      `path ${path} must be refused`,
    );
  }
});

const UUID_A = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const UUID_B = 'f0e1d2c3-b4a5-4968-8776-5a4b3c2d1e0f';
const RUN_ACTIONS_HOST =
  'https://run-actions-1-azure-eastus.actions.githubusercontent.com';
const RUN_ACTIONS_PATH = `/123456//idtoken/${UUID_A}/${UUID_B}`;
const RUN_ACTIONS_URL = `${RUN_ACTIONS_HOST}${RUN_ACTIONS_PATH}?api-version=2.0`;

test('the run-actions path form is admitted and sent verbatim with its double slash', async () => {
  const target = validateTokenRequestUrl(RUN_ACTIONS_URL);
  assert.equal(target.origin, RUN_ACTIONS_HOST);
  assert.equal(target.requestTarget, `${RUN_ACTIONS_PATH}?api-version=2.0`);

  const stub = stubFetch({});
  const result = await acquirePagesOidcToken({
    env: env({ ACTIONS_ID_TOKEN_REQUEST_URL: RUN_ACTIONS_URL }),
    fetch: stub.fetch,
  });
  assert.equal(result.token, FAKE_TOKEN);
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0]?.url, RUN_ACTIONS_URL);
  assert.equal(new URL(String(stub.calls[0]?.url)).pathname, RUN_ACTIONS_PATH);
});

test('a run-actions-form path outside the closed grammar is refused', () => {
  for (const path of [
    `/123/idtoken/${UUID_A}/${UUID_B}`,
    `/123//idtoken/${UUID_A.toUpperCase()}/${UUID_B}`,
    `/123//idtoken/${UUID_A}`,
    `/abc//idtoken/${UUID_A}/${UUID_B}`,
    `/123//idtoken/${UUID_A}/${UUID_B}/`,
    `//idtoken/${UUID_A}/${UUID_B}`,
  ]) {
    assert.throws(
      () =>
        validateTokenRequestUrl(`${RUN_ACTIONS_HOST}${path}?api-version=2.0`),
      /PAGES_OIDC_SOURCE_URL_INVALID: the request-target path does not match the exact closed grammar/u,
      `path ${path} must be refused`,
    );
  }
});

test('the happy path sends exactly one no-audience request with the fixed header rows', async () => {
  const stub = stubFetch({});
  const result = await acquirePagesOidcToken({ env: env(), fetch: stub.fetch });

  assert.equal(stub.calls.length, 1);
  const call = /** @type {any} */ (stub.calls[0]);
  assert.equal(call.url, VALID_URL);
  const init = /** @type {any} */ (call.init);
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  assert.equal(init.body, undefined);
  assert.deepEqual(Object.keys(init.headers).sort(), [
    'accept',
    'accept-encoding',
    'authorization',
    'connection',
    'host',
  ]);
  assert.equal(init.headers.accept, 'application/json');
  assert.equal(init.headers['accept-encoding'], 'identity');
  assert.equal(init.headers.connection, 'close');
  assert.equal(
    init.headers.host,
    'pipelinesghubeus2.actions.githubusercontent.com',
  );

  assert.equal(result.token, FAKE_TOKEN);
  assert.equal(
    result.pagesOidcOrigin,
    'https://pipelinesghubeus2.actions.githubusercontent.com',
  );
});

test('no credential byte reaches the thrown diagnostic', async () => {
  const stub = stubFetch({ status: 403, body: 'nope' });
  await assert.rejects(
    acquirePagesOidcToken({
      env: env({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'super-secret-bearer' }),
      fetch: stub.fetch,
    }),
    (error) => {
      assert.ok(error instanceof PagesOidcError);
      assert.equal(error.code, 'PAGES_OIDC_REQUEST_REJECTED');
      assert.ok(!error.message.includes('super-secret-bearer'));
      assert.ok(!error.stack?.includes('super-secret-bearer'));
      return true;
    },
  );
});

test('a non-200, a non-JSON media type and a body with any extra member all reject', async () => {
  for (const reply of [
    { status: 201 },
    { contentType: 'text/plain' },
    { body: JSON.stringify({ value: FAKE_TOKEN, extra: 1 }) },
    { body: JSON.stringify({}) },
    { body: JSON.stringify({ value: 7 }) },
    { body: JSON.stringify([FAKE_TOKEN]) },
    { body: 'not json' },
    {
      body: JSON.stringify({ value: 'x'.repeat(MAXIMUM_OIDC_TOKEN_BYTES + 1) }),
    },
  ]) {
    await assert.rejects(
      acquirePagesOidcToken({ env: env(), fetch: stubFetch(reply).fetch }),
      PagesOidcError,
      `${JSON.stringify(reply)} must be refused`,
    );
  }
});

test('a 4128-byte three-segment runner bearer is accepted and a 32769-byte one is refused', async () => {
  /**
   * @param {number} total the exact byte length
   * @returns {string} a three-segment bearer of that length
   */
  const bearerOf = (total) => {
    const head = 'eyJhbGciOiJSUzI1NiJ9';
    const sig = 'c2ln';
    return [head, 'a'.repeat(total - head.length - sig.length - 2), sig].join(
      '.',
    );
  };
  const accepted = bearerOf(4128);
  assert.equal(Buffer.byteLength(accepted), 4128);
  const stub = stubFetch({ body: JSON.stringify({ value: FAKE_TOKEN }) });
  await acquirePagesOidcToken({
    env: env({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: accepted }),
    fetch: stub.fetch,
  });
  const refused = bearerOf(32769);
  assert.equal(Buffer.byteLength(refused), 32769);
  await assert.rejects(
    acquirePagesOidcToken({
      env: env({ ACTIONS_ID_TOKEN_REQUEST_TOKEN: refused }),
      fetch: stubFetch({}).fetch,
    }),
    (error) =>
      error instanceof PagesOidcError &&
      error.code === 'PAGES_OIDC_RUNNER_BEARER_INVALID',
  );
});

test('a job without id-token: write fails closed before any request', async () => {
  for (const missing of [
    { ACTIONS_ID_TOKEN_REQUEST_URL: undefined },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' },
  ]) {
    const stub = stubFetch({});
    await assert.rejects(
      acquirePagesOidcToken({ env: env(missing), fetch: stub.fetch }),
      /PAGES_OIDC_UNAVAILABLE/u,
    );
    assert.equal(stub.calls.length, 0, 'no request may be made');
  }
});

test('an uncataloged origin is rejected before the runner bearer is read', async () => {
  const stub = stubFetch({});
  let bearerRead = false;
  const probe = new Proxy(
    env({
      ACTIONS_ID_TOKEN_REQUEST_URL: VALID_URL.replace(
        'pipelinesghubeus2.actions.githubusercontent.com',
        'a.b.actions.githubusercontent.com',
      ),
    }),
    {
      get(target, property) {
        if (property === 'ACTIONS_ID_TOKEN_REQUEST_TOKEN') {
          bearerRead = true;
        }
        return Reflect.get(target, property);
      },
    },
  );
  await assert.rejects(
    acquirePagesOidcToken({ env: probe, fetch: stub.fetch }),
    /PAGES_OIDC_ORIGIN_UNCATALOGED/u,
  );
  assert.equal(
    bearerRead,
    false,
    'catalog membership precedes credential access',
  );
  assert.equal(stub.calls.length, 0);
});
