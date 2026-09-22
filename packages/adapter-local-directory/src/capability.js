/**
 * `describeCapabilities`: build and validate this adapter's exact
 * `adapter-capability:2.0.0` declaration for the `local-directory` row
 * (DEC-097 section 7). Every field this adapter's row closes is asserted
 * against `@rathnasgala2/adapter-protocol`'s exact-row table before the
 * declaration is ever returned, so the adapter cannot silently drift from
 * what it truthfully implements.
 *
 * @module
 */

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  ROLLBACK,
  assertValidCapabilityDeclaration,
  domainDigest,
  getCapabilityRow,
} from '@rathnasgala2/adapter-protocol';

import { ALLOWLIST_CATALOG_DIGEST, findAllowlistEntry } from './allowlist.js';
import {
  DOMAIN_ADAPTER_CAPABILITY,
  DOMAIN_LOCAL_CAPABILITY_EVIDENCE,
  DOMAIN_LOCAL_MUTATION_SURFACE,
  DOMAIN_LOCAL_ROOT_IDENTITY,
  DOMAIN_LOCAL_ROOT_PATH,
  DOMAIN_LOCAL_SURFACE_IDENTITY,
} from './constants.js';
import { currentPlatformTuple } from './fs-safety.js';
import { runFilesystemProbe } from './probe.js';

/**
 * This adapter's installed package version, read from its own `package.json`
 * rather than restated by hand: DEC-097 section 3 requires the capability
 * document's `adapter.adapterVersion` to byte-equal the locked package
 * version, and the only value that can never drift from what a lock records
 * for this package is the version the package manifest itself declares.
 */
export const ADAPTER_VERSION = /** @type {string} */ (
  /** @type {{version: string}} */ (
    createRequire(import.meta.url)('../package.json')
  ).version
);

const ROW_OR_UNDEFINED = getCapabilityRow('local-directory');
if (ROW_OR_UNDEFINED === undefined) {
  throw new Error(
    'adapter-protocol does not declare a local-directory capability row',
  );
}
/** The exact DEC-097 admission row for `local-directory`, never `undefined`. */
const ROW = /** @type {NonNullable<ReturnType<typeof getCapabilityRow>>} */ (
  ROW_OR_UNDEFINED
);

/**
 * Compute the two descriptor-derived identity digests DEC-097 defines
 * (`rootIdentityDigest`, `mutationSurfaceDigest`) plus the durable surface
 * identity, from real `stat` device/inode values for `root`.
 *
 * @param {string} root the validated publication root
 * @param {import('node:fs').Stats} rootStats the root's own `stat` result
 * @returns {{
 *   deviceId: string,
 *   rootFileId: string,
 *   surfaceIdentityDigest: string,
 *   rootIdentityDigest: string,
 *   mutationSurfaceDigest: string
 * }} the computed identity digests
 */
function computeIdentityDigests(root, rootStats) {
  const deviceId = String(rootStats.dev);
  const rootFileId = String(rootStats.ino);
  const surfaceIdentityDigest = domainDigest(DOMAIN_LOCAL_SURFACE_IDENTITY, {
    profile: 'gala-local-surface-identity-v2',
    deviceId,
    rootFileId,
  });
  const rootPathDigest = domainDigest(DOMAIN_LOCAL_ROOT_PATH, root);
  const rootIdentityDigest = domainDigest(DOMAIN_LOCAL_ROOT_IDENTITY, {
    rootPathDigest,
    surfaceIdentityDigest,
    deviceId,
    rootFileId,
  });
  const mutationSurfaceDigest = domainDigest(DOMAIN_LOCAL_MUTATION_SURFACE, {
    surfaceIdentityDigest,
    deviceId,
    rootFileId,
  });
  return {
    deviceId,
    rootFileId,
    surfaceIdentityDigest,
    rootIdentityDigest,
    mutationSurfaceDigest,
  };
}

/**
 * Build and validate this adapter's `adapter-capability:2.0.0` declaration,
 * running a live (reduced-iteration, honestly documented) filesystem probe
 * against `destinationRoot` to compute `filesystemEvidenceDigest`.
 *
 * @param {{destinationRoot: string, rootStats: import('node:fs').Stats}} context
 *   the validated destination root and its `stat` result
 * @returns {Promise<Readonly<Record<string, unknown>>>} the validated,
 *   digested capability declaration
 */
export async function describeCapabilities(context) {
  const platform = currentPlatformTuple();
  const allowlistEntry = findAllowlistEntry(platform);
  if (allowlistEntry === undefined) {
    throw new Error(
      `No bundled gala-local-filesystem-allowlist-v2 entry for platform ${JSON.stringify(platform)}`,
    );
  }

  const {
    deviceId,
    rootFileId,
    surfaceIdentityDigest,
    rootIdentityDigest,
    mutationSurfaceDigest,
  } = computeIdentityDigests(context.destinationRoot, context.rootStats);

  const probe = await runFilesystemProbe(
    context.destinationRoot,
    randomUUID().replace(/-/gu, '').slice(0, 16),
  );

  const evidenceWithoutDigest = {
    profile: 'gala-local-directory-capability-evidence-v2',
    adapter: {
      adapterId: 'local-directory',
      adapterVersion: ADAPTER_VERSION,
      adapterDigest: domainDigest('GALA-LOCAL-ADAPTER-IDENTITY-V2\0', {
        name: '@rathnasgala2/adapter-local-directory',
        version: ADAPTER_VERSION,
      }),
    },
    rootIdentityDigest,
    mutationSurfaceDigest,
    surfaceIdentityDigest,
    platform: {
      os: platform.os,
      architecture: platform.architecture,
      kernelRelease: 'any',
      filesystemType: 'any',
      mountFlags: [],
    },
    deviceId,
    rootFileId,
    effectiveUserId: String(process.getuid ? process.getuid() : 0),
    allowlistEntryId: /** @type {{allowlistEntryId: string}} */ (allowlistEntry)
      .allowlistEntryId,
    allowlistDigest: ALLOWLIST_CATALOG_DIGEST,
    probe: {
      sameRootAndReleaseDevice: probe.sameRootAndReleaseDevice,
      rootAndAncestorsNoFollow: probe.rootAndAncestorsNoFollow,
      atomicSymlinkReplacement: probe.atomicSymlinkReplacement,
      exclusiveControlPublication: probe.exclusiveControlPublication,
      directoryFsync: probe.directoryFsync,
      readerIterations: probe.readerIterations,
      replacementIterations: probe.replacementIterations,
      unexpectedReaderOutcomes: probe.unexpectedReaderOutcomes,
      transcriptDigest: probe.transcriptDigest,
    },
    observedAt: new Date().toISOString(),
  };
  const evidenceDigest = domainDigest(
    DOMAIN_LOCAL_CAPABILITY_EVIDENCE,
    evidenceWithoutDigest,
  );

  const declarationWithoutDigest = {
    schemaId: 'urn:gala:schema:adapter-capability:2.0.0',
    schemaVersion: '2.0.0',
    adapter: evidenceWithoutDigest.adapter,
    contractVersion: '2.0.0',
    protocolRange: '^2.0.0',
    destinationKinds: ['local-directory'],
    operations: [
      'activate',
      'cleanup-staged',
      'inspect',
      'observe',
      'rollback',
      'stage',
    ],
    staging: ROW.staging,
    activation: ROW.activation,
    concurrency: ROW.concurrency,
    idempotencyClass: ROW.idempotencyClass,
    rollback: ROLLBACK,
    verification: [...ROW.verification].sort(),
    providerInventoryAssurance: ROW.providerInventoryAssurance,
    configuration: {
      redirects: false,
      headers: false,
      customDomains: false,
      notFoundBehavior: ROW.notFoundBehavior,
      immutableCaching: false,
    },
    cacheInvalidation: 'none',
    limits: {
      transport: 'filesystem',
      filesystemProfile: 'gala-local-directory-filesystem-v2',
      filesystemAllowlistDigest: ALLOWLIST_CATALOG_DIGEST,
      maximumFiles: '1000000',
      maximumFileBytes: '1073741824',
      maximumArtifactBytes: '10737418240',
      maximumProviderCallSeconds: 300,
      maximumPathBytes: 400,
      pathRuleProfile: 'gala-portable-v2',
    },
    filesystemEvidenceDigest: evidenceDigest,
  };

  const capabilityDigest = domainDigest(
    DOMAIN_ADAPTER_CAPABILITY,
    declarationWithoutDigest,
  );
  const declaration = Object.freeze({
    ...declarationWithoutDigest,
    capabilityDigest,
  });

  assertValidCapabilityDeclaration(declaration);
  return declaration;
}
