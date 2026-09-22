import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_MAXIMUM_PRIOR_GENERATIONS,
  retainCertifiedDigest,
  selectRetainedGeneration,
} from '../src/index.js';
import { first } from './helpers.js';

/**
 * @param {number} i
 * @returns {{generationId: string, artifactDigest: string, certifiedAt: string}}
 */
function record(i) {
  return {
    generationId: `019c0000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    artifactDigest: `sha256:${i}`,
    certifiedAt: `2026-01-01T00:00:0${i}Z`,
  };
}

test('DEFAULT_MAXIMUM_PRIOR_GENERATIONS is exactly five', () => {
  assert.equal(DEFAULT_MAXIMUM_PRIOR_GENERATIONS, 5);
});

test('retainCertifiedDigest inserts the new record at the head', () => {
  const history = retainCertifiedDigest([], record(0));
  assert.deepEqual(history, [record(0)]);
});

test('retainCertifiedDigest caps history at active plus five priors by default', () => {
  /** @type {readonly ReturnType<typeof record>[]} */
  let history = [];
  for (let i = 0; i < 10; i += 1) {
    history = retainCertifiedDigest(history, record(i));
  }
  assert.equal(history.length, 6);
  assert.deepEqual(history.at(0), record(9));
  assert.deepEqual(history.at(5), record(4));
});

test('retainCertifiedDigest honours a caller-supplied cap', () => {
  /** @type {readonly ReturnType<typeof record>[]} */
  let history = [];
  for (let i = 0; i < 5; i += 1) {
    history = retainCertifiedDigest(history, record(i), {
      maximumPriorGenerations: 1,
    });
  }
  assert.equal(history.length, 2);
  assert.deepEqual(history, [record(4), record(3)]);
});

test('retainCertifiedDigest de-duplicates a re-certified generationId, promoting it to the head', () => {
  /** @type {readonly ReturnType<typeof record>[]} */
  let history = [record(0), record(1)];
  history = retainCertifiedDigest(history, record(0));
  assert.equal(history.length, 2);
  assert.deepEqual(history.at(0), record(0));
  assert.deepEqual(history.at(1), record(1));
});

test('selectRetainedGeneration finds a present generation', () => {
  const history = [record(0), record(1)];
  const result = selectRetainedGeneration(history, record(1).generationId);
  assert.deepEqual(result.record, record(1));
  assert.deepEqual(result.findings, []);
});

test('selectRetainedGeneration refuses a generation not in the retained history', () => {
  const result = selectRetainedGeneration([record(0)], record(9).generationId);
  assert.equal(result.record, null);
  assert.equal(first(result.findings).code, 'ROLLBACK_GENERATION_NOT_RETAINED');
  assert.equal(first(result.findings).severity, 'TARGET_CONSTRAINT_ERROR');
});

test('property: history length never exceeds cap+1 after any number of insertions', () => {
  /** @type {readonly ReturnType<typeof record>[]} */
  let history = [];
  for (let i = 0; i < 50; i += 1) {
    history = retainCertifiedDigest(history, record(i));
    assert.ok(history.length <= DEFAULT_MAXIMUM_PRIOR_GENERATIONS + 1);
  }
});
