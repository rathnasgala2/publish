/**
 * The production workflow boundary that a generated publication crosses.
 *
 * A publication repository is declarative and deliberately has no
 * package.json or author-owned build script. The reusable workflow must
 * therefore carry that source into the sandbox, mount the already-installed
 * Galascribe toolchain read-only, and invoke the managed renderer directly.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import YAML from 'yaml';

import { carrierDigest } from '../scripts/workflow/carrier.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT
  ? path.resolve(process.env.WORKSPACE_ROOT)
  : path.resolve(ROOT, '..');
const USER_TEMPLATE_ROOT = path.join(WORKSPACE_ROOT, 'user-template');

const DOCKER_PROBE = spawnSync(
  'docker',
  ['version', '--format', '{{.Server.Os}}'],
  { encoding: 'utf8', timeout: 20_000 },
);
const SKIP =
  DOCKER_PROBE.error === undefined && DOCKER_PROBE.status === 0
    ? false
    : 'a container runtime is required to execute the production sandbox';

/**
 * @param {string} command executable name or path
 * @param {string[]} args command arguments
 * @param {import('node:child_process').SpawnSyncOptions} [options] spawn options
 * @returns {import('node:child_process').SpawnSyncReturns<string>} completed process
 */
function run(command, args, options = {}) {
  const result =
    /** @type {import('node:child_process').SpawnSyncReturns<string>} */ (
      spawnSync(command, args, {
        cwd: ROOT,
        timeout: 120_000,
        ...options,
        encoding: 'utf8',
      })
    );
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join('\n'),
  );
  return result;
}

/** @param {string} repository generated publication repository */
function publishContent(repository) {
  // The user template's two starter pages ship published since user-template 09d33b8 (the
  // owner's "about and welcome page published"); a template that still ships them as drafts
  // is published here so the build has public content either way.
  for (const name of ['about.md', 'welcome-to-your-publication.md']) {
    const contentPath = path.join(repository, 'content', name);
    const before = readFileSync(contentPath, 'utf8');
    if (before.includes('status: published\n')) {
      continue;
    }
    const after = before.replace(
      'status: draft\n',
      "status: published\npublishedAt: '2026-09-30T17:31:26.000Z'\n",
    );
    assert.notEqual(after, before, `${name} must be a draft or already published`);
    writeFileSync(contentPath, after);
  }
}

function managedBuildCommand() {
  const workflow = YAML.parse(
    readFileSync(path.join(ROOT, '.github/workflows/publish-v2.yml'), 'utf8'),
  );
  const step = workflow.jobs.build.steps.find(
    (/** @type {any} */ candidate) =>
      candidate.name === 'Run the Galascribe build in the isolated sandbox',
  );
  assert.ok(step, 'the production sandbox-build step must exist');
  const match = String(step.run).match(/--command "([^"]+)"/u);
  assert.ok(
    match?.[1],
    'the production step must pass an explicit managed command',
  );
  return match[1].replace('${REF_KIND}', 'candidate');
}

test(
  'the package-free user template builds through the real carrier and production sandbox command',
  { skip: SKIP },
  () => {
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), 'gala-publication-workflow-'),
    );
    try {
      const generatedRepository = path.join(temporaryRoot, 'generated');
      const inbox = path.join(temporaryRoot, 'inbox');
      const decoded = path.join(temporaryRoot, 'decoded');
      const output = path.join(temporaryRoot, 'output');
      const carrier = path.join(inbox, 'verified-inputs-v2.bin');

      cpSync(USER_TEMPLATE_ROOT, generatedRepository, {
        recursive: true,
        filter(source) {
          const relative = path.relative(USER_TEMPLATE_ROOT, source);
          return relative !== '.git' && !relative.startsWith(`.git${path.sep}`);
        },
      });
      publishContent(generatedRepository);
      assert.equal(
        existsSync(path.join(generatedRepository, 'package.json')),
        false,
        'managed publication repositories must remain package-free',
      );

      mkdirSync(inbox);
      const carrierEnvironment = { ...process.env };
      delete carrierEnvironment.GITHUB_ACTIONS;
      delete carrierEnvironment.GITHUB_SHA;
      run(
        process.execPath,
        [
          'scripts/workflow/build-verified-inputs.mjs',
          '--source',
          generatedRepository,
          '--out',
          carrier,
        ],
        { env: carrierEnvironment },
      );
      const digest = carrierDigest(readFileSync(carrier));
      run(process.execPath, [
        'scripts/workflow/decode-carrier.mjs',
        '--inbox',
        inbox,
        '--expected-digest',
        digest,
        '--out',
        decoded,
      ]);

      run(
        'scripts/sandbox-build.sh',
        [
          '--source',
          path.join(decoded, 'source'),
          '--output',
          output,
          '--toolchain',
          ROOT,
          '--command',
          managedBuildCommand(),
          '--timeout-seconds',
          '90',
          '--memory',
          '2g',
          '--cpus',
          '2',
        ],
        {
          env: {
            ...process.env,
            GITHUB_ACTIONS: 'true',
            GITHUB_SHA: '1c14dcdff9501ef74b8b7a5897fba69c586fa76a',
            GITHUB_REPOSITORY: 'fixture-owner/generated-publication',
            GITHUB_REPOSITORY_ID: '1152869454',
            GITHUB_REPOSITORY_OWNER_ID: '192749255',
            GITHUB_WORKFLOW_REF:
              'fixture-owner/generated-publication/.github/workflows/gala-publish-v2.yml@refs/heads/gala/candidate/019d0000-0000-7000-8000-000000000001',
            GITHUB_WORKFLOW: 'Gala preview and publish',
            GITHUB_RUN_ID: '36751986275',
            GITHUB_RUN_ATTEMPT: '1',
            GALA_BUILD_EPOCH: '2026-09-30T17:31:26.000Z',
          },
        },
      );

      const manifest = JSON.parse(
        readFileSync(path.join(output, 'work/artifact-manifest.json'), 'utf8'),
      );
      assert.equal(
        manifest.schemaId,
        'urn:gala:schema:artifact-manifest:2.0.0',
      );
      assert.ok(manifest.routes.length > 0);
      assert.ok(existsSync(path.join(output, 'artifact/index.html')));
      assert.ok(existsSync(path.join(output, 'artifact/about/index.html')));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  },
);
