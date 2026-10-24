/**
 * End-to-end test (S2-T17 deliverable (d)): a candidate directory produced
 * by the merged `@rathnasgala2/template` renderer (`renderPublication`)
 * goes through `publish-kernel`'s preflight/stage/activate/observe/cleanup
 * duties composed with this package's real POSIX `local-directory`
 * lifecycle calls, and the result is checked for a valid public generation
 * marker plus byte-identical served output.
 *
 * `@rathnasgala2/template` is consumed through its package entry. In an
 * isolated publish checkout, `WORKSPACE_ROOT` points at the registry-installed
 * packages installed under `node_modules/@rathnasgala2`; local development
 * may still use the adjacent v2 source tree.
 *
 * `template@2.1.0` publishes `computeRenderPolicyIdentity` and
 * `computeBodyDigest` from its public entry point (`src/core/index.js`), so
 * this test no longer reaches into `src/core/internal/content-security.js`
 * (PUB-H5's deferred half, closed once `template` shipped the public
 * helper).
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
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

const THEME_ROOT = process.env.GALA_THEME_DIR
  ? path.resolve(process.env.GALA_THEME_DIR)
  : path.resolve(TEMPLATE_ROOT, '../theme-default');

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
  const schemaSibling = path.resolve(TEMPLATE_ROOT, '../schema');
  const schemasRoot = await fs
    .access(path.join(schemaSibling, 'package.json'))
    .then(() => schemaSibling)
    .catch(() => path.resolve(TEMPLATE_ROOT, '../schemas'));
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
  buildInput.appearance.theme = '@rathnasgala2/theme-default@4.2.0';
  buildInput.packages.schemas.version = '3.19.0';
  buildInput.packages.template.version = '4.4.1';
  buildInput.packages.theme = {
    ...buildInput.packages.theme,
    package: '@rathnasgala2/theme-default',
    version: '4.2.0',
    integrity:
      'sha256:d4eb5dd5b0ca12391d82cfce8da2ec351bf1b9438bd99fb7a534a0249ab09885',
  };

  const { computeBodyDigest, computeRenderPolicyIdentity } =
    await importTemplateModule('src/core/index.js');
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
        version: '3.19.0',
        digest: digest(3),
      },
      {
        kind: 'package',
        package: '@rathnasgala2/template',
        version: '4.4.1',
        digest: digest(4),
      },
      {
        kind: 'package',
        package: '@rathnasgala2/theme-default',
        version: '4.2.0',
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

/**
 * A real, decodable solid-colour square PNG (8-bit RGB), so the template's
 * media pipeline can decode it and measure it as square.
 *
 * @param {number} size the side in pixels
 * @param {[number, number, number]} rgb the fill colour
 * @returns {Buffer} the PNG file
 */
function squarePng(size, rgb) {
  /** @type {(type: string, data: Buffer) => Buffer} */
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: size }, () => rgb).flat()),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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

    // The advanced-SEO inputs: a default social image, a square brand mark,
    // the AI crawler block and a profile link, as the publish toolchain's
    // repository intake now produces them (PNG files under the source tree).
    await fs.mkdir(path.join(sourceDirectory, 'assets'), { recursive: true });
    const defaultImageBytes = squarePng(64, [20, 90, 160]);
    const brandMarkBytes = squarePng(32, [200, 60, 40]);
    await writeFile(
      path.join(sourceDirectory, 'assets/default.png'),
      defaultImageBytes,
    );
    await writeFile(
      path.join(sourceDirectory, 'assets/mark.png'),
      brandMarkBytes,
    );
    const sha256 = (/** @type {Buffer} */ bytes) =>
      createHash('sha256').update(bytes).digest('hex');
    const seoInput = /** @type {any} */ (buildInput);
    seoInput.publication.defaultImage = {
      path: 'assets/default.png',
      sourceDigest: `sha256:${sha256(defaultImageBytes)}`,
    };
    seoInput.publication.crawlers = { ai: 'block' };
    seoInput.publication.socialLinks = [
      ...seoInput.publication.socialLinks,
      { type: 'mastodon', uri: 'https://example.social/@fixture' },
    ];
    seoInput.appearance.brandMark = {
      path: 'assets/mark.png',
      sourceDigest: `sha256:${sha256(brandMarkBytes)}`,
    };
    const { outputDirectory, manifest } = await renderPublication(buildInput, {
      outputDirectory: path.join(renderRoot, 'output'),
      workDirectory: path.join(renderRoot, 'work'),
      sourceDirectory,
      provenance: testProvenance(),
      themeDirectory: THEME_ROOT,
    });
    assert.ok(Array.isArray(manifest.routes) && manifest.routes.length > 0);

    const files = await Promise.all(
      /** @type {{path: string}[]} */ (manifest.routes).map(async (route) => ({
        path: route.path,
        bytes: await fs.readFile(path.join(outputDirectory, route.path)),
      })),
    );
    const adapterDestination = { root: destinationRoot };

    // --- 1b. The advanced-SEO output of the rendered site -------------------
    const text = (/** @type {{bytes: Buffer}} */ file) =>
      file.bytes.toString('utf8');
    const pages = files.filter((file) => file.path.endsWith('.html'));
    const defaultImageHex = sha256(defaultImageBytes);
    assert.ok(
      pages.some((page) =>
        new RegExp(
          `<meta property="og:image" content="[^"]*assets/media/${defaultImageHex}/original\\.png"`,
          'u',
        ).test(text(page)),
      ),
      'a page carries og:image for the default image',
    );
    assert.ok(
      pages.some((page) => /<link rel="icon" href="[^"]+"/u.test(text(page))),
      'a page carries the brand mark as <link rel="icon">',
    );
    assert.ok(
      pages.some(
        (page) =>
          text(page).includes('"sameAs"') &&
          text(page).includes('https://example.social/@fixture'),
      ),
      'structured data lists the social links as sameAs',
    );
    const robots = files.find((file) => file.path === 'robots.txt');
    assert.ok(robots, 'robots.txt is part of the output');
    assert.match(text(robots), /User-agent: GPTBot\nDisallow: \//u);
    assert.match(text(robots), /User-agent: ClaudeBot\nDisallow: \//u);
    assert.match(text(robots), /User-agent: \*\nAllow: \//u);

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
