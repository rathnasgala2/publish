/**
 * PUB-H4 regression: `check-declarations.mjs` existed, passed, and was
 * wired into no workflow or gate -- so a renamed export shipped a stale
 * `.d.ts` with nothing to notice. This asserts (1) the root `verify`
 * script actually runs `declarations:check`, (2) every workspace package
 * defines the `declarations:check` script so `--workspaces --if-present`
 * has something to run, and (3) none of the five previously
 * hand-written `.d.ts` files (the ones the review found unchecked)
 * remain -- they were migrated to a generated `types/` tree that
 * `check-declarations.mjs` does cover.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

test('the root verify script runs declarations:check', async () => {
  const rootManifest = JSON.parse(await readFile('package.json', 'utf8'));
  assert.match(
    rootManifest.scripts.verify,
    /\bdeclarations:check\b/u,
    'package.json "verify" must run "declarations:check"',
  );
  assert.ok(
    rootManifest.scripts['declarations:check'],
    'package.json must define a root declarations:check script',
  );
});

test('every workspace package defines declarations:check and declarations:generate', async () => {
  const packageDirs = (await readdir('packages')).sort();
  for (const dir of packageDirs) {
    const manifest = JSON.parse(
      await readFile(`packages/${dir}/package.json`, 'utf8'),
    );
    assert.ok(
      manifest.scripts?.['declarations:check'],
      `packages/${dir}/package.json must define declarations:check`,
    );
    assert.ok(
      manifest.scripts?.['declarations:generate'],
      `packages/${dir}/package.json must define declarations:generate`,
    );
  }
});

test('no package ships a hand-written src/index.d.ts as its published types entry', async () => {
  const packageDirs = (await readdir('packages')).sort();
  for (const dir of packageDirs) {
    const handWritten = `packages/${dir}/src/index.d.ts`;
    assert.ok(
      !existsSync(handWritten),
      `${handWritten} must not exist -- declarations must come from the generated types/ tree that declarations:check covers`,
    );
  }
});
