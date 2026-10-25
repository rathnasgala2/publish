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
// CI checks the user template out at its pinned commit beside the sources;
// a workstation falls back to the adjacent repository, then to the fixture.
const SIBLING_USER_TEMPLATE = path.join(ROOT, '.siblings/user-template');
const ADJACENT_USER_TEMPLATE = path.resolve(ROOT, '../user-template');
const PUBLICATION_SOURCE_ROOT = existsSync(SIBLING_USER_TEMPLATE)
  ? SIBLING_USER_TEMPLATE
  : !process.env.WORKSPACE_ROOT && existsSync(ADJACENT_USER_TEMPLATE)
    ? ADJACENT_USER_TEMPLATE
    : path.join(
        ROOT,
        'packages/publish-action/test/fixtures/minimal-repository',
      );

const SANDBOX_IMAGE = String(
  readFileSync(path.join(ROOT, 'scripts/sandbox-build.sh'), 'utf8').match(
    /^IMAGE="([^"]+)"/mu,
  )?.[1],
);
/**
 * Removes a directory the sandbox populated as another uid. The runner
 * cannot delete those entries itself, so the same pinned image does it
 * (offline) before the ordinary removal.
 *
 * @param {string} directory directory to remove
 */
function removeSandboxOutput(directory) {
  if (existsSync(directory)) {
    spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--user',
        '0:0',
        '-v',
        `${directory}:/cleanup`,
        SANDBOX_IMAGE,
        'sh',
        '-c',
        'rm -rf /cleanup/* /cleanup/.[!.]*',
      ],
      { timeout: 60_000 },
    );
  }
  rmSync(directory, { recursive: true, force: true });
}

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
  for (const relativePath of [
    'gala/theme-pages/about.md',
    'content/welcome-to-your-publication.md',
  ]) {
    const contentPath = path.join(repository, relativePath);
    if (!existsSync(contentPath)) {
      continue;
    }
    const before = readFileSync(contentPath, 'utf8');
    if (before.includes('status: published\n')) {
      continue;
    }
    const after = before.replace(
      'status: draft\n',
      "status: published\npublishedAt: '2026-09-30T17:31:26.000Z'\n",
    );
    assert.notEqual(
      after,
      before,
      `${relativePath} must be a draft or already published`,
    );
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
  'a package-free publication source builds through the real carrier and production sandbox command',
  { skip: SKIP },
  () => {
    // The toolchain mount is the repository, so the output root cannot live
    // inside it; the runner temporary directory is the writable alternative.
    const temporaryRoot = mkdtempSync(
      path.join(
        process.env.RUNNER_TEMP || tmpdir(),
        'gala-publication-workflow-',
      ),
    );
    try {
      const generatedRepository = path.join(temporaryRoot, 'generated');
      const inbox = path.join(temporaryRoot, 'inbox');
      const decoded = path.join(temporaryRoot, 'decoded');
      const output = path.join(temporaryRoot, 'output');
      const carrier = path.join(inbox, 'verified-inputs-v2.bin');

      cpSync(PUBLICATION_SOURCE_ROOT, generatedRepository, {
        recursive: true,
        filter(source) {
          const relative = path.relative(PUBLICATION_SOURCE_ROOT, source);
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
      const expectedArticle = existsSync(
        path.join(generatedRepository, 'gala/theme-pages/about.md'),
      )
        ? 'about/index.html'
        : 'hello-world/index.html';
      assert.ok(existsSync(path.join(output, 'artifact', expectedArticle)));
    } finally {
      removeSandboxOutput(path.join(temporaryRoot, 'output'));
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  },
);
