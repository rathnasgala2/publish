/**
 * A schema-valid `artifact-manifest:2.0.0` for any fixture file set, and the
 * real `gala-frozen-envelope-v2` built over it — so every suite that needs
 * "the frozen envelope" holds one whose manifest inventory, provenance and
 * SBOM records are real records over real bytes with real DEC-097 section 8
 * digests, never a hex-shaped placeholder.
 *
 * The manifest here is what the template's renderer would emit for these
 * files: the inventory, counts and the four section 8 digests are computed
 * exactly as the schema package recomputes them, and everything else is a
 * fixed, schema-valid provenance skeleton (the lock is the
 * `publish-action` minimal-repository fixture's, re-pointed at the adapter
 * under test).
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBuildInputFromRepository } from '@rathnasgala2/publish-action';
import { resolveWorkspaceSibling } from '../../packages/publish-action/src/workspace-siblings.js';
import { validateGalaDocument } from '@rathnasgala2/schemas';
import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import { buildProvenanceRecord } from '../../scripts/workflow/build-provenance.mjs';
import {
  compareUtf8,
  decodeFrozenEnvelope,
  encodeFrozenEnvelope,
  jcsBytes,
  manifestDigestOf,
  manifestInventory,
} from '../../scripts/workflow/frozen-envelope.mjs';
import { buildSbom } from '../../scripts/workflow/sbom.mjs';
import { deriveStableId } from '../../scripts/workflow/workload-identity.mjs';

const LOCK_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/publish-action/test/fixtures/minimal-repository/gala.lock.json',
);

/** The closed extension projections the fixture manifest uses. */
const ROUTE_CLASSES = Object.freeze({
  '.html': ['html', 'text/html; charset=utf-8'],
  '.xml': ['sitemap', 'application/xml; charset=utf-8'],
  '.atom': ['feed', 'application/atom+xml; charset=utf-8'],
});
const ASSET_MEDIA_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
});

/**
 * A runner identity complete enough for the provenance record.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RUNNER_IDENTITY = Object.freeze({
  GITHUB_REPOSITORY: 'gala-author/site',
  GITHUB_REPOSITORY_ID: '4242',
  GITHUB_REPOSITORY_OWNER: 'gala-author',
  GITHUB_REPOSITORY_OWNER_ID: '99',
  GITHUB_REF: 'refs/heads/gala/publish/019c0000-0000-7000-8000-000000000001',
  GITHUB_RUN_ID: '987654321',
  GITHUB_RUN_NUMBER: '12',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_EVENT_NAME: 'create',
  GITHUB_ACTOR: 'gala-author',
  GITHUB_ACTOR_ID: '77',
});

/**
 * @param {string} text the text
 * @returns {string} its tagged digest
 */
function digestOf(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * The fixture lock with its adapter row re-pointed at one package.
 *
 * @param {string} [adapterPackage] the adapter package the lock selects
 *   (default: the fixture's own `adapter-local-directory`)
 * @param {(lock: Record<string, any>) => void} [mutate] a further mutation
 * @returns {Record<string, any>} the lock document
 */
export function fixtureLock(adapterPackage, mutate) {
  const lock = JSON.parse(readFileSync(LOCK_FIXTURE, 'utf8'));
  if (adapterPackage !== undefined) {
    lock.publisher = lock.publisher.map((/** @type {any} */ row) =>
      row.package.startsWith('@rathnasgala2/adapter-') &&
      row.package !== '@rathnasgala2/adapter-protocol'
        ? { ...row, package: adapterPackage }
        : row,
    );
  }
  mutate?.(lock);
  return lock;
}

/**
 * @param {{package: string, version: string, integrity: string, registry: string}} row
 *   a lock row
 * @returns {{package: string, version: string, integrity: string, registry: string}}
 *   its four-member identity
 */
function identity(row) {
  return {
    package: row.package,
    version: row.version,
    integrity: row.integrity,
    registry: row.registry,
  };
}

/**
 * Build a schema-valid manifest over one file set.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the artifact files
 * @param {{
 *   lock?: Record<string, any>,
 *   sourceCommit?: string,
 *   repositoryId?: string,
 *   repositoryOwnerId?: string,
 *   repository?: string,
 *   generatedAt?: string,
 *   buildInputDigest?: string
 * }} [options] the provenance skeleton overrides; `buildInputDigest` ties
 *   the manifest to a real build input (`fixtureBuildFacts`)
 * @returns {Record<string, any>} the manifest, validated against the schema root
 */
export function manifestFor(files, options = {}) {
  const lock = options.lock ?? fixtureLock();
  const sourceCommit = options.sourceCommit ?? `sha1:${'a'.repeat(40)}`;
  const sorted = [...files].sort((left, right) =>
    compareUtf8(left.path, right.path),
  );
  /** @type {Record<string, unknown>[]} */
  const routes = [];
  /** @type {Record<string, unknown>[]} */
  const assets = [];
  for (const file of sorted) {
    const extension = path.posix.extname(file.path);
    const entry = {
      path: file.path,
      byteLength: String(file.bytes.byteLength),
      sha256: `sha256:${createHash('sha256').update(file.bytes).digest('hex')}`,
    };
    const route =
      ROUTE_CLASSES[/** @type {keyof typeof ROUTE_CLASSES} */ (extension)];
    if (route !== undefined) {
      routes.push({
        path: entry.path,
        mediaType: route[1],
        byteLength: entry.byteLength,
        sha256: entry.sha256,
        routeClass: route[0],
        interactionBearing: false,
      });
    } else {
      assets.push({
        path: entry.path,
        mediaType:
          ASSET_MEDIA_TYPES[
            /** @type {keyof typeof ASSET_MEDIA_TYPES} */ (extension)
          ] ?? 'application/octet-stream',
        byteLength: entry.byteLength,
        sha256: entry.sha256,
        immutable: false,
      });
    }
  }
  const publisher = lock.publisher.map(identity);
  const includedSources = [
    {
      path: 'content/hello.md',
      sha256: digestOf('content/hello.md'),
      sourceRevision: sourceCommit,
      role: 'content',
    },
  ];
  /** @type {Record<string, any>} */
  const manifest = {
    schemaId: 'urn:gala:schema:artifact-manifest:2.0.0',
    schemaVersion: '2.0.0',
    repositoryNodeId: options.repositoryId ?? '4242',
    sourceCommit,
    workflowIdentity: digestOf('workflow-identity'),
    buildToolVersions: [
      {
        kind: 'runtime',
        name: 'node',
        version: '24.18.0',
        digest: digestOf('node'),
      },
      {
        kind: 'runtime',
        name: 'npm',
        version: '11.16.0',
        digest: digestOf('npm'),
      },
      ...[lock.schemas, lock.template, lock.theme, ...lock.publisher].map(
        (/** @type {any} */ row) => ({
          kind: 'package',
          package: row.package,
          version: row.version,
          digest: digestOf(`${row.package}@${row.version}`),
        }),
      ),
    ],
    buildInputDigest: options.buildInputDigest ?? digestOf('build-input'),
    artifactDigest: '',
    routes,
    assets,
    findings: [],
    measurements: [],
    policyResult: 'pass',
    generatedAt: options.generatedAt ?? '2026-09-17T00:00:00.000Z',
    reproducibilityClass: 'byte-identical',
    artifactId: deriveStableId('gala-fixture-manifest-artifact-id', {
      files: sorted.map((file) => file.path),
    }),
    artifactFileCount: String(sorted.length),
    artifactByteCount: String(
      sorted.reduce((total, file) => total + file.bytes.byteLength, 0),
    ),
    sourceIdentity: {
      provider: 'github',
      repository: options.repository ?? 'gala-author/site',
      repositoryId: options.repositoryId ?? '4242',
      repositoryOwnerId: options.repositoryOwnerId ?? '99',
      commit: sourceCommit,
      treeDigest: digestOf('tree'),
    },
    builder: publisher[0],
    composition: {
      schemas: identity(lock.schemas),
      template: identity(lock.template),
      theme: identity(lock.theme),
      publisher,
      enabledModuleConfigurationDigests: [],
    },
    buildInputContractVersion: '2.0.0',
    redirects: [],
    declarativeHeaders: [],
    includedSources,
    excludedInputs: [],
    sourceInventoryDigest: /** @type {any} */ (
      ACTIVE_DIGEST_PROFILES.sourceInventory
    ).digest({ includedSources, excludedInputs: [] }),
    validation: {
      profile: 'gala-artifact-validation-v2',
      version: '2.0.0',
      findingCount: 0,
      evidenceDigest: '',
    },
    manifestDigest: '',
  };
  manifest.artifactDigest = manifestInventory(manifest).artifactDigest;
  manifest.validation.evidenceDigest = /** @type {any} */ (
    ACTIVE_DIGEST_PROFILES.artifactValidationEvidence
  ).digest(manifest);
  manifest.manifestDigest = manifestDigestOf(manifest);
  const verdict = validateGalaDocument(
    'urn:gala:schema:artifact-manifest:2.0.0',
    manifest,
  );
  if (!verdict.valid) {
    throw new Error(
      `fixture manifest is not schema-valid: ${JSON.stringify(verdict.diagnostics)}`,
    );
  }
  return manifest;
}

/**
 * The build's two validated fact records for the fixture repository
 * (`build-facts.mjs`): the real `build-input:2.0.0` `publish-action`'s own
 * normalizer produces from the minimal repository with its lock re-pointed
 * at one adapter, and the real `theme-contract:2.0.0` of the theme package
 * that lock pins (the `theme-default` sibling). Computed once per adapter;
 * a manifest tied to them is `manifestFor(files, {buildInputDigest})`.
 *
 * @param {string} [adapterPackage] the adapter package the lock selects
 * @returns {Promise<{buildInput: Record<string, any>, themeContract: Record<string, any>}>}
 *   the two records
 */
export async function fixtureBuildFacts(adapterPackage) {
  const key = adapterPackage ?? 'default';
  const cached = BUILD_FACTS.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const repository = await mkdtemp(path.join(tmpdir(), 'gala-fixture-repo-'));
  try {
    await cp(path.dirname(LOCK_FIXTURE), repository, { recursive: true });
    await writeFile(
      path.join(repository, 'gala.lock.json'),
      JSON.stringify(fixtureLock(adapterPackage), null, 2),
    );
    const buildInput = /** @type {Record<string, any>} */ (
      await buildBuildInputFromRepository({ repositoryDirectory: repository })
    );
    const themeContract = JSON.parse(
      await readFile(
        path.join(resolveWorkspaceSibling('theme-default'), 'theme.json'),
        'utf8',
      ),
    );
    const facts = { buildInput, themeContract };
    BUILD_FACTS.set(key, facts);
    return facts;
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
}

/** @type {Map<string, {buildInput: Record<string, any>, themeContract: Record<string, any>}>} */
const BUILD_FACTS = new Map();

/**
 * The two predecessor handoffs the provenance record retains.
 *
 * @returns {{verified: import('../../scripts/workflow/build-provenance.mjs').CarrierHandoff, unfrozen: import('../../scripts/workflow/build-provenance.mjs').CarrierHandoff}}
 *   the fixture handoffs
 */
export function fixtureHandoffs() {
  return {
    verified: {
      purpose: 'verified-inputs',
      artifactId: '5101',
      name: 'gala-r987654321-a1-verified-inputs-v2.bin',
      byteCount: '4096',
      digest: digestOf('verified-inputs'),
      expiresAt: '2026-09-18T00:00:00.000Z',
    },
    unfrozen: {
      purpose: 'unfrozen-output',
      artifactId: '5102',
      name: 'gala-r987654321-a1-unfrozen-output-v2.bin',
      byteCount: '2048',
      digest: digestOf('unfrozen-output'),
      expiresAt: '2026-09-18T00:00:00.000Z',
    },
  };
}

/**
 * Build one real frozen envelope over a file set: manifest, provenance and
 * SBOM records included, every digest recomputed by the decoder.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the artifact files
 * @param {{
 *   lock?: Record<string, any>,
 *   runner?: Readonly<Record<string, string | undefined>>,
 *   manifest?: Record<string, any>
 * }} [options] the lock, the runner identity and a pre-built manifest
 * @returns {{
 *   bytes: Buffer,
 *   decoded: import('../../scripts/workflow/frozen-envelope.mjs').DecodedFrozenEnvelope,
 *   manifest: Record<string, any>,
 *   provenance: Record<string, unknown>,
 *   sbom: Record<string, unknown>,
 *   lock: Record<string, any>
 * }} the envelope and its records
 */
export function frozenEnvelopeFor(files, options = {}) {
  const lock = options.lock ?? fixtureLock();
  const manifest = options.manifest ?? manifestFor(files, { lock });
  const sbom = buildSbom({ manifest, lock, files });
  const handoffs = fixtureHandoffs();
  const provenance = buildProvenanceRecord({
    runner: options.runner ?? RUNNER_IDENTITY,
    sourceCommit: manifest.sourceCommit,
    workflowTriggerCommit: manifest.sourceCommit,
    verifiedInputHandoff: handoffs.verified,
    unfrozenOutputHandoff: handoffs.unfrozen,
    lockDigest: lock.lockDigest,
    buildInputDigest: manifest.buildInputDigest,
    artifactDigest: manifest.artifactDigest,
    manifestDigest: manifest.manifestDigest,
    sbomDigest: `sha256:${createHash('sha256').update(jcsBytes(sbom)).digest('hex')}`,
  });
  const bytes = encodeFrozenEnvelope({ files, manifest, provenance, sbom });
  return {
    bytes,
    decoded: decodeFrozenEnvelope(bytes),
    manifest,
    provenance,
    sbom,
    lock,
  };
}
