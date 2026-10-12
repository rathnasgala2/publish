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
    version: '4.1.0',
    integrity:
      'sha256:f503eb5d69d515673d2bef43b6cd9cf768f2cee76747055be9c4931a8100ffdb',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-amaze',
    version: '4.1.0',
    integrity:
      'sha256:2a110bc353f3d6d0ed985460cb5ba14304580b0015527dce9bf2cdcf3a7b0178',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-editorial',
    version: '4.1.0',
    integrity:
      'sha256:b515433aacbac3845cf72dfe049bc2391b46928b6294f0a921380b3e1ff0ee23',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-flashy',
    version: '4.1.0',
    integrity:
      'sha256:21ff5baae2edaf01bdb8028d7c24735d4e63fddc6fe6dd40d4bf882f96841297',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-minimal',
    version: '4.1.0',
    integrity:
      'sha256:1101af185789ffec2ea433418e7ffa5bb72c4f50672eedf7b775d3e5f73d504c',
    registry: THEME_REGISTRY,
    contractVersion: '4.0.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-zebra',
    version: '4.1.0',
    integrity:
      'sha256:f3b3ea16c825cabac8bf4fac3c31fca40baa199566b900b9be00212db3ed544c',
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
