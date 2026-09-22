/**
 * Unit coverage for the two workload request builders: every required
 * member, the conditional members per adapter, the two size ceilings, and
 * the rule that neither a journal nor an evidence record ever carries a
 * secret.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INTENT_REQUIRED,
  MAXIMUM_KERNEL_JOURNAL_BYTES,
  MAXIMUM_REQUEST_BYTES,
  PAGES_BUILD_VERSION_PATTERN,
  SUBMISSION_REQUIRED,
  WorkloadContractError,
  validateExchangeRequest,
} from '../scripts/workflow/workload-contract.mjs';
import {
  assertSubmissionFits,
  buildDeploymentIntentRequest,
  buildReceiptExchangeRequest,
  buildReceiptSubmission,
} from '../scripts/workflow/workload-requests.mjs';
import {
  canonicalJson,
  derivePagesBuildVersion,
  deriveSpacesStagePrefix,
  deriveStableId,
  operationIdFromPublishRef,
  projectRoute,
} from '../scripts/workflow/workload-identity.mjs';
import {
  ARTIFACT_FILES,
  PROVIDER_BINDINGS,
  authorizationInput,
  destinationFor,
} from './fixtures/authorization-input.mjs';

const OPERATION_ID = '019c0000-0000-7000-8000-000000000001';

/**
 * @param {Partial<Record<string, unknown>>} [overrides] members to replace
 * @returns {Record<string, any>} one authorization input
 */
function input(overrides = {}) {
  return { ...authorizationInput({ operationId: OPERATION_ID }), ...overrides };
}

test('the intent builder emits every required member of the contract arm', () => {
  const { request } = buildDeploymentIntentRequest(
    /** @type {any} */ (input()),
  );
  for (const member of INTENT_REQUIRED) {
    assert.notEqual(
      request[member],
      undefined,
      `${member} must be present in the built request`,
    );
  }
  assert.equal(request.purpose, 'deployment-intent');
  assert.equal(validateExchangeRequest(request), 'deployment-intent');
});

test('the intent builder derives the artifact, attempt and generation identities deterministically', () => {
  const first = buildDeploymentIntentRequest(/** @type {any} */ (input()));
  const second = buildDeploymentIntentRequest(/** @type {any} */ (input()));
  assert.deepEqual(first.derived, second.derived);
  // A different run attempt of the same operation is a different attempt,
  // and must not collide with the first.
  const other = buildDeploymentIntentRequest(
    /** @type {any} */ (input({ runAttempt: 2 })),
  );
  assert.notEqual(other.derived.attemptId, first.derived.attemptId);
  assert.notEqual(
    other.derived.proposedGenerationId,
    first.derived.proposedGenerationId,
  );
});

test('pagesBuildVersion is present exactly for github-pages', () => {
  const { request, derived } = buildDeploymentIntentRequest(
    /** @type {any} */ (input(destinationFor('github-pages'))),
  );
  assert.match(String(request.pagesBuildVersion), PAGES_BUILD_VERSION_PATTERN);
  assert.equal(request.spacesStagePrefix, undefined);
  assert.equal(
    request.pagesBuildVersion,
    derivePagesBuildVersion({
      repositoryId: '4242',
      operationId: OPERATION_ID,
      runId: '987654321',
      runAttempt: 1,
      artifactDigest: String(request.artifactDigest),
      artifactId: derived.artifactId,
      attemptId: derived.attemptId,
      proposedGenerationId: derived.proposedGenerationId,
    }),
    'the builder derives it from DEC-097s closed preimage, never from an input',
  );
});

test('spacesStagePrefix is present exactly for do-spaces and is the exact DEC-097 string', () => {
  const { request, derived } = buildDeploymentIntentRequest(
    /** @type {any} */ (input(destinationFor('do-spaces'))),
  );
  assert.equal(request.pagesBuildVersion, undefined);
  assert.equal(
    request.spacesStagePrefix,
    deriveSpacesStagePrefix({
      operationId: OPERATION_ID,
      attemptId: derived.attemptId,
      proposedGenerationId: derived.proposedGenerationId,
    }),
  );
  assert.ok(
    String(request.spacesStagePrefix).startsWith('_gala/staged/v2/'),
    'the staging prefix is under the reserved _gala/ namespace',
  );
  assert.ok(String(request.spacesStagePrefix).endsWith('/'));
});

test('both conditional members are optional: a caller that cannot compute one omits it', () => {
  for (const adapterId of /** @type {const} */ ([
    'github-pages',
    'do-spaces',
  ])) {
    const { request, derived } = buildDeploymentIntentRequest(
      /** @type {any} */ (
        input({
          ...destinationFor(adapterId),
          sendDerivedConditionalMembers: false,
        })
      ),
    );
    assert.equal(request.pagesBuildVersion, undefined);
    assert.equal(request.spacesStagePrefix, undefined);
    assert.equal(validateExchangeRequest(request), 'deployment-intent');
    // The derivation is still recorded, so the journal can compare the
    // API's own value against what this job would have sent.
    const member =
      adapterId === 'github-pages' ? 'pagesBuildVersion' : 'spacesStagePrefix';
    assert.equal(typeof derived[member], 'string');
  }
});

test('the destination carries the request-side providerBinding the adapter holds (2.9.0), and the contract closes it per adapter', () => {
  // Pages: the runner-bound coordinates; local-directory: the two DEC-097
  // section 7 evidence digests; do-spaces: nothing (Gala's destination
  // record, C2).
  for (const adapterId of /** @type {const} */ ([
    'github-pages',
    'local-directory',
    'do-spaces',
  ])) {
    const { request } = buildDeploymentIntentRequest(
      /** @type {any} */ (input(destinationFor(adapterId))),
    );
    assert.deepEqual(
      /** @type {any} */ (request.destination).providerBinding,
      PROVIDER_BINDINGS[adapterId],
    );
    assert.equal(
      /** @type {any} */ (request.destination).environment,
      undefined,
    );
    assert.equal(
      /** @type {any} */ (request.destination).targetDigest,
      undefined,
    );
  }
  /**
   * @param {'github-pages' | 'do-spaces' | 'local-directory'} adapterId the adapter
   * @param {Record<string, string>} providerBinding the binding to try
   * @returns {string} the refusal pointer
   */
  const refusal = (adapterId, providerBinding) => {
    try {
      buildDeploymentIntentRequest(
        /** @type {any} */ (
          input(destinationFor(adapterId, { providerBinding }))
        ),
      );
    } catch (error) {
      assert.ok(error instanceof WorkloadContractError);
      return `${error.code} ${error.pointer}`;
    }
    return 'accepted';
  };
  assert.equal(
    refusal('github-pages', { owner: 'gala-author' }),
    'VALIDATION_FAILED /destination/providerBinding/repository',
  );
  assert.equal(
    refusal('github-pages', { region: 'nyc3' }),
    'REQUEST_FIELD_UNKNOWN /destination/providerBinding/region',
  );
  assert.equal(
    refusal('github-pages', {
      owner: 'gala-author',
      repository: 'site',
      rootIdentityDigest: `sha256:${'1'.repeat(64)}`,
    }),
    'REQUEST_FIELD_UNKNOWN /destination/providerBinding/rootIdentityDigest',
  );
  assert.equal(
    refusal('do-spaces', {
      region: 'nyc3',
      servedBucket: 'gala-served',
      stagingBucket: 'gala-staging',
    }),
    'VALIDATION_FAILED /destination/providerBinding',
    'the Spaces coordinates are never proposed by a deploy job',
  );
  assert.equal(
    refusal('local-directory', { owner: 'gala-author', repository: 'site' }),
    'REQUEST_FIELD_UNKNOWN /destination/providerBinding/owner',
  );
  assert.equal(
    refusal('local-directory', {
      rootIdentityDigest: `sha256:${'1'.repeat(64)}`,
    }),
    'VALIDATION_FAILED /destination/providerBinding/mutationSurfaceDigest',
  );
  assert.equal(
    refusal('local-directory', {
      rootIdentityDigest: 'nope',
      mutationSurfaceDigest: `sha256:${'2'.repeat(64)}`,
    }),
    'VALIDATION_FAILED /destination/providerBinding/rootIdentityDigest',
  );
  // A sent environment is admitted only as the adapter's constant.
  const withEnvironment = input(destinationFor('github-pages'));
  /** @type {any} */ (withEnvironment.destination).environment = 'github-pages';
  assert.equal(
    /** @type {any} */ (
      buildDeploymentIntentRequest(/** @type {any} */ (withEnvironment)).request
        .destination
    ).environment,
    'github-pages',
  );
  /** @type {any} */ (withEnvironment.destination).environment = 'production';
  assert.throws(
    () => buildDeploymentIntentRequest(/** @type {any} */ (withEnvironment)),
    /VALIDATION_FAILED: \/destination\/environment/u,
  );
});

test('capabilityDecisionDigest is sent only when the caller holds it (2.9.0)', () => {
  const { request } = buildDeploymentIntentRequest(
    /** @type {any} */ (input(destinationFor('github-pages'))),
  );
  assert.equal(request.capabilityDecisionDigest, undefined);
  const held = input(destinationFor('github-pages'));
  held.capabilityDecisionDigest = `sha256:${'a'.repeat(64)}`;
  assert.equal(
    buildDeploymentIntentRequest(/** @type {any} */ (held)).request
      .capabilityDecisionDigest,
    `sha256:${'a'.repeat(64)}`,
  );
});

test('local-directory carries neither conditional member', () => {
  const { request } = buildDeploymentIntentRequest(
    /** @type {any} */ (input(destinationFor('local-directory'))),
  );
  assert.equal(request.pagesBuildVersion, undefined);
  assert.equal(request.spacesStagePrefix, undefined);
});

test('a missing authorization-input member is refused by name, never defaulted', () => {
  for (const member of ['provenanceDigest', 'sbomDigest', 'lockDigest']) {
    const incomplete = input();
    delete incomplete[member];
    assert.throws(
      () => buildDeploymentIntentRequest(/** @type {any} */ (incomplete)),
      new RegExp(`WORKLOAD_REQUEST_INPUT_MISSING.*${member}`, 'u'),
    );
  }
});

test('an artifact over the fit bound becomes the explicit unfit arm rather than a truncated one', () => {
  const files = Array.from({ length: 901 }, (_unused, index) => ({
    path: `page-${String(index).padStart(4, '0')}.html`,
    bytes: Buffer.from(`<!doctype html><p>${index}`, 'utf8'),
  }));
  const { request } = buildDeploymentIntentRequest(
    /** @type {any} */ (
      input({ ...authorizationInput({ operationId: OPERATION_ID, files }) })
    ),
  );
  const submission = /** @type {Record<string, unknown>} */ (
    request.verificationSubmission
  );
  assert.equal(submission.state, 'unfit');
  assert.equal(submission.reason, 'entry-count-exceeded');
  assert.equal(submission.requiredVerificationEntryCount, 901);
  assert.ok(Number(submission.canonicalFitRequestByteCount) > 0);
  assert.equal(validateExchangeRequest(request), 'deployment-intent');
});

test('the receipt exchange builder emits exactly the five-member challenge body', () => {
  const request = buildReceiptExchangeRequest({
    operationId: OPERATION_ID,
    attemptId: '019c0000-0000-7000-8000-000000000002',
    intentDigest: `sha256:${'c'.repeat(64)}`,
    reportChallengeId: '019c0000-0000-7000-8000-000000000003',
  });
  assert.deepEqual(Object.keys(request).sort(), [
    'attemptId',
    'intentDigest',
    'operationId',
    'purpose',
    'reportChallengeId',
  ]);
  assert.throws(
    () =>
      buildReceiptExchangeRequest({
        operationId: 'not-a-stable-id',
        attemptId: '019c0000-0000-7000-8000-000000000002',
        intentDigest: `sha256:${'c'.repeat(64)}`,
        reportChallengeId: '019c0000-0000-7000-8000-000000000003',
      }),
    WorkloadContractError,
  );
});

/**
 * One minimal, contract-valid kernel journal.
 *
 * @returns {{attempts: Record<string, unknown>[], observations: Record<string, unknown>[]}}
 *   the journal
 */
function journal() {
  const stageAttemptId = '019c0000-0000-7000-8000-00000000000a';
  return {
    attempts: [
      {
        stageAttemptId,
        causationId: '019c0000-0000-7000-8000-00000000000b',
        stage: 'staging',
        kernelSequence: 1,
        outcome: 'succeeded',
        destinationChanged: 'no',
        inputDigest: `sha256:${'1'.repeat(64)}`,
        retryable: false,
        evidenceDigest: `sha256:${'2'.repeat(64)}`,
      },
    ],
    observations: [
      {
        observationId: '019c0000-0000-7000-8000-00000000000c',
        stageAttemptId,
        kernelSequence: 1,
        observationClass: 'request-accepted',
        outcome: 'succeeded',
        destinationChanged: 'no',
        observedAt: '2026-09-17T00:00:00.000Z',
        evidenceDigest: `sha256:${'3'.repeat(64)}`,
      },
    ],
  };
}

/**
 * The retained intent the submission quotes back.
 *
 * @returns {Record<string, any>} one intent
 */
function retainedIntent() {
  const built = buildDeploymentIntentRequest(
    /** @type {any} */ (input(destinationFor('do-spaces'))),
  ).request;
  return {
    ...built,
    operationId: OPERATION_ID,
    attemptId: '019c0000-0000-7000-8000-000000000002',
    artifactByteCount: String(built.artifactByteCount),
    artifactFileCount: String(built.artifactFileCount),
    maximumReportRequestByteCount: String(MAXIMUM_REQUEST_BYTES),
  };
}

/**
 * @param {Partial<Record<string, unknown>>} [overrides] members to replace
 * @returns {Record<string, unknown>} one built submission
 */
function submission(overrides = {}) {
  return buildReceiptSubmission(
    /** @type {any} */ ({
      intent: retainedIntent(),
      journal: journal(),
      repositoryId: '4242',
      runId: '987654321',
      runAttempt: 1,
      publisherVersion: '0.1.0',
      observedRoutes: [],
      workflowStartedAt: '2026-09-17T00:00:00.000Z',
      workflowCompletedAt: '2026-09-17T00:01:00.000Z',
      ...overrides,
    }),
  );
}

test('the submission builder emits all nineteen required members from the retained intent', () => {
  const built = submission();
  for (const member of SUBMISSION_REQUIRED) {
    assert.notEqual(built[member], undefined, `${member} must be present`);
  }
  assert.equal(SUBMISSION_REQUIRED.length, 19);
  assert.equal(built.publisherPackage, '@rathnasgala2/publish-action');
  assert.equal(built.adapterId, 'do-spaces');
  assert.equal(built.publicBaseUrl, 'https://example.test/');
});

test('the two optional destination members appear only when the run produced them', () => {
  assert.equal(submission().destinationGenerationId, undefined);
  const built = submission({
    destinationGenerationId: '019c0000-0000-7000-8000-00000000000d',
    destinationReceiptDigest: `sha256:${'4'.repeat(64)}`,
  });
  assert.equal(
    built.destinationGenerationId,
    '019c0000-0000-7000-8000-00000000000d',
  );
  assert.equal(built.destinationReceiptDigest, `sha256:${'4'.repeat(64)}`);
});

test('an int64 count the intent carries as a string that would not survive is refused', () => {
  assert.throws(
    () =>
      buildReceiptSubmission(
        /** @type {any} */ ({
          intent: {
            ...retainedIntent(),
            artifactByteCount: '9007199254740993',
          },
          journal: journal(),
          repositoryId: '4242',
          runId: '987654321',
          runAttempt: 1,
          publisherVersion: '0.1.0',
          observedRoutes: [],
          workflowStartedAt: '2026-09-17T00:00:00.000Z',
          workflowCompletedAt: '2026-09-17T00:01:00.000Z',
        }),
      ),
    /artifactByteCount is not an exactly representable integer/u,
  );
});

test('the 512 KiB journal ceiling is applied before the request is sent', () => {
  // The ceiling is on the journal's own encoded bytes, so it is proved with
  // a journal that is over it: one hundred attempts each carrying the
  // longest `providerVersion`-shaped padding the contract admits.
  const pad = 'p'.repeat(6000);
  const oversized = {
    ...submission(),
    kernelJournal: {
      attempts: journal().attempts,
      observations: Array.from({ length: 100 }, (_unused, index) => ({
        ...journal().observations[0],
        kernelSequence: index + 1,
        providerVersion: pad,
      })),
    },
  };
  assert.ok(
    Buffer.byteLength(JSON.stringify(oversized.kernelJournal), 'utf8') >
      MAXIMUM_KERNEL_JOURNAL_BYTES,
  );
  assert.throws(
    () => assertSubmissionFits(oversized),
    /REPORT_KERNEL_JOURNAL_TOO_LARGE: \d+ bytes exceed 524288/u,
  );
  // And a conforming journal is measured, not merely waved through.
  const sizes = assertSubmissionFits(submission());
  assert.ok(sizes.kernelJournalByteCount > 0);
  assert.ok(sizes.kernelJournalByteCount < MAXIMUM_KERNEL_JOURNAL_BYTES);
});

test('the intent own report bound is applied before the hard 1 MiB cap', () => {
  const built = submission();
  assert.throws(
    () => assertSubmissionFits(built, 16),
    /REPORT_REQUEST_TOO_LARGE: \d+ bytes exceed 16/u,
  );
  const sizes = assertSubmissionFits(built, MAXIMUM_REQUEST_BYTES);
  assert.ok(sizes.requestByteCount > 0);
  assert.ok(sizes.requestByteCount <= MAXIMUM_REQUEST_BYTES);
});

test('nothing the builders emit carries a credential-shaped value', () => {
  const secrets = [
    'ghs_0123456789abcdef',
    'Bearer ',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    'Gala-Receipt',
    'secretAccessKey',
  ];
  const text = `${JSON.stringify(buildDeploymentIntentRequest(/** @type {any} */ (input())).request)}${JSON.stringify(submission())}`;
  for (const secret of secrets) {
    assert.ok(
      !text.includes(secret),
      `a built request must never carry ${secret}`,
    );
  }
});

test('route projection is closed: an unknown extension is an inert asset', () => {
  assert.deepEqual(projectRoute('index.html'), {
    publicRoute: '/index.html',
    routeClass: 'html',
    expectedContentType: 'text/html; charset=utf-8',
  });
  assert.equal(projectRoute('404.html').routeClass, 'error');
  assert.equal(projectRoute('sitemap.xml').routeClass, 'sitemap');
  assert.equal(projectRoute('feed.atom').routeClass, 'feed');
  assert.deepEqual(projectRoute('weird.qqq'), {
    publicRoute: '/weird.qqq',
    routeClass: 'asset',
    expectedContentType: 'application/octet-stream',
  });
});

test('canonical JSON orders members and refuses an unsafe integer', () => {
  assert.equal(canonicalJson({ b: 1, a: 'x' }), '{"a":"x","b":1}');
  assert.throws(() => canonicalJson(2 ** 53), /CANONICALIZATION_REFUSED/u);
});

test('a derived stableId is a UUIDv7-shaped identity and is domain separated', () => {
  const pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  assert.match(deriveStableId('a', { x: 1 }), pattern);
  assert.notEqual(
    deriveStableId('a', { x: 1 }),
    deriveStableId('b', { x: 1 }),
    'two domains over one preimage must not collide',
  );
});

test('the operation id comes from the publish ref and a candidate ref is refused', () => {
  assert.equal(
    operationIdFromPublishRef(`refs/heads/gala/publish/${OPERATION_ID}`),
    OPERATION_ID,
  );
  assert.throws(
    () =>
      operationIdFromPublishRef(`refs/heads/gala/candidate/${OPERATION_ID}`),
    /WORKLOAD_PUBLISH_REF_INVALID/u,
  );
});

test('the fixture artifact is what the builder actually commits to', () => {
  const { request } = buildDeploymentIntentRequest(
    /** @type {any} */ (input()),
  );
  assert.equal(request.artifactFileCount, ARTIFACT_FILES.length);
  assert.equal(
    request.artifactByteCount,
    ARTIFACT_FILES.reduce((total, file) => total + file.bytes.byteLength, 0),
  );
});
