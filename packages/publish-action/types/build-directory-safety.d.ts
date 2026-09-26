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
export function assertDistinctBuildDirectories({ outputDirectory, workDirectory, repositoryDirectory, }: {
    outputDirectory: string;
    workDirectory: string;
    repositoryDirectory: string;
}): void;
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
export function assertWipeableBuildDirectory(directory: string, label: "output" | "work"): Promise<void>;
/**
 * Write this package's build-directory marker at the top of `directory`,
 * so a future `runBuild` call reusing this exact path recognizes it as
 * scratch space it already owns and may safely wipe.
 *
 * @param {string} directory the absolute directory to mark
 * @returns {Promise<void>} resolves once written
 */
export function writeBuildDirectoryMarker(directory: string): Promise<void>;
/** The marker file name `runBuild` writes at the top of a build directory it owns, once a build into it has completed. */
export const BUILD_DIRECTORY_MARKER_FILENAME: ".gala-build-directory";
/** A typed refusal: `outputDirectory`/`workDirectory` is not unambiguously this package's own build scratch space. */
export class UnsafeBuildDirectoryError extends Error {
    /**
     * @param {string} message human-readable summary
     * @param {readonly import('./types.js').PublishActionFinding[]} findings typed findings
     */
    constructor(message: string, findings?: readonly import("./types.js").PublishActionFinding[]);
    findings: readonly import("./types.js").PublishActionFinding[];
}
