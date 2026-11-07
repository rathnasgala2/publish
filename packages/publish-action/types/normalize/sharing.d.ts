/**
 * Validate the public sharing document's shape.
 *
 * @param {unknown} doc parsed JSON
 * @returns {{networks: string[], defaults: string[], reddit?: {community: string}, x?: {via: string}} | null}
 *   the document, or `null` when the shape is wrong
 */
export function parseSharingDocument(doc: unknown): {
    networks: string[];
    defaults: string[];
    reddit?: {
        community: string;
    };
    x?: {
        via: string;
    };
} | null;
/**
 * Resolve the build input's `sharing` member.
 *
 * @param {object} options options
 * @param {string} options.apiOrigin API origin (the interactions module's, or the default)
 * @param {readonly string[] | undefined} options.siteTargets `publication.sharing.targets`, when the site has the member
 * @param {import('../types.js').PublishActionFinding[]} options.warnings receives the non-blocking finding
 * @param {typeof fetch} [options.fetchImpl] injected fetch
 * @param {number} [options.timeoutMs] per-attempt timeout
 * @returns {Promise<{targets: string[], reddit?: {community: string}, x?: {via: string}}>} the resolved member
 */
export function resolveSharing({ apiOrigin, siteTargets, warnings, fetchImpl, timeoutMs, }: {
    apiOrigin: string;
    siteTargets: readonly string[] | undefined;
    warnings: import("../types.js").PublishActionFinding[];
    fetchImpl?: typeof fetch | undefined;
    timeoutMs?: number | undefined;
}): Promise<{
    targets: string[];
    reddit?: {
        community: string;
    };
    x?: {
        via: string;
    };
}>;
/**
 * Resolve the build input's `sharing` member (One sharing list round).
 *
 * The platform publishes its sharing catalogue at
 * `GET <apiOrigin>/v2/public/sharing` (no auth). The site's own
 * `publication.sharing.targets` is intersected with the catalogue's
 * `networks` (order kept); a site without the member gets `defaults`. When
 * the document cannot be fetched or is malformed, the site's own targets are
 * kept as authored (else `['copy-link']`) and a `SHARING_DEFAULTS_UNAVAILABLE`
 * warning is raised, so a platform outage never blocks a publish.
 *
 * @module
 */
/** Every share target the toolchain knows, in display order. */
export const SHARING_NETWORKS: readonly string[];
export const SHARING_TIMEOUT_MS: 5000;
