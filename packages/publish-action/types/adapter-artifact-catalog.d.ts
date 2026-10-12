/**
 * @param {string} packageName npm package name
 * @returns {AdapterArtifactCatalogEntry | undefined} the exact catalog row
 */
export function findAdapterArtifact(packageName: string): AdapterArtifactCatalogEntry | undefined;
/**
 * Fail closed unless a lock row byte-equals the complete catalog identity.
 *
 * @param {Record<string, unknown>} row selected lock row
 * @param {string} diagnosticPrefix stable caller-specific error prefix
 * @returns {AdapterArtifactCatalogEntry} the matching catalog entry
 */
export function requireAdapterArtifact(row: Record<string, unknown>, diagnosticPrefix: string): AdapterArtifactCatalogEntry;
/**
 * The closed destination-adapter artifact catalog admitted by this
 * toolchain. Each entry is the complete package row a managed
 * `gala.lock.json` must carry; partial or locally substituted identities are
 * not admitted.
 *
 * @module
 */
/** The registry the adapter packages are published to. */
export const ADAPTER_REGISTRY: "https://registry.npmjs.org/";
/**
 * @typedef {object} AdapterArtifactCatalogEntry
 * @property {string} adapterId protocol adapter id
 * @property {string} package npm package name
 * @property {string} version exact package version
 * @property {string} integrity `sha256:<hex>` of the registry tarball (the exact deterministic pack)
 * @property {string} registry registry identity
 * @property {string} contractVersion adapter contract version
 * @property {string} compatibleWith admitted adapter contract range
 */
/** @type {readonly AdapterArtifactCatalogEntry[]} */
export const ADAPTER_ARTIFACT_CATALOG: readonly AdapterArtifactCatalogEntry[];
/** Package name to protocol adapter id, derived from the authoritative rows. */
export const ADAPTER_PACKAGES: Readonly<{
    [k: string]: string;
}>;
export type AdapterArtifactCatalogEntry = {
    /**
     * protocol adapter id
     */
    adapterId: string;
    /**
     * npm package name
     */
    package: string;
    /**
     * exact package version
     */
    version: string;
    /**
     * `sha256:<hex>` of the registry tarball (the exact deterministic pack)
     */
    integrity: string;
    /**
     * registry identity
     */
    registry: string;
    /**
     * adapter contract version
     */
    contractVersion: string;
    /**
     * admitted adapter contract range
     */
    compatibleWith: string;
};
