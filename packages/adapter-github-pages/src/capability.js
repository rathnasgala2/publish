/**
 * `describeCapabilities`: this adapter's exact `adapter-capability:2.0.0`
 * declaration for the DEC-097 section 7 `github-pages` row, validated
 * against the published schema and the protocol's exact-row table before it
 * is ever returned.
 *
 * Nothing here is aspirational. `providerInventoryAssurance` is `none`
 * because the Pages API never reports deployed inventory, `concurrency` is
 * `none` because Pages offers no compare-and-set on activation, and
 * `cacheInvalidation` is `none` because this adapter has no purge authority.
 * The read-then-compare generation fence `activate` performs is a local,
 * non-atomic best effort and is deliberately *not* declared as a provider
 * concurrency guarantee.
 *
 * @module
 */

import {
  ROLLBACK,
  assertValidCapabilityDeclaration,
  domainDigest,
  getCapabilityRow,
} from '@rathnasgala2/adapter-protocol';
import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import {
  ADAPTER_VERSION,
  DOMAIN_ADAPTER_CAPABILITY,
  DOMAIN_ADAPTER_IDENTITY,
  DOMAIN_PAGES_COMPATIBILITY,
  DOMAIN_PAGES_CREDENTIAL_EGRESS,
  DOMAIN_PAGES_REQUEST_CATALOG,
  DOMAIN_PAGES_RESPONSE_CATALOG,
  DOMAIN_PAGES_TLS_PROFILE,
  MAXIMUM_PAGES_CARRIER_BYTES,
  PAGES_DEPLOYMENT_STATUSES,
  POLL_SCHEDULE_SECONDS,
} from './constants.js';
import {
  CALL_CLASS_BINDING,
  REQUEST_TEMPLATE_PROFILE,
  RESPONSE_PROFILES,
  buildRequestTemplates,
} from './request-catalog.js';

/**
 * The schema package's own `providerCallClassBinding` digest profile
 * (2.8.1). The inventory is typed as an open record, so the profile is
 * required here once, by name, and its absence is a refusal rather than an
 * `undefined` digest.
 *
 * @type {NonNullable<(typeof ACTIVE_DIGEST_PROFILES)['providerCallClassBinding']>}
 */
export const CALL_CLASS_BINDING_PROFILE = (() => {
  const profile = ACTIVE_DIGEST_PROFILES.providerCallClassBinding;
  if (profile === undefined) {
    throw new Error(
      'PAGES_DIGEST_PROFILE_MISSING: @rathnasgala2/schemas/digest-profiles exports no providerCallClassBinding profile',
    );
  }
  return profile;
})();

const ROW_OR_UNDEFINED = getCapabilityRow('github-pages');
if (ROW_OR_UNDEFINED === undefined) {
  throw new Error(
    'adapter-protocol does not declare a github-pages capability row',
  );
}
/** The exact DEC-097 admission row for `github-pages`, never `undefined`. */
const ROW = /** @type {NonNullable<ReturnType<typeof getCapabilityRow>>} */ (
  ROW_OR_UNDEFINED
);

/** This adapter's stable identity digest. */
export const ADAPTER_DIGEST = domainDigest(DOMAIN_ADAPTER_IDENTITY, {
  name: '@rathnasgala2/adapter-github-pages',
  version: ADAPTER_VERSION,
});

/**
 * The exact TLS profile every provider call is made under. The adapter does
 * not implement TLS itself (Node's `fetch` does); this record states the
 * profile the adapter refuses to operate outside of, and is digested into
 * the declaration so a reviewer can diff it.
 */
const TLS_PROFILE = Object.freeze({
  profile: 'gala-pages-tls-v2',
  minimumVersion: 'TLSv1.2',
  requireCertificateVerification: true,
  allowInsecureRedirects: false,
  followRedirects: false,
});

/**
 * The credential-egress profile: exactly one credential (a caller-supplied
 * GitHub installation token) reaches exactly one header on exactly one
 * origin. The adapter never mints, refreshes, logs or persists a token.
 */
const CREDENTIAL_EGRESS_PROFILE = Object.freeze({
  profile: 'gala-pages-credential-egress-v2',
  credentials: ['github-installation-token'],
  mintsCredentials: false,
  header: 'authorization',
  permittedOriginCount: 1,
  permittedPublicOriginCredentials: 0,
});

/**
 * Build and validate the declaration for one bound destination.
 *
 * @param {{apiOrigin: string, fileCountCeiling?: number}} context the
 *   canonical GitHub REST origin this adapter is bound to
 * @returns {Readonly<Record<string, unknown>>} the validated declaration
 */
export function describeCapabilities(context) {
  const requestTemplates = buildRequestTemplates(context.apiOrigin);
  const compatibilityEvidence = {
    profile: 'gala-pages-compatibility-evidence-v2',
    acceptedDeploymentStatuses: [...PAGES_DEPLOYMENT_STATUSES],
    pollScheduleSeconds: [...POLL_SCHEDULE_SECONDS],
    usesOpaqueDeployPagesAction: false,
    mutatesBranch: false,
    followsCreateResponseStatusUrl: false,
    claimsCompleteDeployedInventory: false,
  };

  const declarationWithoutDigest = {
    schemaId: 'urn:gala:schema:adapter-capability:2.0.0',
    schemaVersion: '2.0.0',
    adapter: {
      adapterId: 'github-pages',
      adapterVersion: ADAPTER_VERSION,
      adapterDigest: ADAPTER_DIGEST,
    },
    contractVersion: '2.0.0',
    protocolRange: '^2.0.0',
    destinationKinds: ['github-pages'],
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
      maximumFileBytes: '1073741824',
      maximumArtifactBytes: '1073741824',
      maximumProviderCallSeconds: 300,
      maximumPathBytes: 255,
      pathRuleProfile: 'gala-portable-v2',
      requestTemplateProfile: REQUEST_TEMPLATE_PROFILE,
      requestTemplateCatalogDigest: domainDigest(
        DOMAIN_PAGES_REQUEST_CATALOG,
        requestTemplates,
      ),
      requestTemplates: [...requestTemplates],
      // LOCAL-52 (2): the per-row `pagesDeploymentId` source and recovery-only
      // flag, declared and bound by their own digest domain rather than folded
      // into `requestTemplateCatalogDigest`, whose preimage is unchanged.
      callClassBinding: [...CALL_CLASS_BINDING],
      // Schema 2.8.1: the contract's own `providerCallClassBinding` profile,
      // so the digest is the byte-identical result the validator checks
      // rather than a locally re-derived domain string.
      callClassBindingDigest: CALL_CLASS_BINDING_PROFILE.digest([
        ...CALL_CLASS_BINDING,
      ]),
      responseProfileCatalogDigest: domainDigest(
        DOMAIN_PAGES_RESPONSE_CATALOG,
        [...RESPONSE_PROFILES],
      ),
      providerCompatibilityEvidenceDigest: domainDigest(
        DOMAIN_PAGES_COMPATIBILITY,
        compatibilityEvidence,
      ),
      tlsProfileDigest: domainDigest(DOMAIN_PAGES_TLS_PROFILE, TLS_PROFILE),
      credentialEgressProfileDigest: domainDigest(
        DOMAIN_PAGES_CREDENTIAL_EGRESS,
        CREDENTIAL_EGRESS_PROFILE,
      ),
      managedExecutionBudget: {
        verifiedHandoffSeconds: 120,
        pagesCarrierConstructionSeconds: 300,
        pagesArtifactUploadSeconds: 600,
        pagesArtifactVerificationSeconds: 120,
        providerExecutionSeconds: 1500,
        journalHandoffSeconds: 120,
        totalSeconds: 1500,
      },
      pagesArtifactProfile: 'gala-pages-artifact-v2',
      maximumPagesArtifactBytes: String(MAXIMUM_PAGES_CARRIER_BYTES),
      maximumProviderRequestsPerStage: 128,
      maximumProviderStageRequestBytes: '1073741824',
      maximumProviderStageResponseBytes: '1048576',
      maximumProviderStageResponseWireBytes: '1048576',
      maximumProviderRequestHeadBytes: 16384,
      maximumProviderRequestBodyBytes: '1048576',
      maximumProviderResponseHeadBytes: 32768,
      maximumProviderResponseBodyBytes: '1048576',
      maximumProviderResponseWireBodyBytes: '1048576',
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
