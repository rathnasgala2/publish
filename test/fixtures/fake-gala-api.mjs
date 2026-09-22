/**
 * A loopback Gala stand-in for exactly the two workload routes, with the
 * API's own rules mirrored from the 2.8.0 contract and from
 * `io.gala.api.workload`'s implementation of it.
 *
 * The point of this fixture is that the workflow's callers are proved
 * against something that refuses what Gala refuses, in the order Gala
 * refuses it. The rules it enforces, in the order the API applies them:
 *
 * **`POST /v2/workloads/github/receipt-exchanges`**
 *
 * 1. `application/json` or `415 VALIDATION_FAILED`.
 * 2. `Authorization: Bearer <assertion>` or `403 WORKLOAD_BINDING_INVALID`.
 * 3. The body is read with a hard `1,048,577`-byte cap; at or over it,
 *    `413 VALIDATION_FAILED`.
 * 4. The assertion is verified RS256 against the issuer's published JWKS —
 *    the key is taken from the JWKS by `kid` and never from the token's own
 *    header — with exact issuer, the exact audience the requested purpose is
 *    bound to, one minute of clock skew and a lifetime no longer than 600
 *    seconds.
 * 5. The claims are bound: the exact repository, owner and numeric ids; the
 *    subject recomputed from the claims and compared against GitHub's two
 *    documented default non-environment forms and never prefix-matched; no
 *    `environment` claim and no `:environment:` subject segment;
 *    `run_attempt` in `1..51`; `event_name` in `create | workflow_dispatch`;
 *    `runner_environment: github-hosted`; the purpose's own same-commit
 *    helper as `job_workflow_ref` at the same `sha`, and `workflow_ref` a
 *    *different* workflow at that same `sha`; and a ref that is exactly
 *    `refs/heads/gala/publish/<operationId>` naming an operation this
 *    fixture was seeded with. Anything else is
 *    `403 WORKLOAD_BINDING_INVALID`.
 * 6. The body is read against the closed union: an undeclared member is
 *    `400 REQUEST_FIELD_UNKNOWN`, every other contract violation is
 *    `400 VALIDATION_FAILED`, an over-bound verification submission is
 *    `422 VALIDATION_FAILED`, and an `adapterId` outside the admitted three
 *    is `400 VALIDATION_FAILED`.
 * 7. LOCAL-55/57: `artifactId`, `attemptId` and `proposedGenerationId` are
 *    derived on this side from the closed binding
 *    `(repositoryId, operationId, runId, runAttempt, artifactDigest)` with
 *    the same domains `WorkloadDerivedIdentity` uses, and `pagesBuildVersion`
 *    / `spacesStagePrefix` are derived from those. Both conditional members
 *    are optional on the request; a sent value that disagrees with the
 *    derivation is `422 VALIDATION_FAILED`, because that is a disagreement
 *    about what is being deployed rather than a formatting error.
 * 7b. LOCAL-60 / schema 2.9.0 (mirroring API-INTENT-DERIVATION-1): the
 *    destination, policy and capability-decision members are derived here
 *    from this fixture's seed with the schema package's own exported
 *    digest profiles (`@rathnasgala2/schemas/digest-profiles`, the domains
 *    the eleven `parity/digest-record-vectors.json` vectors pin):
 *    `destination.environment` is the adapter constant; the Pages provider
 *    binding is the seeded repository (`{kind, repository, repositoryId,
 *    apiOrigin, environment}`) and the local binding the request's two
 *    evidence digests; `targetDigest` is `destinationProviderBinding` over
 *    that record and the fence key `destinationMutationKey` over its own
 *    material (never the request's digest); `rebuildRecord`'s four Gala
 *    members come from the seeded policy release and catalog and the
 *    `buildPolicyDecision` profile; `capabilityDecisionDigest` is the
 *    `capabilityDecision` profile over the closed record. A request member
 *    that is present and disagrees is `422 VALIDATION_FAILED` with
 *    `errors[0].pointer` naming it; `adapter.adapterId` that is not
 *    `destination.adapterId` is `422` at `/destination/adapterId`; a
 *    `do-spaces` request is `409 INVALID_SOURCE_STATE` (no publication
 *    destination record exists until C2); a `local-directory` request
 *    without its provider binding is `422` at `/destination/providerBinding`;
 *    an `adapter.adapterVersion` with no admitted row — superseded (the
 *    0045 `2.0.0` rows) or never admitted — is `422` at
 *    `/adapter/adapterVersion` (LOCAL-64: rows are keyed by the published
 *    package version, `0.1.0`) and a `destination.adapterVersion` other
 *    than the adapter's is `422` at `/destination/adapterVersion`. The
 *    capability decision is the LOCAL-62 issuance-phase record
 *    (`capability-decision.mjs`, the API's release 0045/0046 admission
 *    rows).
 *    The intent `subject` is the DEC-097 workload URN
 *    `urn:gala:workload:github:<repositoryId>:<runId>:<runAttempt>`.
 * 8. A repeated `jti` is `409 WORKLOAD_REPLAYED`. A fresh `jti` for the same
 *    bound tuple re-renders the retained intent rather than issuing a second
 *    one; a changed tuple is `403 WORKLOAD_BINDING_INVALID`.
 * 9. `200`, `Cache-Control: no-store`, no `Location`, one of the three
 *    closed flat members, each carrying its constant 2.8.0 `kind` (the
 *    `omitKind` lever answers as a 2.7.x server that has no `kind`).
 *
 * **`POST /v2/workloads/deployment-receipts`** is consume-before-body, which
 * is the property the fixture exists to prove the caller respects:
 *
 * 1. `Authorization: Gala-Receipt <capability>` is the only pre-consumption
 *    gate. The generation is moved `active -> consumed-pending-validation`
 *    *before* a media type is examined or a byte is read.
 * 2. Every capability failure — unknown, malformed, expired, superseded,
 *    already consumed, or belonging to a fence that has moved — answers the
 *    same non-enumerating `401 REPORTING_CAPABILITY_INVALID`.
 * 3. Only then: media type, the hard cap and the intent's own
 *    `maximumReportRequestByteCount` (both before parsing), the contract,
 *    then agreement with the retained intent, then the destination fence.
 * 4. Every failure after consumption commits the permanent tombstone, so the
 *    same capability presented twice is `401` the second time whatever the
 *    first failure was.
 * 5. `202` proves durable preliminary evidence and never certification:
 *    every managed-receipt member is absent and the snapshot count is zero.
 *
 * @module
 */

import { createServer } from 'node:http';
import { createHash, createVerify, randomBytes, randomUUID } from 'node:crypto';

import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import {
  ADAPTER_ENVIRONMENTS,
  MAXIMUM_KERNEL_JOURNAL_BYTES,
  REBUILD_RECORD_API_DERIVED,
  WorkloadContractError,
  validateExchangeRequest,
  validateReceiptSubmission,
} from '../../scripts/workflow/workload-contract.mjs';
import {
  admissionRow,
  issuancePhaseDecision,
} from '../../scripts/workflow/capability-decision.mjs';
import {
  deriveOrigins as deriveSpacesOrigins,
  spacesControlPlaneBinding,
  spacesControlPlaneCatalogDigests,
  spacesRegionCatalog,
  spacesWebsiteConfiguration,
} from '@rathnasgala2/adapter-do-spaces';
import {
  canonicalJson,
  derivePagesBuildVersion,
  deriveSpacesStagePrefix,
  deriveStableId,
} from '../../scripts/workflow/workload-identity.mjs';

/**
 * One of the four DEC-097 record profiles the API derives at issuance
 * (LOCAL-60), taken from the schema package's own frozen inventory.
 *
 * @param {'destinationProviderBinding' | 'destinationMutationKey' | 'buildPolicyDecision' | 'capabilityDecision'} name
 *   the profile
 * @returns {{digest: (value: unknown) => string}} the profile
 */
function profile(name) {
  const found =
    /** @type {Record<string, {digest: (value: unknown) => string} | undefined>} */ (
      /** @type {unknown} */ (ACTIVE_DIGEST_PROFILES)
    )[name];
  if (found === undefined) {
    throw new Error(
      `digest profile ${name} is not exported by the schema package`,
    );
  }
  return found;
}

/**
 * The admission row this Gala selects for one adapter at one published
 * package version (LOCAL-64): the caller's seeded row for the adapter when
 * it seeded one, else the API's admitted row; no admitted row is the API's
 * `422 VALIDATION_FAILED` at `/adapter/adapterVersion`.
 *
 * @param {Record<string, any>} seed the fixture's seed
 * @param {string} adapterId the adapter
 * @param {string} adapterVersion the adapter's published package version
 * @returns {import('../../scripts/workflow/capability-decision.mjs').AdmissionRow}
 *   the admitted row
 */
function admittedRowFor(seed, adapterId, adapterVersion) {
  const seeded = seed.admission?.[adapterId];
  if (seeded !== undefined) {
    if (seeded.adapterVersion !== adapterVersion) {
      throw new Refused('DERIVATION_MISMATCH', '/adapter/adapterVersion');
    }
    return seeded;
  }
  try {
    return admissionRow(adapterId, adapterVersion);
  } catch (error) {
    if (
      error instanceof Error &&
      /^CAPABILITY_ADMISSION_UNKNOWN/u.test(error.message)
    ) {
      throw new Refused('DERIVATION_MISMATCH', '/adapter/adapterVersion');
    }
    throw error;
  }
}

/** The GitHub REST origin every Pages provider binding names (DEC-097 section 7). */
const GITHUB_API_ORIGIN = 'https://api.github.com';

/**
 * A fixture stand-in for the DEC-097 lines 7328-7335 server-owned Spaces
 * region catalog: a real, unique, ASCII-sorted region list — not the real
 * compatibility release, but shaped exactly like it, so a test can prove
 * the fixture and the real catalog digest to the same profile.
 */
const SPACES_REGION_CATALOG_REGIONS = Object.freeze([
  'ams3',
  'fra1',
  'lon1',
  'nyc3',
  'sfo3',
  'sgp1',
  'syd1',
  'tor1',
]);

/** The API's own hard transport cap, one byte over the contract ceiling. */
const MAXIMUM_BODY_BYTES = 1048577;

/** The exact audience each purpose is bound to. */
const AUDIENCES = Object.freeze({
  'deployment-intent': 'urn:gala:workload:deployment-intent:v2',
  'deployment-receipt': 'urn:gala:workload:deployment-receipt:v2',
});

/** The same-commit helper each purpose must be invoked from. */
const HELPERS = Object.freeze({
  'deployment-intent': '.github/workflows/authorize-v2.yml',
  'deployment-receipt': '.github/workflows/report-v2.yml',
});

/** DEC-097's twenty-one required OIDC claims. */
export const REQUIRED_CLAIMS = Object.freeze([
  'iss',
  'aud',
  'sub',
  'jti',
  'iat',
  'nbf',
  'exp',
  'repository',
  'repository_id',
  'repository_owner',
  'repository_owner_id',
  'ref',
  'ref_type',
  'sha',
  'run_id',
  'run_number',
  'run_attempt',
  'event_name',
  'runner_environment',
  'job_workflow_ref',
  'workflow_ref',
]);

/** The API's `WorkloadProblemCategory` to wire mapping, exactly. */
const PROBLEMS = Object.freeze({
  BINDING_INVALID: { status: 403, code: 'WORKLOAD_BINDING_INVALID' },
  REPLAYED: { status: 409, code: 'WORKLOAD_REPLAYED' },
  SOURCE_STATE_INVALID: { status: 409, code: 'INVALID_SOURCE_STATE' },
  DESTINATION_MUTATION_IN_PROGRESS: {
    status: 409,
    code: 'DESTINATION_MUTATION_IN_PROGRESS',
  },
  CHALLENGE_EXPIRED: { status: 410, code: 'CAPABILITY_EXPIRED' },
  RATE_LIMITED: { status: 429, code: 'RATE_LIMITED' },
  VERIFICATION_EVIDENCE_LIMIT_EXCEEDED: {
    status: 422,
    code: 'VERIFICATION_EVIDENCE_LIMIT_EXCEEDED',
  },
  VALIDATION_FAILED: { status: 400, code: 'VALIDATION_FAILED' },
  DERIVATION_MISMATCH: { status: 422, code: 'VALIDATION_FAILED' },
  REQUEST_FIELD_UNKNOWN: { status: 400, code: 'REQUEST_FIELD_UNKNOWN' },
  REQUEST_TOO_LARGE: { status: 413, code: 'VALIDATION_FAILED' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, code: 'VALIDATION_FAILED' },
  REPORTING_CAPABILITY_INVALID: {
    status: 401,
    code: 'REPORTING_CAPABILITY_INVALID',
  },
  CAPABILITY_UNAVAILABLE: { status: 503, code: 'CAPABILITY_UNAVAILABLE' },
});

/** A refusal carrying exactly one category and, for a field refusal, its pointer. */
class Refused extends Error {
  /**
   * @param {keyof typeof PROBLEMS} category the refusal category
   * @param {string} [pointer] the body-relative pointer of the refused member
   */
  constructor(category, pointer) {
    super(pointer === undefined ? category : `${category} ${pointer}`);
    this.category = category;
    /** @type {string | null} */
    this.pointer = pointer ?? null;
  }
}

/**
 * base64url decode.
 *
 * @param {string} value the encoded segment
 * @returns {Buffer} the bytes
 */
function fromBase64url(value) {
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

/**
 * rfc3339 with exactly three fractional digits.
 *
 * @param {Date} at the instant
 * @returns {string} the rendered instant
 */
function instant(at) {
  return `${at.toISOString().slice(0, 19)}.${String(at.getUTCMilliseconds()).padStart(3, '0')}Z`;
}

/**
 * @param {string} text the text to digest
 * @returns {string} the tagged digest
 */
function digestOf(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * Verify the assertion's RS256 signature against the issuer's own published
 * JWKS. The key is selected by `kid` from the fetched document and never
 * taken from the token's own header.
 *
 * @param {string} assertion the compact assertion
 * @param {{jwksUri: string}} issuer the configured issuer
 * @returns {Promise<Record<string, unknown>>} the verified claims
 */
async function verifyAssertion(assertion, issuer) {
  const segments = assertion.split('.');
  if (segments.length !== 3) {
    throw new Refused('BINDING_INVALID');
  }
  /** @type {Record<string, unknown>} */
  let header;
  /** @type {Record<string, unknown>} */
  let claims;
  try {
    header = JSON.parse(fromBase64url(segments[0] ?? '').toString('utf8'));
    claims = JSON.parse(fromBase64url(segments[1] ?? '').toString('utf8'));
  } catch {
    throw new Refused('BINDING_INVALID');
  }
  if (header.alg !== 'RS256') {
    throw new Refused('BINDING_INVALID');
  }
  for (const forbidden of ['jwk', 'jku', 'x5c', 'x5u']) {
    if (header[forbidden] !== undefined) {
      throw new Refused('BINDING_INVALID');
    }
  }
  const document = /** @type {{keys: Record<string, unknown>[]}} */ (
    await (await fetch(issuer.jwksUri, { redirect: 'error' })).json()
  );
  const key = document.keys.find((candidate) => candidate.kid === header.kid);
  if (key === undefined) {
    throw new Refused('BINDING_INVALID');
  }
  const verified = createVerify('RSA-SHA256')
    .update(`${segments[0]}.${segments[1]}`)
    .verify(
      { key: /** @type {any} */ (key), format: 'jwk' },
      fromBase64url(segments[2] ?? ''),
    );
  if (!verified) {
    throw new Refused('BINDING_INVALID');
  }
  return claims;
}

/**
 * Bind the verified claims to this fixture's seeded repository and the
 * operation the publish ref names. Fail-closed, with no default-accept
 * branch, exactly like `WorkloadClaimBinder`.
 *
 * @param {Record<string, unknown>} claims the verified claims
 * @param {'deployment-intent' | 'deployment-receipt'} purpose the purpose
 * @param {Record<string, any>} seed the fixture's bound repository
 * @returns {{operationId: string, tupleDigest: string, jti: string, repositoryId: string, runId: string, runAttempt: number}}
 *   the binding
 */
function bindClaims(claims, purpose, seed) {
  for (const name of REQUIRED_CLAIMS) {
    if (claims[name] === undefined) {
      throw new Refused('BINDING_INVALID');
    }
  }
  if (claims.environment !== undefined) {
    throw new Refused('BINDING_INVALID');
  }
  const seconds = Math.floor(Date.now() / 1000);
  const exp = Number(claims.exp);
  const nbf = Number(claims.nbf);
  const iat = Number(claims.iat);
  if (
    !Number.isFinite(exp) ||
    exp <= seconds - 60 ||
    nbf > seconds + 60 ||
    iat > seconds + 60 ||
    exp - iat > 600
  ) {
    throw new Refused('BINDING_INVALID');
  }
  if (claims.iss !== seed.issuer || claims.aud !== AUDIENCES[purpose]) {
    throw new Refused('BINDING_INVALID');
  }
  if (
    claims.repository !== seed.repository ||
    String(claims.repository_id) !== String(seed.repositoryId) ||
    String(claims.repository_owner_id) !== String(seed.repositoryOwnerId) ||
    claims.repository_owner !== String(seed.repository).split('/')[0]
  ) {
    throw new Refused('BINDING_INVALID');
  }
  const attempt = Number(claims.run_attempt);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 51) {
    throw new Refused('BINDING_INVALID');
  }
  if (Number(claims.run_number) < 1) {
    throw new Refused('BINDING_INVALID');
  }
  if (
    claims.event_name !== 'create' &&
    claims.event_name !== 'workflow_dispatch'
  ) {
    throw new Refused('BINDING_INVALID');
  }
  if (claims.runner_environment !== 'github-hosted') {
    throw new Refused('BINDING_INVALID');
  }
  const helper = `${seed.workflowRepository}/${HELPERS[purpose]}@${claims.sha}`;
  if (claims.job_workflow_ref !== helper) {
    throw new Refused('BINDING_INVALID');
  }
  if (
    typeof claims.workflow_ref !== 'string' ||
    claims.workflow_ref === helper ||
    !claims.workflow_ref.endsWith(`@${claims.sha}`)
  ) {
    throw new Refused('BINDING_INVALID');
  }
  const ref = String(claims.ref);
  const match = /^refs\/heads\/gala\/publish\/([0-9a-f-]{36})$/u.exec(ref);
  if (match === null || match[1] !== seed.operationId) {
    throw new Refused('BINDING_INVALID');
  }
  // The subject is recomputed and compared for equality against the two
  // documented default forms; it is never prefix-matched, and a subject
  // carrying an `:environment:` segment is refused outright.
  const forms = [
    `repo:${seed.repository}:ref:${ref}`,
    `repo:${String(seed.repository).split('/')[0]}@${seed.repositoryOwnerId}/${String(seed.repository).split('/')[1]}@${seed.repositoryId}:ref:${ref}`,
  ];
  if (
    typeof claims.sub !== 'string' ||
    claims.sub.includes(':environment:') ||
    !forms.includes(claims.sub)
  ) {
    throw new Refused('BINDING_INVALID');
  }
  return {
    operationId: /** @type {string} */ (match[1]),
    tupleDigest: digestOf(
      `${claims.repository_id}|${ref}|${claims.sha}|${claims.run_id}|${claims.run_attempt}`,
    ),
    jti: String(claims.jti),
    repositoryId: String(claims.repository_id),
    runId: String(claims.run_id),
    runAttempt: attempt,
  };
}

/**
 * LOCAL-57: derive the three identities and the two adapter-conditional
 * members exactly as `WorkloadDerivedIdentity` does, from the verified
 * claims and the submitted artifact digest, and refuse a submitted
 * conditional member that disagrees.
 *
 * @param {Record<string, any>} request the accepted request
 * @param {{operationId: string, repositoryId: string, runId: string, runAttempt: number}} binding
 *   the verified binding
 * @returns {{artifactId: string, attemptId: string, generationId: string, pagesBuildVersion?: string, spacesStagePrefix?: string}}
 *   the derived identities
 */
function deriveIdentities(request, binding) {
  const preimage = {
    repositoryId: binding.repositoryId,
    operationId: binding.operationId,
    runId: binding.runId,
    runAttempt: binding.runAttempt,
    artifactDigest: String(request.artifactDigest),
  };
  const artifactId = deriveStableId('gala-artifact-id-v2', preimage);
  const attemptId = deriveStableId('gala-attempt-id-v2', preimage);
  const generationId = deriveStableId('gala-generation-id-v2', preimage);
  /** @type {{artifactId: string, attemptId: string, generationId: string, pagesBuildVersion?: string, spacesStagePrefix?: string}} */
  const derived = { artifactId, attemptId, generationId };
  const adapterId = request.adapter.adapterId;
  if (adapterId === 'github-pages') {
    derived.pagesBuildVersion = derivePagesBuildVersion({
      ...preimage,
      artifactId,
      attemptId,
      proposedGenerationId: generationId,
    });
  } else if (adapterId === 'do-spaces') {
    derived.spacesStagePrefix = deriveSpacesStagePrefix({
      operationId: binding.operationId,
      attemptId,
      proposedGenerationId: generationId,
    });
  }
  for (const member of ['pagesBuildVersion', 'spacesStagePrefix']) {
    const sent = request[member];
    if (
      sent !== undefined &&
      sent !==
        derived[
          /** @type {'pagesBuildVersion' | 'spacesStagePrefix'} */ (member)
        ]
    ) {
      throw new Refused('DERIVATION_MISMATCH');
    }
  }
  return derived;
}

/**
 * Refuse a request member that is present and disagrees with this side's
 * derivation (the LOCAL-57/LOCAL-60 rule): `422 VALIDATION_FAILED` naming
 * the member. An absent member is simply derived.
 *
 * @param {unknown} sent the request's value, or `undefined`
 * @param {unknown} derived this side's value
 * @param {string} pointer the member's body-relative pointer
 * @returns {void}
 */
function refuseDisagreement(sent, derived, pointer) {
  if (sent !== undefined && canonicalJson(sent) !== canonicalJson(derived)) {
    throw new Refused('DERIVATION_MISMATCH', pointer);
  }
}

/**
 * LOCAL-60: derive the retained destination from this fixture's seed —
 * the adapter constant, the provider binding Gala owns, its
 * `GALA-DESTINATION-PROVIDER-BINDING-V2` digest and the separate
 * `GALA-DESTINATION-MUTATION-KEY-V2` fence key — and refuse a request
 * that names another adapter, disagrees with the derivation, or asks for
 * an adapter this Gala has no destination record for.
 *
 * @param {Record<string, any>} request the accepted request
 * @param {Record<string, any>} seed the fixture's bound repository
 * @returns {{destination: Record<string, unknown>, mutationKeyDigest: string, providerBinding: Record<string, unknown>, spacesClosedRecordDigests?: {
 *   spacesWebsiteConfigurationDigest: string,
 *   spacesControlPlaneBindingDigest: string,
 *   spacesControlPlaneRequestCatalogDigest: string,
 *   spacesControlPlaneResponseCatalogDigest: string,
 *   spacesControlPlaneTlsProfileDigest: string
 * }}}
 *   the retained destination identity, the fence key, the closed provider
 *   binding record the digest was taken over, and — for `do-spaces` only —
 *   the two DEC-097 per-destination closed-record digests plus the three
 *   LOCAL-63(g) per-destination control-plane catalog digests (this fixture
 *   derives them from the seeded destination's own origins exactly as the
 *   API does — never from a per-adapter admission mirror)
 */
export function deriveDestination(request, seed) {
  const sent = /** @type {Record<string, any>} */ (request.destination);
  const adapterId = String(sent.adapterId);
  if (request.adapter.adapterId !== adapterId) {
    throw new Refused('DERIVATION_MISMATCH', '/destination/adapterId');
  }
  if (adapterId === 'do-spaces') {
    // LOCAL-63 (C2): a do-spaces request is admitted only once this fixture
    // is seeded with a publication_destination-equivalent record (never
    // taken from a deploy job's request, which carries none of the three
    // bucket coordinates). No seeded destination, or one naming another
    // adapter, is the same 409 a real Gala answers before any such record
    // exists.
    if (seed.destination === undefined) {
      throw new Refused('SOURCE_STATE_INVALID');
    }
    if (seed.destination.adapterId !== 'do-spaces') {
      throw new Refused('DERIVATION_MISMATCH', '/adapter/adapterId');
    }
  }
  // API-INTENT-DERIVATION-1 review / LOCAL-64: the decision's
  // capabilityDigest names the admission row of one adapter package version
  // (DEC-097 line 3223), selected by (adapterId, adapterVersion) among the
  // admitted rows, so a version with no admitted row is refused, and the
  // destination must name that same adapter version.
  admittedRowFor(seed, adapterId, String(request.adapter.adapterVersion));
  if (sent.adapterVersion !== request.adapter.adapterVersion) {
    throw new Refused('DERIVATION_MISMATCH', '/destination/adapterVersion');
  }
  /** @type {Record<string, unknown>} */
  let providerBinding;
  /** @type {Record<string, unknown>} */
  let mutationKey;
  /** @type {Record<string, string> | undefined} */
  let retainedCoordinates;
  /**
   * The two DEC-097 per-destination Spaces closed-record digests
   * (`spacesWebsiteConfigurationDigest`/`spacesControlPlaneBindingDigest`)
   * plus the three LOCAL-63(g) per-destination control-plane catalog
   * digests, set only for `do-spaces`; `deriveCapabilityDecision` reads them
   * off the return value below rather than recomputing (single source of
   * truth with this function's own `targetDigest`).
   * @type {{
   *   spacesWebsiteConfigurationDigest: string,
   *   spacesControlPlaneBindingDigest: string,
   *   spacesControlPlaneRequestCatalogDigest: string,
   *   spacesControlPlaneResponseCatalogDigest: string,
   *   spacesControlPlaneTlsProfileDigest: string
   * } | undefined}
   */
  let spacesClosedRecordDigests;
  if (adapterId === 'do-spaces') {
    const spaces = seed.destination.spaces;
    const origins = deriveSpacesOrigins({
      region: String(spaces.region),
      servedBucket: String(spaces.servedBucket),
      stagingBucket: String(spaces.stagingBucket),
    });
    const regionCatalog = spacesRegionCatalog({
      regions: SPACES_REGION_CATALOG_REGIONS,
    });
    const websiteConfiguration = spacesWebsiteConfiguration({
      basePath: String(spaces.basePath),
    });
    const controlPlaneBinding = spacesControlPlaneBinding({
      servedBucket: origins.servedBucket,
      stagingBucket: origins.stagingBucket,
      region: origins.region,
      websiteOrigin: origins.publicOrigin,
      websiteConfigurationDigest: websiteConfiguration.configurationDigest,
    });
    const controlPlaneCatalogDigests =
      spacesControlPlaneCatalogDigests(origins);
    spacesClosedRecordDigests = {
      spacesWebsiteConfigurationDigest:
        websiteConfiguration.configurationDigest,
      spacesControlPlaneBindingDigest: controlPlaneBinding.bindingDigest,
      spacesControlPlaneRequestCatalogDigest:
        controlPlaneCatalogDigests.spacesControlPlaneRequestCatalogDigest,
      spacesControlPlaneResponseCatalogDigest:
        controlPlaneCatalogDigests.spacesControlPlaneResponseCatalogDigest,
      spacesControlPlaneTlsProfileDigest:
        controlPlaneCatalogDigests.spacesControlPlaneTlsProfileDigest,
    };
    providerBinding = {
      kind: 'do-spaces',
      servedBucket: origins.servedBucket,
      stagingBucket: origins.stagingBucket,
      region: origins.region,
      regionCatalogDigest: regionCatalog.digest,
      servedApiOrigin: origins.servedApiOrigin,
      stagingApiOrigin: origins.stagingApiOrigin,
      websiteOrigin: origins.publicOrigin,
      websiteConfigurationDigest: websiteConfiguration.configurationDigest,
      controlPlaneBindingDigest: controlPlaneBinding.bindingDigest,
    };
    mutationKey = {
      kind: 'do-spaces',
      servedBucket: origins.servedBucket,
      region: origins.region,
    };
    retainedCoordinates = {
      region: origins.region,
      servedBucket: origins.servedBucket,
      stagingBucket: origins.stagingBucket,
    };
    for (const member of ['region', 'servedBucket', 'stagingBucket']) {
      refuseDisagreement(
        sent.providerBinding?.[member],
        retainedCoordinates[member],
        `/destination/providerBinding/${member}`,
      );
    }
    // DEC-097 8446-8449 / LOCAL-63 (f): the destination's own base URL is
    // the website origin plus its base path, and the workflow's
    // rebuildRecord.basePath (a workflow-verifiable fact, never an API
    // derivation) must name the same base path this Gala's destination
    // record carries.
    const expectedBaseUrl = `${origins.publicOrigin}${spaces.basePath}`;
    refuseDisagreement(sent.baseUrl, expectedBaseUrl, '/destination/baseUrl');
    refuseDisagreement(
      request.rebuildRecord?.basePath,
      String(spaces.basePath),
      '/rebuildRecord/basePath',
    );
  } else if (adapterId === 'github-pages') {
    const [owner, repository] = String(seed.repository).split('/');
    providerBinding = {
      kind: 'github-pages',
      repository: String(seed.repository),
      repositoryId: String(seed.repositoryId),
      apiOrigin: GITHUB_API_ORIGIN,
      environment: 'github-pages',
    };
    mutationKey = {
      kind: 'github-pages',
      repositoryId: String(seed.repositoryId),
    };
    retainedCoordinates = {
      owner: String(owner),
      repository: String(repository),
    };
    for (const member of ['owner', 'repository']) {
      refuseDisagreement(
        sent.providerBinding?.[member],
        retainedCoordinates[member],
        `/destination/providerBinding/${member}`,
      );
    }
  } else {
    // The two local evidence digests have no other source than the request
    // (DEC-097 section 7 local binding); absent, nothing can be derived.
    if (sent.providerBinding === undefined) {
      throw new Refused('DERIVATION_MISMATCH', '/destination/providerBinding');
    }
    providerBinding = {
      kind: 'local-directory',
      rootIdentityDigest: String(sent.providerBinding.rootIdentityDigest),
      mutationSurfaceDigest: String(sent.providerBinding.mutationSurfaceDigest),
    };
    mutationKey = {
      kind: 'local-directory',
      mutationSurfaceDigest: providerBinding.mutationSurfaceDigest,
    };
  }
  const environment =
    ADAPTER_ENVIRONMENTS[
      /** @type {keyof typeof ADAPTER_ENVIRONMENTS} */ (adapterId)
    ];
  const targetDigest = profile('destinationProviderBinding').digest(
    providerBinding,
  );
  refuseDisagreement(sent.environment, environment, '/destination/environment');
  refuseDisagreement(
    sent.targetDigest,
    targetDigest,
    '/destination/targetDigest',
  );
  return {
    destination: {
      environment,
      adapterId,
      adapterVersion: sent.adapterVersion,
      targetDigest,
      baseUrl: sent.baseUrl,
      ...(retainedCoordinates === undefined
        ? {}
        : { providerBinding: retainedCoordinates }),
    },
    mutationKeyDigest: profile('destinationMutationKey').digest(mutationKey),
    providerBinding,
    ...(spacesClosedRecordDigests === undefined
      ? {}
      : { spacesClosedRecordDigests }),
  };
}

/**
 * LOCAL-60: the four Gala-owned rebuild-record members, from the seeded
 * policy release and catalog, the `GALA-BUILD-POLICY-DECISION-V2` profile
 * over the honest MVP decision (`pass`, no findings, the request's manifest)
 * and the destination record; a present disagreeing request member is
 * refused by pointer.
 *
 * @param {Record<string, any>} request the accepted request
 * @param {Record<string, any>} seed the fixture's bound repository
 * @param {string} targetDigest the derived destination target digest
 * @returns {Record<string, unknown>} the complete retained rebuild record
 */
export function deriveRebuildRecord(request, seed, targetDigest) {
  const derived = {
    policyReleaseId: String(seed.policyReleaseId),
    buildPolicyDecisionDigest: profile('buildPolicyDecision').digest({
      profile: 'gala-build-policy-decision-v2',
      policyReleaseId: String(seed.policyReleaseId),
      policyProfile: 'gala-build-policy',
      policyVersion: '2.0.0',
      approvedOverrides: [],
      manifestDigest: String(request.manifestDigest),
      policyResult: 'pass',
      findings: [],
    }),
    packageReleaseCatalogDigest: String(seed.packageReleaseCatalogDigest),
    // Fixture-only: the owning validated destination record's digest is
    // taken over the retained provider binding digest under a fixture
    // domain, so it varies with the destination as the real one would.
    destinationCapabilityDigest: digestOf(
      `gala-fixture-destination-capability\u0000${targetDigest}`,
    ),
  };
  for (const member of REBUILD_RECORD_API_DERIVED) {
    refuseDisagreement(
      request.rebuildRecord[member],
      derived[/** @type {keyof typeof derived} */ (member)],
      `/rebuildRecord/${member}`,
    );
  }
  return { ...request.rebuildRecord, ...derived };
}

/**
 * LOCAL-60 / LOCAL-62 / DEC-097 section 8: the issuance-phase
 * `capabilityDecision` record this Gala constructs from the request's
 * verifiable counts, its own retained destination, the adapter identity and
 * its admission row (`capability-decision.mjs` mirrors release 0045), then
 * digests with the `GALA-CAPABILITY-DECISION-V2` profile; the marker is one
 * more object and its byte length participates in the totals. The Pages
 * carrier facts are absent at issuance (the deploy job records them).
 *
 * @param {Record<string, any>} request the accepted request
 * @param {Record<string, any>} seed the fixture's bound repository
 * @param {{artifactId: string, generationId: string, pagesBuildVersion?: string, spacesStagePrefix?: string}} ids
 *   the derived identities
 * @param {Record<string, unknown>} destination the retained destination
 * @param {{runId: string, runAttempt: number}} binding the verified binding
 * @param {{
 *   spacesWebsiteConfigurationDigest: string,
 *   spacesControlPlaneBindingDigest: string,
 *   spacesControlPlaneRequestCatalogDigest: string,
 *   spacesControlPlaneResponseCatalogDigest: string,
 *   spacesControlPlaneTlsProfileDigest: string
 * } | undefined} [spacesClosedRecordDigests]
 *   the two DEC-097 per-destination Spaces closed-record digests plus the
 *   three LOCAL-63(g) per-destination control-plane catalog digests,
 *   `deriveDestination` already computed; required exactly for `do-spaces`
 * @returns {{record: Record<string, unknown>, decisionDigest: string}} the record and its digest
 */
export function deriveCapabilityDecision(
  request,
  seed,
  ids,
  destination,
  binding,
  spacesClosedRecordDigests,
) {
  const decision = issuancePhaseDecision({
    artifactId: ids.artifactId,
    artifactDigest: String(request.artifactDigest),
    manifestDigest: String(request.manifestDigest),
    destination,
    adapter: request.adapter,
    artifactFileCount: request.artifactFileCount,
    artifactByteCount: request.artifactByteCount,
    marker: {
      schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
      schemaVersion: '2.0.0',
      artifactId: ids.artifactId,
      artifactDigest: request.artifactDigest,
      generationId: ids.generationId,
    },
    ...(ids.pagesBuildVersion === undefined
      ? {}
      : { pagesBuildVersion: ids.pagesBuildVersion }),
    ...(ids.spacesStagePrefix === undefined
      ? {}
      : { spacesStagePrefix: ids.spacesStagePrefix }),
    ...(spacesClosedRecordDigests === undefined
      ? {}
      : {
          spacesWebsiteConfigurationDigest:
            spacesClosedRecordDigests.spacesWebsiteConfigurationDigest,
          spacesControlPlaneBindingDigest:
            spacesClosedRecordDigests.spacesControlPlaneBindingDigest,
          spacesControlPlaneRequestCatalogDigest:
            spacesClosedRecordDigests.spacesControlPlaneRequestCatalogDigest,
          spacesControlPlaneResponseCatalogDigest:
            spacesClosedRecordDigests.spacesControlPlaneResponseCatalogDigest,
          spacesControlPlaneTlsProfileDigest:
            spacesClosedRecordDigests.spacesControlPlaneTlsProfileDigest,
        }),
    runId: binding.runId,
    runAttempt: binding.runAttempt,
    admission: admittedRowFor(
      seed,
      String(request.adapter.adapterId),
      String(request.adapter.adapterVersion),
    ),
  });
  refuseDisagreement(
    request.capabilityDecisionDigest,
    decision.decisionDigest,
    '/capabilityDecisionDigest',
  );
  return {
    record: { ...decision.record, decisionDigest: decision.decisionDigest },
    decisionDigest: decision.decisionDigest,
  };
}

/**
 * Render the complete `deployment-intent:2.0.0` document the contract
 * requires, from the request the workload submitted plus the identities this
 * fixture mints for it and the members it derives from its own seed
 * (LOCAL-60).
 *
 * @param {Record<string, any>} request the accepted request
 * @param {Record<string, any>} seed the fixture's bound repository
 * @param {{intentId: string, artifactId: string, attemptId: string, generationId: string, authorityId: string, binding: {repositoryId: string, runId: string, runAttempt: number}, pagesBuildVersion?: string, spacesStagePrefix?: string, expectedGenerationId?: string, omitProviderBinding?: boolean}} ids
 *   the minted and derived identities, the verified workload binding the
 *   subject URN is rendered from, the served generation Gala expects
 *   (absent for a first publish) and the pre-2.8 retention lever
 * @returns {Record<string, unknown>} the intent document
 */
export function renderIntent(request, seed, ids) {
  const now = new Date();
  const later = new Date(now.getTime() + 3600000);
  const filler = `sha256:${'1'.repeat(64)}`;
  const derivedDestination = deriveDestination(request, seed);
  /** @type {Record<string, unknown>} */
  const destination = { ...derivedDestination.destination };
  if (ids.omitProviderBinding === true) {
    delete destination.providerBinding;
  }
  const rebuildRecord = deriveRebuildRecord(
    request,
    seed,
    String(destination.targetDigest),
  );
  const capabilityDecision = deriveCapabilityDecision(
    request,
    seed,
    ids,
    derivedDestination.destination,
    ids.binding,
    derivedDestination.spacesClosedRecordDigests,
  );
  /** @type {Record<string, unknown>} */
  const intent = {
    schemaId: 'urn:gala:schema:deployment-intent:2.0.0',
    schemaVersion: '2.0.0',
    operationId: seed.operationId,
    attemptId: ids.attemptId,
    idempotencyKey: ids.intentId,
    sourceCommit: request.sourceCommit,
    workflowTriggerCommit: request.workflowTriggerCommit,
    artifactId: ids.artifactId,
    artifactDigest: request.artifactDigest,
    manifestDigest: request.manifestDigest,
    artifactByteCount: String(request.artifactByteCount),
    artifactFileCount: String(request.artifactFileCount),
    provenanceDigest: request.provenanceDigest,
    sbomDigest: request.sbomDigest,
    frozenHandoffArtifactId: request.frozenHandoffArtifactId,
    frozenHandoffName: request.frozenHandoffName,
    frozenEnvelopeDigest: request.frozenEnvelopeDigest,
    frozenEnvelopeByteCount: String(request.frozenEnvelopeByteCount),
    requestedArtifactRetentionDays: request.requestedArtifactRetentionDays,
    effectiveArtifactExpiresAt: request.effectiveArtifactExpiresAt,
    maximumReportRequestByteCount: String(1048576),
    lockDigest: request.lockDigest,
    rebuildRecord,
    publisher: request.publisher,
    adapter: request.adapter,
    destination,
    destinationMutationAuthority: {
      authorityId: ids.authorityId,
      operationId: seed.operationId,
      attemptId: ids.attemptId,
      proposedGenerationId: ids.generationId,
      destination,
      // The fence key is this side's own `destinationMutationKey` digest
      // over the retained binding's key material (DEC-097 lines
      // 3295-3317), a different domain from `targetDigest`; never the
      // request's digest.
      destinationMutationKeyDigest: derivedDestination.mutationKeyDigest,
      profile: 'gala-destination-mutation-authority-v2',
      mode: 'normal',
      epoch: '1',
      expiresAt: instant(later),
      ...(ids.expectedGenerationId === undefined
        ? {}
        : { expectedGenerationId: ids.expectedGenerationId }),
    },
    ...(ids.expectedGenerationId === undefined
      ? {}
      : { expectedGenerationId: ids.expectedGenerationId }),
    proposedGenerationId: ids.generationId,
    capabilityDecisionDigest: capabilityDecision.decisionDigest,
    policyReleaseId: seed.policyReleaseId,
    policyProfile: 'gala-managed-deployment-v2',
    policyVersion: '2.0.0',
    approvedOverrides: [],
    policyDecisionDigest: filler,
    networkBoundaryProfileDigest: filler,
    publicTlsProfileDigest: filler,
    publicTlsTrustStoreDigest: filler,
    publicTlsRevocationSetDigest: filler,
    // Fixture-only stand-in for the `GALA-VERIFIED-WORKLOAD-BINDING-V2`
    // digest over the 23-member retained binding: a digest over the ids
    // the URN below carries plus the bound ref, so a test can see it
    // change when the binding does.
    workloadBindingDigest: digestOf(
      `gala-fixture-verified-workload-binding\u0000${ids.binding.repositoryId}|${ids.binding.runId}|${ids.binding.runAttempt}|refs/heads/gala/publish/${seed.operationId}|${seed.repository}`,
    ),
    activationDetectionProfile: 'gala-public-activation-detection-v2',
    activationDetectionPlanDigest: filler,
    maximumActivationDetectionAttempts: 91,
    activationDetectionIntervalSeconds: 60,
    verificationTier: 'complete',
    verificationOrigins: [new URL(String(destination.baseUrl)).origin],
    verificationPlanDigest: filler,
    maximumPublicVerificationSeconds: 900,
    verificationDeadlineLimit: instant(later),
    maximumFinalizationDelaySeconds: 300,
    finalizationDeadlineLimit: instant(later),
    marker: {
      schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
      schemaVersion: '2.0.0',
      artifactId: ids.artifactId,
      artifactDigest: request.artifactDigest,
      generationId: ids.generationId,
    },
    issuer: seed.galaIssuer,
    // DEC-097 lines 3258-3260: Gala's stable workload URN from the
    // immutable verified claims, never GitHub's rename-sensitive `sub`.
    subject: `urn:gala:workload:github:${ids.binding.repositoryId}:${ids.binding.runId}:${ids.binding.runAttempt}`,
    audience: 'urn:gala:deployment-kernel:v2',
    capability: 'deploy',
    authorizedAt: instant(now),
    expiresAt: instant(later),
    operationDeadline: instant(later),
  };
  // Server-derived, never echoed: the retained intent carries the API's own
  // derivation whether or not the request sent one (LOCAL-55 (1)/LOCAL-57).
  if (ids.pagesBuildVersion !== undefined) {
    intent.pagesBuildVersion = ids.pagesBuildVersion;
  }
  if (ids.spacesStagePrefix !== undefined) {
    intent.spacesStagePrefix = ids.spacesStagePrefix;
  }
  intent.intentDigest = digestOf(JSON.stringify(intent));
  return intent;
}

/**
 * The seed every Gala-owned derivation reads from (LOCAL-60): the policy
 * release and package release catalog (fixed fixture values unless the
 * caller seeds its own) and the per-adapter admission row (the API's
 * release 0045 row unless the caller seeds another).
 *
 * @param {Record<string, any>} seedOptions the caller's seed
 * @returns {Record<string, any>} the complete seed
 */
export function seedWithDefaults(seedOptions) {
  return {
    galaIssuer: 'https://api.gala.example/',
    workflowRepository: 'rathnasgala2/publish',
    organizationId: '019c0000-0000-7000-8000-0000000000aa',
    policyReleaseId: '019c0000-0000-7000-8000-0000000000bb',
    packageReleaseCatalogDigest: `sha256:${'c'.repeat(64)}`,
    // The admission row per adapter defaults to the API's admitted row for
    // the requested package version (releases 0045/0046,
    // `capability-decision.mjs`); a test may seed another version or bounds
    // to prove the refusals.
    admission: {},
    ...seedOptions,
  };
}

/**
 * Start the loopback Gala stand-in.
 *
 * @param {{
 *   issuer: string,
 *   jwksUri: string,
 *   galaIssuer?: string,
 *   repository: string,
 *   repositoryId: string,
 *   repositoryOwnerId: string,
 *   workflowRepository?: string,
 *   operationId: string,
 *   organizationId?: string,
 *   policyReleaseId?: string,
 *   packageReleaseCatalogDigest?: string,
 *   admission?: Record<string, import('../../scripts/workflow/capability-decision.mjs').AdmissionRow>,
 *   destination?: {adapterId: 'do-spaces', spaces: {region: string, servedBucket: string, stagingBucket: string, basePath: string}}
 * }} seedOptions the bound repository and operation this fixture knows,
 *   plus (LOCAL-63 C2) the publication_destination-equivalent record a
 *   do-spaces request is admitted against; absent for `github-pages` and
 *   `local-directory`, which derive their destination from the seeded
 *   repository and the request itself
 * @returns {Promise<{origin: string, state: Record<string, any>, close: () => Promise<void>}>}
 *   the running fixture
 */
export async function startFakeGalaApi(seedOptions) {
  const seed = seedWithDefaults(seedOptions);
  /** @type {Record<string, any>} */
  const state = {
    seenJti: new Set(),
    intent: null,
    intentTuple: null,
    reportChallengeId: null,
    reportChallengeExpiresAt: null,
    capabilities: new Map(),
    capabilityGeneration: 0,
    submissionRecorded: false,
    fenceEpoch: 1,
    receivedSubmissions: [],
    // Test levers, all off by default.
    fenceMoved: false,
    // Answer as a 2.7.x server: no `kind` on any exchange response.
    omitKind: false,
    // The generation Gala believes the destination is serving, rendered as
    // the intent's (and the authority's) `expectedGenerationId`; `null` is
    // DEC-097's first publish, where the member is absent.
    expectedGenerationId: null,
    // Answer as a server that does not retain `destination.providerBinding`
    // (pre-API-CONSUME-2.8): the retained intent omits the member.
    omitProviderBinding: false,
  };

  /**
   * Stamp the 2.8.0 `kind` discriminator onto one exchange response unless
   * the fixture is emulating a 2.7.x server.
   *
   * @param {string} kind the constant kind
   * @param {Record<string, unknown>} body the response entity
   * @returns {Record<string, unknown>} the entity
   */
  function kinded(kind, body) {
    return state.omitKind ? body : { kind, ...body };
  }

  /**
   * @param {import('node:http').ServerResponse} response the response
   * @param {keyof typeof PROBLEMS} category the refusal category
   * @param {string | null} [pointer] the refused member's pointer
   * @returns {void}
   */
  function problem(response, category, pointer = null) {
    const mapped = PROBLEMS[category];
    response.writeHead(mapped.status, {
      'content-type': 'application/problem+json',
      'cache-control': 'no-store',
    });
    response.end(
      JSON.stringify({
        schemaId: 'urn:gala:schema:problem:2.0.0',
        schemaVersion: '2.0.0',
        code: mapped.code,
        status: mapped.status,
        title: mapped.code,
        detail: 'See the operation contract.',
        correlationId: randomUUID(),
        retryable: mapped.status === 429,
        // A field refusal names the member by body-relative pointer and
        // never echoes the refused value.
        errors: pointer === null ? [] : [{ pointer, code: mapped.code }],
      }),
    );
  }

  /**
   * Read the request body under the API's own hard cap.
   *
   * @param {import('node:http').IncomingMessage} request the request
   * @returns {Promise<Buffer>} the bytes
   */
  async function readBody(request) {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
      total += chunk.length;
      chunks.push(chunk);
      if (total >= MAXIMUM_BODY_BYTES) {
        break;
      }
    }
    return Buffer.concat(chunks);
  }

  /**
   * @param {import('node:http').IncomingMessage} request the request
   * @returns {void}
   */
  function requireJson(request) {
    const contentType = String(request.headers['content-type'] ?? '');
    if (!contentType.toLowerCase().startsWith('application/json')) {
      throw new Refused('UNSUPPORTED_MEDIA_TYPE');
    }
  }

  /**
   * Translate one client-side contract refusal into the API's own category.
   *
   * @param {unknown} failure the thrown value
   * @returns {never} never returns
   */
  function asContractRefusal(failure) {
    if (failure instanceof WorkloadContractError) {
      if (failure.code === 'REQUEST_FIELD_UNKNOWN') {
        throw new Refused('REQUEST_FIELD_UNKNOWN');
      }
      if (failure.code === 'VERIFICATION_EVIDENCE_LIMIT_EXCEEDED') {
        throw new Refused('VERIFICATION_EVIDENCE_LIMIT_EXCEEDED');
      }
      throw new Refused('VALIDATION_FAILED', failure.pointer);
    }
    throw failure;
  }

  /**
   * @param {import('node:http').IncomingMessage} request the request
   * @param {import('node:http').ServerResponse} response the response
   * @returns {Promise<void>} resolves once answered
   */
  async function handleExchange(request, response) {
    requireJson(request);
    const authorization = String(request.headers.authorization ?? '');
    if (!authorization.startsWith('Bearer ')) {
      throw new Refused('BINDING_INVALID');
    }
    const body = await readBody(request);
    if (body.length >= MAXIMUM_BODY_BYTES) {
      throw new Refused('REQUEST_TOO_LARGE');
    }
    /** @type {Record<string, any>} */
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      throw new Refused('VALIDATION_FAILED');
    }
    const purpose = parsed.purpose;
    if (purpose !== 'deployment-intent' && purpose !== 'deployment-receipt') {
      throw new Refused('VALIDATION_FAILED');
    }
    const claims = await verifyAssertion(
      authorization.slice('Bearer '.length).trim(),
      { jwksUri: seed.jwksUri },
    );
    const binding = bindClaims(claims, purpose, seed);
    try {
      validateExchangeRequest(parsed);
    } catch (failure) {
      asContractRefusal(failure);
    }
    if (state.seenJti.has(binding.jti)) {
      throw new Refused('REPLAYED');
    }
    state.seenJti.add(binding.jti);

    if (purpose === 'deployment-intent') {
      const derived = deriveIdentities(parsed, binding);
      if (state.intent !== null) {
        if (state.intentTuple !== binding.tupleDigest) {
          throw new Refused('BINDING_INVALID');
        }
      } else {
        state.intent = renderIntent(parsed, seed, {
          intentId: stableId(),
          ...derived,
          authorityId: stableId(),
          binding: {
            repositoryId: binding.repositoryId,
            runId: binding.runId,
            runAttempt: binding.runAttempt,
          },
          ...(state.expectedGenerationId === null
            ? {}
            : { expectedGenerationId: String(state.expectedGenerationId) }),
          omitProviderBinding: state.omitProviderBinding === true,
        });
        state.intentTuple = binding.tupleDigest;
        state.reportChallengeId = stableId();
        state.reportChallengeExpiresAt = instant(
          new Date(Date.now() + 4200000),
        );
      }
      answer(
        response,
        200,
        kinded('deployment-intent', {
          purpose: 'deployment-intent',
          deploymentIntent: state.intent,
          reportChallengeId: state.reportChallengeId,
          reportChallengeExpiresAt: state.reportChallengeExpiresAt,
        }),
      );
      return;
    }

    if (state.intent === null) {
      throw new Refused('SOURCE_STATE_INVALID');
    }
    if (
      parsed.operationId !== state.intent.operationId ||
      parsed.attemptId !== state.intent.attemptId ||
      parsed.intentDigest !== state.intent.intentDigest ||
      parsed.reportChallengeId !== state.reportChallengeId
    ) {
      throw new Refused('SOURCE_STATE_INVALID');
    }
    if (state.submissionRecorded) {
      answer(
        response,
        200,
        kinded('deployment-receipt-submission-recorded', {
          purpose: 'deployment-receipt',
          state: 'submission-recorded',
          operationId: state.intent.operationId,
          statusUrl: `/v2/organizations/${seed.organizationId}/operations/${state.intent.operationId}`,
        }),
      );
      return;
    }
    if (state.capabilityGeneration >= 20) {
      throw new Refused('RATE_LIMITED');
    }
    state.capabilityGeneration += 1;
    // A new generation supersedes the previous one, so only one capability
    // is ever `active`.
    for (const record of state.capabilities.values()) {
      if (record.status === 'active') {
        record.status = 'superseded';
      }
    }
    const capability = canonicalCapability();
    state.capabilities.set(capability, {
      status: 'active',
      generation: state.capabilityGeneration,
      expiresAt: Date.now() + 300000,
    });
    answer(
      response,
      200,
      kinded('deployment-receipt-capability-issued', {
        purpose: 'deployment-receipt',
        state: 'capability-issued',
        capabilityGeneration: state.capabilityGeneration,
        reportingCapability: capability,
        reportingCapabilityExpiresAt: instant(new Date(Date.now() + 300000)),
      }),
    );
  }

  /**
   * @param {import('node:http').IncomingMessage} request the request
   * @param {import('node:http').ServerResponse} response the response
   * @returns {Promise<void>} resolves once answered
   */
  async function handleReceipt(request, response) {
    // Consume before body: the capability is the only pre-consumption gate,
    // and the generation is committed `active -> consumed` before a media
    // type is examined or a byte is read.
    const authorization = String(request.headers.authorization ?? '');
    if (!authorization.startsWith('Gala-Receipt ')) {
      throw new Refused('REPORTING_CAPABILITY_INVALID');
    }
    const presented = authorization.slice('Gala-Receipt '.length).trim();
    const record = state.capabilities.get(presented);
    if (
      record === undefined ||
      record.status !== 'active' ||
      record.expiresAt <= Date.now() ||
      state.fenceMoved
    ) {
      throw new Refused('REPORTING_CAPABILITY_INVALID');
    }
    record.status = 'consumed-pending-validation';

    try {
      requireJson(request);
      const body = await readBody(request);
      const intentBound = Number(state.intent.maximumReportRequestByteCount);
      if (body.length >= MAXIMUM_BODY_BYTES || body.length > intentBound) {
        throw new Refused('REQUEST_TOO_LARGE');
      }
      /** @type {Record<string, any>} */
      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        throw new Refused('VALIDATION_FAILED');
      }
      try {
        validateReceiptSubmission(parsed);
      } catch (failure) {
        asContractRefusal(failure);
      }
      if (
        Buffer.byteLength(JSON.stringify(parsed.kernelJournal), 'utf8') >
        MAXIMUM_KERNEL_JOURNAL_BYTES
      ) {
        throw new Refused('REQUEST_TOO_LARGE');
      }
      assertAgreesWithIntent(parsed, state.intent);
      assertJournalIsWellFormed(parsed);

      record.status = 'consumed-recorded';
      state.submissionRecorded = true;
      state.receivedSubmissions.push(parsed);
      answer(response, 202, {
        operationId: state.intent.operationId,
        commandId: state.intent.operationId,
        phase: 'accepted',
        resourceVersion: 1,
        statusUrl: `/v2/organizations/${seed.organizationId}/operations/${state.intent.operationId}`,
        attempts: [],
        blockers: [],
        recoveryActions: [],
        managedReceiptSnapshotCount: 0,
        managedReceiptSnapshots: [],
        activationDetectionObservationCount: 0,
        activationDetectionPlanDigest:
          state.intent.activationDetectionPlanDigest,
      });
    } catch (failure) {
      // Every failure after consumption commits the permanent tombstone;
      // no path ever restores `active`.
      record.status = 'consumed-without-accepted-metadata';
      throw failure;
    }
  }

  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== 'POST') {
          response.writeHead(405).end();
          return;
        }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/v2/workloads/github/receipt-exchanges') {
          await handleExchange(request, response);
          return;
        }
        if (url.pathname === '/v2/workloads/deployment-receipts') {
          await handleReceipt(request, response);
          return;
        }
        response.writeHead(404).end();
      } catch (failure) {
        if (failure instanceof Refused) {
          problem(
            response,
            /** @type {keyof typeof PROBLEMS} */ (failure.category),
            failure.pointer,
          );
          return;
        }
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code: 'INTERNAL' }));
      }
    })();
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (
    server.address()
  );
  return {
    origin: `http://127.0.0.1:${address.port}`,
    state,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
      }),
  };
}

/**
 * @param {import('node:http').ServerResponse} response the response
 * @param {number} status the status code
 * @param {Record<string, unknown>} body the entity
 * @returns {void}
 */
function answer(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-correlation-id': randomUUID(),
  });
  response.end(JSON.stringify(body));
}

/**
 * @returns {string} one fresh UUIDv7-shaped `stableId`
 */
export function stableId() {
  const hex = randomBytes(16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `7${hex.slice(13, 16)}`,
    `${'89ab'.charAt(Number.parseInt(hex.slice(16, 17), 16) & 0b11)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Exactly 32 random bytes in canonical unpadded base64url. The final
 * character is drawn from the restricted alphabet the contract requires, so
 * the two zero padding bits hold and the token is its own canonical form.
 *
 * @returns {string} the capability
 */
export function canonicalCapability() {
  return randomBytes(32)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

/**
 * Compare the submission against the retained intent: operation, source
 * commit, artifact manifest/byte/file counts, provenance, SBOM and adapter
 * identity must all agree with what was authorized.
 *
 * @param {Record<string, any>} submission the submission
 * @param {Record<string, any>} intent the retained intent
 * @returns {void}
 */
function assertAgreesWithIntent(submission, intent) {
  const disagreements = [
    submission.operationId !== intent.operationId,
    submission.sourceCommit !== intent.sourceCommit,
    submission.artifactManifestDigest !== intent.manifestDigest,
    String(submission.artifactByteCount) !== String(intent.artifactByteCount),
    String(submission.artifactFileCount) !== String(intent.artifactFileCount),
    submission.provenanceDigest !== intent.provenanceDigest,
    submission.sbomDigest !== intent.sbomDigest,
    submission.adapterId !== intent.adapter.adapterId,
    submission.adapterVersion !== intent.adapter.adapterVersion,
  ];
  if (disagreements.some(Boolean)) {
    throw new Refused('SOURCE_STATE_INVALID');
  }
}

/**
 * The journal's own bounds: gap-free per-stream kernel sequences, every
 * observation witnessing one of the journal's own stage attempts, every
 * timestamp inside `[workflowStartedAt, workflowCompletedAt]`, and that
 * cutoff never in the server's future.
 *
 * @param {Record<string, any>} submission the submission
 * @returns {void}
 */
function assertJournalIsWellFormed(submission) {
  const journal = submission.kernelJournal;
  for (const stream of ['attempts', 'observations']) {
    const sequences = journal[stream].map(
      (/** @type {any} */ entry) => entry.kernelSequence,
    );
    for (const [index, sequence] of sequences.entries()) {
      if (sequence !== index + 1) {
        throw new Refused('VALIDATION_FAILED');
      }
    }
  }
  const attemptIds = new Set(
    journal.attempts.map((/** @type {any} */ entry) => entry.stageAttemptId),
  );
  for (const observation of journal.observations) {
    if (!attemptIds.has(observation.stageAttemptId)) {
      throw new Refused('VALIDATION_FAILED');
    }
  }
  const from = Date.parse(submission.workflowStartedAt);
  const until = Date.parse(submission.workflowCompletedAt);
  if (!(from <= until) || until > Date.now() + 1000) {
    throw new Refused('VALIDATION_FAILED');
  }
  for (const entry of [...journal.attempts, ...journal.observations]) {
    for (const name of ['startedAt', 'completedAt', 'observedAt']) {
      if (entry[name] === undefined) {
        continue;
      }
      const at = Date.parse(entry[name]);
      if (at < from || at > until) {
        throw new Refused('VALIDATION_FAILED');
      }
    }
  }
}
