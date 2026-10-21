/**
 * `report-v2.yml`: submit the bounded preliminary report plus the kernel
 * journal with the single-use reporting capability the receipt exchange just
 * issued.
 *
 * This job never constructs, signs or submits a `deployment-receipt:2.0.0`:
 * Gala's reconciliation worker is the sole issuer, and the workflow can only
 * hand it evidence. `workflowCompletedAt` is the trusted report-input cutoff
 * captured immediately before the request, not an assertion that the run
 * completed.
 *
 * Ordering matters here for the same reason it does in the exchange, only
 * more so: the capability is consumed by the API *before* it looks at a
 * media type or reads a byte, and every failure after that point is
 * permanent. So the request is built, contract-validated and measured
 * against both ceilings — 512 KiB of kernel journal, 1 MiB of request, and
 * the intent's own `maximumReportRequestByteCount` when it disclosed one —
 * before the capability is presented. A report this job knows the API would
 * refuse is a report it never spends the capability on.
 *
 * A failed deploy that left no kernel journal is still reported. Either no
 * journal carrier was uploaded (`--journal-digest` absent, the failure code
 * from `--failure-code`), or the uploaded journal is the classified failure
 * journal `deploy.mjs` writes when it fails before the kernel produced any
 * attempt (`failure` present, no attempts). Both post the journal-less
 * failure submission: `deployFailure: {journal: 'absent', failureCode, stage?}`
 * in place of the `kernelJournal`.
 *
 * The capability arrives in `REPORTING_CAPABILITY` and leaves in exactly one
 * place: the `Authorization: Gala-Receipt` header. No evidence record, log
 * line or output ever carries it.
 *
 * @module
 */

import { appendFile, writeFile } from 'node:fs/promises';

import {
  assertIntentBoundToRunner,
  assertJournalAgreesWithIntent,
} from './authorized-intent.mjs';
import { findCarrier } from './decode-carrier.mjs';
import { parseOptions, requireOption } from './carrier.mjs';
import { postDeploymentReceipt, resolveApiOrigin } from './gala-api.mjs';
import {
  DEPLOY_FAILURE_CODE_PATTERN,
  MAXIMUM_KERNEL_JOURNAL_BYTES,
  MAXIMUM_REQUEST_BYTES,
  REPORTING_CAPABILITY_PATTERN,
} from './workload-contract.mjs';
import {
  assertSubmissionFits,
  buildJournalAbsentSubmission,
  buildReceiptSubmission,
} from './workload-requests.mjs';
import { runIfMain } from '../run-if-main.mjs';

/** The exact request ceiling, in bytes. */
export { MAXIMUM_REQUEST_BYTES as MAXIMUM_REPORT_REQUEST_BYTES };

/** The exact kernel-journal ceiling, in bytes. */
export { MAXIMUM_KERNEL_JOURNAL_BYTES };

/**
 * rfc3339 with exactly three fractional digits, which is the only instant
 * shape the contract's `date-time` pattern admits.
 *
 * @param {Date} at the instant
 * @returns {string} the rendered instant
 */
export function rfc3339Milliseconds(at) {
  return `${at.toISOString().slice(0, 19)}.${String(at.getUTCMilliseconds()).padStart(3, '0')}Z`;
}

/**
 * The report's trusted input floor.
 *
 * `report` may not depend on `prep` — DEC-097 section 6 pins its `needs` set
 * by exact equality — so there is no job output carrying the run's own start
 * instant. What there *is* is the kernel journal, and the API requires every
 * attempt and observation timestamp to fall inside
 * `[workflowStartedAt, workflowCompletedAt]`. The earliest instant the kernel
 * actually recorded is therefore the honest floor: it is a real instant this
 * run produced, and it is by construction no later than every other one.
 *
 * @param {{attempts: Record<string, unknown>[], observations: Record<string, unknown>[]}} journal
 *   the kernel journal
 * @returns {string} the earliest recorded instant
 */
export function earliestInstant(journal) {
  const instants = [...journal.attempts, ...journal.observations]
    .flatMap((entry) => [entry.startedAt, entry.completedAt, entry.observedAt])
    .filter((value) => typeof value === 'string')
    .sort();
  const earliest = instants[0];
  if (earliest === undefined) {
    throw new Error(
      'REPORT_INPUT_FLOOR_UNKNOWN: the kernel journal records no instant, so the report has no honest workflowStartedAt',
    );
  }
  return /** @type {string} */ (earliest);
}

/**
 * The journal carrier `deploy.mjs` writes: the kernel's own, or a classified
 * failure journal whose `attempts` are empty.
 *
 * @typedef {Record<string, any> & {
 *   attempts: Record<string, unknown>[],
 *   observations: Record<string, unknown>[]
 * }} DeployJournal
 */

/**
 * Read the kernel-journal carrier the deploy job uploaded, when it uploaded
 * one.
 *
 * @param {string} inbox the download directory
 * @param {string | undefined} journalDigest the carrier's tagged digest, or
 *   absent/empty when the deploy job uploaded none
 * @returns {Promise<DeployJournal | undefined>} the parsed journal, or
 *   `undefined` for a deploy with no journal carrier
 */
async function readJournal(inbox, journalDigest) {
  if (journalDigest === undefined || journalDigest === '') {
    return undefined;
  }
  const journalBytes = (await findCarrier(inbox, journalDigest)).bytes;
  if (journalBytes.byteLength > MAXIMUM_KERNEL_JOURNAL_BYTES) {
    throw new Error(
      `REPORT_KERNEL_JOURNAL_TOO_LARGE: ${journalBytes.byteLength} bytes exceed ${MAXIMUM_KERNEL_JOURNAL_BYTES}`,
    );
  }
  return JSON.parse(journalBytes.toString('utf8'));
}

/**
 * The failure a journal-less report states: the classified `failure` the
 * deploy's failure journal carries, else the code the deploy step printed
 * with `GALA_DEPLOY_NO_JOURNAL`, else `DEPLOY_CRASHED`. A code that is not the
 * closed shape (it travelled through a log) is not trusted and becomes
 * `DEPLOY_CRASHED` as well.
 *
 * @param {DeployJournal | undefined} journal the failure journal, if any
 * @param {string | undefined} printedCode the code the workflow captured
 * @returns {{failureCode: string, stage?: string, toHost?: string}} the failure to state
 */
function failureOf(journal, printedCode) {
  const recorded = journal?.failure;
  const code = typeof recorded?.code === 'string' ? recorded.code : printedCode;
  return {
    failureCode:
      typeof code === 'string' && DEPLOY_FAILURE_CODE_PATTERN.test(code)
        ? code
        : 'DEPLOY_CRASHED',
    ...(typeof recorded?.stage === 'string' ? { stage: recorded.stage } : {}),
    ...(typeof recorded?.toHost === 'string'
      ? { toHost: recorded.toHost }
      : {}),
  };
}

/**
 * @returns {Promise<void>} resolves once the report has been submitted and
 *   classified
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const inbox = requireOption(options, 'inbox');
  const origin = resolveApiOrigin(requireOption(options, 'api-origin'));
  const evidencePath = requireOption(options, 'evidence-out');

  const challenge = JSON.parse(
    (
      await findCarrier(inbox, requireOption(options, 'challenge-digest'))
    ).bytes.toString('utf8'),
  );
  const intent = /** @type {Record<string, unknown>} */ (
    challenge.deploymentIntent
  );
  const journal = await readJournal(inbox, options['journal-digest']);

  // The report is bound to the intent exactly as the deploy was: the intent
  // must name this runner's repository and publish ref, the journal must
  // have been produced under this intent, and the repository id the runner
  // reports must be the one the intent's rebuild record was bound to.
  assertIntentBoundToRunner(intent, process.env);
  // A failure journal with no attempts carries no kernel evidence to bind to
  // the intent; it contributes its failure code and nothing else.
  const hasKernelEvidence =
    journal !== undefined &&
    Array.isArray(journal.attempts) &&
    journal.attempts.length > 0;
  if (journal !== undefined && hasKernelEvidence) {
    assertJournalAgreesWithIntent(journal, intent);
  }
  const repositoryId = requireOption(options, 'repository-id');
  const rebuildRecord = /** @type {Record<string, unknown>} */ (
    intent.rebuildRecord ?? {}
  );
  if (String(rebuildRecord.repositoryId) !== repositoryId) {
    throw new Error(
      'REPORT_REPOSITORY_MISMATCH: the runner repository id is not the one the authorized intent was bound to',
    );
  }

  const base = {
    intent,
    repositoryId,
    runId: process.env.GITHUB_RUN_ID ?? '1',
    runAttempt: Number.parseInt(process.env.GITHUB_RUN_ATTEMPT ?? '1', 10),
    publisherVersion: requireOption(options, 'publisher-version'),
    workflowCompletedAt: rfc3339Milliseconds(new Date()),
    // The base URL the deploy's public reads were made against, when the
    // journal says (a failure before the first read leaves it out).
    ...(typeof journal?.verifiedAt?.origin === 'string'
      ? { verifiedAt: { origin: journal.verifiedAt.origin } }
      : {}),
  };
  const submission =
    journal !== undefined && hasKernelEvidence
      ? buildReceiptSubmission({
          ...base,
          journal: {
            attempts: journal.attempts,
            observations: journal.observations,
          },
          observedRoutes: journal.observedRoutes ?? [],
          workflowStartedAt:
            options['workflow-started-at'] ?? earliestInstant(journal),
          ...(typeof journal.destinationGenerationId === 'string'
            ? { destinationGenerationId: journal.destinationGenerationId }
            : {}),
          ...(typeof journal.destinationReceiptDigest === 'string'
            ? { destinationReceiptDigest: journal.destinationReceiptDigest }
            : {}),
          // A classified failure beside its journal, so the API reads the
          // code without parsing attempts.
          ...(journal.failure === undefined
            ? {}
            : { failure: failureOf(journal, undefined) }),
        })
      : buildJournalAbsentSubmission({
          ...base,
          observedRoutes: [],
          // No kernel instant exists to floor the report at, so the window is
          // the report's own cutoff: an honest "no earlier evidence".
          workflowStartedAt:
            options['workflow-started-at'] ?? base.workflowCompletedAt,
          ...failureOf(journal, options['failure-code']),
        });

  // The intent's own precomputed bound, applied before the hard transport
  // cap, exactly as the API applies it.
  const intentBound = Number(intent.maximumReportRequestByteCount);
  const sizes = assertSubmissionFits(
    submission,
    Number.isSafeInteger(intentBound) && intentBound > 0
      ? intentBound
      : undefined,
  );

  const capability = process.env.REPORTING_CAPABILITY ?? '';
  if (!REPORTING_CAPABILITY_PATTERN.test(capability)) {
    throw new Error(
      'REPORT_CAPABILITY_UNUSABLE: REPORTING_CAPABILITY is not a canonical 43-character reporting capability',
    );
  }

  const evidence = await postDeploymentReceipt({
    origin,
    capability,
    submission,
  });

  // The evidence record is written before the exit decision, so a refused
  // submission still leaves behind exactly what was sent and what came
  // back — and it carries no capability, no assertion and no response
  // detail text.
  await writeFile(
    evidencePath,
    Buffer.from(
      JSON.stringify({
        schemaVersion: '2.0.0',
        operationId: submission.operationId,
        adapterId: submission.adapterId,
        intentDigest: intent.intentDigest,
        journal: submission.kernelJournal === undefined ? 'absent' : 'present',
        ...(submission.deployFailure === undefined
          ? {}
          : {
              failureCode: /** @type {any} */ (submission.deployFailure)
                .failureCode,
            }),
        outcome: evidence.outcome,
        httpStatus: evidence.status,
        problemCode: evidence.problemCode,
        statusUrl: evidence.statusUrl,
        phase: evidence.phase,
        requestByteCount: sizes.requestByteCount,
        kernelJournalByteCount: sizes.kernelJournalByteCount,
        workflowCompletedAt: submission.workflowCompletedAt,
      }),
      'utf8',
    ),
  );

  if (evidence.outcome === 'submission-recorded') {
    const output = process.env.GITHUB_OUTPUT;
    if (output !== undefined && output !== '' && evidence.statusUrl !== null) {
      await appendFile(
        output,
        `operation_status_url=${evidence.statusUrl}\n`,
        'utf8',
      );
    }
    process.stdout.write(
      `submission recorded: ${String(evidence.statusUrl)} (${sizes.requestByteCount} request bytes)\n`,
    );
    return;
  }

  // Every other classified outcome is a failure of this job, and each one
  // names what a person has to do about it without naming anything secret.
  const detail = {
    'fence-moved':
      'the destination fence moved out from under the intent (409 INVALID_SOURCE_STATE); this run may not report, and reconciliation owns the outcome',
    'capability-invalid':
      'the reporting capability was refused (401, deliberately non-enumerating: unknown, malformed, expired, superseded, already consumed or belonging to a moved fence)',
    refused: 'the submission was refused',
  }[evidence.outcome];
  throw new Error(
    `REPORT_SUBMISSION_${evidence.outcome.toUpperCase().replaceAll('-', '_')}: ${detail} (HTTP ${evidence.status}${evidence.problemCode === null ? '' : ` ${evidence.problemCode}`})`,
  );
}

await runIfMain(import.meta.url, main);
