/**
 * The artifact-digest projection this adapter verifies against: DEC-097
 * section 8's UTF-8 path-sorted `{path, byteLength, sha256}` entry list
 * under the `GALA-ARTIFACT-V2 ` domain separator, excluding the reserved
 * public-generation-marker coordinate (the marker is staged beside the
 * frozen payload and is deliberately outside `artifactDigest`).
 *
 * @module
 */

import { domainDigest, sha256Hex } from '@rathnasgala2/adapter-protocol';

import { DOMAIN_ARTIFACT, GENERATION_MARKER_KEY } from './constants.js';

/**
 * @typedef {Readonly<{path: string, byteLength: string, sha256: string}>} ArtifactEntry
 */

/**
 * Digest a `{path, bytes}` collection, excluding the marker coordinate.
 *
 * @param {readonly Readonly<{path: string, bytes: Buffer}>[]} objects the
 *   artifact objects, in any order
 * @returns {string} the `GALA-ARTIFACT-V2 ` artifact digest
 */
export function computeArtifactDigest(objects) {
  /** @type {ArtifactEntry[]} */
  const entries = [];
  for (const object of objects) {
    if (object.path === GENERATION_MARKER_KEY) {
      continue;
    }
    entries.push(
      Object.freeze({
        path: object.path,
        byteLength: String(object.bytes.byteLength),
        sha256: sha256Hex(object.bytes),
      }),
    );
  }
  entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return domainDigest(DOMAIN_ARTIFACT, entries);
}
