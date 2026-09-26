/**
 * PUB-M14: `currentPlatformTuple()` (fs-safety.js) reads `os.platform()`
 * and `os.arch()` directly, so before this file the test suite only ever
 * exercised whichever one branch the *host running the tests* happens to
 * be: `node --test` on a CI ubuntu-24.04 runner (linux/x64) covers a
 * different pair of branches than the same suite on a darwin/arm64
 * developer laptop, and neither host ever reaches the two "unsupported"
 * throw branches at all. That made this function's branch coverage
 * host-dependent: PUB-M9 calibrated the package's coverage floor from a
 * run on a darwin/aarch64 laptop (branch 68.73%) and CI's ubuntu-24.04
 * (linux/x86_64) runner then measured 68.38% on the identical commit,
 * failing `coverage:check` even though nothing in the package had
 * changed. This file mocks `os.platform`/`os.arch` so every branch —
 * both admitted operating systems, both admitted architectures, and both
 * "not admitted" throws — runs deterministically on every host, closing
 * the gap at its root instead of lowering the floor to paper over it.
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';

import {
  currentPlatformTuple,
  LocalFilesystemSafetyError,
} from '../src/fs-safety.js';

test('currentPlatformTuple: admits linux/x64 as {os: linux, architecture: x86_64}', (t) => {
  t.mock.method(os, 'platform', () => 'linux');
  t.mock.method(os, 'arch', () => 'x64');
  assert.deepEqual(currentPlatformTuple(), {
    os: 'linux',
    architecture: 'x86_64',
  });
});

test('currentPlatformTuple: admits darwin/arm64 as {os: darwin, architecture: aarch64}', (t) => {
  t.mock.method(os, 'platform', () => 'darwin');
  t.mock.method(os, 'arch', () => 'arm64');
  assert.deepEqual(currentPlatformTuple(), {
    os: 'darwin',
    architecture: 'aarch64',
  });
});

test('currentPlatformTuple: refuses a platform that is neither linux nor darwin', (t) => {
  t.mock.method(os, 'platform', () => 'win32');
  t.mock.method(os, 'arch', () => 'x64');
  assert.throws(
    () => currentPlatformTuple(),
    (error) =>
      error instanceof LocalFilesystemSafetyError &&
      error.code === 'ATOMIC_ACTIVATION_UNSUPPORTED' &&
      /win32/u.test(error.message),
  );
});

test('currentPlatformTuple: refuses an architecture that is neither x64/arm64-mapped nor already x86_64/aarch64', (t) => {
  t.mock.method(os, 'platform', () => 'linux');
  t.mock.method(os, 'arch', () => 'ia32');
  assert.throws(
    () => currentPlatformTuple(),
    (error) =>
      error instanceof LocalFilesystemSafetyError &&
      error.code === 'ATOMIC_ACTIVATION_UNSUPPORTED' &&
      /ia32/u.test(error.message),
  );
});
