/**
 * Resolve, verify and return the absolute theme package directory for the
 * lock-pinned theme identity (S2-T20b deliverable). Tries, in order: (1) an
 * installed `node_modules/<theme package>` under `repositoryDirectory`, (2)
 * a `GALA_THEME_DIR` override, (3) the LOCAL-only sibling checkout
 * `/Users/anand/ws/galascribe/v2/theme-<name>`. The first candidate
 * directory that exists on disk is verified and returned; a candidate that
 * exists but fails verification fails the whole resolution closed (it does
 * not fall through to the next step — an existing-but-wrong theme package is
 * a finding, not a reason to keep searching).
 *
 * @param {{
 *   repositoryDirectory: string,
 *   theme: {package: string, version: string, integrity: string, registry: string},
 *   env?: NodeJS.ProcessEnv,
 * }} options the author repository directory, the lock-pinned theme
 *   identity (`buildInput.packages.theme`), and the process environment
 *   (injectable for tests)
 * @returns {Promise<string>} the absolute, verified theme package directory
 */
export function resolveThemeDirectory({ repositoryDirectory, theme, env, }: {
    repositoryDirectory: string;
    theme: {
        package: string;
        version: string;
        integrity: string;
        registry: string;
    };
    env?: NodeJS.ProcessEnv;
}): Promise<string>;
/**
 * A typed theme-resolution failure: no candidate directory could be found
 * for the lock-pinned theme package, or the one found does not verify
 * against the lock pin / `theme-contract:2.0.0`.
 */
export class ThemeResolutionError extends Error {
    /**
     * @param {string} message human-readable summary
     * @param {readonly import('./types.js').PublishActionFinding[]} findings typed findings
     */
    constructor(message: string, findings?: readonly import("./types.js").PublishActionFinding[]);
    findings: readonly import("./types.js").PublishActionFinding[];
}
