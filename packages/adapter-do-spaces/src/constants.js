/**
 * Closed constants for the managed `do-spaces` adapter (slice brief
 * `S4-workflow-build-deploy-certification.md` section 6.3; DEC-097 section 7's
 * `do-spaces` row).
 *
 * @module
 */

import { createRequire } from 'node:module';

/**
 * This adapter's installed package version, read from its own `package.json`
 * rather than restated by hand: DEC-097 section 3 requires the capability
 * document's `adapter.adapterVersion` to byte-equal the locked package
 * version, and the only value that can never drift from what a lock records
 * for this package is the version the package manifest itself declares.
 */
export const ADAPTER_VERSION = /** @type {string} */ (
  /** @type {{version: string}} */ (
    createRequire(import.meta.url)('../package.json')
  ).version
);

/** The reserved artifact-relative public-generation-marker coordinate. */
export const GENERATION_MARKER_KEY = '.well-known/gala-generation.json';

/**
 * The reserved private staging prefix. Staging never touches the served
 * bucket, so a stale private object can never contaminate served inventory
 * (brief section 6.3).
 */
export const STAGE_PREFIX = '_gala/staged/v2/';

/** The generated website index document the served bucket must be configured with. */
export const WEBSITE_INDEX_DOCUMENT = 'index.html';

/** The generated website error document the served bucket must be configured with. */
export const WEBSITE_ERROR_DOCUMENT = '404.html';

/** Maximum single-part object body, in bytes; above this a multipart upload is required. */
export const MAXIMUM_SINGLE_PART_BYTES = 5242880;

/** Maximum keys requested per `ListObjectsV2` page. */
export const LIST_PAGE_SIZE = 1000;

/** Domain separator: `adapter-capability:2.0.0.capabilityDigest`. */
export const DOMAIN_ADAPTER_CAPABILITY = 'GALA-ADAPTER-CAPABILITY-V2\0';

/** Domain separator shared with the template's artifact-manifest projection. */
export const DOMAIN_ARTIFACT = 'GALA-ARTIFACT-V2 ';

/** Domain separator: this adapter's own identity digest. */
export const DOMAIN_ADAPTER_IDENTITY = 'GALA-SPACES-ADAPTER-IDENTITY-V2\0';

/** Domain separator: the physical served-bucket/region mutation key. */
export const DOMAIN_SPACES_DESTINATION = 'GALA-SPACES-DESTINATION-V2\0';

/** Domain separator: the frozen provider request-template catalog. */
export const DOMAIN_SPACES_REQUEST_CATALOG = 'GALA-SPACES-REQUEST-CATALOG-V2\0';

/** Domain separator: the frozen provider response-profile catalog. */
export const DOMAIN_SPACES_RESPONSE_CATALOG =
  'GALA-SPACES-RESPONSE-CATALOG-V2\0';

/** Domain separator: the provider compatibility evidence record. */
export const DOMAIN_SPACES_COMPATIBILITY = 'GALA-SPACES-COMPATIBILITY-V2\0';

/** Domain separator: the TLS profile record. */
export const DOMAIN_SPACES_TLS_PROFILE = 'GALA-SPACES-TLS-PROFILE-V2\0';

/** Domain separator: the credential-egress profile record. */
export const DOMAIN_SPACES_CREDENTIAL_EGRESS =
  'GALA-SPACES-CREDENTIAL-EGRESS-V2\0';

/** Domain separator: the exact served-bucket website configuration record. */
export const DOMAIN_SPACES_WEBSITE_CONFIGURATION =
  'GALA-SPACES-WEBSITE-CONFIGURATION-V2\0';

/** Domain separator: the control-plane credential binding record. */
export const DOMAIN_SPACES_CONTROL_BINDING =
  'GALA-SPACES-CONTROL-PLANE-BINDING-V2\0';

/** Domain separator: the control-plane request catalog (DEC-097 section 7). */
export const DOMAIN_SPACES_CONTROL_REQUESTS =
  'GALA-DO-SPACES-CONTROL-PLANE-REQUESTS-V2\0';

/** Domain separator: the control-plane response catalog (DEC-097 section 7). */
export const DOMAIN_SPACES_CONTROL_RESPONSES =
  'GALA-DO-SPACES-CONTROL-PLANE-RESPONSES-V2\0';

/** Domain separator: the closed Spaces key/SigV4 credential-format release. */
export const DOMAIN_SPACES_CONTROL_CREDENTIAL_FORMAT =
  'GALA-DO-SPACES-CONTROL-PLANE-CREDENTIAL-FORMAT-V2\0';

/** Domain separator: the control-plane network-boundary profile. */
export const DOMAIN_SPACES_CONTROL_NETWORK_BOUNDARY =
  'GALA-DO-SPACES-CONTROL-PLANE-NETWORK-BOUNDARY-V2\0';

/** Domain separator: the control-plane TLS profile. */
export const DOMAIN_SPACES_CONTROL_TLS = 'GALA-SPACES-CONTROL-PLANE-TLS-V2\0';
