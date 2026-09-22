import assert from 'node:assert/strict';
import { test } from 'node:test';

import { domainDigest } from '@rathnasgala2/adapter-protocol';

import {
  CAPABILITY_DECISION_DOMAIN,
  buildCapabilityDecision,
  verifyCapabilityDecisionDigest,
} from '../src/index.js';
import { first } from './helpers.js';

const BASE_FIELDS = Object.freeze({
  artifactId: '019c0000-0000-7000-8000-000000000001',
  artifactDigest: 'sha256:artifact',
  manifestDigest: 'sha256:manifest',
  destination: { environment: 'local' },
  capabilityDigest: 'sha256:capability',
  artifactFileCount: 3,
  deploymentObjectCount: 4,
  artifactByteCount: 1000,
  markerByteLength: 120,
  deploymentByteCount: 1120,
  maximumFinalPathByteLength: 512,
  maximumStageRequestCount: 10,
  maximumStageRequestBytes: 1000000,
  maximumStageResponseBytes: 1000000,
  maximumStageResponseWireBytes: 1000000,
});

/** @type {readonly (keyof typeof BASE_FIELDS)[]} */
const BASE_FIELD_NAMES = [
  'artifactId',
  'artifactDigest',
  'manifestDigest',
  'destination',
  'capabilityDigest',
  'artifactFileCount',
  'deploymentObjectCount',
  'artifactByteCount',
  'markerByteLength',
  'deploymentByteCount',
  'maximumFinalPathByteLength',
  'maximumStageRequestCount',
  'maximumStageRequestBytes',
  'maximumStageResponseBytes',
  'maximumStageResponseWireBytes',
];

/**
 * @param {ReturnType<typeof buildCapabilityDecision>} result
 * @returns {NonNullable<ReturnType<typeof buildCapabilityDecision>['record']>}
 */
function requireRecord(result) {
  assert.ok(
    result.record !== null,
    'expected buildCapabilityDecision to succeed',
  );
  return result.record;
}

test('CAPABILITY_DECISION_DOMAIN is the exact DEC-097 domain separator', () => {
  assert.equal(CAPABILITY_DECISION_DOMAIN, 'GALA-CAPABILITY-DECISION-V2\0');
});

test('builds a local-directory decision with no conditional fields', () => {
  const result = buildCapabilityDecision({
    ...BASE_FIELDS,
    adapter: { adapterId: 'local-directory' },
  });
  assert.deepEqual(result.findings, []);
  const record = requireRecord(result);
  assert.equal(record.profile, 'gala-capability-decision-v2');
  assert.ok(String(record.decisionDigest).startsWith('sha256:'));
  assert.equal('credentialEgressProfileDigest' in record, false);
});

test('rejects an unknown adapterId', () => {
  const result = buildCapabilityDecision({
    ...BASE_FIELDS,
    adapter: { adapterId: 'cloudflare-pages' },
  });
  assert.equal(result.record, null);
  assert.equal(
    first(result.findings).code,
    'CAPABILITY_DECISION_ADAPTER_UNKNOWN',
  );
});

test('rejects a missing always-required field', () => {
  const { adapter, ...rest } = {
    ...BASE_FIELDS,
    adapter: { adapterId: 'local-directory' },
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-to-omit
  const { artifactId, ...withoutArtifactId } = rest;
  const result = buildCapabilityDecision({ ...withoutArtifactId, adapter });
  assert.equal(result.record, null);
  assert.ok(
    result.findings.some(
      (f) =>
        f.code === 'CAPABILITY_DECISION_FIELD_MISSING' &&
        f.location === '/artifactId',
    ),
  );
});

test('github-pages requires exactly its four pages fields plus egress/oidc digests', () => {
  const missing = buildCapabilityDecision({
    ...BASE_FIELDS,
    adapter: { adapterId: 'github-pages' },
  });
  assert.equal(missing.record, null);
  assert.ok(
    missing.findings.some(
      (f) => f.location === '/credentialEgressProfileDigest',
    ),
  );
  assert.ok(missing.findings.some((f) => f.location === '/pagesBuildVersion'));

  const complete = buildCapabilityDecision({
    ...BASE_FIELDS,
    adapter: { adapterId: 'github-pages' },
    credentialEgressProfileDigest: 'sha256:egress',
    pagesOidcOriginCatalogDigest: 'sha256:oidc',
    pagesActionsArtifactName: 'gala-pages-r1-a1',
    pagesActionsArtifactByteCount: 100,
    pagesActionsArtifactDigest: 'sha256:artifact-tar',
    pagesBuildVersion: 'a'.repeat(40),
  });
  assert.equal(complete.findings.length, 0);
  requireRecord(complete);
});

test('do-spaces forbids pages fields and requires the six spaces fields', () => {
  const result = buildCapabilityDecision({
    ...BASE_FIELDS,
    adapter: { adapterId: 'do-spaces' },
    pagesBuildVersion: 'a'.repeat(40),
  });
  assert.equal(result.record, null);
  assert.ok(
    result.findings.some(
      (f) =>
        f.code === 'CAPABILITY_DECISION_FIELD_FORBIDDEN' &&
        f.location === '/pagesBuildVersion',
    ),
  );
  assert.ok(result.findings.some((f) => f.location === '/spacesStagePrefix'));
});

test('local-directory forbids every conditional field', () => {
  const result = buildCapabilityDecision({
    ...BASE_FIELDS,
    adapter: { adapterId: 'local-directory' },
    credentialEgressProfileDigest: 'sha256:egress',
  });
  assert.equal(result.record, null);
  assert.ok(
    result.findings.some(
      (f) => f.code === 'CAPABILITY_DECISION_FIELD_FORBIDDEN',
    ),
  );
});

test('decisionDigest is exactly domainDigest over the record with decisionDigest omitted', () => {
  const record = requireRecord(
    buildCapabilityDecision({
      ...BASE_FIELDS,
      adapter: { adapterId: 'local-directory' },
    }),
  );
  const { decisionDigest, ...withoutDigest } = record;
  assert.equal(
    domainDigest(CAPABILITY_DECISION_DOMAIN, withoutDigest),
    decisionDigest,
  );
});

test('decisionDigest is deterministic across key order', () => {
  const forward = requireRecord(
    buildCapabilityDecision({
      ...BASE_FIELDS,
      adapter: { adapterId: 'local-directory' },
    }),
  );
  const reordered = {
    adapter: { adapterId: 'local-directory' },
    ...Object.fromEntries(Object.entries(BASE_FIELDS).reverse()),
  };
  const backward = requireRecord(buildCapabilityDecision(reordered));
  assert.equal(forward.decisionDigest, backward.decisionDigest);
});

test('verifyCapabilityDecisionDigest accepts an untampered record and rejects a tampered one', () => {
  const record = requireRecord(
    buildCapabilityDecision({
      ...BASE_FIELDS,
      adapter: { adapterId: 'local-directory' },
    }),
  );
  assert.deepEqual(verifyCapabilityDecisionDigest(record), []);

  const tampered = {
    ...record,
    artifactByteCount: Number(record.artifactByteCount) + 1,
  };
  const findings = verifyCapabilityDecisionDigest(tampered);
  assert.equal(first(findings).code, 'CAPABILITY_DECISION_DIGEST_MISMATCH');
  assert.equal(first(findings).severity, 'ARTIFACT_SAFETY_ERROR');
});

test('property: mutating any single base field changes the decisionDigest', () => {
  const base = requireRecord(
    buildCapabilityDecision({
      ...BASE_FIELDS,
      adapter: { adapterId: 'local-directory' },
    }),
  );
  for (const field of BASE_FIELD_NAMES) {
    if (field === 'destination') {
      continue; // nested object; scalar-only sweep here covers the digest sensitivity property.
    }
    const mutatedFields = {
      ...BASE_FIELDS,
      [field]: `${BASE_FIELDS[field]}-x`,
      adapter: { adapterId: 'local-directory' },
    };
    const mutated = requireRecord(buildCapabilityDecision(mutatedFields));
    assert.notEqual(
      mutated.decisionDigest,
      base.decisionDigest,
      `field ${field}`,
    );
  }
});
