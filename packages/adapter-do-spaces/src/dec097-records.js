/**
 * DEC-097 section 7 (lines 7370-7396)'s two closed Spaces control-plane
 * records — `spacesWebsiteConfiguration` and `spacesControlPlaneBinding` —
 * plus the section 7 (lines 7328-7335) `spacesRegionCatalog`, built and
 * digested with the pinned `@rathnasgala2/schemas` package's own exported
 * digest profiles (`ACTIVE_DIGEST_PROFILES.spacesWebsiteConfiguration`,
 * `.spacesControlPlaneBinding`, `.spacesRegionCatalog`), so this package
 * never re-authors the canonicalization or domain separator the Gala API
 * and this adapter must agree on byte-for-byte.
 *
 * **These are not `./capability.js`'s `WEBSITE_CONFIGURATION` /
 * `CONTROL_PLANE_BINDING`.** Those two records are this adapter's own
 * internal declaration profile (`gala-spaces-website-configuration-v2` /
 * `gala-spaces-control-plane-binding-v2`, domains `GALA-SPACES-*`,
 * digested into the adapter's `adapter-capability` document's
 * `limits.spacesWebsiteConfigurationDigest` / `.spacesControlPlaneBindingDigest`
 * as a fixed, destination-independent claim about what this adapter always
 * requires). The two records built here are DEC-097's own closed records
 * (`gala-do-spaces-website-configuration-v2` / `gala-do-spaces-control-plane-binding-v2`,
 * domains `GALA-DO-SPACES-*`), computed **per destination** (the
 * `errorDocumentKey` depends on `basePath`; the binding depends on the
 * bucket names, region and website origin), and are the records DEC-097
 * lines 8444-8449 says the API pre-authorizes into
 * `capabilityDecision.spacesWebsiteConfigurationDigest` /
 * `.spacesControlPlaneBindingDigest` before any control-plane evidence
 * exists. `verify-spaces-configuration.mjs` recomputes exactly these two
 * records from the authorized intent and requires equality with those two
 * pre-authorized digests before it touches the live control key.
 *
 * @module
 */

import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

/**
 * @param {'spacesWebsiteConfiguration' | 'spacesControlPlaneBinding' | 'spacesRegionCatalog'} name
 *   the exported profile name
 * @returns {{digest: (value: unknown) => string}} the schema package's own
 *   frozen digest profile
 */
function profile(name) {
  const found =
    /** @type {Record<string, {digest: (value: unknown) => string} | undefined>} */ (
      /** @type {unknown} */ (ACTIVE_DIGEST_PROFILES)
    )[name];
  if (found === undefined) {
    throw new Error(
      `the pinned @rathnasgala2/schemas package exports no ${name} digest profile`,
    );
  }
  return found;
}

/**
 * DEC-097 lines 7393-7396: `errorDocumentKey` is exactly `404.html` when
 * `basePath` is `/`; otherwise the base path with its one leading and
 * terminal slash removed, followed by `/404.html`.
 *
 * @param {string} basePath the destination's canonical base path (`/` or
 *   `/segment/.../`)
 * @returns {string} the generated error document's repository-relative path
 */
export function errorDocumentKeyFor(basePath) {
  if (basePath === '/') {
    return '404.html';
  }
  if (typeof basePath !== 'string' || !/^\/(?:[^/]+\/)+$/u.test(basePath)) {
    throw new TypeError(
      `basePath must be "/" or a canonical "/segment/.../" route, got ${JSON.stringify(basePath)}`,
    );
  }
  return `${basePath.slice(1, -1)}/404.html`;
}

/**
 * Build the DEC-097 `spacesWebsiteConfiguration` closed record and its
 * `configurationDigest` (the self-including member DEC-097 fixes: the
 * digest is over the complete record with `configurationDigest` omitted).
 *
 * @param {{basePath: string}} input the destination's base path
 * @returns {Readonly<{
 *   profile: 'gala-do-spaces-website-configuration-v2',
 *   indexDocumentSuffix: 'index.html',
 *   errorDocumentKey: string,
 *   routingRules: readonly [],
 *   configurationDigest: string
 * }>} the complete, digested record
 */
export function spacesWebsiteConfiguration(input) {
  const withoutDigest = Object.freeze({
    profile: /** @type {const} */ ('gala-do-spaces-website-configuration-v2'),
    indexDocumentSuffix: /** @type {const} */ ('index.html'),
    errorDocumentKey: errorDocumentKeyFor(input.basePath),
    routingRules: /** @type {const} */ ([]),
  });
  const configurationDigest = profile('spacesWebsiteConfiguration').digest(
    withoutDigest,
  );
  return Object.freeze({ ...withoutDigest, configurationDigest });
}

/**
 * Build the DEC-097 `spacesControlPlaneBinding` closed record and its
 * `bindingDigest`. `websiteConfigurationDigest` must be the digest of the
 * `spacesWebsiteConfiguration` record for the same destination and base
 * path — callers pass it explicitly rather than this function recomputing
 * it, so a caller who already holds the pre-authorized digest can prove
 * agreement instead of trusting a fresh recomputation to line up.
 *
 * @param {{
 *   servedBucket: string,
 *   stagingBucket: string,
 *   region: string,
 *   websiteOrigin: string,
 *   websiteConfigurationDigest: string
 * }} input the destination's bucket/region/origin binding and the website
 *   configuration digest it must equal
 * @returns {Readonly<{
 *   profile: 'gala-do-spaces-control-plane-binding-v2',
 *   servedBucket: string,
 *   stagingBucket: string,
 *   region: string,
 *   websiteOrigin: string,
 *   websiteConfigurationDigest: string,
 *   stagingWebsiteConfiguration: 'absent',
 *   deploymentCredentialWebsiteAccess: 'denied',
 *   bindingDigest: string
 * }>} the complete, digested record
 */
export function spacesControlPlaneBinding(input) {
  const withoutDigest = Object.freeze({
    profile: /** @type {const} */ ('gala-do-spaces-control-plane-binding-v2'),
    servedBucket: input.servedBucket,
    stagingBucket: input.stagingBucket,
    region: input.region,
    websiteOrigin: input.websiteOrigin,
    websiteConfigurationDigest: input.websiteConfigurationDigest,
    stagingWebsiteConfiguration: /** @type {const} */ ('absent'),
    deploymentCredentialWebsiteAccess: /** @type {const} */ ('denied'),
  });
  const bindingDigest = profile('spacesControlPlaneBinding').digest(
    withoutDigest,
  );
  return Object.freeze({ ...withoutDigest, bindingDigest });
}

/**
 * The DEC-097 lines 7328-7335 server-owned Spaces region catalog: a unique,
 * ASCII-sorted list of admitted DigitalOcean Spaces regions. This adapter
 * never mints the catalog — it is a Gala-owned compatibility release — but
 * building it here from an explicit region list lets a caller (the fake
 * Gala fixture, a conformance test) prove its own catalog digests to the
 * same profile the schema package and the API use.
 *
 * @param {{regions: readonly string[]}} input the catalog's unique,
 *   ASCII-sorted region list; the caller supplies it in the order it must
 *   digest in (DEC-097 requires ASCII-sorted, not sorted here defensively,
 *   so a misordered catalog is a visible digest mismatch rather than a
 *   silently corrected one)
 * @returns {Readonly<{
 *   profile: 'gala-do-spaces-regions-v2',
 *   regions: readonly string[],
 *   digest: string
 * }>} the complete, digested catalog
 */
export function spacesRegionCatalog(input) {
  const withoutDigest = Object.freeze({
    profile: /** @type {const} */ ('gala-do-spaces-regions-v2'),
    regions: Object.freeze([...input.regions]),
  });
  const digest = profile('spacesRegionCatalog').digest(withoutDigest);
  return Object.freeze({ ...withoutDigest, digest });
}
