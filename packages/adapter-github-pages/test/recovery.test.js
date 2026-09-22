/**
 * DEC-097 section 6.2 reconciliation recovery: the attempt-fence/tombstone
 * projection and the adapter's same-operation recovery path, exercised
 * against the local fake provider.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { domainDigest } from '@rathnasgala2/adapter-protocol';

import { NORMAL_MODE, RECOVERY_MODE } from '../src/constants.js';
import * as adapter from '../src/index.js';
import {
  computeArtifactDigest,
  forgetDestination,
  generateUuidV7,
} from '../src/index.js';
import {
  buildInterveningAttempts,
  buildRunAttemptGapProof,
  computeGapProofDigest,
  computeInterveningAttemptDigest,
  sealRecoveryRecord,
  validateReconciliationRecovery,
  validateRunAttemptGapProof,
} from '../src/recovery.js';
import { buildRequestTemplates } from '../src/request-catalog.js';
import { bindIdentity, callProvider } from '../src/rest.js';
import { startFakePagesProvider } from './fake-pages-provider.js';
import { oidcFor } from './oidc-fixture.js';

const PRIOR_BUILD_VERSION = 'b'.repeat(40);
const RUN_ID = '17654321098';

let sequence = 0;

/**
 * Bind one fake provider and destination for a recovery scenario.
 *
 * @param {{
 *   priorStatuses?: readonly string[],
 *   statusSequence?: readonly string[],
 *   cancelBehaviour?: 'terminal' | 'ambiguous',
 *   seedPrior?: boolean
 * }} [options] scenario controls
 * @returns {Promise<any>} the bound fixture
 */
async function bindRecovery(options = {}) {
  sequence += 1;
  const provider = await startFakePagesProvider({
    repository: `recovery-pages-${sequence}`,
    ...(options.statusSequence === undefined
      ? {}
      : { statusSequence: options.statusSequence }),
    ...(options.cancelBehaviour === undefined
      ? {}
      : { cancelBehaviour: options.cancelBehaviour }),
  });
  if (options.seedPrior !== false) {
    provider.seedDeployment(
      PRIOR_BUILD_VERSION,
      options.priorStatuses ?? ['succeed'],
    );
  }
  const destination = {
    owner: provider.owner,
    repository: provider.repository,
    repositoryId: String(4000 + sequence),
    repositoryOwnerId: '99001',
    apiOrigin: provider.apiOrigin,
    publicBaseUrl: provider.publicBaseUrl,
    token: provider.token,
    publishCarrier: provider.publishCarrier,
    fetch: provider.fetch,
    runId: RUN_ID,
    runAttempt: 2,
    /**
     * @returns {Promise<void>} resolves immediately
     */
    sleep: () => Promise.resolve(),
  };
  return {
    provider,
    destination,
    async teardown() {
      forgetDestination(destination);
      await provider.stop();
    },
  };
}

/**
 * Build the server-minted recovery record a claiming attempt is given.
 *
 * @param {any} destination the bound destination
 * @param {{
 *   priorRunAttempt?: number,
 *   claimingRunAttempt?: number,
 *   priorPagesBuildVersion?: string
 * }} [options] fence overrides
 * @returns {Readonly<Record<string, unknown>>} the sealed record
 */
function buildRecoveryRecord(destination, options = {}) {
  return sealRecoveryRecord({
    profile: 'gala-pages-reconciliation-recovery-v2',
    reconcileCommandId: generateUuidV7(),
    reconcileCommandDigest: `sha256:${'1'.repeat(64)}`,
    reconcileCommandExpiresAt: '2026-09-18T00:00:00Z',
    priorAttemptId: generateUuidV7(),
    runAttemptGapProof: buildRunAttemptGapProof({
      repositoryId: destination.repositoryId,
      runId: RUN_ID,
      priorRunAttempt: options.priorRunAttempt ?? 1,
      claimingRunAttempt: options.claimingRunAttempt ?? 2,
    }),
    priorIntentDigest: `sha256:${'2'.repeat(64)}`,
    priorAuthorityEpoch: 7,
    priorAuthorityId: generateUuidV7(),
    priorProposedGenerationId: generateUuidV7(),
    priorPagesBuildVersion:
      options.priorPagesBuildVersion ?? PRIOR_BUILD_VERSION,
    priorFenceEvidenceDigest: `sha256:${'3'.repeat(64)}`,
  });
}

/**
 * Stage one carrier and run recovery-mode activation.
 *
 * @param {any} bound the bound fixture
 * @param {Readonly<Record<string, unknown>>} pagesRecovery the record
 * @returns {Promise<any>} the activation decision
 */
async function activateRecovery(bound, pagesRecovery) {
  const files = [
    { path: 'index.html', bytes: Buffer.from('recovered', 'utf8') },
  ];
  const generationId = generateUuidV7();
  const staged = await adapter.stage({
    destination: bound.destination,
    operationId: generateUuidV7(),
    attemptId: generateUuidV7(),
    idempotencyKey: generateUuidV7(),
    generationId,
    artifactId: generateUuidV7(),
    artifactDigest: computeArtifactDigest(files),
    files,
  });
  return adapter.activate({
    destination: bound.destination,
    stageToken: /** @type {string} */ (staged.stageToken),
    generationId,
    expectedCurrentGenerationId: 'gala:expect-nothing-served',
    mode: RECOVERY_MODE,
    pagesRecovery,
    ...oidcFor(bound.destination),
  });
}

test('an adjacent claim carries the exact empty intervening set; a gapped one carries every strictly intervening attempt', () => {
  assert.deepEqual(
    buildInterveningAttempts({
      repositoryId: '4000',
      runId: RUN_ID,
      priorRunAttempt: 3,
      claimingRunAttempt: 4,
    }),
    [],
  );
  const gapped = buildInterveningAttempts({
    repositoryId: '4000',
    runId: RUN_ID,
    priorRunAttempt: 2,
    claimingRunAttempt: 6,
  });
  assert.deepEqual(
    gapped.map((row) => row.runAttempt),
    [3, 4, 5],
  );
  for (const row of gapped) {
    assert.equal(row.authorityState, 'closed-no-destination-authority');
    assert.equal(
      row.decisionDigest,
      domainDigest('GALA-PAGES-NO-AUTHORITY-RUN-ATTEMPT-V2\0', {
        repositoryId: '4000',
        runId: RUN_ID,
        runAttempt: row.runAttempt,
        authorityState: 'closed-no-destination-authority',
      }),
    );
  }
  // The claiming attempt itself is never tombstoned.
  assert.ok(!gapped.some((row) => row.runAttempt === 6));
});

test('the gap proof digest is the domain-separated JCS of the record with proofDigest omitted', () => {
  const proof = buildRunAttemptGapProof({
    repositoryId: '4000',
    runId: RUN_ID,
    priorRunAttempt: 1,
    claimingRunAttempt: 4,
  });
  assert.equal(proof.profile, 'gala-pages-run-attempt-gap-proof-v2');
  assert.equal(proof.proofDigest, computeGapProofDigest(proof));
  assert.equal(
    proof.proofDigest,
    domainDigest('GALA-PAGES-RUN-ATTEMPT-GAP-PROOF-V2\0', {
      profile: proof.profile,
      runId: proof.runId,
      priorRunAttempt: proof.priorRunAttempt,
      claimingRunAttempt: proof.claimingRunAttempt,
      interveningAttempts: proof.interveningAttempts,
    }),
  );
  assert.doesNotThrow(() =>
    validateRunAttemptGapProof(proof, { repositoryId: '4000' }),
  );
});

test('a missing, extra, reordered or substituted gap row is refused', () => {
  const base = buildRunAttemptGapProof({
    repositoryId: '4000',
    runId: RUN_ID,
    priorRunAttempt: 1,
    claimingRunAttempt: 5,
  });
  const rows = /** @type {any[]} */ (base.interveningAttempts);

  const missing = { ...base, interveningAttempts: rows.slice(1) };
  assert.throws(
    () => validateRunAttemptGapProof(missing, { repositoryId: '4000' }),
    /PAGES_RUN_ATTEMPT_GAP_PROOF_INCOMPLETE/u,
  );
  const extra = {
    ...base,
    interveningAttempts: [
      ...rows,
      {
        runAttempt: 5,
        authorityState: 'closed-no-destination-authority',
        decisionDigest: computeInterveningAttemptDigest({
          repositoryId: '4000',
          runId: RUN_ID,
          runAttempt: 5,
        }),
      },
    ],
  };
  assert.throws(
    () => validateRunAttemptGapProof(extra, { repositoryId: '4000' }),
    /PAGES_RUN_ATTEMPT_GAP_PROOF_INCOMPLETE/u,
  );
  const reordered = { ...base, interveningAttempts: [...rows].reverse() };
  assert.throws(
    () => validateRunAttemptGapProof(reordered, { repositoryId: '4000' }),
    /PAGES_RUN_ATTEMPT_GAP_PROOF_INCOMPLETE/u,
  );
  const substituted = {
    ...base,
    interveningAttempts: rows.map((row, index) =>
      index === 0
        ? { ...row, decisionDigest: `sha256:${'9'.repeat(64)}` }
        : row,
    ),
  };
  assert.throws(
    () => validateRunAttemptGapProof(substituted, { repositoryId: '4000' }),
    /PAGES_RUN_ATTEMPT_GAP_PROOF_INCOMPLETE/u,
  );
  // A tombstone digest bound to a different repository is not this fence's.
  assert.throws(
    () => validateRunAttemptGapProof(base, { repositoryId: '4001' }),
    /PAGES_RUN_ATTEMPT_GAP_PROOF_INCOMPLETE/u,
  );
  assert.throws(
    () =>
      validateRunAttemptGapProof(
        { ...base, proofDigest: `sha256:${'0'.repeat(64)}` },
        { repositoryId: '4000' },
      ),
    /PAGES_RUN_ATTEMPT_GAP_PROOF_DIGEST_MISMATCH/u,
  );
});

test('the two fence coordinates are bounded and strictly ordered', () => {
  for (const { prior, claiming } of [
    { prior: 0, claiming: 2 },
    { prior: 51, claiming: 52 },
    { prior: 1, claiming: 52 },
    { prior: 3, claiming: 3 },
    { prior: 4, claiming: 2 },
  ]) {
    assert.throws(
      () =>
        buildRunAttemptGapProof({
          repositoryId: '4000',
          runId: RUN_ID,
          priorRunAttempt: prior,
          claimingRunAttempt: claiming,
        }),
      /PAGES_RECOVERY_RECORD_INVALID|PAGES_RUN_ATTEMPT_FENCE_INVALID/u,
      `${prior} -> ${claiming} must be refused`,
    );
  }
  // A late, tombstoned attempt can never also be the claiming attempt.
  const proof = buildRunAttemptGapProof({
    repositoryId: '4000',
    runId: RUN_ID,
    priorRunAttempt: 1,
    claimingRunAttempt: 4,
  });
  const rows = /** @type {any[]} */ (proof.interveningAttempts);
  assert.ok(!rows.some((row) => row.runAttempt === proof.claimingRunAttempt));
});

test('a malformed recovery record is refused: bad digest, extra member, wrong profile, short build version', async () => {
  const bound = await bindRecovery();
  try {
    const valid = buildRecoveryRecord(bound.destination);
    assert.doesNotThrow(() =>
      validateReconciliationRecovery(valid, {
        repositoryId: bound.destination.repositoryId,
      }),
    );
    for (const mutated of [
      { ...valid, recoveryDigest: `sha256:${'4'.repeat(64)}` },
      { ...valid, profile: 'gala-pages-reconciliation-recovery-v1' },
      { ...valid, unexpected: 'member' },
      { ...valid, priorPagesBuildVersion: 'short' },
      { ...valid, priorAuthorityEpoch: 0 },
    ]) {
      assert.throws(
        () =>
          validateReconciliationRecovery(mutated, {
            repositoryId: bound.destination.repositoryId,
          }),
        /PAGES_RECOVERY_RECORD_INVALID|PAGES_RECOVERY_DIGEST_MISMATCH/u,
      );
    }
    const withoutOne = { ...valid };
    delete (/** @type {any} */ (withoutOne).priorIntentDigest);
    assert.throws(
      () =>
        validateReconciliationRecovery(withoutOne, {
          repositoryId: bound.destination.repositoryId,
        }),
      /PAGES_RECOVERY_RECORD_INVALID/u,
    );
  } finally {
    await bound.teardown();
  }
});

test('a terminal prior succeed suppresses the duplicate create and terminalizes as terminal-candidate', async () => {
  const bound = await bindRecovery({ priorStatuses: ['succeed'] });
  try {
    const decision = await activateRecovery(
      bound,
      buildRecoveryRecord(bound.destination),
    );
    assert.equal(decision.decision, 'activate');
    assert.equal(decision.terminalState, 'terminal-candidate');
    assert.equal(decision.pagesDeploymentId, PRIOR_BUILD_VERSION);
    assert.equal(bound.provider.createCalls.length, 0);
    assert.equal(bound.provider.cancelled.length, 0);
    assert.equal(decision.pagesRecoveryObservation.outcome, 'prior-succeeded');
  } finally {
    await bound.teardown();
  }
});

test('every admitted prior terminal non-success is recorded exactly and is followed by a fresh successful create', async () => {
  for (const status of [
    'deployment_cancelled',
    'deployment_failed',
    'deployment_content_failed',
    'deployment_lost',
  ]) {
    const bound = await bindRecovery({
      priorStatuses: [status],
      statusSequence: ['succeed'],
    });
    try {
      const decision = await activateRecovery(
        bound,
        buildRecoveryRecord(bound.destination),
      );
      assert.equal(decision.decision, 'activate', status);
      assert.equal(decision.pagesRecoveryObservation.priorStatus, status);
      assert.equal(
        decision.pagesRecoveryObservation.outcome,
        'prior-terminal-failure',
      );
      assert.equal(bound.provider.createCalls.length, 1, status);
      assert.notEqual(
        bound.provider.createCalls[0].pagesBuildVersion,
        PRIOR_BUILD_VERSION,
        'the fresh create uses the current intent build version',
      );
      assert.equal(bound.provider.cancelled.length, 0, status);
    } finally {
      await bound.teardown();
    }
  }
});

test('a temporary prior status permits exactly one cataloged cancel, and cancel-to-terminal admits the fresh create', async () => {
  const bound = await bindRecovery({
    priorStatuses: ['deployment_in_progress'],
    statusSequence: ['succeed'],
    cancelBehaviour: 'terminal',
  });
  try {
    const decision = await activateRecovery(
      bound,
      buildRecoveryRecord(bound.destination),
    );
    assert.deepEqual(bound.provider.cancelled, [PRIOR_BUILD_VERSION]);
    assert.equal(decision.pagesRecoveryObservation.cancelCallCount, 1);
    assert.equal(
      decision.pagesRecoveryObservation.priorStatus,
      'deployment_cancelled',
    );
    assert.equal(decision.decision, 'activate');
    assert.equal(bound.provider.createCalls.length, 1);
  } finally {
    await bound.teardown();
  }
});

test('cancel ambiguity emits truthful evidence, makes no current create and returns the authority to reconciliation-required', async () => {
  const bound = await bindRecovery({
    priorStatuses: ['deployment_in_progress'],
    cancelBehaviour: 'ambiguous',
  });
  try {
    const decision = await activateRecovery(
      bound,
      buildRecoveryRecord(bound.destination),
    );
    assert.equal(decision.decision, 'reconcile');
    assert.equal(decision.authorityState, 'reconciliation-required');
    assert.equal(decision.destinationChanged, false);
    assert.equal(bound.provider.createCalls.length, 0);
    assert.equal(bound.provider.cancelled.length, 1, 'exactly one cancel');
    assert.equal(
      decision.pagesRecoveryObservation.outcome,
      'reconciliation-required',
    );
  } finally {
    await bound.teardown();
  }
});

test('a 404 prior attempt permits one cancel and, if still absent, returns to reconciliation-required with no create', async () => {
  const bound = await bindRecovery({ seedPrior: false });
  try {
    const decision = await activateRecovery(
      bound,
      buildRecoveryRecord(bound.destination),
    );
    assert.equal(decision.decision, 'reconcile');
    assert.equal(decision.authorityState, 'reconciliation-required');
    assert.equal(bound.provider.cancelled.length, 1);
    assert.equal(bound.provider.createCalls.length, 0);
  } finally {
    await bound.teardown();
  }
});

test('an unknown prior status makes no cancel and no create', async () => {
  const bound = await bindRecovery({ priorStatuses: ['not_a_real_status'] });
  try {
    const decision = await activateRecovery(
      bound,
      buildRecoveryRecord(bound.destination),
    );
    assert.equal(decision.decision, 'reconcile');
    assert.equal(bound.provider.cancelled.length, 0);
    assert.equal(bound.provider.createCalls.length, 0);
  } finally {
    await bound.teardown();
  }
});

test('lost create response recovery starts from the preauthorized prior ID and makes no list call', async () => {
  const bound = await bindRecovery({
    priorStatuses: ['deployment_in_progress', 'succeed'],
    cancelBehaviour: 'ambiguous',
  });
  try {
    const decision = await activateRecovery(
      bound,
      buildRecoveryRecord(bound.destination),
    );
    assert.equal(decision.terminalState, 'terminal-candidate');
    const targets = bound.provider.requestLog.map(
      (/** @type {any} */ row) => `${row.method} ${row.target}`,
    );
    assert.ok(
      targets.every(
        (/** @type {string} */ entry) =>
          !/^GET \/repos\/[^/]+\/[^/]+\/pages\/deployments$/u.test(entry),
      ),
      'recovery must never enumerate deployments',
    );
    assert.ok(
      targets.some((/** @type {string} */ entry) =>
        entry.endsWith(`/pages/deployments/${PRIOR_BUILD_VERSION}`),
      ),
    );
  } finally {
    await bound.teardown();
  }
});

test('every recovery-prior call uses priorPagesBuildVersion, never a substituted or current one', async () => {
  const bound = await bindRecovery({
    priorStatuses: ['deployment_in_progress'],
    statusSequence: ['succeed'],
  });
  try {
    await activateRecovery(bound, buildRecoveryRecord(bound.destination));
    for (const row of bound.provider.requestLog) {
      if (row.target.includes('/pages/deployments/')) {
        const id = row.target.split('/pages/deployments/')[1].split('/')[0];
        assert.ok(
          id === PRIOR_BUILD_VERSION ||
            id === bound.provider.createCalls[0]?.pagesBuildVersion,
          `${id} is neither the prior nor the current authorized build version`,
        );
      }
    }
  } finally {
    await bound.teardown();
  }
});

test('normal mode forbids pagesRecovery and refuses every recovery-prior call', async () => {
  const bound = await bindRecovery();
  try {
    const files = [{ path: 'index.html', bytes: Buffer.from('n', 'utf8') }];
    const generationId = generateUuidV7();
    const staged = await adapter.stage({
      destination: bound.destination,
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId,
      artifactId: generateUuidV7(),
      artifactDigest: computeArtifactDigest(files),
      files,
    });
    await assert.rejects(
      adapter.activate({
        destination: bound.destination,
        stageToken: /** @type {string} */ (staged.stageToken),
        generationId,
        expectedCurrentGenerationId: 'gala:expect-nothing-served',
        mode: NORMAL_MODE,
        pagesRecovery: buildRecoveryRecord(bound.destination),
        ...oidcFor(bound.destination),
      }),
      /PAGES_RECOVERY_RECORD_FORBIDDEN/u,
    );

    const normalContext = bindIdentity(
      {
        apiOrigin: bound.destination.apiOrigin,
        owner: bound.destination.owner,
        repository: bound.destination.repository,
        token: bound.destination.token,
        fetch: bound.destination.fetch,
        requestTemplates: buildRequestTemplates(bound.destination.apiOrigin),
      },
      { mode: NORMAL_MODE, priorPagesBuildVersion: PRIOR_BUILD_VERSION },
    );
    await assert.rejects(
      callProvider(normalContext, 'inspect', 'pages-recovery-prior-status', {
        acceptStatuses: [200, 404],
      }),
      /PAGES_RECOVERY_CALL_FORBIDDEN/u,
    );
    await assert.rejects(
      callProvider(
        normalContext,
        'cleanup-staged',
        'pages-recovery-prior-cancel',
        { acceptStatuses: [200, 204, 404] },
      ),
      /PAGES_RECOVERY_CALL_FORBIDDEN/u,
    );
    assert.equal(bound.provider.cancelled.length, 0);
  } finally {
    await bound.teardown();
  }
});

test('no evidence a recovery activation produces contains either credential', async () => {
  const bound = await bindRecovery({
    priorStatuses: ['deployment_failed'],
    statusSequence: ['succeed'],
  });
  try {
    const credentials = oidcFor(bound.destination);
    const decision = await activateRecovery(
      bound,
      buildRecoveryRecord(bound.destination),
    );
    const serialized = JSON.stringify(decision);
    assert.ok(!serialized.includes(credentials.pagesOidcToken));
    assert.ok(!serialized.includes(bound.destination.token));
    assert.equal(
      bound.provider.createCalls[0].memberNames.join(','),
      'artifact_id,oidc_token,pages_build_version',
    );
    for (const row of bound.provider.requestLog) {
      assert.ok(
        !JSON.stringify(row.headers).includes(credentials.pagesOidcToken),
        'the OIDC token must never appear in a header',
      );
    }
  } finally {
    await bound.teardown();
  }
});
