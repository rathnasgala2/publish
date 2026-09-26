/**
 * PUB-C3, PUB-H5 regression: `release.yaml` used to run the sibling
 * checkouts, the foreign `npm ci` against them, `npm run verify` and
 * `npm publish --provenance` all in one job holding the npm OIDC
 * credential -- and all three workflows checked out the two sibling
 * repositories at a mutable `ref: main`, so a push to either sibling
 * changed what this repository tested or released with no commit here.
 *
 * These tests assert the fixed shape directly from the committed YAML, so
 * a regression (an untrusted-input step reappearing in the credentialed
 * job, or a sibling ref drifting back to a branch name) fails here instead
 * of only being caught by re-reading the workflow by eye.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;

const RELEASE_PATH = '.github/workflows/release.yaml';
const CI_PATH = '.github/workflows/ci.yml';
const NIGHTLY_PATH = '.github/workflows/nightly.yml';

/**
 * @param {string} file workflow path
 * @returns {{source: string, doc: Record<string, unknown>}} parsed workflow
 */
function loadWorkflow(file) {
  const source = readFileSync(file, 'utf8');
  return { source, doc: parse(source) };
}

/**
 * @param {Record<string, unknown>} doc parsed workflow document
 * @returns {{ref: string, repository: string | undefined}[]}
 *   every `actions/checkout` step's `repository`/`ref` inputs, across every
 *   job
 */
function checkoutSteps(doc) {
  /** @type {{ref: string, repository: string | undefined}[]} */
  const out = [];
  const jobs = /** @type {Record<string, {steps?: unknown[]}>} */ (
    doc.jobs ?? {}
  );
  for (const job of Object.values(jobs)) {
    for (const step of /** @type {Record<string, unknown>[]} */ (
      job.steps ?? []
    )) {
      const uses = /** @type {string | undefined} */ (step.uses);
      if (typeof uses === 'string' && uses.startsWith('actions/checkout@')) {
        const withBlock = /** @type {Record<string, unknown>} */ (
          step.with ?? {}
        );
        if (typeof withBlock.repository === 'string') {
          out.push({
            repository: withBlock.repository,
            ref: /** @type {string} */ (withBlock.ref),
          });
        }
      }
    }
  }
  return out;
}

for (const file of [RELEASE_PATH, CI_PATH, NIGHTLY_PATH]) {
  test(`${file}: every sibling repository checkout is pinned to a 40-hex commit SHA`, () => {
    const { doc } = loadWorkflow(file);
    const siblings = checkoutSteps(doc);
    const siblingRepos = siblings.filter(
      (s) =>
        s.repository === 'rathnasgala2/template' ||
        s.repository === 'rathnasgala2/theme-default',
    );
    assert.ok(
      siblingRepos.length >= 2,
      `${file} must check out both rathnasgala2/template and rathnasgala2/theme-default`,
    );
    for (const sibling of siblingRepos) {
      assert.match(
        sibling.ref,
        FULL_COMMIT_SHA,
        `${file}: ${sibling.repository} must be pinned to a 40-hex commit SHA, not ${JSON.stringify(sibling.ref)}`,
      );
      assert.notEqual(
        sibling.ref,
        'main',
        `${file}: ${sibling.repository} must not be pinned to the mutable "main" branch`,
      );
    }
  });
}

test('release.yaml: the push path filter covers everything verify runs, not only packages/ (PUB-L8)', () => {
  const { doc } = loadWorkflow(RELEASE_PATH);
  const on = /** @type {{push?: {paths?: readonly string[]}}} */ (doc.on);
  const paths = on.push?.paths ?? [];
  for (const expected of [
    'packages/**',
    'package.json',
    'package-lock.json',
    'scripts/**',
    'pins/**',
    '.github/workflows/release.yaml',
  ]) {
    assert.ok(
      paths.includes(expected),
      `release.yaml's push.paths must include ${JSON.stringify(expected)}`,
    );
  }
});

test('release.yaml: the publish job needs the verify job', () => {
  const { doc } = loadWorkflow(RELEASE_PATH);
  const jobs = /** @type {Record<string, {needs?: unknown}>} */ (doc.jobs);
  assert.ok(jobs.verify, 'release.yaml must define a verify job');
  assert.ok(jobs.publish, 'release.yaml must define a publish job');
  assert.equal(
    jobs.publish.needs,
    'verify',
    'the publish job must declare needs: verify',
  );
});

test('release.yaml: id-token: write appears only in the publish job', () => {
  const { doc } = loadWorkflow(RELEASE_PATH);
  const jobs =
    /** @type {Record<string, {permissions?: Record<string, string>}>} */ (
      doc.jobs
    );
  for (const [name, job] of Object.entries(jobs)) {
    const idToken = job.permissions?.['id-token'];
    if (name === 'publish') {
      assert.equal(
        idToken,
        'write',
        'the publish job must hold id-token: write',
      );
    } else {
      assert.notEqual(
        idToken,
        'write',
        `job "${name}" must not hold id-token: write -- only the publish job may mint an OIDC assertion`,
      );
    }
  }
  const workflowPermissions =
    /** @type {Record<string, string> | undefined} */ (doc.permissions);
  assert.notEqual(
    workflowPermissions?.['id-token'],
    'write',
    'the workflow-level permissions block must not itself grant id-token: write',
  );
});

test('release.yaml: the publish job has no sibling checkout and no foreign install', () => {
  const { doc } = loadWorkflow(RELEASE_PATH);
  const jobs =
    /** @type {Record<string, {steps?: Record<string, unknown>[]}>} */ (
      doc.jobs
    );
  const publishJob = jobs.publish;
  assert.ok(publishJob, 'release.yaml must define a publish job');
  const publishSteps = publishJob.steps ?? [];
  for (const step of publishSteps) {
    const uses = /** @type {string | undefined} */ (step.uses);
    if (typeof uses === 'string' && uses.startsWith('actions/checkout@')) {
      const withBlock = /** @type {Record<string, unknown> | undefined} */ (
        step.with
      );
      assert.equal(
        withBlock?.repository,
        undefined,
        'the publish job must only check out this repository, never a sibling',
      );
    }
    const run = /** @type {string | undefined} */ (step.run);
    const workingDirectory = /** @type {string | undefined} */ (
      step['working-directory']
    );
    if (typeof run === 'string' && run.includes('npm ci')) {
      assert.equal(
        workingDirectory,
        undefined,
        'the publish job must not install a foreign (sibling) working directory',
      );
    }
  }
});

test('release.yaml: the verify job holds no npm publish credential', () => {
  const { doc } = loadWorkflow(RELEASE_PATH);
  const jobs = /** @type {Record<string, {environment?: unknown}>} */ (
    doc.jobs
  );
  const verifyJob = jobs.verify;
  assert.ok(verifyJob, 'release.yaml must define a verify job');
  assert.equal(
    verifyJob.environment,
    undefined,
    'the verify job must not carry the npm publish environment',
  );
});

for (const file of [RELEASE_PATH, CI_PATH, NIGHTLY_PATH]) {
  test(`${file}: every foreign sibling install runs with --ignore-scripts`, () => {
    const { doc } = loadWorkflow(file);
    const jobs =
      /** @type {Record<string, {steps?: Record<string, unknown>[]}>} */ (
        doc.jobs
      );
    for (const job of Object.values(jobs)) {
      for (const step of job.steps ?? []) {
        const workingDirectory = /** @type {string | undefined} */ (
          step['working-directory']
        );
        const run = /** @type {string | undefined} */ (step.run);
        if (
          typeof workingDirectory === 'string' &&
          workingDirectory.startsWith('.siblings/') &&
          typeof run === 'string' &&
          run.includes('npm ci')
        ) {
          assert.match(
            run,
            /--ignore-scripts/u,
            `${file}: installing ${workingDirectory} must run npm ci --ignore-scripts (PUB-C3)`,
          );
        }
      }
    }
  });
}
