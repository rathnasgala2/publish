/**
 * PUB-H1, PUB-H3, PUB-H7 regression for `scripts/check-manifest-conformance.mjs`.
 * Feeds `checkOne` deliberately non-conforming manifests and asserts each
 * violation is reported, then runs it against the real repository state.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

import { checkOne } from '../scripts/check-manifest-conformance.mjs';

const GOOD_MANIFEST = {
  engines: { node: '>=24.0.0' },
  dependencies: { '@rathnasgala2/adapter-protocol': '^0.2.0' },
  repository: {
    type: 'git',
    url: 'git+https://github.com/rathnasgala2/publish.git',
    directory: 'packages/example',
  },
  homepage:
    'https://github.com/rathnasgala2/publish/tree/main/packages/example#readme',
  bugs: { url: 'https://github.com/rathnasgala2/publish/issues' },
  keywords: ['gala'],
};

const WORKSPACE_NAMES = new Set(['@rathnasgala2/adapter-protocol']);

test('checkOne accepts a fully conforming manifest', () => {
  assert.deepEqual(checkOne('example', GOOD_MANIFEST, WORKSPACE_NAMES), []);
});

test('checkOne rejects an exact engines.node pin (PUB-H1)', () => {
  const manifest = { ...GOOD_MANIFEST, engines: { node: '24.18.0' } };
  const diagnostics = checkOne('example', manifest, WORKSPACE_NAMES);
  assert.ok(
    diagnostics.some((d) => d.includes('engines.node must be a floor')),
    diagnostics.join('\n'),
  );
});

test('checkOne rejects engines.npm on a published package (PUB-H1)', () => {
  const manifest = {
    ...GOOD_MANIFEST,
    engines: { node: '>=24.0.0', npm: '11.16.0' },
  };
  const diagnostics = checkOne('example', manifest, WORKSPACE_NAMES);
  assert.ok(
    diagnostics.some((d) => d.includes('engines.npm must not be set')),
    diagnostics.join('\n'),
  );
});

test('checkOne rejects an exact in-workspace dependency range (PUB-H3)', () => {
  const manifest = {
    ...GOOD_MANIFEST,
    dependencies: { '@rathnasgala2/adapter-protocol': '0.2.0' },
  };
  const diagnostics = checkOne('example', manifest, WORKSPACE_NAMES);
  assert.ok(
    diagnostics.some((d) => d.includes('must be a caret range')),
    diagnostics.join('\n'),
  );
});

test('checkOne exempts @rathnasgala2/schemas from the caret-range rule', () => {
  const names = new Set([...WORKSPACE_NAMES, '@rathnasgala2/schemas']);
  const manifest = {
    ...GOOD_MANIFEST,
    dependencies: { '@rathnasgala2/schemas': '2.11.0' },
  };
  assert.deepEqual(checkOne('example', manifest, names), []);
});

test('checkOne rejects a missing keywords array (PUB-H7)', () => {
  const manifest = { ...GOOD_MANIFEST, keywords: [] };
  const diagnostics = checkOne('example', manifest, WORKSPACE_NAMES);
  assert.ok(
    diagnostics.some((d) => d.includes('keywords must be a non-empty array')),
    diagnostics.join('\n'),
  );
});

test('checkOne rejects a repository.directory mismatch (PUB-H7)', () => {
  const manifest = {
    ...GOOD_MANIFEST,
    repository: { ...GOOD_MANIFEST.repository, directory: 'packages/wrong' },
  };
  const diagnostics = checkOne('example', manifest, WORKSPACE_NAMES);
  assert.ok(
    diagnostics.some((d) => d.includes('repository must be')),
    diagnostics.join('\n'),
  );
});

test('checkOne rejects a missing homepage/bugs (PUB-H7)', () => {
  const manifest = { ...GOOD_MANIFEST, homepage: undefined, bugs: undefined };
  const diagnostics = checkOne('example', manifest, WORKSPACE_NAMES);
  assert.ok(diagnostics.some((d) => d.includes('homepage must be')));
  assert.ok(diagnostics.some((d) => d.includes('bugs.url must be')));
});

test('every real package manifest conforms today', async () => {
  const packageDirs = (await readdir('packages')).sort();
  const manifestsByDir = new Map();
  for (const dir of packageDirs) {
    manifestsByDir.set(
      dir,
      JSON.parse(await readFile(`packages/${dir}/package.json`, 'utf8')),
    );
  }
  const workspacePackageNames = new Set(
    [...manifestsByDir.values()].map((m) => m.name),
  );
  /** @type {string[]} */
  const diagnostics = [];
  for (const [dir, manifest] of manifestsByDir) {
    diagnostics.push(...checkOne(dir, manifest, workspacePackageNames));
  }
  assert.deepEqual(diagnostics, []);
});
