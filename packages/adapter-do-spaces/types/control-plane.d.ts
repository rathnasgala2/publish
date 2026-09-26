/**
 * Build the closed control-plane response catalog.
 *
 * @returns {Readonly<Record<string, unknown>>} the frozen response catalog
 */
export function buildControlPlaneResponseCatalog(): Readonly<Record<string, unknown>>;
/**
 * Build the closed four-row control-plane request catalog for one binding.
 *
 * @param {import('./origins.js').SpacesOrigins} origins the derived origins
 * @param {{bindingDigest: string, tlsProfileDigest: string}} bound the
 *   control-plane credential-binding and TLS profile digests this catalog is
 *   released against
 * @returns {Readonly<Record<string, unknown>>} the frozen request catalog
 */
export function buildControlPlaneRequestCatalog(origins: import("./origins.js").SpacesOrigins, bound: {
    bindingDigest: string;
    tlsProfileDigest: string;
}): Readonly<Record<string, unknown>>;
/**
 * Prove, before any mutation, that the limited deployment credential cannot
 * read either bucket's website configuration.
 *
 * It issues exactly the two `limited-deployment` control-plane rows —
 * `GET <apiOrigin>/?website=`, SigV4-signed with the limited caller key,
 * empty body, no redirect — and requires each to answer HTTP 403 with the
 * exact code `AccessDenied`.
 *
 * @param {{
 *   destination: import('./index.js').SpacesDestination,
 *   fetch?: typeof globalThis.fetch
 * }} input the destination carrying the limited caller key
 * @returns {Promise<Readonly<Record<string, unknown>>>} a credential-free
 *   evidence record naming both origins, both observed statuses and both
 *   observed error codes
 */
export function proveLimitedKeyAccessDenied(input: {
    destination: import("./index.js").SpacesDestination;
    fetch?: typeof globalThis.fetch;
}): Promise<Readonly<Record<string, unknown>>>;
/** The exact control-plane request-catalog profile. */
export const CONTROL_PLANE_REQUEST_PROFILE: "gala-do-spaces-control-plane-http-v2";
/** The exact control-plane response-catalog profile. */
export const CONTROL_PLANE_RESPONSE_PROFILE: "gala-do-spaces-control-plane-responses-v2";
/** The exact request target every control-plane row uses. */
export const CONTROL_PLANE_REQUEST_TARGET: "/?website=";
/** The three response profiles, in DEC-097's exact order. */
export const CONTROL_PLANE_RESPONSE_PROFILES: readonly string[];
/** The credential-format profile digest this catalog binds. */
export const CREDENTIAL_FORMAT_PROFILE_DIGEST: string;
/** The network-boundary profile digest this catalog binds. */
export const NETWORK_BOUNDARY_PROFILE_DIGEST: string;
