/**
 * PUB-C1 regression for `scripts/check-license-files.mjs`. Feeds
 * `missingLicenseDiagnostics` a packed-file list without LICENSE and
 * asserts it is reported, then runs the real `npm pack --dry-run`
 * inspection against every workspace package.
 */

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';

import {
  missingLicenseDiagnostics,
  packedFiles,
} from '../scripts/check-license-files.mjs';

test('a tarball file list without LICENSE is reported', () => {
  const diagnostics = missingLicenseDiagnostics('example', [
    'package.json',
    'src/index.js',
  ]);
  assert.equal(diagnostics.length, 1);
  const [diagnostic] = diagnostics;
  assert.ok(diagnostic);
  assert.match(diagnostic, /would not include LICENSE/u);
});

test('a tarball file list with LICENSE is accepted', () => {
  assert.deepEqual(
    missingLicenseDiagnostics('example', ['package.json', 'LICENSE']),
    [],
  );
});

test('npm pack --dry-run actually includes LICENSE for every workspace package', async () => {
  const packageNames = (await readdir('packages')).sort();
  /** @type {string[]} */
  const diagnostics = [];
  for (const name of packageNames) {
    const files = await packedFiles(name);
    diagnostics.push(...missingLicenseDiagnostics(name, files));
  }
  assert.deepEqual(diagnostics, []);
});
