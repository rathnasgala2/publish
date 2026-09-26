/**
 * Resolve the workspace root directory that contains this repository's
 * sibling checkouts: `WORKSPACE_ROOT` (DEC-015 name) when set to a
 * non-empty string, otherwise the fixed relative default from this
 * module's own file location -- unless this module is running from inside
 * a `node_modules` tree, in which case the relative default is refused
 * (PUB-H8) and `WORKSPACE_ROOT` is mandatory.
 *
 * @param {NodeJS.ProcessEnv} [env] the process environment (injectable for
 *   tests; defaults to `process.env`)
 * @returns {string} the absolute workspace root directory
 */
export function resolveWorkspaceRoot(env?: NodeJS.ProcessEnv): string;
/**
 * Resolve one named sibling repository checkout's absolute directory under
 * {@link resolveWorkspaceRoot}. This does not check the directory actually
 * exists — callers that require existence check it themselves (typically
 * as one candidate among several, or to raise
 * {@link WorkspaceSiblingNotFoundError} when it does not).
 *
 * @param {string} siblingName the sibling repository's directory name
 *   (e.g. `template`, `theme-default`)
 * @param {NodeJS.ProcessEnv} [env] the process environment (injectable for
 *   tests; defaults to `process.env`)
 * @returns {string} the absolute candidate directory
 */
export function resolveWorkspaceSibling(siblingName: string, env?: NodeJS.ProcessEnv): string;
/**
 * A workspace-sibling env override (`WORKSPACE_ROOT`) was set but is not an
 * absolute path, or the relative default was reached from inside a
 * `node_modules` tree with no override set.
 */
export class WorkspaceRootInvalidError extends Error {
    /**
     * @param {string} detail human-readable detail
     */
    constructor(detail: string);
    /** @type {string} */
    code: string;
}
/**
 * A named workspace sibling repository could not be found on disk at the
 * resolved location. Always names `WORKSPACE_ROOT` in its message so the
 * fix is discoverable without reading this module's source.
 */
export class WorkspaceSiblingNotFoundError extends Error {
    /**
     * @param {string} siblingName the sibling directory name that was sought
     *   (e.g. `template`, `theme-default`)
     * @param {string} searchedDirectory the absolute directory that was
     *   checked and not found
     */
    constructor(siblingName: string, searchedDirectory: string);
    siblingName: string;
    searchedDirectory: string;
}
