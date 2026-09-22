/**
 * The artifact-digest projection this adapter verifies against.
 *
 * DEC-097 section 8 fixes the projection as the UTF-8 path-sorted
 * `{path, byteLength, sha256}` entry list under the `GALA-ARTIFACT-V2 `
 * domain separator — the same projection `@rathnasgala2/template`'s
 * manifest builder emits — so a digest this adapter recomputes from carrier
 * bytes or from public HTTP reads is directly comparable to the frozen
 * `artifact-manifest:2.0.0.artifactDigest` the workflow hands it.
 *
 * The reserved public-generation-marker coordinate is excluded: the marker
 * is staged beside the frozen payload and is deliberately outside
 * `artifactDigest` (brief section 5).
 *
 * @module
 */

import { domainDigest, sha256Hex } from '@rathnasgala2/adapter-protocol';

import { DOMAIN_ARTIFACT, GENERATION_MARKER_PATH } from './constants.js';

/**
 * @typedef {Readonly<{path: string, byteLength: string, sha256: string}>} ArtifactEntry
 */

/**
 * Project one `{path, bytes}` pair onto its manifest entry.
 *
 * @param {string} entryPath the artifact-relative POSIX path
 * @param {Buffer} bytes the file bytes
 * @returns {ArtifactEntry} the projected entry
 */
export function projectEntry(entryPath, bytes) {
  return Object.freeze({
    path: entryPath,
    byteLength: String(bytes.byteLength),
    sha256: sha256Hex(bytes),
  });
}

/**
 * Order a projected entry list by UTF-8 path.
 *
 * @param {readonly ArtifactEntry[]} entries the unordered entries
 * @returns {ArtifactEntry[]} a new, path-ordered array
 */
export function orderEntries(entries) {
  return [...entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

/**
 * Digest an already-projected, marker-excluding entry list.
 *
 * @param {readonly ArtifactEntry[]} entries the projected entries
 * @returns {string} the `GALA-ARTIFACT-V2 ` artifact digest
 */
export function digestEntries(entries) {
  return domainDigest(DOMAIN_ARTIFACT, orderEntries(entries));
}

/**
 * Compute the artifact digest for a complete in-memory file set, excluding
 * the reserved marker coordinate. Exported so a caller (the workflow's
 * composition root, or a conformance fixture) can pass `stage` a truthful
 * `artifactDigest` without restating the projection.
 *
 * @param {readonly Readonly<{path: string, bytes: Buffer}>[]} files the file set
 * @returns {string} the artifact digest
 */
export function computeArtifactDigest(files) {
  return digestEntries(
    files
      .filter((file) => file.path !== GENERATION_MARKER_PATH)
      .map((file) => projectEntry(file.path, file.bytes)),
  );
}
