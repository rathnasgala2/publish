import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ADAPTER_CAPABILITY_SCHEMA_ID,
  assertValidCapabilityDeclaration,
  checkExactRow,
  validateCapabilityDeclaration,
} from '../src/capability.js';
import { AdapterProtocolError } from '../src/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, 'fixtures', 'lowercase-capabilities.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

/**
 * @param {string} caseId fixture case identity
 * @returns {any} the case's instance document
 */
function fixtureInstance(caseId) {
  const found = fixture.cases.find(
    (/** @type {{ caseId: string }} */ entry) => entry.caseId === caseId,
  );
  assert.ok(found, `fixture case ${caseId} exists`);
  return found.instance;
}

test('ADAPTER_CAPABILITY_SCHEMA_ID is the exact 2.0.0 schema identity', () => {
  assert.equal(
    ADAPTER_CAPABILITY_SCHEMA_ID,
    'urn:gala:schema:adapter-capability:2.0.0',
  );
});

for (const caseId of [
  'capability-local-directory-valid-lowercase',
  'capability-github-pages-valid-lowercase',
  'capability-do-spaces-valid-lowercase',
]) {
  test(`${caseId} passes both schema and exact-row validation`, () => {
    const instance = fixtureInstance(caseId);
    const result = validateCapabilityDeclaration(instance);
    assert.equal(
      result.schemaValid,
      true,
      JSON.stringify(result.schemaDiagnostics),
    );
    assert.equal(result.exactRowValid, true, JSON.stringify(result.findings));
    assert.doesNotThrow(() => assertValidCapabilityDeclaration(instance));
    assert.deepEqual(checkExactRow(instance), []);
  });
}

test('capability-uppercase-invalid fails schema validation', () => {
  const instance = fixtureInstance('capability-uppercase-invalid');
  const result = validateCapabilityDeclaration(instance);
  assert.equal(result.schemaValid, false);
  assert.throws(
    () => assertValidCapabilityDeclaration(instance),
    AdapterProtocolError,
  );
});

test('checkExactRow rejects an unknown adapterId', () => {
  const findings = checkExactRow({ adapter: { adapterId: 'unknown' } });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, 'TARGET_CAPABILITY_DECLARATION_MALFORMED');
});

test('checkExactRow rejects a non-object declaration', () => {
  const findings = checkExactRow('not-an-object');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, 'TARGET_CAPABILITY_DECLARATION_MALFORMED');
});

test('checkExactRow rejects a local-directory declaration truthfully claiming do-spaces concurrency', () => {
  const instance = fixtureInstance(
    'capability-local-directory-valid-lowercase',
  );
  const mutated = { ...instance, concurrency: 'best-effort' };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some((entry) => entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH'),
  );
  assert.ok(findings.some((entry) => entry.location === '/concurrency'));
});

test('checkExactRow rejects a stronger-than-truthful providerInventoryAssurance claim', () => {
  const instance = fixtureInstance('capability-github-pages-valid-lowercase');
  const mutated = {
    ...instance,
    providerInventoryAssurance: 'complete-artifact-digest',
  };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some(
      (entry) =>
        entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH' &&
        entry.location === '/providerInventoryAssurance',
    ),
  );
});

test('checkExactRow rejects a do-spaces declaration with notFoundBehavior false', () => {
  const instance = fixtureInstance('capability-do-spaces-valid-lowercase');
  const mutated = {
    ...instance,
    configuration: { ...instance.configuration, notFoundBehavior: false },
  };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some(
      (entry) =>
        entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH' &&
        entry.location === '/configuration/notFoundBehavior',
    ),
  );
});

test('checkExactRow rejects a true configuration boolean outside the one exact Spaces field', () => {
  const instance = fixtureInstance(
    'capability-local-directory-valid-lowercase',
  );
  const mutated = {
    ...instance,
    configuration: { ...instance.configuration, redirects: true },
  };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some(
      (entry) =>
        entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH' &&
        entry.location === '/configuration/redirects',
    ),
  );
});

test('checkExactRow rejects a mismatched transport for the adapter row', () => {
  const instance = fixtureInstance(
    'capability-local-directory-valid-lowercase',
  );
  const mutated = {
    ...instance,
    limits: { ...instance.limits, transport: 'http' },
  };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some(
      (entry) =>
        entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH' &&
        entry.location === '/limits/transport',
    ),
  );
});

test('checkExactRow rejects a verification set that is a superset of the exact row', () => {
  const instance = fixtureInstance(
    'capability-local-directory-valid-lowercase',
  );
  const mutated = {
    ...instance,
    verification: [...instance.verification, 'origin-http'],
  };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some(
      (entry) =>
        entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH' &&
        entry.location === '/verification',
    ),
  );
});

test('checkExactRow rejects a destinationKinds mismatch for the adapter row', () => {
  const instance = fixtureInstance('capability-github-pages-valid-lowercase');
  const mutated = { ...instance, destinationKinds: ['do-spaces'] };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some(
      (entry) =>
        entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH' &&
        entry.location === '/destinationKinds',
    ),
  );
});

test('checkExactRow rejects an operations set missing one member', () => {
  const instance = fixtureInstance('capability-do-spaces-valid-lowercase');
  const mutated = {
    ...instance,
    operations: instance.operations.filter(
      (/** @type {string} */ op) => op !== 'rollback',
    ),
  };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some(
      (entry) =>
        entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH' &&
        entry.location === '/operations',
    ),
  );
});

test('checkExactRow rejects rollback other than reupload', () => {
  const instance = fixtureInstance(
    'capability-local-directory-valid-lowercase',
  );
  const mutated = { ...instance, rollback: 'reactivate-generation' };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some(
      (entry) =>
        entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH' &&
        entry.location === '/rollback',
    ),
  );
});

test('checkExactRow rejects cacheInvalidation other than none', () => {
  const instance = fixtureInstance(
    'capability-local-directory-valid-lowercase',
  );
  const mutated = { ...instance, cacheInvalidation: 'purge' };
  const findings = checkExactRow(mutated);
  assert.ok(
    findings.some(
      (entry) =>
        entry.code === 'TARGET_CAPABILITY_ROW_MISMATCH' &&
        entry.location === '/cacheInvalidation',
    ),
  );
});
