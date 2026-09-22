import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FINDING_SEVERITIES,
  KernelError,
  assertNoBlockingFinding,
  hasBlockingFinding,
  kernelFinding,
} from '../src/index.js';

test('kernelFinding builds a fully typed finding with recovery and overridable defaults', () => {
  const finding = kernelFinding('CODE_1', 'WARNING', 'detail text', 'do this');
  assert.equal(finding.code, 'CODE_1');
  assert.equal(finding.severity, 'WARNING');
  assert.equal(finding.detail, 'detail text');
  assert.equal(finding.recovery, 'do this');
  assert.equal(finding.overridable, false);
  assert.equal('location' in finding, false);
  assert.equal('evidence' in finding, false);
  assert.throws(() => {
    /** @type {Record<string, unknown>} */ (finding).overridable = true;
  });
});

test('kernelFinding carries optional location, evidence and overridable', () => {
  const finding = kernelFinding('CODE_2', 'ADVISORY', 'detail', 'recovery', {
    location: '/a/b',
    evidence: { x: 1 },
    overridable: true,
  });
  assert.equal(finding.location, '/a/b');
  assert.deepEqual(finding.evidence, { x: 1 });
  assert.equal(finding.overridable, true);
});

test('kernelFinding rejects an unknown severity', () => {
  assert.throws(() =>
    kernelFinding('CODE_3', /** @type {never} */ ('NOT_A_SEVERITY'), 'd', 'r'),
  );
});

test('FINDING_SEVERITIES is the exact closed five-member vocabulary', () => {
  assert.deepEqual(
    [...FINDING_SEVERITIES].sort(),
    [
      'ADVISORY',
      'ARTIFACT_SAFETY_ERROR',
      'SOURCE_ERROR',
      'TARGET_CONSTRAINT_ERROR',
      'WARNING',
    ].sort(),
  );
});

test('hasBlockingFinding is true for SOURCE_ERROR, ARTIFACT_SAFETY_ERROR and TARGET_CONSTRAINT_ERROR only', () => {
  for (const severity of [
    'SOURCE_ERROR',
    'ARTIFACT_SAFETY_ERROR',
    'TARGET_CONSTRAINT_ERROR',
  ]) {
    assert.equal(
      hasBlockingFinding([
        kernelFinding('C', /** @type {never} */ (severity), 'd', 'r'),
      ]),
      true,
    );
  }
  for (const severity of ['WARNING', 'ADVISORY']) {
    assert.equal(
      hasBlockingFinding([
        kernelFinding('C', /** @type {never} */ (severity), 'd', 'r'),
      ]),
      false,
    );
  }
  assert.equal(hasBlockingFinding([]), false);
});

test('assertNoBlockingFinding passes non-blocking findings through unchanged', () => {
  const findings = [kernelFinding('C', 'ADVISORY', 'd', 'r')];
  assert.equal(assertNoBlockingFinding('msg', findings), findings);
});

test('assertNoBlockingFinding throws KernelError carrying every finding on a blocking finding', () => {
  const findings = [kernelFinding('C', 'SOURCE_ERROR', 'd', 'r')];
  assert.throws(
    () => assertNoBlockingFinding('msg', findings),
    (error) => {
      assert.ok(error instanceof KernelError);
      assert.equal(error.name, 'KernelError');
      assert.equal(error.message, 'msg');
      assert.deepEqual(error.findings, findings);
      return true;
    },
  );
});
