/**
 * The two purpose-discriminated GitHub OIDC workload exchanges.
 *
 * `authorize-v2.yml` calls this with purpose `deployment-intent` and
 * audience `urn:gala:workload:deployment-intent:v2`; `report-v2.yml` calls
 * it with purpose `deployment-receipt` and audience
 * `urn:gala:workload:deployment-receipt:v2`. The two are never
 * interchangeable, and a helper invoked directly (rather than from its own
 * same-commit workflow) is rejected by the API, not here.
 *
 * Both purposes follow the same order, and the order is the point:
 *
 * 1. Build the exact request from the already verified carrier.
 * 2. Validate it against the closed contract (`workload-contract.mjs`).
 * 3. Only then acquire the single-use OIDC assertion for that exact
 *    audience, and send.
 *
 * An assertion is a one-use authority bound to a bound tuple. Acquiring one
 * for a body that could not have been accepted spends it for nothing, so
 * the validation step is deliberately before the acquisition step.
 *
 * Nothing this script writes carries a credential. The assertion is never
 * persisted at all; the issued reporting capability reaches exactly one
 * place — a masked `$GITHUB_OUTPUT` line — while the job's journal head
 * records only that a capability of the contracted shape was issued, its
 * generation and its expiry.
 *
 * @module
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findCarrier } from './decode-carrier.mjs';
import { parseOptions, requireOption } from './carrier.mjs';
import {
  DEPLOYMENT_INTENT_AUDIENCE,
  DEPLOYMENT_RECEIPT_AUDIENCE,
  GalaApiError,
  postReceiptExchange,
  requestOidcAssertion,
  resolveApiOrigin,
} from './gala-api.mjs';
import {
  ADAPTER_ENVIRONMENTS,
  REBUILD_RECORD_API_DERIVED,
  REPORTING_CAPABILITY_PATTERN,
} from './workload-contract.mjs';
import { canonicalJson } from './workload-identity.mjs';
import {
  buildDeploymentIntentRequest,
  buildReceiptExchangeRequest,
} from './workload-requests.mjs';
import { runIfMain } from '../run-if-main.mjs';

/** The exact audience each purpose is bound to. */
const AUDIENCES = Object.freeze({
  'deployment-intent': DEPLOYMENT_INTENT_AUDIENCE,
  'deployment-receipt': DEPLOYMENT_RECEIPT_AUDIENCE,
});

/**
 * Append one non-secret `name=value` line to the step's `$GITHUB_OUTPUT`.
 *
 * @param {string} name the output name
 * @param {string} value the single-line value
 * @returns {Promise<void>} resolves once appended
 */
async function writeOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file === undefined || file === '') {
    return;
  }
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`WORKFLOW_OUTPUT_MULTILINE_REFUSED: ${name}`);
  }
  await appendFile(file, `${name}=${value}\n`, 'utf8');
}

/**
 * Register one value with the runner's log masker and then emit it as a step
 * output. The mask command is issued first and unconditionally, so the value
 * cannot appear unmasked even in the failure path of the write that follows.
 *
 * @param {string} name the output name
 * @param {string} value the secret value
 * @returns {Promise<void>} resolves once masked and appended
 */
async function writeMaskedOutput(name, value) {
  process.stdout.write(`::add-mask::${value}\n`);
  await writeOutput(name, value);
}

/**
 * The credential-free journal head every exchange writes, whatever the
 * outcome. It is the job's own evidence that the exchange happened and what
 * it produced, and it is written before any secret-bearing step output so a
 * failure between the two still leaves the evidence behind.
 *
 * @param {string} outDir the carrier directory
 * @param {string} stem the run-stamped file stem
 * @param {Record<string, unknown>} head the secret-free facts
 * @returns {Promise<void>} resolves once written
 */
async function writeJournalHead(outDir, stem, head) {
  await writeFile(
    path.join(outDir, `${stem}-exchange-journal-v2.jcs`),
    Buffer.from(JSON.stringify(head), 'utf8'),
  );
}

/**
 * Whether every member this job sent in one request object is retained
 * byte-for-byte in the corresponding intent object. Members the job did not
 * send are not judged here; they are the API's own derivations.
 *
 * @param {Record<string, unknown>} sent the request object
 * @param {Record<string, unknown>} retained the intent object
 * @returns {boolean} `true` when no sent member was replaced
 */
function sentMembersRetained(sent, retained) {
  return Object.keys(sent).every(
    (member) => canonicalJson(sent[member]) === canonicalJson(retained[member]),
  );
}

/**
 * Run the `deployment-intent` exchange: submit the frozen handoff metadata,
 * receive the immutable intent, and publish the two credential-free carriers
 * the deploy and report jobs consume.
 *
 * @param {{options: Record<string, string>, origin: string, outDir: string, stem: string}} job
 *   the job context
 * @returns {Promise<void>} resolves once both carriers are written
 */
async function exchangeDeploymentIntent(job) {
  const input = JSON.parse(
    (
      await findCarrier(
        requireOption(job.options, 'inbox'),
        requireOption(job.options, 'expected-digest'),
      )
    ).bytes.toString('utf8'),
  );
  if (input.purpose !== 'deployment-intent') {
    throw new Error(
      `WORKLOAD_PURPOSE_MISMATCH: the authorization input declares ${String(input.purpose)}`,
    );
  }

  const { request, derived } = buildDeploymentIntentRequest(input);
  await writeFile(
    path.join(job.outDir, `${job.stem}-exchange-request-v2.jcs`),
    Buffer.from(JSON.stringify(request), 'utf8'),
  );

  const assertion = await requestOidcAssertion(AUDIENCES['deployment-intent']);
  const answer = await postReceiptExchange({
    origin: job.origin,
    assertion,
    request,
  });
  if (answer.state !== 'deployment-authorization') {
    throw new GalaApiError(
      'WORKLOAD_EXCHANGE_RESPONSE_INVALID',
      `the deployment-intent exchange answered ${answer.state}`,
      { status: 200 },
    );
  }

  const intent = /** @type {Record<string, unknown>} */ (
    answer.body.deploymentIntent
  );
  const adapterId = String(
    /** @type {Record<string, unknown>} */ (intent.adapter).adapterId,
  );
  if (adapterId !== 'do-spaces' && adapterId !== 'github-pages') {
    throw new Error(
      `WORKLOAD_BINDING_INVALID: the issued intent names ${adapterId}, which has no managed deploy job`,
    );
  }
  // Schema 2.9.0 (LOCAL-60): the API renders the destination from its own
  // record. The one thing this job can check is that the record it rendered
  // is for the adapter the verified source's lock selects, with that
  // adapter's environment constant; an intent for another adapter, or with
  // an environment outside the closed vocabulary, authorizes nothing here.
  const lockAdapterId = String(
    /** @type {Record<string, unknown>} */ (input.adapter).adapterId,
  );
  const destination = /** @type {Record<string, unknown>} */ (
    intent.destination ?? {}
  );
  if (adapterId !== lockAdapterId || destination.adapterId !== lockAdapterId) {
    throw new Error(
      `WORKLOAD_INTENT_DESTINATION_MISMATCH: the lock selects ${lockAdapterId} but the issued intent's adapter is ${adapterId} and its destination.adapterId is ${String(destination.adapterId)}`,
    );
  }
  if (
    destination.environment !==
    ADAPTER_ENVIRONMENTS[
      /** @type {keyof typeof ADAPTER_ENVIRONMENTS} */ (lockAdapterId)
    ]
  ) {
    throw new Error(
      `WORKLOAD_INTENT_DESTINATION_MISMATCH: the issued intent's destination.environment is ${String(destination.environment)}, not the ${lockAdapterId} constant`,
    );
  }

  // `responseKind` is the 2.8.0 discriminator the API answered with, or
  // `null` from a 2.7.x server; the deploy job records it so the kernel run's
  // journal head states which contract generation authorized it.
  await writeFile(
    path.join(job.outDir, `${job.stem}-deployment-authorization-v2.jcs`),
    Buffer.from(
      JSON.stringify({
        deploymentIntent: intent,
        marker: intent.marker,
        responseKind: answer.kind,
      }),
      'utf8',
    ),
  );
  await writeFile(
    path.join(job.outDir, `${job.stem}-report-challenge-v2.jcs`),
    Buffer.from(
      JSON.stringify({
        deploymentIntent: intent,
        reportChallengeId: answer.body.reportChallengeId,
        reportChallengeExpiresAt: answer.body.reportChallengeExpiresAt,
      }),
      'utf8',
    ),
  );
  await writeJournalHead(job.outDir, job.stem, {
    purpose: 'deployment-intent',
    state: 'deployment-authorization',
    responseKind: answer.kind,
    adapterId,
    operationId: intent.operationId,
    attemptId: intent.attemptId,
    proposedGenerationId: intent.proposedGenerationId,
    intentDigest: intent.intentDigest,
    // The envelope metadata the intent binds: the deploy job refuses an
    // envelope whose records digest differently, so these are the exact
    // provenance and SBOM the operation will be reported against.
    manifestDigest: intent.manifestDigest,
    provenanceDigest: intent.provenanceDigest,
    sbomDigest: intent.sbomDigest,
    derived,
    // Whether the API accepted this job's own derivations or replaced them
    // is evidence in its own right: a disagreement means the retained intent
    // is bound to identities this run did not choose, and every later stage
    // must use the intent's, not its own.
    derivationsAccepted: {
      artifactId: intent.artifactId === derived.artifactId,
      // The three envelope digests are the freeze job's own recomputation;
      // the API retains them verbatim (DEC-097 section 6), so a disagreement
      // here means the intent was issued for a different envelope.
      manifestDigest: intent.manifestDigest === request.manifestDigest,
      provenanceDigest: intent.provenanceDigest === request.provenanceDigest,
      sbomDigest: intent.sbomDigest === request.sbomDigest,
      attemptId: intent.attemptId === derived.attemptId,
      proposedGenerationId:
        intent.proposedGenerationId === derived.proposedGenerationId,
      // LOCAL-57: the API derives both conditional members itself; a value
      // this job sent that disagreed would have been refused with 422, so
      // `true` here is the API's agreement, not this job's assumption.
      ...(derived.pagesBuildVersion === undefined
        ? {}
        : {
            pagesBuildVersion:
              intent.pagesBuildVersion === derived.pagesBuildVersion,
          }),
      ...(derived.spacesStagePrefix === undefined
        ? {}
        : {
            spacesStagePrefix:
              intent.spacesStagePrefix === derived.spacesStagePrefix,
          }),
      // Schema 2.9.0 (LOCAL-60): the destination and policy members this
      // job sent are the ones the API retained (a disagreement would have
      // been 422), and every member it did not send is listed under
      // `apiDerived` so the journal states what Gala, not this run, chose.
      destination: sentMembersRetained(
        /** @type {Record<string, unknown>} */ (request.destination),
        destination,
      ),
      rebuildRecord: sentMembersRetained(
        /** @type {Record<string, unknown>} */ (request.rebuildRecord),
        /** @type {Record<string, unknown>} */ (intent.rebuildRecord ?? {}),
      ),
    },
    apiDerived: {
      destination: ['environment', 'targetDigest', 'providerBinding'].filter(
        (member) =>
          /** @type {Record<string, unknown>} */ (request.destination)[
            member
          ] === undefined && destination[member] !== undefined,
      ),
      rebuildRecord: REBUILD_RECORD_API_DERIVED.filter(
        (member) =>
          /** @type {Record<string, unknown>} */ (request.rebuildRecord)[
            member
          ] === undefined &&
          /** @type {Record<string, unknown>} */ (intent.rebuildRecord ?? {})[
            member
          ] !== undefined,
      ),
      capabilityDecisionDigest:
        request.capabilityDecisionDigest === undefined &&
        intent.capabilityDecisionDigest !== undefined,
    },
  });

  await writeOutput('adapter_id', adapterId);
  process.stdout.write(
    `deployment intent issued for ${adapterId}; operation ${String(intent.operationId)}\n`,
  );
}

/**
 * Run the `deployment-receipt` exchange: trade the report challenge for one
 * single-use reporting capability, or learn that a submission was already
 * recorded for this operation.
 *
 * @param {{options: Record<string, string>, origin: string, outDir: string, stem: string}} job
 *   the job context
 * @returns {Promise<void>} resolves once the capability has been emitted
 */
async function exchangeDeploymentReceipt(job) {
  const challenge = JSON.parse(
    (
      await findCarrier(
        requireOption(job.options, 'inbox'),
        requireOption(job.options, 'expected-digest'),
      )
    ).bytes.toString('utf8'),
  );
  const intent = /** @type {Record<string, unknown>} */ (
    challenge.deploymentIntent
  );
  const request = buildReceiptExchangeRequest({
    operationId: String(intent.operationId),
    attemptId: String(intent.attemptId),
    intentDigest: String(intent.intentDigest),
    reportChallengeId: String(challenge.reportChallengeId),
  });

  const assertion = await requestOidcAssertion(AUDIENCES['deployment-receipt']);
  const answer = await postReceiptExchange({
    origin: job.origin,
    assertion,
    request,
  });

  if (answer.state === 'submission-recorded') {
    await writeFile(
      path.join(job.outDir, `${job.stem}-receipt-authorization-v2.jcs`),
      Buffer.from(
        JSON.stringify({
          state: 'submission-recorded',
          responseKind: answer.kind,
          operationId: answer.body.operationId,
          statusUrl: answer.body.statusUrl,
        }),
        'utf8',
      ),
    );
    await writeJournalHead(job.outDir, job.stem, {
      purpose: 'deployment-receipt',
      state: 'submission-recorded',
      responseKind: answer.kind,
      operationId: answer.body.operationId,
      statusUrl: answer.body.statusUrl,
    });
    await writeOutput('report_state', 'submission-recorded');
    process.stdout.write(
      'a submission was already recorded for this operation; no second report is sent\n',
    );
    return;
  }

  const capability = String(answer.body.reportingCapability);
  if (!REPORTING_CAPABILITY_PATTERN.test(capability)) {
    throw new GalaApiError(
      'WORKLOAD_EXCHANGE_RESPONSE_INVALID',
      'the issued reporting capability is not canonical unpadded base64url over 32 bytes',
      { status: 200 },
    );
  }

  // The journal head records the *fact* of issuance and never the bytes:
  // the shape it satisfies, which generation it is and when it expires are
  // exactly the evidence a later reconciliation needs, and none of them
  // lets anything reconstruct the capability.
  await writeFile(
    path.join(job.outDir, `${job.stem}-receipt-authorization-v2.jcs`),
    Buffer.from(
      JSON.stringify({
        state: 'capability-issued',
        responseKind: answer.kind,
        capabilityGeneration: answer.body.capabilityGeneration,
        reportingCapabilityExpiresAt: answer.body.reportingCapabilityExpiresAt,
        operationId: intent.operationId,
        attemptId: intent.attemptId,
        intentDigest: intent.intentDigest,
      }),
      'utf8',
    ),
  );
  await writeJournalHead(job.outDir, job.stem, {
    purpose: 'deployment-receipt',
    state: 'capability-issued',
    responseKind: answer.kind,
    reportingCapabilityIssued: true,
    reportingCapabilityLength: capability.length,
    reportingCapabilityCanonical: true,
    capabilityGeneration: answer.body.capabilityGeneration,
    reportingCapabilityExpiresAt: answer.body.reportingCapabilityExpiresAt,
    operationId: intent.operationId,
  });

  await writeMaskedOutput('reporting_capability', capability);
  await writeOutput('report_state', 'capability-issued');
  process.stdout.write(
    `reporting capability generation ${String(answer.body.capabilityGeneration)} issued\n`,
  );
}

/**
 * @returns {Promise<void>} resolves once the exchange has completed
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const purpose = requireOption(options, 'purpose');
  const audience = requireOption(options, 'audience');
  const expected = AUDIENCES[/** @type {keyof typeof AUDIENCES} */ (purpose)];
  if (expected === undefined || audience !== expected) {
    throw new Error(
      `WORKLOAD_AUDIENCE_MISMATCH: purpose ${purpose} is bound to ${String(expected)}, not ${audience}`,
    );
  }
  const origin = resolveApiOrigin(requireOption(options, 'api-origin'));
  const outDir = requireOption(options, 'out-dir');
  await mkdir(outDir, { recursive: true });
  const stem = `gala-r${process.env.GITHUB_RUN_ID ?? '0'}-a${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;

  const job = { options, origin, outDir, stem };
  if (purpose === 'deployment-intent') {
    await exchangeDeploymentIntent(job);
    return;
  }
  await exchangeDeploymentReceipt(job);
}

export { exchangeDeploymentIntent, exchangeDeploymentReceipt };

await runIfMain(import.meta.url, main);
