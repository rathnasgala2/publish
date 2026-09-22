/**
 * End-to-end test (S2-T17 deliverable (d)): a candidate directory produced
 * by the merged `@rathnasgala2/template` renderer (`renderPublication`)
 * goes through `publish-kernel`'s preflight/stage/activate/observe/cleanup
 * duties composed with this package's real POSIX `local-directory`
 * lifecycle calls, and the result is checked for a valid public generation
 * marker plus byte-identical served output.
 *
 * `@rathnasgala2/template` is consumed **by invoking it via its package
 * entry** (the task packet's second sanctioned option), not as a `file:`
 * dev dependency: `v2/template` is a full sibling repository with its own
 * independently installed `node_modules` (including its own copy of
 * `@rathnasgala2/schemas`), and adding it as an npm `file:` dependency here
 * makes `npm ls`/`cyclonedx-npm` (this workspace's SBOM generator) crawl
 * into that foreign `node_modules` tree and report an unrelated "invalid"
 * package there — a real, reproduced friction point of mixing an npm-linked
 * sibling-repo dependency with this workspace's own dependency graph, not
 * something worth working around by weakening the SBOM gate. Instead this
 * test resolves `v2/template`'s package root directly from this file's own
 * path (four directories up: `test/` -> `adapter-local-directory/` ->
 * `packages/` -> `publish/` -> `v2/`, then into `template/`) and dynamically
 * imports exactly the module `template`'s own `package.json` `exports` map
 * publishes for `.` (`src/core/index.js`) — its package entry, reached
 * without an npm-managed symlink or lockfile edge.
 *
 * `renderPublication`'s public entry point does not yet expose a way to
 * compute the current render-policy identity a fixture's content records
 * must carry (only the internal renderer does, via
 * `src/core/internal/content-security.js`'s `computeRenderPolicyIdentity`,
 * not re-exported from `src/core/index.js`). This test reaches that one
 * internal module the same way: a direct path resolved from `template`'s
 * root, the same technique `template`'s own `test/helpers/schema-fixtures.js`
 * uses to build a renderable fixture from the `@rathnasgala2/schemas`
 * canonical example. If a future `template` release publishes this as a
 * public helper, this import should switch to the package's public entry
 * point.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  evaluateActivate,
  evaluateCleanupStaged,
  evaluateObserve,
  evaluatePreflight,
  evaluateStage,
} from '@rathnasgala2/publish-kernel';

import {
  ADAPTER_VERSION,
  EXPECT_NOTHING_SERVED,
  activate,
  cleanupStaged,
  computeArtifactDigest,
  generateUuidV7,
  observe,
  preflight,
  stage,
} from '../src/index.js';

/**
 * The `v2/template` sibling repository's root: `WORKSPACE_ROOT` (DEC-015
 * name) joined with `template` when set to a non-empty string (the
 * LOCAL-38 escape hatch for running from a location where the fixed
 * relative default does not reach the siblings, e.g. a git worktree one
 * level deeper than the real checkout — see
 * `packages/publish-action/src/workspace-siblings.js`, which this test
 * cannot import directly: `adapter-local-directory` may depend on
 * `adapter-protocol` only, never on `publish-action`), otherwise resolved
 * from this file's own path.
 */
const TEMPLATE_ROOT =
  process.env.WORKSPACE_ROOT && process.env.WORKSPACE_ROOT.length > 0
    ? path.resolve(process.env.WORKSPACE_ROOT, 'template')
    : path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../template',
      );

/**
 * Resolve one `@rathnasgala2/template` module by absolute path, rooted at
 * `TEMPLATE_ROOT` (see module documentation above for why this test does
 * not add `template` as an npm dependency).
 *
 * @param {string} relativePath a path relative to the `template` package root
 * @returns {Promise<Record<string, unknown>>} the imported module namespace
 */
async function importTemplateModule(relativePath) {
  return /** @type {Record<string, unknown>} */ (
    await import(pathToFileURL(path.join(TEMPLATE_ROOT, relativePath)).href)
  );
}

/**
 * Build a small, schema-valid, renderable `build-input:2.0.0` instance from
 * `@rathnasgala2/schemas`'s own canonical example, stamped with the
 * currently published render-policy identity.
 *
 * @returns {Promise<Record<string, unknown>>} the renderable build input
 */
async function loadRenderableBuildInput() {
  const schemasPkgUrl = await import.meta
    .resolve('@rathnasgala2/schemas/package.json');
  const schemasRoot = path.dirname(fileURLToPath(schemasPkgUrl));
  const text = await readFile(
    path.join(schemasRoot, 'examples/valid/build-input/canonical.json'),
    'utf8',
  );
  const buildInput = /** @type {any} */ (JSON.parse(text));
  for (const record of buildInput.content) {
    record.frontmatter.redirects = [];
  }
  // The canonical fixture's one `appearance.fontAssets` entry is schema-shape
  // filler (`path: "content/fixture-1.md"`, a placeholder `sourceDigest`),
  // not a real font file; clear it exactly as `template`'s own
  // `test/helpers/schema-fixtures.js` `loadCanonicalBuildInput` does, since
  // this test does not exercise the S2-T05 media pipeline.
  buildInput.appearance.fontAssets = [];

  const { computeBodyDigest, computeRenderPolicyIdentity } =
    await importTemplateModule('src/core/internal/content-security.js');
  const identity = await /** @type {() => Promise<Record<string, unknown>>} */ (
    computeRenderPolicyIdentity
  )();
  const digestBody = /** @type {(body: string) => string} */ (
    computeBodyDigest
  );
  if (buildInput.publication?.profile?.body) {
    buildInput.publication.profile.body.renderPolicy = { ...identity };
    buildInput.publication.profile.body.bodyDigest = digestBody(
      buildInput.publication.profile.body.body,
    );
  }
  if (buildInput.publication?.footerCard?.body) {
    buildInput.publication.footerCard.body.renderPolicy = { ...identity };
    buildInput.publication.footerCard.body.bodyDigest = digestBody(
      buildInput.publication.footerCard.body.body,
    );
  }
  for (const record of buildInput.content) {
    record.renderPolicy = { ...identity };
    record.bodyDigest = digestBody(record.body);
  }
  return buildInput;
}

/**
 * A schema-valid placeholder `provenance` bundle, matching `template`'s own
 * test fixture convention (`test/helpers/render-fixtures.js`), reconstructed
 * here rather than imported (that helper is test-only, not published).
 *
 * @returns {{
 *   builder: { package: string, version: string, integrity: string, registry: string },
 *   repositoryCoordinate: string,
 *   workflowIdentity: string,
 *   buildToolVersions: readonly { kind: string, name?: string, package?: string, version: string, digest: string }[]
 * }} a fresh provenance bundle (shape matches `template`'s `RenderProvenance`,
 *   restated here rather than imported since this test does not add
 *   `template` as an npm dependency — see module documentation)
 */
function testProvenance() {
  const digest = (/** @type {number} */ n) =>
    `sha256:${'0'.repeat(64 - String(n).length)}${n}`;
  return {
    builder: {
      package: '@rathnasgala2/publish-action',
      version: '2.0.0',
      integrity: digest(1),
      registry: 'https://fixture-1.example.com/',
    },
    repositoryCoordinate: 'fixture-owner/fixture-repository',
    workflowIdentity: digest(1),
    buildToolVersions: [
      { kind: 'runtime', name: 'node', version: '24.18.0', digest: digest(1) },
      { kind: 'runtime', name: 'npm', version: '11.16.0', digest: digest(2) },
      {
        kind: 'package',
        package: '@rathnasgala2/schemas',
        version: '2.0.0',
        digest: digest(3),
      },
      {
        kind: 'package',
        package: '@rathnasgala2/template',
        version: '2.0.0',
        digest: digest(4),
      },
      {
        kind: 'package',
        package: '@rathnasgala2/theme-default',
        version: '2.0.0',
        digest: digest(5),
      },
      {
        kind: 'package',
        package: '@rathnasgala2/publish-action',
        version: '2.0.0',
        digest: digest(6),
      },
      {
        kind: 'package',
        package: '@rathnasgala2/publish-kernel',
        version: '2.0.0',
        digest: digest(7),
      },
      {
        kind: 'package',
        package: '@rathnasgala2/adapter-protocol',
        version: '2.0.0',
        digest: digest(8),
      },
      {
        kind: 'package',
        package: '@rathnasgala2/adapter-local-directory',
        version: '2.0.0',
        digest: digest(9),
      },
    ],
  };
}

test('E2E: renderPublication -> kernel preflight/stage/activate/observe/cleanup -> local-directory adapter', async () => {
  const { renderPublication } =
    /** @type {{ renderPublication: (buildInput: unknown, options: unknown) => Promise<{ outputDirectory: string, manifest: Record<string, any> }> }} */ (
      await importTemplateModule('src/core/index.js')
    );
  const buildInput = await loadRenderableBuildInput();
  const renderRoot = await mkdtemp(path.join(tmpdir(), 'gala-e2e-render-'));
  const destinationRoot = await mkdtemp(path.join(tmpdir(), 'gala-e2e-dest-'));
  try {
    // --- 1. Render (template) ----------------------------------------------
    const sourceDirectory = path.join(renderRoot, 'source');
    await fs.mkdir(sourceDirectory, { recursive: true });
    const { outputDirectory, manifest } = await renderPublication(buildInput, {
      outputDirectory: path.join(renderRoot, 'output'),
      workDirectory: path.join(renderRoot, 'work'),
      sourceDirectory,
      provenance: testProvenance(),
    });
    assert.ok(Array.isArray(manifest.routes) && manifest.routes.length > 0);

    const files = await Promise.all(
      /** @type {{path: string}[]} */ (manifest.routes).map(async (route) => ({
        path: route.path,
        bytes: await fs.readFile(path.join(outputDirectory, route.path)),
      })),
    );
    const adapterDestination = { root: destinationRoot };

    // --- 2. Kernel preflight (provider-neutral duty composition) ----------
    const entries = files.map((file) => ({
      path: file.path,
      kind: /** @type {const} */ ('file'),
    }));
    const destinationIdentity = {
      environment: 'local',
      adapterId: 'local-directory',
      adapterVersion: ADAPTER_VERSION,
      targetDigest: `sha256:${'0'.repeat(64)}`,
      baseUrl: `file://${destinationRoot}`,
    };
    const totalBytes = files.reduce(
      (sum, file) => sum + BigInt(file.bytes.byteLength),
      0n,
    );
    const kernelPreflight = evaluatePreflight({
      entries,
      totals: {
        artifactFileCount: files.length,
        artifactByteCount: totalBytes.toString(10),
        longestPathBytes: Math.max(
          ...files.map((file) => Buffer.byteLength(file.path, 'utf8')),
        ),
      },
      limits: {
        maximumFiles: 1_000_000,
        maximumArtifactBytes: '10737418240',
        maximumPathBytes: 4096,
      },
      authorizedDestination: destinationIdentity,
      candidateDestination: destinationIdentity,
      intent: { manifestDigest: manifest.manifestDigest },
    });
    assert.equal(
      kernelPreflight.verdict,
      'proceed',
      JSON.stringify(kernelPreflight.findings),
    );

    // Adapter-side preflight: the on-disk symlink-escape probe the kernel
    // explicitly defers to this adapter (path-containment.js's own
    // documentation: "a concrete adapter... is responsible for a
    // corroborating on-disk probe").
    const adapterPreflight = await preflight({
      destination: adapterDestination,
      entries: files.map((file) => ({ path: file.path })),
    });
    assert.equal(adapterPreflight.verdict, 'proceed');

    // --- 3. Kernel stage (identity/idempotency fencing) + adapter stage ---
    const artifactId = generateUuidV7();
    const artifactDigest = computeArtifactDigest(files);
    const generationId = generateUuidV7();
    const candidateArtifact = {
      artifactId,
      artifactDigest,
      manifestDigest: /** @type {string} */ (manifest.manifestDigest),
      artifactFileCount: files.length,
      artifactByteCount: Number(totalBytes),
    };
    const operationId = generateUuidV7();
    const attemptId = generateUuidV7();
    const idempotencyKey = generateUuidV7();
    const kernelStage = evaluateStage({
      frozenArtifact: null,
      candidateArtifact,
      preflightDestination: destinationIdentity,
      currentDestination: destinationIdentity,
      journal: [],
      candidateOperation: {
        operationId,
        attemptId,
        idempotencyKey,
        artifactDigest,
      },
    });
    assert.equal(
      kernelStage.verdict,
      'proceed',
      JSON.stringify(kernelStage.findings),
    );
    assert.equal(kernelStage.idempotency.status, 'new');

    const staged = await stage({
      destination: adapterDestination,
      operationId,
      attemptId,
      idempotencyKey,
      generationId,
      artifactId,
      artifactDigest,
      files,
    });
    assert.equal(staged.idempotent, false);
    assert.equal(staged.fileCount, files.length);

    // --- 4. Kernel activate (staged-activation fence + marker validation) -
    const marker = {
      schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
      schemaVersion: '2.0.0',
      artifactId,
      artifactDigest,
      generationId,
    };
    const kernelActivate = evaluateActivate({
      preflightDestination: destinationIdentity,
      currentDestination: destinationIdentity,
      // First-ever publish to this destination: LOCAL-47 requires that
      // expectation to be stated explicitly as EXPECT_NOTHING_SERVED, and
      // the observation (`null` — this destination serves nothing yet) to
      // be passed. Neither an omitted observation nor a `null` expectation
      // is an unfenced proceed any more.
      fence: {
        concurrency: 'expected-generation',
        expectedGenerationId: EXPECT_NOTHING_SERVED,
        observedGenerationId: null,
      },
      marker,
    });
    assert.equal(
      kernelActivate.verdict,
      'proceed',
      JSON.stringify(kernelActivate.findings),
    );
    assert.equal(kernelActivate.activation.decision, 'activate');

    const activation = await activate({
      destination: adapterDestination,
      stageToken: staged.stageToken,
      generationId,
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
      expectedArtifactDigest: artifactDigest,
    });
    assert.equal(activation.decision, 'activate');
    assert.equal(activation.generationId, generationId);

    // --- 5. Kernel observe (ambiguous-outcome discipline) + adapter observe
    const kernelObserve = evaluateObserve({
      outcome: { attempted: true, providerResponded: true, timedOut: false },
      observation: { generationId, artifactDigest },
    });
    assert.equal(kernelObserve.verdict, 'proceed');
    assert.equal(kernelObserve.disposition, 'succeeded');

    const observed = await observe({
      destination: adapterDestination,
      generationId,
      expectedArtifactDigest: artifactDigest,
    });
    assert.equal(observed.verified, true, JSON.stringify(observed.findings));
    assert.equal(observed.currentGenerationId, generationId);
    assert.equal(observed.markerValid, true);
    assert.equal(observed.observedArtifactDigest, artifactDigest);

    // --- 6. Public generation marker: present, schema-shaped, byte-correct
    const markerPath = path.join(
      destinationRoot,
      'releases',
      generationId,
      'gala-generation-marker.json',
    );
    const publishedMarker = JSON.parse(await readFile(markerPath, 'utf8'));
    assert.deepEqual(publishedMarker, marker);

    // --- 7. Byte-identical served output ------------------------------------
    for (const file of files) {
      const servedPath = path.join(
        destinationRoot,
        'releases',
        generationId,
        file.path,
      );
      const servedBytes = await fs.readFile(servedPath);
      assert.ok(
        servedBytes.equals(file.bytes),
        `served bytes for ${file.path} must be byte-identical to the rendered output`,
      );
    }
    // The `current` pointer resolves to exactly the served generation.
    const currentTarget = await fs.readlink(
      path.join(destinationRoot, 'current'),
    );
    assert.equal(currentTarget, path.join('releases', generationId));

    // --- 8. Kernel cleanupStaged + adapter cleanupStaged -------------------
    const kernelCleanup = evaluateCleanupStaged({
      authorizedDestination: destinationIdentity,
      candidateDestination: destinationIdentity,
      priorDisposition: kernelObserve.disposition,
    });
    assert.equal(
      kernelCleanup.verdict,
      'proceed',
      JSON.stringify(kernelCleanup.findings),
    );

    const cleanup = await cleanupStaged({
      destination: adapterDestination,
      stageToken: staged.stageToken,
    });
    assert.equal(typeof cleanup.removed, 'boolean');

    // The activated generation and its marker must survive cleanup untouched.
    const afterCleanupObserve = await observe({
      destination: adapterDestination,
      generationId,
      expectedArtifactDigest: artifactDigest,
    });
    assert.equal(afterCleanupObserve.verified, true);
  } finally {
    await rm(renderRoot, { recursive: true, force: true });
    await rm(destinationRoot, { recursive: true, force: true });
  }
});
