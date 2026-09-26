/**
 * RFC 3986 encode one path segment (S3 canonicalisation encodes every
 * character outside the unreserved set, and does not re-encode `/`).
 *
 * @param {string} segment the raw segment
 * @returns {string} the encoded segment
 */
export function encodeSegment(segment: string): string;
/**
 * Canonicalise an object key into a signed absolute URI path.
 *
 * @param {string} key the object key (no leading slash)
 * @returns {string} the canonical URI path
 */
export function canonicalUriForKey(key: string): string;
/**
 * Canonicalise a query string: parameters sorted by name, each name and
 * value RFC 3986 encoded, an empty value rendered as `name=`.
 *
 * @param {Readonly<Record<string, string>>} query the query parameters
 * @returns {string} the canonical query string
 */
export function canonicalQuery(query: Readonly<Record<string, string>>): string;
/**
 * Format one instant as the two SigV4 timestamps.
 *
 * @param {Date} instant the signing instant
 * @returns {{amzDate: string, dateStamp: string}} the basic-format timestamps
 */
export function formatTimestamps(instant: Date): {
    amzDate: string;
    dateStamp: string;
};
/**
 * Derive the SigV4 signing key for one date/region/service scope.
 *
 * @param {string} secretAccessKey the secret access key
 * @param {string} dateStamp the `YYYYMMDD` date stamp
 * @param {string} region the region
 * @param {string} [service] the service name; defaults to S3, and is
 *   parameterised only so the published AWS SigV4 test-suite vectors (which
 *   sign a generic `service`) can be replayed against this exact code
 * @returns {Buffer} the derived signing key
 */
export function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string, service?: string): Buffer;
/**
 * @typedef {Readonly<{
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   sessionToken?: string,
 *   region: string
 * }>} SigningCredentials
 */
/**
 * Compute one SigV4 signature over an explicit signed-header set.
 *
 * Splitting this out of {@link signRequest} is what lets a verifier
 * recompute the signature the way S3 itself does: from the exact header
 * names the presented `Authorization` header lists, using the values that
 * actually arrived, rather than from a set the verifier assumes.
 *
 * @param {{
 *   method: string,
 *   key: string,
 *   query: Readonly<Record<string, string>>,
 *   headers: Readonly<Record<string, string>>,
 *   signedHeaderNames: readonly string[],
 *   payloadSha256: string,
 *   amzDate: string,
 *   dateStamp: string,
 *   service?: string,
 *   canonicalUri?: string
 * }} request the canonical request inputs; `canonicalUri` overrides the
 *   key-derived path, so a verifier can recompute the signature from an
 *   exact request line rather than from a key
 * @param {SigningCredentials} credentials the signing credentials
 * @returns {{signature: string, scope: string, signedHeaders: string}} the
 *   signature and the two `Authorization` components derived with it
 */
export function computeSignature(request: {
    method: string;
    key: string;
    query: Readonly<Record<string, string>>;
    headers: Readonly<Record<string, string>>;
    signedHeaderNames: readonly string[];
    payloadSha256: string;
    amzDate: string;
    dateStamp: string;
    service?: string;
    canonicalUri?: string;
}, credentials: SigningCredentials): {
    signature: string;
    scope: string;
    signedHeaders: string;
};
/**
 * Sign one request, returning exactly the headers that must be sent
 * verbatim.
 *
 * Only headers this signer controls end-to-end are signed: `host`, the
 * `x-amz-*` family and `content-type`. A conditional or cache header is
 * deliberately *not* signed and is sent by the caller as an unsigned
 * header, because an HTTP client is entitled to add or rewrite those (Node
 * adds `pragma: no-cache` and rewrites `cache-control` the moment a
 * conditional header is present), and S3 honours an unsigned header
 * perfectly well.
 *
 * @param {{
 *   method: string,
 *   host: string,
 *   key: string,
 *   query?: Readonly<Record<string, string>>,
 *   headers?: Readonly<Record<string, string>>,
 *   payloadSha256: string,
 *   instant?: Date,
 *   service?: string
 * }} request the request to sign
 * @param {SigningCredentials} credentials the signing credentials
 * @returns {Readonly<Record<string, string>>} the signed header set
 */
export function signRequest(request: {
    method: string;
    host: string;
    key: string;
    query?: Readonly<Record<string, string>>;
    headers?: Readonly<Record<string, string>>;
    payloadSha256: string;
    instant?: Date;
    service?: string;
}, credentials: SigningCredentials): Readonly<Record<string, string>>;
/**
 * Hash one request payload.
 *
 * @param {Buffer | undefined} body the request body
 * @returns {string} the lowercase hexadecimal payload hash
 */
export function payloadHash(body: Buffer | undefined): string;
/** The SigV4 algorithm identifier. */
export const ALGORITHM: "AWS4-HMAC-SHA256";
/** The S3 service name every Spaces signature is scoped to. */
export const SERVICE: "s3";
/** The literal payload hash for an unsigned/empty body. */
export const EMPTY_PAYLOAD_SHA256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export type SigningCredentials = Readonly<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
}>;
