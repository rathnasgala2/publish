/**
 * Recursively list every regular file under `root`, returning
 * repository-relative POSIX paths (`/`-joined), sorted by UTF-8 byte order.
 * Never follows a symlink (`lstat`-checked) and skips `.git` and
 * `node_modules` directories, which are never part of an author repository's
 * content.
 *
 * @param {string} root an absolute directory
 * @returns {Promise<string[]>} sorted repository-relative paths
 */
export function listRepositoryFiles(root: string): Promise<string[]>;
/**
 * Read one file and compute its plain (not domain-separated) SHA-256 digest.
 *
 * @param {string} absolutePath an absolute file path
 * @returns {Promise<{bytes: Buffer, digest: string}>} the file's bytes and
 *   `sha256:`-prefixed hex digest
 */
export function readFileWithDigest(absolutePath: string): Promise<{
    bytes: Buffer;
    digest: string;
}>;
