/**
 * `describeCapabilities`: this adapter's exact `adapter-capability:2.0.0`
 * declaration for the DEC-097 section 7 `do-spaces` row.
 *
 * Every claim is the weakest one that is actually true.
 * `activation: replace-in-place` (never `pointer-swap`): activation writes
 * the new inventory over the served root and writes the marker last, so a
 * mixed-generation window genuinely exists and is represented truthfully.
 * `concurrency: best-effort`: the marker is read before mutation and written
 * with a conditional guard where the provider supports one, which is better
 * than nothing and less than a fence. `providerInventoryAssurance: none` and
 * `cacheInvalidation: none`: Spaces reports no deployed digest inventory and
 * this adapter has no purge authority.
 *
 * @module
 */

import {
  ROLLBACK,
  assertValidCapabilityDeclaration,
  domainDigest,
  getCapabilityRow,
} from '@rathnasgala2/adapter-protocol';

import {
  ADAPTER_VERSION,
  DOMAIN_ADAPTER_CAPABILITY,
  DOMAIN_ADAPTER_IDENTITY,
  DOMAIN_SPACES_COMPATIBILITY,
  DOMAIN_SPACES_CONTROL_BINDING,
  DOMAIN_SPACES_CONTROL_TLS,
  DOMAIN_SPACES_CREDENTIAL_EGRESS,
  DOMAIN_SPACES_REQUEST_CATALOG,
  DOMAIN_SPACES_RESPONSE_CATALOG,
  DOMAIN_SPACES_TLS_PROFILE,
  DOMAIN_SPACES_WEBSITE_CONFIGURATION,
  MAXIMUM_SINGLE_PART_BYTES,
  STAGE_PREFIX,
  WEBSITE_ERROR_DOCUMENT,
  WEBSITE_INDEX_DOCUMENT,
} from './constants.js';
import {
  buildControlPlaneRequestCatalog,
  buildControlPlaneResponseCatalog,
} from './control-plane.js';
import {
  REQUEST_TEMPLATE_PROFILE,
  RESPONSE_PROFILES,
  buildRequestTemplates,
} from './request-catalog.js';

const ROW_OR_UNDEFINED = getCapabilityRow('do-spaces');
if (ROW_OR_UNDEFINED === undefined) {
  throw new Error(
    'adapter-protocol does not declare a do-spaces capability row',
  );
}
/** The exact DEC-097 admission row for `do-spaces`, never `undefined`. */
const ROW = /** @type {NonNullable<ReturnType<typeof getCapabilityRow>>} */ (
  ROW_OR_UNDEFINED
);

/** This adapter's stable identity digest. */
export const ADAPTER_DIGEST = domainDigest(DOMAIN_ADAPTER_IDENTITY, {
  name: '@rathnasgala2/adapter-do-spaces',
  version: ADAPTER_VERSION,
});

/**
 * The exact served-bucket website configuration this adapter requires:
 * an index document, the base-path-derived generated error document, no
 * redirect-all rule and no routing rules. Staging has no website
 * configuration at all.
 */
export const WEBSITE_CONFIGURATION = Object.freeze({
  profile: 'gala-spaces-website-configuration-v2',
  servedBucket: {
    indexDocument: WEBSITE_INDEX_DOCUMENT,
    errorDocument: WEBSITE_ERROR_DOCUMENT,
    redirectAllRequestsTo: null,
    routingRules: [],
  },
  stagingBucket: { websiteConfiguration: null },
});

/**
 * The control-plane binding. This package never uses the protected
 * full-access control key; the record states which key family owns which
 * responsibility so the declaration can be diffed against the workflow.
 */
const CONTROL_PLANE_BINDING = Object.freeze({
  profile: 'gala-spaces-control-plane-binding-v2',
  configurationReaderCredential: 'DO_SPACES_CONTROL_ACCESS_KEY_ID',
  dataPlaneCredential: 'CALLER_DO_SPACES_ACCESS_KEY_ID',
  credentialFamiliesShareAJob: false,
  dataPlaneKeyMayReadConfiguration: false,
  dataPlaneKeyMayMutateConfiguration: false,
  dataPlaneKeyMayCreateOrDeleteABucket: false,
});

const TLS_PROFILE = Object.freeze({
  profile: 'gala-spaces-tls-v2',
  minimumVersion: 'TLSv1.2',
  requireCertificateVerification: true,
  followRedirects: false,
});

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
export function spacesControlPlaneCatalogDigests(origins) {
  const controlPlaneBindingDigest = domainDigest(
    DOMAIN_SPACES_CONTROL_BINDING,
    CONTROL_PLANE_BINDING,
  );
  const controlPlaneTlsProfileDigest = domainDigest(
    DOMAIN_SPACES_CONTROL_TLS,
    TLS_PROFILE,
  );
  const requestCatalog = buildControlPlaneRequestCatalog(origins, {
    bindingDigest: controlPlaneBindingDigest,
    tlsProfileDigest: controlPlaneTlsProfileDigest,
  });
  const responseCatalog = buildControlPlaneResponseCatalog();
  return Object.freeze({
    spacesControlPlaneRequestCatalogDigest: String(
      requestCatalog.catalogDigest,
    ),
    spacesControlPlaneResponseCatalogDigest: String(
      responseCatalog.catalogDigest,
    ),
    spacesControlPlaneTlsProfileDigest: controlPlaneTlsProfileDigest,
  });
}

const CREDENTIAL_EGRESS_PROFILE = Object.freeze({
  profile: 'gala-spaces-credential-egress-v2',
  credentials: ['spaces-limited-access-key', 'spaces-optional-session-token'],
  mintsCredentials: false,
  signatureAlgorithm: 'AWS4-HMAC-SHA256',
  permittedApiOriginCount: 2,
  permittedPublicOriginCredentials: 0,
});

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
export function describeCapabilities(context) {
  const requestTemplates = buildRequestTemplates(context.origins, {
    hasSessionToken: context.hasSessionToken === true,
  });
  const controlPlaneBindingDigest = domainDigest(
    DOMAIN_SPACES_CONTROL_BINDING,
    CONTROL_PLANE_BINDING,
  );
  const controlPlaneCatalogDigests = spacesControlPlaneCatalogDigests(
    context.origins,
  );
  const compatibilityEvidence = {
    profile: 'gala-spaces-compatibility-evidence-v2',
    stagePrefix: STAGE_PREFIX,
    stagingIsADistinctPrivateBucket: true,
    activationWritesMarkerLast: true,
    claimsPointerSwap: false,
    claimsCompleteProviderDigest: false,
    claimsCdnPurge: false,
    claimsNativeHistoricalPromotion: false,
    publicOrigin: context.origins.publicOrigin,
  };

  const declarationWithoutDigest = {
    schemaId: 'urn:gala:schema:adapter-capability:2.0.0',
    schemaVersion: '2.0.0',
    adapter: {
      adapterId: 'do-spaces',
      adapterVersion: ADAPTER_VERSION,
      adapterDigest: ADAPTER_DIGEST,
    },
    contractVersion: '2.0.0',
    protocolRange: '^2.0.0',
    destinationKinds: ['do-spaces'],
    operations: [
      'activate',
      'cleanup-staged',
      'inspect',
      'observe',
      'rollback',
      'stage',
    ],
    staging: ROW.staging,
    activation: ROW.activation,
    concurrency: ROW.concurrency,
    idempotencyClass: ROW.idempotencyClass,
    rollback: ROLLBACK,
    verification: [...ROW.verification].sort(),
    providerInventoryAssurance: ROW.providerInventoryAssurance,
    configuration: {
      redirects: false,
      headers: false,
      customDomains: false,
      notFoundBehavior: ROW.notFoundBehavior,
      immutableCaching: false,
    },
    cacheInvalidation: 'none',
    limits: {
      transport: 'http',
      maximumFiles: '100000',
      maximumFileBytes: '5368709120',
      maximumArtifactBytes: '10737418240',
      maximumProviderCallSeconds: 300,
      maximumPathBytes: 512,
      pathRuleProfile: 'gala-portable-v2',
      requestTemplateProfile: REQUEST_TEMPLATE_PROFILE,
      requestTemplateCatalogDigest: domainDigest(
        DOMAIN_SPACES_REQUEST_CATALOG,
        requestTemplates,
      ),
      requestTemplates: [...requestTemplates],
      responseProfileCatalogDigest: domainDigest(
        DOMAIN_SPACES_RESPONSE_CATALOG,
        [...RESPONSE_PROFILES],
      ),
      providerCompatibilityEvidenceDigest: domainDigest(
        DOMAIN_SPACES_COMPATIBILITY,
        compatibilityEvidence,
      ),
      tlsProfileDigest: domainDigest(DOMAIN_SPACES_TLS_PROFILE, TLS_PROFILE),
      credentialEgressProfileDigest: domainDigest(
        DOMAIN_SPACES_CREDENTIAL_EGRESS,
        CREDENTIAL_EGRESS_PROFILE,
      ),
      managedExecutionBudget: {
        verifiedHandoffSeconds: 120,
        spacesControlPlaneVerificationSeconds: 120,
        providerExecutionSeconds: 1500,
        journalHandoffSeconds: 120,
        totalSeconds: 1500,
      },
      spacesWebsiteConfigurationDigest: domainDigest(
        DOMAIN_SPACES_WEBSITE_CONFIGURATION,
        WEBSITE_CONFIGURATION,
      ),
      spacesControlPlaneBindingDigest: controlPlaneBindingDigest,
      spacesControlPlaneRequestCatalogDigest:
        controlPlaneCatalogDigests.spacesControlPlaneRequestCatalogDigest,
      spacesControlPlaneResponseCatalogDigest:
        controlPlaneCatalogDigests.spacesControlPlaneResponseCatalogDigest,
      spacesControlPlaneTlsProfileDigest:
        controlPlaneCatalogDigests.spacesControlPlaneTlsProfileDigest,
      maximumProviderRequestsPerStage: 1000000,
      maximumProviderStageRequestBytes: '10737418240',
      maximumProviderStageResponseBytes: '1073741824',
      maximumProviderStageResponseWireBytes: '1073741824',
      maximumProviderRequestHeadBytes: 16384,
      maximumProviderRequestBodyBytes: String(MAXIMUM_SINGLE_PART_BYTES),
      maximumProviderResponseHeadBytes: 32768,
      maximumProviderResponseBodyBytes: '67108864',
      maximumProviderResponseWireBodyBytes: '67108864',
    },
  };

  const declaration = Object.freeze({
    ...declarationWithoutDigest,
    capabilityDigest: domainDigest(
      DOMAIN_ADAPTER_CAPABILITY,
      declarationWithoutDigest,
    ),
  });
  assertValidCapabilityDeclaration(declaration);
  return declaration;
}
