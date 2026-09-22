/**
 * Unit tests for `template-bridge.js`'s `TEMPLATE_ROOT` resolution
 * (FOLLOW-UP SUPPLY-CHAIN-JS, 2026-09-17): the default relative sibling
 * checkout, the `WORKSPACE_ROOT` override, and the clear
 * `WorkspaceSiblingNotFoundError` when the resolved directory does not
 * exist. `TEMPLATE_ROOT` is computed once at module import time from
 * `process.env`, so the override is exercised in a fresh child process
 * rather than by mutating `process.env` after this module (or an earlier
 * test file importing it) has already loaded.
 *
 * @module
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const TEMPLATE_BRIDGE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/template-bridge.js',
);

const EXPECTED_DEFAULT_TEMPLATE_ROOT = path.resolve(
  path.dirname(TEMPLATE_BRIDGE_PATH),
  '../../../../template',
);

/**
 * @param {NodeJS.ProcessEnv} env extra environment variables for the child
 * @returns {string} the child process's trimmed stdout
 */
function runInChildProcess(env) {
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { TEMPLATE_ROOT } from ${JSON.stringify(pathToFileURLString(TEMPLATE_BRIDGE_PATH))}; process.stdout.write(TEMPLATE_ROOT);`,
    ],
    { env: { ...process.env, ...env }, encoding: 'utf8' },
  ).trim();
}

/**
 * @param {string} absolutePath an absolute filesystem path
 * @returns {string} its `file://` URL as a string
 */
function pathToFileURLString(absolutePath) {
  return new URL(`file://${absolutePath}`).href;
}

test('TEMPLATE_ROOT: falls back to the fixed relative sibling default when WORKSPACE_ROOT is unset', () => {
  const output = runInChildProcess({ WORKSPACE_ROOT: '' });
  assert.equal(output, EXPECTED_DEFAULT_TEMPLATE_ROOT);
});

test('TEMPLATE_ROOT: WORKSPACE_ROOT overrides the default to <WORKSPACE_ROOT>/template', async () => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), 'gala-workspace-root-'),
  );
  try {
    const output = runInChildProcess({ WORKSPACE_ROOT: workspaceRoot });
    assert.equal(output, path.join(workspaceRoot, 'template'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('importTemplatePublicEntry: fails closed with a WorkspaceSiblingNotFoundError naming WORKSPACE_ROOT when the resolved template directory does not exist', async () => {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), 'gala-workspace-root-'),
  );
  try {
    // An empty workspace root: <workspaceRoot>/template does not exist.
    const script = [
      `import { importTemplatePublicEntry } from ${JSON.stringify(pathToFileURLString(TEMPLATE_BRIDGE_PATH))};`,
      'try {',
      '  await importTemplatePublicEntry();',
      "  process.stdout.write('NO_ERROR_THROWN');",
      '} catch (error) {',
      '  process.stdout.write(`${error.name}:${error.message}`);',
      '}',
    ].join('\n');
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        env: { ...process.env, WORKSPACE_ROOT: workspaceRoot },
        encoding: 'utf8',
      },
    ).trim();
    assert.match(output, /^WorkspaceSiblingNotFoundError:/);
    assert.match(output, /WORKSPACE_ROOT/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
