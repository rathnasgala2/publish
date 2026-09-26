/**
 * Compute the physical destination mutation key. DEC-097 section 4.3 fixes
 * it as the immutable Pages repository identity: a logical alias, name or
 * URL never creates a second physical fence, so the numeric repository id
 * is preferred and `owner/repository` is only the fallback when the caller
 * has not supplied one.
 *
 * @param {{owner: string, repository: string, repositoryId?: string | number}} destination
 *   the destination identity
 * @returns {string} the destination key digest
 */
export function destinationKey(destination: {
    owner: string;
    repository: string;
    repositoryId?: string | number;
}): string;
/**
 * Get (creating on first use) the run-scoped state for one destination.
 *
 * @param {{owner: string, repository: string, repositoryId?: string | number}} destination
 *   the destination identity
 * @returns {DestinationState} the mutable run-scoped state
 */
export function stateFor(destination: {
    owner: string;
    repository: string;
    repositoryId?: string | number;
}): DestinationState;
/**
 * Discard all run-scoped state for one destination. Used by a test fixture's
 * teardown so one conformance destination can never leak into the next.
 *
 * @param {{owner: string, repository: string, repositoryId?: string | number}} destination
 *   the destination identity
 * @returns {void}
 */
export function forgetDestination(destination: {
    owner: string;
    repository: string;
    repositoryId?: string | number;
}): void;
export type StageRecord = Readonly<{
    stageToken: string;
    operationId: string;
    attemptId: string;
    idempotencyKey: string;
    generationId: string;
    artifactId: string;
    artifactDigest: string;
    entryPaths: readonly string[];
    carrierBytes: Buffer;
    carrierDigest: string;
    pagesArtifactId: string;
    pagesArtifactDigest: string;
    carrierByteCount: number;
}>;
export type DestinationState = {
    stages: Map<string, StageRecord>;
    activations: Map<string, {
        generationId: string;
        pagesDeploymentId: string;
        certifiedAt: string;
        entryPaths: readonly string[];
    }>;
    inFlight: Map<string, string>;
};
