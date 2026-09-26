/**
 * PUB-M14: `buildProvenance` (normalize/provenance.js) branches on
 * `isRunningInActions(env)`, which reads the real `GITHUB_ACTIONS` /
 * `GITHUB_REPOSITORY` / `GITHUB_WORKFLOW_REF` / `GITHUB_WORKFLOW` /
 * `GITHUB_RUN_ID` / `GITHUB_RUN_ATTEMPT` variables when nothing overrides
 * `env`. Before this file, the only caller reaching `buildProvenance` was
 * `commands/build.js` through the full `runAction` pipeline with the
 * default `env = process.env` — so which side of every one of this
 * function's branches got covered depended on whether the *test suite
 * itself* happened to be running inside a real GitHub Actions job (where
 * the platform always sets these variables) or on a developer machine
 * (where none of them are set). That is a real, structural difference,
 * not incidental noise: `npm run coverage:check` measured a lower branch
 * percentage for `@rathnasgala2/publish-action` on CI than on a
 * WORKSPACE_ROOT-pinned local run of the identical commit, because CI's
 * real Actions environment and a local shell exercise disjoint halves of
 * this function's conditionals. This file exercises both the "real
 * Actions environment" and "local stand-in" arms directly, with an
 * explicit `env`, so coverage of this function no longer depends on
 * where the test suite happens to run.
 *
 * @module
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildProvenance } from '../src/normalize/provenance.js';
import {
  LOCAL_REPOSITORY_COORDINATE_STANDIN,
  LOCAL_WORKFLOW_IDENTITY_STANDIN,
} from '../src/normalize/local-standins.js';

/** @type {{package: string, version: string, integrity: string, registry: string}} */
const FAKE_THEME = Object.freeze({
  package: '@rathnasgala2/theme-default',
  version: '2.0.0',
  integrity: `sha256:${'a'.repeat(64)}`,
  registry: 'https://registry.npmjs.org',
});

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

test('buildProvenance: outside Actions, both coordinate and workflow identity are the local stand-ins', async () => {
  const provenance = await buildProvenance(FAKE_THEME, {
    GITHUB_ACTIONS: undefined,
    GITHUB_REPOSITORY: 'rathnasgala2/publish',
    GITHUB_WORKFLOW_REF:
      'rathnasgala2/publish/.github/workflows/ci.yml@refs/heads/main',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
  });
  assert.equal(
    provenance.repositoryCoordinate,
    LOCAL_REPOSITORY_COORDINATE_STANDIN,
  );
  const localWorkflowDigest = provenance.workflowIdentity;
  assert.match(localWorkflowDigest, DIGEST_PATTERN);

  const again = await buildProvenance(FAKE_THEME, { GITHUB_ACTIONS: 'false' });
  assert.equal(again.repositoryCoordinate, LOCAL_REPOSITORY_COORDINATE_STANDIN);
  assert.equal(
    again.workflowIdentity,
    localWorkflowDigest,
    'the local stand-in digests identically regardless of which unrelated GITHUB_* variables happen to be set',
  );
});

test('buildProvenance: inside Actions with every GitHub variable present, both facts come from the real environment', async () => {
  const provenance = await buildProvenance(FAKE_THEME, {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'rathnasgala2/publish',
    GITHUB_WORKFLOW_REF:
      'rathnasgala2/publish/.github/workflows/ci.yml@refs/heads/review/2026-09-25',
    GITHUB_WORKFLOW: 'CI',
    GITHUB_RUN_ID: '36246126230',
    GITHUB_RUN_ATTEMPT: '1',
  });
  assert.equal(provenance.repositoryCoordinate, 'rathnasgala2/publish');
  assert.match(provenance.workflowIdentity, DIGEST_PATTERN);
  assert.notEqual(provenance.workflowIdentity, LOCAL_WORKFLOW_IDENTITY_STANDIN);
});

test('buildProvenance: inside Actions but GITHUB_REPOSITORY absent falls back to the local coordinate stand-in', async () => {
  const provenance = await buildProvenance(FAKE_THEME, {
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKFLOW_REF:
      'rathnasgala2/publish/.github/workflows/ci.yml@refs/heads/main',
    GITHUB_RUN_ID: '1',
    GITHUB_RUN_ATTEMPT: '1',
  });
  assert.equal(
    provenance.repositoryCoordinate,
    LOCAL_REPOSITORY_COORDINATE_STANDIN,
  );
});

test('buildProvenance: inside Actions with GITHUB_WORKFLOW_REF absent falls back to GITHUB_WORKFLOW, then to "unknown-workflow"', async () => {
  const withWorkflowName = await buildProvenance(FAKE_THEME, {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'rathnasgala2/publish',
    GITHUB_WORKFLOW: 'CI',
    GITHUB_RUN_ID: '1',
    GITHUB_RUN_ATTEMPT: '1',
  });
  const withNeither = await buildProvenance(FAKE_THEME, {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'rathnasgala2/publish',
    GITHUB_RUN_ID: '1',
    GITHUB_RUN_ATTEMPT: '1',
  });
  assert.match(withWorkflowName.workflowIdentity, DIGEST_PATTERN);
  assert.match(withNeither.workflowIdentity, DIGEST_PATTERN);
  assert.notEqual(
    withWorkflowName.workflowIdentity,
    withNeither.workflowIdentity,
    'a different workflowIdentitySource must digest differently',
  );
});

test('buildProvenance: inside Actions with GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT absent falls back to "0"', async () => {
  const withRunFacts = await buildProvenance(FAKE_THEME, {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'rathnasgala2/publish',
    GITHUB_WORKFLOW_REF:
      'rathnasgala2/publish/.github/workflows/ci.yml@refs/heads/main',
    GITHUB_RUN_ID: '999',
    GITHUB_RUN_ATTEMPT: '2',
  });
  const withoutRunFacts = await buildProvenance(FAKE_THEME, {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'rathnasgala2/publish',
    GITHUB_WORKFLOW_REF:
      'rathnasgala2/publish/.github/workflows/ci.yml@refs/heads/main',
  });
  assert.match(withoutRunFacts.workflowIdentity, DIGEST_PATTERN);
  assert.notEqual(
    withRunFacts.workflowIdentity,
    withoutRunFacts.workflowIdentity,
  );
});
