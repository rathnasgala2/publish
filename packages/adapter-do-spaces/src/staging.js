/**
 * Object writing through the cataloged call plans, and the reversible stage
 * token.
 *
 * Every staged byte lives under the reserved
 * `_gala/staged/v2/<operationId>/<attemptId>/<generationId>/` prefix, so a
 * stale private object can never contaminate the served inventory and
 * cleanup can delete exactly this operation's prefix and nothing else
 * (brief section 6.3).
 *
 * The stage token used to be an opaque digest whose inverse could only be
 * found by reading a `stage.json` control object back out of the bucket — a
 * signed object-`GET` that DEC-097's closed catalog has no row for. It is now
 * a pure, reversible projection of the same three identity segments, so the
 * inverse is arithmetic rather than a provider read, and the safety property
 * is unchanged: a prefix this adapter could not itself have derived is still
 * never deleted ({@link isOwnedStagePrefix}).
 *
 * @module
 */

import { SpacesAdapterError } from './errors.js';
import { MAXIMUM_SINGLE_PART_BYTES, STAGE_PREFIX } from './constants.js';
import { requireStatus, send } from './s3.js';

/**
 * The exact shape one staging-path identity segment may take. The three
 * identity values are Gala-issued identifiers, but this adapter never
 * assumes that: a value carrying `/`, a dot segment, a percent escape or a
 * zero-length string would silently reshape the reserved prefix that
 * cleanup later deletes by prefix, so it is refused before a single
 * provider call is signed.
 */
const IDENTITY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

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
export const STAGE_CALLS = Object.freeze({
  stage: 'stage',
  put: 'object-put',
  multipartCreate: 'multipart-create',
  multipartPart: 'multipart-part',
  multipartComplete: 'multipart-complete',
  markerPut: 'generation-marker-put',
  abortStage: 'cleanup-staged',
  abortCallClass: 'staged-multipart-abort',
});

/**
 * The served-root call plan for ordinary activation.
 *
 * @type {CallPlan}
 */
export const ACTIVATE_CALLS = Object.freeze({
  stage: 'activate',
  put: 'served-root-put',
  multipartCreate: 'served-root-multipart-create',
  multipartPart: 'served-root-multipart-part',
  multipartComplete: 'served-root-multipart-complete',
  markerPut: 'generation-marker-put',
  abortStage: 'cleanup-staged',
  abortCallClass: 'served-root-multipart-abort',
});

/**
 * The served-root call plan for a rollback's re-promotion. Byte-identical
 * requests to {@link ACTIVATE_CALLS}, issued under the `rollback` stage so a
 * reader of the wire can tell a rollback from an ordinary activation.
 *
 * @type {CallPlan}
 */
export const ROLLBACK_CALLS = Object.freeze({
  ...ACTIVATE_CALLS,
  stage: 'rollback',
});

/**
 * Refuse any identity that cannot appear verbatim in the reserved prefix.
 *
 * @param {string} name the field name
 * @param {unknown} value the field value
 * @returns {string} the accepted value
 */
function requireIdentitySegment(name, value) {
  if (
    typeof value !== 'string' ||
    !IDENTITY_SEGMENT.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new TypeError(
      `SPACES_STAGE_IDENTITY_INVALID: ${name} must be a single path-safe identity segment; ${JSON.stringify(value)} is not`,
    );
  }
  return value;
}

/**
 * The exact shape a stage prefix may take: the reserved prefix plus exactly
 * the three identity segments and a trailing slash.
 *
 * @param {string} operationPrefix the prefix
 * @returns {boolean} whether the prefix is one this adapter could have made
 */
export function isOwnedStagePrefix(operationPrefix) {
  if (
    !operationPrefix.startsWith(STAGE_PREFIX) ||
    !operationPrefix.endsWith('/')
  ) {
    return false;
  }
  const segments = operationPrefix.slice(STAGE_PREFIX.length, -1).split('/');
  return (
    segments.length === 3 &&
    segments.every((segment) => IDENTITY_SEGMENT.test(segment))
  );
}

/**
 * Derive the operation-owned stage prefix and its reversible stage token.
 *
 * @param {{operationId: string, attemptId: string, generationId: string}} identity
 *   the operation identity
 * @returns {{operationPrefix: string, rootPrefix: string, stageToken: string}}
 *   the derived staging coordinates
 */
export function deriveStagePrefix(identity) {
  const operationId = requireIdentitySegment(
    'operationId',
    identity?.operationId,
  );
  const attemptId = requireIdentitySegment('attemptId', identity?.attemptId);
  const generationId = requireIdentitySegment(
    'generationId',
    identity?.generationId,
  );
  const operationPrefix = `${STAGE_PREFIX}${operationId}/${attemptId}/${generationId}/`;
  return {
    operationPrefix,
    rootPrefix: `${operationPrefix}root/`,
    // A pure projection: no identity segment can contain `/`, so the joined
    // text is unambiguous, and base64url makes it one opaque-looking token
    // without making it irreversible.
    stageToken: Buffer.from(
      `${operationId}/${attemptId}/${generationId}`,
      'utf8',
    ).toString('base64url'),
  };
}

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
export function parseStageToken(stageToken) {
  if (typeof stageToken !== 'string' || stageToken === '') {
    throw new TypeError(
      `SPACES_STAGE_TOKEN_INVALID: ${JSON.stringify(stageToken)} is not a stage token`,
    );
  }
  const decoded = Buffer.from(stageToken, 'base64url').toString('utf8');
  const segments = decoded.split('/');
  if (segments.length !== 3) {
    throw new TypeError(
      `SPACES_STAGE_TOKEN_INVALID: ${JSON.stringify(stageToken)} does not decode to three identity segments`,
    );
  }
  const identity = {
    operationId: requireIdentitySegment('operationId', segments[0]),
    attemptId: requireIdentitySegment('attemptId', segments[1]),
    generationId: requireIdentitySegment('generationId', segments[2]),
  };
  const derived = deriveStagePrefix(identity);
  if (derived.stageToken !== stageToken) {
    throw new TypeError(
      `SPACES_STAGE_TOKEN_INVALID: ${JSON.stringify(stageToken)} is not the canonical token for the identity it decodes to`,
    );
  }
  return { ...identity, ...derived };
}

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
export async function putObject(client, plan, callClass, key, bytes, metadata) {
  if (bytes.byteLength <= MAXIMUM_SINGLE_PART_BYTES) {
    requireStatus(
      await send(client, {
        stage: plan.stage,
        callClass,
        key,
        body: bytes,
        metadata,
      }),
      [200],
      `${plan.stage}/${callClass}`,
    );
    return;
  }
  await uploadMultipart(client, plan, key, bytes, metadata);
}

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
export async function uploadMultipart(client, plan, key, bytes, metadata) {
  const created = requireStatus(
    await send(client, {
      stage: plan.stage,
      callClass: plan.multipartCreate,
      key,
      query: { uploads: '' },
      metadata,
    }),
    [200],
    `${plan.stage}/${plan.multipartCreate}`,
  );
  const uploadId = created.bytes
    .toString('utf8')
    .match(/<UploadId>([\s\S]*?)<\/UploadId>/u)?.[1];
  if (uploadId === undefined) {
    throw new SpacesAdapterError(
      'SPACES_MULTIPART_CREATE_MALFORMED',
      'the create-multipart response carried no UploadId',
    );
  }

  try {
    /** @type {{partNumber: number, etag: string}[]} */
    const parts = [];
    for (
      let offset = 0, partNumber = 1;
      offset < bytes.byteLength;
      offset += MAXIMUM_SINGLE_PART_BYTES, partNumber += 1
    ) {
      const slice = bytes.subarray(offset, offset + MAXIMUM_SINGLE_PART_BYTES);
      const uploaded = requireStatus(
        await send(client, {
          stage: plan.stage,
          callClass: plan.multipartPart,
          key,
          query: { partNumber: String(partNumber), uploadId },
          body: slice,
        }),
        [200],
        `${plan.stage}/${plan.multipartPart}`,
      );
      if (uploaded.etag === null) {
        throw new SpacesAdapterError(
          `SPACES_MULTIPART_PART_MALFORMED`,
          `part ${partNumber} returned no ETag`,
        );
      }
      parts.push({ partNumber, etag: uploaded.etag });
    }

    const completion = `<CompleteMultipartUpload>${parts
      .map(
        (part) =>
          `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>"${part.etag}"</ETag></Part>`,
      )
      .join('')}</CompleteMultipartUpload>`;
    requireStatus(
      await send(client, {
        stage: plan.stage,
        callClass: plan.multipartComplete,
        key,
        query: { uploadId },
        body: Buffer.from(completion, 'utf8'),
      }),
      [200],
      `${plan.stage}/${plan.multipartComplete}`,
    );
  } catch (error) {
    // The abort is a `cleanup-staged` row even when the failed upload was a
    // served-root one: DEC-097 gives the served-root abort its own
    // `cleanup-staged/served-root-multipart-abort` row precisely so an
    // unaccepted multipart upload is always torn down through cleanup's
    // authority, never through the activating stage's.
    await send(client, {
      stage: plan.abortStage,
      callClass: plan.abortCallClass,
      key,
      query: { uploadId },
    }).catch(() => undefined);
    throw error;
  }
}
