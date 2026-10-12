/**
 * The closed destination-adapter artifact catalog admitted by this source-only
 * toolchain. Each entry is the complete package row a managed
 * `gala.lock.json` must carry; partial or locally substituted identities are
 * not admitted.
 *
 * @module
 */

/** Deliberately non-routable registry identity for source-only candidate packages. */
export const ADAPTER_REGISTRY =
  'https://local-development.invalid/rathnasgala2/';

/**
 * @typedef {object} AdapterArtifactCatalogEntry
 * @property {string} adapterId protocol adapter id
 * @property {string} package npm package name
 * @property {string} version exact package version
 * @property {string} integrity `sha256:<hex>` of the deterministic candidate tarball
 * @property {string} registry registry identity
 * @property {string} contractVersion adapter contract version
 * @property {string} compatibleWith admitted adapter contract range
 */

/** @type {readonly AdapterArtifactCatalogEntry[]} */
export const ADAPTER_ARTIFACT_CATALOG = Object.freeze([
  Object.freeze({
    adapterId: 'local-directory',
    package: '@rathnasgala2/adapter-local-directory',
    version: '0.1.1',
    integrity:
      'sha256:aa164d01ca8e2868c8a8df2564950b004bf587830185900cded4f21d4466086f',
    registry: ADAPTER_REGISTRY,
    contractVersion: '2.0.0',
    compatibleWith: '^2.0.0',
  }),
  Object.freeze({
    adapterId: 'github-pages',
    package: '@rathnasgala2/adapter-github-pages',
    version: '0.1.1',
    integrity:
      'sha256:912faa0d12d4c9bfe8791b5650c8280b8f4b26a99b89fde73aca3512ff27f99c',
    registry: ADAPTER_REGISTRY,
    contractVersion: '2.0.0',
    compatibleWith: '^2.0.0',
  }),
  Object.freeze({
    adapterId: 'do-spaces',
    package: '@rathnasgala2/adapter-do-spaces',
    version: '0.1.1',
    integrity:
      'sha256:65e133581ecddc78c3cd0b30d7b0f05dc8fd4294b3a91fb05bd19ad3b5d4ad32',
    registry: ADAPTER_REGISTRY,
    contractVersion: '2.0.0',
    compatibleWith: '^2.0.0',
  }),
]);

/** Package name to protocol adapter id, derived from the authoritative rows. */
export const ADAPTER_PACKAGES = Object.freeze(
  Object.fromEntries(
    ADAPTER_ARTIFACT_CATALOG.map((entry) => [entry.package, entry.adapterId]),
  ),
);

/**
 * @param {string} packageName npm package name
 * @returns {AdapterArtifactCatalogEntry | undefined} the exact catalog row
 */
export function findAdapterArtifact(packageName) {
  return ADAPTER_ARTIFACT_CATALOG.find(
    (entry) => entry.package === packageName,
  );
}

/**
 * Fail closed unless a lock row byte-equals the complete catalog identity.
 *
 * @param {Record<string, unknown>} row selected lock row
 * @param {string} diagnosticPrefix stable caller-specific error prefix
 * @returns {AdapterArtifactCatalogEntry} the matching catalog entry
 */
export function requireAdapterArtifact(row, diagnosticPrefix) {
  const entry =
    typeof row.package === 'string'
      ? findAdapterArtifact(row.package)
      : undefined;
  if (entry === undefined) {
    throw new Error(`${diagnosticPrefix}: selected adapter is not cataloged`);
  }
  const members = [
    'package',
    'version',
    'integrity',
    'registry',
    'contractVersion',
    'compatibleWith',
  ];
  if (
    Object.keys(row).length !== members.length ||
    members.some((member) => !Object.hasOwn(row, member))
  ) {
    throw new Error(
      `${diagnosticPrefix}: ${entry.package} does not carry exactly the catalog package-row members`,
    );
  }
  for (const member of members) {
    if (
      row[member] !==
      entry[/** @type {keyof AdapterArtifactCatalogEntry} */ (member)]
    ) {
      throw new Error(
        `${diagnosticPrefix}: ${entry.package} ${member} does not match the closed artifact catalog`,
      );
    }
  }
  return entry;
}
