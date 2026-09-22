/**
 * The two workload request bodies, closed exactly as the 2.9.0 contract
 * declares them, plus the client-side validator every caller runs *before*
 * a byte reaches the network.
 *
 * Since 2.9.0 (LOCAL-60, DEC-097 section 7) the intent request carries only
 * what the workflow can honestly hold: the request-side destination
 * (`environment` and `targetDigest` api-derived; `providerBinding` admitted
 * per adapter), the request-side rebuild record (its four Gala-owned
 * members api-derived) and an optional `capabilityDecisionDigest`. The
 * retained `deployment-intent` document is unchanged apart from the closed
 * `destination.environment` vocabulary, so this module keeps both shapes:
 * `checkRequestDestination` for what is sent, `checkDestination` for what
 * the API retains and every later job binds to.
 *
 * Why this module exists rather than an ajv run over the shipped OpenAPI
 * document: `@rathnasgala2/schemas` exports an executable validator only for
 * the `urn:gala:schema:*` documents, and the two workload request bodies are
 * OpenAPI component schemas, not Gala documents — there is no
 * `validateGalaDocument` identity for either. Rather than reach past the
 * package's own entry point for its transitive `ajv`, the rules are written
 * here once, and `test/workload-contract.test.mjs` proves — against the
 * pinned `@rathnasgala2/schemas/openapi/openapi.yaml` itself — that the
 * declared field sets, required sets and bounds in this file are exactly the
 * contract's. Drift in either direction fails the build.
 *
 * The refusal codes are the API's own wire vocabulary (`VALIDATION_FAILED`,
 * `REQUEST_FIELD_UNKNOWN`, `VERIFICATION_EVIDENCE_LIMIT_EXCEEDED`), so a body
 * this module refuses is a body the API would have refused with the same
 * code — the workflow simply learns it one network round trip earlier, and
 * never spends a single-use OIDC assertion on a request that could not have
 * been accepted.
 *
 * @module
 */

/** The hard transport ceiling both routes apply, in bytes (DEC-086/DEC-097). */
export const MAXIMUM_REQUEST_BYTES = 1048576;

/** The exact kernel-journal ceiling, in bytes. */
export const MAXIMUM_KERNEL_JOURNAL_BYTES = 524288;

/** `verificationSubmission.verificationEntries` maximum length. */
export const MAXIMUM_VERIFICATION_ENTRIES = 900;

/** `observedRoutes` maximum length. */
export const MAXIMUM_OBSERVED_ROUTES = 16;

/** Per-stream `kernelJournal` maximum length. */
export const MAXIMUM_JOURNAL_ENTRIES_PER_STREAM = 100;

/** `sha256:` followed by 64 lowercase hex characters. */
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/** A tagged git object id: `sha1:` + 40 hex, or `sha256:` + 64 hex. */
export const COMMIT_OID_PATTERN =
  /^(?:sha1:[0-9a-f]{40}|sha256:[0-9a-f]{64})$/u;

/** A GitHub-side positive uint64 rendered as decimal text. */
export const PROVIDER_NUMERIC_ID_PATTERN = /^[1-9][0-9]{0,19}$/u;

/** A UUIDv7 `stableId`. */
export const STABLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** rfc3339 with exactly three fractional digits and a literal `Z`. */
export const INSTANT_PATTERN =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;

/** Canonical SemVer 2.0.0 without build metadata. */
export const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/u;

/** An npm package name. */
export const PACKAGE_NAME_PATTERN =
  /^(?:[a-z0-9][a-z0-9._-]*|@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)$/u;

/** An absolute HTTPS URL with no embedded credentials. */
export const HTTPS_URL_PATTERN = /^https:\/\/(?![^/?#]*@)/u;

/** An absolute normalized route with no query or fragment. */
export const CANONICAL_ROUTE_PATTERN = /^\/(?!\/)(?!.*\/\/)(?!.*[?#]).*$/u;

/** The exact 40 lowercase hex characters of an intent's `pagesBuildVersion`. */
export const PAGES_BUILD_VERSION_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * A reporting capability: 32 random bytes in canonical unpadded base64url.
 * The restricted final character is the contract's own enforcement of the
 * two zero padding bits, so a non-canonical alias is refused before it is
 * ever presented.
 */
export const REPORTING_CAPABILITY_PATTERN =
  /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;

/** A GitHub owner login (`destination.providerBinding.owner`). */
export const GITHUB_OWNER_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;

/** A GitHub repository name (`destination.providerBinding.repository`). */
export const GITHUB_REPOSITORY_NAME_PATTERN =
  /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/u;

/** A DigitalOcean Spaces region slug (`destination.providerBinding.region`). */
export const SPACES_REGION_PATTERN = /^[a-z]{3}[1-9][0-9]?$/u;

/** A DigitalOcean Spaces bucket name (`servedBucket`, `stagingBucket`). */
export const SPACES_BUCKET_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;

/** The only `publisher.package`/`publisherPackage` the contract admits. */
export const PUBLISHER_PACKAGE = '@rathnasgala2/publish-action';

/** The closed adapter vocabulary both routes admit. */
export const ADMITTED_ADAPTER_IDS = Object.freeze([
  'local-directory',
  'github-pages',
  'do-spaces',
]);

/** `deployment-intent` exchange arm: every declared member. */
export const INTENT_FIELDS = Object.freeze([
  'purpose',
  'sourceCommit',
  'workflowTriggerCommit',
  'artifactId',
  'artifactDigest',
  'manifestDigest',
  'provenanceDigest',
  'sbomDigest',
  'frozenHandoffArtifactId',
  'frozenHandoffName',
  'frozenEnvelopeDigest',
  'frozenEnvelopeByteCount',
  'artifactByteCount',
  'artifactFileCount',
  'requestedArtifactRetentionDays',
  'effectiveArtifactExpiresAt',
  'verificationSubmission',
  'lockDigest',
  'rebuildRecord',
  'publisher',
  'adapter',
  'destination',
  'pagesBuildVersion',
  'spacesStagePrefix',
  'capabilityDecisionDigest',
]);

/**
 * `deployment-intent` exchange arm: the members that are never optional.
 * `pagesBuildVersion` and `spacesStagePrefix` are optional since 2.8.0
 * (LOCAL-57), and `capabilityDecisionDigest` since 2.9.0 (LOCAL-60): the
 * API derives each from what it owns and refuses a sent value that
 * disagrees with `422 VALIDATION_FAILED`.
 */
export const INTENT_REQUIRED = Object.freeze(
  INTENT_FIELDS.filter(
    (name) =>
      name !== 'pagesBuildVersion' &&
      name !== 'spacesStagePrefix' &&
      name !== 'capabilityDecisionDigest',
  ),
);

/**
 * `destination.environment` is one constant per adapter (schema 2.9.0,
 * LOCAL-60a): the API renders it, and every retained destination carries
 * exactly its adapter's constant.
 */
export const ADAPTER_ENVIRONMENTS = Object.freeze({
  'github-pages': 'github-pages',
  'do-spaces': 'do-spaces',
  'local-directory': 'local-directory',
});

/**
 * `destination` declared members: the closed retained `destinationIdentity`
 * and the request-side `ReceiptExchangeIntentRequestDestination` declare
 * the same six.
 */
export const DESTINATION_FIELDS = Object.freeze([
  'environment',
  'adapterId',
  'adapterVersion',
  'targetDigest',
  'baseUrl',
  'providerBinding',
]);

/** Retained `destinationIdentity` members that are never optional. */
export const DESTINATION_REQUIRED = Object.freeze(
  DESTINATION_FIELDS.filter((name) => name !== 'providerBinding'),
);

/**
 * Request-side destination members that are never optional (2.9.0): the
 * lock-derived adapter and the publication's canonical base. `environment`
 * and `targetDigest` are api-derived and optional on the request.
 */
export const REQUEST_DESTINATION_REQUIRED = Object.freeze([
  'adapterId',
  'adapterVersion',
  'baseUrl',
]);

/**
 * The closed retained `destination.providerBinding` member set each adapter
 * admits (LOCAL-55 (2)); `local-directory` admits no provider binding at
 * all.
 */
export const PROVIDER_BINDING_FIELDS = Object.freeze({
  'github-pages': Object.freeze(['owner', 'repository']),
  'do-spaces': Object.freeze(['region', 'servedBucket', 'stagingBucket']),
  'local-directory': Object.freeze([]),
});

/**
 * The request-side `providerBinding` member set each adapter admits (2.9.0,
 * `ReceiptExchangeIntentRequestProviderBinding`): the runner-bound
 * repository coordinates for `github-pages`, the two DEC-097 section 7
 * local evidence digests for `local-directory`, and nothing for `do-spaces`
 * until the publication destination record exists (C2).
 */
export const REQUEST_PROVIDER_BINDING_FIELDS = Object.freeze({
  'github-pages': Object.freeze(['owner', 'repository']),
  'do-spaces': Object.freeze([]),
  'local-directory': Object.freeze([
    'rootIdentityDigest',
    'mutationSurfaceDigest',
  ]),
});

/** Every member the request-side `providerBinding` object declares. */
export const REQUEST_PROVIDER_BINDING_MEMBERS = Object.freeze([
  'mutationSurfaceDigest',
  'owner',
  'repository',
  'rootIdentityDigest',
]);

/** `deployment-receipt` exchange arm: every declared member, all required. */
export const RECEIPT_FIELDS = Object.freeze([
  'purpose',
  'operationId',
  'attemptId',
  'intentDigest',
  'reportChallengeId',
]);

/** The receipt submission's 21 declared members. */
export const SUBMISSION_FIELDS = Object.freeze([
  'operationId',
  'repositoryId',
  'sourceCommit',
  'runId',
  'runAttempt',
  'artifactManifestDigest',
  'artifactByteCount',
  'artifactFileCount',
  'provenanceDigest',
  'sbomDigest',
  'publisherPackage',
  'publisherVersion',
  'adapterId',
  'adapterVersion',
  'destinationGenerationId',
  'destinationReceiptDigest',
  'publicBaseUrl',
  'observedRoutes',
  'workflowStartedAt',
  'workflowCompletedAt',
  'kernelJournal',
]);

/** The 19 submission members that are never optional. */
export const SUBMISSION_REQUIRED = Object.freeze(
  SUBMISSION_FIELDS.filter(
    (name) =>
      name !== 'destinationGenerationId' && name !== 'destinationReceiptDigest',
  ),
);

/** `kernelJournal.attempts[]` declared members. */
export const ATTEMPT_FIELDS = Object.freeze([
  'stageAttemptId',
  'causationId',
  'stage',
  'kernelSequence',
  'outcome',
  'destinationChanged',
  'inputDigest',
  'retryable',
  'evidenceDigest',
  'resultDigest',
  'failureCode',
  'startedAt',
  'completedAt',
]);

/** `kernelJournal.attempts[]` members that are never optional. */
export const ATTEMPT_REQUIRED = Object.freeze([
  'stageAttemptId',
  'causationId',
  'stage',
  'kernelSequence',
  'outcome',
  'destinationChanged',
  'inputDigest',
  'retryable',
  'evidenceDigest',
]);

/** `kernelJournal.observations[]` declared members. */
export const OBSERVATION_FIELDS = Object.freeze([
  'observationId',
  'stageAttemptId',
  'kernelSequence',
  'observationClass',
  'outcome',
  'destinationChanged',
  'observedAt',
  'evidenceDigest',
  'generationId',
  'observedArtifactDigest',
  'providerObjectIdDigest',
  'providerVersion',
]);

/** `kernelJournal.observations[]` members that are never optional. */
export const OBSERVATION_REQUIRED = Object.freeze([
  'observationId',
  'stageAttemptId',
  'kernelSequence',
  'observationClass',
  'outcome',
  'destinationChanged',
  'observedAt',
  'evidenceDigest',
]);

/** The closed `attempts[].stage` vocabulary. */
export const ADMITTED_STAGES = Object.freeze([
  'staging',
  'activation',
  'cleanup',
]);

/** The closed `attempts[].outcome` vocabulary. */
export const ADMITTED_ATTEMPT_OUTCOMES = Object.freeze([
  'succeeded',
  'failed',
  'skipped',
  'unknown',
]);

/** The closed `destinationChanged` vocabulary. */
export const ADMITTED_DESTINATION_CHANGED = Object.freeze([
  'yes',
  'no',
  'unknown',
]);

/** The closed `attempts[].failureCode` vocabulary. */
export const ADMITTED_FAILURE_CODES = Object.freeze([
  'TARGET_CAPABILITY_UNAVAILABLE',
  'ATOMIC_ACTIVATION_UNSUPPORTED',
  'REJECTED',
  'NOT_ATTEMPTED_RETRYABLE',
  'AUTHORIZATION_LOST',
  'RATE_LIMITED',
  'PROVIDER_CONTRACT_VIOLATION',
  'OUTCOME_UNKNOWN_RECONCILING',
  'PUBLIC_VERIFICATION_INCONCLUSIVE',
  'PUBLIC_INTEGRITY_MISMATCH',
]);

/** The closed `observations[].observationClass` vocabulary. */
export const ADMITTED_OBSERVATION_CLASSES = Object.freeze([
  'request-not-started',
  'request-accepted',
  'provider-state',
  'timeout',
  'provider-error',
]);

/** The closed `observations[].outcome` vocabulary. */
export const ADMITTED_OBSERVATION_OUTCOMES = Object.freeze([
  'succeeded',
  'rejected',
  'not-attempted-retryable',
  'outcome-unknown-reconciling',
  'authorization-lost',
  'rate-limited',
  'provider-contract-violation',
]);

/** The closed `verificationEntries[].routeClass` vocabulary. */
export const ADMITTED_ROUTE_CLASSES = Object.freeze([
  'html',
  'feed',
  'sitemap',
  'asset',
  'error',
]);

/** The closed unfit `verificationSubmission.reason` vocabulary. */
export const ADMITTED_UNFIT_REASONS = Object.freeze([
  'entry-count-exceeded',
  'encoded-request-limit-exceeded',
]);

/** `verificationEntries[]` declared members, all required. */
export const VERIFICATION_ENTRY_FIELDS = Object.freeze([
  'path',
  'publicRoute',
  'routeClass',
  'expectedContentType',
  'byteLength',
  'expectedCandidateDigest',
]);

/** `observedRoutes[]` declared members. */
export const OBSERVED_ROUTE_FIELDS = Object.freeze([
  'route',
  'expectedDigest',
  'observedDigest',
  'observedStatus',
]);

/** `observedRoutes[]` members that are never optional. */
export const OBSERVED_ROUTE_REQUIRED = Object.freeze([
  'route',
  'expectedDigest',
]);

/** `rebuildRecord` declared members (the retained record's 21). */
export const REBUILD_RECORD_FIELDS = Object.freeze([
  'contractVersion',
  'repositoryId',
  'sourceCommit',
  'sourceTree',
  'repositoryRootDigest',
  'buildEpoch',
  'buildInputDigest',
  'dependencyLockDigest',
  'packageReleaseCatalogDigest',
  'destinationCapabilityDigest',
  'stylingContractDigest',
  'buildPolicyDecisionDigest',
  'policyReleaseId',
  'workflowIdentity',
  'baseUrl',
  'basePath',
  'builder',
  'schemas',
  'template',
  'theme',
  'renderPolicy',
]);

/**
 * The four `rebuildRecord` members the API derives (2.9.0, LOCAL-60; DEC-097
 * lines 2355-2369): the accepted policy release and build-policy decision,
 * the server-selected package release catalog and the owning validated
 * destination record. Optional on the request, required in the retained
 * record; a present value that disagrees is `422 VALIDATION_FAILED`.
 */
export const REBUILD_RECORD_API_DERIVED = Object.freeze([
  'policyReleaseId',
  'buildPolicyDecisionDigest',
  'packageReleaseCatalogDigest',
  'destinationCapabilityDigest',
]);

/** The request-side `rebuildRecord` members that are never optional. */
export const REBUILD_RECORD_REQUIRED = Object.freeze(
  REBUILD_RECORD_FIELDS.filter(
    (name) => !REBUILD_RECORD_API_DERIVED.includes(name),
  ),
);

/** The closed `rebuildRecord.theme.package` vocabulary. */
export const ADMITTED_THEME_PACKAGES = Object.freeze([
  '@rathnasgala2/theme-default',
  '@rathnasgala2/theme-amaze',
  '@rathnasgala2/theme-flashy',
  '@rathnasgala2/theme-minimal',
  '@rathnasgala2/theme-zebra',
]);

/**
 * A refusal raised before the request is sent. It carries the API's own wire
 * code plus a structural pointer, and never the rejected value — which can
 * be a digest, a path or anything else the job must not echo.
 */
export class WorkloadContractError extends Error {
  /**
   * @param {string} code the wire refusal code
   * @param {string} pointer the structural pointer into the request
   */
  constructor(code, pointer) {
    super(`${code}: ${pointer === '' ? '/' : pointer}`);
    this.name = 'WorkloadContractError';
    /** @type {string} */
    this.code = code;
    /** @type {string} */
    this.pointer = pointer;
  }
}

/**
 * @param {string} pointer the structural pointer
 * @returns {never} never returns
 */
function invalid(pointer) {
  throw new WorkloadContractError('VALIDATION_FAILED', pointer);
}

/**
 * `additionalProperties: false`, answered as the contract's distinct code.
 *
 * @param {Record<string, unknown>} value the object to check
 * @param {readonly string[]} declared the declared member names
 * @param {string} pointer the object's pointer
 * @returns {void}
 */
function requireNoUnknownFields(value, declared, pointer) {
  for (const name of Object.keys(value)) {
    if (!declared.includes(name)) {
      throw new WorkloadContractError(
        'REQUEST_FIELD_UNKNOWN',
        `${pointer}/${name}`,
      );
    }
  }
}

/**
 * @param {unknown} value the candidate
 * @param {string} pointer the pointer
 * @returns {Record<string, unknown>} the object
 */
function requireObject(value, pointer) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(pointer);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {Record<string, unknown>} parent the parent object
 * @param {string} name the member name
 * @param {RegExp} pattern the exact pattern
 * @param {string} pointer the parent pointer
 * @returns {string} the matched text
 */
function requireMatch(parent, name, pattern, pointer) {
  const value = parent[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    invalid(`${pointer}/${name}`);
  }
  return /** @type {string} */ (value);
}

/**
 * @param {Record<string, unknown>} parent the parent object
 * @param {string} name the member name
 * @param {RegExp} pattern the exact pattern
 * @param {string} pointer the parent pointer
 * @returns {void}
 */
function optionalMatch(parent, name, pattern, pointer) {
  if (parent[name] !== undefined) {
    requireMatch(parent, name, pattern, pointer);
  }
}

/**
 * @param {Record<string, unknown>} parent the parent object
 * @param {string} name the member name
 * @param {number} minimum the inclusive minimum
 * @param {number} maximum the inclusive maximum
 * @param {string} pointer the parent pointer
 * @returns {number} the integer
 */
function requireInteger(parent, name, minimum, maximum, pointer) {
  const value = parent[name];
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(`${pointer}/${name}`);
  }
  return /** @type {number} */ (value);
}

/**
 * @param {Record<string, unknown>} parent the parent object
 * @param {string} name the member name
 * @param {readonly string[]} admitted the closed vocabulary
 * @param {string} pointer the parent pointer
 * @returns {string} the admitted value
 */
function requireEnum(parent, name, admitted, pointer) {
  const value = parent[name];
  if (typeof value !== 'string' || !admitted.includes(value)) {
    invalid(`${pointer}/${name}`);
  }
  return /** @type {string} */ (value);
}

/**
 * @param {Record<string, unknown>} parent the parent object
 * @param {string} name the member name
 * @param {number} minimum the inclusive minimum UTF-8 byte length
 * @param {number} maximum the inclusive maximum
 * @param {string} pointer the parent pointer
 * @returns {string} the bounded text
 */
function requireBoundedText(parent, name, minimum, maximum, pointer) {
  const value = parent[name];
  if (typeof value !== 'string') {
    invalid(`${pointer}/${name}`);
  }
  const bytes = Buffer.byteLength(/** @type {string} */ (value), 'utf8');
  if (bytes < minimum || bytes > maximum) {
    invalid(`${pointer}/${name}`);
  }
  return /** @type {string} */ (value);
}

/**
 * @param {Record<string, unknown>} parent the parent object
 * @param {readonly string[]} required the members that must be present
 * @param {string} pointer the parent pointer
 * @returns {void}
 */
function requirePresent(parent, required, pointer) {
  for (const name of required) {
    if (parent[name] === undefined) {
      invalid(`${pointer}/${name}`);
    }
  }
}

/**
 * Validate one `packageIdentity`, pinned to a closed package vocabulary.
 *
 * @param {unknown} value the candidate identity
 * @param {string} pointer the pointer
 * @param {readonly string[]} admittedPackages the closed package set
 * @returns {void}
 */
function checkPackageIdentity(value, pointer, admittedPackages) {
  const identity = requireObject(value, pointer);
  requireNoUnknownFields(
    identity,
    ['package', 'version', 'integrity', 'registry'],
    pointer,
  );
  requireMatch(identity, 'package', PACKAGE_NAME_PATTERN, pointer);
  requireEnum(identity, 'package', admittedPackages, pointer);
  requireMatch(identity, 'version', SEMVER_PATTERN, pointer);
  requireMatch(identity, 'integrity', DIGEST_PATTERN, pointer);
  requireMatch(identity, 'registry', HTTPS_URL_PATTERN, pointer);
}

/**
 * Validate the request-side `rebuildRecord`
 * (`ReceiptExchangeIntentRequestRebuildRecord`, 2.9.0): the retained
 * record's members by the same definitions, with the four API-derived
 * members optional.
 *
 * @param {unknown} value the candidate record
 * @param {string} pointer the pointer
 * @returns {void}
 */
export function checkRebuildRecord(value, pointer) {
  const record = requireObject(value, pointer);
  requireNoUnknownFields(record, REBUILD_RECORD_FIELDS, pointer);
  requirePresent(record, REBUILD_RECORD_REQUIRED, pointer);
  requireMatch(record, 'contractVersion', /^2\.0\.0$/u, pointer);
  requireMatch(record, 'repositoryId', PROVIDER_NUMERIC_ID_PATTERN, pointer);
  requireMatch(record, 'sourceCommit', COMMIT_OID_PATTERN, pointer);
  requireMatch(record, 'sourceTree', COMMIT_OID_PATTERN, pointer);
  requireMatch(record, 'buildEpoch', INSTANT_PATTERN, pointer);
  for (const name of [
    'repositoryRootDigest',
    'buildInputDigest',
    'dependencyLockDigest',
    'stylingContractDigest',
    'workflowIdentity',
  ]) {
    requireMatch(record, name, DIGEST_PATTERN, pointer);
  }
  for (const name of [
    'packageReleaseCatalogDigest',
    'destinationCapabilityDigest',
    'buildPolicyDecisionDigest',
  ]) {
    optionalMatch(record, name, DIGEST_PATTERN, pointer);
  }
  optionalMatch(record, 'policyReleaseId', STABLE_ID_PATTERN, pointer);
  requireMatch(record, 'baseUrl', HTTPS_URL_PATTERN, pointer);
  requireMatch(record, 'basePath', CANONICAL_ROUTE_PATTERN, pointer);
  checkPackageIdentity(record.builder, `${pointer}/builder`, [
    PUBLISHER_PACKAGE,
  ]);
  checkPackageIdentity(record.schemas, `${pointer}/schemas`, [
    '@rathnasgala2/schemas',
  ]);
  checkPackageIdentity(record.template, `${pointer}/template`, [
    '@rathnasgala2/template',
  ]);
  checkPackageIdentity(
    record.theme,
    `${pointer}/theme`,
    ADMITTED_THEME_PACKAGES,
  );
  const policyPointer = `${pointer}/renderPolicy`;
  const renderPolicy = requireObject(record.renderPolicy, policyPointer);
  requireNoUnknownFields(
    renderPolicy,
    ['name', 'version', 'digest'],
    policyPointer,
  );
  requireBoundedText(renderPolicy, 'name', 1, 80, policyPointer);
  requireMatch(renderPolicy, 'version', SEMVER_PATTERN, policyPointer);
  requireMatch(renderPolicy, 'digest', DIGEST_PATTERN, policyPointer);
}

/**
 * Validate the `verificationSubmission` union.
 *
 * @param {unknown} value the candidate submission
 * @param {string} pointer the pointer
 * @returns {void}
 */
function checkVerificationSubmission(value, pointer) {
  const submission = requireObject(value, pointer);
  if (submission.state === 'fit') {
    requireNoUnknownFields(
      submission,
      ['state', 'verificationEntries'],
      pointer,
    );
    if (!Array.isArray(submission.verificationEntries)) {
      invalid(`${pointer}/verificationEntries`);
    }
    const list = /** @type {unknown[]} */ (submission.verificationEntries);
    if (list.length < 1 || list.length > MAXIMUM_VERIFICATION_ENTRIES) {
      throw new WorkloadContractError(
        'VERIFICATION_EVIDENCE_LIMIT_EXCEEDED',
        `${pointer}/verificationEntries`,
      );
    }
    list.forEach((candidate, index) => {
      const at = `${pointer}/verificationEntries/${index}`;
      const entry = requireObject(candidate, at);
      requireNoUnknownFields(entry, VERIFICATION_ENTRY_FIELDS, at);
      requirePresent(entry, VERIFICATION_ENTRY_FIELDS, at);
      requireBoundedText(entry, 'path', 1, 512, at);
      requireMatch(entry, 'path', /^(?!\/)(?!.*\\).+$/u, at);
      requireMatch(entry, 'publicRoute', CANONICAL_ROUTE_PATTERN, at);
      requireEnum(entry, 'routeClass', ADMITTED_ROUTE_CLASSES, at);
      requireBoundedText(entry, 'expectedContentType', 3, 128, at);
      requireMatch(
        entry,
        'expectedContentType',
        /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}(?:; charset=utf-8)?$/u,
        at,
      );
      requireInteger(entry, 'byteLength', 0, Number.MAX_SAFE_INTEGER, at);
      requireMatch(entry, 'expectedCandidateDigest', DIGEST_PATTERN, at);
    });
    return;
  }
  if (submission.state !== 'unfit') {
    invalid(`${pointer}/state`);
  }
  requireNoUnknownFields(
    submission,
    [
      'state',
      'reason',
      'requiredVerificationEntryCount',
      'canonicalFitRequestByteCount',
    ],
    pointer,
  );
  requireEnum(submission, 'reason', ADMITTED_UNFIT_REASONS, pointer);
  requireInteger(
    submission,
    'requiredVerificationEntryCount',
    1,
    200000,
    pointer,
  );
  requireInteger(
    submission,
    'canonicalFitRequestByteCount',
    1,
    Number.MAX_SAFE_INTEGER,
    pointer,
  );
}

/**
 * Validate one `deployment-intent` exchange request.
 *
 * @param {Record<string, unknown>} body the request body
 * @returns {void}
 */
function checkAuthorizeDeployment(body) {
  requireNoUnknownFields(body, INTENT_FIELDS, '');
  requirePresent(body, INTENT_REQUIRED, '');
  requireMatch(body, 'sourceCommit', COMMIT_OID_PATTERN, '');
  requireMatch(body, 'workflowTriggerCommit', COMMIT_OID_PATTERN, '');
  requireMatch(body, 'artifactId', STABLE_ID_PATTERN, '');
  for (const name of [
    'artifactDigest',
    'manifestDigest',
    'provenanceDigest',
    'sbomDigest',
    'frozenEnvelopeDigest',
    'lockDigest',
  ]) {
    requireMatch(body, name, DIGEST_PATTERN, '');
  }
  // 2.9.0: the capability decision is server-owned (DEC-097 section 7); a
  // workflow that knows the digest may send it, one that does not omits it.
  optionalMatch(body, 'capabilityDecisionDigest', DIGEST_PATTERN, '');
  requireMatch(
    body,
    'frozenHandoffArtifactId',
    PROVIDER_NUMERIC_ID_PATTERN,
    '',
  );
  requireBoundedText(body, 'frozenHandoffName', 1, 80, '');
  for (const name of [
    'frozenEnvelopeByteCount',
    'artifactByteCount',
    'artifactFileCount',
  ]) {
    requireInteger(body, name, 1, Number.MAX_SAFE_INTEGER, '');
  }
  requireInteger(body, 'requestedArtifactRetentionDays', 1, 7, '');
  requireMatch(body, 'effectiveArtifactExpiresAt', INSTANT_PATTERN, '');
  checkVerificationSubmission(
    body.verificationSubmission,
    '/verificationSubmission',
  );
  checkRebuildRecord(body.rebuildRecord, '/rebuildRecord');
  checkPackageIdentity(body.publisher, '/publisher', [PUBLISHER_PACKAGE]);

  const adapter = requireObject(body.adapter, '/adapter');
  requireNoUnknownFields(
    adapter,
    ['adapterId', 'adapterVersion', 'adapterDigest'],
    '/adapter',
  );
  const adapterId = requireEnum(
    adapter,
    'adapterId',
    ADMITTED_ADAPTER_IDS,
    '/adapter',
  );
  requireMatch(adapter, 'adapterVersion', SEMVER_PATTERN, '/adapter');
  requireMatch(adapter, 'adapterDigest', DIGEST_PATTERN, '/adapter');

  checkRequestDestination(body.destination, '/destination');

  // The contract's three `if/then` branches (2.8.0, LOCAL-57): the
  // conditional member is *admitted* only for its own adapter and forbidden
  // for the other two. Neither is required any more: the API derives both
  // from the bound identity, so a workflow that cannot compute one omits it,
  // and one that can may send it and is refused with `422 VALIDATION_FAILED`
  // on a disagreement.
  if (adapterId === 'github-pages') {
    optionalMatch(body, 'pagesBuildVersion', PAGES_BUILD_VERSION_PATTERN, '');
    if (body.spacesStagePrefix !== undefined) {
      invalid('/spacesStagePrefix');
    }
    return;
  }
  if (adapterId === 'do-spaces') {
    if (body.spacesStagePrefix !== undefined) {
      requireBoundedText(body, 'spacesStagePrefix', 1, 512, '');
    }
    if (body.pagesBuildVersion !== undefined) {
      invalid('/pagesBuildVersion');
    }
    return;
  }
  if (body.pagesBuildVersion !== undefined) {
    invalid('/pagesBuildVersion');
  }
  if (body.spacesStagePrefix !== undefined) {
    invalid('/spacesStagePrefix');
  }
}

/**
 * Validate the request-side destination
 * (`ReceiptExchangeIntentRequestDestination`, 2.9.0): `adapterId`,
 * `adapterVersion` and `baseUrl` required; `environment` optional but, when
 * present, exactly the adapter's constant; `targetDigest` optional; and
 * `providerBinding` keyed on the adapter — `{owner, repository}` for
 * `github-pages`, `{rootIdentityDigest, mutationSurfaceDigest}` for
 * `local-directory`, forbidden for `do-spaces` (until C2).
 *
 * @param {unknown} value the candidate destination
 * @param {string} pointer the pointer
 * @returns {void}
 */
export function checkRequestDestination(value, pointer) {
  const destination = requireObject(value, pointer);
  requireNoUnknownFields(destination, DESTINATION_FIELDS, pointer);
  requirePresent(destination, REQUEST_DESTINATION_REQUIRED, pointer);
  const adapterId = requireEnum(
    destination,
    'adapterId',
    ADMITTED_ADAPTER_IDS,
    pointer,
  );
  requireMatch(destination, 'adapterVersion', SEMVER_PATTERN, pointer);
  requireBoundedText(destination, 'baseUrl', 1, 2048, pointer);
  requireMatch(destination, 'baseUrl', HTTPS_URL_PATTERN, pointer);
  if (
    destination.environment !== undefined &&
    destination.environment !==
      ADAPTER_ENVIRONMENTS[
        /** @type {keyof typeof ADAPTER_ENVIRONMENTS} */ (adapterId)
      ]
  ) {
    invalid(`${pointer}/environment`);
  }
  optionalMatch(destination, 'targetDigest', DIGEST_PATTERN, pointer);
  if (destination.providerBinding === undefined) {
    return;
  }
  const at = `${pointer}/providerBinding`;
  const admitted =
    REQUEST_PROVIDER_BINDING_FIELDS[
      /** @type {keyof typeof REQUEST_PROVIDER_BINDING_FIELDS} */ (adapterId)
    ];
  if (admitted.length === 0) {
    invalid(at);
  }
  const binding = requireObject(destination.providerBinding, at);
  requireNoUnknownFields(binding, admitted, at);
  requirePresent(binding, admitted, at);
  if (adapterId === 'github-pages') {
    requireMatch(binding, 'owner', GITHUB_OWNER_PATTERN, at);
    requireMatch(binding, 'repository', GITHUB_REPOSITORY_NAME_PATTERN, at);
    return;
  }
  requireMatch(binding, 'rootIdentityDigest', DIGEST_PATTERN, at);
  requireMatch(binding, 'mutationSurfaceDigest', DIGEST_PATTERN, at);
}

/**
 * Validate the closed retained `destinationIdentity`, including the
 * optional `providerBinding` the contract keys on the destination's own
 * `adapterId` (LOCAL-55 (2)): `{owner, repository}` for `github-pages`,
 * `{region, servedBucket, stagingBucket}` for `do-spaces`, and forbidden for
 * `local-directory`. Since 2.9.0 `environment` is the adapter's constant
 * (LOCAL-60a).
 *
 * @param {unknown} value the candidate destination
 * @param {string} pointer the pointer
 * @returns {void}
 */
export function checkDestination(value, pointer) {
  const destination = requireObject(value, pointer);
  requireNoUnknownFields(destination, DESTINATION_FIELDS, pointer);
  requirePresent(destination, DESTINATION_REQUIRED, pointer);
  const adapterId = requireEnum(
    destination,
    'adapterId',
    ADMITTED_ADAPTER_IDS,
    pointer,
  );
  if (
    destination.environment !==
    ADAPTER_ENVIRONMENTS[
      /** @type {keyof typeof ADAPTER_ENVIRONMENTS} */ (adapterId)
    ]
  ) {
    invalid(`${pointer}/environment`);
  }
  requireMatch(destination, 'adapterVersion', SEMVER_PATTERN, pointer);
  requireMatch(destination, 'targetDigest', DIGEST_PATTERN, pointer);
  requireBoundedText(destination, 'baseUrl', 1, 2048, pointer);
  requireMatch(destination, 'baseUrl', HTTPS_URL_PATTERN, pointer);
  if (destination.providerBinding === undefined) {
    return;
  }
  const at = `${pointer}/providerBinding`;
  if (adapterId === 'local-directory') {
    invalid(at);
  }
  const binding = requireObject(destination.providerBinding, at);
  const admitted =
    PROVIDER_BINDING_FIELDS[
      /** @type {keyof typeof PROVIDER_BINDING_FIELDS} */ (adapterId)
    ];
  requireNoUnknownFields(binding, admitted, at);
  requirePresent(binding, admitted, at);
  if (adapterId === 'github-pages') {
    requireMatch(binding, 'owner', GITHUB_OWNER_PATTERN, at);
    requireMatch(binding, 'repository', GITHUB_REPOSITORY_NAME_PATTERN, at);
    return;
  }
  requireMatch(binding, 'region', SPACES_REGION_PATTERN, at);
  requireMatch(binding, 'servedBucket', SPACES_BUCKET_PATTERN, at);
  requireMatch(binding, 'stagingBucket', SPACES_BUCKET_PATTERN, at);
}

/**
 * Validate one `deployment-receipt` exchange request.
 *
 * @param {Record<string, unknown>} body the request body
 * @returns {void}
 */
function checkAuthorizeReceipt(body) {
  requireNoUnknownFields(body, RECEIPT_FIELDS, '');
  requirePresent(body, RECEIPT_FIELDS, '');
  requireMatch(body, 'operationId', STABLE_ID_PATTERN, '');
  requireMatch(body, 'attemptId', STABLE_ID_PATTERN, '');
  requireMatch(body, 'intentDigest', DIGEST_PATTERN, '');
  requireMatch(body, 'reportChallengeId', STABLE_ID_PATTERN, '');
}

/**
 * Validate one `POST /v2/workloads/github/receipt-exchanges` request body
 * against the 2.8.0 contract's closed discriminated union.
 *
 * @param {unknown} value the request body
 * @returns {'deployment-intent' | 'deployment-receipt'} the validated purpose
 */
export function validateExchangeRequest(value) {
  const body = requireObject(value, '');
  if (body.purpose === 'deployment-intent') {
    checkAuthorizeDeployment(body);
    return 'deployment-intent';
  }
  if (body.purpose === 'deployment-receipt') {
    checkAuthorizeReceipt(body);
    return 'deployment-receipt';
  }
  return invalid('/purpose');
}

/**
 * Validate one `kernelJournal`.
 *
 * @param {unknown} value the candidate journal
 * @param {string} pointer the pointer
 * @returns {void}
 */
function checkKernelJournal(value, pointer) {
  const journal = requireObject(value, pointer);
  requireNoUnknownFields(journal, ['attempts', 'observations'], pointer);
  for (const stream of ['attempts', 'observations']) {
    if (!Array.isArray(journal[stream])) {
      invalid(`${pointer}/${stream}`);
    }
    const list = /** @type {unknown[]} */ (journal[stream]);
    if (list.length < 1 || list.length > MAXIMUM_JOURNAL_ENTRIES_PER_STREAM) {
      invalid(`${pointer}/${stream}`);
    }
  }
  for (const [index, candidate] of /** @type {unknown[]} */ (
    journal.attempts
  ).entries()) {
    const at = `${pointer}/attempts/${index}`;
    const attempt = requireObject(candidate, at);
    requireNoUnknownFields(attempt, ATTEMPT_FIELDS, at);
    requirePresent(attempt, ATTEMPT_REQUIRED, at);
    requireMatch(attempt, 'stageAttemptId', STABLE_ID_PATTERN, at);
    requireMatch(attempt, 'causationId', STABLE_ID_PATTERN, at);
    requireEnum(attempt, 'stage', ADMITTED_STAGES, at);
    requireInteger(attempt, 'kernelSequence', 1, 100, at);
    requireEnum(attempt, 'outcome', ADMITTED_ATTEMPT_OUTCOMES, at);
    requireEnum(
      attempt,
      'destinationChanged',
      ADMITTED_DESTINATION_CHANGED,
      at,
    );
    requireMatch(attempt, 'inputDigest', DIGEST_PATTERN, at);
    if (typeof attempt.retryable !== 'boolean') {
      invalid(`${at}/retryable`);
    }
    requireMatch(attempt, 'evidenceDigest', DIGEST_PATTERN, at);
    optionalMatch(attempt, 'resultDigest', DIGEST_PATTERN, at);
    if (attempt.failureCode !== undefined) {
      requireEnum(attempt, 'failureCode', ADMITTED_FAILURE_CODES, at);
    }
    optionalMatch(attempt, 'startedAt', INSTANT_PATTERN, at);
    optionalMatch(attempt, 'completedAt', INSTANT_PATTERN, at);
  }
  for (const [index, candidate] of /** @type {unknown[]} */ (
    journal.observations
  ).entries()) {
    const at = `${pointer}/observations/${index}`;
    const observation = requireObject(candidate, at);
    requireNoUnknownFields(observation, OBSERVATION_FIELDS, at);
    requirePresent(observation, OBSERVATION_REQUIRED, at);
    requireMatch(observation, 'observationId', STABLE_ID_PATTERN, at);
    requireMatch(observation, 'stageAttemptId', STABLE_ID_PATTERN, at);
    requireInteger(observation, 'kernelSequence', 1, 100, at);
    requireEnum(
      observation,
      'observationClass',
      ADMITTED_OBSERVATION_CLASSES,
      at,
    );
    requireEnum(observation, 'outcome', ADMITTED_OBSERVATION_OUTCOMES, at);
    requireEnum(
      observation,
      'destinationChanged',
      ADMITTED_DESTINATION_CHANGED,
      at,
    );
    requireMatch(observation, 'observedAt', INSTANT_PATTERN, at);
    requireMatch(observation, 'evidenceDigest', DIGEST_PATTERN, at);
    optionalMatch(observation, 'generationId', STABLE_ID_PATTERN, at);
    optionalMatch(observation, 'observedArtifactDigest', DIGEST_PATTERN, at);
    optionalMatch(observation, 'providerObjectIdDigest', DIGEST_PATTERN, at);
    optionalMatch(observation, 'providerVersion', /^[ -~]+$/u, at);
  }
}

/**
 * Validate one `POST /v2/workloads/deployment-receipts` request body.
 *
 * @param {unknown} value the request body
 * @returns {void}
 */
export function validateReceiptSubmission(value) {
  const body = requireObject(value, '');
  requireNoUnknownFields(body, SUBMISSION_FIELDS, '');
  requirePresent(body, SUBMISSION_REQUIRED, '');
  requireMatch(body, 'operationId', STABLE_ID_PATTERN, '');
  requireMatch(body, 'repositoryId', PROVIDER_NUMERIC_ID_PATTERN, '');
  requireMatch(body, 'sourceCommit', COMMIT_OID_PATTERN, '');
  requireMatch(body, 'runId', PROVIDER_NUMERIC_ID_PATTERN, '');
  requireInteger(body, 'runAttempt', 1, 51, '');
  requireMatch(body, 'artifactManifestDigest', DIGEST_PATTERN, '');
  requireInteger(body, 'artifactByteCount', 1, Number.MAX_SAFE_INTEGER, '');
  requireInteger(body, 'artifactFileCount', 1, Number.MAX_SAFE_INTEGER, '');
  requireMatch(body, 'provenanceDigest', DIGEST_PATTERN, '');
  requireMatch(body, 'sbomDigest', DIGEST_PATTERN, '');
  requireEnum(body, 'publisherPackage', [PUBLISHER_PACKAGE], '');
  requireMatch(body, 'publisherVersion', SEMVER_PATTERN, '');
  requireEnum(body, 'adapterId', ADMITTED_ADAPTER_IDS, '');
  requireMatch(body, 'adapterVersion', SEMVER_PATTERN, '');
  optionalMatch(body, 'destinationGenerationId', STABLE_ID_PATTERN, '');
  optionalMatch(body, 'destinationReceiptDigest', DIGEST_PATTERN, '');
  requireMatch(body, 'publicBaseUrl', /^https:\/\/(?![^/?#]*@)[^#]+$/u, '');
  if (!Array.isArray(body.observedRoutes)) {
    invalid('/observedRoutes');
  }
  const routes = /** @type {unknown[]} */ (body.observedRoutes);
  if (routes.length > MAXIMUM_OBSERVED_ROUTES) {
    throw new WorkloadContractError(
      'VERIFICATION_EVIDENCE_LIMIT_EXCEEDED',
      '/observedRoutes',
    );
  }
  for (const [index, candidate] of routes.entries()) {
    const at = `/observedRoutes/${index}`;
    const route = requireObject(candidate, at);
    requireNoUnknownFields(route, OBSERVED_ROUTE_FIELDS, at);
    requirePresent(route, OBSERVED_ROUTE_REQUIRED, at);
    requireMatch(route, 'route', CANONICAL_ROUTE_PATTERN, at);
    requireMatch(route, 'expectedDigest', /^[0-9a-f]{64}$/u, at);
    optionalMatch(route, 'observedDigest', /^[0-9a-f]{64}$/u, at);
    if (route.observedStatus !== undefined) {
      requireInteger(route, 'observedStatus', 100, 599, at);
    }
  }
  requireMatch(body, 'workflowStartedAt', INSTANT_PATTERN, '');
  requireMatch(body, 'workflowCompletedAt', INSTANT_PATTERN, '');
  checkKernelJournal(body.kernelJournal, '/kernelJournal');
}
