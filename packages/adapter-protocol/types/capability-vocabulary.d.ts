/**
 * Look up the exact admission row for a candidate `adapterId`.
 *
 * @param {unknown} adapterId candidate adapter identity
 * @returns {AdapterCapabilityRow | undefined} the row, or `undefined` when
 *   `adapterId` is not one of the three closed adapter identities
 */
export function getCapabilityRow(adapterId: unknown): AdapterCapabilityRow | undefined;
/**
 * Test whether two string arrays contain exactly the same members,
 * irrespective of order (the schema's `verification`/`operations` fields are
 * sets, not sequences).
 *
 * @param {readonly string[]} left first set
 * @param {readonly string[]} right second set
 * @returns {boolean} whether the sets are equal
 */
export function isSameSet(left: readonly string[], right: readonly string[]): boolean;
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
export const DESTINATION_KINDS: readonly string[];
/** Exact closed six-member operation set every adapter declares in full. */
export const OPERATIONS: readonly string[];
/** Closed `staging` vocabulary. */
export const STAGING: readonly string[];
/** Closed `activation` vocabulary. */
export const ACTIVATION: readonly string[];
/** Closed `concurrency` vocabulary. */
export const CONCURRENCY: readonly string[];
/** Closed `idempotencyClass` vocabulary. */
export const IDEMPOTENCY_CLASS: readonly string[];
/** `rollback` is a closed constant: every adapter declares only `reupload`. */
export const ROLLBACK: "reupload";
/** Closed `verification` vocabulary (a 1..5 member subset per adapter). */
export const VERIFICATION: readonly string[];
/** Closed `providerInventoryAssurance` vocabulary. */
export const PROVIDER_INVENTORY_ASSURANCE: readonly string[];
/** `cacheInvalidation` is a closed constant: every adapter declares `none`. */
export const CACHE_INVALIDATION: "none";
/** Ordered closed set of `adapterConfigurationCapabilities` boolean keys. */
export const CONFIGURATION_KEYS: readonly string[];
/** Closed `limits.transport` vocabulary. */
export const TRANSPORTS: readonly string[];
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
export const ADAPTER_CAPABILITY_ROWS: Readonly<Record<string, AdapterCapabilityRow>>;
export type AdapterCapabilityRow = Readonly<{
    adapterId: "local-directory" | "github-pages" | "do-spaces";
    destinationKind: "local-directory" | "github-pages" | "do-spaces";
    staging: string;
    activation: string;
    concurrency: string;
    idempotencyClass: string;
    verification: readonly string[];
    providerInventoryAssurance: string;
    transport: "filesystem" | "http";
    notFoundBehavior: boolean;
}>;
