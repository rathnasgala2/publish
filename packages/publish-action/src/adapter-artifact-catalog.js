/**
 * The closed destination-adapter artifact catalog admitted by this
 * toolchain. Each entry is the complete package row a managed
 * `gala.lock.json` must carry; partial or locally substituted identities are
 * not admitted.
 *
 * @module
 */

/** The registry the adapter packages are published to. */
export const ADAPTER_REGISTRY = 'https://registry.npmjs.org/';

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
export const ADAPTER_ARTIFACT_CATALOG = Object.freeze([
  Object.freeze({
    adapterId: 'local-directory',
    package: '@rathnasgala2/adapter-local-directory',
    version: '0.1.1',
    integrity:
      'sha256:099520db91121c33df84eea8f6140c007910680d31910246f0674f4415305117',
    registry: ADAPTER_REGISTRY,
    contractVersion: '2.0.0',
    compatibleWith: '^2.0.0',
  }),
  Object.freeze({
    adapterId: 'github-pages',
    package: '@rathnasgala2/adapter-github-pages',
    version: '0.1.1',
    integrity:
      'sha256:ab1deb308aa6712baa2461c4aacae613f666fe7054a74817a60f980f74edf554',
    registry: ADAPTER_REGISTRY,
    contractVersion: '2.0.0',
    compatibleWith: '^2.0.0',
  }),
  Object.freeze({
    adapterId: 'do-spaces',
    package: '@rathnasgala2/adapter-do-spaces',
    version: '0.1.1',
    integrity:
      'sha256:6721febd237202e67367f688eec308443ee685b673e9bddb60b2861f6c471a4d',
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
