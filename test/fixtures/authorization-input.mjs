/**
 * One complete, contract-valid `deployment-intent` authorization input, the
 * document `freeze` hands to `authorize` and the only input the exchange
 * builder reads.
 *
 * Every digest here is a real digest over real fixture bytes rather than a
 * hex-shaped placeholder, so a test that passes is a test where the builder
 * committed to something it could have computed.
 *
 * Since schema 2.9.0 (LOCAL-60) the input carries only what the workflow
 * holds: no `destination.environment`/`targetDigest`, no Spaces provider
 * coordinates, none of `rebuildRecord`'s four Gala-owned members and no
 * `capabilityDecisionDigest` — the API derives each of those, and the fake
 * Gala in `fake-gala-api.mjs` derives them the same way.
 *
 * @module
 */

import { createHash } from 'node:crypto';

import { computeArtifactDigest } from '@rathnasgala2/adapter-local-directory';

import { deriveArtifactFacts } from '../../scripts/workflow/workload-requests.mjs';
import { frozenEnvelopeFor } from './artifact-manifest.mjs';

/** The fixture artifact: three files, one of every route class that matters. */
export const ARTIFACT_FILES = Object.freeze([
  { path: 'index.html', bytes: Buffer.from('<!doctype html><p>one', 'utf8') },
  {
    path: 'about/index.html',
    bytes: Buffer.from('<!doctype html><p>two', 'utf8'),
  },
  { path: 'assets/site.css', bytes: Buffer.from('body{color:#111}', 'utf8') },
]);

/**
 * @param {string} text the text to digest
 * @returns {string} the tagged digest
 */
function digestOf(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * The request-side provider binding each adapter sends on its destination
 * (schema 2.9.0 `ReceiptExchangeIntentRequestProviderBinding`): the
 * runner-bound repository coordinates for `github-pages`, the two DEC-097
 * section 7 local evidence digests for `local-directory`, and nothing for
 * `do-spaces` (the buckets and region are Gala's destination record, C2).
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>> | undefined>>}
 */
export const PROVIDER_BINDINGS = Object.freeze({
  'github-pages': Object.freeze({
    owner: 'gala-author',
    repository: 'site',
  }),
  'do-spaces': undefined,
  'local-directory': Object.freeze({
    rootIdentityDigest: digestOf('local-root-identity'),
    mutationSurfaceDigest: digestOf('local-mutation-surface'),
  }),
});

/**
 * The retained `destination.providerBinding` Gala renders per adapter
 * (LOCAL-55 (2)): the Pages coordinates, the Spaces buckets and region from
 * Gala's destination record, none for `local-directory`.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>> | undefined>>}
 */
export const RETAINED_PROVIDER_BINDINGS = Object.freeze({
  'github-pages': PROVIDER_BINDINGS['github-pages'],
  'do-spaces': Object.freeze({
    region: 'nyc3',
    servedBucket: 'gala-served-disposable',
    stagingBucket: 'gala-staging-disposable',
  }),
  'local-directory': undefined,
});

/**
 * The retained `destinationIdentity` for one adapter, as the API renders it
 * from its own record: the five required members (the adapter's environment
 * constant, LOCAL-60a) plus the retained provider binding where the adapter
 * has one. For a deploy-side test that needs "what Gala authorized" rather
 * than "what the workflow sent".
 *
 * @param {'local-directory' | 'github-pages' | 'do-spaces'} adapterId the adapter
 * @param {{baseUrl?: string}} [overrides] a public base URL a fixture provider dictates
 * @returns {Record<string, unknown>} the retained destination identity
 */
export function retainedDestinationFor(adapterId, overrides = {}) {
  const binding = RETAINED_PROVIDER_BINDINGS[adapterId];
  return {
    environment: adapterId,
    adapterId,
    adapterVersion: '0.1.0',
    targetDigest: digestOf(`destination:${adapterId}`),
    baseUrl: overrides.baseUrl ?? 'https://example.test/',
    ...(binding === undefined ? {} : { providerBinding: { ...binding } }),
  };
}

/**
 * The adapter and request-side destination identities for one adapter: the
 * three required destination members plus the adapter's request-side
 * `providerBinding` where it has one.
 *
 * @param {'local-directory' | 'github-pages' | 'do-spaces'} adapterId the adapter
 * @param {{baseUrl?: string, providerBinding?: Record<string, string>}} [overrides]
 *   a public base URL or provider binding a fixture provider dictates
 * @returns {{adapter: Record<string, unknown>, destination: Record<string, unknown>}}
 *   the adapter and destination identities
 */
export function destinationFor(adapterId, overrides = {}) {
  const binding = overrides.providerBinding ?? PROVIDER_BINDINGS[adapterId];
  return {
    adapter: {
      adapterId,
      // The adapter's published package version (PUBLISH-S4-6a single-source
      // rule; LOCAL-64: the admission row is keyed on it).
      adapterVersion: '0.1.0',
      adapterDigest: digestOf(`adapter:${adapterId}`),
    },
    destination: {
      adapterId,
      adapterVersion: '0.1.0',
      baseUrl: overrides.baseUrl ?? 'https://example.test/',
      ...(binding === undefined ? {} : { providerBinding: { ...binding } }),
    },
  };
}

/**
 * Build one complete authorization input.
 *
 * @param {{
 *   adapterId?: 'local-directory' | 'github-pages' | 'do-spaces',
 *   operationId: string,
 *   repositoryId?: string,
 *   runId?: string,
 *   runAttempt?: number,
 *   files?: readonly {path: string, bytes: Buffer}[],
 *   artifactDigest?: string,
 *   destination?: {baseUrl?: string, providerBinding?: Record<string, string>}
 * }} options the fixture options. `artifactDigest` is the digest the
 *   adapter under test recomputes over `files` (each adapter has its own
 *   artifact projection); it defaults to `local-directory`'s.
 * @returns {Record<string, unknown>} the authorization input
 */
export function authorizationInput(options) {
  const adapterId = options.adapterId ?? 'local-directory';
  const files = options.files ?? ARTIFACT_FILES;
  // The envelope is the real one: its manifest, provenance and SBOM records
  // are built over these bytes, so `manifestDigest`, `provenanceDigest`,
  // `sbomDigest`, the envelope digest and byte count are the values `freeze`
  // would derive for exactly this artifact.
  const envelope = frozenEnvelopeFor(files);
  const artifact = deriveArtifactFacts(files, envelope.manifest);
  const sourceCommit = `sha1:${'a'.repeat(40)}`;
  return {
    purpose: 'deployment-intent',
    operationId: options.operationId,
    repositoryId: options.repositoryId ?? '4242',
    runId: options.runId ?? '987654321',
    runAttempt: options.runAttempt ?? 1,
    sourceCommit,
    workflowTriggerCommit: sourceCommit,
    // The artifact digest is the one an adapter will actually recompute
    // from these bytes, not a hex-shaped placeholder: the kernel's duty 1
    // and the adapter's own activation check both compare against it, so a
    // fixture that invented one would prove nothing.
    artifactDigest: options.artifactDigest ?? computeArtifactDigest(files),
    manifestDigest: artifact.manifestDigest,
    artifactByteCount: artifact.artifactByteCount,
    artifactFileCount: artifact.artifactFileCount,
    verificationSubmission: artifact.verificationSubmission,
    frozenEnvelopeDigest: envelope.decoded.frozenEnvelopeDigest,
    frozenEnvelopeByteCount: envelope.decoded.frozenEnvelopeByteCount,
    frozenHandoffArtifactId: '5150',
    frozenHandoffName: 'gala-r987654321-a1-frozen-envelope-v2.bin',
    provenanceDigest: envelope.decoded.provenanceDigest,
    sbomDigest: envelope.decoded.sbomDigest,
    lockDigest: digestOf('lock'),
    requestedArtifactRetentionDays: 7,
    effectiveArtifactExpiresAt: '2026-09-24T00:00:00.000Z',
    // The request-side rebuild record (2.9.0): the seventeen members the
    // workflow holds; the four Gala-owned members are the API's.
    rebuildRecord: {
      contractVersion: '2.0.0',
      repositoryId: options.repositoryId ?? '4242',
      sourceCommit,
      sourceTree: `sha1:${'b'.repeat(40)}`,
      repositoryRootDigest: digestOf('repository-root'),
      buildEpoch: '2026-09-17T00:00:00.000Z',
      buildInputDigest: digestOf('build-input'),
      dependencyLockDigest: digestOf('lock'),
      stylingContractDigest: digestOf('styling-contract'),
      workflowIdentity: digestOf('workflow-identity'),
      baseUrl: 'https://example.test/',
      basePath: '/',
      builder: {
        package: '@rathnasgala2/publish-action',
        version: '0.1.0',
        integrity: digestOf('publish-action'),
        registry: 'https://registry.npmjs.org/',
      },
      schemas: {
        package: '@rathnasgala2/schemas',
        version: '2.9.0',
        integrity: digestOf('schemas'),
        registry: 'https://registry.npmjs.org/',
      },
      template: {
        package: '@rathnasgala2/template',
        version: '0.1.0',
        integrity: digestOf('template'),
        registry: 'https://registry.npmjs.org/',
      },
      theme: {
        package: '@rathnasgala2/theme-default',
        version: '0.1.0',
        integrity: digestOf('theme'),
        registry: 'https://registry.npmjs.org/',
      },
      renderPolicy: {
        name: 'gala-render-policy',
        version: '2.0.0',
        digest: digestOf('render-policy'),
      },
    },
    publisher: {
      package: '@rathnasgala2/publish-action',
      version: '0.1.0',
      integrity: digestOf('publish-action'),
      registry: 'https://registry.npmjs.org/',
    },
    ...destinationFor(adapterId, options.destination),
  };
}
