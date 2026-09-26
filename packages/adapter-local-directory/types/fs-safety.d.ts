/**
 * Resolve and validate one absolute `publicationRoot`: must be absolute,
 * not `/`, contain no empty, `.`, `..` or non-NFC component, no NUL byte,
 * no trailing slash, at most 4096 bytes, and must not itself be a symlink.
 *
 * @param {string} root candidate publication root
 * @returns {Promise<string>} the validated, normalized root path
 */
export function assertValidRoot(root: string): Promise<string>;
/**
 * Walk every ancestor directory component of `relativePath` under `root`
 * that already exists on disk and reject if any is a symlink. This is the
 * on-disk symlink-escape probe `publish-kernel`'s path-containment module
 * explicitly defers to this adapter (`packages/publish-kernel/src/
 * path-containment.js`): the kernel checks declared path *syntax* only and
 * never touches a filesystem itself.
 *
 * @param {string} root the validated publication root
 * @param {string} relativePath a root-relative path (already syntax-checked
 *   by the kernel) that the caller is about to create, replace or descend
 *   into
 * @returns {Promise<void>} resolves once every existing ancestor is proven
 *   symlink-free
 */
export function assertNoEscapingSymlink(root: string, relativePath: string): Promise<void>;
/**
 * Safe bootstrap (DEC-097: "the sole pre-lock mutation"): create the
 * `releases/`, `.gala-local-v2/` control directories, validating rather
 * than replacing anything already present.
 *
 * @param {string} root the validated publication root
 * @returns {Promise<void>} resolves once bootstrap has run
 */
export function bootstrap(root: string): Promise<void>;
/**
 * `fsync` a file or directory at `targetPath`. Opening a directory
 * read-only and calling `fsync` on its descriptor is a supported POSIX
 * operation on Linux and Darwin (the two platforms this profile admits);
 * a platform where it is unsupported fails the open/fsync call itself
 * rather than silently skipping durability.
 *
 * @param {string} targetPath the file or directory to fsync
 * @returns {Promise<void>} resolves once the fsync completes
 */
export function fsyncPath(targetPath: string): Promise<void>;
/**
 * Write one file's complete bytes, creating parent directories as needed,
 * then `fsync` the file and its immediate parent directory before
 * returning (DEC-097: "Each created node and its parent directory is
 * `fsync`ed before use.").
 *
 * @param {string} absolutePath the file's absolute path
 * @param {Buffer} bytes the complete file contents
 * @returns {Promise<void>} resolves once the write is durable
 */
export function writeFileDurably(absolutePath: string, bytes: Buffer): Promise<void>;
/**
 * Atomically replace (or create) a relative symlink at `linkPath` so it
 * points at `relativeTarget`, using a temporary sibling name plus `rename`
 * (POSIX guarantees `rename` onto an existing name is atomic on the same
 * filesystem). The parent directory is `fsync`ed afterward.
 *
 * @param {string} linkPath the absolute path the symlink is published at
 * @param {string} relativeTarget the symlink's relative target text
 * @returns {Promise<void>} resolves once the swap is durable
 */
export function atomicSymlinkSwap(linkPath: string, relativeTarget: string): Promise<void>;
/**
 * Recursively remove a directory tree, refusing unless the resolved
 * absolute path is strictly contained under `root` (defence in depth
 * against ever deleting outside the declared destination root).
 *
 * @param {string} root the validated publication root
 * @param {string} absoluteTarget the absolute directory to remove
 * @returns {Promise<void>} resolves once removal completes (or the target
 *   was already absent)
 */
export function removeContainedTree(root: string, absoluteTarget: string): Promise<void>;
/**
 * Read a JSON file, returning `fallback` when it does not exist.
 *
 * @template T
 * @param {string} absolutePath the file to read
 * @param {T} fallback the value to return when the file is absent
 * @returns {Promise<T>} the parsed JSON, or `fallback`
 */
export function readJsonOr<T>(absolutePath: string, fallback: T): Promise<T>;
/**
 * Report the effective platform tuple this process is running under, used
 * by the capability-evidence record.
 *
 * @returns {{os: 'linux' | 'darwin', architecture: 'x86_64' | 'aarch64'}}
 *   the admitted platform tuple
 */
export function currentPlatformTuple(): {
    os: "linux" | "darwin";
    architecture: "x86_64" | "aarch64";
};
/**
 * A typed failure raised whenever this module refuses a mutation for
 * safety, so a caller can distinguish it from an ordinary `fs` error.
 */
export class LocalFilesystemSafetyError extends Error {
    /**
     * @param {string} code stable machine-readable reason code
     * @param {string} message human-readable detail
     */
    constructor(code: string, message: string);
    /** @type {string} */
    code: string;
}
