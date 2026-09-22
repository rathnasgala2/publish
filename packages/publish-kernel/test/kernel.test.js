import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateActivate,
  evaluateCleanupStaged,
  evaluateObserve,
  evaluatePreflight,
  evaluateRollback,
  evaluateStage,
  kernelFinding,
} from '../src/index.js';

const DESTINATION = Object.freeze({
  environment: 'local',
  adapterId: 'local-directory',
  adapterVersion: '2.0.0',
  targetDigest: 'sha256:aaaa',
  baseUrl: 'https://example.com/',
});

const ARTIFACT = Object.freeze({
  artifactId: '019c0000-0000-7000-8000-000000000001',
  artifactDigest: `sha256:${'a'.repeat(64)}`,
  manifestDigest: `sha256:${'b'.repeat(64)}`,
  artifactFileCount: 2,
  artifactByteCount: 100,
});

const OPERATION = Object.freeze({
  operationId: '019c0000-0000-7000-8000-000000000010',
  attemptId: '019c0000-0000-7000-8000-000000000010',
  idempotencyKey: '019c0000-0000-7000-8000-000000000010',
  artifactDigest: ARTIFACT.artifactDigest,
});

test('evaluatePreflight proceeds on a clean candidate', () => {
  const result = evaluatePreflight({
    entries: [{ path: 'index.html', kind: 'file' }],
    totals: {
      artifactFileCount: 1,
      artifactByteCount: 100,
      longestPathBytes: 10,
    },
    limits: {
      maximumFiles: '1000',
      maximumArtifactBytes: '1000000',
      maximumPathBytes: 512,
    },
    authorizedDestination: DESTINATION,
    candidateDestination: DESTINATION,
    intent: { note: 'clean' },
  });
  assert.equal(result.verdict, 'proceed');
  assert.deepEqual(result.findings, []);
});

test('evaluatePreflight refuses on a resource-limit breach and a secret in the same pass', () => {
  const result = evaluatePreflight({
    entries: [{ path: 'index.html', kind: 'file' }],
    totals: {
      artifactFileCount: 2,
      artifactByteCount: 100,
      longestPathBytes: 10,
    },
    limits: {
      maximumFiles: '1',
      maximumArtifactBytes: '1000000',
      maximumPathBytes: 512,
    },
    authorizedDestination: DESTINATION,
    candidateDestination: DESTINATION,
    intent: { apiKey: 'leaked-secret-value' },
  });
  assert.equal(result.verdict, 'refuse');
  assert.ok(
    result.findings.some((f) => f.code === 'ARTIFACT_FILE_COUNT_EXCEEDED'),
  );
  assert.ok(result.findings.some((f) => f.code === 'SECRET_EXPOSURE_DETECTED'));
});

test('evaluateStage proceeds and reports a new idempotency status for a first-seen operation', () => {
  const result = evaluateStage({
    frozenArtifact: null,
    candidateArtifact: ARTIFACT,
    preflightDestination: DESTINATION,
    currentDestination: DESTINATION,
    journal: [],
    candidateOperation: OPERATION,
  });
  assert.equal(result.verdict, 'proceed');
  assert.equal(result.idempotency.status, 'new');
});

test('evaluateStage refuses when the frozen artifact disagrees with the candidate', () => {
  const result = evaluateStage({
    frozenArtifact: { ...ARTIFACT, artifactByteCount: 999 },
    candidateArtifact: ARTIFACT,
    preflightDestination: DESTINATION,
    currentDestination: DESTINATION,
    journal: [],
    candidateOperation: OPERATION,
  });
  assert.equal(result.verdict, 'refuse');
  assert.ok(
    result.findings.some((f) => f.code === 'ARTIFACT_MUTATED_AFTER_FREEZE'),
  );
});

test('evaluateActivate proceeds and builds a valid marker when the fence admits it', () => {
  const result = evaluateActivate({
    preflightDestination: DESTINATION,
    currentDestination: DESTINATION,
    fence: { concurrency: 'none' },
    marker: {
      schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
      schemaVersion: '2.0.0',
      artifactId: ARTIFACT.artifactId,
      artifactDigest: ARTIFACT.artifactDigest,
      generationId: '019c0000-0000-7000-8000-000000000099',
    },
  });
  assert.equal(result.verdict, 'proceed');
  assert.equal(result.activation.decision, 'activate');
});

test('evaluateActivate reconciles instead of activating on a stale fence, skipping marker validation', () => {
  const result = evaluateActivate({
    preflightDestination: DESTINATION,
    currentDestination: DESTINATION,
    fence: {
      concurrency: 'expected-generation',
      expectedGenerationId: '019c0000-0000-7000-8000-000000000001',
      observedGenerationId: '019c0000-0000-7000-8000-000000000002',
    },
    marker: { not: 'validated because activation did not proceed' },
  });
  assert.equal(result.activation.decision, 'reconcile');
  assert.ok(
    !result.findings.some(
      (f) => f.code === 'TARGET_CAPABILITY_DECLARATION_MALFORMED',
    ),
  );
});

test('evaluateObserve classifies a definitive success with no exposed secrets', () => {
  const result = evaluateObserve({
    outcome: { attempted: true, providerResponded: true, timedOut: false },
    observation: { generationId: '019c0000-0000-7000-8000-000000000001' },
  });
  assert.equal(result.verdict, 'proceed');
  assert.equal(result.disposition, 'succeeded');
});

test('evaluateObserve proceeds (WARNING only) on an ambiguous timeout, never a false failure', () => {
  const result = evaluateObserve({
    outcome: { attempted: true, providerResponded: false, timedOut: true },
    observation: {},
  });
  assert.equal(result.verdict, 'proceed');
  assert.equal(result.disposition, 'unknown-reconciling');
});

test('evaluateCleanupStaged refuses cleanup of an unowned destination', () => {
  const other = { ...DESTINATION, environment: 'other' };
  const result = evaluateCleanupStaged({
    authorizedDestination: DESTINATION,
    candidateDestination: other,
    priorDisposition: null,
  });
  assert.equal(result.verdict, 'refuse');
});

test('evaluateCleanupStaged refuses while a prior mutation is unresolved-ambiguous', () => {
  const result = evaluateCleanupStaged({
    authorizedDestination: DESTINATION,
    candidateDestination: DESTINATION,
    priorDisposition: 'unknown-reconciling',
  });
  assert.equal(result.verdict, 'refuse');
  assert.ok(
    result.findings.some((f) => f.code === 'UNKNOWN_RECONCILING_RETRY_BLOCKED'),
  );
});

test('evaluateRollback proceeds when the destination is owned and no retention findings exist', () => {
  const result = evaluateRollback({
    authorizedDestination: DESTINATION,
    candidateDestination: DESTINATION,
    retainedFindings: [],
    retainedRecord: null,
    rebuiltArtifact: null,
  });
  assert.equal(result.verdict, 'proceed');
});

test('evaluateRollback refuses when the generation is not retained', () => {
  const notRetained = [
    kernelFinding(
      'ROLLBACK_GENERATION_NOT_RETAINED',
      'TARGET_CONSTRAINT_ERROR',
      'x',
      'y',
    ),
  ];
  const result = evaluateRollback({
    authorizedDestination: DESTINATION,
    candidateDestination: DESTINATION,
    retainedFindings: notRetained,
    retainedRecord: null,
    rebuiltArtifact: null,
  });
  assert.equal(result.verdict, 'refuse');
});

test('evaluateRollback refuses when the rebuilt bytes disagree with the retained digest', () => {
  const retainedRecord = {
    generationId: '019c0000-0000-7000-8000-000000000005',
    artifactDigest: `sha256:${'c'.repeat(64)}`,
    certifiedAt: '2026-01-01T00:00:00Z',
  };
  const result = evaluateRollback({
    authorizedDestination: DESTINATION,
    candidateDestination: DESTINATION,
    retainedFindings: [],
    retainedRecord,
    rebuiltArtifact: ARTIFACT,
  });
  assert.equal(result.verdict, 'refuse');
  assert.ok(
    result.findings.some((f) => f.code === 'ARTIFACT_MUTATED_AFTER_FREEZE'),
  );
});
