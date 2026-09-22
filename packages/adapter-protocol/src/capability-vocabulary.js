/**
 * The closed, lower-case `adapter-capability:2.0.0` vocabulary and the
 * exhaustive three-row admission table (DEC-097 section 7; slice brief
 * S2-author-owned-publication.md section 5, "Closed lower-case capability
 * root"). Every array here is exact — a set of admitted values, not an
 * example — and mirrors `@rathnasgala2/schemas`'
 * `schemas/adapter-capability.schema.json` without re-authoring it; the
 * schema package remains the authoritative wire validator (see
 * `capability.js`). This module exists so the kernel, an adapter and a test
 * can reference the same closed vocabulary and exact rows without invoking
 * Ajv for a plain membership or row-equality check.
 *
 * @module
 */

/** Exact closed set of destination kinds (`destinationKinds` is a 1-item set). */
export const DESTINATION_KINDS = Object.freeze([
  'local-directory',
  'github-pages',
  'do-spaces',
]);

/** Exact closed six-member operation set every adapter declares in full. */
export const OPERATIONS = Object.freeze([
  'inspect',
  'stage',
  'activate',
  'observe',
  'cleanup-staged',
  'rollback',
]);

/** Closed `staging` vocabulary. */
export const STAGING = Object.freeze([
  'none',
  'private',
  'preview',
  'unreachable-generation',
]);

/** Closed `activation` vocabulary. */
export const ACTIVATION = Object.freeze([
  'replace-in-place',
  'pointer-swap',
  'provider-promotion',
  'branch-update',
]);

/** Closed `concurrency` vocabulary. */
export const CONCURRENCY = Object.freeze([
  'none',
  'best-effort',
  'expected-generation',
  'provider-etag',
]);

/** Closed `idempotencyClass` vocabulary. */
export const IDEMPOTENCY_CLASS = Object.freeze([
  'provider-key',
  'observable-identity',
  'none',
]);

/** `rollback` is a closed constant: every adapter declares only `reupload`. */
export const ROLLBACK = 'reupload';

/** Closed `verification` vocabulary (a 1..5 member subset per adapter). */
export const VERIFICATION = Object.freeze([
  'provider-state',
  'origin-http',
  'public-http',
  'artifact-digest',
  'generation-marker',
]);

/** Closed `providerInventoryAssurance` vocabulary. */
export const PROVIDER_INVENTORY_ASSURANCE = Object.freeze([
  'none',
  'complete-artifact-digest',
]);

/** `cacheInvalidation` is a closed constant: every adapter declares `none`. */
export const CACHE_INVALIDATION = 'none';

/** Ordered closed set of `adapterConfigurationCapabilities` boolean keys. */
export const CONFIGURATION_KEYS = Object.freeze([
  'redirects',
  'headers',
  'customDomains',
  'notFoundBehavior',
  'immutableCaching',
]);

/** Closed `limits.transport` vocabulary. */
export const TRANSPORTS = Object.freeze(['filesystem', 'http']);

/**
 * @typedef {Readonly<{
 *   adapterId: 'local-directory' | 'github-pages' | 'do-spaces',
 *   destinationKind: 'local-directory' | 'github-pages' | 'do-spaces',
 *   staging: string,
 *   activation: string,
 *   concurrency: string,
 *   idempotencyClass: string,
 *   verification: readonly string[],
 *   providerInventoryAssurance: string,
 *   transport: 'filesystem' | 'http',
 *   notFoundBehavior: boolean
 * }>} AdapterCapabilityRow
 */

/**
 * The exhaustive DEC-097 section 7 admission table: exact set equality, not
 * examples. Every other `adapterId`/field combination is invalid.
 *
 * @type {Readonly<Record<string, AdapterCapabilityRow>>}
 */
export const ADAPTER_CAPABILITY_ROWS = Object.freeze({
  'local-directory': Object.freeze({
    adapterId: 'local-directory',
    destinationKind: 'local-directory',
    staging: 'unreachable-generation',
    activation: 'pointer-swap',
    concurrency: 'expected-generation',
    idempotencyClass: 'observable-identity',
    verification: Object.freeze([
      'provider-state',
      'artifact-digest',
      'generation-marker',
    ]),
    providerInventoryAssurance: 'complete-artifact-digest',
    transport: 'filesystem',
    notFoundBehavior: false,
  }),
  'github-pages': Object.freeze({
    adapterId: 'github-pages',
    destinationKind: 'github-pages',
    staging: 'private',
    activation: 'provider-promotion',
    concurrency: 'none',
    idempotencyClass: 'observable-identity',
    verification: Object.freeze([
      'provider-state',
      'public-http',
      'generation-marker',
    ]),
    providerInventoryAssurance: 'none',
    transport: 'http',
    notFoundBehavior: false,
  }),
  'do-spaces': Object.freeze({
    adapterId: 'do-spaces',
    destinationKind: 'do-spaces',
    staging: 'private',
    activation: 'replace-in-place',
    concurrency: 'best-effort',
    idempotencyClass: 'observable-identity',
    verification: Object.freeze([
      'provider-state',
      'public-http',
      'generation-marker',
    ]),
    providerInventoryAssurance: 'none',
    transport: 'http',
    notFoundBehavior: true,
  }),
});

/**
 * Look up the exact admission row for a candidate `adapterId`.
 *
 * @param {unknown} adapterId candidate adapter identity
 * @returns {AdapterCapabilityRow | undefined} the row, or `undefined` when
 *   `adapterId` is not one of the three closed adapter identities
 */
export function getCapabilityRow(adapterId) {
  if (
    typeof adapterId !== 'string' ||
    !Object.hasOwn(ADAPTER_CAPABILITY_ROWS, adapterId)
  ) {
    return undefined;
  }
  return ADAPTER_CAPABILITY_ROWS[
    /** @type {keyof typeof ADAPTER_CAPABILITY_ROWS} */ (adapterId)
  ];
}

/**
 * Test whether two string arrays contain exactly the same members,
 * irrespective of order (the schema's `verification`/`operations` fields are
 * sets, not sequences).
 *
 * @param {readonly string[]} left first set
 * @param {readonly string[]} right second set
 * @returns {boolean} whether the sets are equal
 */
export function isSameSet(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  const rightSorted = [...right].sort();
  return [...left].sort().every((value, index) => value === rightSorted[index]);
}
