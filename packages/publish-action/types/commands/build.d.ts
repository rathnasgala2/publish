/**
 * @param {{
 *   repositoryDirectory: string,
 *   outputDirectory: string,
 *   workDirectory: string,
 *   routeNormalizationProfile?: 'directory-index' | 'explicit-file'
 * }} options the build's input/output directories
 * @returns {Promise<import('../types.js').ResultEnvelope & {outputDirectory?: string, manifest?: Record<string, unknown>}>}
 *   the closed result envelope, plus (only on success, for an in-process
 *   caller such as `preview`) the rendered `outputDirectory` and `manifest`
 */
export function runBuild({ repositoryDirectory, outputDirectory, workDirectory, routeNormalizationProfile, }: {
    repositoryDirectory: string;
    outputDirectory: string;
    workDirectory: string;
    routeNormalizationProfile?: "directory-index" | "explicit-file";
}): Promise<import("../types.js").ResultEnvelope & {
    outputDirectory?: string;
    manifest?: Record<string, unknown>;
}>;
