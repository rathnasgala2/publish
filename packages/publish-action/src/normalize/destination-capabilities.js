/**
 * Build `build-input:2.0.0`'s `destinationCapabilities`
 * (`destinationCapabilityProfile`: `{adapter, baseUrl, capabilityDigest}`)
 * from the adapter the repository's lock selects, without touching any
 * real destination.
 *
 * DEC-097 section 5 requires `destinationCapabilities.adapter` to byte-equal
 * the selected complete `adapter-capability.adapter` identity, and section
 * 3 defines that identity as the lock's projection: the adapter id of the
 * one locked adapter package under the closed package-to-id mapping, the
 * locked package version as `adapterVersion` and the locked integrity as
 * `adapterDigest`. So the lock — not a package this repository happens to
 * install, and never a fixed `local-directory` stand-in — is the only
 * source of the adapter identity here, and `baseUrl` is the publication's
 * canonical base exactly as section 5 binds it.
 *
 * `validate` and `build` never mutate anything (the `npx` subcommands never
 * deploy at all — S2 brief section 5), so this cannot call the real
 * adapter's `describeCapabilities` against a concrete destination root
 * (that call idempotently bootstraps control directories on disk, a write
 * `validate` in particular must never perform). `capabilityDigest` is
 * therefore a side-effect-free digest over the adapter's own closed
 * exact-row capability declaration (`adapter-protocol`'s
 * `getCapabilityRow`) for the selected id; the richer live
 * `adapter-capability:2.0.0` document (with real filesystem or provider
 * evidence) is only ever produced later, by the adapter's own
 * `describeCapabilities`, immediately before staging.
 *
 * @module
 */

import { createHash } from 'node:crypto';

import { getCapabilityRow } from '@rathnasgala2/adapter-protocol';

/**
 * The closed DEC-097 section 3 package-to-adapter-id mapping. The selected
 * row must match in both directions; no alias is admitted.
 */
export const ADAPTER_PACKAGES = Object.freeze({
  '@rathnasgala2/adapter-local-directory': 'local-directory',
  '@rathnasgala2/adapter-github-pages': 'github-pages',
  '@rathnasgala2/adapter-do-spaces': 'do-spaces',
});

/**
 * @param {string} value value to digest
 * @returns {string} a domain-separated `sha256:` digest
 */
function digest(value) {
  const hash = createHash('sha256');
  hash.update('GALA-PUBLISH-ACTION-STATIC-CAPABILITY-V2\0', 'utf8');
  hash.update(value, 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Select the one adapter row of a lock's `publisher` closure.
 *
 * @param {{publisher: readonly {package: string, version: string, integrity: string}[]}} lock
 *   the validated `lock:2.0.0` document
 * @returns {{package: string, version: string, integrity: string}} the
 *   selected adapter row
 */
export function selectLockedAdapterRow(lock) {
  const rows = lock.publisher.filter((row) =>
    Object.hasOwn(ADAPTER_PACKAGES, row.package),
  );
  if (rows.length !== 1) {
    throw new Error(
      `LOCK_ADAPTER_SELECTION_INVALID: the lock must select exactly one adapter package (found ${rows.length}: ${rows
        .map((row) => row.package)
        .join(', ')})`,
    );
  }
  return /** @type {{package: string, version: string, integrity: string}} */ (
    rows[0]
  );
}

/**
 * Build the `destinationCapabilityProfile` for the adapter the lock selects.
 *
 * @param {{
 *   lock: {publisher: readonly {package: string, version: string, integrity: string}[]},
 *   baseUrl: string
 * }} input the validated lock and the publication's canonical base
 * @returns {{
 *   adapter: {adapterId: string, adapterVersion: string, adapterDigest: string},
 *   baseUrl: string,
 *   capabilityDigest: string
 * }} the destination-capability profile
 */
export function destinationCapabilitiesFromLock(input) {
  const row = selectLockedAdapterRow(input.lock);
  const adapterId =
    ADAPTER_PACKAGES[
      /** @type {keyof typeof ADAPTER_PACKAGES} */ (row.package)
    ];
  const capabilityRow = getCapabilityRow(adapterId);
  if (capabilityRow === undefined) {
    throw new Error(
      `LOCK_ADAPTER_SELECTION_INVALID: adapter-protocol declares no capability row for ${adapterId}`,
    );
  }
  return {
    adapter: {
      adapterId,
      // DEC-097 section 3: the version byte-equals the locked package
      // version and the digest byte-equals the locked integrity.
      adapterVersion: row.version,
      adapterDigest: row.integrity,
    },
    baseUrl: input.baseUrl,
    capabilityDigest: digest(JSON.stringify(capabilityRow)),
  };
}
