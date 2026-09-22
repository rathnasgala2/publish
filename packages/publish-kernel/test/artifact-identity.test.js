import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  KernelError,
  assertArtifactIdentityAgreement,
  checkArtifactIdentityAgreement,
} from '../src/index.js';
import { first } from './helpers.js';

const RECORD = Object.freeze({
  artifactId: '019c0000-0000-7000-8000-000000000001',
  artifactDigest:
    'sha256:1111111111111111111111111111111111111111111111111111111111111111'.slice(
      0,
      71,
    ),
  manifestDigest:
    'sha256:2222222222222222222222222222222222222222222222222222222222222222'.slice(
      0,
      71,
    ),
  artifactFileCount: 3,
  artifactByteCount: 1024,
});

test('no findings when nothing has been frozen yet', () => {
  assert.deepEqual(checkArtifactIdentityAgreement(null, RECORD), []);
});

test('no findings when the candidate byte-equals the frozen record', () => {
  assert.deepEqual(checkArtifactIdentityAgreement(RECORD, { ...RECORD }), []);
});

test('one finding per disagreeing field', () => {
  const mutated = {
    ...RECORD,
    artifactDigest: `sha256:${'9'.repeat(64)}`,
    artifactByteCount: 2048,
  };
  const findings = checkArtifactIdentityAgreement(RECORD, mutated);
  assert.equal(findings.length, 2);
  for (const finding of findings) {
    assert.equal(finding.code, 'ARTIFACT_MUTATED_AFTER_FREEZE');
    assert.equal(finding.severity, 'ARTIFACT_SAFETY_ERROR');
    assert.equal(finding.overridable, false);
  }
});

test('assertArtifactIdentityAgreement throws KernelError on any disagreement', () => {
  const mutated = {
    ...RECORD,
    artifactId: '019c0000-0000-7000-8000-000000000002',
  };
  assert.throws(
    () => assertArtifactIdentityAgreement(RECORD, mutated),
    (error) => error instanceof KernelError && error.findings.length === 1,
  );
});

test('assertArtifactIdentityAgreement is silent when nothing changed', () => {
  assert.doesNotThrow(() =>
    assertArtifactIdentityAgreement(RECORD, { ...RECORD }),
  );
  assert.doesNotThrow(() => assertArtifactIdentityAgreement(null, RECORD));
});

test('property: every field of a single-field mutation is caught, no others', () => {
  /** @type {readonly (keyof typeof RECORD)[]} */
  const fields = [
    'artifactId',
    'artifactDigest',
    'manifestDigest',
    'artifactFileCount',
    'artifactByteCount',
  ];
  for (const field of fields) {
    const original = RECORD[field];
    const mutatedValue =
      typeof original === 'number' ? original + 1 : `${original}-mutated`;
    const mutated = { ...RECORD, [field]: mutatedValue };
    const findings = checkArtifactIdentityAgreement(RECORD, mutated);
    assert.equal(
      findings.length,
      1,
      `field ${field} should produce exactly one finding`,
    );
    assert.equal(first(findings).location, `/${field}`);
  }
});
