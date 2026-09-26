/**
 * Find the bundled allowlist entry matching a runtime platform tuple
 * exactly (field-for-field, per DEC-097: "wildcard, prefix, OS-only and
 * filesystem-name-only matches reject" in the full profile; this bundle
 * only ever ships one entry per `{os,architecture}` pair, so lookup is by
 * that pair).
 *
 * @param {{os: 'linux' | 'darwin', architecture: 'x86_64' | 'aarch64'}} platform
 *   the runtime platform tuple
 * @returns {Readonly<Record<string, unknown>> | undefined} the matching
 *   entry, or `undefined` when this bundle has none for the tuple
 */
export function findAllowlistEntry(platform: {
    os: "linux" | "darwin";
    architecture: "x86_64" | "aarch64";
}): Readonly<Record<string, unknown>> | undefined;
/** The bundled allowlist catalog's own digest (section 8 self-excluding form). */
export const ALLOWLIST_CATALOG_DIGEST: string;
/** The complete bundled allowlist catalog, including its own digest. */
export const ALLOWLIST_CATALOG: Readonly<{
    catalogDigest: string;
    profile: "gala-local-filesystem-allowlist-v2";
    entries: readonly Readonly<Record<string, unknown>>[];
}>;
