/**
 * DEC-097 section 6.2 reconciliation recovery: the adapter-side half.
 *
 * Two distinct responsibilities live here.
 *
 * 1. **A pure projection over the attempt fence and its tombstones.** The
 *    `pagesRunAttemptGapProof` and the `closed-no-destination-authority`
 *    tombstone digests are server-minted inside one atomic authorization
 *    transaction. This adapter *validates* a server-supplied
 *    `pagesReconciliationRecovery` record and refuses a malformed one; it
 *    never mints one, never allocates an epoch and never claims an
 *    authority. The builders exported here exist so a fixture (and a
 *    reviewer) can recompute the exact digests the server must have
 *    produced, and so a missing, extra, reordered or substituted gap row is
 *    caught by arithmetic rather than by trust.
 *
 * 2. **The same-operation recovery path's provider sequence.** Before
 *    uploading or creating any current carrier, recovery polls the prior
 *    attempt's catalog-constructed status endpoint using only
 *    `priorPagesBuildVersion` (the `inspect/pages-recovery-prior-status`
 *    row), and then takes exactly one of the four admitted branches. Every
 *    call it makes is a cataloged recovery-prior row, which `normal` mode
 *    forbids outright.
 *
 * @module
 */

import {
  canonicalizeJson,
  domainDigest,
  isDigestString,
} from '@rathnasgala2/adapter-protocol';

import {
  DOMAIN_PAGES_NO_AUTHORITY_RUN_ATTEMPT,
  DOMAIN_PAGES_RECONCILIATION_RECOVERY,
  DOMAIN_PAGES_RUN_ATTEMPT_GAP_PROOF,
  PAGES_DEPLOYMENT_STATUSES,
  RECOVERY_MODE,
  RECOVERY_POLL_BUDGET_SECONDS,
  POLL_SCHEDULE_SECONDS,
  POLL_TAIL_SECONDS,
  SUCCESS_STATUS,
  TEMPORARY_STATUSES,
  TERMINAL_FAILURE_STATUSES,
} from './constants.js';
import { callProvider } from './rest.js';

/** The `profile` const of a `pagesReconciliationRecovery` record. */
export const RECOVERY_RECORD_PROFILE = 'gala-pages-reconciliation-recovery-v2';

/** The `profile` const of a `pagesRunAttemptGapProof` record. */
export const GAP_PROOF_PROFILE = 'gala-pages-run-attempt-gap-proof-v2';

/** The single admitted `authorityState` of an intervening run attempt. */
export const NO_AUTHORITY_STATE = 'closed-no-destination-authority';

/** The inclusive bounds DEC-097 places on the two fence coordinates. */
export const PRIOR_RUN_ATTEMPT_BOUNDS = Object.freeze({
  minimum: 1,
  maximum: 50,
});
/** The inclusive bounds on a claiming run attempt. */
export const CLAIMING_RUN_ATTEMPT_BOUNDS = Object.freeze({
  minimum: 2,
  maximum: 51,
});

const GITHUB_POSITIVE_DECIMAL = /^[1-9][0-9]{0,18}$/u;
const BUILD_VERSION_PATTERN = /^[0-9a-f]{40}$/u;
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * Raise a typed recovery failure.
 *
 * @param {string} code the stable error code
 * @param {string} detail the diagnostic detail
 * @returns {never} never returns
 */
function refuse(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

/**
 * @param {unknown} value the candidate
 * @param {string} name the member name
 * @returns {string} the validated stable identifier
 */
function requireStableId(value, name) {
  if (typeof value !== 'string' || value === '' || value.length > 200) {
    refuse(
      'PAGES_RECOVERY_RECORD_INVALID',
      `${JSON.stringify(name)} is not a stable identifier`,
    );
  }
  return /** @type {string} */ (value);
}

/**
 * @param {unknown} value the candidate
 * @param {string} name the member name
 * @returns {string} the validated digest
 */
function requireDigest(value, name) {
  if (!isDigestString(value)) {
    refuse(
      'PAGES_RECOVERY_RECORD_INVALID',
      `${JSON.stringify(name)} is not a sha256 digest string`,
    );
  }
  return /** @type {string} */ (value);
}

/**
 * @param {unknown} value the candidate
 * @param {string} name the member name
 * @returns {string} the validated timestamp
 */
function requireRfc3339(value, name) {
  if (typeof value !== 'string' || !RFC3339.test(value)) {
    refuse(
      'PAGES_RECOVERY_RECORD_INVALID',
      `${JSON.stringify(name)} is not an RFC 3339 timestamp`,
    );
  }
  return /** @type {string} */ (value);
}

/**
 * @param {unknown} value the candidate
 * @param {string} name the member name
 * @returns {string} the validated `githubPositiveDecimal`
 */
function requireGithubPositiveDecimal(value, name) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !GITHUB_POSITIVE_DECIMAL.test(text)) {
    refuse(
      'PAGES_RECOVERY_RECORD_INVALID',
      `${JSON.stringify(name)} is not a positive canonical decimal GitHub identifier`,
    );
  }
  return /** @type {string} */ (text);
}

/**
 * @param {unknown} value the candidate
 * @param {string} name the member name
 * @param {{minimum: number, maximum: number}} bounds inclusive bounds
 * @returns {number} the validated integer
 */
function requireBoundedInteger(value, name, bounds) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < bounds.minimum ||
    value > bounds.maximum
  ) {
    refuse(
      'PAGES_RECOVERY_RECORD_INVALID',
      `${JSON.stringify(name)} must be an integer in ${bounds.minimum}..${bounds.maximum}`,
    );
  }
  return /** @type {number} */ (value);
}

/**
 * Compute one intervening attempt's immutable tombstone digest:
 * `SHA256(UTF8("GALA-PAGES-NO-AUTHORITY-RUN-ATTEMPT-V2\0") ||
 * JCS({repositoryId,runId,runAttempt,authorityState}))`.
 *
 * @param {{
 *   repositoryId: string | number,
 *   runId: string | number,
 *   runAttempt: number
 * }} input the tombstone coordinates
 * @returns {string} the `decisionDigest`
 */
export function computeInterveningAttemptDigest(input) {
  return domainDigest(DOMAIN_PAGES_NO_AUTHORITY_RUN_ATTEMPT, {
    repositoryId: String(input.repositoryId),
    runId: String(input.runId),
    runAttempt: input.runAttempt,
    authorityState: NO_AUTHORITY_STATE,
  });
}

/**
 * Build the exact ordered tombstone set for one attempt fence: every integer
 * strictly between the prior and claiming attempts, sorted by `runAttempt`.
 * An adjacent claim carries the exact empty array.
 *
 * @param {{
 *   repositoryId: string | number,
 *   runId: string | number,
 *   priorRunAttempt: number,
 *   claimingRunAttempt: number
 * }} input the fence coordinates
 * @returns {readonly Readonly<{
 *   runAttempt: number,
 *   authorityState: string,
 *   decisionDigest: string
 * }>[]} the ordered tombstone rows
 */
export function buildInterveningAttempts(input) {
  requireBoundedInteger(
    input.priorRunAttempt,
    'priorRunAttempt',
    PRIOR_RUN_ATTEMPT_BOUNDS,
  );
  requireBoundedInteger(
    input.claimingRunAttempt,
    'claimingRunAttempt',
    CLAIMING_RUN_ATTEMPT_BOUNDS,
  );
  if (input.claimingRunAttempt <= input.priorRunAttempt) {
    refuse(
      'PAGES_RUN_ATTEMPT_FENCE_INVALID',
      'claimingRunAttempt must be strictly greater than priorRunAttempt',
    );
  }
  /** @type {Readonly<Record<string, unknown>>[]} */
  const rows = [];
  for (
    let runAttempt = input.priorRunAttempt + 1;
    runAttempt < input.claimingRunAttempt;
    runAttempt += 1
  ) {
    rows.push(
      Object.freeze({
        runAttempt,
        authorityState: NO_AUTHORITY_STATE,
        decisionDigest: computeInterveningAttemptDigest({
          repositoryId: input.repositoryId,
          runId: input.runId,
          runAttempt,
        }),
      }),
    );
  }
  return Object.freeze(
    /** @type {readonly Readonly<{runAttempt: number, authorityState: string, decisionDigest: string}>[]} */ (
      /** @type {unknown} */ (rows)
    ),
  );
}

/**
 * Compute a gap proof's `proofDigest` over the record with `proofDigest`
 * omitted.
 *
 * @param {Readonly<Record<string, unknown>>} proof the gap proof record
 * @returns {string} the `proofDigest`
 */
export function computeGapProofDigest(proof) {
  const rest = Object.fromEntries(
    Object.entries(proof).filter(([name]) => name !== 'proofDigest'),
  );
  return domainDigest(DOMAIN_PAGES_RUN_ATTEMPT_GAP_PROOF, rest);
}

/**
 * Build the complete `pagesRunAttemptGapProof` the authorization
 * transaction must have produced for one fence.
 *
 * @param {{
 *   repositoryId: string | number,
 *   runId: string | number,
 *   priorRunAttempt: number,
 *   claimingRunAttempt: number
 * }} input the fence coordinates
 * @returns {Readonly<Record<string, unknown>>} the complete gap proof
 */
export function buildRunAttemptGapProof(input) {
  const withoutDigest = {
    profile: GAP_PROOF_PROFILE,
    runId: requireGithubPositiveDecimal(input.runId, 'runId'),
    priorRunAttempt: input.priorRunAttempt,
    claimingRunAttempt: input.claimingRunAttempt,
    interveningAttempts: [...buildInterveningAttempts(input)],
  };
  return Object.freeze({
    ...withoutDigest,
    proofDigest: computeGapProofDigest(withoutDigest),
  });
}

/**
 * Validate one server-supplied gap proof: exact member set, bounded
 * coordinates, set equality of the intervening attempts with every integer
 * strictly between the two coordinates, `runAttempt` ordering, every
 * tombstone digest, and the `proofDigest` itself.
 *
 * @param {unknown} proof the candidate gap proof
 * @param {{repositoryId: string | number}} binding the repository identity
 *   the tombstone digests are bound to
 * @returns {Readonly<Record<string, unknown>>} the validated proof
 */
export function validateRunAttemptGapProof(proof, binding) {
  if (proof === null || typeof proof !== 'object' || Array.isArray(proof)) {
    refuse(
      'PAGES_RUN_ATTEMPT_GAP_PROOF_INVALID',
      'runAttemptGapProof is not an object',
    );
  }
  const record = /** @type {Record<string, unknown>} */ (proof);
  const expectedMembers = [
    'claimingRunAttempt',
    'interveningAttempts',
    'priorRunAttempt',
    'profile',
    'proofDigest',
    'runId',
  ];
  const members = Object.keys(record).sort();
  if (
    members.length !== expectedMembers.length ||
    !expectedMembers.every((name, index) => members[index] === name)
  ) {
    refuse(
      'PAGES_RUN_ATTEMPT_GAP_PROOF_INVALID',
      `the gap proof must have exactly the members ${expectedMembers.join(', ')}`,
    );
  }
  if (record.profile !== GAP_PROOF_PROFILE) {
    refuse(
      'PAGES_RUN_ATTEMPT_GAP_PROOF_INVALID',
      `profile must be ${JSON.stringify(GAP_PROOF_PROFILE)}`,
    );
  }
  const runId = requireGithubPositiveDecimal(record.runId, 'runId');
  const priorRunAttempt = requireBoundedInteger(
    record.priorRunAttempt,
    'priorRunAttempt',
    PRIOR_RUN_ATTEMPT_BOUNDS,
  );
  const claimingRunAttempt = requireBoundedInteger(
    record.claimingRunAttempt,
    'claimingRunAttempt',
    CLAIMING_RUN_ATTEMPT_BOUNDS,
  );
  if (claimingRunAttempt <= priorRunAttempt) {
    refuse(
      'PAGES_RUN_ATTEMPT_FENCE_INVALID',
      'claimingRunAttempt must be strictly greater than priorRunAttempt',
    );
  }
  const expectedRows = buildInterveningAttempts({
    repositoryId: binding.repositoryId,
    runId,
    priorRunAttempt,
    claimingRunAttempt,
  });
  const observedRows = record.interveningAttempts;
  if (!Array.isArray(observedRows)) {
    refuse(
      'PAGES_RUN_ATTEMPT_GAP_PROOF_INVALID',
      'interveningAttempts is not an array',
    );
  }
  const rows = /** @type {unknown[]} */ (observedRows);
  if (rows.length !== expectedRows.length) {
    refuse(
      'PAGES_RUN_ATTEMPT_GAP_PROOF_INCOMPLETE',
      `interveningAttempts has ${rows.length} rows; the fence ${priorRunAttempt}..${claimingRunAttempt} requires exactly ${expectedRows.length}, one for every strictly intervening attempt`,
    );
  }
  rows.forEach((row, index) => {
    if (canonicalizeJson(row) !== canonicalizeJson(expectedRows[index])) {
      refuse(
        'PAGES_RUN_ATTEMPT_GAP_PROOF_INCOMPLETE',
        `intervening attempt row ${index} is missing, extra, reordered or carries a substituted decisionDigest`,
      );
    }
  });
  const expectedDigest = computeGapProofDigest(record);
  if (record.proofDigest !== expectedDigest) {
    refuse(
      'PAGES_RUN_ATTEMPT_GAP_PROOF_DIGEST_MISMATCH',
      'proofDigest does not equal SHA256(UTF8("GALA-PAGES-RUN-ATTEMPT-GAP-PROOF-V2\\0") || JCS(the record with proofDigest omitted))',
    );
  }
  return Object.freeze({ ...record });
}

/** The exact member names of a `pagesReconciliationRecovery` record. */
const RECOVERY_REQUIRED_MEMBERS = Object.freeze([
  'priorAttemptId',
  'priorAuthorityEpoch',
  'priorAuthorityId',
  'priorFenceEvidenceDigest',
  'priorIntentDigest',
  'priorPagesBuildVersion',
  'priorProposedGenerationId',
  'profile',
  'reconcileCommandDigest',
  'reconcileCommandExpiresAt',
  'reconcileCommandId',
  'recoveryDigest',
  'runAttemptGapProof',
]);

/** The one optional member (jointly absent for a first publish). */
const RECOVERY_OPTIONAL_MEMBERS = Object.freeze(['priorExpectedGenerationId']);

/**
 * Compute a recovery record's `recoveryDigest` over the record with
 * `recoveryDigest` omitted.
 *
 * @param {Readonly<Record<string, unknown>>} recovery the recovery record
 * @returns {string} the `recoveryDigest`
 */
export function computeRecoveryDigest(recovery) {
  const rest = Object.fromEntries(
    Object.entries(recovery).filter(([name]) => name !== 'recoveryDigest'),
  );
  return domainDigest(DOMAIN_PAGES_RECONCILIATION_RECOVERY, rest);
}

/**
 * Seal one otherwise complete recovery record by computing its digest. Only
 * a fixture uses this: the real record is server-minted.
 *
 * @param {Readonly<Record<string, unknown>>} withoutDigest the record with no
 *   `recoveryDigest`
 * @returns {Readonly<Record<string, unknown>>} the sealed record
 */
export function sealRecoveryRecord(withoutDigest) {
  return Object.freeze({
    ...withoutDigest,
    recoveryDigest: computeRecoveryDigest(withoutDigest),
  });
}

/**
 * Validate one server-supplied `pagesReconciliationRecovery` record. This
 * adapter never mints one; a malformed record is refused before any provider
 * call.
 *
 * @param {unknown} recovery the candidate record
 * @param {{repositoryId: string | number}} binding the repository identity
 * @returns {Readonly<Record<string, unknown>>} the validated record
 */
export function validateReconciliationRecovery(recovery, binding) {
  if (
    recovery === null ||
    typeof recovery !== 'object' ||
    Array.isArray(recovery)
  ) {
    refuse(
      'PAGES_RECOVERY_RECORD_INVALID',
      'pagesRecovery is required in pages-reconciliation-recovery mode and must be an object',
    );
  }
  const record = /** @type {Record<string, unknown>} */ (recovery);
  const permitted = new Set([
    ...RECOVERY_REQUIRED_MEMBERS,
    ...RECOVERY_OPTIONAL_MEMBERS,
  ]);
  for (const name of Object.keys(record)) {
    if (!permitted.has(name)) {
      refuse(
        'PAGES_RECOVERY_RECORD_INVALID',
        `${JSON.stringify(name)} is not a member of pagesReconciliationRecovery`,
      );
    }
  }
  for (const name of RECOVERY_REQUIRED_MEMBERS) {
    if (record[name] === undefined) {
      refuse(
        'PAGES_RECOVERY_RECORD_INVALID',
        `${JSON.stringify(name)} is required`,
      );
    }
  }
  if (record.profile !== RECOVERY_RECORD_PROFILE) {
    refuse(
      'PAGES_RECOVERY_RECORD_INVALID',
      `profile must be ${JSON.stringify(RECOVERY_RECORD_PROFILE)}`,
    );
  }
  requireStableId(record.reconcileCommandId, 'reconcileCommandId');
  requireDigest(record.reconcileCommandDigest, 'reconcileCommandDigest');
  requireRfc3339(record.reconcileCommandExpiresAt, 'reconcileCommandExpiresAt');
  requireStableId(record.priorAttemptId, 'priorAttemptId');
  requireDigest(record.priorIntentDigest, 'priorIntentDigest');
  if (
    typeof record.priorAuthorityEpoch !== 'number' ||
    !Number.isSafeInteger(record.priorAuthorityEpoch) ||
    record.priorAuthorityEpoch < 1
  ) {
    refuse(
      'PAGES_RECOVERY_RECORD_INVALID',
      'priorAuthorityEpoch must be a positive int64',
    );
  }
  requireStableId(record.priorAuthorityId, 'priorAuthorityId');
  if (record.priorExpectedGenerationId !== undefined) {
    requireStableId(
      record.priorExpectedGenerationId,
      'priorExpectedGenerationId',
    );
  }
  requireStableId(
    record.priorProposedGenerationId,
    'priorProposedGenerationId',
  );
  if (
    typeof record.priorPagesBuildVersion !== 'string' ||
    !BUILD_VERSION_PATTERN.test(record.priorPagesBuildVersion)
  ) {
    refuse(
      'PAGES_RECOVERY_RECORD_INVALID',
      'priorPagesBuildVersion must be exactly 40 lowercase hexadecimal characters',
    );
  }
  requireDigest(record.priorFenceEvidenceDigest, 'priorFenceEvidenceDigest');
  validateRunAttemptGapProof(record.runAttemptGapProof, binding);
  const expectedDigest = computeRecoveryDigest(record);
  if (record.recoveryDigest !== expectedDigest) {
    refuse(
      'PAGES_RECOVERY_DIGEST_MISMATCH',
      'recoveryDigest does not equal SHA256(UTF8("GALA-PAGES-RECONCILIATION-RECOVERY-V2\\0") || JCS(pagesRecovery with recoveryDigest omitted))',
    );
  }
  return Object.freeze({ ...record });
}

/**
 * Refuse a recovery-prior call outside recovery mode. `normal` forbids every
 * recovery-prior call and does not reserve that branch's budget.
 *
 * @param {string} mode the authority mode
 * @returns {void}
 */
export function assertRecoveryModePermitted(mode) {
  if (mode !== RECOVERY_MODE) {
    throw new Error(
      `PAGES_RECOVERY_CALL_FORBIDDEN: the recovery-prior call plan is admitted only in ${RECOVERY_MODE} mode, not ${JSON.stringify(mode)}`,
    );
  }
}

/**
 * Read the prior attempt's status once through the cataloged
 * `inspect/pages-recovery-prior-status` row.
 *
 * @param {import('./rest.js').RestContext} context the recovery-bound context
 * @returns {Promise<{httpStatus: number, status: string | null}>} the
 *   observation; `status` is `null` for a 404 or a malformed body
 */
async function readPriorStatus(context) {
  const response = await callProvider(
    context,
    'inspect',
    'pages-recovery-prior-status',
    { acceptStatuses: [200, 404] },
  );
  if (response.status === 404) {
    return { httpStatus: 404, status: null };
  }
  const body = /** @type {Record<string, unknown>} */ (response.body ?? {});
  const status = body.status;
  return {
    httpStatus: 200,
    status: typeof status === 'string' ? status : null,
  };
}

/**
 * @typedef {Readonly<{
 *   profile: 'gala-pages-recovery-observation-v2',
 *   priorPagesBuildVersion: string,
 *   outcome: 'prior-succeeded' | 'prior-terminal-failure' | 'reconciliation-required',
 *   authorityState: 'terminal-candidate' | 'proceed-with-fresh-create' | 'reconciliation-required',
 *   priorStatus: string | null,
 *   observedStatuses: readonly string[],
 *   cancelCallCount: number,
 *   reason: string
 * }>} PriorAttemptObservation
 */

/**
 * @param {string} outcome the branch taken
 * @param {string} authorityState the resulting authority state
 * @param {string} priorPagesBuildVersion the prior build version
 * @param {string | null} priorStatus the exact prior status
 * @param {readonly string[]} observedStatuses every status observed
 * @param {number} cancelCallCount how many cancels were issued (0 or 1)
 * @param {string} reason a truthful one-line reason
 * @returns {PriorAttemptObservation} the frozen observation
 */
function observation(
  outcome,
  authorityState,
  priorPagesBuildVersion,
  priorStatus,
  observedStatuses,
  cancelCallCount,
  reason,
) {
  return /** @type {PriorAttemptObservation} */ (
    Object.freeze({
      profile: 'gala-pages-recovery-observation-v2',
      priorPagesBuildVersion,
      outcome,
      authorityState,
      priorStatus,
      observedStatuses: Object.freeze([...observedStatuses]),
      cancelCallCount,
      reason,
    })
  );
}

/**
 * Resolve the prior attempt before any current carrier is uploaded or
 * created (DEC-097 section 6.2).
 *
 * - terminal `succeed`: the same operation's proposed generation was already
 *   selected. No new create is performed and the current fence terminalizes
 *   as `terminal-candidate`.
 * - a terminal non-success: immutable, so the prior create can never
 *   activate. The exact prior status is recorded and the caller proceeds
 *   with the fresh current carrier/create.
 * - a temporary status or 404: exactly one cataloged cancel of that prior
 *   build version, then bounded polling.
 * - still-temporary, 404, malformed, unknown or nonterminal at the recovery
 *   deadline: truthful evidence, no current create, authority returns to
 *   `reconciliation-required`.
 *
 * @param {import('./rest.js').RestContext} context a REST context already
 *   bound to `pages-reconciliation-recovery` mode and the prior build version
 * @param {{
 *   sleep?: (seconds: number) => Promise<void>,
 *   budgetSeconds?: number
 * }} [options] bounded polling controls
 * @returns {Promise<PriorAttemptObservation>} the truthful observation
 */
export async function resolvePriorAttempt(context, options = {}) {
  assertRecoveryModePermitted(String(context.mode));
  const priorPagesBuildVersion = String(context.priorPagesBuildVersion);
  const sleep = options.sleep ?? defaultSleep;
  const budget = options.budgetSeconds ?? RECOVERY_POLL_BUDGET_SECONDS;
  /** @type {string[]} */
  const observed = [];

  const first = await readPriorStatus(context);
  if (first.status !== null) {
    observed.push(first.status);
  }
  if (first.httpStatus === 200 && first.status !== null) {
    if (!PAGES_DEPLOYMENT_STATUSES.includes(first.status)) {
      return observation(
        'reconciliation-required',
        'reconciliation-required',
        priorPagesBuildVersion,
        first.status,
        observed,
        0,
        'the prior attempt reported a status outside the eleven accepted values; no current create is made',
      );
    }
    if (first.status === SUCCESS_STATUS) {
      return observation(
        'prior-succeeded',
        'terminal-candidate',
        priorPagesBuildVersion,
        first.status,
        observed,
        0,
        "the prior attempt reached terminal succeed, so the same operation's proposed generation was already selected and no new create is performed",
      );
    }
    if (TERMINAL_FAILURE_STATUSES.includes(first.status)) {
      return observation(
        'prior-terminal-failure',
        'proceed-with-fresh-create',
        priorPagesBuildVersion,
        first.status,
        observed,
        0,
        'the prior attempt reached an immutable terminal non-success, so it can never activate and the fresh current carrier may proceed',
      );
    }
    if (!TEMPORARY_STATUSES.includes(first.status)) {
      return observation(
        'reconciliation-required',
        'reconciliation-required',
        priorPagesBuildVersion,
        first.status,
        observed,
        0,
        'the prior attempt reported a nonterminal, unpartitioned status; no current create is made',
      );
    }
  } else if (first.httpStatus === 200) {
    return observation(
      'reconciliation-required',
      'reconciliation-required',
      priorPagesBuildVersion,
      null,
      observed,
      0,
      'the prior attempt status response was malformed; no current create is made',
    );
  }

  // Temporary status or 404: exactly one cataloged cancel, then bounded
  // polling. The cancel is issued once and only once.
  await callProvider(context, 'cleanup-staged', 'pages-recovery-prior-cancel', {
    acceptStatuses: [200, 202, 204, 404],
  });
  const cancelCallCount = 1;

  let spent = 0;
  for (let attempt = 0; ; attempt += 1) {
    const wait = POLL_SCHEDULE_SECONDS[attempt] ?? POLL_TAIL_SECONDS;
    if (spent + wait > budget) {
      return observation(
        'reconciliation-required',
        'reconciliation-required',
        priorPagesBuildVersion,
        observed[observed.length - 1] ?? null,
        observed,
        cancelCallCount,
        `the prior attempt was still nonterminal at the ${budget}-second recovery deadline; no current create is made and the authority returns to reconciliation-required`,
      );
    }
    spent += wait;
    await sleep(wait);

    const next = await readPriorStatus(context);
    if (next.status !== null) {
      observed.push(next.status);
    }
    if (next.httpStatus === 404 || next.status === null) {
      continue;
    }
    if (next.status === SUCCESS_STATUS) {
      return observation(
        'prior-succeeded',
        'terminal-candidate',
        priorPagesBuildVersion,
        next.status,
        observed,
        cancelCallCount,
        'the prior attempt reached terminal succeed despite the cancel; no new create is performed',
      );
    }
    if (TERMINAL_FAILURE_STATUSES.includes(next.status)) {
      return observation(
        'prior-terminal-failure',
        'proceed-with-fresh-create',
        priorPagesBuildVersion,
        next.status,
        observed,
        cancelCallCount,
        'the cancel drove the prior attempt to an immutable terminal non-success; the fresh current carrier may proceed',
      );
    }
    if (!PAGES_DEPLOYMENT_STATUSES.includes(next.status)) {
      return observation(
        'reconciliation-required',
        'reconciliation-required',
        priorPagesBuildVersion,
        next.status,
        observed,
        cancelCallCount,
        'the prior attempt reported an unknown status after the cancel; no current create is made',
      );
    }
  }
}

/**
 * @param {number} seconds seconds to wait
 * @returns {Promise<void>} resolves after the wait
 */
function defaultSleep(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000).unref();
  });
}
