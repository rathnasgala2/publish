/**
 * The control-plane catalog and the limited-key `AccessDenied` proof.
 *
 * DEC-097 section 6.3 makes the deployment job's first act a proof that the
 * credential it is about to mutate objects with cannot read either bucket's
 * website configuration. An over-privileged deployment key is a release
 * blocker; an inconclusive answer — a 404, a malformed body, a different error
 * code — is not a proof and must fail closed just as loudly, because the whole
 * value of the check is that it is never satisfied by accident.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONTROL_PLANE_REQUEST_PROFILE,
  CONTROL_PLANE_REQUEST_TARGET,
  CONTROL_PLANE_RESPONSE_PROFILE,
  CONTROL_PLANE_RESPONSE_PROFILES,
  buildControlPlaneRequestCatalog,
  buildControlPlaneResponseCatalog,
  proveLimitedKeyAccessDenied,
} from '../src/control-plane.js';
import { deriveOrigins } from '../src/origins.js';
import { startFakeSpaces } from './fake-s3-server.js';

let sequence = 0;

/**
 * Start one fake provider whose `GET /?website=` answers are scripted.
 *
 * @param {(bucket: string) => {status: number, body: string}} [websiteResponse]
 *   the per-bucket control-plane answer
 * @returns {Promise<{provider: any, destination: any}>} the bound fixture
 */
async function bind(websiteResponse) {
  sequence += 1;
  const provider = await startFakeSpaces({
    servedBucket: `gala-served-control-${sequence}`,
    stagingBucket: `gala-staging-control-${sequence}`,
    ...(websiteResponse === undefined ? {} : { websiteResponse }),
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
  };
}

test('the control-plane request catalog is exactly DEC-097’s four rows in semantic order', () => {
  const origins = deriveOrigins({
    region: 'nyc3',
    servedBucket: 'served',
    stagingBucket: 'staging',
  });
  const catalog = /** @type {any} */ (
    buildControlPlaneRequestCatalog(origins, {
      bindingDigest: `sha256:${'a'.repeat(64)}`,
      tlsProfileDigest: `sha256:${'b'.repeat(64)}`,
    })
  );
  assert.equal(catalog.profile, CONTROL_PLANE_REQUEST_PROFILE);
  assert.equal(catalog.requests.length, 4);
  assert.deepEqual(
    catalog.requests.map(
      (/** @type {any} */ row) =>
        `${row.credentialRole}/${row.target}/${row.responseProfile}`,
    ),
    [
      'full-control/served/spaces-website-configuration-v2',
      'full-control/staging/spaces-website-absent-v2',
      'limited-deployment/served/spaces-website-access-denied-v2',
      'limited-deployment/staging/spaces-website-access-denied-v2',
    ],
  );
  for (const row of catalog.requests) {
    assert.equal(row.method, 'GET');
    assert.equal(row.requestTarget, CONTROL_PLANE_REQUEST_TARGET);
    assert.equal(
      row.origin,
      row.target === 'served'
        ? origins.servedApiOrigin
        : origins.stagingApiOrigin,
    );
    assert.notEqual(row.origin, origins.publicOrigin);
  }
  assert.match(catalog.catalogDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    catalog.responseCatalogDigest,
    buildControlPlaneResponseCatalog().catalogDigest,
  );

  const responses = /** @type {any} */ (buildControlPlaneResponseCatalog());
  assert.equal(responses.profile, CONTROL_PLANE_RESPONSE_PROFILE);
  assert.deepEqual(responses.responseProfiles, [
    ...CONTROL_PLANE_RESPONSE_PROFILES,
  ]);
});

test('both buckets answering 403 AccessDenied proves the limited key is denied', async () => {
  const bound = await bind();
  try {
    const evidence = /** @type {any} */ (
      await proveLimitedKeyAccessDenied({ destination: bound.destination })
    );
    assert.equal(evidence.proven, true);
    assert.equal(evidence.observations.length, 2);
    assert.deepEqual(
      evidence.observations.map((/** @type {any} */ row) => row.target),
      ['served', 'staging'],
    );
    for (const row of evidence.observations) {
      assert.equal(row.observedStatus, 403);
      assert.equal(row.observedErrorCode, 'AccessDenied');
      assert.equal(row.credentialRole, 'limited-deployment');
      assert.equal(row.requestTarget, CONTROL_PLANE_REQUEST_TARGET);
    }
    const origins = deriveOrigins(bound.destination);
    assert.deepEqual(
      evidence.observations.map((/** @type {any} */ row) => row.origin),
      [origins.servedApiOrigin, origins.stagingApiOrigin],
    );
  } finally {
    await bound.provider.stop();
  }
});

test('the evidence record carries no credential bytes at all', async () => {
  const bound = await bind();
  try {
    const evidence = await proveLimitedKeyAccessDenied({
      destination: bound.destination,
    });
    const rendered = JSON.stringify(evidence);
    for (const secret of [
      bound.destination.accessKeyId,
      bound.destination.secretAccessKey,
      'AWS4-HMAC-SHA256',
      'Credential=',
      'Signature=',
      'authorization',
    ]) {
      assert.equal(
        rendered.includes(secret),
        false,
        `the evidence record leaked ${secret}`,
      );
    }
  } finally {
    await bound.provider.stop();
  }
});

test('a 200 website configuration for the limited key fails closed on either bucket', async () => {
  for (const overprivileged of ['served', 'staging']) {
    const bound = await bind((bucket) =>
      bucket.startsWith(`gala-${overprivileged}-`)
        ? {
            status: 200,
            body: '<?xml version="1.0"?><WebsiteConfiguration><IndexDocument><Suffix>index.html</Suffix></IndexDocument><ErrorDocument><Key>404.html</Key></ErrorDocument></WebsiteConfiguration>',
          }
        : {
            status: 403,
            body: '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>',
          },
    );
    try {
      await assert.rejects(
        proveLimitedKeyAccessDenied({ destination: bound.destination }),
        /SPACES_LIMITED_KEY_OVERPRIVILEGED/u,
        `an over-privileged ${overprivileged} key was accepted`,
      );
    } finally {
      await bound.provider.stop();
    }
  }
});

test('a 404 NoSuchWebsiteConfiguration for the limited key does not prove denial', async () => {
  const bound = await bind(() => ({
    status: 404,
    body: '<?xml version="1.0"?><Error><Code>NoSuchWebsiteConfiguration</Code></Error>',
  }));
  try {
    // Absence is not denial: a bucket with no website configuration answers
    // 404 to *any* key, including one that would happily have read it.
    await assert.rejects(
      proveLimitedKeyAccessDenied({ destination: bound.destination }),
      /SPACES_LIMITED_KEY_DENIAL_UNPROVEN/u,
    );
  } finally {
    await bound.provider.stop();
  }
});

test('a malformed or mismatched denial body fails closed', async () => {
  for (const body of [
    'not xml at all',
    '<?xml version="1.0"?><Error></Error>',
    '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Code>AccessDenied</Code></Error>',
    '<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code></Error>',
    '<?xml version="1.0"?><NotAnError><Code>AccessDenied</Code></NotAnError>',
  ]) {
    const bound = await bind(() => ({ status: 403, body }));
    try {
      await assert.rejects(
        proveLimitedKeyAccessDenied({ destination: bound.destination }),
        /SPACES_LIMITED_KEY_DENIAL_UNPROVEN/u,
        `${body} was accepted as a denial proof`,
      );
    } finally {
      await bound.provider.stop();
    }
  }
});

test('a destination with no limited credential is refused before any request', async () => {
  const bound = await bind();
  try {
    const noKey = { ...bound.destination };
    delete noKey.secretAccessKey;
    await assert.rejects(
      proveLimitedKeyAccessDenied({
        destination: /** @type {any} */ (noKey),
      }),
      /SPACES_LIMITED_KEY_DENIAL_UNPROVEN/u,
    );
  } finally {
    await bound.provider.stop();
  }
});
