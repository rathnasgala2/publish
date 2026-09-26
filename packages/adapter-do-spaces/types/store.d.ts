/**
 * Compute the physical destination mutation key: the exact bucket pair and
 * region this adapter mutates. A logical alias, a public base URL or a
 * credential never creates a second physical identity.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @returns {string} the destination key digest
 */
export function destinationKey(destination: {
    region: string;
    servedBucket: string;
    stagingBucket: string;
}): string;
/**
 * Get (creating on first use) the run-scoped state for one destination.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @returns {DestinationState} the mutable run-scoped state
 */
export function stateFor(destination: {
    region: string;
    servedBucket: string;
    stagingBucket: string;
}): DestinationState;
/**
 * Recall one stage this run recorded, by its stage token.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @param {string} stageToken the stage token
 * @returns {StageRecord | null} the record, or `null` when this run did not
 *   stage it
 */
export function recallStage(destination: {
    region: string;
    servedBucket: string;
    stagingBucket: string;
}, stageToken: string): StageRecord | null;
/**
 * Recall the stage this run recorded for one generation identity.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @param {string} generationId the generation identity
 * @returns {StageRecord | null} the record, or `null`
 */
export function recallStageForGeneration(destination: {
    region: string;
    servedBucket: string;
    stagingBucket: string;
}, generationId: string): StageRecord | null;
/**
 * Record one completed stage.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @param {StageRecord} record the stage record
 * @returns {void}
 */
export function rememberStage(destination: {
    region: string;
    servedBucket: string;
    stagingBucket: string;
}, record: StageRecord): void;
/**
 * Discard all run-scoped state for one destination. Used by a test fixture's
 * teardown so one conformance destination can never leak into the next.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination identity
 * @returns {void}
 */
export function forgetDestination(destination: {
    region: string;
    servedBucket: string;
    stagingBucket: string;
}): void;
export type StagedFile = Readonly<{
    path: string;
    bytes: Buffer;
    immutable?: boolean;
}>;
export type StageRecord = Readonly<{
    stageToken: string;
    operationId: string;
    attemptId: string;
    idempotencyKey: string;
    generationId: string;
    artifactId: string;
    artifactDigest: string;
    operationPrefix: string;
    rootPrefix: string;
    entryPaths: readonly string[];
    byteCount: string;
    files: readonly StagedFile[];
}>;
export type DestinationState = {
    stages: Map<string, StageRecord>;
};
