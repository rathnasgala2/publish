/**
 * `getWithRetry` retries transient REST failures within a bounded budget and
 * never retries a 200, so a body that fails verification stays a hard failure.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getWithRetry,
  RETRY_DELAYS_SECONDS,
} from '../scripts/workflow/github-rest.mjs';

/**
 * @param {Array<Response | Error>} script the responses in order
 * @returns {{fetchImpl: typeof fetch, calls: () => number, waits: number[], logs: string[], hooks: object}} the stub
 */
function stub(script) {
  let count = 0;
  /** @type {number[]} */
  const waits = [];
  /** @type {string[]} */
  const logs = [];
  const fetchImpl = async () => {
    const next = /** @type {Response | Error} */ (
      script[Math.min(count, script.length - 1)]
    );
    count += 1;
    if (next instanceof Error) {
      throw next;
    }
    return next.clone();
  };
  return {
    fetchImpl,
    calls: () => count,
    waits,
    logs,
    hooks: {
      fetchImpl,
      sleep: async (/** @type {number} */ ms) => {
        waits.push(ms);
      },
      log: (/** @type {string} */ line) => logs.push(line),
    },
  };
}

const ok = () => new Response('{}', { status: 200 });
const status = (/** @type {number} */ code, headers = {}) =>
  new Response('', { status: code, headers });

test('404, 404 then 200 succeeds with backoff and logged retries', async () => {
  const s = stub([status(404), status(404), ok()]);
  const response = await getWithRetry('https://x/y', {}, s.hooks);
  assert.equal(response.status, 200);
  assert.equal(s.calls(), 3);
  assert.deepEqual(s.waits, [1000, 2000]);
  assert.equal(s.logs.length, 2);
  assert.match(
    s.logs[0] ?? '',
    /GITHUB_REST_RETRY: HTTP 404; retry 1 of 6 in 1s/u,
  );
});

test('a persistent 404 is returned after the whole budget', async () => {
  const s = stub([status(404)]);
  const response = await getWithRetry('https://x/y', {}, s.hooks);
  assert.equal(response.status, 404);
  assert.equal(s.calls(), RETRY_DELAYS_SECONDS.length + 1);
  assert.equal(
    s.waits.reduce((a, b) => a + b, 0),
    RETRY_DELAYS_SECONDS.reduce((a, b) => a + b, 0) * 1000,
  );
  assert.ok(RETRY_DELAYS_SECONDS.reduce((a, b) => a + b, 0) <= 90);
});

test('a 200 is returned at once, never retried', async () => {
  const s = stub([ok(), status(404)]);
  const response = await getWithRetry('https://x/y', {}, s.hooks);
  assert.equal(response.status, 200);
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.waits, []);
});

test('Retry-After is honoured on 429 and rate-limited 403', async () => {
  const s = stub([
    status(429, { 'retry-after': '7' }),
    status(403, { 'x-ratelimit-remaining': '0', 'retry-after': '12' }),
    ok(),
  ]);
  await getWithRetry('https://x/y', {}, s.hooks);
  assert.deepEqual(s.waits, [7000, 12000]);
});

test('a plain 403, 401 or 422 is not retried', async () => {
  for (const code of [401, 403, 422]) {
    const s = stub([status(code), ok()]);
    const response = await getWithRetry('https://x/y', {}, s.hooks);
    assert.equal(response.status, code);
    assert.equal(s.calls(), 1);
  }
});

test('5xx and network errors are retried; a persistent network error throws', async () => {
  const s = stub([status(502), new TypeError('fetch failed'), ok()]);
  assert.equal((await getWithRetry('https://x/y', {}, s.hooks)).status, 200);
  assert.equal(s.calls(), 3);
  assert.doesNotMatch(s.logs.join('\n'), /fetch failed/u);

  const dead = stub([new TypeError('fetch failed')]);
  await assert.rejects(getWithRetry('https://x/y', {}, dead.hooks), TypeError);
  assert.equal(dead.calls(), RETRY_DELAYS_SECONDS.length + 1);
});
