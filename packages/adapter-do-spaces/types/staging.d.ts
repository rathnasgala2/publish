/**
 * The exact shape a stage prefix may take: the reserved prefix plus exactly
 * the three identity segments and a trailing slash.
 *
 * @param {string} operationPrefix the prefix
 * @returns {boolean} whether the prefix is one this adapter could have made
 */
export function isOwnedStagePrefix(operationPrefix: string): boolean;
/**
 * Derive the operation-owned stage prefix and its reversible stage token.
 *
 * @param {{operationId: string, attemptId: string, generationId: string}} identity
 *   the operation identity
 * @returns {{operationPrefix: string, rootPrefix: string, stageToken: string}}
 *   the derived staging coordinates
 */
export function deriveStagePrefix(identity: {
    operationId: string;
    attemptId: string;
    generationId: string;
}): {
    operationPrefix: string;
    rootPrefix: string;
    stageToken: string;
};
/**
 * Invert one stage token back to its staging coordinates, with no provider
 * read at all. A token that does not decode to exactly three path-safe
 * identity segments is refused rather than turned into a prefix.
 *
 * @param {string} stageToken the stage token
 * @returns {{
 *   operationId: string,
 *   attemptId: string,
 *   generationId: string,
 *   operationPrefix: string,
 *   rootPrefix: string,
 *   stageToken: string
 * }} the recovered coordinates
 */
export function parseStageToken(stageToken: string): {
    operationId: string;
    attemptId: string;
    generationId: string;
    operationPrefix: string;
    rootPrefix: string;
    stageToken: string;
};
/**
 * Put one object through a call plan, choosing a single `PUT` or a multipart
 * upload by the declared single-part ceiling.
 *
 * @param {import('./s3.js').BucketClient} client the bound bucket client
 * @param {CallPlan} plan the call plan whose rows this write may use
 * @param {string} callClass the full-object call class (`plan.put` or
 *   `plan.markerPut`)
 * @param {string} key the absolute object key
 * @param {Buffer} bytes the object bytes
 * @param {import('./s3.js').ObjectMetadata} metadata the declared object
 *   metadata set
 * @returns {Promise<void>} resolves once the object is durable
 */
export function putObject(client: import("./s3.js").BucketClient, plan: CallPlan, callClass: string, key: string, bytes: Buffer, metadata: import("./s3.js").ObjectMetadata): Promise<void>;
/**
 * Upload one object larger than the declared single-part request-body
 * ceiling through the cataloged multipart calls, aborting the upload rather
 * than leaving an unaccepted one behind on any failure.
 *
 * @param {import('./s3.js').BucketClient} client the bound bucket client
 * @param {CallPlan} plan the call plan whose rows this upload may use
 * @param {string} key the absolute object key
 * @param {Buffer} bytes the object bytes
 * @param {import('./s3.js').ObjectMetadata} metadata the declared object
 *   metadata set; DEC-097 signs the same full-object values on create, and
 *   a part carries only its own slice
 * @returns {Promise<void>} resolves once the upload is complete
 */
export function uploadMultipart(client: import("./s3.js").BucketClient, plan: CallPlan, key: string, bytes: Buffer, metadata: import("./s3.js").ObjectMetadata): Promise<void>;
/**
 * @typedef {Readonly<{
 *   stage: string,
 *   put: string,
 *   multipartCreate: string,
 *   multipartPart: string,
 *   multipartComplete: string,
 *   markerPut: string,
 *   abortStage: string,
 *   abortCallClass: string
 * }>} CallPlan
 */
/**
 * The private-staging call plan: `stage/*` rows against the staging bucket,
 * aborting through `cleanup-staged/staged-multipart-abort`.
 *
 * @type {CallPlan}
 */
export const STAGE_CALLS: CallPlan;
/**
 * The served-root call plan for ordinary activation.
 *
 * @type {CallPlan}
 */
export const ACTIVATE_CALLS: CallPlan;
/**
 * The served-root call plan for a rollback's re-promotion. Byte-identical
 * requests to {@link ACTIVATE_CALLS}, issued under the `rollback` stage so a
 * reader of the wire can tell a rollback from an ordinary activation.
 *
 * @type {CallPlan}
 */
export const ROLLBACK_CALLS: CallPlan;
export type CallPlan = Readonly<{
    stage: string;
    put: string;
    multipartCreate: string;
    multipartPart: string;
    multipartComplete: string;
    markerPut: string;
    abortStage: string;
    abortCallClass: string;
}>;
