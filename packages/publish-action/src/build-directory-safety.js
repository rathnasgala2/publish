/**
 * Fail-closed safety guard for `runBuild`'s own clean-directory precondition
 * (see `commands/build.js`'s module doc): before removing and recreating
 * `outputDirectory`/`workDirectory`, refuse to touch either path when it is
 * not unambiguously this package's own build scratch space.
 *
 * `outputDirectory`/`workDirectory` are caller-controlled (`npx` `--output`/
 * `--work`, the Action's `output-directory`/`work-directory` inputs, or
 * their `<repositoryDirectory>/.gala/{output,work}` defaults), so a
 * mistaken or malicious value -- `--output .`, `--output ..`, an omitted
 * flag resolving to the process's own working directory, and so on -- must
 * never reach `rm(..., {recursive: true})`. Two independent guards apply:
 *
 * 1. A directory is refused outright when it equals or contains (is an
 *    ancestor of) the author repository, the process's current working
 *    directory, the user's home directory or the filesystem root -- no
 *    marker file can ever make one of those paths safe to wipe.
 * 2. Otherwise, a directory that already exists and is non-empty is only
 *    safe to wipe when it carries the `.gala-build-directory` marker this
 *    module itself writes at the end of a successful `runBuild` call (so a
 *    repeat build into the same path is fine) -- an absent or already-empty
 *    directory needs no marker. `outputDirectory` and `workDirectory` must
 *    also be distinct and unnested from each other.
 *
 * @module
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** The marker file name `runBuild` writes at the top of a build directory it owns, once a build into it has completed. */
export const BUILD_DIRECTORY_MARKER_FILENAME = '.gala-build-directory';

/** This marker file's fixed content -- presence, not content, is what matters; kept small and stable so it never affects an unrelated digest. */
const MARKER_CONTENT = `${JSON.stringify(
  {
    purpose:
      "Marks this directory as scratch space owned by @rathnasgala2/publish-action's runBuild; safe for a future runBuild call into the same path to remove and recreate.",
    package: '@rathnasgala2/publish-action',
  },
  null,
  2,
)}\n`;

/** A typed refusal: `outputDirectory`/`workDirectory` is not unambiguously this package's own build scratch space. */
export class UnsafeBuildDirectoryError extends Error {
  /**
   * @param {string} message human-readable summary
   * @param {readonly import('./index.d.ts').PublishActionFinding[]} findings typed findings
   */
  constructor(message, findings = []) {
    super(message);
    this.name = 'UnsafeBuildDirectoryError';
    this.findings = Object.freeze([...findings]);
  }
}

/**
 * @param {string} code stable finding code
 * @param {string} detail human-readable detail
 * @returns {import('./index.d.ts').PublishActionFinding} one typed `SOURCE_ERROR` finding
 */
function unsafeDirectoryFinding(code, detail) {
  return {
    code,
    severity: 'SOURCE_ERROR',
    detail,
    recovery:
      "Point --output/--work (or the Action's output-directory/work-directory inputs) at a dedicated, empty scratch directory outside the repository, the current working directory, the home directory and the filesystem root.",
    overridable: false,
  };
}

/**
 * @param {string} ancestor a candidate ancestor path
 * @param {string} descendant a candidate descendant path
 * @returns {boolean} whether `descendant` is `ancestor` itself, or nested
 *   anywhere under it
 */
function isAncestorOrSame(ancestor, descendant) {
  const resolvedAncestor = path.resolve(ancestor);
  const resolvedDescendant = path.resolve(descendant);
  if (resolvedAncestor === resolvedDescendant) {
    return true;
  }
  const prefix = resolvedAncestor.endsWith(path.sep)
    ? resolvedAncestor
    : `${resolvedAncestor}${path.sep}`;
  return resolvedDescendant.startsWith(prefix);
}

/**
 * Assert that `outputDirectory` and `workDirectory` are safe for `runBuild`
 * to remove and recreate: neither reaches outside its own scratch role, and
 * neither collides with the other. Throws {@link UnsafeBuildDirectoryError}
 * (never removes anything) on any violation.
 *
 * @param {{
 *   outputDirectory: string,
 *   workDirectory: string,
 *   repositoryDirectory: string
 * }} input the three resolved absolute directories
 * @returns {void}
 */
export function assertDistinctBuildDirectories({
  outputDirectory,
  workDirectory,
  repositoryDirectory,
}) {
  const guardedTargets = /** @type {const} */ ([
    ['repository directory', repositoryDirectory],
    ['current working directory', process.cwd()],
    ['home directory', homedir()],
    ['filesystem root', path.parse(path.resolve(outputDirectory)).root],
  ]);

  for (const [label, directory] of [
    /** @type {const} */ (['output', outputDirectory]),
    /** @type {const} */ (['work', workDirectory]),
  ]) {
    for (const [targetLabel, target] of guardedTargets) {
      if (isAncestorOrSame(directory, target)) {
        throw new UnsafeBuildDirectoryError(
          `${label}Directory (${directory}) equals or contains the ${targetLabel} (${target}); refusing to remove it`,
          [
            unsafeDirectoryFinding(
              'UNSAFE_BUILD_DIRECTORY',
              `${label}Directory ${JSON.stringify(directory)} equals or is an ancestor of the ${targetLabel} ${JSON.stringify(target)}`,
            ),
          ],
        );
      }
    }
  }

  if (
    isAncestorOrSame(outputDirectory, workDirectory) ||
    isAncestorOrSame(workDirectory, outputDirectory)
  ) {
    throw new UnsafeBuildDirectoryError(
      `outputDirectory (${outputDirectory}) and workDirectory (${workDirectory}) must not be the same path or nested in each other`,
      [
        unsafeDirectoryFinding(
          'UNSAFE_BUILD_DIRECTORY',
          `outputDirectory ${JSON.stringify(outputDirectory)} and workDirectory ${JSON.stringify(workDirectory)} must not be the same path or nested in each other`,
        ),
      ],
    );
  }
}

/**
 * Assert that one directory is safe to `rm(..., {recursive: true})`: absent,
 * already empty, or carrying this package's own `.gala-build-directory`
 * marker from a prior `runBuild` call. Throws
 * {@link UnsafeBuildDirectoryError} (never removes anything) otherwise.
 *
 * @param {string} directory the absolute directory to check
 * @param {'output' | 'work'} label which of the two directories this is, for the finding's detail
 * @returns {Promise<void>} resolves once verified safe to wipe
 */
export async function assertWipeableBuildDirectory(directory, label) {
  /** @type {string[]} */
  let entries;
  try {
    entries = await fs.readdir(directory);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (entries.length === 0) {
    return;
  }
  if (entries.includes(BUILD_DIRECTORY_MARKER_FILENAME)) {
    return;
  }
  throw new UnsafeBuildDirectoryError(
    `${label}Directory (${directory}) already exists, is non-empty, and does not carry a ${BUILD_DIRECTORY_MARKER_FILENAME} marker from a prior runBuild call; refusing to remove it`,
    [
      unsafeDirectoryFinding(
        'UNSAFE_BUILD_DIRECTORY',
        `${label}Directory ${JSON.stringify(directory)} already exists and is non-empty, with no ${BUILD_DIRECTORY_MARKER_FILENAME} marker from a prior runBuild call`,
      ),
    ],
  );
}

/**
 * Write this package's build-directory marker at the top of `directory`,
 * so a future `runBuild` call reusing this exact path recognizes it as
 * scratch space it already owns and may safely wipe.
 *
 * @param {string} directory the absolute directory to mark
 * @returns {Promise<void>} resolves once written
 */
export async function writeBuildDirectoryMarker(directory) {
  await fs.writeFile(
    path.join(directory, BUILD_DIRECTORY_MARKER_FILENAME),
    MARKER_CONTENT,
  );
}
