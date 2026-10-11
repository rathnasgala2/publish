/**
 * @param {string} packageName a theme package name
 * @returns {ThemeCatalogEntry | undefined} its catalog entry, if shipped
 */
export function findThemeCatalogEntry(packageName: string): ThemeCatalogEntry | undefined;
/**
 * Fail closed unless a lock theme byte-equals one complete catalog row.
 *
 * @param {Record<string, unknown>} row lock `theme` object
 * @param {string} diagnosticPrefix stable caller-specific error prefix
 * @returns {ThemeCatalogEntry} the matching catalog entry
 */
export function requireThemeArtifact(row: Record<string, unknown>, diagnosticPrefix: string): ThemeCatalogEntry;
/**
 * The package-name part of an `appearance.json` `theme` value
 * (`@scope/name@range` or `@scope/name`).
 *
 * @param {string} themeSpecifier the appearance `theme` value
 * @returns {string} the package name without its range
 */
export function themePackageNameOf(themeSpecifier: string): string;
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
export const THEME_REGISTRY: "https://local-development.invalid/rathnasgala2/";
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
     * `sha256:<hex>` of the candidate tarball
     */
    integrity: string;
    /**
     * registry URL
     */
    registry: string;
    /**
     * the theme contract version (`theme.json` contractVersion)
     */
    contractVersion: string;
    /**
     * semver range over the contract version
     */
    compatibleWith: string;
};
