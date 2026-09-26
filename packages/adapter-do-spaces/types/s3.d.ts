/**
 * Issue one cataloged S3 request.
 *
 * @param {BucketClient} client the bound bucket client
 * @param {{
 *   stage: string,
 *   callClass: string,
 *   key: string,
 *   query?: Readonly<Record<string, string>>,
 *   body?: Buffer,
 *   metadata?: ObjectMetadata,
 *   conditional?: Readonly<Record<string, string>>
 * }} request the call to issue, named by its `(stage, callClass)` pair
 * @returns {Promise<S3Response>} the bounded response
 */
export function send(client: BucketClient, request: {
    stage: string;
    callClass: string;
    key: string;
    query?: Readonly<Record<string, string>>;
    body?: Buffer;
    metadata?: ObjectMetadata;
    conditional?: Readonly<Record<string, string>>;
}): Promise<S3Response>;
/**
 * Assert a response status is one the caller admitted; otherwise raise a
 * typed failure carrying the provider's own error code where it sent one.
 *
 * @param {S3Response} response the response
 * @param {readonly number[]} acceptStatuses the admitted statuses
 * @param {string} callClass the cataloged `stage/callClass`, for the message
 * @returns {S3Response} the same response
 */
export function requireStatus(response: S3Response, acceptStatuses: readonly number[], callClass: string): S3Response;
/**
 * List every key under one prefix, following continuation tokens, through
 * one of the two declared `spaces-list-v2` rows.
 *
 * @param {BucketClient} client the bound bucket client
 * @param {'inspect' | 'observe'} stage the issuing stage: `inspect` is this
 *   intent's own private staged prefix in the staging bucket, `observe` the
 *   final served-root namespace in the served bucket
 * @param {string} prefix the raw key prefix that row binds
 * @param {number} pageSize the page size
 * @returns {Promise<{key: string, etag: string, size: number}[]>} every key
 */
export function listPrefix(client: BucketClient, stage: "inspect" | "observe", prefix: string, pageSize: number): Promise<{
    key: string;
    etag: string;
    size: number;
}[]>;
/** Maximum response body this client will read, in bytes. */
export const MAXIMUM_RESPONSE_BODY_BYTES: 67108864;
export type ProviderCallRecord = Readonly<{
    stage: string;
    callClass: string;
    method: string;
    origin: string;
    requestTarget: string;
    headerNames: readonly string[];
}>;
export type BucketClient = Readonly<{
    host: string;
    origin: string;
    credentials: import("./sigv4.js").SigningCredentials;
    templates: readonly Readonly<Record<string, unknown>>[];
    fetch?: typeof globalThis.fetch;
    onCall?: (record: ProviderCallRecord) => void;
}>;
export type S3Response = Readonly<{
    status: number;
    headers: Readonly<Record<string, string>>;
    bytes: Buffer;
    etag: string | null;
}>;
export type ObjectMetadata = Readonly<{
    mediaType: string;
    cacheControl: string;
    untaggedSha256: string;
}>;
