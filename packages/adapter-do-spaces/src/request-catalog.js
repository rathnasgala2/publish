/**
 * The frozen `gala-do-spaces-sigv4-v2` provider request-template catalog:
 * DEC-097 section 7's exact 24-row Spaces union, as data.
 *
 * Every S3 call this adapter is permitted to make is declared here, digested
 * into the capability declaration and rendered by `src/s3.js`. There is
 * exactly one row per `(stage, callClass)` pair, no row selects its origin at
 * runtime, neither origin is the credential-free website origin, and there is
 * no automatically added header: what a row does not declare, the adapter
 * cannot send.
 *
 * The two credential families never appear here together: only the limited
 * caller key (Read/Write/Delete on both buckets) signs a data-plane call, and
 * the protected full-access control key is never used by this package's data
 * plane at all — the configuration-verification job owns it and hands this
 * adapter only credential-free evidence (brief section 6.3).
 *
 * @module
 */

import { canonicalizeJson } from '@rathnasgala2/adapter-protocol';

/** The exact request-template profile this adapter declares. */
export const REQUEST_TEMPLATE_PROFILE = 'gala-do-spaces-sigv4-v2';

/** The exact closed response-profile catalog this adapter can parse. */
export const RESPONSE_PROFILES = Object.freeze([
  'spaces-abort-multipart-v2',
  'spaces-complete-multipart-v2',
  'spaces-create-multipart-v2',
  'spaces-delete-object-v2',
  'spaces-head-object-v2',
  'spaces-list-objects-v2',
  'spaces-put-object-v2',
  'spaces-upload-part-v2',
]);

const HOST = Object.freeze({ name: 'host', source: 'origin-authority' });
const CONTENT_LENGTH = Object.freeze({
  name: 'content-length',
  source: 'request-body-byte-count',
});
const AMZ_DATE = Object.freeze({
  name: 'x-amz-date',
  source: 'sigv4-basic-timestamp',
});
const AMZ_CONTENT_SHA256 = Object.freeze({
  name: 'x-amz-content-sha256',
  source: 'request-body-sha256',
});

/**
 * The four derived headers DEC-097 requires on *every* row.
 */
const UNIVERSAL_DERIVED_HEADERS = Object.freeze([
  HOST,
  CONTENT_LENGTH,
  AMZ_DATE,
  AMZ_CONTENT_SHA256,
]);

/**
 * DEC-097's "object metadata set": exactly these three derived rows, carried
 * by every full-object write (single `PUT` and multipart *create*), and by
 * nothing else. A part carries only its own slice digest, and a completion
 * cannot replace the create metadata.
 */
export const OBJECT_METADATA_HEADERS = Object.freeze([
  Object.freeze({
    name: 'content-type',
    source: 'deployment-object-media-type',
  }),
  Object.freeze({
    name: 'cache-control',
    source: 'deployment-object-cache-control',
  }),
  Object.freeze({
    name: 'x-amz-meta-gala-sha256',
    source: 'deployment-object-untagged-sha256',
  }),
]);

/** The two fixed headers DEC-097 requires on every row. */
const UNIVERSAL_FIXED_HEADERS = Object.freeze([
  Object.freeze({ name: 'accept-encoding', value: 'identity' }),
  Object.freeze({ name: 'connection', value: 'close' }),
]);

/** The signed ACL every private stage write carries. */
const ACL_PRIVATE = Object.freeze({ name: 'x-amz-acl', value: 'private' });

/** The signed ACL every final served-root or marker write carries. */
const ACL_PUBLIC = Object.freeze({
  name: 'x-amz-acl',
  value: 'public-read',
});

/** The fixed media type a multipart completion body is sent with. */
const XML_CONTENT_TYPE = Object.freeze({
  name: 'content-type',
  value: 'application/xml',
});

const SIGV4_AUTHORIZATION = Object.freeze({
  name: 'authorization',
  source: 'spaces-authorization-value',
  prefix: '',
  maximumSourceBytes: 2048,
  maximumRenderedValueBytes: 2048,
});

const SESSION_TOKEN = Object.freeze({
  name: 'x-amz-security-token',
  source: 'spaces-session-token',
  prefix: '',
  maximumSourceBytes: 4096,
  maximumRenderedValueBytes: 4096,
});

/** The exact request target every object-addressed row declares. */
const OBJECT_TARGET = '/{objectKey}';

/** The exact request target the two list rows declare. */
const BUCKET_TARGET = '/';

/**
 * @typedef {Readonly<Record<string, unknown>>} RequestTemplate
 */

/**
 * Build one frozen template row.
 *
 * @param {{
 *   stage: string,
 *   callClass: string,
 *   method: string,
 *   origin: string,
 *   requestTargetTemplate: string,
 *   canonicalQueryProfile: string,
 *   requestBodyProfile: string,
 *   responseProfile: string,
 *   objectMetadata?: boolean,
 *   fixedHeaders?: readonly Readonly<{name: string, value: string}>[],
 *   hasSessionToken: boolean
 * }} fields the row's fields
 * @returns {RequestTemplate} the frozen template row
 */
function template(fields) {
  return Object.freeze({
    stage: fields.stage,
    callClass: fields.callClass,
    method: fields.method,
    origin: fields.origin,
    requestTargetTemplate: fields.requestTargetTemplate,
    canonicalQueryProfile: fields.canonicalQueryProfile,
    maximumRequestTargetBytes: 1024,
    fixedHeaders: Object.freeze([
      ...UNIVERSAL_FIXED_HEADERS,
      ...(fields.fixedHeaders ?? []),
    ]),
    derivedHeaders: Object.freeze([
      ...UNIVERSAL_DERIVED_HEADERS,
      ...(fields.objectMetadata === true ? OBJECT_METADATA_HEADERS : []),
    ]),
    credentialHeaders: Object.freeze([
      SIGV4_AUTHORIZATION,
      ...(fields.hasSessionToken ? [SESSION_TOKEN] : []),
    ]),
    requestBodyProfile: fields.requestBodyProfile,
    responseProfile: fields.responseProfile,
  });
}

/**
 * The six rows that write, replace or remove one final served-root object.
 * `activate` and `rollback` issue byte-identical requests, so the two stages
 * share one builder rather than two drifting copies.
 *
 * @param {'activate' | 'rollback'} stage the issuing stage
 * @param {string} served the served bucket's API origin
 * @param {boolean} hasSessionToken whether the optional credential is present
 * @returns {RequestTemplate[]} the six rows for that stage
 */
function servedRootRows(stage, served, hasSessionToken) {
  return [
    template({
      stage,
      callClass: 'generation-marker-put',
      method: 'PUT',
      origin: served,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'none',
      requestBodyProfile: 'spaces-generation-marker-jcs-v2',
      responseProfile: 'spaces-put-object-v2',
      objectMetadata: true,
      fixedHeaders: [ACL_PUBLIC],
      hasSessionToken,
    }),
    template({
      stage,
      callClass: 'served-root-put',
      method: 'PUT',
      origin: served,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'none',
      requestBodyProfile: 'spaces-object-slice-v2',
      responseProfile: 'spaces-put-object-v2',
      objectMetadata: true,
      fixedHeaders: [ACL_PUBLIC],
      hasSessionToken,
    }),
    template({
      stage,
      callClass: 'served-root-multipart-create',
      method: 'POST',
      origin: served,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'spaces-multipart-create-v2',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-create-multipart-v2',
      objectMetadata: true,
      fixedHeaders: [ACL_PUBLIC],
      hasSessionToken,
    }),
    template({
      stage,
      callClass: 'served-root-multipart-part',
      method: 'PUT',
      origin: served,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'spaces-multipart-part-v2',
      requestBodyProfile: 'spaces-object-slice-v2',
      responseProfile: 'spaces-upload-part-v2',
      hasSessionToken,
    }),
    template({
      stage,
      callClass: 'served-root-multipart-complete',
      method: 'POST',
      origin: served,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'spaces-upload-id-v2',
      requestBodyProfile: 'spaces-multipart-completion-xml-v2',
      responseProfile: 'spaces-complete-multipart-v2',
      fixedHeaders: [XML_CONTENT_TYPE],
      hasSessionToken,
    }),
    template({
      stage,
      callClass: 'served-root-delete',
      method: 'DELETE',
      origin: served,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'none',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-delete-object-v2',
      hasSessionToken,
    }),
  ];
}

/**
 * Build the frozen 24-row catalog for one origin binding.
 *
 * @param {import('./origins.js').SpacesOrigins} origins the derived origins
 * @param {{hasSessionToken?: boolean}} [options] whether the optional
 *   `x-amz-security-token` credential is present; DEC-097 adds exactly one
 *   such header row per template iff it is, and never otherwise
 * @returns {readonly RequestTemplate[]} the catalog, sorted by member JCS bytes
 */
export function buildRequestTemplates(origins, options = {}) {
  const staging = origins.stagingApiOrigin;
  const served = origins.servedApiOrigin;
  const hasSessionToken = options.hasSessionToken === true;

  /** @type {RequestTemplate[]} */
  const rows = [
    template({
      stage: 'inspect',
      callClass: 'object-head',
      method: 'HEAD',
      origin: served,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'none',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-head-object-v2',
      hasSessionToken,
    }),
    template({
      stage: 'inspect',
      callClass: 'generation-list',
      method: 'GET',
      origin: staging,
      requestTargetTemplate: BUCKET_TARGET,
      canonicalQueryProfile: 'spaces-list-v2',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-list-objects-v2',
      hasSessionToken,
    }),
    template({
      stage: 'stage',
      callClass: 'object-put',
      method: 'PUT',
      origin: staging,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'none',
      requestBodyProfile: 'spaces-object-slice-v2',
      responseProfile: 'spaces-put-object-v2',
      objectMetadata: true,
      fixedHeaders: [ACL_PRIVATE],
      hasSessionToken,
    }),
    template({
      stage: 'stage',
      callClass: 'multipart-create',
      method: 'POST',
      origin: staging,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'spaces-multipart-create-v2',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-create-multipart-v2',
      objectMetadata: true,
      fixedHeaders: [ACL_PRIVATE],
      hasSessionToken,
    }),
    template({
      stage: 'stage',
      callClass: 'multipart-part',
      method: 'PUT',
      origin: staging,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'spaces-multipart-part-v2',
      requestBodyProfile: 'spaces-object-slice-v2',
      responseProfile: 'spaces-upload-part-v2',
      hasSessionToken,
    }),
    template({
      stage: 'stage',
      callClass: 'multipart-complete',
      method: 'POST',
      origin: staging,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'spaces-upload-id-v2',
      requestBodyProfile: 'spaces-multipart-completion-xml-v2',
      responseProfile: 'spaces-complete-multipart-v2',
      fixedHeaders: [XML_CONTENT_TYPE],
      hasSessionToken,
    }),
    template({
      stage: 'stage',
      callClass: 'generation-marker-put',
      method: 'PUT',
      origin: staging,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'none',
      requestBodyProfile: 'spaces-generation-marker-jcs-v2',
      responseProfile: 'spaces-put-object-v2',
      objectMetadata: true,
      fixedHeaders: [ACL_PRIVATE],
      hasSessionToken,
    }),
    ...servedRootRows('activate', served, hasSessionToken),
    template({
      stage: 'observe',
      callClass: 'object-head',
      method: 'HEAD',
      origin: served,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'none',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-head-object-v2',
      hasSessionToken,
    }),
    template({
      stage: 'observe',
      callClass: 'generation-list',
      method: 'GET',
      origin: served,
      requestTargetTemplate: BUCKET_TARGET,
      canonicalQueryProfile: 'spaces-list-v2',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-list-objects-v2',
      hasSessionToken,
    }),
    template({
      stage: 'cleanup-staged',
      callClass: 'staged-object-delete',
      method: 'DELETE',
      origin: staging,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'none',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-delete-object-v2',
      hasSessionToken,
    }),
    template({
      stage: 'cleanup-staged',
      callClass: 'staged-multipart-abort',
      method: 'DELETE',
      origin: staging,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'spaces-upload-id-v2',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-abort-multipart-v2',
      hasSessionToken,
    }),
    template({
      stage: 'cleanup-staged',
      callClass: 'served-root-multipart-abort',
      method: 'DELETE',
      origin: served,
      requestTargetTemplate: OBJECT_TARGET,
      canonicalQueryProfile: 'spaces-upload-id-v2',
      requestBodyProfile: 'empty',
      responseProfile: 'spaces-abort-multipart-v2',
      hasSessionToken,
    }),
    ...servedRootRows('rollback', served, hasSessionToken),
  ];

  // DEC-097: "`requestTemplates` contains exactly one row for each
  // `(stage, callClass)` [...], sorted by member JCS bytes". Sorting on the
  // canonical bytes rather than on a field tuple makes the order a property
  // of the rows themselves, so no field reordering can silently change the
  // catalog digest without changing a row.
  rows.sort((left, right) => {
    const a = canonicalizeJson(left);
    const b = canonicalizeJson(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return Object.freeze(rows);
}

/**
 * Resolve the one catalog row for a `(stage, callClass)` pair.
 *
 * This is the only way `src/s3.js` obtains a request shape, so a call the
 * catalog does not declare cannot be issued at all: it fails here, before any
 * DNS lookup, signature or credential use.
 *
 * @param {readonly RequestTemplate[]} templates the catalog
 * @param {string} stage the issuing stage
 * @param {string} callClass the call class
 * @returns {RequestTemplate} the one matching row
 */
export function requireTemplate(templates, stage, callClass) {
  const matches = templates.filter(
    (row) => row.stage === stage && row.callClass === callClass,
  );
  if (matches.length !== 1) {
    throw new Error(
      `SPACES_CALL_NOT_IN_CATALOG: ${stage}/${callClass} is not a row of ${REQUEST_TEMPLATE_PROFILE} (${matches.length} matching rows)`,
    );
  }
  return /** @type {RequestTemplate} */ (matches[0]);
}
