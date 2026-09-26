/**
 * Serialize one JSON-compatible value as RFC 8785 JSON Canonicalization
 * Scheme bytes: object keys sorted by UTF-16 code unit, no insignificant
 * whitespace, and no trailing newline.
 *
 * @param {unknown} value schema-valid I-JSON value (object, array, string,
 *   finite number, boolean or null)
 * @returns {string} canonical JSON text
 */
export function canonicalizeJson(value: unknown): string;
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
export function domainDigest(domainSeparator: string, value: unknown): string;
/**
 * Compute a plain (non-domain-separated) SHA-256 digest over raw bytes.
 *
 * @param {Uint8Array | Buffer} bytes bytes to digest
 * @returns {string} `sha256:<64 lowercase hex characters>`
 */
export function sha256Hex(bytes: Uint8Array | Buffer): string;
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
export function projectArtifactEntry(entryPath: string, bytes: Uint8Array | Buffer): ArtifactEntry;
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
export function computeArtifactDigest(files: readonly Readonly<{
    path: string;
    bytes: Uint8Array | Buffer;
}>[]): string;
/**
 * Test whether a value is a syntactically valid Gala digest string.
 *
 * @param {unknown} value candidate value
 * @returns {boolean} whether it matches `sha256:<64 lowercase hex>`
 */
export function isDigestString(value: unknown): boolean;
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
export const ARTIFACT_DIGEST_DOMAIN: string;
export type ArtifactEntry = Readonly<{
    path: string;
    byteLength: string;
    sha256: string;
}>;
