/**
 * Small filesystem helpers used by this package's author-repository intake:
 * a deterministic recursive file walk (UTF-8 path sorted, so digests over
 * its output are reproducible) and a plain SHA-256 file digest. No adapter,
 * kernel or provider logic lives here.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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
export async function listRepositoryFiles(root) {
  /** @type {string[]} */
  const results = [];

  /**
   * @param {string} relativeDir directory, relative to `root`
   * @returns {Promise<void>} resolves once the subtree is walked
   */
  async function walk(relativeDir) {
    const absoluteDir = path.join(root, relativeDir);
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }
      const relativePath =
        relativeDir === '.' ? entry.name : `${relativeDir}/${entry.name}`;
      const absolutePath = path.join(root, relativePath);
      const stats = await fs.lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        continue;
      }
      if (stats.isDirectory()) {
        await walk(relativePath);
      } else if (stats.isFile()) {
        results.push(relativePath);
      }
    }
  }

  await walk('.');
  results.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return results;
}

/**
 * Read one file and compute its plain (not domain-separated) SHA-256 digest.
 *
 * @param {string} absolutePath an absolute file path
 * @returns {Promise<{bytes: Buffer, digest: string}>} the file's bytes and
 *   `sha256:`-prefixed hex digest
 */
export async function readFileWithDigest(absolutePath) {
  const bytes = await fs.readFile(absolutePath);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  return { bytes, digest };
}
