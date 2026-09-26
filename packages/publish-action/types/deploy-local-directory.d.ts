/**
 * Deploy a rendered candidate directory to a `local-directory` destination
 * through the kernel/adapter composition, and return every fact the
 * Action's result envelope and outputs need.
 *
 * @param {{
 *   outputDirectory: string,
 *   manifest: Record<string, unknown>,
 *   destinationRoot: string
 * }} input the rendered candidate and its deploy destination
 * @returns {Promise<{
 *   decision: 'activate' | 'reconcile',
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   byteCount: string,
 *   routeCount: number,
 *   findings: readonly import('./types.js').PublishActionFinding[]
 * }>} the deploy outcome
 */
export function deployToLocalDirectory({ outputDirectory, manifest, destinationRoot, }: {
    outputDirectory: string;
    manifest: Record<string, unknown>;
    destinationRoot: string;
}): Promise<{
    decision: "activate" | "reconcile";
    generationId: string;
    artifactId: string;
    artifactDigest: string;
    byteCount: string;
    routeCount: number;
    findings: readonly import("./types.js").PublishActionFinding[];
}>;
