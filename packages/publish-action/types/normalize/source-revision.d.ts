/**
 * @param {string} repositoryDirectory absolute repository directory
 * @returns {Promise<string>} the resolved `sourceRevision`
 */
export function resolveSourceRevision(repositoryDirectory: string): Promise<string>;
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
export function resolveBuildEpoch(repositoryDirectory: string): Promise<string>;
