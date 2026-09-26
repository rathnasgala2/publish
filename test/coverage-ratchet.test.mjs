/**
 * PUB-M9 regression: `scripts/check-coverage.mjs`'s ratchet decision logic,
 * and a red-when-reverted proof that it actually fails when a package's
 * coverage genuinely drops -- not merely that its unit logic looks right in
 * isolation.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { meetsFloor, parseAllFilesRow } from '../scripts/check-coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parseAllFilesRow reads the "all files" summary row', () => {
  const output =
    'ℹ some-file.js | 90.00 | 80.00 | 70.00 |\n' +
    'ℹ all files | 91.23 | 85.67 | 60.00 |\n' +
    'ℹ end of coverage report\n';
  assert.deepEqual(parseAllFilesRow(output), { line: 91.23, branch: 85.67 });
});

test('parseAllFilesRow returns undefined when no summary row is present', () => {
  assert.equal(parseAllFilesRow('no coverage output here\n'), undefined);
});

test('meetsFloor passes exactly at the floor and within tolerance below it', () => {
  const floor = { line: 90, branch: 80 };
  assert.equal(meetsFloor({ line: 90, branch: 80 }, floor), true);
  assert.equal(meetsFloor({ line: 89.96, branch: 79.96 }, floor), true);
});

test('meetsFloor fails once a drop exceeds the tolerance', () => {
  const floor = { line: 90, branch: 80 };
  assert.equal(meetsFloor({ line: 89.9, branch: 80 }, floor), false);
  assert.equal(meetsFloor({ line: 90, branch: 79.9 }, floor), false);
});

test('red when reverted: excluding a real test file drops measured coverage below its recorded floor', () => {
  const packageDir = path.join(ROOT, 'packages', 'adapter-conformance-kit');
  const packageName = JSON.parse(
    readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
  ).name;
  const floor = JSON.parse(
    readFileSync(path.join(ROOT, 'coverage-thresholds.json'), 'utf8'),
  )[packageName];
  assert.ok(floor, `expected a recorded floor for ${packageName}`);

  const testFile = path.join(packageDir, 'test', 'index.test.js');
  const hidden = `${testFile}.hidden-for-test`;
  renameSync(testFile, hidden);
  try {
    // NODE_TEST_CONTEXT (set by the outer `node --test` running *this* file)
    // makes a nested `node --test` invocation detect "recursive run" and
    // skip running any files at all, per Node's own test-runner guard. Strip
    // it so the child actually runs, exactly as scripts/check-coverage.mjs's
    // own spawnSync would when invoked directly (never nested) by `npm run
    // coverage:check`.
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      ['--test', '--experimental-test-coverage'],
      { cwd: packageDir, encoding: 'utf8', env: childEnv },
    );
    const measured = parseAllFilesRow(
      `${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
    assert.ok(
      measured,
      'expected a parseable coverage summary even with a test file removed',
    );
    assert.equal(
      meetsFloor(
        /** @type {{line: number, branch: number}} */ (measured),
        floor,
      ),
      false,
      `removing test/index.test.js was expected to drop ${packageName} below its recorded floor (measured ${JSON.stringify(measured)}, floor ${JSON.stringify(floor)}); if it did not, the floor or the fixture no longer exercises this package's main coverage path`,
    );
  } finally {
    renameSync(hidden, testFile);
  }
});
