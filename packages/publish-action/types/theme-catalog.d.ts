/**
 * @param {string} packageName a theme package name
 * @returns {ThemeCatalogEntry | undefined} its catalog entry, if shipped
 */
export function findThemeCatalogEntry(packageName: string): ThemeCatalogEntry | undefined;
/**
 * The package-name part of an `appearance.json` `theme` value
 * (`@scope/name@range` or `@scope/name`).
 *
 * @param {string} themeSpecifier the appearance `theme` value
 * @returns {string} the package name without its range
 */
export function themePackageNameOf(themeSpecifier: string): string;
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
export const THEME_REGISTRY: "https://registry.npmjs.org/";
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
export const THEME_CATALOG: readonly ThemeCatalogEntry[];
export type ThemeCatalogEntry = {
    /**
     * npm package name
     */
    package: string;
    /**
     * exact installed version
     */
    version: string;
    /**
     * `sha256:<hex>` of the registry tarball
     */
    integrity: string;
    /**
     * registry URL
     */
    registry: string;
    /**
     * the theme's own `theme.json` contractVersion
     */
    contractVersion: string;
    /**
     * semver range over the contract version
     */
    compatibleWith: string;
};
