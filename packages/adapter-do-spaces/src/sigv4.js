/**
 * AWS Signature Version 4 request signing for the S3-compatible
 * DigitalOcean Spaces API.
 *
 * This is implemented directly against `node:crypto` rather than through an
 * AWS SDK on purpose. DEC-097 requires this adapter to declare an *exact*
 * request catalog — method, origin, request target, canonical query
 * profile, fixed/derived/credential headers and body profile — for every
 * call it is ever permitted to make, and to prove the rendered request
 * matches that catalog. A general-purpose SDK builds requests its caller
 * cannot fully enumerate (retries, middleware, checksum negotiation,
 * endpoint resolution), which would make that declaration untruthful. It
 * also keeps this workspace's dependency surface and SBOM at exactly the
 * pinned `@rathnasgala2` packages.
 *
 * @module
 */

import { createHash, createHmac } from 'node:crypto';

/** The SigV4 algorithm identifier. */
export const ALGORITHM = 'AWS4-HMAC-SHA256';

/** The S3 service name every Spaces signature is scoped to. */
export const SERVICE = 's3';

/** The literal payload hash for an unsigned/empty body. */
export const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * RFC 3986 encode one path segment (S3 canonicalisation encodes every
 * character outside the unreserved set, and does not re-encode `/`).
 *
 * @param {string} segment the raw segment
 * @returns {string} the encoded segment
 */
export function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Canonicalise an object key into a signed absolute URI path.
 *
 * @param {string} key the object key (no leading slash)
 * @returns {string} the canonical URI path
 */
export function canonicalUriForKey(key) {
  if (key === '') {
    return '/';
  }
  return `/${key.split('/').map(encodeSegment).join('/')}`;
}

/**
 * Canonicalise a query string: parameters sorted by name, each name and
 * value RFC 3986 encoded, an empty value rendered as `name=`.
 *
 * @param {Readonly<Record<string, string>>} query the query parameters
 * @returns {string} the canonical query string
 */
export function canonicalQuery(query) {
  return Object.keys(query)
    .sort()
    .map(
      (name) =>
        `${encodeSegment(name)}=${encodeSegment(/** @type {string} */ (query[name]))}`,
    )
    .join('&');
}

/**
 * Format one instant as the two SigV4 timestamps.
 *
 * @param {Date} instant the signing instant
 * @returns {{amzDate: string, dateStamp: string}} the basic-format timestamps
 */
export function formatTimestamps(instant) {
  const amzDate = instant.toISOString().replace(/[-:]|\.\d{3}/gu, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * @param {import('node:crypto').BinaryLike} key the HMAC key
 * @param {string} data the message
 * @returns {Buffer} the raw HMAC-SHA256
 */
function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

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
export function deriveSigningKey(
  secretAccessKey,
  dateStamp,
  region,
  service = SERVICE,
) {
  return hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    'aws4_request',
  );
}

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
export function computeSignature(request, credentials) {
  const service = request.service ?? SERVICE;
  const canonicalHeaders = request.signedHeaderNames
    .map((name) => `${name}:${String(request.headers[name] ?? '').trim()}\n`)
    .join('');
  const signedHeaders = request.signedHeaderNames.join(';');
  const canonicalRequest = [
    request.method,
    request.canonicalUri ?? canonicalUriForKey(request.key),
    canonicalQuery(request.query),
    canonicalHeaders,
    signedHeaders,
    request.payloadSha256,
  ].join('\n');

  const scope = `${request.dateStamp}/${credentials.region}/${service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    request.amzDate,
    scope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n');

  const signature = createHmac(
    'sha256',
    deriveSigningKey(
      credentials.secretAccessKey,
      request.dateStamp,
      credentials.region,
      service,
    ),
  )
    .update(stringToSign, 'utf8')
    .digest('hex');

  return { signature, scope, signedHeaders };
}

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
export function signRequest(request, credentials) {
  const { amzDate, dateStamp } = formatTimestamps(
    request.instant ?? new Date(),
  );
  /** @type {Record<string, string>} */
  const headers = {
    host: request.host,
    'x-amz-content-sha256': request.payloadSha256,
    'x-amz-date': amzDate,
  };
  if (credentials.sessionToken !== undefined) {
    headers['x-amz-security-token'] = credentials.sessionToken;
  }
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }

  const { signature, scope, signedHeaders } = computeSignature(
    {
      method: request.method,
      key: request.key,
      query: request.query ?? {},
      headers,
      signedHeaderNames: Object.keys(headers).sort(),
      payloadSha256: request.payloadSha256,
      amzDate,
      dateStamp,
      ...(request.service === undefined ? {} : { service: request.service }),
    },
    credentials,
  );

  return Object.freeze({
    ...headers,
    authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  });
}

/**
 * Hash one request payload.
 *
 * @param {Buffer | undefined} body the request body
 * @returns {string} the lowercase hexadecimal payload hash
 */
export function payloadHash(body) {
  if (body === undefined || body.byteLength === 0) {
    return EMPTY_PAYLOAD_SHA256;
  }
  return createHash('sha256').update(body).digest('hex');
}
