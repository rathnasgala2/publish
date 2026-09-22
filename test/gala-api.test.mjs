/**
 * `postReceiptExchange` against the 2.8.0 response union: three flat members
 * discriminated on an optional constant `kind`.
 *
 * The state is classified on `purpose` and `state`, which every server since
 * 2.7.x sends; `kind`, when present, is a claim that must agree. So a
 * 2.8.0 body yields its `kind`, a 2.7.x body without one still parses to the
 * same state with `kind: null`, and a `kind` that disagrees with the arm the
 * body actually is — or one outside the closed three — is a malformed
 * response, never a fourth state.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import {
  GalaApiError,
  RESPONSE_KINDS,
  postReceiptExchange,
} from '../scripts/workflow/gala-api.mjs';

const STABLE_ID = '019c0000-0000-7000-8000-000000000001';

/** The three 2.7.x-shaped bodies, keyed by the state each classifies to. */
const BODIES = Object.freeze({
  'deployment-authorization': {
    purpose: 'deployment-intent',
    deploymentIntent: { operationId: STABLE_ID },
    reportChallengeId: STABLE_ID,
    reportChallengeExpiresAt: '2026-09-18T00:00:00.000Z',
  },
  'capability-issued': {
    purpose: 'deployment-receipt',
    state: 'capability-issued',
    capabilityGeneration: 1,
    reportingCapability: `${'A'.repeat(42)}A`,
    reportingCapabilityExpiresAt: '2026-09-18T00:00:00.000Z',
  },
  'submission-recorded': {
    purpose: 'deployment-receipt',
    state: 'submission-recorded',
    operationId: STABLE_ID,
    statusUrl: `/v2/organizations/${STABLE_ID}/operations/${STABLE_ID}`,
  },
});

/**
 * Serve one fixed 200 body and return the exchange's classification of it.
 *
 * @param {Record<string, unknown>} body the entity to answer with
 * @returns {Promise<Awaited<ReturnType<typeof postReceiptExchange>>>} the answer
 */
async function exchangeAgainst(body) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const { port } = /** @type {import('node:net').AddressInfo} */ (
    server.address()
  );
  try {
    return await postReceiptExchange({
      origin: `http://127.0.0.1:${port}`,
      assertion: 'a.b.c',
      request: { purpose: 'deployment-receipt' },
    });
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve(undefined));
    });
  }
}

test('the closed kind vocabulary maps one-for-one onto the three states', () => {
  assert.deepEqual(Object.keys(RESPONSE_KINDS), [
    'deployment-intent',
    'deployment-receipt-capability-issued',
    'deployment-receipt-submission-recorded',
  ]);
  assert.deepEqual(
    [...new Set(Object.values(RESPONSE_KINDS))].sort(),
    Object.keys(BODIES).sort(),
  );
});

test('a 2.8.0 body classifies on purpose/state and reports the kind it carried', async () => {
  for (const [kind, state] of Object.entries(RESPONSE_KINDS)) {
    const answer = await exchangeAgainst({ kind, ...BODIES[state] });
    assert.equal(answer.state, state, kind);
    assert.equal(answer.kind, kind);
  }
});

test('a kind-less 2.7.x body still parses to the same state, with kind null', async () => {
  for (const [state, body] of Object.entries(BODIES)) {
    const answer = await exchangeAgainst(body);
    assert.equal(answer.state, state);
    assert.equal(answer.kind, null);
    assert.equal(answer.body.kind, undefined);
  }
});

test('a kind that disagrees with the arm the body is, or is unknown, is a malformed response', async () => {
  const cases = [
    {
      kind: 'deployment-receipt-submission-recorded',
      ...BODIES['capability-issued'],
    },
    { kind: 'deployment-intent', ...BODIES['submission-recorded'] },
    {
      kind: 'deployment-receipt-capability-issued',
      ...BODIES['deployment-authorization'],
    },
    { kind: 'something-else', ...BODIES['deployment-authorization'] },
  ];
  for (const body of cases) {
    await assert.rejects(
      exchangeAgainst(body),
      (error) => {
        assert.ok(error instanceof GalaApiError);
        assert.equal(error.code, 'WORKLOAD_EXCHANGE_RESPONSE_INVALID');
        assert.equal(error.status, 200);
        return true;
      },
      String(body.kind),
    );
  }
});

test('a body outside the three states is refused whether or not it names a kind', async () => {
  for (const body of [
    { purpose: 'deployment-receipt', state: 'pending' },
    { kind: 'deployment-intent', purpose: 'deployment-receipt' },
    { purpose: 'deployment-intent' },
  ]) {
    await assert.rejects(exchangeAgainst(body), {
      code: 'WORKLOAD_EXCHANGE_RESPONSE_INVALID',
    });
  }
});
