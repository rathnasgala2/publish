/**
 * The exact DigitalOcean Spaces origin binding (brief section 6.3).
 *
 * Two distinct lower-case, dot-free buckets in one admitted region: a public
 * website `servedBucket` and a private non-website `stagingBucket`. The API
 * origin is `https://<bucket>.<region>.digitaloceanspaces.com` and the only
 * public origin is `https://<servedBucket>.<region>-static.digitaloceanspaces.com`.
 * A plain object origin, a CDN endpoint, a custom domain, or the same bucket
 * used for both roles is refused here, before any credential is used.
 *
 * @module
 */

const BUCKET_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;
const REGION_PATTERN = /^[a-z]{2,4}[0-9]$/u;

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
export function deriveOrigins(destination) {
  for (const field of /** @type {const} */ ([
    'servedBucket',
    'stagingBucket',
  ])) {
    const value = destination?.[field];
    if (typeof value !== 'string' || !BUCKET_PATTERN.test(value)) {
      throw new TypeError(
        `destination.${field} must be a lower-case, dot-free Spaces bucket name`,
      );
    }
  }
  if (
    typeof destination.region !== 'string' ||
    !REGION_PATTERN.test(destination.region)
  ) {
    throw new TypeError(
      'destination.region must be an admitted DigitalOcean Spaces region such as "nyc3"',
    );
  }
  if (destination.servedBucket === destination.stagingBucket) {
    throw new TypeError(
      'SPACES_BUCKET_BINDING_INVALID: the served website bucket and the private staging bucket must be two distinct buckets',
    );
  }

  const servedApiHost = `${destination.servedBucket}.${destination.region}.digitaloceanspaces.com`;
  const stagingApiHost = `${destination.stagingBucket}.${destination.region}.digitaloceanspaces.com`;
  return Object.freeze({
    region: destination.region,
    servedBucket: destination.servedBucket,
    stagingBucket: destination.stagingBucket,
    servedApiHost,
    stagingApiHost,
    servedApiOrigin: `https://${servedApiHost}`,
    stagingApiOrigin: `https://${stagingApiHost}`,
    publicOrigin: `https://${destination.servedBucket}.${destination.region}-static.digitaloceanspaces.com`,
  });
}

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
export function requirePublicWebsiteOrigin(origins, publicBaseUrl) {
  if (publicBaseUrl === undefined || publicBaseUrl === origins.publicOrigin) {
    return origins.publicOrigin;
  }
  throw new TypeError(
    `SPACES_PUBLIC_ORIGIN_REJECTED: ${JSON.stringify(publicBaseUrl)} is not the website origin ${origins.publicOrigin}; a CDN endpoint, custom domain or plain object origin is refused`,
  );
}
