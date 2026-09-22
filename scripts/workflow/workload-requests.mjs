/**
 * The two request builders: one per workload route, both pure and both
 * validated against the closed 2.8.0 contract before they return.
 *
 * Neither builder reads the environment, the clock or the filesystem: every
 * fact arrives as an explicit input, so the same inputs build the same bytes
 * in a test, on a rerun and on the runner. A builder that cannot produce a
 * conforming body throws rather than emitting a partial one — a request the
 * API would refuse is a request this workflow never sends.
 *
 * @module
 */

import {
  MAXIMUM_KERNEL_JOURNAL_BYTES,
  MAXIMUM_REQUEST_BYTES,
  MAXIMUM_VERIFICATION_ENTRIES,
  validateExchangeRequest,
  validateReceiptSubmission,
} from './workload-contract.mjs';
import {
  buildVerificationSubmission,
  derivePagesBuildVersion,
  deriveSpacesStagePrefix,
  deriveStableId,
} from './workload-identity.mjs';

/**
 * Read one required member of an untrusted input record.
 *
 * @param {Record<string, unknown>} input the input record
 * @param {string} name the member name
 * @returns {unknown} the member value
 */
function required(input, name) {
  const value = input[name];
  if (value === undefined || value === null || value === '') {
    throw new Error(
      `WORKLOAD_REQUEST_INPUT_MISSING: the authorization input carries no ${name}`,
    );
  }
  return value;
}

/**
 * Derive the four artifact-shaped members of the intent request from the
 * frozen artifact's own bytes and its `artifact-manifest:2.0.0` record.
 *
 * `manifestDigest` is the manifest record's own DEC-097 section 8 digest,
 * which the frozen envelope's decoder has already recomputed and matched
 * against the record; it is quoted here, never re-derived from the file
 * list, because the intent binds the manifest the envelope carries.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the frozen files
 * @param {Record<string, unknown>} manifest the frozen envelope's manifest record
 * @returns {{
 *   manifestDigest: string,
 *   artifactByteCount: number,
 *   artifactFileCount: number,
 *   verificationSubmission: Record<string, unknown>
 * }} the derived facts
 */
export function deriveArtifactFacts(files, manifest) {
  if (files.length === 0) {
    throw new Error(
      'WORKLOAD_REQUEST_INPUT_MISSING: the frozen artifact has no files',
    );
  }
  const manifestDigest = manifest.manifestDigest;
  if (
    typeof manifestDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(manifestDigest)
  ) {
    throw new Error(
      'WORKLOAD_REQUEST_INPUT_MISSING: the artifact manifest carries no manifestDigest',
    );
  }
  return {
    manifestDigest,
    artifactByteCount: files.reduce(
      (total, file) => total + file.bytes.byteLength,
      0,
    ),
    artifactFileCount: files.length,
    verificationSubmission: buildVerificationSubmission(
      files,
      MAXIMUM_VERIFICATION_ENTRIES,
      MAXIMUM_REQUEST_BYTES,
    ),
  };
}

/**
 * Build the `deployment-intent` exchange request.
 *
 * `artifactId`, `attemptId` and `proposedGenerationId` are *derived*, not
 * invented: each is a domain-separated digest over the bound run identity
 * and the frozen artifact, so a rerun of the same attempt derives the same
 * three values and the exchange is a replay rather than a second claim.
 *
 * `files` is the convenience form: when the caller holds the frozen artifact
 * bytes (as `freeze` does) the manifest digest, the two counts and the
 * verification submission are derived from them here. When the caller holds
 * only the already derived facts (as `authorize` does, since it downloads the
 * authorization input and never the envelope), it passes those four members
 * instead and this builder quotes them.
 *
 * @param {{
 *   files?: readonly {path: string, bytes: Buffer}[],
 *   manifest?: Record<string, unknown>,
 *   manifestDigest?: string,
 *   artifactByteCount?: number,
 *   artifactFileCount?: number,
 *   verificationSubmission?: Record<string, unknown>,
 *   artifactDigest: string,
 *   sourceCommit: string,
 *   workflowTriggerCommit: string,
 *   repositoryId: string,
 *   operationId: string,
 *   runId: string,
 *   runAttempt: number,
 *   frozenEnvelopeDigest: string,
 *   frozenEnvelopeByteCount: number,
 *   frozenHandoffArtifactId: string,
 *   frozenHandoffName: string,
 *   provenanceDigest: string,
 *   sbomDigest: string,
 *   lockDigest: string,
 *   capabilityDecisionDigest?: string,
 *   requestedArtifactRetentionDays: number,
 *   effectiveArtifactExpiresAt: string,
 *   rebuildRecord: Record<string, unknown>,
 *   publisher: Record<string, unknown>,
 *   adapter: Record<string, unknown>,
 *   destination: Record<string, unknown>,
 *   sendDerivedConditionalMembers?: boolean
 * }} input every fact the body commits to. `destination` carries the closed
 *   identity plus, where the adapter knows its coordinates, the optional
 *   `providerBinding` (LOCAL-55 (2)). `sendDerivedConditionalMembers`
 *   (default `true`) controls whether the adapter's derived conditional
 *   member — `pagesBuildVersion` or `spacesStagePrefix` — is sent: since
 *   2.8.0 the API derives both itself and refuses a disagreement with
 *   `422 VALIDATION_FAILED`, so a caller that holds every binding input keeps
 *   sending its own derivation (the disagreement is evidence), and one that
 *   does not omits it rather than guessing (LOCAL-57). Since 2.9.0
 *   (LOCAL-60) the same rule covers `capabilityDecisionDigest`,
 *   `destination.environment`/`targetDigest` and the four Gala-owned
 *   `rebuildRecord` members: each is sent only when the caller holds it
 *   (`freeze` holds none of them), and the API derives the rest.
 * @returns {{
 *   request: Record<string, unknown>,
 *   derived: {artifactId: string, attemptId: string, proposedGenerationId: string, pagesBuildVersion?: string, spacesStagePrefix?: string}
 * }} the validated request and the identities it derived
 */
export function buildDeploymentIntentRequest(input) {
  const record = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (input)
  );
  for (const name of [
    'artifactDigest',
    'sourceCommit',
    'workflowTriggerCommit',
    'repositoryId',
    'operationId',
    'runId',
    'frozenEnvelopeDigest',
    'frozenHandoffArtifactId',
    'frozenHandoffName',
    'provenanceDigest',
    'sbomDigest',
    'lockDigest',
    'effectiveArtifactExpiresAt',
    'rebuildRecord',
    'publisher',
    'adapter',
    'destination',
  ]) {
    required(record, name);
  }
  const artifact =
    input.files === undefined
      ? {
          manifestDigest: String(required(record, 'manifestDigest')),
          artifactByteCount: Number(required(record, 'artifactByteCount')),
          artifactFileCount: Number(required(record, 'artifactFileCount')),
          verificationSubmission: /** @type {Record<string, unknown>} */ (
            required(record, 'verificationSubmission')
          ),
        }
      : deriveArtifactFacts(
          input.files,
          /** @type {Record<string, unknown>} */ (required(record, 'manifest')),
        );

  const binding = {
    repositoryId: input.repositoryId,
    operationId: input.operationId,
    runId: input.runId,
    runAttempt: input.runAttempt,
    artifactDigest: input.artifactDigest,
  };
  const artifactId = deriveStableId('gala-artifact-id-v2', binding);
  const attemptId = deriveStableId('gala-attempt-id-v2', binding);
  const proposedGenerationId = deriveStableId('gala-generation-id-v2', binding);

  const adapterId = String(
    /** @type {Record<string, unknown>} */ (input.adapter).adapterId,
  );

  /** @type {Record<string, unknown>} */
  const request = {
    purpose: 'deployment-intent',
    sourceCommit: input.sourceCommit,
    workflowTriggerCommit: input.workflowTriggerCommit,
    artifactId,
    artifactDigest: input.artifactDigest,
    manifestDigest: artifact.manifestDigest,
    provenanceDigest: input.provenanceDigest,
    sbomDigest: input.sbomDigest,
    frozenHandoffArtifactId: input.frozenHandoffArtifactId,
    frozenHandoffName: input.frozenHandoffName,
    frozenEnvelopeDigest: input.frozenEnvelopeDigest,
    frozenEnvelopeByteCount: input.frozenEnvelopeByteCount,
    artifactByteCount: artifact.artifactByteCount,
    artifactFileCount: artifact.artifactFileCount,
    requestedArtifactRetentionDays: input.requestedArtifactRetentionDays,
    effectiveArtifactExpiresAt: input.effectiveArtifactExpiresAt,
    verificationSubmission: artifact.verificationSubmission,
    lockDigest: input.lockDigest,
    rebuildRecord: input.rebuildRecord,
    publisher: input.publisher,
    adapter: input.adapter,
    destination: input.destination,
    ...(input.capabilityDecisionDigest === undefined
      ? {}
      : { capabilityDecisionDigest: input.capabilityDecisionDigest }),
  };

  // The contract's conditional members, admitted only for their own adapter.
  // Both are derived from the same bound identity the API recomputes, never
  // carried in from a caller input, and both are recorded as derived whether
  // or not they are sent so the journal can state what this job expected.
  /** @type {{artifactId: string, attemptId: string, proposedGenerationId: string, pagesBuildVersion?: string, spacesStagePrefix?: string}} */
  const derived = { artifactId, attemptId, proposedGenerationId };
  if (adapterId === 'github-pages') {
    derived.pagesBuildVersion = derivePagesBuildVersion({
      ...binding,
      attemptId,
      artifactId,
      proposedGenerationId,
    });
  } else if (adapterId === 'do-spaces') {
    derived.spacesStagePrefix = deriveSpacesStagePrefix({
      operationId: input.operationId,
      attemptId,
      proposedGenerationId,
    });
  }
  if (input.sendDerivedConditionalMembers !== false) {
    if (derived.pagesBuildVersion !== undefined) {
      request.pagesBuildVersion = derived.pagesBuildVersion;
    }
    if (derived.spacesStagePrefix !== undefined) {
      request.spacesStagePrefix = derived.spacesStagePrefix;
    }
  }

  validateExchangeRequest(request);
  return { request, derived };
}

/**
 * Build the `deployment-receipt` exchange request: the five-member challenge
 * exchange that trades the report challenge for one single-use reporting
 * capability.
 *
 * @param {{
 *   operationId: string,
 *   attemptId: string,
 *   intentDigest: string,
 *   reportChallengeId: string
 * }} input the challenge binding
 * @returns {Record<string, unknown>} the validated request
 */
export function buildReceiptExchangeRequest(input) {
  const request = {
    purpose: 'deployment-receipt',
    operationId: input.operationId,
    attemptId: input.attemptId,
    intentDigest: input.intentDigest,
    reportChallengeId: input.reportChallengeId,
  };
  validateExchangeRequest(request);
  return request;
}

/**
 * Build the bounded preliminary receipt submission: the contract's nineteen
 * required members plus the two optional destination members, every one of
 * them quoted back from the retained intent the exchange returned or
 * produced by the kernel run that actually happened.
 *
 * This is deliberately not a receipt. The workflow hands Gala evidence; the
 * reconciliation worker is the sole issuer of a `deployment-receipt:2.0.0`,
 * and nothing here signs, constructs or claims one.
 *
 * @param {{
 *   intent: Record<string, unknown>,
 *   journal: {attempts: unknown[], observations: unknown[]},
 *   repositoryId: string,
 *   runId: string,
 *   runAttempt: number,
 *   publisherVersion: string,
 *   observedRoutes: readonly Record<string, unknown>[],
 *   workflowStartedAt: string,
 *   workflowCompletedAt: string,
 *   destinationGenerationId?: string,
 *   destinationReceiptDigest?: string
 * }} input the submission facts
 * @returns {Record<string, unknown>} the validated submission
 */
export function buildReceiptSubmission(input) {
  const intent = input.intent;
  const adapter = /** @type {Record<string, unknown>} */ (
    required(intent, 'adapter')
  );
  const destination = /** @type {Record<string, unknown>} */ (
    required(intent, 'destination')
  );

  /** @type {Record<string, unknown>} */
  const submission = {
    operationId: required(intent, 'operationId'),
    repositoryId: input.repositoryId,
    sourceCommit: required(intent, 'sourceCommit'),
    runId: input.runId,
    runAttempt: input.runAttempt,
    artifactManifestDigest: required(intent, 'manifestDigest'),
    // The intent carries both int64 counts as strings so a JavaScript
    // consumer cannot silently round them; the submission's own domain is
    // `integer`, so they are converted back here and refused if the exact
    // value would not survive.
    artifactByteCount: exactInteger(
      intent.artifactByteCount,
      'artifactByteCount',
    ),
    artifactFileCount: exactInteger(
      intent.artifactFileCount,
      'artifactFileCount',
    ),
    provenanceDigest: required(intent, 'provenanceDigest'),
    sbomDigest: required(intent, 'sbomDigest'),
    publisherPackage: String(
      /** @type {Record<string, unknown>} */ (required(intent, 'publisher'))
        .package,
    ),
    publisherVersion: input.publisherVersion,
    adapterId: String(adapter.adapterId),
    adapterVersion: String(adapter.adapterVersion),
    publicBaseUrl: String(destination.baseUrl),
    observedRoutes: [...input.observedRoutes],
    workflowStartedAt: input.workflowStartedAt,
    workflowCompletedAt: input.workflowCompletedAt,
    kernelJournal: {
      attempts: input.journal.attempts,
      observations: input.journal.observations,
    },
  };
  if (input.destinationGenerationId !== undefined) {
    submission.destinationGenerationId = input.destinationGenerationId;
  }
  if (input.destinationReceiptDigest !== undefined) {
    submission.destinationReceiptDigest = input.destinationReceiptDigest;
  }

  validateReceiptSubmission(submission);
  assertSubmissionFits(submission);
  return submission;
}

/**
 * Apply the two ceilings before a byte is sent: the 512 KiB kernel-journal
 * bound and the 1 MiB request bound. The API applies both before it parses,
 * so a workflow that discovered an over-sized report only from a `413` would
 * have spent its one-use capability on it.
 *
 * @param {Record<string, unknown>} submission the built submission
 * @param {number} [intentRequestBound] the intent's own
 *   `maximumReportRequestByteCount`, when the intent disclosed one
 * @returns {{requestByteCount: number, kernelJournalByteCount: number}} the
 *   two measured sizes
 */
export function assertSubmissionFits(submission, intentRequestBound) {
  const journalBytes = Buffer.byteLength(
    JSON.stringify(submission.kernelJournal),
    'utf8',
  );
  if (journalBytes > MAXIMUM_KERNEL_JOURNAL_BYTES) {
    throw new Error(
      `REPORT_KERNEL_JOURNAL_TOO_LARGE: ${journalBytes} bytes exceed ${MAXIMUM_KERNEL_JOURNAL_BYTES}`,
    );
  }
  const requestBytes = Buffer.byteLength(JSON.stringify(submission), 'utf8');
  const bound =
    intentRequestBound === undefined
      ? MAXIMUM_REQUEST_BYTES
      : Math.min(intentRequestBound, MAXIMUM_REQUEST_BYTES);
  if (requestBytes > bound) {
    throw new Error(
      `REPORT_REQUEST_TOO_LARGE: ${requestBytes} bytes exceed ${bound}`,
    );
  }
  return {
    requestByteCount: requestBytes,
    kernelJournalByteCount: journalBytes,
  };
}

/**
 * @param {unknown} value the contract's string-carried int64
 * @param {string} name the member name
 * @returns {number} the exact integer
 */
function exactInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== String(value)) {
    throw new Error(
      `WORKLOAD_REQUEST_INPUT_MISSING: the retained intent's ${name} is not an exactly representable integer`,
    );
  }
  return parsed;
}
