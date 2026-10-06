/**
 * The exact theme catalog this toolchain can render: one entry per theme
 * package the repository root installs (`package.json` `devDependencies`,
 * exact-pinned) and `scripts/sandbox-build.sh` exposes to `theme-bridge.js`
 * through `WORKSPACE_ROOT=<toolchain>/node_modules/@rathnasgala2` (the
 * `theme-<name>` sibling step). Each entry states the block an author
 * repository's `gala.lock.json` `theme` member must carry for that theme.
 *
 * `integrity` is the lowercase hex SHA-256 of the registry tarball
 * (`lock:2.0.0`'s `digest` shape, `sha256:<64 hex>`). The build does not
 * recompute it from installed bytes: it only checks the resolved package's
 * `name`/`version` and `theme.json` identity; the digest travels into
 * provenance and the authorization input unchanged. The workspace test
 * `theme-catalog.test.js` keeps this table equal to the installed packages.
 *
 * The catalog is `theme-default` only. `contractVersion` is the theme CONTRACT
 * version (`theme.json` `contractVersion`, which the pinned template compares
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
export const THEME_CATALOG = Object.freeze(
  [
    [
      'default',
      '3.0.0',
      '3.0.0',
      '14cd28618f8f726a319782ca3a126845df5472cb76e2f778e7016ba5f1f56e42',
    ],
  ].map(([slug, version, contractVersion, hex]) =>
    Object.freeze({
      package: `@rathnasgala2/theme-${slug}`,
      version: /** @type {string} */ (version),
      integrity: `sha256:${hex}`,
      registry: THEME_REGISTRY,
      contractVersion: /** @type {string} */ (contractVersion),
      compatibleWith: `^${contractVersion}`,
    }),
  ),
);

/**
 * @param {string} packageName a theme package name
 * @returns {ThemeCatalogEntry | undefined} its catalog entry, if shipped
 */
export function findThemeCatalogEntry(packageName) {
  return THEME_CATALOG.find((entry) => entry.package === packageName);
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
