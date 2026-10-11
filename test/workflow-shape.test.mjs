/**
 * Source-only delivery regression: CI, nightly and release verification use
 * the manifest-verified packages committed to this repository. They neither
 * check out mutable sibling repositories nor hold npm publication authority.
 *
 * These tests assert the fixed shape directly from the committed YAML, so
 * A regression fails here instead of only being caught by re-reading the
 * workflow by eye.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

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
  test(`${file}: no template or theme sibling repository is checked out`, () => {
    const { doc } = loadWorkflow(file);
    const siblings = checkoutSteps(doc);
    const siblingRepos = siblings.filter(
      (s) =>
        s.repository === 'rathnasgala2/template' ||
        s.repository === 'rathnasgala2/theme-default',
    );
    assert.deepEqual(siblingRepos, []);
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
    'vendor/**',
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

test('release.yaml: source-only delivery defines only an uncredentialed verify job', () => {
  const { doc } = loadWorkflow(RELEASE_PATH);
  const jobs =
    /** @type {Record<string, {environment?: unknown, permissions?: Record<string, string>, steps?: Record<string, unknown>[]}>} */ (
      doc.jobs
    );
  assert.ok(jobs.verify, 'release.yaml must define a verify job');
  assert.deepEqual(Object.keys(jobs), ['verify']);
  assert.equal(jobs.verify.environment, undefined);
  assert.notEqual(jobs.verify.permissions?.['id-token'], 'write');
  const workflowPermissions =
    /** @type {Record<string, string> | undefined} */ (doc.permissions);
  assert.notEqual(
    workflowPermissions?.['id-token'],
    'write',
    'source-only release verification must not mint npm OIDC assertions',
  );
  assert.ok(
    !(jobs.verify.steps ?? []).some(
      (step) =>
        typeof step.run === 'string' && /\bnpm\s+publish\b/u.test(step.run),
    ),
    'source-only release verification must not invoke npm publish',
  );
});

for (const file of [RELEASE_PATH, CI_PATH, NIGHTLY_PATH]) {
  test(`${file}: WORKSPACE_ROOT resolves committed installed packages`, () => {
    const { source } = loadWorkflow(file);
    assert.doesNotMatch(source, /\.siblings\/(?:template|theme-)/u);
    assert.match(source, /node_modules\/@rathnasgala2/u);
  });
}
