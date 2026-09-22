import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkDestinationAuthority,
  checkDestinationOwnership,
} from '../src/index.js';
import { first } from './helpers.js';

const DESTINATION = Object.freeze({
  environment: 'local',
  adapterId: 'local-directory',
  adapterVersion: '2.0.0',
  targetDigest: 'sha256:aaaa',
  baseUrl: 'https://example.com/',
});

test('checkDestinationAuthority: no findings when unchanged', () => {
  assert.deepEqual(
    checkDestinationAuthority(DESTINATION, { ...DESTINATION }),
    [],
  );
});

test('checkDestinationAuthority: one finding per changed field', () => {
  const changed = {
    ...DESTINATION,
    adapterVersion: '3.0.0',
    baseUrl: 'https://other.example.com/',
  };
  const findings = checkDestinationAuthority(DESTINATION, changed);
  assert.equal(findings.length, 2);
  for (const finding of findings) {
    assert.equal(finding.code, 'DESTINATION_AUTHORITY_MISMATCH');
    assert.equal(finding.severity, 'TARGET_CONSTRAINT_ERROR');
  }
});

test('checkDestinationOwnership: no findings for the authorized destination', () => {
  assert.deepEqual(
    checkDestinationOwnership(DESTINATION, { ...DESTINATION }),
    [],
  );
});

test('checkDestinationOwnership: one finding for any other destination, regardless of which field differs', () => {
  const other = { ...DESTINATION, environment: 'other' };
  const findings = checkDestinationOwnership(DESTINATION, other);
  assert.equal(findings.length, 1);
  assert.equal(first(findings).code, 'DESTINATION_AUTHORITY_UNOWNED');
  assert.deepEqual(
    first(findings).evidence?.authorizedDestination,
    DESTINATION,
  );
});

test('property: exactly one field mutated is caught by checkDestinationAuthority, at the right location', () => {
  /** @type {readonly (keyof typeof DESTINATION)[]} */
  const fields = [
    'environment',
    'adapterId',
    'adapterVersion',
    'targetDigest',
    'baseUrl',
  ];
  for (const field of fields) {
    const mutated = { ...DESTINATION, [field]: `${DESTINATION[field]}-x` };
    const findings = checkDestinationAuthority(DESTINATION, mutated);
    assert.equal(findings.length, 1);
    assert.equal(first(findings).location, `/${field}`);
  }
});
