/**
 * The complete workload sequence, run for real against loopback fixtures:
 *
 *   exchange(deployment-intent) -> kernel-driven deploy -> exchange(
 *   deployment-receipt) -> report
 *
 * Nothing is mocked at the seam that matters. `exchange.mjs` and `report.mjs`
 * are executed as the workflow executes them — as child processes, with the
 * runner's own environment variables — so what is proved is the scripts' real
 * behaviour: their OIDC acquisition against a real token endpoint whose RS256
 * signatures the Gala fixture actually verifies, their `$GITHUB_OUTPUT` and
 * masking behaviour, their two ceilings, and their classification of every
 * answer. The two carriers the report steps consume are the ones the exchange
 * itself wrote from the API's own response, not test-authored stand-ins.
 *
 * The deploy step runs `kernel-run.mjs` in process against the real
 * `local-directory` adapter and a real temporary directory. That is
 * deliberate: DEC-097 forbids `local-directory` from receiving a managed
 * `GITHUB_WORKLOAD` deployment intent and `exchange.mjs` refuses one (proved
 * below), so the adapter is used here in the role it does have — the
 * conformance oracle that proves the provider-neutral run without a
 * credential. The journal it produces is provider-neutral by construction,
 * which is exactly why it is the right oracle for the report.
 *
 * What is *not* proved here is anything behind a W4-16 credential: the Spaces
 * limited-key denial proof, the Pages OIDC acquisition and the two providers'
 * own REST surfaces. Those have their own fakes in their adapter packages;
 * what this file adds is the Gala half of the round trip.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as localDirectory from '@rathnasgala2/adapter-local-directory';

import { runKernelDeployment } from '../scripts/workflow/kernel-run.mjs';
import { REPORTING_CAPABILITY_PATTERN } from '../scripts/workflow/workload-contract.mjs';
import {
  ARTIFACT_FILES,
  authorizationInput,
} from './fixtures/authorization-input.mjs';
import {
  boundClaims,
  startFakeOidcIssuer,
} from './fixtures/fake-oidc-issuer.mjs';
import { startFakeGalaApi, stableId } from './fixtures/fake-gala-api.mjs';

const run = promisify(execFile);
const scripts = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../scripts/workflow',
);

const REPOSITORY = 'gala-author/site';
const REPOSITORY_ID = '4242';
const REPOSITORY_OWNER_ID = '99';
const RUN_ID = '987654321';
const RUN_ATTEMPT = 1;
const SHA = 'a'.repeat(40);
const WORKFLOW_REF = `rathnasgala2/publish/.github/workflows/publish-v2.yml@${SHA}`;
const HELPERS = Object.freeze({
  'urn:gala:workload:deployment-intent:v2': 'authorize-v2.yml',
  'urn:gala:workload:deployment-receipt:v2': 'report-v2.yml',
});

/** @type {Awaited<ReturnType<typeof startFakeOidcIssuer>>} */
let issuer;
/** @type {Awaited<ReturnType<typeof startFakeGalaApi>>} */
let gala;
/** @type {string} */
let workspace;
const operationId = stableId();

/**
 * Start the issuer with a claim builder that names the issuer's own origin,
 * which is only knowable once it is listening — so the builder closes over a
 * cell the start call fills in.
 *
 * @returns {Promise<Awaited<ReturnType<typeof startFakeOidcIssuer>>>} the issuer
 */
async function startSelfNamingIssuer() {
  /** @type {{origin: string}} */
  const self = { origin: '' };
  const started = await startFakeOidcIssuer({
    claimsFor: (audience) =>
      boundClaims({
        issuer: self.origin,
        audience,
        repository: REPOSITORY,
        repositoryId: REPOSITORY_ID,
        repositoryOwnerId: REPOSITORY_OWNER_ID,
        operationId,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
        sha: SHA,
        jobWorkflowRef: `rathnasgala2/publish/.github/workflows/${
          HELPERS[/** @type {keyof typeof HELPERS} */ (audience)] ?? 'unknown'
        }@${SHA}`,
        workflowRef: WORKFLOW_REF,
      }),
  });
  self.origin = started.issuer;
  return started;
}

before(async () => {
  issuer = await startSelfNamingIssuer();
  gala = await startFakeGalaApi({
    issuer: issuer.issuer,
    jwksUri: issuer.jwksUri,
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    repositoryOwnerId: REPOSITORY_OWNER_ID,
    operationId,
  });
  workspace = await mkdtemp(path.join(tmpdir(), 'gala-workload-'));
});

after(async () => {
  await issuer?.close();
  await gala?.close();
  if (workspace !== undefined) {
    await rm(workspace, { recursive: true, force: true });
  }
});

/**
 * The runner environment a workload job sees.
 *
 * @param {Record<string, string>} [extra] additional variables
 * @returns {Record<string, string>} the child environment
 */
function runnerEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH ?? '',
    ACTIONS_ID_TOKEN_REQUEST_URL: issuer.tokenRequestUrl,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: issuer.runnerBearer,
    GITHUB_RUN_ID: RUN_ID,
    GITHUB_RUN_ATTEMPT: String(RUN_ATTEMPT),
    // The runner's own bound identity: the report refuses an intent bound
    // to any other repository or publish ref.
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REPOSITORY_ID: REPOSITORY_ID,
    GITHUB_REF: `refs/heads/gala/publish/${operationId}`,
    WORKLOAD_ALLOW_LOOPBACK_ORIGIN: '1',
    ...extra,
  };
}

/**
 * Write one carrier file into an inbox and return its tagged digest.
 *
 * @param {string} inbox the inbox directory
 * @param {string} name the file name
 * @param {unknown} document the JSON document
 * @returns {Promise<string>} the tagged digest
 */
async function placeCarrier(inbox, name, document) {
  const bytes = Buffer.from(JSON.stringify(document), 'utf8');
  await writeFile(path.join(inbox, name), bytes);
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * The tagged digest of a file the exchange itself wrote.
 *
 * @param {string} file the file path
 * @returns {Promise<string>} the tagged digest
 */
async function digestOfFile(file) {
  return `sha256:${createHash('sha256')
    .update(await readFile(file))
    .digest('hex')}`;
}

/**
 * Read the `name=value` lines a script appended to `$GITHUB_OUTPUT`.
 *
 * @param {string} file the output file
 * @returns {Promise<Record<string, string>>} the outputs
 */
async function readOutputs(file) {
  /** @type {Record<string, string>} */
  const outputs = {};
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    if (line === '') {
      continue;
    }
    const at = line.indexOf('=');
    outputs[line.slice(0, at)] = line.slice(at + 1);
  }
  return outputs;
}

/**
 * @param {string} name the script basename
 * @param {readonly string[]} args the arguments
 * @param {Record<string, string>} env the child environment
 * @returns {Promise<{stdout: string, stderr: string}>} the child result
 */
function runScript(name, args, env) {
  return run(process.execPath, [path.join(scripts, name), ...args], { env });
}

test('the full sequence: exchange, kernel-driven deploy, receipt exchange, report', async (t) => {
  const inbox = path.join(workspace, 'inbox');
  const carrier = path.join(workspace, 'carrier');
  const destinationRoot = path.join(workspace, 'served');
  for (const directory of [inbox, carrier, destinationRoot]) {
    await mkdir(directory, { recursive: true });
  }
  const stem = `gala-r${RUN_ID}-a${RUN_ATTEMPT}`;

  // --- 1. the deployment-intent exchange --------------------------------
  // Pages is the adapter Gala can issue for today (LOCAL-60: Spaces waits
  // for the publication destination record, C2); the kernel run below still
  // uses `local-directory` as the provider-neutral oracle.
  const input = authorizationInput({
    adapterId: 'github-pages',
    operationId,
    repositoryId: REPOSITORY_ID,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
  });
  const inputDigest = await placeCarrier(
    inbox,
    `${stem}-authorization-input-v2.jcs`,
    input,
  );
  const exchangeOutput = path.join(workspace, 'exchange-output.txt');
  await writeFile(exchangeOutput, '');
  await runScript(
    'exchange.mjs',
    [
      '--purpose',
      'deployment-intent',
      '--audience',
      'urn:gala:workload:deployment-intent:v2',
      '--api-origin',
      gala.origin,
      '--inbox',
      inbox,
      '--expected-digest',
      inputDigest,
      '--out-dir',
      carrier,
    ],
    runnerEnvironment({ GITHUB_OUTPUT: exchangeOutput }),
  );

  assert.equal(
    (await readOutputs(exchangeOutput)).adapter_id,
    'github-pages',
    'adapter_id is exposed only after the returned intent has been validated',
  );
  const authorization = JSON.parse(
    await readFile(
      path.join(carrier, `${stem}-deployment-authorization-v2.jcs`),
      'utf8',
    ),
  );
  const intent = authorization.deploymentIntent;
  assert.equal(intent.operationId, operationId);
  assert.equal(intent.manifestDigest, input.manifestDigest);
  assert.equal(
    intent.verificationTier,
    'complete',
    'the API answered the closed intent document, not an echo of the request',
  );
  assert.deepEqual(
    authorization.marker,
    intent.marker,
    'the deployment-authorization carrier carries the {deploymentIntent, marker} pair',
  );
  assert.equal(
    authorization.responseKind,
    'deployment-intent',
    'the 2.8.0 kind the API answered with travels to the deploy job',
  );
  assert.deepEqual(
    intent.destination.providerBinding,
    /** @type {any} */ (input.destination).providerBinding,
    'the retained intent names the Pages coordinates Gala bound, which are the ones the request declared',
  );
  assert.equal(intent.destination.environment, 'github-pages');
  assert.match(intent.destination.targetDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    intent.subject,
    `urn:gala:workload:github:${REPOSITORY_ID}:${RUN_ID}:${RUN_ATTEMPT}`,
    'the subject is the DEC-097 workload URN, not the OIDC sub string',
  );
  assert.equal(
    intent.pagesBuildVersion,
    JSON.parse(
      await readFile(
        path.join(carrier, `${stem}-exchange-request-v2.jcs`),
        'utf8',
      ),
    ).pagesBuildVersion,
    'the API derived the same build version this job sent (LOCAL-57)',
  );

  await t.test(
    'the exchange journal carries the three envelope digests the intent binds and records that the API retained them',
    async () => {
      const head = JSON.parse(
        await readFile(
          path.join(carrier, `${stem}-exchange-journal-v2.jcs`),
          'utf8',
        ),
      );
      for (const member of [
        'manifestDigest',
        'provenanceDigest',
        'sbomDigest',
      ]) {
        assert.equal(head[member], input[member], `${member} in the journal`);
        assert.equal(head[member], intent[member], `${member} retained`);
        assert.equal(head.derivationsAccepted[member], true);
      }
      // LOCAL-60: what this job sent was retained, and what it did not
      // send is recorded as Gala's derivation.
      assert.equal(head.derivationsAccepted.destination, true);
      assert.equal(head.derivationsAccepted.rebuildRecord, true);
      assert.deepEqual(head.apiDerived, {
        destination: ['environment', 'targetDigest'],
        rebuildRecord: [
          'policyReleaseId',
          'buildPolicyDecisionDigest',
          'packageReleaseCatalogDigest',
          'destinationCapabilityDigest',
        ],
        capabilityDecisionDigest: true,
      });
    },
  );

  await t.test(
    'the request the caller sent carried every required member',
    async () => {
      const sent = JSON.parse(
        await readFile(
          path.join(carrier, `${stem}-exchange-request-v2.jcs`),
          'utf8',
        ),
      );
      assert.equal(sent.purpose, 'deployment-intent');
      assert.equal(sent.artifactFileCount, ARTIFACT_FILES.length);
      assert.equal(sent.spacesStagePrefix, undefined);
      assert.match(String(sent.pagesBuildVersion), /^[0-9a-f]{40}$/u);
      // Nothing Gala derives is sent (schema 2.9.0).
      assert.equal(sent.destination.environment, undefined);
      assert.equal(sent.destination.targetDigest, undefined);
      assert.equal(sent.capabilityDecisionDigest, undefined);
      for (const member of [
        'policyReleaseId',
        'buildPolicyDecisionDigest',
        'packageReleaseCatalogDigest',
        'destinationCapabilityDigest',
      ]) {
        assert.equal(sent.rebuildRecord[member], undefined, member);
      }
    },
  );

  // --- 2. the kernel-driven run against the real local-directory adapter --
  const outcome = await runKernelDeployment({
    adapterModule: { ...localDirectory },
    destination: { root: destinationRoot },
    destinationIdentity: intent.destination,
    intent,
    files: [...ARTIFACT_FILES],
  });
  assert.equal(outcome.decision, 'activate');
  assert.equal(outcome.verified, true);
  assert.deepEqual(
    outcome.journal.attempts.map((attempt) => attempt.stage),
    ['staging', 'activation', 'cleanup'],
  );
  assert.deepEqual(
    outcome.journal.attempts.map((attempt) => attempt.kernelSequence),
    [1, 2, 3],
    'the attempt stream is gap-free',
  );
  assert.deepEqual(
    outcome.journal.observations.map(
      (observation) => observation.kernelSequence,
    ),
    [1, 2],
    'the observation stream is gap-free',
  );
  const attemptIds = new Set(
    outcome.journal.attempts.map((attempt) => attempt.stageAttemptId),
  );
  for (const observation of outcome.journal.observations) {
    assert.ok(
      attemptIds.has(observation.stageAttemptId),
      'every observation witnesses one of this journal own stage attempts',
    );
  }
  assert.equal(outcome.journal.attempts[0]?.destinationChanged, 'no');
  assert.equal(
    outcome.journal.attempts[1]?.destinationChanged,
    'yes',
    'only the activation attempt reports a changed destination',
  );

  await t.test(
    'the served destination really carries the artifact',
    async () => {
      const served = await readFile(
        path.join(destinationRoot, 'current', 'index.html'),
        'utf8',
      );
      assert.equal(served, ARTIFACT_FILES[0]?.bytes.toString('utf8'));
    },
  );

  // --- 3. the deployment-receipt exchange -------------------------------
  const challengePath = path.join(carrier, `${stem}-report-challenge-v2.jcs`);
  const challengeDigest = await digestOfFile(challengePath);
  await writeFile(
    path.join(inbox, `${stem}-report-challenge-v2.jcs`),
    await readFile(challengePath),
  );
  const receiptOutput = path.join(workspace, 'receipt-output.txt');
  await writeFile(receiptOutput, '');
  const receiptRun = await runScript(
    'exchange.mjs',
    [
      '--purpose',
      'deployment-receipt',
      '--audience',
      'urn:gala:workload:deployment-receipt:v2',
      '--api-origin',
      gala.origin,
      '--inbox',
      inbox,
      '--expected-digest',
      challengeDigest,
      '--out-dir',
      carrier,
    ],
    runnerEnvironment({ GITHUB_OUTPUT: receiptOutput }),
  );
  const outputs = await readOutputs(receiptOutput);
  assert.equal(outputs.report_state, 'capability-issued');
  assert.match(
    String(outputs.reporting_capability),
    REPORTING_CAPABILITY_PATTERN,
  );
  assert.ok(
    receiptRun.stdout.includes(`::add-mask::${outputs.reporting_capability}`),
    'the capability is registered with the runner log masker before it is emitted',
  );

  await t.test(
    'the journal head records the issuance and never the capability',
    async () => {
      const head = await readFile(
        path.join(carrier, `${stem}-exchange-journal-v2.jcs`),
        'utf8',
      );
      assert.ok(head.includes('"reportingCapabilityIssued":true'));
      assert.ok(head.includes('"reportingCapabilityLength":43'));
      assert.equal(
        JSON.parse(head).responseKind,
        'deployment-receipt-capability-issued',
      );
      assert.ok(
        !head.includes(String(outputs.reporting_capability)),
        'the capability bytes never reach the journal head',
      );
    },
  );

  // --- 4. the report -----------------------------------------------------
  const journalDigest = await placeCarrier(
    inbox,
    `${stem}-kernel-journal-v2.jcs`,
    {
      // The head `deploy.mjs` writes: the identities the run deployed under.
      // The report refuses a journal whose head names another intent.
      operationId: intent.operationId,
      attemptId: intent.attemptId,
      generationId: intent.proposedGenerationId,
      adapterId: intent.adapter.adapterId,
      adapterVersion: intent.adapter.adapterVersion,
      authorization: { intentDigest: intent.intentDigest },
      attempts: outcome.journal.attempts,
      observations: outcome.journal.observations,
      observedRoutes: outcome.journal.observedRoutes,
      destinationGenerationId: outcome.generationId,
    },
  );
  // The report binds to the intent before it spends anything: a runner
  // repository id the intent's rebuild record was not bound to, and a
  // journal whose head names another intent, are both refused before the
  // capability is presented (reviewer-added, PUBLISH-S4-5).
  const reportArguments = (
    /** @type {string} */ journal,
    /** @type {string} */ repositoryId,
    /** @type {string} */ evidence,
  ) => [
    '--api-origin',
    gala.origin,
    '--inbox',
    inbox,
    '--challenge-digest',
    challengeDigest,
    '--journal-digest',
    journal,
    '--repository-id',
    repositoryId,
    '--publisher-version',
    '0.1.0',
    '--workflow-started-at',
    '2026-09-17T00:00:00.000Z',
    '--evidence-out',
    evidence,
  ];
  await assert.rejects(
    runScript(
      'report.mjs',
      reportArguments(
        journalDigest,
        '9999',
        path.join(carrier, 'mismatched-repository-evidence.jcs'),
      ),
      runnerEnvironment({
        REPORTING_CAPABILITY: String(outputs.reporting_capability),
      }),
    ),
    /REPORT_REPOSITORY_MISMATCH/u,
    'a runner repository id the intent was not bound to is refused',
  );
  const foreignJournalDigest = await placeCarrier(
    inbox,
    `${stem}-foreign-kernel-journal-v2.jcs`,
    {
      operationId: stableId(),
      attemptId: intent.attemptId,
      generationId: intent.proposedGenerationId,
      adapterId: intent.adapter.adapterId,
      adapterVersion: intent.adapter.adapterVersion,
      authorization: { intentDigest: intent.intentDigest },
      attempts: outcome.journal.attempts,
      observations: outcome.journal.observations,
      observedRoutes: outcome.journal.observedRoutes,
      destinationGenerationId: outcome.generationId,
    },
  );
  await assert.rejects(
    runScript(
      'report.mjs',
      reportArguments(
        foreignJournalDigest,
        REPOSITORY_ID,
        path.join(carrier, 'foreign-journal-evidence.jcs'),
      ),
      runnerEnvironment({
        REPORTING_CAPABILITY: String(outputs.reporting_capability),
      }),
    ),
    /DEPLOY_INTENT_IDENTITY_MISMATCH.*operationId/u,
    'a journal produced under another intent cannot be reported against this one',
  );
  assert.equal(
    gala.state.receivedSubmissions.length,
    0,
    'neither refusal reached the API or spent the capability',
  );

  const evidencePath = path.join(carrier, 'report-evidence-v2.jcs');
  const reportOutput = path.join(workspace, 'report-output.txt');
  await writeFile(reportOutput, '');
  await runScript(
    'report.mjs',
    [
      '--api-origin',
      gala.origin,
      '--inbox',
      inbox,
      '--challenge-digest',
      challengeDigest,
      '--journal-digest',
      journalDigest,
      '--repository-id',
      REPOSITORY_ID,
      '--publisher-version',
      '0.1.0',
      '--workflow-started-at',
      '2026-09-17T00:00:00.000Z',
      '--evidence-out',
      evidencePath,
    ],
    runnerEnvironment({
      GITHUB_OUTPUT: reportOutput,
      REPORTING_CAPABILITY: String(outputs.reporting_capability),
    }),
  );

  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(evidence.outcome, 'submission-recorded');
  assert.equal(evidence.httpStatus, 202);
  assert.equal(evidence.operationId, operationId);
  assert.ok(
    !JSON.stringify(evidence).includes(String(outputs.reporting_capability)),
    'the evidence record carries no capability',
  );
  assert.equal(gala.state.receivedSubmissions.length, 1);
  const submitted = gala.state.receivedSubmissions[0];
  assert.equal(submitted.kernelJournal.attempts.length, 3);
  assert.equal(submitted.destinationGenerationId, outcome.generationId);
  assert.equal(
    submitted.observedRoutes.length,
    2,
    'the two HTML routes are the bounded observed-route sample',
  );
  assert.match(
    String((await readOutputs(reportOutput)).operation_status_url),
    /^\/v2\/organizations\/[0-9a-f-]+\/operations\//u,
  );

  // --- 5. the replay path ------------------------------------------------
  const replayOutput = path.join(workspace, 'replay-output.txt');
  await writeFile(replayOutput, '');
  await runScript(
    'exchange.mjs',
    [
      '--purpose',
      'deployment-receipt',
      '--audience',
      'urn:gala:workload:deployment-receipt:v2',
      '--api-origin',
      gala.origin,
      '--inbox',
      inbox,
      '--expected-digest',
      challengeDigest,
      '--out-dir',
      carrier,
    ],
    runnerEnvironment({ GITHUB_OUTPUT: replayOutput }),
  );
  const replayOutputs = await readOutputs(replayOutput);
  assert.equal(
    replayOutputs.report_state,
    'submission-recorded',
    'once a submission is recorded the exchange returns the stable handle, never a second capability',
  );
  assert.equal(replayOutputs.reporting_capability, undefined);
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(carrier, `${stem}-receipt-authorization-v2.jcs`),
        'utf8',
      ),
    ).responseKind,
    'deployment-receipt-submission-recorded',
  );

  // --- 5b. a 2.7.x server: the same replay without a kind still parses ---
  gala.state.omitKind = true;
  try {
    const legacyOutput = path.join(workspace, 'legacy-output.txt');
    await writeFile(legacyOutput, '');
    await runScript(
      'exchange.mjs',
      [
        '--purpose',
        'deployment-receipt',
        '--audience',
        'urn:gala:workload:deployment-receipt:v2',
        '--api-origin',
        gala.origin,
        '--inbox',
        inbox,
        '--expected-digest',
        challengeDigest,
        '--out-dir',
        carrier,
      ],
      runnerEnvironment({ GITHUB_OUTPUT: legacyOutput }),
    );
    assert.equal(
      (await readOutputs(legacyOutput)).report_state,
      'submission-recorded',
    );
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(carrier, `${stem}-exchange-journal-v2.jcs`),
          'utf8',
        ),
      ).responseKind,
      null,
      'a kind-less body is recorded as answered by a server that sent none',
    );
  } finally {
    gala.state.omitKind = false;
  }

  // --- 6. the consumed capability ---------------------------------------
  await assert.rejects(
    runScript(
      'report.mjs',
      [
        '--api-origin',
        gala.origin,
        '--inbox',
        inbox,
        '--challenge-digest',
        challengeDigest,
        '--journal-digest',
        journalDigest,
        '--repository-id',
        REPOSITORY_ID,
        '--publisher-version',
        '0.1.0',
        '--workflow-started-at',
        '2026-09-17T00:00:00.000Z',
        '--evidence-out',
        path.join(carrier, 'replayed-evidence.jcs'),
      ],
      runnerEnvironment({
        REPORTING_CAPABILITY: String(outputs.reporting_capability),
      }),
    ),
    /REPORT_SUBMISSION_CAPABILITY_INVALID.*401 REPORTING_CAPABILITY_INVALID/su,
    'a consumed capability answers the same non-enumerating 401 as an unknown one',
  );
  assert.equal(
    gala.state.receivedSubmissions.length,
    1,
    'the replayed submission was never recorded a second time',
  );
});

test('a local-directory intent is refused by the caller, never deployed', async () => {
  const inbox = path.join(workspace, 'local-inbox');
  await mkdir(inbox, { recursive: true });
  const localOperationId = stableId();
  /** @type {{origin: string}} */
  const localSelf = { origin: '' };
  const localIssuer = await startFakeOidcIssuer({
    claimsFor: (audience) =>
      boundClaims({
        issuer: localSelf.origin,
        audience,
        repository: REPOSITORY,
        repositoryId: REPOSITORY_ID,
        repositoryOwnerId: REPOSITORY_OWNER_ID,
        operationId: localOperationId,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
        sha: SHA,
        jobWorkflowRef: `rathnasgala2/publish/.github/workflows/authorize-v2.yml@${SHA}`,
        workflowRef: WORKFLOW_REF,
      }),
  });
  localSelf.origin = localIssuer.issuer;
  try {
    const localGala = await startFakeGalaApi({
      issuer: localIssuer.issuer,
      jwksUri: localIssuer.jwksUri,
      repository: REPOSITORY,
      repositoryId: REPOSITORY_ID,
      repositoryOwnerId: REPOSITORY_OWNER_ID,
      operationId: localOperationId,
    });
    try {
      const inputDigest = await placeCarrier(
        inbox,
        'authorization-input.jcs',
        authorizationInput({
          adapterId: 'local-directory',
          operationId: localOperationId,
          repositoryId: REPOSITORY_ID,
          runId: RUN_ID,
          runAttempt: RUN_ATTEMPT,
        }),
      );
      await assert.rejects(
        runScript(
          'exchange.mjs',
          [
            '--purpose',
            'deployment-intent',
            '--audience',
            'urn:gala:workload:deployment-intent:v2',
            '--api-origin',
            localGala.origin,
            '--inbox',
            inbox,
            '--expected-digest',
            inputDigest,
            '--out-dir',
            inbox,
          ],
          {
            PATH: process.env.PATH ?? '',
            ACTIONS_ID_TOKEN_REQUEST_URL: localIssuer.tokenRequestUrl,
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: localIssuer.runnerBearer,
            GITHUB_RUN_ID: RUN_ID,
            GITHUB_RUN_ATTEMPT: String(RUN_ATTEMPT),
            WORKLOAD_ALLOW_LOOPBACK_ORIGIN: '1',
          },
        ),
        /WORKLOAD_BINDING_INVALID: the issued intent names local-directory/u,
      );
    } finally {
      await localGala.close();
    }
  } finally {
    await localIssuer.close();
  }
});

test('a do-spaces authorization input is refused by Gala with 409 INVALID_SOURCE_STATE until its destination record exists (C2)', async () => {
  const inbox = path.join(workspace, 'spaces-inbox');
  await mkdir(inbox, { recursive: true });
  const spacesOperationId = stableId();
  /** @type {{origin: string}} */
  const spacesSelf = { origin: '' };
  const spacesIssuer = await startFakeOidcIssuer({
    claimsFor: (audience) =>
      boundClaims({
        issuer: spacesSelf.origin,
        audience,
        repository: REPOSITORY,
        repositoryId: REPOSITORY_ID,
        repositoryOwnerId: REPOSITORY_OWNER_ID,
        operationId: spacesOperationId,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
        sha: SHA,
        jobWorkflowRef: `rathnasgala2/publish/.github/workflows/authorize-v2.yml@${SHA}`,
        workflowRef: WORKFLOW_REF,
      }),
  });
  spacesSelf.origin = spacesIssuer.issuer;
  try {
    const spacesGala = await startFakeGalaApi({
      issuer: spacesIssuer.issuer,
      jwksUri: spacesIssuer.jwksUri,
      repository: REPOSITORY,
      repositoryId: REPOSITORY_ID,
      repositoryOwnerId: REPOSITORY_OWNER_ID,
      operationId: spacesOperationId,
    });
    try {
      const inputDigest = await placeCarrier(
        inbox,
        'authorization-input.jcs',
        authorizationInput({
          adapterId: 'do-spaces',
          operationId: spacesOperationId,
          repositoryId: REPOSITORY_ID,
          runId: RUN_ID,
          runAttempt: RUN_ATTEMPT,
        }),
      );
      await assert.rejects(
        runScript(
          'exchange.mjs',
          [
            '--purpose',
            'deployment-intent',
            '--audience',
            'urn:gala:workload:deployment-intent:v2',
            '--api-origin',
            spacesGala.origin,
            '--inbox',
            inbox,
            '--expected-digest',
            inputDigest,
            '--out-dir',
            inbox,
          ],
          {
            PATH: process.env.PATH ?? '',
            ACTIONS_ID_TOKEN_REQUEST_URL: spacesIssuer.tokenRequestUrl,
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: spacesIssuer.runnerBearer,
            GITHUB_RUN_ID: RUN_ID,
            GITHUB_RUN_ATTEMPT: String(RUN_ATTEMPT),
            WORKLOAD_ALLOW_LOOPBACK_ORIGIN: '1',
          },
        ),
        /WORKLOAD_EXCHANGE_REFUSED: the API answered HTTP 409 INVALID_SOURCE_STATE/u,
      );
      assert.equal(spacesGala.state.intent, null);
    } finally {
      await spacesGala.close();
    }
  } finally {
    await spacesIssuer.close();
  }
});

test('a body the contract refuses is never sent, so no assertion is spent on it', async () => {
  const inbox = path.join(workspace, 'invalid-inbox');
  await mkdir(inbox, { recursive: true });
  const broken = authorizationInput({ operationId, adapterId: 'do-spaces' });
  broken.lockDigest = 'not-a-digest';
  const digest = await placeCarrier(inbox, 'authorization-input.jcs', broken);
  await assert.rejects(
    runScript(
      'exchange.mjs',
      [
        '--purpose',
        'deployment-intent',
        '--audience',
        'urn:gala:workload:deployment-intent:v2',
        '--api-origin',
        gala.origin,
        '--inbox',
        inbox,
        '--expected-digest',
        digest,
        '--out-dir',
        inbox,
      ],
      runnerEnvironment(),
    ),
    /VALIDATION_FAILED: \/lockDigest/u,
  );
});

test('a non-https api origin is refused before any request is built', async () => {
  await assert.rejects(
    runScript(
      'report.mjs',
      [
        '--api-origin',
        'http://gala.example',
        '--inbox',
        workspace,
        '--challenge-digest',
        `sha256:${'0'.repeat(64)}`,
        '--journal-digest',
        `sha256:${'0'.repeat(64)}`,
        '--repository-id',
        REPOSITORY_ID,
        '--publisher-version',
        '0.1.0',
        '--workflow-started-at',
        '2026-09-17T00:00:00.000Z',
        '--evidence-out',
        path.join(workspace, 'unused.jcs'),
      ],
      runnerEnvironment({ WORKLOAD_ALLOW_LOOPBACK_ORIGIN: '0' }),
    ),
    /GALA_API_ORIGIN_INVALID/u,
  );
});

test('a purpose and audience that disagree are refused before the assertion is requested', async () => {
  await assert.rejects(
    runScript(
      'exchange.mjs',
      [
        '--purpose',
        'deployment-intent',
        '--audience',
        'urn:gala:workload:deployment-receipt:v2',
        '--api-origin',
        gala.origin,
        '--inbox',
        workspace,
        '--expected-digest',
        `sha256:${'0'.repeat(64)}`,
        '--out-dir',
        workspace,
      ],
      runnerEnvironment(),
    ),
    /WORKLOAD_AUDIENCE_MISMATCH/u,
  );
});
