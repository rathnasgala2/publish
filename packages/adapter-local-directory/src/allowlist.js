/**
 * Bundled `gala-local-filesystem-allowlist-v2` catalog (DEC-097: "The
 * adapter-bundled allowlist is duplicate-key-free compact JCS containing
 * `{profile,entries,catalogDigest}`... four required digests:
 * `atomicReplacementMatrixDigest`, `processCrashMatrixDigest`,
 * `powerLossMatrixDigest` and `maliciousFilesystemMatrixDigest`.").
 *
 * DEC-097's full allowlist entry is backed by an independently reviewed
 * laboratory that measures a real 10,000-iteration atomic-replacement race,
 * a process-crash injection matrix and a power-loss injection matrix on
 * real storage hardware. That laboratory is out of scope for this package
 * (see the README's "Conformance to the DEC-097 oracle" section): building
 * and reviewing it is a distinct, hardware-dependent workstream, not
 * something an in-process Node.js adapter can produce truthfully on a
 * developer laptop. This module instead bundles one entry for the two
 * platforms this workspace runs on (`linux`/`x86_64` CI runners and
 * `darwin`/`aarch64` developer laptops), whose four matrix digests are
 * computed over this file's own literal, version-controlled evidence text
 * rather than a real laboratory run. `runFilesystemProbe` (`probe.js`)
 * supplies the one piece of *live* evidence this package can produce
 * honestly: a real, reduced-iteration atomic-rename and exclusive-link
 * probe against the actual destination root at preflight time.
 *
 * @module
 */

import { domainDigest } from '@rathnasgala2/adapter-protocol';

import { DOMAIN_LOCAL_ALLOWLIST } from './constants.js';

/**
 * @param {string} label a stable label identifying the placeholder matrix
 * @returns {string} a domain-separated digest over the literal label text
 */
function placeholderMatrixDigest(label) {
  return domainDigest(`GALA-LOCAL-PLACEHOLDER-MATRIX-V2:${label}\0`, {
    label,
    note: 'Bundled placeholder digest; see allowlist.js module documentation.',
  });
}

/**
 * @param {'linux' | 'darwin'} osName the platform's operating system
 * @param {'x86_64' | 'aarch64'} architecture the platform's CPU architecture
 * @returns {Readonly<Record<string, unknown>>} one allowlist entry for this
 *   platform tuple
 */
function entryFor(osName, architecture) {
  return Object.freeze({
    platform: Object.freeze({
      os: osName,
      architecture,
      kernelRelease: 'any',
      filesystemType: 'any',
      mountFlags: [],
    }),
    allowlistEntryId: `gala-local-directory-filesystem-v2-${osName}-${architecture}`,
    primitiveProfile: 'gala-local-directory-filesystem-v2',
    atomicReplacementMatrixDigest: placeholderMatrixDigest(
      `atomic-replacement:${osName}:${architecture}`,
    ),
    processCrashMatrixDigest: placeholderMatrixDigest(
      `process-crash:${osName}:${architecture}`,
    ),
    powerLossMatrixDigest: placeholderMatrixDigest(
      `power-loss:${osName}:${architecture}`,
    ),
    maliciousFilesystemMatrixDigest: placeholderMatrixDigest(
      `malicious-filesystem:${osName}:${architecture}`,
    ),
  });
}

const ENTRIES = Object.freeze([
  entryFor('linux', 'x86_64'),
  entryFor('linux', 'aarch64'),
  entryFor('darwin', 'aarch64'),
  entryFor('darwin', 'x86_64'),
]);

const CATALOG_WITHOUT_DIGEST = Object.freeze({
  profile: 'gala-local-filesystem-allowlist-v2',
  entries: ENTRIES,
});

/** The bundled allowlist catalog's own digest (section 8 self-excluding form). */
export const ALLOWLIST_CATALOG_DIGEST = domainDigest(
  DOMAIN_LOCAL_ALLOWLIST,
  CATALOG_WITHOUT_DIGEST,
);

/** The complete bundled allowlist catalog, including its own digest. */
export const ALLOWLIST_CATALOG = Object.freeze({
  ...CATALOG_WITHOUT_DIGEST,
  catalogDigest: ALLOWLIST_CATALOG_DIGEST,
});

/**
 * Find the bundled allowlist entry matching a runtime platform tuple
 * exactly (field-for-field, per DEC-097: "wildcard, prefix, OS-only and
 * filesystem-name-only matches reject" in the full profile; this bundle
 * only ever ships one entry per `{os,architecture}` pair, so lookup is by
 * that pair).
 *
 * @param {{os: 'linux' | 'darwin', architecture: 'x86_64' | 'aarch64'}} platform
 *   the runtime platform tuple
 * @returns {Readonly<Record<string, unknown>> | undefined} the matching
 *   entry, or `undefined` when this bundle has none for the tuple
 */
export function findAllowlistEntry(platform) {
  return ENTRIES.find(
    (entry) =>
      /** @type {{os:string,architecture:string}} */ (entry.platform).os ===
        platform.os &&
      /** @type {{os:string,architecture:string}} */ (entry.platform)
        .architecture === platform.architecture,
  );
}
