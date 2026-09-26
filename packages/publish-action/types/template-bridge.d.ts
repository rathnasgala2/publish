/**
 * `template`'s documented public entry point
 * (`renderPublication`, `normalizeAuthoredMarkdown`, `computeBodyDigest`,
 * the typed error classes, `TEMPLATE_PACKAGE_NAME`/`TEMPLATE_PACKAGE_VERSION`).
 *
 * @returns {Promise<Record<string, unknown>>} the public module namespace
 */
export function importTemplatePublicEntry(): Promise<Record<string, unknown>>;
/**
 * The current published render-policy identity
 * (`{name, version, digest}`), reached through the one internal module that
 * computes it (see module documentation above for why).
 *
 * @returns {Promise<{name: string, version: string, digest: string}>}
 *   the current renderPolicyIdentity
 */
export function currentRenderPolicyIdentity(): Promise<{
    name: string;
    version: string;
    digest: string;
}>;
/**
 * The `v2/template` sibling repository's root: `<WORKSPACE_ROOT>/template`
 * when `WORKSPACE_ROOT` is set, otherwise the fixed relative default from
 * this file's own path. Resolved once at import time from `process.env`
 * (this export has no per-call env override; set `WORKSPACE_ROOT` before
 * this module is first imported).
 */
export const TEMPLATE_ROOT: string;
