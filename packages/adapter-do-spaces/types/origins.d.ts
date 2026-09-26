/**
 * @typedef {Readonly<{
 *   region: string,
 *   servedBucket: string,
 *   stagingBucket: string,
 *   servedApiHost: string,
 *   stagingApiHost: string,
 *   servedApiOrigin: string,
 *   stagingApiOrigin: string,
 *   publicOrigin: string
 * }>} SpacesOrigins
 */
/**
 * Validate a destination's bucket/region binding and derive every origin.
 *
 * @param {{region: string, servedBucket: string, stagingBucket: string}} destination
 *   the destination binding
 * @returns {SpacesOrigins} the derived, frozen origin set
 */
export function deriveOrigins(destination: {
    region: string;
    servedBucket: string;
    stagingBucket: string;
}): SpacesOrigins;
/**
 * Refuse any caller-supplied public base URL that is not the exact website
 * origin: a CDN endpoint, a custom domain and a plain object origin all
 * serve different bytes under different caching rules, so accepting one
 * would make every public verification claim untrue.
 *
 * @param {SpacesOrigins} origins the derived origins
 * @param {string | undefined} publicBaseUrl the caller-supplied public base URL
 * @returns {string} the admitted public origin
 */
export function requirePublicWebsiteOrigin(origins: SpacesOrigins, publicBaseUrl: string | undefined): string;
export type SpacesOrigins = Readonly<{
    region: string;
    servedBucket: string;
    stagingBucket: string;
    servedApiHost: string;
    stagingApiHost: string;
    servedApiOrigin: string;
    stagingApiOrigin: string;
    publicOrigin: string;
}>;
