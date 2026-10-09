/**
 * Resolve one interactions origin from an environment value.
 *
 * Accepts an `https:` origin, or an `http:` origin only for `localhost` or
 * `127.0.0.1` (the local stack). The value must be a bare origin: no
 * credentials, path, query or fragment.
 *
 * @param {string} name the environment variable name (for messages)
 * @param {string | undefined} value the raw environment value
 * @param {string} fallback the production default
 * @returns {string} the normalized origin
 */
export function resolveInteractionsOrigin(name: string, value: string | undefined, fallback: string): string;
/**
 * Build one validated `urn:gala:schema:build-input:2.0.0` document from a
 * repository directory (S2-T20 deliverable (1)).
 *
 * @param {{repositoryDirectory: string, includeDraftsAsUnlisted?: boolean, env?: NodeJS.ProcessEnv}} options the absolute repository directory, candidate-render policy and the environment that supplies `GALA_API_ORIGIN`/`GALA_APP_ORIGIN`
 * @returns {Promise<Record<string, unknown>>} the validated build-input
 *   document. `buildInput.packages.theme` (sourced from `lock.json`; the
 *   intake refuses with `THEME_SELECTION_MISMATCH` when `appearance.json`
 *   names a different theme package) is the theme identity provenance building and any other
 *   theme-aware caller should reuse.
 */
export function buildBuildInputFromRepository({ repositoryDirectory, includeDraftsAsUnlisted, env, }: {
    repositoryDirectory: string;
    includeDraftsAsUnlisted?: boolean;
    env?: NodeJS.ProcessEnv;
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
