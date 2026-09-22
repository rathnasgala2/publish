/**
 * Unit tests for `workspace-siblings.js` (FOLLOW-UP SUPPLY-CHAIN-JS,
 * 2026-09-17): the `WORKSPACE_ROOT` override, the fixed relative default
 * it falls back to, and the clear `WorkspaceSiblingNotFoundError` message.
 *
 * @module
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  resolveWorkspaceRoot,
  resolveWorkspaceSibling,
  WorkspaceSiblingNotFoundError,
} from '../src/workspace-siblings.js';

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

test('WorkspaceSiblingNotFoundError: names WORKSPACE_ROOT in its message', () => {
  const error = new WorkspaceSiblingNotFoundError('template', '/nope/template');
  assert.equal(error.name, 'WorkspaceSiblingNotFoundError');
  assert.equal(error.siblingName, 'template');
  assert.equal(error.searchedDirectory, '/nope/template');
  assert.match(error.message, /WORKSPACE_ROOT/);
  assert.match(error.message, /\/nope\/template/);
});
