/**
 * Split one POSIX path into the ustar `prefix`/`name` pair, refusing any
 * path that cannot be represented without a GNU/PAX extension record (which
 * would make the carrier writer-dependent rather than deterministic).
 *
 * @param {string} entryPath the artifact-relative POSIX path
 * @returns {{name: string, prefix: string}} the split fields
 */
export function splitUstarPath(entryPath: string): {
    name: string;
    prefix: string;
};
/**
 * Refuse any member path that would not extract inside the carrier root.
 *
 * The carrier is extracted by the provider, not by this process, so the
 * only place an escaping member can be stopped is here, at the point it is
 * written. Only regular-file (typeflag `0`) and directory (typeflag `5`)
 * entries are ever emitted: this codec has no link or device entry, so a
 * symlink/hardlink member cannot exist to be followed.
 *
 * @param {string} entryPath the artifact-relative POSIX path
 * @returns {string} the accepted path
 */
export function requireContainedPath(entryPath: string): string;
/**
 * Encode a complete file set as deterministic uncompressed ustar
 * carrier bytes (never gzip; see the module comment).
 *
 * @param {readonly CarrierFile[]} files the complete artifact file set,
 *   including the reserved public generation marker
 * @returns {Buffer} the carrier bytes
 */
export function encodeCarrier(files: readonly CarrierFile[]): Buffer;
/**
 * Decode carrier bytes back into the exact file set they were built from.
 * The adapter itself never needs this (it only ever writes a carrier); it
 * exists so a caller — the Pages provider, a conformance fixture or a
 * codec golden test — can prove the round trip is lossless.
 *
 * @param {Buffer} carrier the carrier bytes
 * @returns {CarrierFile[]} the decoded file set, in carrier order; directory
 *   entries (typeflag `5`) are skipped
 */
export function decodeCarrier(carrier: Buffer): CarrierFile[];
export type CarrierFile = Readonly<{
    path: string;
    bytes: Buffer;
}>;
