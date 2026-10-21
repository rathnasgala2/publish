/**
 * Unit tests for `workspace-siblings.js` (FOLLOW-UP SUPPLY-CHAIN-JS,
 * 2026-09-17): the `WORKSPACE_ROOT` override, the fixed relative default
 * it falls back to, and the clear `WorkspaceSiblingNotFoundError` message.
 *
 * @module
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

import {
  resolveWorkspaceRoot,
  resolveWorkspaceSibling,
  WorkspaceRootInvalidError,
  WorkspaceSiblingNotFoundError,
} from '../src/workspace-siblings.js';

const WORKSPACE_SIBLINGS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/workspace-siblings.js',
);

// `workspace-siblings.js` lives at `packages/publish-action/src/`, so its
// fixed relative default resolves `../../../../` from there, i.e. this
// repository's own parent directory (the workspace's `v2/`).
const EXPECTED_DEFAULT_WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../',
);

test('resolveWorkspaceRoot: falls back to the fixed relative default when WORKSPACE_ROOT is unset', () => {
  assert.equal(resolveWorkspaceRoot({}), EXPECTED_DEFAULT_WORKSPACE_ROOT);
});

test('resolveWorkspaceRoot: falls back to the fixed relative default when WORKSPACE_ROOT is empty', () => {
  assert.equal(
    resolveWorkspaceRoot({ WORKSPACE_ROOT: '' }),
    EXPECTED_DEFAULT_WORKSPACE_ROOT,
  );
});

test('resolveWorkspaceRoot: WORKSPACE_ROOT overrides the default when set', () => {
  assert.equal(
    resolveWorkspaceRoot({ WORKSPACE_ROOT: '/tmp/some-workspace' }),
    path.resolve('/tmp/some-workspace'),
  );
});

test('resolveWorkspaceRoot: defaults to process.env when no env is passed', () => {
  const previous = process.env.WORKSPACE_ROOT;
  try {
    delete process.env.WORKSPACE_ROOT;
    assert.equal(resolveWorkspaceRoot(), EXPECTED_DEFAULT_WORKSPACE_ROOT);
    process.env.WORKSPACE_ROOT = '/tmp/from-process-env';
    assert.equal(resolveWorkspaceRoot(), path.resolve('/tmp/from-process-env'));
  } finally {
    if (previous === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = previous;
    }
  }
});

test('resolveWorkspaceSibling: joins the resolved workspace root with the sibling name (default)', () => {
  assert.equal(
    resolveWorkspaceSibling('theme-default', {}),
    path.join(EXPECTED_DEFAULT_WORKSPACE_ROOT, 'theme-default'),
  );
});

test('resolveWorkspaceSibling: joins the resolved workspace root with the sibling name (WORKSPACE_ROOT override)', () => {
  assert.equal(
    resolveWorkspaceSibling('template', {
      WORKSPACE_ROOT: '/tmp/some-workspace',
    }),
    path.join(path.resolve('/tmp/some-workspace'), 'template'),
  );
});

test('resolveWorkspaceRoot: refuses a relative WORKSPACE_ROOT', () => {
  assert.throws(
    () => resolveWorkspaceRoot({ WORKSPACE_ROOT: 'relative/path' }),
    (/** @type {any} */ error) => {
      assert.ok(error instanceof WorkspaceRootInvalidError);
      assert.equal(error.code, 'WORKSPACE_ROOT_INVALID');
      assert.match(error.message, /absolute/);
      return true;
    },
  );
});

test('resolveWorkspaceRoot: refuses the relative default when running from inside a node_modules tree (PUB-H8)', async () => {
  // Copy workspace-siblings.js to a path that mimics an installed
  // dependency (`.../node_modules/@rathnasgala2/publish-action/src/`) and
  // exercise it from a fresh child process, so the module's own
  // `import.meta.url` genuinely resolves to a node_modules path -- this is
  // exactly the shape PUB-H8 found exploitable (the relative default
  // reaching outside the consumer's project).
  const tmp = await mkdtemp(path.join(tmpdir(), 'gala-workspace-siblings-'));
  try {
    const installedDir = path.join(
      tmp,
      'consumer-project',
      'node_modules',
      '@rathnasgala2',
      'publish-action',
      'src',
    );
    await mkdir(installedDir, { recursive: true });
    const installedPath = path.join(installedDir, 'workspace-siblings.js');
    await cp(WORKSPACE_SIBLINGS_PATH, installedPath);

    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          import { resolveWorkspaceRoot } from ${JSON.stringify(pathToFileURL(installedPath).href)};
          try {
            resolveWorkspaceRoot({});
            console.log('DID_NOT_THROW');
          } catch (error) {
            console.log(error.name + ':' + error.code);
          }
        `,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(
      output.trim(),
      'WorkspaceRootInvalidError:WORKSPACE_ROOT_INVALID',
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('WorkspaceSiblingNotFoundError: names WORKSPACE_ROOT in its message', () => {
  const error = new WorkspaceSiblingNotFoundError('template', '/nope/template');
  assert.equal(error.name, 'WorkspaceSiblingNotFoundError');
  assert.equal(error.siblingName, 'template');
  assert.equal(error.searchedDirectory, '/nope/template');
  assert.match(error.message, /WORKSPACE_ROOT/);
  assert.match(error.message, /\/nope\/template/);
});
