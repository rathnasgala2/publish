import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isFilesystemProviderLimits,
  isHttpProviderLimits,
} from '../src/limits.js';

test('isFilesystemProviderLimits recognizes the filesystem branch', () => {
  assert.equal(isFilesystemProviderLimits({ transport: 'filesystem' }), true);
  assert.equal(isFilesystemProviderLimits({ transport: 'http' }), false);
});

test('isHttpProviderLimits recognizes the http branch', () => {
  assert.equal(isHttpProviderLimits({ transport: 'http' }), true);
  assert.equal(isHttpProviderLimits({ transport: 'filesystem' }), false);
});

test('both discriminators reject non-object values', () => {
  for (const value of [null, undefined, 'string', 42, []]) {
    assert.equal(isFilesystemProviderLimits(value), false);
    assert.equal(isHttpProviderLimits(value), false);
  }
});

test('the two branches never both match the same value', () => {
  for (const transport of ['filesystem', 'http', 'something-else']) {
    const value = { transport };
    assert.equal(
      isFilesystemProviderLimits(value) && isHttpProviderLimits(value),
      false,
    );
  }
});
