/**
 * @param {string} outputDirectory the rendered candidate output directory
 * @param {Record<string, unknown>} manifest the `artifact-manifest:2.0.0` instance
 * @returns {Promise<{path: string, bytes: Buffer}[]>} the complete file set
 */
export function readManifestFileBytes(outputDirectory: string, manifest: Record<string, unknown>): Promise<{
    path: string;
    bytes: Buffer;
}[]>;
