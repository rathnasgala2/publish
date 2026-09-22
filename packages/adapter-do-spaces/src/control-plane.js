/**
 * The closed Spaces **control-plane** catalog and the limited-key
 * `AccessDenied` proof (DEC-097 section 7, section 6.3).
 *
 * This is deliberately not part of `gala-do-spaces-sigv4-v2`. The data-plane
 * catalog is the complete set of object-mutation calls the adapter may make;
 * `GET /?website=` is a *configuration read*, and the whole point of the
 * separation is that the limited deployment credential must be unable to
 * perform it. So this module never goes through `src/s3.js`, never appears in
 * `requestTemplates`, and is never counted by the request-catalog binding
 * gate.
 *
 * Four rows, in DEC-097's exact semantic order:
 *
 * | credentialRole      | target  | expected response profile            |
 * | ------------------- | ------- | ------------------------------------ |
 * | `full-control`      | served  | `spaces-website-configuration-v2`    |
 * | `full-control`      | staging | `spaces-website-absent-v2`           |
 * | `limited-deployment`| served  | `spaces-website-access-denied-v2`    |
 * | `limited-deployment`| staging | `spaces-website-access-denied-v2`    |
 *
 * The two `full-control` rows take only the three `DO_SPACES_CONTROL_*`
 * values and execute in the separate configuration-verifier job, which this
 * package never runs. {@link proveLimitedKeyAccessDenied} issues only the two
 * `limited-deployment` rows, signed with the limited caller key, and requires
 * each to answer HTTP 403 with exact code `AccessDenied`. Anything else —
 * including a 200 configuration or a 404 absence — is a typed refusal raised
 * before any mutation: an over-privileged deployment key is a release blocker,
 * and an inconclusive answer is not a proof.
 *
 * @module
 */

import { domainDigest } from '@rathnasgala2/adapter-protocol';

import {
  DOMAIN_SPACES_CONTROL_CREDENTIAL_FORMAT,
  DOMAIN_SPACES_CONTROL_NETWORK_BOUNDARY,
  DOMAIN_SPACES_CONTROL_REQUESTS,
  DOMAIN_SPACES_CONTROL_RESPONSES,
} from './constants.js';
import { deriveOrigins } from './origins.js';
import {
  canonicalQuery,
  canonicalUriForKey,
  payloadHash,
  signRequest,
} from './sigv4.js';

/** The exact control-plane request-catalog profile. */
export const CONTROL_PLANE_REQUEST_PROFILE =
  'gala-do-spaces-control-plane-http-v2';

/** The exact control-plane response-catalog profile. */
export const CONTROL_PLANE_RESPONSE_PROFILE =
  'gala-do-spaces-control-plane-responses-v2';

/** The exact request target every control-plane row uses. */
export const CONTROL_PLANE_REQUEST_TARGET = '/?website=';

/** The three response profiles, in DEC-097's exact order. */
export const CONTROL_PLANE_RESPONSE_PROFILES = Object.freeze([
  'spaces-website-configuration-v2',
  'spaces-website-absent-v2',
  'spaces-website-access-denied-v2',
]);

/**
 * The closed Spaces key/SigV4 credential-format release this catalog binds.
 * It is a description of the credential *shape*, never of a credential.
 */
const CREDENTIAL_FORMAT_PROFILE = Object.freeze({
  profile: 'gala-do-spaces-credential-format-v2',
  signatureAlgorithm: 'AWS4-HMAC-SHA256',
  service: 's3',
  credentials: ['spaces-authorization-value', 'spaces-session-token'],
  fullControlEnvironmentPrefix: 'DO_SPACES_CONTROL_',
  limitedDeploymentEnvironmentPrefix: 'CALLER_DO_SPACES_',
  mintsCredentials: false,
});

/** The closed network boundary every control-plane row is executed under. */
const NETWORK_BOUNDARY_PROFILE = Object.freeze({
  profile: 'gala-do-spaces-control-plane-network-boundary-v2',
  protocol: 'HTTP/1.1',
  followRedirects: false,
  useProxy: false,
  requestBody: 'empty',
  method: 'GET',
});

/** The credential-format profile digest this catalog binds. */
export const CREDENTIAL_FORMAT_PROFILE_DIGEST = domainDigest(
  DOMAIN_SPACES_CONTROL_CREDENTIAL_FORMAT,
  CREDENTIAL_FORMAT_PROFILE,
);

/** The network-boundary profile digest this catalog binds. */
export const NETWORK_BOUNDARY_PROFILE_DIGEST = domainDigest(
  DOMAIN_SPACES_CONTROL_NETWORK_BOUNDARY,
  NETWORK_BOUNDARY_PROFILE,
);

/**
 * Build the closed control-plane response catalog.
 *
 * @returns {Readonly<Record<string, unknown>>} the frozen response catalog
 */
export function buildControlPlaneResponseCatalog() {
  const withoutDigest = {
    profile: CONTROL_PLANE_RESPONSE_PROFILE,
    responseProfiles: [...CONTROL_PLANE_RESPONSE_PROFILES],
  };
  return Object.freeze({
    ...withoutDigest,
    catalogDigest: domainDigest(DOMAIN_SPACES_CONTROL_RESPONSES, withoutDigest),
  });
}

/**
 * Build the closed four-row control-plane request catalog for one binding.
 *
 * @param {import('./origins.js').SpacesOrigins} origins the derived origins
 * @param {{bindingDigest: string, tlsProfileDigest: string}} bound the
 *   control-plane credential-binding and TLS profile digests this catalog is
 *   released against
 * @returns {Readonly<Record<string, unknown>>} the frozen request catalog
 */
export function buildControlPlaneRequestCatalog(origins, bound) {
  /**
   * @param {'full-control' | 'limited-deployment'} credentialRole the role
   * @param {'served' | 'staging'} target the bucket role
   * @param {string} responseProfile the expected response profile
   * @returns {Readonly<Record<string, unknown>>} one frozen row
   */
  const row = (credentialRole, target, responseProfile) =>
    Object.freeze({
      credentialRole,
      target,
      method: 'GET',
      origin:
        target === 'served'
          ? origins.servedApiOrigin
          : origins.stagingApiOrigin,
      requestTarget: CONTROL_PLANE_REQUEST_TARGET,
      responseProfile,
    });

  const responseCatalog = buildControlPlaneResponseCatalog();
  const withoutDigest = {
    profile: CONTROL_PLANE_REQUEST_PROFILE,
    bindingDigest: bound.bindingDigest,
    requests: [
      row('full-control', 'served', 'spaces-website-configuration-v2'),
      row('full-control', 'staging', 'spaces-website-absent-v2'),
      row('limited-deployment', 'served', 'spaces-website-access-denied-v2'),
      row('limited-deployment', 'staging', 'spaces-website-access-denied-v2'),
    ],
    credentialFormatProfileDigest: CREDENTIAL_FORMAT_PROFILE_DIGEST,
    networkBoundaryProfileDigest: NETWORK_BOUNDARY_PROFILE_DIGEST,
    tlsProfileDigest: bound.tlsProfileDigest,
    responseCatalogDigest: String(responseCatalog.catalogDigest),
  };
  return Object.freeze({
    ...withoutDigest,
    catalogDigest: domainDigest(DOMAIN_SPACES_CONTROL_REQUESTS, withoutDigest),
  });
}

/**
 * Parse the bounded S3 `Error` grammar's code, and nothing else.
 *
 * @param {Buffer} bytes the response body
 * @returns {string | null} the exact error code, or `null` when the body is
 *   not one well-formed bounded `Error` document
 */
function errorCode(bytes) {
  if (bytes.byteLength > 65536) {
    return null;
  }
  const text = bytes.toString('utf8');
  if (!/<Error[\s>]/u.test(text) || !/<\/Error>/u.test(text)) {
    return null;
  }
  const matches = [...text.matchAll(/<Code>([^<]*)<\/Code>/gu)];
  if (matches.length !== 1) {
    return null;
  }
  const code = String(matches[0]?.[1] ?? '');
  return /^[A-Za-z]{1,64}$/u.test(code) ? code : null;
}

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
export async function proveLimitedKeyAccessDenied(input) {
  const destination = input.destination;
  for (const field of /** @type {const} */ ([
    'accessKeyId',
    'secretAccessKey',
  ])) {
    if (typeof destination?.[field] !== 'string' || destination[field] === '') {
      throw new TypeError(
        `SPACES_LIMITED_KEY_DENIAL_UNPROVEN: destination.${field} (non-empty string) is required to prove the limited key is denied; this adapter never mints or discovers a credential`,
      );
    }
  }
  const origins = deriveOrigins(destination);
  const credentials = Object.freeze({
    accessKeyId: destination.accessKeyId,
    secretAccessKey: destination.secretAccessKey,
    ...(destination.sessionToken === undefined
      ? {}
      : { sessionToken: destination.sessionToken }),
    region: origins.region,
  });
  const doFetch = input.fetch ?? destination.fetch ?? globalThis.fetch;

  /** @type {Record<string, unknown>[]} */
  const observations = [];
  for (const target of /** @type {const} */ (['served', 'staging'])) {
    const host =
      target === 'served' ? origins.servedApiHost : origins.stagingApiHost;
    const origin =
      target === 'served' ? origins.servedApiOrigin : origins.stagingApiOrigin;
    const query = { website: '' };
    const signed = signRequest(
      {
        method: 'GET',
        host,
        key: '',
        query,
        payloadSha256: payloadHash(undefined),
      },
      credentials,
    );
    const response = await doFetch(
      `${origin}${canonicalUriForKey('')}?${canonicalQuery(query)}`,
      {
        method: 'GET',
        headers: /** @type {Record<string, string>} */ ({ ...signed }),
        redirect: 'error',
      },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    const code = errorCode(bytes);

    if (response.status >= 200 && response.status < 400) {
      throw new Error(
        `SPACES_LIMITED_KEY_OVERPRIVILEGED: the limited deployment key read the ${target} bucket's website configuration (HTTP ${response.status} at ${origin}${CONTROL_PLANE_REQUEST_TARGET}); it must be denied before a single object is mutated`,
      );
    }
    if (response.status !== 403 || code !== 'AccessDenied') {
      throw new Error(
        `SPACES_LIMITED_KEY_DENIAL_UNPROVEN: ${origin}${CONTROL_PLANE_REQUEST_TARGET} answered HTTP ${response.status}${code === null ? ' with no well-formed S3 Error code' : ` (${code})`}; only an exact 403 AccessDenied proves the limited key is denied`,
      );
    }
    observations.push(
      Object.freeze({
        credentialRole: 'limited-deployment',
        target,
        method: 'GET',
        origin,
        requestTarget: CONTROL_PLANE_REQUEST_TARGET,
        responseProfile: 'spaces-website-access-denied-v2',
        observedStatus: response.status,
        observedErrorCode: code,
      }),
    );
  }

  return Object.freeze({
    profile: 'gala-do-spaces-limited-key-denial-evidence-v2',
    requestProfile: CONTROL_PLANE_REQUEST_PROFILE,
    responseProfile: 'spaces-website-access-denied-v2',
    proven: /** @type {true} */ (true),
    observations: Object.freeze(observations),
  });
}
