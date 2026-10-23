/**
 * The adapter release path: `scripts/release/adapter-release.mjs` (which
 * packages a run releases, and the loud failure for a packed change under an
 * already-published version) and the shape of
 * `.github/workflows/release-adapters.yaml`, the one workflow that publishes to
 * npm (trusted publishing: OIDC, `environment: npm`, provenance, no token).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

import {
  RELEASE_ORDER,
  assessPackage,
  classifyDeclaredVersion,
  parseRegistryVersions,
  parseVersion,
  planReleases,
  selectChangedPackages,
} from '../scripts/release/adapter-release.mjs';

const WORKFLOW_PATH = '.github/workflows/release-adapters.yaml';

/** @typedef {import('../scripts/release/adapter-release.mjs').ReleaseIo} ReleaseIo */

/**
 * @param {{
 *   changed?: string[],
 *   packed?: Record<string, string[]>,
 *   versions?: Record<string, string>,
 *   published?: Record<string, string[]>,
 * }} fixture what the fake repository and registry hold
 * @returns {ReleaseIo} injectable effects
 */
function fakeIo({ changed = [], packed = {}, versions = {}, published = {} }) {
  return {
    changedFiles: () => changed,
    packedFiles: (directory) =>
      packed[directory] ?? ['package.json', 'src/index.js'],
    manifest: (directory) => ({
      name: `@rathnasgala2/${directory}`,
      version: versions[directory] ?? '1.0.0',
    }),
    registryVersions: (name) =>
      published[name.replace('@rathnasgala2/', '')] ?? [],
  };
}

const MAIN = 'refs/heads/main';

test('parseVersion accepts only plain x.y.z versions', () => {
  assert.deepEqual(parseVersion('0.2.10'), [0, 2, 10]);
  for (const bad of ['1.0', '1.0.0-rc.1', 'v1.0.0', '1.0.0+build', '']) {
    assert.equal(parseVersion(bad), null, bad);
  }
});

test('classifyDeclaredVersion: new, published, out of order and malformed', () => {
  assert.deepEqual(classifyDeclaredVersion('0.1.0', []), {
    state: 'unpublished',
  });
  assert.deepEqual(classifyDeclaredVersion('0.2.3', ['0.2.1', '0.2.2']), {
    state: 'unpublished',
  });
  assert.deepEqual(classifyDeclaredVersion('0.2.2', ['0.2.1', '0.2.2']), {
    state: 'published',
  });
  assert.deepEqual(classifyDeclaredVersion('0.1.9', ['0.2.1', '0.2.2']), {
    state: 'stale',
    newest: '0.2.2',
  });
  assert.deepEqual(classifyDeclaredVersion('0.10.0', ['0.9.0', '0.2.2']), {
    state: 'unpublished',
  });
  assert.deepEqual(classifyDeclaredVersion('1.0.0-rc.1', []), {
    state: 'invalid',
  });
});

test('selectChangedPackages: only packed paths count, in release order', () => {
  const packed = {
    'adapter-protocol': ['package.json', 'src/index.js', 'README.md'],
    'adapter-do-spaces': ['package.json', 'src/index.js'],
  };
  assert.deepEqual(
    selectChangedPackages(
      [
        'packages/adapter-do-spaces/src/index.js',
        'packages/adapter-protocol/test/protocol.test.js',
        'packages/adapter-protocol/README.md',
      ],
      packed,
    ),
    ['adapter-protocol', 'adapter-do-spaces'],
  );
  assert.deepEqual(
    selectChangedPackages(
      [
        'packages/adapter-protocol/test/protocol.test.js',
        'packages/adapter-protocol/tsconfig.json',
        'packages/publish-action/src/index.js',
      ],
      packed,
    ),
    [],
  );
});

test('parseRegistryVersions: list, single version, E404 and real failures', () => {
  assert.deepEqual(
    parseRegistryVersions({
      exitStatus: 0,
      stdout: '["0.2.0","0.2.1"]',
      stderr: '',
    }),
    ['0.2.0', '0.2.1'],
  );
  assert.deepEqual(
    parseRegistryVersions({ exitStatus: 0, stdout: '"0.1.0"', stderr: '' }),
    ['0.1.0'],
  );
  assert.deepEqual(
    parseRegistryVersions({
      exitStatus: 1,
      stdout: JSON.stringify({ error: { code: 'E404', summary: 'Not Found' } }),
      stderr: 'npm error code E404\n',
    }),
    [],
  );
  assert.throws(
    () =>
      parseRegistryVersions({
        exitStatus: 1,
        stdout: JSON.stringify({ error: { code: 'E503' } }),
        stderr: 'npm error code E503\n',
      }),
    /E503/u,
  );
  assert.throws(
    () =>
      parseRegistryVersions({
        exitStatus: 1,
        stdout: '',
        stderr: 'npm error network timeout\n',
      }),
    /network timeout/u,
  );
});

test('assessPackage refuses a private package', () => {
  const io = fakeIo({});
  io.manifest = () => ({ name: 'x', version: '1.0.0', private: true });
  assert.throws(() => assessPackage('adapter-protocol', io), /private/u);
});

test('push: a packed change under a published version FAILS loudly and releases nothing', () => {
  const result = planReleases(
    {
      eventName: 'push',
      ref: MAIN,
      inputPackage: '',
      before: 'a'.repeat(40),
      sha: 'b'.repeat(40),
    },
    fakeIo({
      changed: [
        'packages/adapter-protocol/src/index.js',
        'packages/adapter-github-pages/src/index.js',
      ],
      versions: {
        'adapter-protocol': '0.2.3',
        'adapter-github-pages': '0.1.2',
      },
      published: {
        'adapter-protocol': ['0.2.2'],
        'adapter-github-pages': ['0.1.1', '0.1.2'],
      },
    }),
  );
  assert.deepEqual(result.packages, []);
  const errors = result.annotations.filter((a) => a.level === 'error');
  assert.equal(errors.length, 2);
  assert.match(
    errors[0]?.message ?? '',
    /@rathnasgala2\/adapter-github-pages@0\.1\.2 is already published.*Bump package\.json's version/u,
  );
  assert.match(
    errors[1]?.message ?? '',
    /Nothing was published from this run/u,
  );
});

test('push: new versions are released in dependency order', () => {
  const result = planReleases(
    {
      eventName: 'push',
      ref: MAIN,
      inputPackage: '',
      before: 'a'.repeat(40),
      sha: 'b'.repeat(40),
    },
    fakeIo({
      changed: [
        'packages/adapter-do-spaces/package.json',
        'packages/adapter-protocol/package.json',
        'packages/adapter-do-spaces/test/s3.test.js',
      ],
      versions: { 'adapter-protocol': '0.3.0', 'adapter-do-spaces': '0.2.0' },
      published: {
        'adapter-protocol': ['0.2.2'],
        'adapter-do-spaces': ['0.1.1'],
      },
    }),
  );
  assert.deepEqual(result.packages, ['adapter-protocol', 'adapter-do-spaces']);
  assert.equal(
    result.annotations.some((a) => a.level === 'error'),
    false,
  );
});

test('push: a test-only change releases nothing and does not fail', () => {
  const result = planReleases(
    {
      eventName: 'push',
      ref: MAIN,
      inputPackage: '',
      before: 'a'.repeat(40),
      sha: 'b'.repeat(40),
    },
    fakeIo({
      changed: ['packages/adapter-protocol/test/protocol.test.js'],
      published: { 'adapter-protocol': ['1.0.0'] },
    }),
  );
  assert.deepEqual(result.packages, []);
  assert.equal(
    result.annotations.some((a) => a.level === 'error'),
    false,
  );
});

test('push: a version older than the newest published is refused', () => {
  const result = planReleases(
    {
      eventName: 'push',
      ref: MAIN,
      inputPackage: '',
      before: 'a'.repeat(40),
      sha: 'b'.repeat(40),
    },
    fakeIo({
      changed: ['packages/adapter-protocol/package.json'],
      versions: { 'adapter-protocol': '0.1.0' },
      published: { 'adapter-protocol': ['0.2.2'] },
    }),
  );
  assert.deepEqual(result.packages, []);
  assert.match(
    result.annotations[0]?.message ?? '',
    /not newer than the newest published version 0\.2\.2/u,
  );
});

test('dispatch: releases the named package when its version is new', () => {
  const result = planReleases(
    {
      eventName: 'workflow_dispatch',
      ref: MAIN,
      inputPackage: 'adapter-github-pages',
      before: '',
      sha: 'b'.repeat(40),
    },
    fakeIo({
      versions: { 'adapter-github-pages': '0.1.3' },
      published: { 'adapter-github-pages': ['0.1.2'] },
    }),
  );
  assert.deepEqual(result.packages, ['adapter-github-pages']);
});

test('dispatch: an already-published version is reported, not an error', () => {
  const result = planReleases(
    {
      eventName: 'workflow_dispatch',
      ref: MAIN,
      inputPackage: 'adapter-github-pages',
      before: '',
      sha: 'b'.repeat(40),
    },
    fakeIo({
      versions: { 'adapter-github-pages': '0.1.2' },
      published: { 'adapter-github-pages': ['0.1.2'] },
    }),
  );
  assert.deepEqual(result.packages, []);
  assert.deepEqual(
    result.annotations.map((a) => a.level),
    ['notice'],
  );
});

test('dispatch: refuses an unknown package, the private kit and any ref but main', () => {
  for (const inputPackage of [
    'adapter-conformance-kit',
    'publish-action',
    '',
  ]) {
    const result = planReleases(
      {
        eventName: 'workflow_dispatch',
        ref: MAIN,
        inputPackage,
        before: '',
        sha: 'b'.repeat(40),
      },
      fakeIo({}),
    );
    assert.deepEqual(result.packages, [], inputPackage);
    assert.equal(result.annotations[0]?.level, 'error');
  }
  const offMain = planReleases(
    {
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/other',
      inputPackage: 'adapter-protocol',
      before: '',
      sha: 'b'.repeat(40),
    },
    fakeIo({}),
  );
  assert.deepEqual(offMain.packages, []);
  assert.match(offMain.annotations[0]?.message ?? '', /main only/u);
});

/**
 * @returns {{source: string, doc: Record<string, any>}} the parsed workflow
 */
function loadWorkflow() {
  const source = readFileSync(WORKFLOW_PATH, 'utf8');
  return { source, doc: parse(source) };
}

test('release-adapters.yaml: offers and watches exactly the publishable adapter family', () => {
  const { doc } = loadWorkflow();
  assert.deepEqual(doc.on.workflow_dispatch.inputs.package.options, [
    ...RELEASE_ORDER,
  ]);
  assert.equal(doc.on.workflow_dispatch.inputs.package.type, 'choice');
  assert.deepEqual(doc.on.push.branches, ['main']);
  assert.deepEqual(
    doc.on.push.paths,
    RELEASE_ORDER.map((name) => `packages/${name}/**`),
  );
  for (const name of RELEASE_ORDER) {
    const manifest = JSON.parse(
      readFileSync(`packages/${name}/package.json`, 'utf8'),
    );
    assert.notEqual(manifest.private, true, `${name} must be publishable`);
    assert.equal(manifest.publishConfig?.provenance, true, name);
  }
});

test('release-adapters.yaml: trusted publishing only, with minimal permissions', () => {
  const { doc, source } = loadWorkflow();
  assert.deepEqual(doc.permissions, { contents: 'read' });
  assert.equal(doc.jobs.plan.permissions, undefined);
  assert.equal(doc.jobs.plan.environment, undefined);
  const publish = doc.jobs.publish;
  assert.equal(publish.environment, 'npm');
  assert.deepEqual(publish.permissions, {
    contents: 'read',
    'id-token': 'write',
  });
  assert.deepEqual(Object.keys(doc.jobs), ['plan', 'publish']);
  const code = source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.doesNotMatch(code, /secrets\./u, 'no secret may be referenced');
  assert.doesNotMatch(code, /NPM_TOKEN|NODE_AUTH_TOKEN/u);
  assert.equal(publish.strategy['max-parallel'], 1);
  assert.equal(publish.strategy['fail-fast'], true);
  assert.deepEqual(publish.concurrency, {
    group: 'release-adapter-${{ matrix.package }}',
    'cancel-in-progress': false,
  });
});

test('release-adapters.yaml: the publish job gates, publishes with provenance and waits for the listing', () => {
  const { doc } = loadWorkflow();
  /** @type {Record<string, string>[]} */
  const steps = doc.jobs.publish.steps;
  const names = steps.map((step) => step.name);
  assert.deepEqual(names, [
    'Check out the complete history',
    'Install the pinned Node.js distribution',
    'Verify toolchain pins',
    'Read the declared package identity',
    'Fail unless this version is new on npm',
    'Install locked dependencies',
    'Typecheck the package',
    'Check the committed declarations',
    'Run the package tests',
    'Verify the package payload',
    'Pack the reviewed bytes',
    'Publish with trusted provenance',
    'Wait until the registry lists the version',
    'Record the registry digest',
  ]);
  /**
   * @param {string} name step name
   * @returns {string} its script
   */
  const run = (name) => steps.find((step) => step.name === name)?.run ?? '';
  assert.match(
    run('Install locked dependencies'),
    /^npm ci --ignore-scripts$/u,
  );
  assert.match(run('Typecheck the package'), /run typecheck$/u);
  assert.match(
    run('Check the committed declarations'),
    /run declarations:check$/u,
  );
  assert.match(run('Run the package tests'), /run test$/u);
  assert.match(
    run('Publish with trusted provenance'),
    /npm publish --provenance --access public --ignore-scripts/u,
  );
  assert.match(
    run('Publish with trusted provenance'),
    /::error::npm publish failed.*trusted publisher/u,
  );
  assert.match(run('Wait until the registry lists the version'), /seq 1 20/u);
  assert.match(run('Wait until the registry lists the version'), /sleep 30/u);
  assert.equal(
    steps.find((step) => step.name === 'Publish with trusted provenance')?.[
      'working-directory'
    ],
    'packages/${{ matrix.package }}',
  );
  const registryCheck = names.indexOf('Fail unless this version is new on npm');
  const publishStep = names.indexOf('Publish with trusted provenance');
  assert.ok(registryCheck >= 0 && registryCheck < publishStep);
});
