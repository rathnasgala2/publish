/**
 * The exact vendored-source theme catalog this generation-4 toolchain can
 * render. `scripts/sandbox-build.sh` exposes the packages installed from
 * `vendor/packages/` to `theme-bridge.js` through `WORKSPACE_ROOT`. Each entry
 * states the block an author repository's `gala.lock.json` `theme` member must
 * carry for that theme.
 *
 * `integrity` is the lowercase hex SHA-256 of the candidate tarball produced
 * by the corresponding `vendor/packages/*.tgz` (`lock:2.0.0`'s `digest` shape,
 * `sha256:<64 hex>`). Generation 4 is not published yet, so these values do
 * not claim registry availability or registry-tarball identity. It must be
 * re-verified against registry artifacts before any future publication. The build does not
 * recompute it from installed bytes: it only checks the resolved package's
 * `name`/`version` and `theme.json` identity; the digest travels into
 * provenance and the authorization input unchanged. The workspace test
 * `vendor:check` and `theme-catalog.test.js` keep this table equal to the
 * committed candidate package.
 *
 * `contractVersion` is the theme CONTRACT version (`theme.json` `contractVersion`, which the pinned template compares
 * with its published styling contract), never the package version; the
 * package version and the contract version are independent.
 *
 * @module
 */

/** Deliberately non-routable registry identity for source-only candidate packages. */
export const THEME_REGISTRY = 'https://local-development.invalid/rathnasgala2/';

/**
 * @typedef {object} ThemeCatalogEntry
 * @property {string} package npm package name
 * @property {string} version exact installed version
 * @property {string} integrity `sha256:<hex>` of the candidate tarball
 * @property {string} registry registry URL
 * @property {string} contractVersion the theme contract version (`theme.json` contractVersion)
 * @property {string} compatibleWith semver range over the contract version
 */

/** @type {readonly ThemeCatalogEntry[]} */
export const THEME_CATALOG = Object.freeze([
  Object.freeze({
    package: '@rathnasgala2/theme-default',
    version: '4.0.0',
    integrity:
      'sha256:1d648d8b6cfefd22afdf47a46a0bb1260a7afa1d13990d95329e0230fab176a5',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-amaze',
    version: '4.0.0',
    integrity:
      'sha256:fd9991ca98c3e6be3ae7967a09a989b63c0a20a34eb7fe1d1eb4dd620b179ccb',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-editorial',
    version: '4.0.0',
    integrity:
      'sha256:e3d466a6e579406289a6916e3891b8575119c0cc3a3271dacbf12bbe066b3c5a',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-flashy',
    version: '4.0.0',
    integrity:
      'sha256:8cc1927c55d91bed5a512abc7f2173505c51757910f8c87fa57900f486010a91',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-minimal',
    version: '4.0.0',
    integrity:
      'sha256:19d66ef77b5f4f65d8c5a9d657c8d80fae3638b2f6c50e26f8052a68d9eff791',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-zebra',
    version: '4.0.0',
    integrity:
      'sha256:212b259a7cfd9dbd23c298eb4ac1ee59956904ca85013284048996fb05109be8',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
]);

/**
 * @param {string} packageName a theme package name
 * @returns {ThemeCatalogEntry | undefined} its catalog entry, if shipped
 */
export function findThemeCatalogEntry(packageName) {
  return THEME_CATALOG.find((entry) => entry.package === packageName);
}

/**
 * Fail closed unless a lock theme byte-equals one complete catalog row.
 *
 * @param {Record<string, unknown>} row lock `theme` object
 * @param {string} diagnosticPrefix stable caller-specific error prefix
 * @returns {ThemeCatalogEntry} the matching catalog entry
 */
export function requireThemeArtifact(row, diagnosticPrefix) {
  const entry =
    typeof row.package === 'string'
      ? findThemeCatalogEntry(row.package)
      : undefined;
  if (entry === undefined) {
    throw new Error(`${diagnosticPrefix}: selected theme is not cataloged`);
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
      row[member] !== entry[/** @type {keyof ThemeCatalogEntry} */ (member)]
    ) {
      throw new Error(
        `${diagnosticPrefix}: ${entry.package} ${member} does not match the closed artifact catalog`,
      );
    }
  }
  return entry;
}

/**
 * The package-name part of an `appearance.json` `theme` value
 * (`@scope/name@range` or `@scope/name`).
 *
 * @param {string} themeSpecifier the appearance `theme` value
 * @returns {string} the package name without its range
 */
export function themePackageNameOf(themeSpecifier) {
  const at = themeSpecifier.lastIndexOf('@');
  return at > 0 ? themeSpecifier.slice(0, at) : themeSpecifier;
}
