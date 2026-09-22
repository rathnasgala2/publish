import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PUBLIC_GENERATION_MARKER_SCHEMA_ID,
  buildGenerationMarker,
  checkGenerationMarker,
} from '../src/index.js';

const VALID_FIELDS = Object.freeze({
  artifactId: '019c0000-0000-7000-8000-000000000001',
  artifactDigest: `sha256:${'a'.repeat(64)}`,
  generationId: '019c0000-0000-7000-8000-000000000002',
});

test('PUBLIC_GENERATION_MARKER_SCHEMA_ID is the exact published schema id', () => {
  assert.equal(
    PUBLIC_GENERATION_MARKER_SCHEMA_ID,
    'urn:gala:schema:public-generation-marker:2.0.0',
  );
});

test('buildGenerationMarker produces a schema-valid closed marker', () => {
  const marker = buildGenerationMarker(VALID_FIELDS);
  assert.equal(marker.schemaId, PUBLIC_GENERATION_MARKER_SCHEMA_ID);
  assert.equal(marker.schemaVersion, '2.0.0');
  assert.deepEqual(checkGenerationMarker(marker), []);
});

test('checkGenerationMarker rejects a malformed artifactId', () => {
  const findings = checkGenerationMarker({
    ...buildGenerationMarker(VALID_FIELDS),
    artifactId: 'not-a-uuid',
  });
  assert.ok(findings.length > 0);
  assert.ok(findings.every((f) => f.severity === 'ARTIFACT_SAFETY_ERROR'));
});

test('checkGenerationMarker rejects an unknown additional property', () => {
  const findings = checkGenerationMarker({
    ...buildGenerationMarker(VALID_FIELDS),
    extra: 'nope',
  });
  assert.ok(findings.length > 0);
});

test('checkGenerationMarker rejects a missing required field', () => {
  const marker = buildGenerationMarker(VALID_FIELDS);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-to-omit
  const { generationId, ...withoutGenerationId } = marker;
  const findings = checkGenerationMarker(withoutGenerationId);
  assert.ok(findings.length > 0);
});

test('property: every field mutated to a syntactically invalid value is rejected', () => {
  for (const field of ['artifactId', 'artifactDigest', 'generationId']) {
    const findings = checkGenerationMarker({
      ...buildGenerationMarker(VALID_FIELDS),
      [field]: 'invalid-value',
    });
    assert.ok(findings.length > 0, `field ${field} should be rejected`);
  }
});
