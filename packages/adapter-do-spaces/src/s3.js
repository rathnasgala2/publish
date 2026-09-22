/**
 * The bounded S3-compatible client every Spaces call goes through.
 *
 * Nothing here takes a method, an origin, a header set or a query shape from
 * its caller. A call names the `(stage, callClass)` pair it claims to be
 * issuing; {@link requireTemplate} resolves that pair to the one
 * `gala-do-spaces-sigv4-v2` row, and the method, origin, request target,
 * canonical query profile and complete fixed/derived/credential header set
 * are rendered *from that row*. A call whose rendered request would disagree
 * with its template — wrong origin, a query parameter outside the declared
 * profile, an object-metadata set the row does not declare, a header the row
 * does not declare — throws before any DNS lookup, signature or credential
 * use. An undeclarable call therefore cannot be written at all, which is what
 * makes the declared catalog a checkable claim rather than documentation.
 *
 * There is no retry middleware, no ambient credential chain, no endpoint
 * discovery and no redirect following: the caller decides what to retry, and
 * the origin is always the one derived from the destination binding.
 *
 * `transport` exists so a test can bind this exact code path to a local
 * S3-compatible server (the in-process fake, or a throwaway MinIO container)
 * while the adapter still constructs and signs the canonical
 * `https://<bucket>.<region>.digitaloceanspaces.com` request line and `host`
 * header. Nothing about the signature, the request target or the headers
 * changes; only the TCP hop does.
 *
 * @module
 */

import { requireTemplate } from './request-catalog.js';
import {
  canonicalQuery,
  canonicalUriForKey,
  payloadHash,
  signRequest,
} from './sigv4.js';

/** Maximum response body this client will read, in bytes. */
export const MAXIMUM_RESPONSE_BODY_BYTES = 67108864;

/**
 * @typedef {Readonly<{
 *   stage: string,
 *   callClass: string,
 *   method: string,
 *   origin: string,
 *   requestTarget: string,
 *   headerNames: readonly string[]
 * }>} ProviderCallRecord
 */

/**
 * @typedef {Readonly<{
 *   host: string,
 *   origin: string,
 *   credentials: import('./sigv4.js').SigningCredentials,
 *   templates: readonly Readonly<Record<string, unknown>>[],
 *   fetch?: typeof globalThis.fetch,
 *   onCall?: (record: ProviderCallRecord) => void
 * }>} BucketClient
 */

/**
 * @typedef {Readonly<{
 *   status: number,
 *   headers: Readonly<Record<string, string>>,
 *   bytes: Buffer,
 *   etag: string | null
 * }>} S3Response
 */

/**
 * @typedef {Readonly<{
 *   mediaType: string,
 *   cacheControl: string,
 *   untaggedSha256: string
 * }>} ObjectMetadata
 */

/**
 * The exact parameter names each canonical query profile admits. DEC-097
 * fixes the emitted parameter sequence for all five profiles; `prefix` is
 * always emitted (possibly as the empty value) and `continuation-token`
 * appears only on a continued list page.
 */
const QUERY_PROFILE_PARAMETERS = Object.freeze({
  none: Object.freeze({ required: [], optional: [] }),
  'spaces-list-v2': Object.freeze({
    required: ['list-type', 'max-keys', 'prefix'],
    optional: ['continuation-token'],
  }),
  'spaces-multipart-create-v2': Object.freeze({
    required: ['uploads'],
    optional: [],
  }),
  'spaces-multipart-part-v2': Object.freeze({
    required: ['partNumber', 'uploadId'],
    optional: [],
  }),
  'spaces-upload-id-v2': Object.freeze({
    required: ['uploadId'],
    optional: [],
  }),
});

/**
 * The header names this client signs. `accept-encoding`, `connection` and
 * `content-length` are declared by every row and sent on every request, but
 * they are transport-computed or hop-by-hop: an HTTP client, a proxy or a
 * TLS-terminating intermediary is entitled to compute or rewrite them, and
 * signing them would turn a legitimate rewrite into `SignatureDoesNotMatch`.
 * Everything a row declares that carries adapter-chosen meaning — the object
 * metadata set, the ACL, the multipart completion's media type — is signed.
 */
const SIGNED_HEADER_NAMES = Object.freeze(
  new Set([
    'host',
    'x-amz-date',
    'x-amz-content-sha256',
    'x-amz-acl',
    'content-type',
    'cache-control',
    'x-amz-meta-gala-sha256',
  ]),
);

/**
 * The one header family sent outside the catalog, and the only call classes
 * that may carry it: the best-effort conditional guard on the activation
 * pointer write.
 *
 * It is deliberately *not* declared as a template header, because its value
 * is a provider-returned ETag rather than a fixed literal or one of DEC-097's
 * closed derived sources, so it is not representable as a fixed or derived
 * row. It is therefore sent unsigned, is never required for correctness, and
 * is exactly why this adapter declares `concurrency: best-effort` rather than
 * claiming a fence. Any other call class that tries to send one is refused.
 */
const CONDITIONAL_HEADER_NAMES = Object.freeze(
  new Set(['if-match', 'if-none-match']),
);

/** The only call class permitted to carry the conditional guard. */
const CONDITIONAL_CALL_CLASS = 'generation-marker-put';

/**
 * Render and validate the request target for one row.
 *
 * @param {Readonly<Record<string, unknown>>} template the catalog row
 * @param {string} key the object key, or `''` for a bucket-addressed row
 * @returns {string} the canonical request-target path
 */
function renderTarget(template, key) {
  const declared = String(template.requestTargetTemplate);
  if (declared === '/') {
    if (key !== '') {
      throw new Error(
        `SPACES_REQUEST_TARGET_MISMATCH: ${String(template.stage)}/${String(template.callClass)} declares the bucket target "/" but was given the key ${JSON.stringify(key)}`,
      );
    }
    return '/';
  }
  if (key === '') {
    throw new Error(
      `SPACES_REQUEST_TARGET_MISMATCH: ${String(template.stage)}/${String(template.callClass)} declares ${declared} but was given no object key`,
    );
  }
  const target = canonicalUriForKey(key);
  const maximum = Number(template.maximumRequestTargetBytes);
  if (Buffer.byteLength(target, 'utf8') > maximum) {
    throw new Error(
      `SPACES_REQUEST_TARGET_TOO_LONG: ${target.length} rendered bytes exceed the declared ${maximum}-byte ceiling for ${String(template.stage)}/${String(template.callClass)}`,
    );
  }
  return target;
}

/**
 * Check one issued query against the row's declared canonical query profile.
 *
 * @param {Readonly<Record<string, unknown>>} template the catalog row
 * @param {Readonly<Record<string, string>>} query the issued parameters
 * @returns {void}
 */
function assertQueryProfile(template, query) {
  const profile = String(template.canonicalQueryProfile);
  const admitted =
    /** @type {Record<string, {required: string[], optional: string[]}>} */ (
      QUERY_PROFILE_PARAMETERS
    )[profile];
  if (admitted === undefined) {
    throw new Error(
      `SPACES_QUERY_PROFILE_UNKNOWN: ${profile} is not one of the five declared canonical query profiles`,
    );
  }
  const issued = Object.keys(query).sort();
  for (const name of issued) {
    if (
      !admitted.required.includes(name) &&
      !admitted.optional.includes(name)
    ) {
      throw new Error(
        `SPACES_QUERY_PARAMETER_UNDECLARED: ${name} is outside ${profile} for ${String(template.stage)}/${String(template.callClass)}`,
      );
    }
  }
  for (const name of admitted.required) {
    if (!issued.includes(name)) {
      throw new Error(
        `SPACES_QUERY_PARAMETER_MISSING: ${profile} requires ${name} for ${String(template.stage)}/${String(template.callClass)}`,
      );
    }
  }
}

/**
 * Render every header the row declares, and refuse anything it does not.
 *
 * @param {Readonly<Record<string, unknown>>} template the catalog row
 * @param {{host: string, bodyByteLength: number, metadata?: ObjectMetadata}} inputs
 *   the rendering inputs
 * @returns {{signed: Record<string, string>, unsigned: Record<string, string>}}
 *   the declared headers, split by whether this client signs them
 */
function renderHeaders(template, inputs) {
  /** @type {Record<string, string>} */
  const signed = {};
  /** @type {Record<string, string>} */
  const unsigned = {};
  const row = `${String(template.stage)}/${String(template.callClass)}`;

  /**
   * @param {string} name the header name
   * @param {string} value the rendered value
   * @returns {void}
   */
  const place = (name, value) => {
    if (name in signed || name in unsigned) {
      throw new Error(
        `SPACES_REQUEST_HEADER_DUPLICATE: ${row} renders ${name} more than once`,
      );
    }
    if (SIGNED_HEADER_NAMES.has(name)) {
      signed[name] = value;
      return;
    }
    unsigned[name] = value;
  };

  const declaresMetadata = /** @type {readonly {name: string}[]} */ (
    template.derivedHeaders
  ).some((header) => header.name === 'x-amz-meta-gala-sha256');
  if (declaresMetadata && inputs.metadata === undefined) {
    throw new Error(
      `SPACES_REQUEST_METADATA_MISSING: ${row} declares the object metadata set but none was supplied`,
    );
  }
  if (!declaresMetadata && inputs.metadata !== undefined) {
    throw new Error(
      `SPACES_REQUEST_METADATA_UNDECLARED: ${row} declares no object metadata set, so one may not be sent`,
    );
  }

  for (const header of /** @type {readonly {name: string, source: string}[]} */ (
    template.derivedHeaders
  )) {
    switch (header.source) {
      case 'origin-authority':
        place(header.name, inputs.host);
        break;
      case 'request-body-byte-count':
        place(header.name, String(inputs.bodyByteLength));
        break;
      case 'deployment-object-media-type':
        place(
          header.name,
          /** @type {ObjectMetadata} */ (inputs.metadata).mediaType,
        );
        break;
      case 'deployment-object-cache-control':
        place(
          header.name,
          /** @type {ObjectMetadata} */ (inputs.metadata).cacheControl,
        );
        break;
      case 'deployment-object-untagged-sha256':
        place(
          header.name,
          /** @type {ObjectMetadata} */ (inputs.metadata).untaggedSha256,
        );
        break;
      case 'sigv4-basic-timestamp':
      case 'request-body-sha256':
        // Both are produced by the signer itself, from the exact instant it
        // reads and the exact body bytes it hashes, and are merged below.
        break;
      default:
        throw new Error(
          `SPACES_REQUEST_HEADER_SOURCE_UNKNOWN: ${row} declares ${header.name} from ${header.source}`,
        );
    }
  }

  for (const header of /** @type {readonly {name: string, value: string}[]} */ (
    template.fixedHeaders
  )) {
    place(header.name, header.value);
  }

  return { signed, unsigned };
}

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
export async function send(client, request) {
  const template = requireTemplate(
    client.templates,
    request.stage,
    request.callClass,
  );
  if (String(template.origin) !== client.origin) {
    throw new Error(
      `SPACES_CALL_ORIGIN_MISMATCH: ${request.stage}/${request.callClass} is declared against ${String(template.origin)} but was issued against ${client.origin}`,
    );
  }

  const query = request.query ?? {};
  assertQueryProfile(template, query);
  const target = renderTarget(template, request.key);

  const conditional = request.conditional ?? {};
  for (const name of Object.keys(conditional)) {
    if (
      !CONDITIONAL_HEADER_NAMES.has(name) ||
      String(template.callClass) !== CONDITIONAL_CALL_CLASS
    ) {
      throw new Error(
        `SPACES_REQUEST_HEADER_UNDECLARED: ${request.stage}/${request.callClass} may not send ${name}`,
      );
    }
  }

  const rendered = renderHeaders(template, {
    host: client.host,
    bodyByteLength: request.body?.byteLength ?? 0,
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
  });

  const hash = payloadHash(request.body);
  const signed = signRequest(
    {
      method: String(template.method),
      host: client.host,
      key: request.key,
      query,
      headers: rendered.signed,
      payloadSha256: hash,
    },
    client.credentials,
  );

  // Last gate before egress: the header set actually about to be sent must be
  // exactly the row's declared set (plus the one documented conditional
  // guard). A header introduced anywhere above — by the signer, by a future
  // edit, by a merged default — fails here rather than on an author's bucket.
  const declaredNames = new Set([
    .../** @type {readonly {name: string}[]} */ (template.fixedHeaders).map(
      (header) => header.name,
    ),
    .../** @type {readonly {name: string}[]} */ (template.derivedHeaders).map(
      (header) => header.name,
    ),
    .../** @type {readonly {name: string}[]} */ (
      template.credentialHeaders
    ).map((header) => header.name),
  ]);
  /** @type {Record<string, string>} */
  const wireHeaders = { ...signed, ...rendered.unsigned, ...conditional };
  for (const name of Object.keys(wireHeaders)) {
    if (CONDITIONAL_HEADER_NAMES.has(name)) {
      continue;
    }
    if (!declaredNames.has(name)) {
      throw new Error(
        `SPACES_REQUEST_HEADER_UNDECLARED: ${request.stage}/${request.callClass} would send ${name}, which its template does not declare`,
      );
    }
  }
  for (const name of declaredNames) {
    if (!(name in wireHeaders)) {
      throw new Error(
        `SPACES_REQUEST_HEADER_MISSING: ${request.stage}/${request.callClass} declares ${name} but did not render it`,
      );
    }
  }

  // The wire request line is rendered with the same canonicalisation the
  // signature was computed over, rather than with bare `encodeURIComponent`
  // (which leaves the sub-delimiters `!'()*` unescaped). S3 and MinIO both
  // decode the received path and re-encode it canonically, so the looser
  // form also verifies — this is defence in depth, not a bug fix: it
  // removes a class of failure where an intermediary, a proxy or a stricter
  // S3-compatible implementation canonicalises the received bytes
  // differently from the bytes this client chose to send.
  const canonical = canonicalQuery(query);
  const url = `${client.origin}${target}${canonical === '' ? '' : `?${canonical}`}`;

  // A credential-free diagnostics record of exactly what is about to leave,
  // naming the catalog row the call claims to be issuing. It carries header
  // *names* only, never a value, so a journal or a gate can check the claim
  // against the wire without ever handling a credential.
  client.onCall?.(
    Object.freeze({
      stage: request.stage,
      callClass: request.callClass,
      method: String(template.method),
      origin: client.origin,
      requestTarget: `${target}${canonical === '' ? '' : `?${canonical}`}`,
      headerNames: Object.freeze(Object.keys(wireHeaders).sort()),
    }),
  );

  const doFetch = client.fetch ?? globalThis.fetch;
  const response = await doFetch(url, {
    method: String(template.method),
    headers: wireHeaders,
    redirect: 'error',
    ...(request.body === undefined
      ? {}
      : { body: /** @type {BodyInit} */ (request.body) }),
  });

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAXIMUM_RESPONSE_BODY_BYTES) {
    throw new Error(
      `SPACES_RESPONSE_BODY_TOO_LARGE: ${request.key} returned ${bytes.byteLength} bytes`,
    );
  }
  /** @type {Record<string, string>} */
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return Object.freeze({
    status: response.status,
    headers: Object.freeze(headers),
    bytes,
    etag: headers.etag === undefined ? null : headers.etag.replaceAll('"', ''),
  });
}

/**
 * Assert a response status is one the caller admitted; otherwise raise a
 * typed failure carrying the provider's own error code where it sent one.
 *
 * @param {S3Response} response the response
 * @param {readonly number[]} acceptStatuses the admitted statuses
 * @param {string} callClass the cataloged `stage/callClass`, for the message
 * @returns {S3Response} the same response
 */
export function requireStatus(response, acceptStatuses, callClass) {
  if (acceptStatuses.includes(response.status)) {
    return response;
  }
  const code = response.bytes.toString('utf8').match(/<Code>([^<]+)<\/Code>/u);
  throw new Error(
    `SPACES_PROVIDER_STATUS_UNEXPECTED: ${callClass} returned HTTP ${response.status}${code === null ? '' : ` (${code[1]})`}, expected one of ${acceptStatuses.join(', ')}`,
  );
}

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
export async function listPrefix(client, stage, prefix, pageSize) {
  /** @type {{key: string, etag: string, size: number}[]} */
  const keys = [];
  /** @type {string | undefined} */
  let continuationToken;
  do {
    const response = requireStatus(
      await send(client, {
        stage,
        callClass: 'generation-list',
        key: '',
        query: {
          'list-type': '2',
          prefix,
          'max-keys': String(pageSize),
          ...(continuationToken === undefined
            ? {}
            : { 'continuation-token': continuationToken }),
        },
      }),
      [200],
      `${stage}/generation-list`,
    );
    const xml = response.bytes.toString('utf8');
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)) {
      const block = String(match[1]);
      const key = block.match(/<Key>([\s\S]*?)<\/Key>/u)?.[1];
      if (key === undefined) {
        continue;
      }
      keys.push({
        key: decodeXmlText(key),
        etag: (block.match(/<ETag>([\s\S]*?)<\/ETag>/u)?.[1] ?? '')
          .replaceAll('&quot;', '')
          .replaceAll('"', ''),
        size: Number.parseInt(
          block.match(/<Size>(\d+)<\/Size>/u)?.[1] ?? '0',
          10,
        ),
      });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/u.test(xml);
    continuationToken = truncated
      ? (xml.match(
          /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/u,
        )?.[1] ?? undefined)
      : undefined;
  } while (continuationToken !== undefined);
  return keys;
}

/**
 * Decode the five predefined XML entities in a text node.
 *
 * @param {string} value the raw text
 * @returns {string} the decoded text
 */
function decodeXmlText(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
