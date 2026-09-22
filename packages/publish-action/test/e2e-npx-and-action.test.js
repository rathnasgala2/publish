/**
 * End-to-end tests for `publish-action` (S2-T20 deliverable (4); S2-T20b
 * extends this to theme wiring):
 *
 * 1. `validate` -> `build` -> Action-path deploy to a temp local-directory
 *    root -> served bytes equal rendered bytes, generation marker present.
 * 2. An `npx`-path test proving `preview` serves the candidate locally
 *    (loopback only, port 0) and never deploys (no destination directory is
 *    ever touched by `preview`).
 * 3. (S2-T20b) The fixture repository's `gala.lock.json` declares
 *    `@rathnasgala2/theme-default`; `build`'s output carries
 *    `assets/theme/tokens.css`/`components.css`/`print.css`, byte-equal to
 *    the real `theme-default` sibling package's own files, and every
 *    rendered page's `<head>` links them in `cssLayers` order.
 *
 * The fixture author repository lives at `test/fixtures/minimal-repository`
 * (a minimal, deterministic repository built to this package's own
 * documented convention; see `normalize/repository-intake.js`'s module
 * documentation).
 *
 * @module
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runValidate } from '../src/commands/validate.js';
import { runBuild } from '../src/commands/build.js';
import { runPreview } from '../src/commands/preview.js';
import { deployToLocalDirectory } from '../src/deploy-local-directory.js';
import { runAction } from '../src/action/run.js';
import { resolveWorkspaceSibling } from '../src/workspace-siblings.js';

const FIXTURE_REPOSITORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/minimal-repository',
);

/**
 * The real theme package the fixture repository's `gala.lock.json` pins
 * (S2-T20b), resolved through the same production resolver
 * (`resolveWorkspaceSibling`) `theme-bridge.js` itself uses, reading the
 * ambient `process.env` (so `WORKSPACE_ROOT` still redirects this to the
 * right place from a git worktree, per LOCAL-38), rather than a hardcoded
 * path that could drift from it.
 */
const THEME_DEFAULT_DIRECTORY = resolveWorkspaceSibling('theme-default');

/**
 * @returns {Promise<{tmp: string, cleanup: () => Promise<void>}>} a fresh
 *   temporary directory and its cleanup callback
 */
async function freshTempDir() {
  const tmp = await mkdtemp(path.join(tmpdir(), 'gala-publish-action-'));
  return { tmp, cleanup: () => rm(tmp, { recursive: true, force: true }) };
}

test('validate: read-only, deterministic, never mutates', async () => {
  const before = await readdirSafe(FIXTURE_REPOSITORY);
  const result = await runValidate({ repositoryDirectory: FIXTURE_REPOSITORY });
  assert.equal(result.resultCode, 'SUCCESS');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.findings, []);
  const after = await readdirSafe(FIXTURE_REPOSITORY);
  assert.deepEqual(
    before,
    after,
    'validate must never write into the repository directory',
  );

  // Deterministic for the same revision/lock/toolchain: running it twice
  // more produces the same result code and finding set.
  const again = await runValidate({ repositoryDirectory: FIXTURE_REPOSITORY });
  assert.equal(again.resultCode, result.resultCode);
  assert.deepEqual(again.findings, result.findings);
});

test('validate: refuses a repository with an unsupported content status', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const brokenRepository = path.join(tmp, 'repo');
    await copyFixtureWithBrokenStatus(FIXTURE_REPOSITORY, brokenRepository);
    const result = await runValidate({ repositoryDirectory: brokenRepository });
    assert.equal(result.resultCode, 'UNSAFE_INPUT');
    assert.equal(result.exitCode, 5);
    assert.ok(
      result.findings.some(
        (finding) => finding.code === 'CONTENT_STATUS_UNSUPPORTED',
      ),
    );
  } finally {
    await cleanup();
  }
});

test('build -> Action-path deploy to a temp local-directory root: served bytes equal rendered bytes, generation marker present', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const outputDirectory = path.join(tmp, 'output');
    const workDirectory = path.join(tmp, 'work');
    const destinationRoot = path.join(tmp, 'dest');
    await mkdir(destinationRoot, { recursive: true });

    const buildResult = await runBuild({
      repositoryDirectory: FIXTURE_REPOSITORY,
      outputDirectory,
      workDirectory,
    });
    assert.equal(
      buildResult.resultCode,
      'SUCCESS',
      JSON.stringify(buildResult.findings),
    );
    assert.ok(buildResult.outputDirectory);
    const manifest = /** @type {Record<string, unknown>} */ (
      buildResult.manifest
    );
    assert.ok(Array.isArray(manifest.routes) && manifest.routes.length > 0);

    // PUBLISH-S4-6b: the build leaves its two validated fact records next
    // to the manifest for the managed freeze job's rebuild record (DEC-097
    // section 5): the normalized build input the renderer consumed, tied to
    // the manifest by `inputDigest`, and the verified theme contract of the
    // lock-pinned theme, tied to it by `package`.
    const buildInput = JSON.parse(
      await readFile(path.join(workDirectory, 'build-input.json'), 'utf8'),
    );
    assert.equal(buildInput.schemaId, 'urn:gala:schema:build-input:2.0.0');
    assert.equal(buildInput.inputDigest, manifest.buildInputDigest);
    const themeContract = JSON.parse(
      await readFile(path.join(workDirectory, 'theme-contract.json'), 'utf8'),
    );
    assert.equal(
      themeContract.package,
      `${buildInput.packages.theme.package}@${buildInput.packages.theme.version}`,
    );
    assert.match(themeContract.stylingContractDigest, /^sha256:[0-9a-f]{64}$/u);

    // S2-T20b: the theme package `gala.lock.json` pins
    // (`@rathnasgala2/theme-default`) was resolved, verified and its
    // declared stylesheets copied into the candidate output byte-equal to
    // the real theme package's own files.
    for (const stylesheet of ['tokens.css', 'components.css', 'print.css']) {
      const rendered = await readFile(
        path.join(
          /** @type {string} */ (buildResult.outputDirectory),
          'assets/theme',
          stylesheet,
        ),
      );
      const themePackageBytes = await readFile(
        path.join(THEME_DEFAULT_DIRECTORY, stylesheet),
      );
      assert.ok(
        rendered.equals(themePackageBytes),
        `assets/theme/${stylesheet} must be byte-equal to the theme package's own file`,
      );
    }

    const deployResult = await deployToLocalDirectory({
      outputDirectory: /** @type {string} */ (buildResult.outputDirectory),
      manifest,
      destinationRoot,
    });
    assert.equal(
      deployResult.decision,
      'activate',
      JSON.stringify(deployResult.findings),
    );
    assert.deepEqual(deployResult.findings, []);

    for (const route of /** @type {{path: string}[]} */ (manifest.routes)) {
      const rendered = await readFile(
        path.join(
          /** @type {string} */ (buildResult.outputDirectory),
          route.path,
        ),
      );
      const served = await readFile(
        path.join(
          destinationRoot,
          'releases',
          deployResult.generationId,
          route.path,
        ),
      );
      assert.ok(
        served.equals(rendered),
        `served bytes for ${route.path} must equal rendered bytes`,
      );
    }

    const markerText = await readFile(
      path.join(
        destinationRoot,
        'releases',
        deployResult.generationId,
        'gala-generation-marker.json',
      ),
      'utf8',
    );
    const marker = JSON.parse(markerText);
    assert.equal(
      marker.schemaId,
      'urn:gala:schema:public-generation-marker:2.0.0',
    );
    assert.equal(marker.generationId, deployResult.generationId);
    assert.equal(marker.artifactDigest, deployResult.artifactDigest);
  } finally {
    await cleanup();
  }
});

test("build: every generated page <head> links the resolved theme package's stylesheets in cssLayers order", async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const outputDirectory = path.join(tmp, 'output');
    const workDirectory = path.join(tmp, 'work');

    const buildResult = await runBuild({
      repositoryDirectory: FIXTURE_REPOSITORY,
      outputDirectory,
      workDirectory,
    });
    assert.equal(
      buildResult.resultCode,
      'SUCCESS',
      JSON.stringify(buildResult.findings),
    );

    const themeContract = JSON.parse(
      await readFile(path.join(THEME_DEFAULT_DIRECTORY, 'theme.json'), 'utf8'),
    );
    const expectedLinks = /** @type {string[]} */ (
      themeContract.stylesheets
    ).map((stylesheet) =>
      stylesheet === 'print.css'
        ? `<link rel="stylesheet" href="/assets/theme/${stylesheet}" media="print">`
        : `<link rel="stylesheet" href="/assets/theme/${stylesheet}">`,
    );

    const html = await readFile(
      path.join(
        /** @type {string} */ (buildResult.outputDirectory),
        'hello-world/index.html',
      ),
      'utf8',
    );

    let searchFrom = 0;
    for (const expectedLink of expectedLinks) {
      const foundAt = html.indexOf(expectedLink, searchFrom);
      assert.ok(
        foundAt >= 0,
        `expected ${expectedLink} in <head>, in cssLayers order, after offset ${searchFrom}`,
      );
      searchFrom = foundAt + expectedLink.length;
    }
  } finally {
    await cleanup();
  }
});

test('the GitHub Action entry composes normalization -> render -> kernel -> local-directory adapter end to end', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const destinationRoot = path.join(tmp, 'dest');
    await mkdir(destinationRoot, { recursive: true });
    const adapterConfigPath = path.join(tmp, 'adapter-config.json');
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(
        adapterConfigPath,
        JSON.stringify({ root: destinationRoot }),
      ),
    );
    const githubOutputPath = path.join(tmp, 'github-output.txt');
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(githubOutputPath, ''),
    );

    const exitCode = await runAction({
      ...process.env,
      'INPUT_REPOSITORY-DIRECTORY': FIXTURE_REPOSITORY,
      'INPUT_OUTPUT-DIRECTORY': path.join(tmp, 'output'),
      'INPUT_WORK-DIRECTORY': path.join(tmp, 'work'),
      INPUT_ADAPTER: 'local-directory',
      'INPUT_ADAPTER-CONFIG-PATH': adapterConfigPath,
      GITHUB_OUTPUT: githubOutputPath,
      GITHUB_ACTIONS: undefined,
    });
    assert.equal(exitCode, 0);

    const outputText = await readFile(githubOutputPath, 'utf8');
    assert.match(outputText, /result-code<<.*\nSUCCESS\n/u);

    const current = await import('node:fs/promises').then((fs) =>
      fs.readlink(path.join(destinationRoot, 'current')),
    );
    assert.match(current, /^releases\//u);
  } finally {
    await cleanup();
  }
});

test('a local preview build followed by the Action deploying into the same output/work directories (S2 brief section 5\'s documented "author previews locally, then deploys through the Action" flow) succeeds, is theme-wired, and is byte-for-byte reproducible', async () => {
  // Regression test for STAGE_INTEGRITY_MISMATCH: `runAction`'s own
  // internal `runBuild` call used to re-render into whatever
  // `outputDirectory`/`workDirectory` already held (here, a prior direct
  // `runBuild` call's own output), and `renderPublication`'s route listing
  // is a full re-scan of `outputDirectory` after rendering -- so a
  // leftover theme/asset file from the first render was picked up a
  // second time as an extra manifest route, producing an artifact-manifest
  // file set that no longer matched the physical staged file set one to
  // one. `runBuild` now cleans both directories itself, so this exact
  // reuse (a non-root, nested output path, exactly this fixture's real
  // theme resolved) must succeed on both passes, deploy the theme's own
  // stylesheets, and produce an identical `artifactDigest` across two
  // completely independent runs of this whole sequence (buildEpoch is
  // recovered from the deterministic local `sourceRevision` stand-in, not
  // the wall clock, for this non-git fixture repository).
  async function runPreviewThenActionDeploy() {
    const { tmp, cleanup } = await freshTempDir();
    try {
      // Non-root: nested one level under the temp root, exactly like the
      // infra local-e2e harness's own `RUN_DIR/build-output` (never the
      // adapter's `tmp` root itself).
      const outputDirectory = path.join(tmp, 'run', 'build-output');
      const workDirectory = path.join(tmp, 'run', 'build-work');
      const destinationRoot = path.join(tmp, 'run', 'site');
      await mkdir(destinationRoot, { recursive: true });

      // Pass 1: the local author's own preview build, exactly `preview`'s
      // and the harness's direct `runBuild` call -- populates
      // `outputDirectory`/`workDirectory` with a real, theme-wired render.
      const previewBuild = await runBuild({
        repositoryDirectory: FIXTURE_REPOSITORY,
        outputDirectory,
        workDirectory,
      });
      assert.equal(
        previewBuild.resultCode,
        'SUCCESS',
        JSON.stringify(previewBuild.findings),
      );

      // Pass 2: the Action, reusing those exact same directories.
      const adapterConfigPath = path.join(tmp, 'adapter-config.json');
      await import('node:fs/promises').then((fs) =>
        fs.writeFile(
          adapterConfigPath,
          JSON.stringify({ root: destinationRoot }),
        ),
      );
      const githubOutputPath = path.join(tmp, 'github-output.txt');
      await import('node:fs/promises').then((fs) =>
        fs.writeFile(githubOutputPath, ''),
      );

      const exitCode = await runAction({
        ...process.env,
        'INPUT_REPOSITORY-DIRECTORY': FIXTURE_REPOSITORY,
        'INPUT_OUTPUT-DIRECTORY': outputDirectory,
        'INPUT_WORK-DIRECTORY': workDirectory,
        INPUT_ADAPTER: 'local-directory',
        'INPUT_ADAPTER-CONFIG-PATH': adapterConfigPath,
        GITHUB_OUTPUT: githubOutputPath,
        GITHUB_ACTIONS: undefined,
      });
      const outputText = await readFile(githubOutputPath, 'utf8');
      assert.equal(exitCode, 0, outputText);
      assert.match(outputText, /result-code<<.*\nSUCCESS\n/u);
      assert.doesNotMatch(outputText, /STAGE_INTEGRITY_MISMATCH/u);

      const current = await import('node:fs/promises').then((fs) =>
        fs.readlink(path.join(destinationRoot, 'current')),
      );
      const releaseDirectory = path.join(destinationRoot, current);
      for (const stylesheet of ['tokens.css', 'components.css', 'print.css']) {
        const deployed = await readFile(
          path.join(releaseDirectory, 'assets/theme', stylesheet),
        );
        const themePackageBytes = await readFile(
          path.join(THEME_DEFAULT_DIRECTORY, stylesheet),
        );
        assert.ok(
          deployed.equals(themePackageBytes),
          `deployed assets/theme/${stylesheet} must be byte-equal to the theme package's own file`,
        );
      }

      const artifactDigestMatch =
        /artifact-digest<<.*\n(sha256:[0-9a-f]+)\n/u.exec(outputText);
      assert.ok(
        artifactDigestMatch,
        'Action output must carry artifact-digest',
      );
      return /** @type {RegExpExecArray} */ (artifactDigestMatch)[1];
    } finally {
      await cleanup();
    }
  }

  const first = await runPreviewThenActionDeploy();
  const second = await runPreviewThenActionDeploy();
  assert.equal(
    first,
    second,
    'two independent preview-then-deploy runs of the same fixture must produce byte-identical artifact digests',
  );
});

test('adapter selection: an unimplemented adapter fails closed with TARGET_CAPABILITY_UNAVAILABLE (exit 2), and never touches any destination', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const githubOutputPath = path.join(tmp, 'github-output.txt');
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(githubOutputPath, ''),
    );
    const exitCode = await runAction({
      ...process.env,
      'INPUT_REPOSITORY-DIRECTORY': FIXTURE_REPOSITORY,
      'INPUT_OUTPUT-DIRECTORY': path.join(tmp, 'output'),
      'INPUT_WORK-DIRECTORY': path.join(tmp, 'work'),
      INPUT_ADAPTER: 'github-pages',
      GITHUB_OUTPUT: githubOutputPath,
      GITHUB_ACTIONS: undefined,
    });
    assert.equal(exitCode, 2);
    const outputText = await readFile(githubOutputPath, 'utf8');
    assert.match(outputText, /INCOMPATIBLE_CONTRACT/u);
  } finally {
    await cleanup();
  }
});

test('npx preview: serves the candidate on loopback only and never deploys (no destination is ever touched)', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const { envelope, server } = await runPreview({
      repositoryDirectory: FIXTURE_REPOSITORY,
      outputDirectory: path.join(tmp, 'output'),
      workDirectory: path.join(tmp, 'work'),
    });
    assert.equal(envelope.resultCode, 'SUCCESS');
    assert.ok(server);
    assert.match(
      /** @type {string} */ (envelope.previewUrl),
      /^http:\/\/127\.0\.0\.1:\d+\/$/u,
    );

    const response = await fetch(
      new URL('hello-world/', /** @type {string} */ (envelope.previewUrl)),
    );
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /Hello World/u);

    const notFound = await fetch(
      new URL('does-not-exist/', /** @type {string} */ (envelope.previewUrl)),
    );
    assert.equal(notFound.status, 404);

    await server?.close();
  } finally {
    await cleanup();
  }
});

/**
 * @param {string} directory a directory
 * @returns {Promise<string[]>} its sorted entry names, or `[]` if absent
 */
async function readdirSafe(directory) {
  const { readdir } = await import('node:fs/promises');
  try {
    return (await readdir(directory)).sort();
  } catch {
    return [];
  }
}

/**
 * Copy the fixture repository into `targetDirectory`, replacing its one
 * content file's `status` with an authored-only value the normalized schema
 * never admits, so the resulting `validate` run exercises a real rejection.
 *
 * @param {string} sourceDirectory the fixture repository root
 * @param {string} targetDirectory an empty destination directory
 * @returns {Promise<void>} resolves once the broken copy exists
 */
async function copyFixtureWithBrokenStatus(sourceDirectory, targetDirectory) {
  const {
    cp,
    readFile: read,
    writeFile: write,
  } = await import('node:fs/promises');
  await cp(sourceDirectory, targetDirectory, { recursive: true });
  const contentPath = path.join(targetDirectory, 'content/hello-world.md');
  const text = await read(contentPath, 'utf8');
  // "draft" without "publishedAt" is schema-valid at the content-frontmatter
  // level (the schema itself only forbids "published" without
  // "publishedAt"); this exercises this package's own normalized-schema
  // rejection (CONTENT_STATUS_UNSUPPORTED) rather than a schema-validation
  // failure the schema package already catches.
  await write(
    contentPath,
    text
      .replace('status: published', 'status: draft')
      .replace(/\n *publishedAt: ['"][^'"]*['"]\n/u, '\n'),
  );
}
