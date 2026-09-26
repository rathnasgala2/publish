/**
 * Resolve one real installed package's identity via Node's own module
 * resolution (`import.meta.resolve`), rooted at this module (so it follows
 * this package's own `node_modules`/workspace symlinks).
 *
 * @param {string} packageName an npm package name resolvable from this
 *   package's own dependency graph
 * @returns {Promise<{package: string, version: string, integrity: string, registry: string}>}
 *   the resolved package identity
 */
export function resolveInstalledPackageIdentity(packageName: string): Promise<{
    package: string;
    version: string;
    integrity: string;
    registry: string;
}>;
/**
 * Resolve `@rathnasgala2/template`'s identity from the sibling repository
 * root `template-bridge.js` resolves (not an npm dependency of this
 * workspace; see that module's documentation).
 *
 * @returns {Promise<{package: string, version: string, integrity: string, registry: string}>}
 *   `@rathnasgala2/template`'s identity
 */
export function resolveTemplatePackageIdentity(): Promise<{
    package: string;
    version: string;
    integrity: string;
    registry: string;
}>;
