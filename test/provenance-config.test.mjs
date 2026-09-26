/**
 * PUB-C4 regression for `scripts/check-provenance-config.mjs`. Feeds
 * `provenanceDiagnostics` a manifest missing `publishConfig.provenance`
 * and asserts it is reported, then runs it against the real repository
 * state.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

import { provenanceDiagnostics } from '../scripts/check-provenance-config.mjs';

test('a manifest with no publishConfig is reported', () => {
  const diagnostics = provenanceDiagnostics(
    'packages/example/package.json',
    {},
  );
  assert.equal(diagnostics.length, 1);
  const [diagnostic] = diagnostics;
  assert.ok(diagnostic);
  assert.match(diagnostic, /publishConfig\.provenance must be true/u);
});

test('a manifest with publishConfig.provenance: false is reported', () => {
  const diagnostics = provenanceDiagnostics('packages/example/package.json', {
    publishConfig: { access: 'public', provenance: false },
  });
  assert.equal(diagnostics.length, 1);
});

test('a manifest with publishConfig.provenance: true is accepted', () => {
  const diagnostics = provenanceDiagnostics('packages/example/package.json', {
    publishConfig: { access: 'public', provenance: true },
  });
  assert.deepEqual(diagnostics, []);
});

test('every real package manifest sets publishConfig.provenance: true', async () => {
  const packageDirs = (await readdir('packages')).sort();
  /** @type {string[]} */
  const diagnostics = [];
  for (const dir of packageDirs) {
    const manifestPath = `packages/${dir}/package.json`;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    diagnostics.push(...provenanceDiagnostics(manifestPath, manifest));
  }
  assert.deepEqual(diagnostics, []);
});
