/**
 * Canonical JSON (RFC 8785 JCS) serialization and domain-separated SHA-256
 * digests, matching the corpus convention: "Canonical contract digests are
 * RFC 8785 JCS plus SHA-256 over schema-valid I-JSON" (doc 04 section
 * "Portable repository contract", restated by DEC-097 throughout section 6).
 *
 * This module provides the general-purpose primitive. It does not hardcode
 * any schema-owned digest's domain-separator string except the one this
 * package itself defines and owns: the adapter-protocol negotiation-decision
 * digest in `negotiation.js`. A schema-defined digest (`capabilityDigest`,
 * `filesystemEvidenceDigest`, the kernel's `capabilityDecisionDigest`, and so
 * on) is computed by the owning caller with its own DEC-097 domain separator
 * using {@link canonicalizeJson} and {@link domainDigest} exported here.
 *
 * @module
 */

import { createHash } from 'node:crypto';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/**
 * Serialize one JSON-compatible value as RFC 8785 JSON Canonicalization
 * Scheme bytes: object keys sorted by UTF-16 code unit, no insignificant
 * whitespace, and no trailing newline.
 *
 * @param {unknown} value schema-valid I-JSON value (object, array, string,
 *   finite number, boolean or null)
 * @returns {string} canonical JSON text
 */
export function canonicalizeJson(value) {
  return canonicalizeValue(value);
}

/**
 * @param {unknown} value value to canonicalize
 * @returns {string} canonical JSON text for that value
 */
function canonicalizeValue(value) {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON rejects non-finite numbers');
    }
    if (Object.is(value, -0)) {
      return '0';
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return canonicalizeString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeValue(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareUtf16CodeUnits);
    const members = keys.map(
      (key) => `${canonicalizeString(key)}:${canonicalizeValue(record[key])}`,
    );
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`Canonical JSON rejects a value of type ${typeof value}`);
}

/**
 * Compare two strings by UTF-16 code unit, the RFC 8785 object-key sort
 * order.
 *
 * @param {string} left first string
 * @param {string} right second string
 * @returns {number} negative, zero or positive per code-unit comparison
 */
function compareUtf16CodeUnits(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Escape one string using the JSON string grammar. `JSON.stringify`'s string
 * escaping already matches RFC 8785's requirement (minimal escaping of `"`,
 * `\` and control characters, no unnecessary `\uXXXX` escapes for other
 * Unicode scalar values).
 *
 * @param {string} value string to escape
 * @returns {string} JSON-quoted string
 */
function canonicalizeString(value) {
  return JSON.stringify(value);
}

/**
 * Compute a domain-separated SHA-256 digest over one canonical value:
 * `SHA256(UTF8(domainSeparator) || JCS(value))`, matching every DEC-097
 * digest construction in this repository's contracts.
 *
 * @param {string} domainSeparator exact domain-separator string, including
 *   its trailing `\0` where the owning decision specifies one
 * @param {unknown} value the value to canonicalize and digest (typically the
 *   record with its own digest field omitted)
 * @returns {string} `sha256:<64 lowercase hex characters>`
 */
export function domainDigest(domainSeparator, value) {
  const hash = createHash('sha256');
  hash.update(Buffer.from(domainSeparator, 'utf8'));
  hash.update(Buffer.from(canonicalizeJson(value), 'utf8'));
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Compute a plain (non-domain-separated) SHA-256 digest over raw bytes.
 *
 * @param {Uint8Array | Buffer} bytes bytes to digest
 * @returns {string} `sha256:<64 lowercase hex characters>`
 */
export function sha256Hex(bytes) {
  const hash = createHash('sha256');
  hash.update(bytes);
  return `sha256:${hash.digest('hex')}`;
}

/**
 * The `GALA-ARTIFACT-V2 ` domain separator (DEC-097 section 8): the
 * UTF-8 path-sorted `{path, byteLength, sha256}` entry-list digest every S2
 * destination adapter verifies `stage`/`activate`/`observe` artifacts
 * against. Exported so the one {@link computeArtifactDigest} implementation
 * below, and any adapter that needs the raw separator directly, share the
 * exact same string rather than each declaring its own copy (PUB-M5: three
 * adapters previously restated this formula independently with no test
 * proving they agreed).
 *
 * @type {string}
 */
export const ARTIFACT_DIGEST_DOMAIN = 'GALA-ARTIFACT-V2 ';

/**
 * @typedef {Readonly<{path: string, byteLength: string, sha256: string}>} ArtifactEntry
 */

/**
 * Project one `{path, bytes}` pair onto its `GALA-ARTIFACT-V2 ` manifest
 * entry.
 *
 * @param {string} entryPath the artifact-relative UTF-8 path
 * @param {Uint8Array | Buffer} bytes the file bytes
 * @returns {ArtifactEntry} the projected, frozen entry
 */
export function projectArtifactEntry(entryPath, bytes) {
  return Object.freeze({
    path: entryPath,
    byteLength: String(bytes.byteLength),
    sha256: sha256Hex(bytes),
  });
}

/**
 * The single implementation of the DEC-097 section 8 artifact digest:
 * UTF-8-path-sort the `{path, bytes}` file set, project each entry to
 * `{path, byteLength, sha256}`, and digest the ordered list under
 * {@link ARTIFACT_DIGEST_DOMAIN}. `adapter-local-directory`,
 * `adapter-github-pages` and `adapter-do-spaces` each re-export this (a
 * marker-excluding wrapper where the adapter's own carrier reserves a
 * marker coordinate) instead of restating the formula, so the three
 * adapters' `computeArtifactDigest` are provably the same function rather
 * than three implementations a repository-level test merely observes to
 * currently agree.
 *
 * @param {readonly Readonly<{path: string, bytes: Uint8Array | Buffer}>[]} files
 *   the complete file set, in any order
 * @returns {string} the `GALA-ARTIFACT-V2 ` artifact digest
 */
export function computeArtifactDigest(files) {
  const entries = files
    .map((file) => projectArtifactEntry(file.path, file.bytes))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  return domainDigest(ARTIFACT_DIGEST_DOMAIN, entries);
}

/**
 * Test whether a value is a syntactically valid Gala digest string.
 *
 * @param {unknown} value candidate value
 * @returns {boolean} whether it matches `sha256:<64 lowercase hex>`
 */
export function isDigestString(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}
