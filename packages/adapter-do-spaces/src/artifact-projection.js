/**
 * The artifact-digest projection this adapter verifies against: DEC-097
 * section 8's UTF-8 path-sorted `{path, byteLength, sha256}` entry list
 * under the `GALA-ARTIFACT-V2 ` domain separator, excluding the reserved
 * public-generation-marker coordinate (the marker is staged beside the
 * frozen payload and is deliberately outside `artifactDigest`).
 *
 * @module
 */

import { computeArtifactDigest as computeArtifactDigestFromFiles } from '@rathnasgala2/adapter-protocol';

import { GENERATION_MARKER_KEY } from './constants.js';

/**
 * Digest a `{path, bytes}` collection, excluding the marker coordinate.
 *
 * PUB-M5: excluding the marker is this package's own contribution; the
 * digest formula itself delegates to `@rathnasgala2/adapter-protocol`'s
 * `computeArtifactDigest`, the single implementation every S2 destination
 * adapter verifies against.
 *
 * @param {readonly Readonly<{path: string, bytes: Buffer}>[]} objects the
 *   artifact objects, in any order
 * @returns {string} the `GALA-ARTIFACT-V2 ` artifact digest
 */
export function computeArtifactDigest(objects) {
  return computeArtifactDigestFromFiles(
    objects.filter((object) => object.path !== GENERATION_MARKER_KEY),
  );
}
