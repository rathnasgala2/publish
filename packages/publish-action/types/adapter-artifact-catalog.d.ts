/**
 * @param {string} packageName npm package name
 * @returns {AdapterArtifactCatalogEntry | undefined} the exact catalog row
 */
export function findAdapterArtifact(packageName: string): AdapterArtifactCatalogEntry | undefined;
/**
 * @param {string} packageName npm package name
 * @param {readonly AdapterArtifactCatalogEntry[]} [previous] previous release
 *   rows; the catalog's own list unless a test supplies one
 * @returns {readonly AdapterArtifactCatalogEntry[]} every admitted row of the
 *   package: the installed row first, then the previous rows
 */
export function admittedAdapterArtifacts(packageName: string, previous?: readonly AdapterArtifactCatalogEntry[]): readonly AdapterArtifactCatalogEntry[];
/**
 * @param {string} packageName npm package name
 * @param {string} version exact package version
 * @param {readonly AdapterArtifactCatalogEntry[]} [previous] previous release rows
 * @returns {boolean} whether the version is an admitted release of the package
 */
export function isAdmittedAdapterVersion(packageName: string, version: string, previous?: readonly AdapterArtifactCatalogEntry[]): boolean;
/**
 * Fail closed unless a lock row byte-equals the complete identity of an
 * admitted row: the installed row or a previous release row.
 *
 * @param {Record<string, unknown>} row selected lock row
 * @param {string} diagnosticPrefix stable caller-specific error prefix
 * @param {readonly AdapterArtifactCatalogEntry[]} [previous] previous release rows
 * @returns {AdapterArtifactCatalogEntry} the matching catalog entry
 */
export function requireAdapterArtifact(row: Record<string, unknown>, diagnosticPrefix: string, previous?: readonly AdapterArtifactCatalogEntry[]): AdapterArtifactCatalogEntry;
/**
 * The closed destination-adapter artifact catalog admitted by this
 * toolchain. Each entry is the complete package row a managed
 * `gala.lock.json` must carry; partial or locally substituted identities are
 * not admitted.
 *
 * Each adapter package has one INSTALLED row (`ADAPTER_ARTIFACT_CATALOG`: the
 * release this toolchain's workspace installs and runs) and at most one
 * PREVIOUS row (`ADAPTER_PREVIOUS_RELEASES`: the release before it, admitted so
 * locks that still pin it stay publishable after an adapter release). An
 * adapter release moves the old installed row into the previous list
 * (`scripts/release/update-adapter-catalog.mjs`). The previous list may be
 * empty.
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
/** @type {readonly AdapterArtifactCatalogEntry[]} */
export const ADAPTER_PREVIOUS_RELEASES: readonly AdapterArtifactCatalogEntry[];
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
