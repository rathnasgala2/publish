/**
 * Build the frozen 24-row catalog for one origin binding.
 *
 * @param {import('./origins.js').SpacesOrigins} origins the derived origins
 * @param {{hasSessionToken?: boolean}} [options] whether the optional
 *   `x-amz-security-token` credential is present; DEC-097 adds exactly one
 *   such header row per template iff it is, and never otherwise
 * @returns {readonly RequestTemplate[]} the catalog, sorted by member JCS bytes
 */
export function buildRequestTemplates(origins: import("./origins.js").SpacesOrigins, options?: {
    hasSessionToken?: boolean;
}): readonly RequestTemplate[];
/**
 * Resolve the one catalog row for a `(stage, callClass)` pair.
 *
 * This is the only way `src/s3.js` obtains a request shape, so a call the
 * catalog does not declare cannot be issued at all: it fails here, before any
 * DNS lookup, signature or credential use.
 *
 * @param {readonly RequestTemplate[]} templates the catalog
 * @param {string} stage the issuing stage
 * @param {string} callClass the call class
 * @returns {RequestTemplate} the one matching row
 */
export function requireTemplate(templates: readonly RequestTemplate[], stage: string, callClass: string): RequestTemplate;
/** The exact request-template profile this adapter declares. */
export const REQUEST_TEMPLATE_PROFILE: "gala-do-spaces-sigv4-v2";
/** The exact closed response-profile catalog this adapter can parse. */
export const RESPONSE_PROFILES: readonly string[];
/**
 * DEC-097's "object metadata set": exactly these three derived rows, carried
 * by every full-object write (single `PUT` and multipart *create*), and by
 * nothing else. A part carries only its own slice digest, and a completion
 * cannot replace the create metadata.
 */
export const OBJECT_METADATA_HEADERS: readonly (Readonly<{
    name: "content-type";
    source: "deployment-object-media-type";
}> | Readonly<{
    name: "cache-control";
    source: "deployment-object-cache-control";
}> | Readonly<{
    name: "x-amz-meta-gala-sha256";
    source: "deployment-object-untagged-sha256";
}>)[];
export type RequestTemplate = Readonly<Record<string, unknown>>;
