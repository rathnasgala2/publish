/**
 * The `buildProvenance:2.0.0` record `freeze` writes (DEC-097 section 6).
 *
 * The record carries exactly the members the workflow is the honest source
 * of and nothing DEC-097 assigns to Gala, the template or a catalog; the
 * omitted members are documented by owner rather than filled. This suite
 * pins that member set, the closed scalar domains, the 21-claim catalog and
 * the fail-closed runner-identity requirement.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BuildProvenanceError,
  CALLER_PATH,
  PROVENANCE_MEMBERS_NOT_YET_HELD,
  REQUIRED_OIDC_CLAIMS,
  SPDX_23_JSON_SCHEMA_DIGEST,
  buildProvenanceRecord,
  validateProvenanceRecord,
} from '../scripts/workflow/build-provenance.mjs';
import { domainSeparatedDigest } from '../scripts/workflow/frozen-envelope.mjs';
import {
  RUNNER_IDENTITY,
  fixtureHandoffs,
  frozenEnvelopeFor,
} from './fixtures/artifact-manifest.mjs';

const FILES = Object.freeze([
  { path: 'index.html', bytes: Buffer.from('<!doctype html><p>home', 'utf8') },
]);

/**
 * @param {Partial<Record<string, string | undefined>>} [runner] runner overrides
 * @returns {Record<string, unknown>} a record over the fixture facts
 */
function recordWith(runner = {}) {
  const handoffs = fixtureHandoffs();
  const digest = domainSeparatedDigest('GALA-TEST-V2\0', Buffer.from('x'));
  return buildProvenanceRecord({
    runner: { ...RUNNER_IDENTITY, ...runner },
    sourceCommit: 'a'.repeat(40),
    workflowTriggerCommit: `sha1:${'b'.repeat(40)}`,
    verifiedInputHandoff: handoffs.verified,
    unfrozenOutputHandoff: handoffs.unfrozen,
    lockDigest: digest,
    buildInputDigest: digest,
    artifactDigest: digest,
    manifestDigest: digest,
    sbomDigest: digest,
  });
}

test('the record carries exactly the workflow-held members, with the runner identity, the 21-claim catalog and both handoffs', () => {
  const record = recordWith();
  assert.deepEqual(Object.keys(record).sort(), [
    'artifactDigest',
    'assertedWorkload',
    'buildInputDigest',
    'lockDigest',
    'manifestDigest',
    'requiredOidcClaims',
    'sbomDigest',
    'schemaId',
    'schemaVersion',
    'secretInputs',
    'spdx23JsonSchemaDigest',
    'unfrozenOutputHandoff',
    'verifiedInputHandoff',
  ]);
  assert.equal(record.schemaId, 'urn:gala:metadata:build-provenance:2.0.0');
  assert.deepEqual(record.assertedWorkload, {
    repository: 'gala-author/site',
    repositoryId: '4242',
    repositoryOwner: 'gala-author',
    repositoryOwnerId: '99',
    ref: 'refs/heads/gala/publish/019c0000-0000-7000-8000-000000000001',
    sourceCommit: `sha1:${'a'.repeat(40)}`,
    workflowTriggerCommit: `sha1:${'b'.repeat(40)}`,
    runId: '987654321',
    runNumber: '12',
    runAttempt: 1,
    eventName: 'create',
    actor: 'gala-author',
    actorId: '77',
    callerPath: CALLER_PATH,
    verificationState: 'pending-authorize-oidc',
  });
  assert.equal(REQUIRED_OIDC_CLAIMS.length, 21);
  assert.deepEqual(record.requiredOidcClaims, [...REQUIRED_OIDC_CLAIMS]);
  assert.deepEqual(record.verifiedInputHandoff, fixtureHandoffs().verified);
  assert.deepEqual(record.unfrozenOutputHandoff, fixtureHandoffs().unfrozen);
  assert.equal(record.spdx23JsonSchemaDigest, SPDX_23_JSON_SCHEMA_DIGEST);
  assert.deepEqual(record.secretInputs, []);
});

test('every DEC-097 member the record does not carry is documented with its owner, and none of them leaks into the record', () => {
  const record = recordWith();
  const omitted = Object.keys(PROVENANCE_MEMBERS_NOT_YET_HELD);
  assert.ok(omitted.length >= 10);
  for (const member of omitted) {
    assert.equal(member in record, false, `${member} is absent`);
    assert.match(
      PROVENANCE_MEMBERS_NOT_YET_HELD[
        /** @type {keyof typeof PROVENANCE_MEMBERS_NOT_YET_HELD} */ (member)
      ],
      /.{20,}/u,
    );
  }
  for (const member of [
    'policyReleaseId',
    'buildPolicyDecisionDigest',
    'capabilityDecisionDigest',
    'rebuildRecord',
  ]) {
    assert.ok(omitted.includes(member), `${member} is named as not held`);
  }
});

test('a missing runner fact and an event a publish ref cannot be created by fail closed', () => {
  for (const name of Object.keys(RUNNER_IDENTITY)) {
    assert.throws(
      () => recordWith({ [name]: '' }),
      (/** @type {any} */ error) =>
        error instanceof BuildProvenanceError &&
        error.code === 'PROVENANCE_RUNNER_IDENTITY_MISSING',
      name,
    );
  }
  assert.throws(
    () => recordWith({ GITHUB_EVENT_NAME: 'push' }),
    /PROVENANCE_INVALID: \/assertedWorkload\/eventName/u,
  );
  assert.throws(
    () => recordWith({ GITHUB_RUN_ATTEMPT: '52' }),
    /PROVENANCE_INVALID: \/assertedWorkload\/runAttempt/u,
  );
});

test('the closed validator refuses an extra member, a placeholder for an omitted member and a wrong handoff purpose', () => {
  const record = recordWith();
  assert.throws(
    () =>
      validateProvenanceRecord({
        ...record,
        policyReleaseId: '019c0000-0000-7000-8000-0000000000bb',
      }),
    /PROVENANCE_INVALID: .*policyReleaseId/u,
  );
  assert.throws(
    () => validateProvenanceRecord({ ...record, secretInputs: ['x'] }),
    /PROVENANCE_INVALID: \/secretInputs/u,
  );
  assert.throws(
    () =>
      validateProvenanceRecord({
        ...record,
        verifiedInputHandoff: {
          .../** @type {any} */ (record).verifiedInputHandoff,
          purpose: 'unfrozen-output',
        },
      }),
    /PROVENANCE_INVALID: \/verifiedInputHandoff\/purpose/u,
  );
  assert.throws(
    () =>
      validateProvenanceRecord({
        ...record,
        spdx23JsonSchemaDigest: `sha256:${'0'.repeat(64)}`,
      }),
    /PROVENANCE_INVALID: \/spdx23JsonSchemaDigest/u,
  );
});

test('inside an envelope the record’s three digests are the envelope’s own', () => {
  const { decoded, provenance } = frozenEnvelopeFor(FILES);
  assert.equal(provenance.artifactDigest, decoded.artifactDigest);
  assert.equal(provenance.manifestDigest, decoded.manifestDigest);
  assert.equal(provenance.sbomDigest, decoded.sbomDigest);
  assert.equal(
    decoded.provenanceDigest,
    domainSeparatedDigest(
      'GALA-BUILD-PROVENANCE-V2\0',
      decoded.provenanceBytes,
    ),
  );
});
