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
    version: '0.1.3',
    integrity:
      'sha256:cfdd7ac565a886814820b39a70b3e485785e05f3f5f78e093545383936536e63',
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

// previous-releases:begin
/** @type {readonly AdapterArtifactCatalogEntry[]} */
export const ADAPTER_PREVIOUS_RELEASES = Object.freeze([
  Object.freeze({
    adapterId: 'github-pages',
    package: '@rathnasgala2/adapter-github-pages',
    version: '0.1.2',
    integrity:
      'sha256:384c2ea89c2bf55828a0da7d6c0e5ecd2c7431546a3544d9e14661c2b11a878f',
    registry: ADAPTER_REGISTRY,
    contractVersion: '2.0.0',
    compatibleWith: '^2.0.0',
  }),
]);
// previous-releases:end

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
 * @param {string} packageName npm package name
 * @param {readonly AdapterArtifactCatalogEntry[]} [previous] previous release
 *   rows; the catalog's own list unless a test supplies one
 * @returns {readonly AdapterArtifactCatalogEntry[]} every admitted row of the
 *   package: the installed row first, then the previous rows
 */
export function admittedAdapterArtifacts(
  packageName,
  previous = ADAPTER_PREVIOUS_RELEASES,
) {
  const installed = findAdapterArtifact(packageName);
  return installed === undefined
    ? []
    : [installed, ...previous.filter((entry) => entry.package === packageName)];
}

/**
 * @param {string} packageName npm package name
 * @param {string} version exact package version
 * @param {readonly AdapterArtifactCatalogEntry[]} [previous] previous release rows
 * @returns {boolean} whether the version is an admitted release of the package
 */
export function isAdmittedAdapterVersion(
  packageName,
  version,
  previous = ADAPTER_PREVIOUS_RELEASES,
) {
  return admittedAdapterArtifacts(packageName, previous).some(
    (entry) => entry.version === version,
  );
}

const ROW_MEMBERS = [
  'package',
  'version',
  'integrity',
  'registry',
  'contractVersion',
  'compatibleWith',
];

/**
 * Fail closed unless a lock row byte-equals the complete identity of an
 * admitted row: the installed row or a previous release row.
 *
 * @param {Record<string, unknown>} row selected lock row
 * @param {string} diagnosticPrefix stable caller-specific error prefix
 * @param {readonly AdapterArtifactCatalogEntry[]} [previous] previous release rows
 * @returns {AdapterArtifactCatalogEntry} the matching catalog entry
 */
export function requireAdapterArtifact(
  row,
  diagnosticPrefix,
  previous = ADAPTER_PREVIOUS_RELEASES,
) {
  const entry =
    typeof row.package === 'string'
      ? findAdapterArtifact(row.package)
      : undefined;
  if (entry === undefined) {
    throw new Error(`${diagnosticPrefix}: selected adapter is not cataloged`);
  }
  if (
    Object.keys(row).length !== ROW_MEMBERS.length ||
    ROW_MEMBERS.some((member) => !Object.hasOwn(row, member))
  ) {
    throw new Error(
      `${diagnosticPrefix}: ${entry.package} does not carry exactly the catalog package-row members`,
    );
  }
  const admitted = admittedAdapterArtifacts(entry.package, previous).find(
    (candidate) =>
      ROW_MEMBERS.every(
        (member) =>
          row[member] ===
          candidate[/** @type {keyof AdapterArtifactCatalogEntry} */ (member)],
      ),
  );
  if (admitted !== undefined) {
    return admitted;
  }
  // Report against the row the lock names when it is an admitted version, so
  // the diagnostic points at the member that differs; otherwise the installed row.
  const reference =
    admittedAdapterArtifacts(entry.package, previous).find(
      (candidate) => candidate.version === row.version,
    ) ?? entry;
  for (const member of ROW_MEMBERS) {
    if (
      row[member] !==
      reference[/** @type {keyof AdapterArtifactCatalogEntry} */ (member)]
    ) {
      throw new Error(
        `${diagnosticPrefix}: ${entry.package} ${member} does not match the closed artifact catalog`,
      );
    }
  }
  throw new Error(
    `${diagnosticPrefix}: ${entry.package} does not match the closed artifact catalog`,
  );
}
