/**
 * Build one validated `urn:gala:schema:build-input:2.0.0` document from a
 * repository directory (S2-T20 deliverable (1)).
 *
 * @param {{repositoryDirectory: string}} options the absolute repository directory
 * @returns {Promise<Record<string, unknown>>} the validated build-input
 *   document. `buildInput.packages.theme` (sourced from `lock.json`, the
 *   sole authority for the theme selection — no separate "theme" input
 *   exists) is the theme identity provenance building and any other
 *   theme-aware caller should reuse.
 */
export function buildBuildInputFromRepository({ repositoryDirectory }: {
    repositoryDirectory: string;
}): Promise<Record<string, unknown>>;
/**
 * Derive `repositoryId`/`repositoryOwnerId` from the GitHub Actions
 * environment when present, or a documented deterministic local stand-in
 * otherwise (never fabricated as a real GitHub identity — S2-T20
 * deliverable).
 *
 * @param {string} repositoryDirectory the absolute repository directory,
 *   used to derive a stable local stand-in
 * @param {NodeJS.ProcessEnv} env the process environment
 * @returns {{repositoryId: string, repositoryOwnerId: string}} the resolved identity
 */
export function resolveRepositoryIdentity(repositoryDirectory: string, env?: NodeJS.ProcessEnv): {
    repositoryId: string;
    repositoryOwnerId: string;
};
/** A typed intake failure: the author repository does not satisfy this package's documented convention or a referenced schema. */
export class RepositoryIntakeError extends Error {
    /**
     * @param {string} message human-readable summary
     * @param {readonly import('../types.js').PublishActionFinding[]} findings typed findings
     */
    constructor(message: string, findings?: readonly import("../types.js").PublishActionFinding[]);
    findings: readonly import("../types.js").PublishActionFinding[];
}
