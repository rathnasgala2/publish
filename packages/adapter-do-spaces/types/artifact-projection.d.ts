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
export function computeArtifactDigest(objects: readonly Readonly<{
    path: string;
    bytes: Buffer;
}>[]): string;
