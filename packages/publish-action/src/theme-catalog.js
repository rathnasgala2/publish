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
 * `theme-amaze` joins at 2.1.0 (its 2.0.0 carried contractVersion 2.0.0, which
 * the pinned template 2.2.0 refuses with `THEME_CONTRACT_VERSION_MISMATCH`).
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
 * @property {string} contractVersion the theme's own `theme.json` contractVersion
 * @property {string} compatibleWith semver range over the contract version
 */

/** @type {readonly ThemeCatalogEntry[]} */
export const THEME_CATALOG = Object.freeze(
  [
    [
      'amaze',
      '2.1.0',
      '147ae7d085c9126d8f74460ce442ae572d25de649f56d7a1ecc1f50f8c06e64a',
    ],
    [
      'default',
      '2.1.0',
      'eebb5a7e51bc068dc40db9d9fd2a82f71332e2af7d00d820d5ae9f49e482c870',
    ],
    [
      'flashy',
      '2.1.0',
      '8bd8af4e782a7fc25e89692da6690a70445ab495ea47cf836bbd184c4dc249c8',
    ],
    [
      'minimal',
      '2.1.0',
      'fb3c8c2d326f9013a4bf695b2f24db939bb2e553a81c2e255061a8b69963fcb0',
    ],
    [
      'zebra',
      '2.1.0',
      '14fe1a8e29dbeee08c639a195c895ea45fa29e0d0a1165ea52e1b16f9fe87988',
    ],
  ].map(([slug, version, hex]) =>
    Object.freeze({
      package: `@rathnasgala2/theme-${slug}`,
      version: /** @type {string} */ (version),
      integrity: `sha256:${hex}`,
      registry: THEME_REGISTRY,
      contractVersion: /** @type {string} */ (version),
      compatibleWith: `^${version}`,
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
