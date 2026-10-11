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
 * The catalog is `theme-default`, `theme-flashy`, `theme-minimal` and
 * `theme-zebra`. `contractVersion` is the theme CONTRACT
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
    [
      'amaze',
      '3.0.0',
      '3.0.0',
      '1bd8e24e111f275cd8e015d3e1c50057c4b18135bddbb1cbfb4a54c6d341a904',
    ],
    [
      'flashy',
      '3.0.0',
      '3.0.0',
      '17587b37798a7ab0ac1707d51537287a0fb25765431f8b2ba9a043f764acf71d',
    ],
    [
      'minimal',
      '3.0.0',
      '3.0.0',
      'fcbae44196d2d14786b0f8822bd9a2265c4fcb3b229f167fdc396239032f7edb',
    ],
    [
      'zebra',
      '3.0.0',
      '3.0.0',
      '6eb28b304fbc5216f224dce7480863ea21d02c6ed5723cef75a7168dfddf9c52',
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
