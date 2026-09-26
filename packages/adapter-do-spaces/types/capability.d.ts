/**
 * The three DEC-097 8443-8444 Spaces control-plane catalog digests (request
 * catalog, response catalog, TLS profile) for one destination's origins.
 *
 * **LOCAL-63(g) / review of PUBLISH-S4-7:** these are per-destination facts,
 * never a per-adapter admission constant. `buildControlPlaneRequestCatalog`
 * closes over the destination's own `origins` (the catalog's four rows
 * carry `servedApiOrigin`/`stagingApiOrigin`), so its digest is a function
 * of the destination, not of `(adapterId, adapterVersion)` alone; a caller
 * mirroring it as a row keyed by adapter version — as an earlier revision
 * of `scripts/workflow/capability-decision.mjs` did — silently pins every
 * destination to the digest of whichever origins happened to be baked into
 * the mirror. The API stores these three digests on the
 * `publication_destination` row and puts them in the capability decision;
 * this function is the same computation a caller (this package's own
 * `describeCapabilities`, or `scripts/workflow/capability-decision.mjs` via
 * `recomputeSpacesClosedRecords`) uses to recompute them from an intent's
 * destination, never to mirror an adapter-version constant.
 *
 * Credential-free by construction: it needs only the derived origins, never
 * a bound destination with access keys, so a workflow job can call it
 * before touching any control-plane credential.
 *
 * @param {import('./origins.js').SpacesOrigins} origins the derived origins
 * @returns {Readonly<{
 *   spacesControlPlaneRequestCatalogDigest: string,
 *   spacesControlPlaneResponseCatalogDigest: string,
 *   spacesControlPlaneTlsProfileDigest: string
 * }>} the three digests
 */
export function spacesControlPlaneCatalogDigests(origins: import("./origins.js").SpacesOrigins): Readonly<{
    spacesControlPlaneRequestCatalogDigest: string;
    spacesControlPlaneResponseCatalogDigest: string;
    spacesControlPlaneTlsProfileDigest: string;
}>;
/**
 * Build and validate the declaration for one bound destination.
 *
 * @param {{
 *   origins: import('./origins.js').SpacesOrigins,
 *   hasSessionToken?: boolean
 * }} context the derived origin binding, plus whether the optional
 *   `x-amz-security-token` credential is present (DEC-097 adds exactly one
 *   such credential-header row per template iff it is)
 * @returns {Readonly<Record<string, unknown>>} the validated declaration
 */
export function describeCapabilities(context: {
    origins: import("./origins.js").SpacesOrigins;
    hasSessionToken?: boolean;
}): Readonly<Record<string, unknown>>;
/** This adapter's stable identity digest. */
export const ADAPTER_DIGEST: string;
/**
 * The exact served-bucket website configuration this adapter requires:
 * an index document, the base-path-derived generated error document, no
 * redirect-all rule and no routing rules. Staging has no website
 * configuration at all.
 */
export const WEBSITE_CONFIGURATION: Readonly<{
    profile: "gala-spaces-website-configuration-v2";
    servedBucket: {
        indexDocument: string;
        errorDocument: string;
        redirectAllRequestsTo: null;
        routingRules: never[];
    };
    stagingBucket: {
        websiteConfiguration: null;
    };
}>;
