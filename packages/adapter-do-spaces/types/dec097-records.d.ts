/**
 * DEC-097 lines 7393-7396: `errorDocumentKey` is exactly `404.html` when
 * `basePath` is `/`; otherwise the base path with its one leading and
 * terminal slash removed, followed by `/404.html`.
 *
 * @param {string} basePath the destination's canonical base path (`/` or
 *   `/segment/.../`)
 * @returns {string} the generated error document's repository-relative path
 */
export function errorDocumentKeyFor(basePath: string): string;
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
export function spacesWebsiteConfiguration(input: {
    basePath: string;
}): Readonly<{
    profile: "gala-do-spaces-website-configuration-v2";
    indexDocumentSuffix: "index.html";
    errorDocumentKey: string;
    routingRules: readonly [];
    configurationDigest: string;
}>;
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
export function spacesControlPlaneBinding(input: {
    servedBucket: string;
    stagingBucket: string;
    region: string;
    websiteOrigin: string;
    websiteConfigurationDigest: string;
}): Readonly<{
    profile: "gala-do-spaces-control-plane-binding-v2";
    servedBucket: string;
    stagingBucket: string;
    region: string;
    websiteOrigin: string;
    websiteConfigurationDigest: string;
    stagingWebsiteConfiguration: "absent";
    deploymentCredentialWebsiteAccess: "denied";
    bindingDigest: string;
}>;
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
export function spacesRegionCatalog(input: {
    regions: readonly string[];
}): Readonly<{
    profile: "gala-do-spaces-regions-v2";
    regions: readonly string[];
    digest: string;
}>;
