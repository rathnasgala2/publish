/**
 * `@rathnasgala2/adapter-do-spaces`: the managed DigitalOcean Spaces
 * deployment adapter (S4-T05; DEC-097 section 6.3 and section 7's
 * `do-spaces` row).
 *
 * Two distinct buckets in one region: a private, non-website staging bucket
 * that receives every generation-prefixed staged object, and a public
 * website served bucket that activation replaces in place, marker last. The
 * caller supplies one limited Read/Write/Delete key pair (plus an optional
 * session token); this package never touches the protected full-access
 * control key, never creates or deletes a bucket, never changes a bucket
 * configuration and never purges a cache.
 *
 * Every provider call names the `(stage, callClass)` row of
 * `gala-do-spaces-sigv4-v2` it is issuing and is rendered from that row, so
 * the declared catalog is the complete set of requests this adapter can make.
 * In particular the catalog has no object-`GET` row, and this adapter issues
 * none: the activation marker is read over the credential-free website
 * origin, and the served root is written from the frozen envelope's own bytes
 * rather than from a read-back.
 *
 * Its honest weaknesses are declared, not hidden: activation is
 * `replace-in-place`, so a mixed-generation window genuinely exists between
 * the first object write and the marker write; concurrency is
 * `best-effort`, because the read-then-compare plus conditional marker
 * write is not a provider fence; and `providerInventoryAssurance` is
 * `none`, because an S3 `ETag` is not a content digest.
 *
 * @module
 */

import {
  fenceDisagrees,
  fenceFor,
  requireGenerationFence,
  sha256Hex,
} from '@rathnasgala2/adapter-protocol';

import { computeArtifactDigest } from './artifact-projection.js';
import { describeCapabilities as buildCapabilities } from './capability.js';
import {
  GENERATION_MARKER_KEY,
  LIST_PAGE_SIZE,
  MAXIMUM_SINGLE_PART_BYTES,
  STAGE_PREFIX,
} from './constants.js';
import { MARKER, MARKER_CACHE_CONTROL, MARKER_MEDIA_TYPE } from './marker.js';
import { deriveOrigins, requirePublicWebsiteOrigin } from './origins.js';
import { buildRequestTemplates } from './request-catalog.js';
import { listPrefix, requireStatus, send } from './s3.js';
import {
  ACTIVATE_CALLS,
  ROLLBACK_CALLS,
  STAGE_CALLS,
  deriveStagePrefix,
  isOwnedStagePrefix,
  parseStageToken,
  putObject,
} from './staging.js';
import {
  recallStage,
  recallStageForGeneration,
  rememberStage,
} from './store.js';

export { generateUuidV7 } from '@rathnasgala2/adapter-protocol';
export { EXPECT_NOTHING_SERVED } from '@rathnasgala2/adapter-protocol';
export { computeArtifactDigest } from './artifact-projection.js';
export { ADAPTER_VERSION, GENERATION_MARKER_KEY } from './constants.js';
export { deriveOrigins } from './origins.js';
export {
  WEBSITE_CONFIGURATION,
  spacesControlPlaneCatalogDigests,
} from './capability.js';
export {
  errorDocumentKeyFor,
  spacesControlPlaneBinding,
  spacesRegionCatalog,
  spacesWebsiteConfiguration,
} from './dec097-records.js';
export { forgetDestination } from './store.js';
export {
  CONTROL_PLANE_REQUEST_PROFILE,
  CONTROL_PLANE_REQUEST_TARGET,
  CONTROL_PLANE_RESPONSE_PROFILE,
  CONTROL_PLANE_RESPONSE_PROFILES,
  buildControlPlaneRequestCatalog,
  buildControlPlaneResponseCatalog,
  proveLimitedKeyAccessDenied,
} from './control-plane.js';

/**
 * @typedef {Readonly<{
 *   region: string,
 *   servedBucket: string,
 *   stagingBucket: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   sessionToken?: string,
 *   publicBaseUrl?: string,
 *   controlPlaneEvidence?: Readonly<Record<string, unknown>>,
 *   fetch?: typeof globalThis.fetch,
 *   publicFetch?: typeof globalThis.fetch,
 *   onProviderCall?: (
 *     record: import('./s3.js').ProviderCallRecord
 *   ) => void
 * }>} SpacesDestination
 */

/**
 * @typedef {Readonly<{path: string, bytes: Buffer, immutable?: boolean}>} StagedFile
 */

/**
 * @typedef {Readonly<{
 *   origins: import('./origins.js').SpacesOrigins,
 *   served: import('./s3.js').BucketClient,
 *   staging: import('./s3.js').BucketClient,
 *   publicOrigin: string,
 *   publicFetch: typeof globalThis.fetch,
 *   identity: {region: string, servedBucket: string, stagingBucket: string}
 * }>} SpacesContext
 */

/**
 * Validate a destination and derive both bucket clients plus the public
 * website origin.
 *
 * @param {SpacesDestination} destination the caller-supplied destination
 * @returns {SpacesContext} the bound context
 */
function contextFor(destination) {
  for (const field of /** @type {const} */ ([
    'accessKeyId',
    'secretAccessKey',
  ])) {
    if (typeof destination?.[field] !== 'string' || destination[field] === '') {
      throw new TypeError(
        `destination.${field} (non-empty string) is required by adapter-do-spaces; this adapter never mints or discovers a credential`,
      );
    }
  }
  const origins = deriveOrigins(destination);
  const credentials = Object.freeze({
    accessKeyId: destination.accessKeyId,
    secretAccessKey: destination.secretAccessKey,
    ...(destination.sessionToken === undefined
      ? {}
      : { sessionToken: destination.sessionToken }),
    region: origins.region,
  });
  // The catalog's credential-header rows depend on whether the optional
  // session token is present, so the catalog a call is rendered from is the
  // same one the capability declaration digests for this destination.
  const templates = buildRequestTemplates(origins, {
    hasSessionToken: destination.sessionToken !== undefined,
  });
  const injected = destination.fetch;
  const onCall = destination.onProviderCall;
  return Object.freeze({
    origins,
    served: Object.freeze({
      host: origins.servedApiHost,
      origin: origins.servedApiOrigin,
      credentials,
      templates,
      ...(injected === undefined ? {} : { fetch: injected }),
      ...(onCall === undefined ? {} : { onCall }),
    }),
    staging: Object.freeze({
      host: origins.stagingApiHost,
      origin: origins.stagingApiOrigin,
      credentials,
      templates,
      ...(injected === undefined ? {} : { fetch: injected }),
      ...(onCall === undefined ? {} : { onCall }),
    }),
    publicOrigin: requirePublicWebsiteOrigin(
      origins,
      destination.publicBaseUrl,
    ),
    publicFetch:
      destination.publicFetch ?? destination.fetch ?? globalThis.fetch,
    identity: {
      region: origins.region,
      servedBucket: origins.servedBucket,
      stagingBucket: origins.stagingBucket,
    },
  });
}

/**
 * `describeCapabilities`: the exact `do-spaces` capability row.
 *
 * @param {SpacesDestination} destination the bound destination
 * @returns {Promise<Readonly<Record<string, unknown>>>} the declaration
 */
export async function describeCapabilities(destination) {
  const context = contextFor(destination);
  return Promise.resolve(
    buildCapabilities({
      origins: context.origins,
      hasSessionToken: destination.sessionToken !== undefined,
    }),
  );
}

/**
 * Percent-encode one object key for the credential-free website origin.
 *
 * @param {string} key the object key
 * @returns {string} the encoded website path
 */
function websitePath(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

/**
 * Read the served bucket's activation pointer over the credential-free
 * website origin.
 *
 * This is deliberately *not* a signed provider read: DEC-097's closed Spaces
 * catalog has no object-`GET` row, and the marker's whole purpose is to be
 * the object public verification reads first, so reading it the way a reader
 * does is both the only declarable way and the truthful one.
 *
 * @param {SpacesContext} context the bound context
 * @returns {Promise<{generationId: string | null, artifactDigest: string | null, findings: string[]}>}
 *   the observed pointer
 */
async function readServedMarker(context) {
  const response = await context.publicFetch(
    `${context.publicOrigin}/${websitePath(GENERATION_MARKER_KEY)}`,
    { method: 'GET', redirect: 'error', cache: 'no-store' },
  );
  if (response.status === 404 || response.status === 403) {
    return { generationId: null, artifactDigest: null, findings: [] };
  }
  if (response.status !== 200) {
    return {
      generationId: null,
      artifactDigest: null,
      findings: [
        `the public generation marker read returned HTTP ${response.status}`,
      ],
    };
  }
  const decoded = MARKER.decode(Buffer.from(await response.arrayBuffer()));
  if ('refusal' in decoded) {
    return {
      generationId: null,
      artifactDigest: null,
      findings: [decoded.refusal],
    };
  }
  return {
    generationId: decoded.generationId,
    artifactDigest: decoded.artifactDigest,
    findings: [],
  };
}

/**
 * `HEAD` one served object through a declared `object-head` row.
 *
 * @param {SpacesContext} context the bound context
 * @param {'inspect' | 'observe'} stage the issuing stage
 * @param {string} key the served object key
 * @returns {Promise<import('./s3.js').S3Response>} the bounded response
 */
async function headServedObject(context, stage, key) {
  return send(context.served, { stage, callClass: 'object-head', key });
}

/**
 * Enumerate the served root, excluding the marker coordinate, through the
 * `observe/generation-list` row. For this adapter the destination base path
 * is the bucket root, so the raw bound prefix is the empty string.
 *
 * @param {SpacesContext} context the bound context
 * @returns {Promise<string[]>} every served object key
 */
async function listServedInventory(context) {
  const keys = await listPrefix(context.served, 'observe', '', LIST_PAGE_SIZE);
  return keys
    .map((entry) => entry.key)
    .filter((key) => key !== GENERATION_MARKER_KEY);
}

/**
 * `inspectDestination`: report the served generation from the activation
 * pointer plus the complete served-root enumeration used for
 * reconciliation.
 *
 * @param {SpacesDestination} destination the bound destination
 * @returns {Promise<Readonly<Record<string, unknown>>>} the inspection result
 */
export async function inspectDestination(destination) {
  const context = contextFor(destination);
  const marker = await readServedMarker(context);
  const head = await headServedObject(
    context,
    'inspect',
    GENERATION_MARKER_KEY,
  );
  const servedKeys = await listServedInventory(context);
  /** @type {string[]} */
  const findings = [...marker.findings];
  if (marker.generationId !== null && head.status === 404) {
    findings.push(
      'the website origin serves a generation marker the object origin does not have',
    );
  }
  return Object.freeze({
    currentGenerationId: marker.generationId,
    currentArtifactDigest: marker.artifactDigest,
    markerEtag: head.etag,
    retainedHistory: Object.freeze([]),
    releaseGenerationsOnDisk: Object.freeze(
      marker.generationId === null ? [] : [marker.generationId],
    ),
    servedObjectCount: servedKeys.length,
    findings: Object.freeze(findings),
  });
}

/**
 * `preflight`: check every declared route against the portable path rules
 * and the reserved marker coordinate, and read the served pointer for
 * fencing. No credential writes anything here.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   entries: readonly {path: string}[],
 *   expectedGenerationId?: string
 * }} input the preflight input
 * @returns {Promise<Readonly<Record<string, unknown>>>} the preflight result
 */
export async function preflight(input) {
  const context = contextFor(input.destination);
  /** @type {string[]} */
  const findings = [];
  const seen = new Set();
  for (const entry of input.entries) {
    if (entry.path === GENERATION_MARKER_KEY) {
      findings.push(
        `${entry.path}: collides with the reserved public-generation-marker coordinate`,
      );
    }
    if (
      entry.path.startsWith(STAGE_PREFIX) ||
      entry.path.startsWith('_gala/')
    ) {
      findings.push(`${entry.path}: collides with the reserved _gala/ prefix`);
    }
    if (entry.path.startsWith('/') || entry.path.includes('\\')) {
      findings.push(`${entry.path}: is not a portable relative POSIX path`);
    }
    if (
      entry.path
        .split('/')
        .some(
          (segment) => segment === '' || segment === '.' || segment === '..',
        )
    ) {
      findings.push(`${entry.path}: contains an empty or dot path segment`);
    }
    if (Buffer.byteLength(entry.path, 'utf8') > 512) {
      findings.push(`${entry.path}: exceeds the 512-byte key ceiling`);
    }
    if (seen.has(entry.path)) {
      findings.push(`${entry.path}: is declared more than once`);
    }
    seen.add(entry.path);
  }

  const marker = await readServedMarker(context);
  findings.push(...marker.findings);
  if (
    input.expectedGenerationId !== undefined &&
    marker.generationId !== null &&
    input.expectedGenerationId !== marker.generationId
  ) {
    findings.push(
      `expected generation ${JSON.stringify(input.expectedGenerationId)} disagrees with the served generation ${JSON.stringify(marker.generationId)}`,
    );
  }

  return Object.freeze({
    verdict: findings.length === 0 ? 'proceed' : 'refuse',
    observedGenerationId: marker.generationId,
    findings: Object.freeze(findings),
  });
}

/**
 * The exact closed set of deployment-object media types DEC-097 admits. A
 * value outside this list is not representable as
 * `deployment-object-media-type`, so {@link mediaTypeFor} can only ever
 * return a member of it.
 */
export const DEPLOYMENT_MEDIA_TYPES = Object.freeze([
  'application/atom+xml; charset=utf-8',
  'application/javascript; charset=utf-8',
  'application/json; charset=utf-8',
  'application/manifest+json; charset=utf-8',
  'application/octet-stream',
  'application/rss+xml; charset=utf-8',
  'application/xml; charset=utf-8',
  'font/woff2',
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'text/css; charset=utf-8',
  'text/html; charset=utf-8',
  'text/plain; charset=utf-8',
]);

/** The cache directive an immutable manifest asset is written with. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** The cache directive every other deployment object is written with. */
export const DEFAULT_CACHE_CONTROL = 'no-cache';

/** The extension-to-media-type table, whose every value is an admitted one. */
const MEDIA_TYPE_TABLE = Object.freeze({
  atom: 'application/atom+xml; charset=utf-8',
  avif: 'image/avif',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  png: 'image/png',
  rss: 'application/rss+xml; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  webp: 'image/webp',
  woff2: 'font/woff2',
  xml: 'application/xml; charset=utf-8',
});

/**
 * Label an object key with an admitted deployment media type. The set is
 * deliberately tiny and closed: this adapter never interprets content, it
 * only labels the handful of extensions a static site genuinely needs, and
 * every value it can produce is a member of {@link DEPLOYMENT_MEDIA_TYPES}.
 *
 * @param {string} key the object key
 * @returns {string} the media type
 */
export function mediaTypeFor(key) {
  const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const media = /** @type {Record<string, string>} */ (MEDIA_TYPE_TABLE)[
    extension
  ];
  return media ?? 'application/octet-stream';
}

/**
 * The cache directive one deployment object is written with: the immutable
 * directive exactly when the entry is an immutable manifest asset, and
 * `no-cache` otherwise.
 *
 * @param {{immutable?: boolean}} file the staged file entry
 * @returns {string} the cache directive
 */
export function cacheControlFor(file) {
  return file.immutable === true
    ? IMMUTABLE_CACHE_CONTROL
    : DEFAULT_CACHE_CONTROL;
}

/**
 * Build the declared object-metadata set for one deployment object.
 *
 * @param {StagedFile} file the staged file
 * @returns {import('./s3.js').ObjectMetadata} the three metadata values
 */
function metadataFor(file) {
  return Object.freeze({
    mediaType: mediaTypeFor(file.path),
    cacheControl: cacheControlFor(file),
    // DEC-097: the metadata digest is the 64 lowercase hexadecimal payload
    // SHA-256 obtained by removing *only* the `sha256:` tag.
    untaggedSha256: sha256Hex(file.bytes).slice('sha256:'.length),
  });
}

/**
 * Build the marker's exactly-fixed object-metadata set.
 *
 * @param {Buffer} markerBytes the compact-JCS marker bytes
 * @returns {import('./s3.js').ObjectMetadata} the three metadata values
 */
function markerMetadata(markerBytes) {
  return Object.freeze({
    mediaType: MARKER_MEDIA_TYPE,
    cacheControl: MARKER_CACHE_CONTROL,
    untaggedSha256: sha256Hex(markerBytes).slice('sha256:'.length),
  });
}

/**
 * `stage`: write the complete generation, plus its marker, under this
 * operation's exact private prefix in the staging bucket. Nothing in the
 * served bucket is read or written.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   files: readonly StagedFile[]
 * }} input the stage input; a file may carry `immutable: true` to be written
 *   with the immutable cache directive
 * @returns {Promise<Readonly<Record<string, unknown>>>} the stage result
 */
export async function stage(input) {
  const context = contextFor(input.destination);
  const prefix = deriveStagePrefix(input);

  // The durable half of the idempotency check: this intent's own private
  // staged candidate, through the one row DEC-097 binds to exactly that
  // prefix. It cannot read an object back, so it can prove presence but not
  // identity; the identity comparison is the run-scoped record below.
  const alreadyStaged = await listPrefix(
    context.staging,
    'inspect',
    prefix.rootPrefix,
    LIST_PAGE_SIZE,
  );
  const remembered = recallStage(context.identity, prefix.stageToken);
  if (remembered !== null) {
    if (remembered.artifactDigest !== input.artifactDigest) {
      throw new Error(
        `IDEMPOTENCY_KEY_REUSE_CONFLICT: this operation/attempt/generation already staged artifact digest ${remembered.artifactDigest}`,
      );
    }
    if (alreadyStaged.length > 0) {
      return Object.freeze({
        stageToken: prefix.stageToken,
        stagedPath: `s3://${context.origins.stagingBucket}/${prefix.rootPrefix}`,
        fileCount: remembered.entryPaths.length,
        byteCount: remembered.byteCount,
        idempotent: true,
      });
    }
  }

  let byteCount = 0n;
  for (const file of input.files) {
    byteCount += BigInt(file.bytes.byteLength);
    await putObject(
      context.staging,
      STAGE_CALLS,
      STAGE_CALLS.put,
      `${prefix.rootPrefix}${file.path}`,
      file.bytes,
      metadataFor(file),
    );
  }

  const markerBytes = MARKER.encode({
    artifactId: input.artifactId,
    artifactDigest: input.artifactDigest,
    generationId: input.generationId,
  });
  await putObject(
    context.staging,
    STAGE_CALLS,
    STAGE_CALLS.markerPut,
    `${prefix.rootPrefix}${GENERATION_MARKER_KEY}`,
    markerBytes,
    markerMetadata(markerBytes),
  );

  rememberStage(context.identity, {
    stageToken: prefix.stageToken,
    operationId: input.operationId,
    attemptId: input.attemptId,
    idempotencyKey: input.idempotencyKey,
    generationId: input.generationId,
    artifactId: input.artifactId,
    artifactDigest: input.artifactDigest,
    operationPrefix: prefix.operationPrefix,
    rootPrefix: prefix.rootPrefix,
    entryPaths: input.files.map((file) => file.path),
    byteCount: byteCount.toString(10),
    files: input.files.map((file) =>
      Object.freeze({
        path: file.path,
        bytes: file.bytes,
        immutable: file.immutable === true,
      }),
    ),
  });

  return Object.freeze({
    stageToken: prefix.stageToken,
    stagedPath: `s3://${context.origins.stagingBucket}/${prefix.rootPrefix}`,
    fileCount: input.files.length,
    byteCount: byteCount.toString(10),
    idempotent: false,
  });
}

/**
 * Replace the served root in place with one exact file set, writing the
 * activation pointer last, through one of the two served-root call plans.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   stageToken?: string,
 *   generationId: string,
 *   expectedCurrentGenerationId: unknown,
 *   expectedArtifactDigest?: string,
 *   files?: readonly StagedFile[],
 *   artifactId?: string,
 *   artifactDigest?: string,
 *   crashInjectionHook?: () => void | Promise<void>
 * }} input the activation input
 * @param {import('./staging.js').CallPlan} plan the served-root call plan
 * @returns {Promise<Readonly<Record<string, unknown>>>} the decision
 */
async function replaceServedRoot(input, plan) {
  // LOCAL-47: the fence is validated before anything is read or written, so
  // `null`/`undefined` can never silently mean "do not fence me".
  const fence = requireGenerationFence(
    input.expectedCurrentGenerationId,
    'adapter-do-spaces',
  );
  const context = contextFor(input.destination);
  const marker = await readServedMarker(context);

  if (marker.generationId === input.generationId) {
    return Object.freeze({
      decision: 'activate',
      generationId: input.generationId,
      previousGenerationId: marker.generationId,
      idempotent: true,
    });
  }
  if (fenceDisagrees(fence, marker.generationId)) {
    // Nothing has been written yet, so this refusal is the one reconcile
    // decision that can honestly say the destination is unchanged.
    return Object.freeze({
      decision: 'reconcile',
      generationId: input.generationId,
      previousGenerationId: marker.generationId,
      idempotent: false,
      destinationChanged: /** @type {false} */ (false),
    });
  }

  const remembered =
    input.stageToken === undefined
      ? null
      : recallStage(context.identity, input.stageToken);
  const files = input.files ?? remembered?.files;
  if (files === undefined) {
    throw new Error(
      `SPACES_STAGE_NOT_FOUND: stage token ${JSON.stringify(input.stageToken ?? null)} was not staged by this run and the closed Spaces catalog has no object-GET row to read it back with; supply its bytes through "files"`,
    );
  }
  const artifactId = input.artifactId ?? remembered?.artifactId;
  if (artifactId === undefined) {
    throw new Error(
      'SPACES_ACTIVATION_IDENTITY_UNAVAILABLE: the generation marker needs an artifactId; supply "artifactId" when activating bytes this run did not stage',
    );
  }
  const artifactDigest =
    input.artifactDigest ??
    remembered?.artifactDigest ??
    computeArtifactDigest(files);

  if (input.expectedArtifactDigest !== undefined) {
    const recomputed = computeArtifactDigest(files);
    if (recomputed !== input.expectedArtifactDigest) {
      throw new Error(
        `STAGE_INTEGRITY_MISMATCH: the staged generation digests to ${recomputed}, which disagrees with the expected artifact digest ${input.expectedArtifactDigest}; refusing to activate a partial or tampered stage`,
      );
    }
  }

  if (input.crashInjectionHook !== undefined) {
    // Staging is durably committed in the private bucket and the served
    // bucket has not been touched: exactly the boundary a real crash could
    // land on. Only a conformance test ever reaches this branch.
    await input.crashInjectionHook();
  }

  // The conditional guard needs the pointer's current ETag. It comes from
  // the declared `inspect/object-head` row, never from an object GET.
  const pointerHead = await headServedObject(
    context,
    'inspect',
    GENERATION_MARKER_KEY,
  );

  const servedBefore = new Set(await listServedInventory(context));
  /** @type {string[]} */
  const written = [];
  for (const file of files) {
    if (file.path === GENERATION_MARKER_KEY) {
      continue;
    }
    await putObject(
      context.served,
      plan,
      plan.put,
      file.path,
      file.bytes,
      metadataFor(file),
    );
    written.push(file.path);
    servedBefore.delete(file.path);
  }

  for (const superseded of servedBefore) {
    requireStatus(
      await send(context.served, {
        stage: plan.stage,
        callClass: 'served-root-delete',
        key: superseded,
      }),
      [204, 200, 404],
      `${plan.stage}/served-root-delete`,
    );
  }

  // The activation pointer is written last, so a caller reading the marker
  // never sees a generation claim the served inventory does not yet back.
  const markerBytes = MARKER.encode({
    artifactId,
    artifactDigest,
    generationId: input.generationId,
  });
  // The conditional guard is sent unsigned and outside the catalog: its value
  // is a provider-returned ETag rather than a fixed literal or one of
  // DEC-097's closed derived sources, so it is not representable as a
  // template header. It is a best-effort compare-and-set the provider may or
  // may not honour — which is exactly why this adapter declares
  // `concurrency: best-effort` rather than claiming a fence.
  const conditional =
    pointerHead.status === 404 || pointerHead.etag === null
      ? { 'if-none-match': '*' }
      : { 'if-match': pointerHead.etag };
  const pointerWrite = await send(context.served, {
    stage: plan.stage,
    callClass: plan.markerPut,
    key: GENERATION_MARKER_KEY,
    body: markerBytes,
    metadata: markerMetadata(markerBytes),
    conditional,
  });
  if (pointerWrite.status === 412 || pointerWrite.status === 409) {
    // Losing the pointer race does not undo the served-root writes and
    // deletions this attempt already performed: `replace-in-place` has no
    // transaction. The decision therefore reports the mutation it made, so
    // a journal can never record this outcome as leaving the destination
    // untouched, and the served root is left for reconciliation.
    return Object.freeze({
      decision: 'reconcile',
      generationId: input.generationId,
      previousGenerationId: marker.generationId,
      idempotent: false,
      pointerPreconditionFailed: true,
      destinationChanged: /** @type {true} */ (true),
      writtenObjectCount: written.length,
      supersededObjectCount: servedBefore.size,
    });
  }
  requireStatus(pointerWrite, [200], `${plan.stage}/${plan.markerPut}`);

  const confirmed = await readServedMarker(context);
  if (confirmed.generationId !== input.generationId) {
    throw new Error(
      `SPACES_ACTIVATION_UNCONFIRMED: after writing the pointer the served marker names ${JSON.stringify(confirmed.generationId)}`,
    );
  }

  return Object.freeze({
    decision: 'activate',
    generationId: input.generationId,
    previousGenerationId: marker.generationId,
    idempotent: false,
    destinationChanged: /** @type {true} */ (true),
    writtenObjectCount: written.length,
    supersededObjectCount: servedBefore.size,
  });
}

/**
 * `activate`: replace the served root in place with a staged generation,
 * writing the activation pointer last.
 *
 * The bytes written are the frozen envelope's own: either `files`, or — when
 * the caller does not supply them — the exact bytes this run recorded when it
 * staged `stageToken`. There is no provider read-back, because DEC-097's
 * closed Spaces catalog has no object-`GET` row.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   stageToken?: string,
 *   generationId: string,
 *   expectedCurrentGenerationId: string,
 *   expectedArtifactDigest?: string,
 *   files?: readonly StagedFile[],
 *   artifactId?: string,
 *   artifactDigest?: string,
 *   crashInjectionHook?: () => void | Promise<void>
 * }} input the activate input; `expectedCurrentGenerationId` is mandatory and
 *   is either a generation identity or the `EXPECT_NOTHING_SERVED` sentinel
 * @returns {Promise<Readonly<Record<string, unknown>>>} the decision
 */
export async function activate(input) {
  return replaceServedRoot(input, ACTIVATE_CALLS);
}

/**
 * `observe`: verify the served generation through the public website origin
 * plus the complete served-root enumeration. Enumeration is used for
 * reconciliation, never as an inventory-completeness claim
 * (`providerInventoryAssurance: none`).
 *
 * @param {{
 *   destination: SpacesDestination,
 *   generationId: string,
 *   expectedArtifactDigest: string
 * }} input the observe input
 * @returns {Promise<Readonly<Record<string, unknown>>>} the observation
 */
export async function observe(input) {
  const context = contextFor(input.destination);
  const marker = await readServedMarker(context);
  /** @type {string[]} */
  const findings = [...marker.findings];

  if (marker.generationId !== input.generationId) {
    findings.push(
      `the activation pointer names generation ${JSON.stringify(marker.generationId)}, not the observed generation ${JSON.stringify(input.generationId)}`,
    );
  }
  const markerValid =
    marker.generationId === input.generationId &&
    marker.artifactDigest === input.expectedArtifactDigest;
  if (!markerValid) {
    findings.push(
      'the public generation marker is missing, invalid or disagrees with the expected identity',
    );
  }

  // The declared `observe/object-head` row: the marker the website origin
  // served must be the same object the object origin stores, and its
  // recorded untagged digest must match those exact bytes.
  const markerHead = await headServedObject(
    context,
    'observe',
    GENERATION_MARKER_KEY,
  );
  if (markerHead.status !== 200) {
    findings.push(
      `the generation marker HEAD at the object origin returned HTTP ${markerHead.status}`,
    );
  }

  const servedKeys = await listServedInventory(context);
  /** @type {{path: string, bytes: Buffer}[]} */
  const observed = [];
  for (const key of servedKeys) {
    const response = await context.publicFetch(
      `${context.publicOrigin}/${websitePath(key)}`,
      { method: 'GET', redirect: 'error', cache: 'no-store' },
    );
    if (response.status !== 200) {
      findings.push(`${key}: public read returned HTTP ${response.status}`);
      continue;
    }
    observed.push({
      path: key,
      bytes: Buffer.from(await response.arrayBuffer()),
    });
  }
  const observedArtifactDigest = computeArtifactDigest(observed);
  if (observedArtifactDigest !== input.expectedArtifactDigest) {
    findings.push(
      `the publicly observed artifact digest ${observedArtifactDigest} disagrees with the expected ${input.expectedArtifactDigest}`,
    );
  }

  return Object.freeze({
    verified: findings.length === 0,
    observedArtifactDigest,
    currentGenerationId: marker.generationId,
    markerValid,
    claimsCompleteInventory: /** @type {false} */ (false),
    findings: Object.freeze(findings),
  });
}

/**
 * `cleanupStaged`: delete exactly this operation's private stage prefix.
 * The served bucket is never read for mutation here and never written.
 *
 * The prefix comes from inverting the stage token, not from a bucket-resident
 * control object: the token is a pure projection of the three identity
 * segments, and only a prefix this adapter could itself have derived is ever
 * deleted by prefix.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   stageToken?: string,
 *   generationId?: string
 * }} input the cleanup input
 * @returns {Promise<Readonly<{removed: boolean, deletedObjectCount: number}>>}
 *   the cleanup result
 */
export async function cleanupStaged(input) {
  const context = contextFor(input.destination);
  const stageToken =
    input.stageToken ??
    (input.generationId === undefined
      ? undefined
      : (recallStageForGeneration(context.identity, input.generationId)
          ?.stageToken ?? undefined));
  if (stageToken === undefined) {
    return Object.freeze({ removed: false, deletedObjectCount: 0 });
  }

  /** @type {{operationPrefix: string, rootPrefix: string}} */
  let coordinates;
  try {
    coordinates = parseStageToken(stageToken);
  } catch {
    throw new Error(
      `SPACES_CLEANUP_PREFIX_REFUSED: ${JSON.stringify(stageToken)} does not invert to this adapter's own operation-scoped stage prefix under ${STAGE_PREFIX}`,
    );
  }
  // Belt and braces: the inverse is arithmetic, but cleanup deletes by
  // prefix, so the prefix it is about to use is re-checked against the exact
  // shape this adapter can derive. A prefix naming `_gala/staged/v2/` would
  // otherwise delete every other operation's stage.
  if (!isOwnedStagePrefix(coordinates.operationPrefix)) {
    throw new Error(
      `SPACES_CLEANUP_PREFIX_REFUSED: ${JSON.stringify(coordinates.operationPrefix)} is not this adapter's own operation-scoped stage prefix under ${STAGE_PREFIX}`,
    );
  }

  const keys = await listPrefix(
    context.staging,
    'inspect',
    coordinates.rootPrefix,
    LIST_PAGE_SIZE,
  );
  for (const entry of keys) {
    requireStatus(
      await send(context.staging, {
        stage: 'cleanup-staged',
        callClass: 'staged-object-delete',
        key: entry.key,
      }),
      [204, 200, 404],
      'cleanup-staged/staged-object-delete',
    );
  }
  return Object.freeze({
    removed: keys.length > 0,
    deletedObjectCount: keys.length,
  });
}

/**
 * `rollback`: `rollback: reupload` semantics. Spaces cannot natively
 * re-promote a historical generation, so a rollback stages a fresh copy of
 * the selected generation's bytes under a new generation identity and
 * re-promotes it through the `rollback/*` served-root rows.
 *
 * The historical bytes come from the caller when it supplies them, and
 * otherwise from what this run itself staged. There is no third source: the
 * closed Spaces catalog has no object-`GET` row, so a generation neither
 * supplied nor staged in this run cannot be read back, and the rollback fails
 * closed rather than pretending it can.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   targetGenerationId: string,
 *   newGenerationId: string,
 *   newArtifactId: string,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   files?: readonly StagedFile[]
 * }} input the rollback input
 * @returns {Promise<Readonly<Record<string, unknown>>>} the decision
 */
export async function rollback(input) {
  const context = contextFor(input.destination);

  /** @type {readonly StagedFile[]} */
  let files;
  if (input.files !== undefined) {
    files = input.files;
  } else {
    const remembered = recallStageForGeneration(
      context.identity,
      input.targetGenerationId,
    );
    if (remembered === null) {
      throw new Error(
        `ROLLBACK_INPUT_UNAVAILABLE: generation ${JSON.stringify(input.targetGenerationId)} was not staged by this run and the closed Spaces catalog has no object-GET row to read a historical generation back with; supply its bytes through "files"`,
      );
    }
    files = remembered.files.filter(
      (file) => file.path !== GENERATION_MARKER_KEY,
    );
  }

  const artifactDigest = computeArtifactDigest(files);
  const staged = await stage({
    destination: input.destination,
    operationId: input.operationId,
    attemptId: input.attemptId,
    idempotencyKey: input.idempotencyKey,
    generationId: input.newGenerationId,
    artifactId: input.newArtifactId,
    artifactDigest,
    files,
  });
  const marker = await readServedMarker(context);
  return replaceServedRoot(
    {
      destination: input.destination,
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId: input.newGenerationId,
      expectedCurrentGenerationId: fenceFor(marker.generationId),
    },
    ROLLBACK_CALLS,
  );
}

/** The declared single-part request-body ceiling, re-exported for callers. */
export { MAXIMUM_SINGLE_PART_BYTES };

/** This package's runtime status: fully implemented per S4-T05 (W4-11). */
export const PACKAGE_STATUS = Object.freeze({
  name: '@rathnasgala2/adapter-do-spaces',
  implemented: true,
  implementingTask: 'S4-T05',
});
