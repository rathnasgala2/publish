import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkBoundedResources } from '../src/index.js';
import { first } from './helpers.js';

const LIMITS = Object.freeze({
  maximumFiles: '1000',
  maximumArtifactBytes: '1000000',
  maximumPathBytes: 512,
});

test('within every bound produces no findings', () => {
  const findings = checkBoundedResources(
    {
      artifactFileCount: 999,
      artifactByteCount: 999999,
      longestPathBytes: 511,
    },
    LIMITS,
  );
  assert.deepEqual(findings, []);
});

test('exact boundary is admitted, not rejected', () => {
  const findings = checkBoundedResources(
    {
      artifactFileCount: 1000,
      artifactByteCount: 1000000,
      longestPathBytes: 512,
    },
    LIMITS,
  );
  assert.deepEqual(findings, []);
});

test('one over the file-count bound is rejected', () => {
  const findings = checkBoundedResources(
    { artifactFileCount: 1001, artifactByteCount: 0, longestPathBytes: 0 },
    LIMITS,
  );
  assert.equal(findings.length, 1);
  assert.equal(first(findings).code, 'ARTIFACT_FILE_COUNT_EXCEEDED');
  assert.equal(first(findings).severity, 'TARGET_CONSTRAINT_ERROR');
});

test('one over the byte-count bound is rejected', () => {
  const findings = checkBoundedResources(
    { artifactFileCount: 0, artifactByteCount: 1000001, longestPathBytes: 0 },
    LIMITS,
  );
  assert.equal(findings.length, 1);
  assert.equal(first(findings).code, 'ARTIFACT_BYTE_COUNT_EXCEEDED');
});

test('one over the path-length bound is rejected', () => {
  const findings = checkBoundedResources(
    { artifactFileCount: 0, artifactByteCount: 0, longestPathBytes: 513 },
    LIMITS,
  );
  assert.equal(findings.length, 1);
  assert.equal(first(findings).code, 'ARTIFACT_PATH_LENGTH_EXCEEDED');
});

test('every bound can be exceeded simultaneously, one finding each', () => {
  const findings = checkBoundedResources(
    {
      artifactFileCount: 1001,
      artifactByteCount: 1000001,
      longestPathBytes: 513,
    },
    LIMITS,
  );
  assert.equal(findings.length, 3);
});

test('a negative counted total is rejected regardless of the bound', () => {
  const findings = checkBoundedResources(
    { artifactFileCount: -1, artifactByteCount: 0, longestPathBytes: 0 },
    LIMITS,
  );
  assert.ok(
    findings.some((f) => f.code === 'ARTIFACT_RESOURCE_TOTAL_NEGATIVE'),
  );
});

test('uses BigInt-safe comparison beyond Number.MAX_SAFE_INTEGER', () => {
  const bigLimits = {
    maximumFiles: '1',
    maximumArtifactBytes: '9007199254740993',
    maximumPathBytes: 1,
  };
  const findings = checkBoundedResources(
    {
      artifactFileCount: 1,
      artifactByteCount: '9007199254740993',
      longestPathBytes: 1,
    },
    bigLimits,
  );
  assert.deepEqual(findings, []);
  const overFindings = checkBoundedResources(
    {
      artifactFileCount: 1,
      artifactByteCount: '9007199254740994',
      longestPathBytes: 1,
    },
    bigLimits,
  );
  assert.equal(overFindings.length, 1);
  assert.equal(first(overFindings).code, 'ARTIFACT_BYTE_COUNT_EXCEEDED');
});

test('property: totals at limit+delta reject iff delta > 0, across many deltas', () => {
  for (let delta = -3; delta <= 3; delta += 1) {
    const findings = checkBoundedResources(
      {
        artifactFileCount: 100 + delta,
        artifactByteCount: 0,
        longestPathBytes: 0,
      },
      { maximumFiles: '100', maximumArtifactBytes: '0', maximumPathBytes: 0 },
    );
    const rejected = findings.some(
      (f) => f.code === 'ARTIFACT_FILE_COUNT_EXCEEDED',
    );
    assert.equal(rejected, delta > 0, `delta ${delta}`);
  }
});
