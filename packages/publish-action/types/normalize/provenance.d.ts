/**
 * @param {{package: string, version: string, integrity: string, registry: string}} theme
 *   the resolved theme identity — sourced from `lock.json` via
 *   `buildInput.packages.theme`; there is no separate "theme" input
 * @param {NodeJS.ProcessEnv} [env] the process environment
 * @returns {Promise<{
 *   builder: {package: string, version: string, integrity: string, registry: string},
 *   repositoryCoordinate: string,
 *   workflowIdentity: string,
 *   buildToolVersions: readonly ({kind: 'runtime', name: string, version: string, digest: string} | {kind: 'package', package: string, version: string, digest: string})[]
 * }>} the assembled provenance bundle, matching `template`'s `RenderProvenance`
 *   shape (restated here rather than imported: this package does not add
 *   `template` as an npm dependency -- see `template-bridge.js`)
 */
export function buildProvenance(theme: {
    package: string;
    version: string;
    integrity: string;
    registry: string;
}, env?: NodeJS.ProcessEnv): Promise<{
    builder: {
        package: string;
        version: string;
        integrity: string;
        registry: string;
    };
    repositoryCoordinate: string;
    workflowIdentity: string;
    buildToolVersions: readonly ({
        kind: "runtime";
        name: string;
        version: string;
        digest: string;
    } | {
        kind: "package";
        package: string;
        version: string;
        digest: string;
    })[];
}>;
