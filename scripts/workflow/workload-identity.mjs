/**
 * The derived identities and canonical digests both workload request
 * builders need, and nothing else.
 *
 * Everything here is a pure function of explicit inputs, and every derived
 * value is *deterministic* for one authorized attempt: a rerun of the same
 * run attempt over the same bytes derives the same artifact identity, the
 * same Pages build version and the same Spaces stage prefix, which is what
 * makes a retried exchange a replay rather than a second claim.
 *
 * @module
 */

import { createHash } from 'node:crypto';

/** DEC-097's `pagesBuildVersion` domain separator. */
export const PAGES_BUILD_VERSION_DOMAIN = 'GALA-PAGES-BUILD-VERSION-V2\u0000';

/** DEC-097's Spaces staging-prefix root. */
export const SPACES_STAGE_PREFIX_ROOT = '_gala/staged/v2/';

/**
 * Canonical JSON (RFC 8785 subset): object members in code-unit order, no
 * insignificant whitespace. Every value these builders canonicalize is a
 * string, a safe integer or a nested object of those, which is the subset
 * where `JSON.stringify` over sorted keys is already canonical.
 *
 * @param {unknown} value the value to canonicalize
 * @returns {string} the canonical text
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new Error(
        'WORKLOAD_CANONICALIZATION_REFUSED: only safe integers are canonicalized here',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const members = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(',')}}`;
}

/**
 * The tagged SHA-256 of one UTF-8 string.
 *
 * @param {string} text the text to digest
 * @returns {string} `sha256:` plus 64 lowercase hex characters
 */
export function taggedDigest(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * Derive one UUIDv7-shaped `stableId` from a domain-separated preimage.
 *
 * The contract's `stableId` domain is syntactically a UUIDv7, and a workload
 * has no clock authority to mint a real one: what it needs is an identity
 * that is stable across a retry of the same attempt and distinct across
 * different attempts. So the 128 bits come from SHA-256 over the preimage,
 * with the version and variant nibbles stamped to the admitted values.
 *
 * @param {string} domain the domain separator
 * @param {unknown} preimage the canonicalizable preimage
 * @returns {string} the derived `stableId`
 */
export function deriveStableId(domain, preimage) {
  const hex = createHash('sha256')
    .update(`${domain}\u0000`, 'utf8')
    .update(canonicalJson(preimage), 'utf8')
    .digest('hex');
  const variant = '89ab'.charAt(Number.parseInt(hex.slice(16, 17), 16) & 0b11);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `7${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * DEC-097's `pagesBuildVersion`: the first 40 lowercase hexadecimal
 * characters of the digest over the domain separator and the closed
 * operation/attempt/generation/artifact binding.
 *
 * @param {{
 *   repositoryId: string,
 *   operationId: string,
 *   attemptId: string,
 *   runId: string,
 *   runAttempt: number,
 *   artifactId: string,
 *   artifactDigest: string,
 *   proposedGenerationId: string
 * }} binding the closed preimage members
 * @returns {string} the 40-character build version
 */
export function derivePagesBuildVersion(binding) {
  return createHash('sha256')
    .update(PAGES_BUILD_VERSION_DOMAIN, 'utf8')
    .update(
      canonicalJson({
        repositoryId: binding.repositoryId,
        operationId: binding.operationId,
        attemptId: binding.attemptId,
        runId: binding.runId,
        runAttempt: binding.runAttempt,
        artifactId: binding.artifactId,
        artifactDigest: binding.artifactDigest,
        proposedGenerationId: binding.proposedGenerationId,
      }),
      'utf8',
    )
    .digest('hex')
    .slice(0, 40);
}

/**
 * DEC-097's raw Spaces staging prefix, exactly.
 *
 * @param {{operationId: string, attemptId: string, proposedGenerationId: string}} binding
 *   the operation/attempt/generation binding
 * @returns {string} the staging prefix, trailing slash included
 */
export function deriveSpacesStagePrefix(binding) {
  return `${SPACES_STAGE_PREFIX_ROOT}${binding.operationId}/${binding.attemptId}/${binding.proposedGenerationId}/`;
}

/**
 * The exact operation id a publish ref names.
 *
 * @param {string} ref the full git ref
 * @returns {string} the operation id
 */
export function operationIdFromPublishRef(ref) {
  const match = /^refs\/heads\/gala\/publish\/([0-9a-f-]{36})$/u.exec(ref);
  if (match === null) {
    throw new Error(
      'WORKLOAD_PUBLISH_REF_INVALID: the job is not running on an exact refs/heads/gala/publish/<operationId> ref',
    );
  }
  return /** @type {string} */ (match[1]);
}

/** The closed extension-to-route-class projection the plan entries use. */
const ROUTE_CLASSES = Object.freeze({
  '.html': /** @type {const} */ ('html'),
  '.xml': /** @type {const} */ ('sitemap'),
  '.atom': /** @type {const} */ ('feed'),
  '.json': /** @type {const} */ ('asset'),
});

/** The closed extension-to-content-type projection. */
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.atom': 'application/atom+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/vnd.microsoft.icon',
});

/**
 * Project one artifact path onto its public route, route class and expected
 * content type. An extension the closed projection does not name is an
 * `asset` served as `application/octet-stream`: unknown types are served
 * inertly rather than sniffed.
 *
 * @param {string} artifactPath the artifact-relative path
 * @returns {{publicRoute: string, routeClass: 'html'|'feed'|'sitemap'|'asset'|'error', expectedContentType: string}}
 *   the projection
 */
export function projectRoute(artifactPath) {
  const dot = artifactPath.lastIndexOf('.');
  const extension = dot === -1 ? '' : artifactPath.slice(dot).toLowerCase();
  /** @type {'html'|'feed'|'sitemap'|'asset'|'error'} */
  const routeClass =
    artifactPath === '404.html' || artifactPath.endsWith('/404.html')
      ? 'error'
      : (ROUTE_CLASSES[/** @type {keyof typeof ROUTE_CLASSES} */ (extension)] ??
        'asset');
  return {
    publicRoute: `/${artifactPath}`,
    routeClass,
    expectedContentType:
      CONTENT_TYPES[/** @type {keyof typeof CONTENT_TYPES} */ (extension)] ??
      'application/octet-stream',
  };
}

/**
 * Build the `verificationSubmission` union arm the artifact fits into.
 *
 * A candidate with more entries than the contract's `fit` bound is not
 * truncated and is not silently dropped: it is submitted as the explicit
 * `unfit` arm carrying the count Gala would have needed and the byte count
 * the fit request would have had, which is what lets Gala choose a sampled
 * verification tier instead of guessing.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the artifact files
 * @param {number} maximumEntries the contract's `fit` entry bound
 * @param {number} maximumRequestBytes the contract's request byte bound
 * @returns {Record<string, unknown>} the `verificationSubmission` value
 */
export function buildVerificationSubmission(
  files,
  maximumEntries,
  maximumRequestBytes,
) {
  const entries = [...files]
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
    .map((file) => ({
      path: file.path,
      ...projectRoute(file.path),
      byteLength: file.bytes.byteLength,
      expectedCandidateDigest: `sha256:${createHash('sha256').update(file.bytes).digest('hex')}`,
    }))
    .map((entry) => ({
      path: entry.path,
      publicRoute: entry.publicRoute,
      routeClass: entry.routeClass,
      expectedContentType: entry.expectedContentType,
      byteLength: entry.byteLength,
      expectedCandidateDigest: entry.expectedCandidateDigest,
    }));
  const fit = { state: 'fit', verificationEntries: entries };
  const fitBytes = Buffer.byteLength(canonicalJson(fit), 'utf8');
  if (entries.length > maximumEntries) {
    return {
      state: 'unfit',
      reason: 'entry-count-exceeded',
      requiredVerificationEntryCount: Math.min(entries.length, 200000),
      canonicalFitRequestByteCount: fitBytes,
    };
  }
  if (fitBytes > maximumRequestBytes) {
    return {
      state: 'unfit',
      reason: 'encoded-request-limit-exceeded',
      requiredVerificationEntryCount: Math.min(entries.length, 200000),
      canonicalFitRequestByteCount: fitBytes,
    };
  }
  return fit;
}
