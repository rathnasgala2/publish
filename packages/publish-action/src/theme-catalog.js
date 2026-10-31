/**
 * The exact theme catalog this generation-4 toolchain can render: one entry per
 * theme package the repository root installs (`package.json` `devDependencies`,
 * exact-pinned, resolved from the public registry) and
 * `scripts/sandbox-build.sh` exposes to `theme-bridge.js` through
 * `WORKSPACE_ROOT=<toolchain>/node_modules/@rathnasgala2`. Each entry states
 * the block an author repository's `gala.lock.json` `theme` member must carry
 * for that theme.
 *
 * `integrity` is the lowercase hex SHA-256 of the registry tarball
 * (`lock:2.0.0`'s `digest` shape, `sha256:<64 hex>`), cross-checked against the
 * registry's `dist.integrity`. The build does not recompute it from installed
 * bytes: it only checks the resolved package's `name`/`version` and
 * `theme.json` identity; the digest travels into provenance and the
 * authorization input unchanged. The workspace test `theme-catalog.test.js`
 * keeps this table equal to the installed packages and the lockfile.
 *
 * `contractVersion` is the theme CONTRACT version (`theme.json` `contractVersion`, which the pinned template compares
 * with its published styling contract), never the package version; the
 * package version and the contract version are independent.
 *
 * @module
 */

/** The registry every catalog entry was published to. */
export const THEME_REGISTRY = 'https://registry.npmjs.org/';

/**
 * @typedef {object} ThemeCatalogEntry
 * @property {string} package npm package name
 * @property {string} version exact installed version
 * @property {string} integrity `sha256:<hex>` of the registry tarball
 * @property {string} registry registry URL
 * @property {string} contractVersion the theme contract version (`theme.json` contractVersion)
 * @property {string} compatibleWith semver range over the contract version
 */

/** @type {readonly ThemeCatalogEntry[]} */
export const THEME_CATALOG = Object.freeze([
  Object.freeze({
    package: '@rathnasgala2/theme-default',
    version: '4.2.0',
    integrity:
      'sha256:d4eb5dd5b0ca12391d82cfce8da2ec351bf1b9438bd99fb7a534a0249ab09885',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-amaze',
    version: '4.2.1',
    integrity:
      'sha256:cad8096c6b1fd0716185bea9179be03c2d7443de1612c63256e531f4632a4e24',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-editorial',
    version: '4.2.1',
    integrity:
      'sha256:6bf3b9c2f525268901ebf8b0432e1310c12bd1539d8d40fbacf6cddb5e1b3a4b',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-flashy',
    version: '4.2.0',
    integrity:
      'sha256:d01ffdd8d915046aab3195eb8a489313e3df5d8a70d29433df7b7cf94c0b23cd',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-minimal',
    version: '4.2.0',
    integrity:
      'sha256:875c5f8e7d817622ac6e51443a96c4dd552a7a638114e91acaf836f8e93b1f2e',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-zebra',
    version: '4.2.0',
    integrity:
      'sha256:f8411cf8004775545d171b48599eb9e3427476969dd67216380143df0e65446b',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
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
