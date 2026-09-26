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
export function computeArtifactDigest(objects: readonly Readonly<{
    path: string;
    bytes: Buffer;
}>[]): string;
export type ArtifactEntry = Readonly<{
    path: string;
    byteLength: string;
    sha256: string;
}>;
