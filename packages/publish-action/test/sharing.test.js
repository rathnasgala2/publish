/**
 * Unit coverage for `normalize/sharing.js` with an injected fetch.
 *
 * @module
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SHARING_NETWORKS,
  parseSharingDocument,
  resolveSharing,
} from '../src/normalize/sharing.js';

const CATALOGUE = {
  networks: ['copy-link', 'x', 'threads', 'reddit', 'email'],
  defaults: ['copy-link', 'x', 'threads'],
  reddit: { community: 'Galascribe' },
  x: { via: 'galascribe' },
};

/**
 * @param {unknown} body JSON body
 * @returns {typeof fetch} a fetch returning it
 */
function okFetch(body) {
  return /** @type {any} */ (
    async () => ({ ok: true, status: 200, json: async () => body })
  );
}

test('site targets are intersected with the catalogue, order kept', async () => {
  /** @type {any[]} */
  const warnings = [];
  const result = await resolveSharing({
    apiOrigin: 'https://api.test',
    siteTargets: ['email', 'bluesky', 'x', 'copy-link'],
    warnings,
    fetchImpl: okFetch(CATALOGUE),
  });
  assert.deepEqual(result.targets, ['email', 'x', 'copy-link']);
  assert.deepEqual(warnings, []);
});

test('a site without the member gets the defaults', async () => {
  const result = await resolveSharing({
    apiOrigin: 'https://api.test',
    siteTargets: undefined,
    warnings: [],
    fetchImpl: okFetch(CATALOGUE),
  });
  assert.deepEqual(result.targets, ['copy-link', 'x', 'threads']);
});

test('reddit and x are copied when non-empty, omitted when empty', async () => {
  const full = await resolveSharing({
    apiOrigin: 'https://api.test',
    siteTargets: undefined,
    warnings: [],
    fetchImpl: okFetch(CATALOGUE),
  });
  assert.deepEqual(full.reddit, { community: 'Galascribe' });
  assert.deepEqual(full.x, { via: 'galascribe' });
  const empty = await resolveSharing({
    apiOrigin: 'https://api.test',
    siteTargets: undefined,
    warnings: [],
    fetchImpl: okFetch({
      ...CATALOGUE,
      reddit: { community: '' },
      x: { via: '' },
    }),
  });
  assert.equal('reddit' in empty, false);
  assert.equal('x' in empty, false);
});

test('request uses the public path, Accept header and one retry', async () => {
  /** @type {any[]} */
  const calls = [];
  /** @type {any} */
  const fetchImpl = async (/** @type {any} */ url, /** @type {any} */ init) => {
    calls.push({ url, accept: init.headers.Accept });
    if (calls.length === 1) {
      throw new Error('boom');
    }
    return { ok: true, status: 200, json: async () => CATALOGUE };
  };
  /** @type {any[]} */
  const warnings = [];
  const result = await resolveSharing({
    apiOrigin: 'https://api.test',
    siteTargets: undefined,
    warnings,
    fetchImpl,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.test/v2/public/sharing');
  assert.equal(calls[0].accept, 'application/json');
  assert.deepEqual(result.targets, CATALOGUE.defaults);
  assert.deepEqual(warnings, []);
});

test('fetch failure keeps site targets and raises the warning', async () => {
  /** @type {any[]} */
  const warnings = [];
  /** @type {any} */
  const fetchImpl = async () => ({ ok: false, status: 503 });
  const result = await resolveSharing({
    apiOrigin: 'https://api.test',
    siteTargets: ['x', 'bluesky'],
    warnings,
    fetchImpl,
  });
  assert.deepEqual(result, { targets: ['x', 'bluesky'] });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'SHARING_DEFAULTS_UNAVAILABLE');
  assert.equal(warnings[0].severity, 'WARNING');
});

test('fetch failure without site targets falls back to copy-link', async () => {
  /** @type {any[]} */
  const warnings = [];
  const result = await resolveSharing({
    apiOrigin: 'https://api.test',
    siteTargets: undefined,
    warnings,
    fetchImpl: /** @type {any} */ (
      async () => {
        throw new Error('offline');
      }
    ),
  });
  assert.deepEqual(result, { targets: ['copy-link'] });
  assert.equal(warnings[0].code, 'SHARING_DEFAULTS_UNAVAILABLE');
});

test('a malformed document is a failure, not retried', async () => {
  let calls = 0;
  /** @type {any[]} */
  const warnings = [];
  /** @type {any} */
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ networks: 'x' }) };
  };
  const result = await resolveSharing({
    apiOrigin: 'https://api.test',
    siteTargets: ['x'],
    warnings,
    fetchImpl,
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.targets, ['x']);
  assert.equal(warnings.length, 1);
});

test('a hanging fetch is aborted at the timeout, twice, then falls back', async () => {
  let calls = 0;
  /** @type {any[]} */
  const warnings = [];
  /** @type {any} */
  const fetchImpl = (/** @type {any} */ _url, /** @type {any} */ init) =>
    new Promise((_resolve, reject) => {
      calls += 1;
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  const result = await resolveSharing({
    apiOrigin: 'https://api.test',
    siteTargets: undefined,
    warnings,
    fetchImpl,
    timeoutMs: 10,
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.targets, ['copy-link']);
  assert.equal(warnings[0].code, 'SHARING_DEFAULTS_UNAVAILABLE');
});

test('parseSharingDocument rejects wrong shapes', () => {
  assert.equal(parseSharingDocument(null), null);
  assert.equal(parseSharingDocument([]), null);
  assert.equal(parseSharingDocument({ networks: [], defaults: [1] }), null);
  assert.equal(
    parseSharingDocument({ networks: [], defaults: [], reddit: 'x' }),
    null,
  );
  assert.equal(
    parseSharingDocument({
      networks: [],
      defaults: [],
      reddit: { community: 1 },
    }),
    null,
  );
  assert.equal(
    parseSharingDocument({ networks: [], defaults: [], x: { via: 1 } }),
    null,
  );
  assert.equal(
    parseSharingDocument({ networks: [], defaults: [], x: null }),
    null,
  );
  assert.ok(parseSharingDocument({ networks: [], defaults: [] }));
});

test('the known network list includes threads', () => {
  assert.ok(SHARING_NETWORKS.includes('threads'));
  assert.equal(SHARING_NETWORKS.length, 12);
});
