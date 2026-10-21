/**
 * `report.mjs` reports a failed deploy whether or not the deploy left a
 * kernel journal.
 *
 * Production incident 2026-10-21: the deploy died before it wrote a journal,
 * so the report job never ran and the API never learned the deploy had
 * failed. With no kernel journal the report posts the journal-less failure
 * submission (`deployFailure: {journal: 'absent', failureCode, stage?}` in
 * place of `kernelJournal`) to the same route, with the same reporting
 * capability. The script runs as a child process, as the workflow runs it,
 * against a loopback server that records the body it is sent.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { carrierDigest } from '../scripts/workflow/carrier.mjs';
import { buildDeploymentIntentRequest } from '../scripts/workflow/workload-requests.mjs';
import {
  WorkloadContractError,
  validateJournalAbsentSubmission,
  validateJournalPresentSubmission,
} from '../scripts/workflow/workload-contract.mjs';
import { authorizationInput } from './fixtures/authorization-input.mjs';
import {
  renderIntent,
  seedWithDefaults,
  stableId,
} from './fixtures/fake-gala-api.mjs';

const run = promisify(execFile);
const REPORT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../scripts/workflow/report.mjs',
);
const REPOSITORY = 'gala-author/site';
const REPOSITORY_ID = '4242';
const RUN_ID = '987654321';
const OPERATION_ID = stableId();
const CAPABILITY = 'A'.repeat(43);

/** @type {Record<string, any>} */
let intent;
/** @type {string} */
let workspace;
/** @type {import('node:http').Server} */
let server;
/** @type {string} */
let origin;
/** @type {{authorization: string, body: Record<string, any>}[]} */
let received;

before(async () => {
  const { request, derived } = buildDeploymentIntentRequest(
    /** @type {any} */ (
      authorizationInput({
        adapterId: 'github-pages',
        operationId: OPERATION_ID,
        repositoryId: REPOSITORY_ID,
        runId: RUN_ID,
        runAttempt: 1,
      })
    ),
  );
  intent = renderIntent(
    request,
    seedWithDefaults({
      galaIssuer: 'https://api.gala.example/',
      repository: REPOSITORY,
      repositoryId: REPOSITORY_ID,
      operationId: OPERATION_ID,
      policyReleaseId: '019c0000-0000-7000-8000-0000000000bb',
    }),
    {
      intentId: stableId(),
      artifactId: derived.artifactId,
      attemptId: derived.attemptId,
      generationId: derived.proposedGenerationId,
      authorityId: stableId(),
      binding: { repositoryId: REPOSITORY_ID, runId: RUN_ID, runAttempt: 1 },
      ...(derived.pagesBuildVersion === undefined
        ? {}
        : { pagesBuildVersion: derived.pagesBuildVersion }),
    },
  );
  workspace = await mkdtemp(path.join(tmpdir(), 'gala-report-absent-'));
  received = [];
  server = createServer((request, response) => {
    /** @type {Buffer[]} */
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        authorization: String(request.headers.authorization),
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          operationId: OPERATION_ID,
          phase: 'accepted',
          statusUrl: `/v2/operations/${OPERATION_ID}`,
        }),
      );
    });
  });
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(undefined)),
  );
  origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(() => resolve(undefined)));
  await rm(workspace, { recursive: true, force: true });
});

/**
 * Run `report.mjs` over a fresh inbox holding the report challenge and,
 * optionally, a journal carrier.
 *
 * @param {{journal?: Record<string, unknown>, journalDigest?: string, failureCode?: string}} options
 *   the deploy outcome the report is handed
 * @returns {Promise<{body: Record<string, any>, evidence: Record<string, any>}>}
 *   the submitted body and the evidence record
 */
async function report(options) {
  const dir = await mkdtemp(path.join(workspace, 'run-'));
  const inbox = path.join(dir, 'inbox');
  await mkdir(inbox);
  const challenge = Buffer.from(JSON.stringify({ deploymentIntent: intent }));
  await writeFile(path.join(inbox, 'challenge.jcs'), challenge);
  let journalDigest = options.journalDigest ?? '';
  if (options.journal !== undefined) {
    const bytes = Buffer.from(JSON.stringify(options.journal));
    await writeFile(path.join(inbox, 'journal.jcs'), bytes);
    journalDigest = carrierDigest(bytes);
  }
  const evidence = path.join(dir, 'evidence.jcs');
  received.length = 0;
  await run(
    process.execPath,
    [
      REPORT,
      '--api-origin',
      origin,
      '--inbox',
      inbox,
      '--challenge-digest',
      carrierDigest(challenge),
      '--journal-digest',
      journalDigest,
      '--failure-code',
      options.failureCode ?? '',
      '--repository-id',
      REPOSITORY_ID,
      '--publisher-version',
      '0.1.0',
      '--evidence-out',
      evidence,
    ],
    {
      env: {
        PATH: process.env.PATH ?? '',
        GITHUB_RUN_ID: RUN_ID,
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_REPOSITORY_ID: REPOSITORY_ID,
        GITHUB_REF: `refs/heads/gala/publish/${OPERATION_ID}`,
        WORKLOAD_ALLOW_LOOPBACK_ORIGIN: '1',
        REPORTING_CAPABILITY: CAPABILITY,
      },
    },
  );
  assert.equal(received.length, 1, 'exactly one submission is posted');
  assert.equal(received[0]?.authorization, `Gala-Receipt ${CAPABILITY}`);
  return {
    body: /** @type {Record<string, any>} */ (received[0]?.body),
    evidence: JSON.parse(await readFile(evidence, 'utf8')),
  };
}

test('no journal carrier and a printed code: the failure receipt says the journal is absent and states the code', async () => {
  const { body, evidence } = await report({ failureCode: 'OIDC_FAILED' });
  validateJournalAbsentSubmission(body);
  assert.deepEqual(body.deployFailure, {
    journal: 'absent',
    failureCode: 'OIDC_FAILED',
  });
  assert.equal(body.kernelJournal, undefined);
  assert.deepEqual(body.observedRoutes, []);
  assert.equal(body.operationId, OPERATION_ID);
  assert.equal(body.adapterId, 'github-pages');
  assert.equal(body.workflowStartedAt, body.workflowCompletedAt);
  assert.equal(evidence.journal, 'absent');
  assert.equal(evidence.failureCode, 'OIDC_FAILED');
  assert.equal(evidence.outcome, 'submission-recorded');
});

test('no journal carrier and no printed code: DEPLOY_CRASHED', async () => {
  const { body } = await report({});
  assert.deepEqual(body.deployFailure, {
    journal: 'absent',
    failureCode: 'DEPLOY_CRASHED',
  });
});

test('a code that is not the closed shape (it travelled through a log) is not trusted', async () => {
  for (const printed of [
    'lower_case',
    'X',
    'HAS SPACE',
    `A${'B'.repeat(64)}`,
  ]) {
    const { body } = await report({ failureCode: printed });
    assert.equal(body.deployFailure.failureCode, 'DEPLOY_CRASHED', printed);
  }
});

test('a classified failure journal with no attempts reports its own code and stage, not the printed one', async () => {
  const { body, evidence } = await report({
    journal: {
      schemaVersion: '2.0.0',
      outcome: 'failed',
      failure: {
        code: 'DIGEST_MISMATCH',
        stage: 'artifact-digest',
        message: 'detail stays in the carrier',
      },
      attempts: [],
      observations: [],
      observedRoutes: [],
    },
    failureCode: 'OIDC_FAILED',
  });
  validateJournalAbsentSubmission(body);
  assert.deepEqual(body.deployFailure, {
    journal: 'absent',
    failureCode: 'DIGEST_MISMATCH',
    stage: 'artifact-digest',
  });
  assert.ok(
    !JSON.stringify(body).includes('detail stays in the carrier'),
    'the journal-only message is never sent',
  );
  assert.equal(evidence.journal, 'absent');
});

test('the journal-less body is the receipt submission minus kernelJournal, plus deployFailure', async () => {
  const { body } = await report({ failureCode: 'BINDING_INVALID' });
  assert.deepEqual(Object.keys(body).sort(), [
    'adapterId',
    'adapterVersion',
    'artifactByteCount',
    'artifactFileCount',
    'artifactManifestDigest',
    'deployFailure',
    'observedRoutes',
    'operationId',
    'provenanceDigest',
    'publicBaseUrl',
    'publisherPackage',
    'publisherVersion',
    'repositoryId',
    'runAttempt',
    'runId',
    'sbomDigest',
    'sourceCommit',
    'workflowCompletedAt',
    'workflowStartedAt',
  ]);
});

test('the journal-less contract is closed: no kernelJournal beside deployFailure, no unknown member, a bounded code and stage', async () => {
  const { body } = await report({ failureCode: 'BINDING_INVALID' });
  /** @type {[string, (copy: Record<string, any>) => void][]} */
  const refusals = [
    ['kernelJournal', (copy) => (copy.kernelJournal = { attempts: [] })],
    ['deployFailure', (copy) => delete copy.deployFailure],
    ['journal', (copy) => (copy.deployFailure.journal = 'present')],
    ['failureCode', (copy) => (copy.deployFailure.failureCode = 'lower')],
    ['failureCode', (copy) => delete copy.deployFailure.failureCode],
    ['stage', (copy) => (copy.deployFailure.stage = 'Bad Stage')],
    ['unknown', (copy) => (copy.deployFailure.message = 'free text')],
    ['unknown', (copy) => (copy.extra = true)],
  ];
  for (const [name, mutate] of refusals) {
    const copy = structuredClone(body);
    mutate(copy);
    assert.throws(
      () => validateJournalAbsentSubmission(copy),
      (error) => error instanceof WorkloadContractError,
      name,
    );
  }
});

/**
 * A journal with kernel evidence, produced under the intent.
 *
 * @param {Record<string, unknown>} [extra] members to add
 * @returns {Record<string, unknown>} the journal
 */
function kernelJournal(extra = {}) {
  const stageAttemptId = '019c0000-0000-7000-8000-00000000000a';
  return {
    operationId: intent.operationId,
    attemptId: intent.attemptId,
    generationId: intent.proposedGenerationId,
    adapterId: intent.adapter.adapterId,
    adapterVersion: intent.adapter.adapterVersion,
    authorization: { intentDigest: intent.intentDigest },
    attempts: [
      {
        stageAttemptId,
        causationId: intent.attemptId,
        stage: 'staging',
        kernelSequence: 1,
        outcome: 'failed',
        destinationChanged: 'no',
        inputDigest: `sha256:${'1'.repeat(64)}`,
        retryable: false,
        evidenceDigest: `sha256:${'2'.repeat(64)}`,
        resultDigest: `sha256:${'4'.repeat(64)}`,
        failureCode: 'TARGET_CAPABILITY_UNAVAILABLE',
        startedAt: '2026-09-17T00:00:00.000Z',
        completedAt: '2026-09-17T00:00:01.000Z',
      },
    ],
    observations: [
      {
        observationId: '019c0000-0000-7000-8000-00000000000c',
        stageAttemptId,
        kernelSequence: 1,
        observationClass: 'provider-error',
        outcome: 'rejected',
        destinationChanged: 'no',
        observedAt: '2026-09-17T00:00:01.000Z',
        evidenceDigest: `sha256:${'3'.repeat(64)}`,
      },
    ],
    observedRoutes: [],
    ...extra,
  };
}

test('a kernel journal with a classified failure sends deployFailure "present" beside the kernelJournal', async () => {
  const { body, evidence } = await report({
    journal: kernelJournal({
      failure: {
        code: 'PAGES_PUBLIC_REDIRECT',
        stage: 'inspect',
        message: 'stays in the carrier',
        toHost: 'www.example.com',
      },
    }),
  });
  validateJournalPresentSubmission(body);
  assert.deepEqual(body.deployFailure, {
    journal: 'present',
    failureCode: 'PAGES_PUBLIC_REDIRECT',
    stage: 'inspect',
    toHost: 'www.example.com',
  });
  assert.equal(body.kernelJournal.attempts.length, 1);
  assert.ok(!JSON.stringify(body).includes('stays in the carrier'));
  assert.equal(evidence.journal, 'present');
  assert.equal(evidence.failureCode, 'PAGES_PUBLIC_REDIRECT');
});

test('a kernel journal without a failure is the unchanged receipt submission', async () => {
  const { body, evidence } = await report({ journal: kernelJournal() });
  assert.equal(body.deployFailure, undefined);
  assert.equal(body.kernelJournal.attempts.length, 1);
  assert.equal(evidence.journal, 'present');
  assert.equal(evidence.failureCode, undefined);
});

test('the journal-present contract is the pinned submission plus a "present" deployFailure', async () => {
  const { body } = await report({
    journal: kernelJournal({
      failure: { code: 'KERNEL_STAGE_FAILED', stage: 'stage', message: 'm' },
    }),
  });
  /** @type {[(copy: Record<string, any>) => void][]} */
  const refusals = [
    [(copy) => (copy.deployFailure.journal = 'absent')],
    [(copy) => (copy.deployFailure.toHost = 'Not A Host')],
    [(copy) => delete copy.kernelJournal],
    [(copy) => (copy.deployFailure.message = 'free text')],
  ];
  for (const [mutate] of refusals) {
    const copy = structuredClone(body);
    mutate(copy);
    assert.throws(
      () => validateJournalPresentSubmission(copy),
      (error) => error instanceof WorkloadContractError,
    );
  }
});

test('the journal’s verifiedAt origin is carried into the receipt on every shape, and omitted when the journal has none', async () => {
  const origin = 'https://gala-author.github.io';
  const baseUrl = 'https://gala-author.github.io/galascribe-blog/';
  const withJournal = await report({
    journal: kernelJournal({ verifiedAt: { origin, baseUrl } }),
  });
  assert.deepEqual(withJournal.body.verifiedAt, { origin });

  const failureOnly = await report({
    journal: {
      schemaVersion: '2.0.0',
      outcome: 'failed',
      verifiedAt: { origin, baseUrl },
      failure: { code: 'CARRIER_UNREADABLE', stage: 'carrier', message: 'm' },
      attempts: [],
      observations: [],
      observedRoutes: [],
    },
  });
  const withoutVerifiedAt = structuredClone(failureOnly.body);
  delete withoutVerifiedAt.verifiedAt;
  validateJournalAbsentSubmission(withoutVerifiedAt);
  assert.deepEqual(failureOnly.body.verifiedAt, { origin });

  const none = await report({ journal: kernelJournal() });
  assert.equal(none.body.verifiedAt, undefined);
  const noJournal = await report({ failureCode: 'OIDC_FAILED' });
  assert.equal(noJournal.body.verifiedAt, undefined);
});
