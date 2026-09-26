/**
 * PUB-H2 regression for `scripts/check-changelog-versions.mjs`. Feeds
 * `changelogDiagnostics` a CHANGELOG whose current version has no heading
 * and asserts it is reported, then runs it against the real repository
 * state.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

import { changelogDiagnostics } from '../scripts/check-changelog-versions.mjs';

test('a published version with no matching heading is reported', () => {
  // A released heading for a prior version exists, so this is not the
  // "never published" exemption -- the current version must have its own
  // heading and does not.
  const changelog =
    '## [Unreleased]\n\n- something planned\n\n## [0.1.0] - 2026-09-01\n\n- prior release\n';
  const diagnostics = changelogDiagnostics(
    'packages/example/CHANGELOG.md',
    changelog,
    '0.2.0',
  );
  assert.equal(diagnostics.length, 1);
  const [diagnostic] = diagnostics;
  assert.ok(diagnostic);
  assert.match(diagnostic, /no "## \[0\.2\.0\]" heading/u);
});

test('a version with a matching heading is accepted', () => {
  const changelog = '## [Unreleased]\n\n## [0.2.0] - 2026-09-22\n\n- shipped\n';
  assert.deepEqual(
    changelogDiagnostics('packages/example/CHANGELOG.md', changelog, '0.2.0'),
    [],
  );
});

test('a never-published package (only Unreleased) is exempt', () => {
  const changelog = '## [Unreleased]\n\n- nothing shipped yet\n';
  assert.deepEqual(
    changelogDiagnostics('packages/example/CHANGELOG.md', changelog, '0.1.0'),
    [],
  );
});

test('every real package CHANGELOG has a heading for its current version', async () => {
  const packageDirs = (await readdir('packages')).sort();
  /** @type {string[]} */
  const diagnostics = [];
  for (const dir of packageDirs) {
    const manifest = JSON.parse(
      await readFile(`packages/${dir}/package.json`, 'utf8'),
    );
    const changelogPath = `packages/${dir}/CHANGELOG.md`;
    const changelog = await readFile(changelogPath, 'utf8');
    diagnostics.push(
      ...changelogDiagnostics(changelogPath, changelog, manifest.version),
    );
  }
  assert.deepEqual(diagnostics, []);
});
