/**
 * POSIX filesystem safety primitives for `gala-local-directory-filesystem-v2`.
 *
 * DEC-097's executable local-directory profile specifies directory-fd-
 * relative syscalls (`openat`/`fstatat`/`readlinkat`/`symlinkat`/`renameat`/
 * `linkat`/`unlinkat`) that Node.js's `node:fs` module does not expose
 * without a native addon. This module implements the equivalent guarantees
 * with the path-based primitives Node does expose: an explicit
 * `lstat`-per-component ancestor walk that rejects a symlink anywhere under
 * the destination root before any mutation, an `fsync`-after-write
 * discipline on both files and directories, and an atomic `rename`-based
 * pointer swap. This is a deliberate, documented reduction from the DEC-097
 * oracle's TOCTOU-proof descriptor retention (see the package README's
 * "Conformance to the DEC-097 oracle" section); it still refuses to
 * traverse or replace a symlink it discovers, and it never mutates a path
 * outside the caller-supplied root.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { promises as fs, constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A typed failure raised whenever this module refuses a mutation for
 * safety, so a caller can distinguish it from an ordinary `fs` error.
 */
export class LocalFilesystemSafetyError extends Error {
  /**
   * @param {string} code stable machine-readable reason code
   * @param {string} message human-readable detail
   */
  constructor(code, message) {
    super(message);
    this.name = 'LocalFilesystemSafetyError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * Resolve and validate one absolute `publicationRoot`: must be absolute,
 * not `/`, contain no empty, `.`, `..` or non-NFC component, no NUL byte,
 * no trailing slash, at most 4096 bytes, and must not itself be a symlink.
 *
 * @param {string} root candidate publication root
 * @returns {Promise<string>} the validated, normalized root path
 */
export async function assertValidRoot(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new LocalFilesystemSafetyError(
      'ROOT_INVALID',
      'publicationRoot must be a non-empty string',
    );
  }
  if (!path.isAbsolute(root) || root === '/') {
    throw new LocalFilesystemSafetyError(
      'ROOT_INVALID',
      'publicationRoot must be an absolute path other than "/"',
    );
  }
  if (
    root.includes('\0') ||
    root.endsWith('/') ||
    root !== root.normalize('NFC')
  ) {
    throw new LocalFilesystemSafetyError(
      'ROOT_INVALID',
      'publicationRoot must be NUL-free, non-trailing-slash and NFC-normalized',
    );
  }
  if (Buffer.byteLength(root, 'utf8') > 4096) {
    throw new LocalFilesystemSafetyError(
      'ROOT_INVALID',
      'publicationRoot must be at most 4096 UTF-8 bytes',
    );
  }
  for (const segment of root.split('/').filter((entry) => entry.length > 0)) {
    if (segment === '.' || segment === '..') {
      throw new LocalFilesystemSafetyError(
        'ROOT_INVALID',
        'publicationRoot must contain no "." or ".." component',
      );
    }
  }
  const stats = await fs.lstat(root).catch(() => null);
  if (stats === null) {
    throw new LocalFilesystemSafetyError(
      'ROOT_MISSING',
      `publicationRoot ${JSON.stringify(root)} does not exist`,
    );
  }
  if (!stats.isDirectory()) {
    throw new LocalFilesystemSafetyError(
      'ROOT_NOT_DIRECTORY',
      `publicationRoot ${JSON.stringify(root)} is not a directory (or is a symlink to one)`,
    );
  }
  return root;
}

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
export async function assertNoEscapingSymlink(root, relativePath) {
  const segments = relativePath.split('/').filter((entry) => entry.length > 0);
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    if (!cursor.startsWith(`${root}${path.sep}`) && cursor !== root) {
      throw new LocalFilesystemSafetyError(
        'PATH_ESCAPES_ROOT',
        `Resolved path ${JSON.stringify(cursor)} escapes publicationRoot ${JSON.stringify(root)}`,
      );
    }

    const stats = await fs.lstat(cursor).catch(() => null);
    if (stats === null) {
      // Component does not exist yet: nothing further down this branch can
      // exist either (a caller creates directories top-down), so the walk
      // is complete.
      return;
    }
    if (stats.isSymbolicLink()) {
      throw new LocalFilesystemSafetyError(
        'SYMLINK_ESCAPE_DETECTED',
        `Refusing to traverse or replace symlink at ${JSON.stringify(cursor)}`,
      );
    }
  }
}

/**
 * Create an absent root-owned control node, or validate an existing one's
 * type/mode, but never replace it (DEC-097: "`EEXIST` causes descriptor/
 * type/owner/mode/device validation, never replacement.").
 *
 * @param {string} absolutePath the node's absolute path
 * @param {{kind: 'directory' | 'file', mode: number}} expected the expected
 *   node type and POSIX mode
 * @returns {Promise<void>} resolves once the node is safely present
 */
async function ensureSafeNode(absolutePath, expected) {
  const existing = await fs.lstat(absolutePath).catch(() => null);
  if (existing === null) {
    if (expected.kind === 'directory') {
      await fs.mkdir(absolutePath, { mode: expected.mode });
    } else {
      const handle = await fs.open(absolutePath, 'wx', expected.mode);
      await handle.close();
    }
  } else {
    const isRightKind =
      expected.kind === 'directory'
        ? existing.isDirectory()
        : existing.isFile();
    if (!isRightKind) {
      throw new LocalFilesystemSafetyError(
        'CONTROL_NODE_UNSAFE',
        `Existing node at ${JSON.stringify(absolutePath)} is not a ${expected.kind}`,
      );
    }
    if ((existing.mode & 0o022) !== 0) {
      throw new LocalFilesystemSafetyError(
        'CONTROL_NODE_UNSAFE',
        `Existing node at ${JSON.stringify(absolutePath)} is group- or other-writable`,
      );
    }
  }
  await fsyncPath(absolutePath).catch(() => undefined);
}

/**
 * Safe bootstrap (DEC-097: "the sole pre-lock mutation"): create the
 * `releases/`, `.gala-local-v2/` control directories, validating rather
 * than replacing anything already present.
 *
 * @param {string} root the validated publication root
 * @returns {Promise<void>} resolves once bootstrap has run
 */
export async function bootstrap(root) {
  await ensureSafeNode(path.join(root, 'releases'), {
    kind: 'directory',
    mode: 0o755,
  });
  await ensureSafeNode(path.join(root, '.gala-local-v2'), {
    kind: 'directory',
    mode: 0o700,
  });
  await fsyncPath(root).catch(() => undefined);
}

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
export async function fsyncPath(targetPath) {
  const handle = await fs.open(targetPath, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

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
export async function writeFileDurably(absolutePath, bytes) {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const handle = await fs.open(absolutePath, 'w', 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsyncPath(path.dirname(absolutePath));
}

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
export async function atomicSymlinkSwap(linkPath, relativeTarget) {
  const parent = path.dirname(linkPath);
  const tempName = path.join(
    parent,
    `.gala-current-${createHash('sha256').update(`${process.pid}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)}`,
  );
  await fs.symlink(relativeTarget, tempName);
  await fs.rename(tempName, linkPath);
  await fsyncPath(parent);
}

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
export async function removeContainedTree(root, absoluteTarget) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(absoluteTarget);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new LocalFilesystemSafetyError(
      'DELETE_OUTSIDE_ROOT_REFUSED',
      `Refusing to delete ${JSON.stringify(absoluteTarget)}: outside declared destination root ${JSON.stringify(root)}`,
    );
  }
  if (resolvedTarget === resolvedRoot) {
    throw new LocalFilesystemSafetyError(
      'DELETE_OUTSIDE_ROOT_REFUSED',
      'Refusing to delete the publication root itself',
    );
  }
  await fs.rm(resolvedTarget, { recursive: true, force: true });
  await fsyncPath(path.dirname(resolvedTarget)).catch(() => undefined);
}

/**
 * Read a JSON file, returning `fallback` when it does not exist.
 *
 * @template T
 * @param {string} absolutePath the file to read
 * @param {T} fallback the value to return when the file is absent
 * @returns {Promise<T>} the parsed JSON, or `fallback`
 */
export async function readJsonOr(absolutePath, fallback) {
  try {
    const text = await fs.readFile(absolutePath, 'utf8');
    return /** @type {T} */ (JSON.parse(text));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

/**
 * Report the effective platform tuple this process is running under, used
 * by the capability-evidence record.
 *
 * @returns {{os: 'linux' | 'darwin', architecture: 'x86_64' | 'aarch64'}}
 *   the admitted platform tuple
 */
export function currentPlatformTuple() {
  const platform = os.platform();
  const arch = os.arch();
  if (platform !== 'linux' && platform !== 'darwin') {
    throw new LocalFilesystemSafetyError(
      'ATOMIC_ACTIVATION_UNSUPPORTED',
      `Platform ${JSON.stringify(platform)} is not an admitted gala-local-directory-filesystem-v2 platform`,
    );
  }
  const architecture =
    arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : arch;
  if (architecture !== 'x86_64' && architecture !== 'aarch64') {
    throw new LocalFilesystemSafetyError(
      'ATOMIC_ACTIVATION_UNSUPPORTED',
      `Architecture ${JSON.stringify(arch)} is not an admitted gala-local-directory-filesystem-v2 architecture`,
    );
  }
  return { os: platform, architecture };
}
