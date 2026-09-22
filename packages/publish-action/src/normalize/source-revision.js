/**
 * Resolve a repository directory's `sourceRevision`
 * (`gitObjectId`: `sha1:<40 hex>` or `sha256:<64 hex>`): the real `git`
 * `HEAD` object id when the repository directory is a real git working
 * tree, or a documented deterministic local stand-in — a plain SHA-256 over
 * the repository's own sorted file tree — when it is not (a fixture
 * directory with no `.git`, for example). Never fabricated as a real git
 * revision. Also resolves `buildEpoch` (DEC-097 section 5), the sibling
 * value recovered from the same selected commit.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { listRepositoryFiles, readFileWithDigest } from '../fs-util.js';
import { LOCAL_SOURCE_REVISION_DOMAIN } from '../constants.js';
import { LOCAL_BUILD_EPOCH_STANDIN } from './local-standins.js';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * @param {string} repositoryDirectory absolute repository directory
 * @returns {Promise<string>} the resolved `sourceRevision`
 */
export async function resolveSourceRevision(repositoryDirectory) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repositoryDirectory, 'rev-parse', 'HEAD'],
      {
        timeout: 5000,
      },
    );
    const objectId = stdout.trim();
    if (/^[0-9a-f]{40}$/u.test(objectId)) {
      return `sha1:${objectId}`;
    }
  } catch {
    // Not a git working tree (or git unavailable): fall through to the
    // documented local stand-in below.
  }

  const files = await listRepositoryFiles(repositoryDirectory);
  const hash = createHash('sha256');
  hash.update(LOCAL_SOURCE_REVISION_DOMAIN, 'utf8');
  for (const relativePath of files) {
    const { digest } = await readFileWithDigest(
      path.join(repositoryDirectory, relativePath),
    );
    hash.update(`${relativePath}\0${digest}\0`, 'utf8');
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Resolve a repository directory's `buildEpoch` (DEC-097 section 5): "the
 * selected `sourceRevision` Git commit object's committer timestamp: parse
 * its signed whole-second Unix epoch plus numeric offset, identify the
 * instant, and emit that instant in UTC as `YYYY-MM-DDTHH:mm:ss.000Z`" when
 * the repository directory is a real git working tree, or the documented
 * deterministic local stand-in (`LOCAL_BUILD_EPOCH_STANDIN`) when it is
 * not. Never the wall clock at build time (that would make `buildEpoch`,
 * and every byte derived from it — the search index and feed documents —
 * differ between two builds of the exact same commit, which is exactly the
 * non-determinism DEC-097 rules out).
 *
 * `%ct` is git's own committer-date-as-Unix-epoch-seconds format
 * placeholder: already UTC-normalized (timezone-independent), so it needs
 * no separate offset parsing to identify the instant.
 *
 * @param {string} repositoryDirectory absolute repository directory
 * @returns {Promise<string>} the resolved `buildEpoch`
 */
export async function resolveBuildEpoch(repositoryDirectory) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repositoryDirectory, 'show', '-s', '--format=%ct', 'HEAD'],
      {
        timeout: 5000,
      },
    );
    const epochSeconds = stdout.trim();
    if (/^\d+$/u.test(epochSeconds)) {
      return new Date(Number(epochSeconds) * 1000).toISOString();
    }
  } catch {
    // Not a git working tree (or git unavailable): fall through to the
    // documented local stand-in below.
  }

  return LOCAL_BUILD_EPOCH_STANDIN;
}
