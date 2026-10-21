/**
 * `destination.verificationBaseUrl`: the origin that is serving right now and
 * answers over HTTPS (the `github.io` project path before the Pages CNAME is
 * set, the custom base once the custom domain serves). The build
 * `destination.baseUrl` is unchanged; public reads for verification use the
 * verification base when the intent names one and `baseUrl` otherwise.
 *
 * `test/deploy-journal.test.mjs` proves the deploy end to end (which URLs are
 * read, what the journal records, the refusal). This file holds the contract
 * pieces: the validator, the intent accessor, the destination binding, the
 * receipt extension and the capability-decision agreement.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as pages from '@rathnasgala2/adapter-github-pages';

import {
  AuthorizedIntentError,
  bindAuthorizedIntent,
  verificationBaseUrlOf,
} from '../scripts/workflow/authorized-intent.mjs';
import { requireCapabilityDecisionAgreement } from '../scripts/workflow/capability-decision.mjs';
import { pagesDestinationBinding } from '../scripts/workflow/deploy.mjs';
import {
  DESTINATION_FIELDS,
  WorkloadContractError,
  checkDestination,
  checkVerificationBaseUrl,
  validateSubmission,
} from '../scripts/workflow/workload-contract.mjs';
import {
  buildDeploymentIntentRequest,
  buildJournalAbsentSubmission,
  buildReceiptSubmission,
} from '../scripts/workflow/workload-requests.mjs';
import { authorizationInput } from './fixtures/authorization-input.mjs';
import {
  renderIntent,
  seedWithDefaults,
  stableId,
} from './fixtures/fake-gala-api.mjs';

const RUNNER = Object.freeze({
  GITHUB_REPOSITORY: 'gala-author/site',
  GITHUB_REPOSITORY_ID: '4242',
  GITHUB_REPOSITORY_OWNER_ID: '99',
});
const PROJECT_PATH = 'https://gala-author.github.io/galascribe-blog/';
const OPERATION_ID = stableId();

/**
 * @returns {Record<string, any>} a fresh Pages intent as the fake Gala renders it
 */
function pagesIntent() {
  const { request, derived } = buildDeploymentIntentRequest(
    /** @type {any} */ (
      authorizationInput({
        adapterId: 'github-pages',
        operationId: OPERATION_ID,
        repositoryId: '4242',
        runId: '987654321',
        runAttempt: 1,
        artifactDigest: pages.computeArtifactDigest([]),
      })
    ),
  );
  return renderIntent(
    request,
    seedWithDefaults({
      galaIssuer: 'https://api.gala.example/',
      repository: 'gala-author/site',
      repositoryId: '4242',
      operationId: OPERATION_ID,
      policyReleaseId: '019c0000-0000-7000-8000-0000000000bb',
    }),
    {
      intentId: stableId(),
      artifactId: derived.artifactId,
      attemptId: derived.attemptId,
      generationId: derived.proposedGenerationId,
      authorityId: stableId(),
      binding: { repositoryId: '4242', runId: '987654321', runAttempt: 1 },
      ...(derived.pagesBuildVersion === undefined
        ? {}
        : { pagesBuildVersion: derived.pagesBuildVersion }),
    },
  );
}

test('the validator admits an https exact-host base, with or without a project path, and nothing looser', () => {
  for (const good of [
    PROJECT_PATH,
    'https://gala-author.github.io/galascribe-blog',
    'https://www.example.com/',
    'https://www.example.com',
    'https://a.b-c.example.co.uk/x/y/',
  ]) {
    assert.equal(checkVerificationBaseUrl(good, '/v'), good);
  }
  for (const bad of [
    'http://www.example.com/',
    'https://user@www.example.com/',
    'https://user:pw@www.example.com/',
    'https://www.example.com:8443/',
    'https://www.example.com/#top',
    'https://www.example.com/?q=1',
    'https://WWW.example.com/',
    'https://www.example.com./',
    'https://www.example.com//x/',
    'https://www.example.com/a/../b/',
    'https://www.example.com/a/./b/',
    'www.example.com',
    '',
    42,
    null,
    `https://${'a'.repeat(2048)}.example.com/`,
  ]) {
    assert.throws(
      () => checkVerificationBaseUrl(bad, '/v'),
      (error) =>
        error instanceof WorkloadContractError && error.pointer === '/v',
      JSON.stringify(bad).slice(0, 60),
    );
  }
});

test('the retained destination admits the extension beside the pinned six members, which are unchanged', () => {
  assert.equal(DESTINATION_FIELDS.includes('verificationBaseUrl'), false);
  const intent = pagesIntent();
  assert.doesNotThrow(() => checkDestination(intent.destination, '/d'));
  assert.doesNotThrow(() =>
    checkDestination(
      { ...intent.destination, verificationBaseUrl: PROJECT_PATH },
      '/d',
    ),
  );
  assert.throws(() =>
    checkDestination({ ...intent.destination, somethingElse: 1 }, '/d'),
  );
});

test('verificationBaseUrlOf: present is returned, absent is undefined, malformed is refused by name', () => {
  const intent = pagesIntent();
  assert.equal(verificationBaseUrlOf(intent), undefined);
  intent.destination.verificationBaseUrl = PROJECT_PATH;
  assert.equal(verificationBaseUrlOf(intent), PROJECT_PATH);
  intent.destination.verificationBaseUrl = 'http://nope/';
  assert.throws(
    () => verificationBaseUrlOf(intent),
    (error) =>
      error instanceof AuthorizedIntentError &&
      error.code === 'DEPLOY_VERIFICATION_BASE_URL_INVALID',
  );
});

test('the Pages destination keeps baseUrl as publicBaseUrl and adds the verification base only when the intent names one', () => {
  const intent = pagesIntent();
  const absent = pagesDestinationBinding(intent, RUNNER);
  assert.equal(absent.publicBaseUrl, intent.destination.baseUrl);
  assert.equal('verificationBaseUrl' in absent, false);

  intent.destination.verificationBaseUrl = PROJECT_PATH;
  const present = pagesDestinationBinding(intent, RUNNER);
  assert.equal(present.publicBaseUrl, intent.destination.baseUrl);
  assert.equal(present.verificationBaseUrl, PROJECT_PATH);

  intent.destination.verificationBaseUrl = 'https://x.example.com:444/';
  assert.throws(
    () => pagesDestinationBinding(intent, RUNNER),
    /DEPLOY_VERIFICATION_BASE_URL_INVALID/u,
  );
});

test('the bound intent carries the build destination identity unchanged', () => {
  const intent = pagesIntent();
  intent.destination.verificationBaseUrl = PROJECT_PATH;
  const bound = bindAuthorizedIntent({
    authorization: {
      deploymentIntent: intent,
      marker: intent.marker,
      responseKind: 'deployment-intent',
    },
    runner: {
      ...RUNNER,
      GITHUB_REF: `refs/heads/gala/publish/${OPERATION_ID}`,
      GITHUB_RUN_ID: '987654321',
      GITHUB_RUN_ATTEMPT: '1',
    },
  });
  assert.equal(bound.destination.baseUrl, intent.destination.baseUrl);
  assert.equal('verificationBaseUrl' in bound.destination, false);
});

test('the capability decision agrees with an issued digest computed with or without the extension, and with neither refuses', () => {
  const run = { runId: '987654321', runAttempt: 1 };
  const intent = pagesIntent();
  // Issued over the pinned destination: the extension is added at render.
  const issued = requireCapabilityDecisionAgreement(intent, run);
  intent.destination.verificationBaseUrl = PROJECT_PATH;
  assert.equal(
    requireCapabilityDecisionAgreement(intent, run).decisionDigest,
    issued.decisionDigest,
  );
  // Issued over the full destination: the extension is part of the decision.
  /** @type {string} */
  let fullReading = '';
  try {
    requireCapabilityDecisionAgreement(
      { ...intent, capabilityDecisionDigest: 'x' },
      run,
    );
  } catch (error) {
    fullReading =
      /recomputed from the intent digests to (sha256:[0-9a-f]{64})/u.exec(
        /** @type {Error} */ (error).message,
      )?.[1] ?? '';
  }
  assert.match(fullReading, /^sha256:/u);
  assert.notEqual(fullReading, issued.decisionDigest);
  assert.equal(
    requireCapabilityDecisionAgreement(
      { ...intent, capabilityDecisionDigest: fullReading },
      run,
    ).decisionDigest,
    fullReading,
  );
  assert.throws(
    () =>
      requireCapabilityDecisionAgreement(
        { ...intent, capabilityDecisionDigest: `sha256:${'0'.repeat(64)}` },
        run,
      ),
    /DEPLOY_CAPABILITY_DECISION_MISMATCH/u,
  );
});

/**
 * @param {Record<string, any>} intent the intent
 * @returns {Record<string, any>} the facts every submission builder takes
 */
function submissionFacts(intent) {
  return {
    intent: {
      ...intent,
      artifactByteCount: String(intent.artifactByteCount),
      artifactFileCount: String(intent.artifactFileCount),
    },
    repositoryId: '4242',
    runId: '987654321',
    runAttempt: 1,
    publisherVersion: '0.1.0',
    observedRoutes: [],
    workflowStartedAt: '2026-09-17T00:00:00.000Z',
    workflowCompletedAt: '2026-09-17T00:01:00.000Z',
  };
}

test('verifiedAt rides on both submission shapes, is optional, and is validated like the base URL', () => {
  const intent = pagesIntent();
  const stageAttemptId = '019c0000-0000-7000-8000-00000000000a';
  const journal = {
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
  const facts = submissionFacts(intent);

  const withJournal = buildReceiptSubmission(
    /** @type {any} */ ({
      ...facts,
      journal,
      verifiedAt: { origin: PROJECT_PATH },
    }),
  );
  assert.deepEqual(withJournal.verifiedAt, { origin: PROJECT_PATH });
  assert.equal(
    buildReceiptSubmission(/** @type {any} */ ({ ...facts, journal }))
      .verifiedAt,
    undefined,
    'absent unless the journal says',
  );

  const absent = buildJournalAbsentSubmission(
    /** @type {any} */ ({
      ...facts,
      failureCode: 'DEPLOY_CRASHED',
      verifiedAt: { origin: PROJECT_PATH },
    }),
  );
  assert.deepEqual(absent.verifiedAt, { origin: PROJECT_PATH });

  const present = buildReceiptSubmission(
    /** @type {any} */ ({
      ...facts,
      journal,
      failure: {
        failureCode: 'PAGES_PUBLIC_REDIRECT',
        toHost: 'www.example.com',
      },
      verifiedAt: { origin: PROJECT_PATH },
    }),
  );
  assert.equal(/** @type {any} */ (present.deployFailure).journal, 'present');

  for (const bad of [
    { origin: 'http://x.example.com/' },
    { origin: PROJECT_PATH, extra: 1 },
    {},
    PROJECT_PATH,
  ]) {
    assert.throws(
      () => validateSubmission({ ...withJournal, verifiedAt: bad }),
      (error) => error instanceof WorkloadContractError,
      JSON.stringify(bad),
    );
  }
});
