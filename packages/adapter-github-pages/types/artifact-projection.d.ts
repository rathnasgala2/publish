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
export function projectEntry(entryPath: string, bytes: Buffer): ArtifactEntry;
/**
 * Order a projected entry list by UTF-8 path.
 *
 * @param {readonly ArtifactEntry[]} entries the unordered entries
 * @returns {ArtifactEntry[]} a new, path-ordered array
 */
export function orderEntries(entries: readonly ArtifactEntry[]): ArtifactEntry[];
/**
 * Digest an already-projected, marker-excluding entry list.
 *
 * @param {readonly ArtifactEntry[]} entries the projected entries
 * @returns {string} the `GALA-ARTIFACT-V2 ` artifact digest
 */
export function digestEntries(entries: readonly ArtifactEntry[]): string;
/**
 * Compute the artifact digest for a complete in-memory file set, excluding
 * the reserved marker coordinate. Exported so a caller (the workflow's
 * composition root, or a conformance fixture) can pass `stage` a truthful
 * `artifactDigest` without restating the projection.
 *
 * PUB-M5: excluding the marker is this package's own contribution; the
 * digest formula itself delegates to `@rathnasgala2/adapter-protocol`'s
 * `computeArtifactDigest`, the single implementation every S2 destination
 * adapter verifies against.
 *
 * @param {readonly Readonly<{path: string, bytes: Buffer}>[]} files the file set
 * @returns {string} the artifact digest
 */
export function computeArtifactDigest(files: readonly Readonly<{
    path: string;
    bytes: Buffer;
}>[]): string;
export type ArtifactEntry = Readonly<{
    path: string;
    byteLength: string;
    sha256: string;
}>;
