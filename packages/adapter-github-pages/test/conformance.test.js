/**
 * Run the reusable `@rathnasgala2/adapter-conformance-kit` suite against
 * this package's real implementation, bound to a local fake GitHub Pages
 * provider (S4-T04). Every lifecycle call below issues real HTTP requests,
 * builds a real deterministic carrier and reads the result back over a real
 * public origin; only the transport hop is local, which is the most that
 * can be proven without the live disposable repository W4-16 owns.
 */

import { randomBytes } from 'node:crypto';

import { runAdapterConformanceSuite } from '@rathnasgala2/adapter-conformance-kit';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as realAdapterModule from '../src/index.js';
import {
  EXPECT_NOTHING_SERVED,
  buildRunAttemptGapProof,
  computeArtifactDigest,
  fenceFor,
  forgetDestination,
  generateUuidV7,
  sealRecoveryRecord,
} from '../src/index.js';
import { startFakePagesProvider } from './fake-pages-provider.js';
import { oidcFor } from './oidc-fixture.js';

/**
 * The kit drives this package's real module. The only fixture-owned
 * addition is the Pages OIDC credential: the kit has no hook for a
 * destination credential, so the fake-issuer token and its expected
 * bindings are attached to the destination itself in `createDestination`,
 * exactly as the workflow attaches the real one.
 *
 * @type {typeof realAdapterModule}
 */
const adapterModule = realAdapterModule;

/**
 * Every destination the suite creates, keyed by its repository name, so the
 * out-of-band tamper hook can reach the exact provider backing it.
 *
 * @type {Map<string, Awaited<ReturnType<typeof startFakePagesProvider>>>}
 */
const providersByRepository = new Map();

/**
 * @param {number} seed a distinct seed
 * @returns {{path: string, bytes: Buffer}[]} a small deterministic file set
 */
function buildFiles(seed) {
  const salt = randomBytes(4).toString('hex');
  return [
    {
      path: 'index.html',
      bytes: Buffer.from(
        `<!doctype html><title>seed ${seed} ${salt}</title>`,
        'utf8',
      ),
    },
    {
      path: 'about/index.html',
      bytes: Buffer.from(`about ${seed} ${salt}`, 'utf8'),
    },
  ];
}

let sequence = 0;

const runtimeFixture = {
  adapterModule,
  adapterId: 'github-pages',
  computeArtifactDigest,
  async createDestination() {
    sequence += 1;
    const provider = await startFakePagesProvider({
      repository: `disposable-pages-${sequence}`,
    });
    providersByRepository.set(provider.repository, provider);
    const destination = {
      owner: provider.owner,
      repository: provider.repository,
      repositoryId: String(1000 + sequence),
      repositoryOwnerId: '99001',
      apiOrigin: provider.apiOrigin,
      publicBaseUrl: provider.publicBaseUrl,
      token: provider.token,
      publishCarrier: provider.publishCarrier,
      fetch: provider.fetch,
      ...(() => {
        const credentials = oidcFor({
          owner: provider.owner,
          repository: provider.repository,
          repositoryId: String(1000 + sequence),
          repositoryOwnerId: '99001',
        });
        return {
          oidcToken: credentials.pagesOidcToken,
          oidcClaims: credentials.pagesOidcClaims,
        };
      })(),
      /**
       * The conformance suite must not spend the real `5, 8, 12, ...`
       * second poll schedule in wall-clock time; the schedule itself is
       * asserted directly in `index.test.js`.
       *
       * @returns {Promise<void>} resolves immediately
       */
      sleep: () => Promise.resolve(),
    };
    return {
      destination,
      async teardown() {
        forgetDestination(destination);
        providersByRepository.delete(provider.repository);
        await provider.stop();
      },
    };
  },
  makeFiles: buildFiles,
  /**
   * @param {unknown} destination the destination under test
   * @returns {Promise<void>} resolves once one served byte has changed
   */
  tamperServedByte(destination) {
    const repository = /** @type {{repository: string}} */ (destination)
      .repository;
    const provider = providersByRepository.get(repository);
    if (provider === undefined) {
      throw new Error(`no fake provider registered for ${repository}`);
    }
    const bytes = provider.served.get('index.html');
    if (bytes === undefined) {
      throw new Error('tamperServedByte: nothing is currently served');
    }
    const mutated = Buffer.from(bytes);
    mutated.writeUInt8((mutated.readUInt8(0) + 1) % 256, 0);
    provider.served.set('index.html', mutated);
    return Promise.resolve();
  },
  /**
   * @param {unknown} destination the destination under test
   * @param {number} seed a distinct seed for `makeFiles`
   * @returns {Promise<{stageToken: string, generationId: string}>} the
   *   abandoned attempt's identities
   */
  async simulateInterruptedActivation(destination, seed) {
    const typed = /** @type {import('../src/index.js').PagesDestination} */ (
      destination
    );
    const files = buildFiles(seed);
    const generationId = generateUuidV7();
    const observed = /** @type {{currentGenerationId: string | null}} */ (
      await realAdapterModule.inspectDestination(typed)
    );
    const staged = await realAdapterModule.stage({
      destination: typed,
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId,
      artifactId: generateUuidV7(),
      artifactDigest: computeArtifactDigest(files),
      files,
    });

    let threw = false;
    try {
      await realAdapterModule.activate({
        destination: typed,
        stageToken: /** @type {string} */ (staged.stageToken),
        generationId,
        // The suite calls this after a first generation is already served,
        // so the honest fence is the observed generation, not the
        // "nothing is served" sentinel.
        expectedCurrentGenerationId: fenceFor(observed.currentGenerationId),
        crashInjectionHook: () => {
          throw new Error('INJECTED_ACTIVATION_CRASH: simulated interruption');
        },
      });
    } catch (error) {
      threw = true;
      if (
        !/INJECTED_ACTIVATION_CRASH/u.test(/** @type {Error} */ (error).message)
      ) {
        throw error;
      }
    }
    if (!threw) {
      throw new Error(
        'simulateInterruptedActivation: the crash injection hook did not interrupt activation',
      );
    }
    return {
      stageToken: /** @type {string} */ (staged.stageToken),
      generationId,
    };
  },
};

runAdapterConformanceSuite(/** @type {any} */ (runtimeFixture));

/**
 * Recovery-mode conformance. The reusable kit only knows the `normal`
 * lifecycle, so the `pages-reconciliation-recovery` mode DEC-097 section 6.2
 * adds is covered here against the same real fixture: the same destination
 * factory, the same real HTTP transport and the same public origin.
 */

const RECOVERY_PRIOR_BUILD_VERSION = 'e'.repeat(40);

/**
 * Build one server-minted recovery record for a destination.
 *
 * @param {any} destination the destination under test
 * @returns {Readonly<Record<string, unknown>>} the sealed record
 */
function recoveryRecordFor(destination) {
  return sealRecoveryRecord({
    profile: 'gala-pages-reconciliation-recovery-v2',
    reconcileCommandId: generateUuidV7(),
    reconcileCommandDigest: `sha256:${'1'.repeat(64)}`,
    reconcileCommandExpiresAt: '2026-09-18T00:00:00Z',
    priorAttemptId: generateUuidV7(),
    runAttemptGapProof: buildRunAttemptGapProof({
      repositoryId: destination.repositoryId,
      runId: '17654321098',
      priorRunAttempt: 1,
      claimingRunAttempt: 3,
    }),
    priorIntentDigest: `sha256:${'2'.repeat(64)}`,
    priorAuthorityEpoch: 3,
    priorAuthorityId: generateUuidV7(),
    priorProposedGenerationId: generateUuidV7(),
    priorPagesBuildVersion: RECOVERY_PRIOR_BUILD_VERSION,
    priorFenceEvidenceDigest: `sha256:${'3'.repeat(64)}`,
  });
}

/**
 * Stage one generation and activate it in recovery mode.
 *
 * @param {any} destination the destination under test
 * @param {number} seed a distinct seed
 * @returns {Promise<any>} the activation decision
 */
async function activateInRecoveryMode(destination, seed) {
  const files = buildFiles(seed);
  const generationId = generateUuidV7();
  const staged = await realAdapterModule.stage({
    destination,
    operationId: generateUuidV7(),
    attemptId: generateUuidV7(),
    idempotencyKey: generateUuidV7(),
    generationId,
    artifactId: generateUuidV7(),
    artifactDigest: computeArtifactDigest(files),
    files,
  });
  const decision = await realAdapterModule.activate({
    destination,
    stageToken: /** @type {string} */ (staged.stageToken),
    generationId,
    expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    mode: 'pages-reconciliation-recovery',
    pagesRecovery: recoveryRecordFor(destination),
  });
  return {
    decision,
    generationId,
    artifactDigest: computeArtifactDigest(files),
  };
}

test('[conformance] github-pages: recovery mode suppresses the duplicate create when the prior attempt already succeeded', async () => {
  const { destination, teardown } = await runtimeFixture.createDestination();
  try {
    const provider = providersByRepository.get(
      /** @type {any} */ (destination).repository,
    );
    /** @type {any} */ (provider).seedDeployment(RECOVERY_PRIOR_BUILD_VERSION, [
      'succeed',
    ]);
    const { decision } = await activateInRecoveryMode(destination, 900);
    assert.equal(decision.decision, 'activate');
    assert.equal(decision.terminalState, 'terminal-candidate');
    assert.equal(decision.pagesDeploymentId, RECOVERY_PRIOR_BUILD_VERSION);
    assert.equal(/** @type {any} */ (provider).createCalls.length, 0);
  } finally {
    await teardown();
  }
});

test('[conformance] github-pages: recovery mode proceeds with a fresh create after an immutable prior terminal non-success, and the result verifies publicly', async () => {
  const { destination, teardown } = await runtimeFixture.createDestination();
  try {
    const provider = providersByRepository.get(
      /** @type {any} */ (destination).repository,
    );
    /** @type {any} */ (provider).seedDeployment(RECOVERY_PRIOR_BUILD_VERSION, [
      'deployment_failed',
    ]);
    const { decision, generationId, artifactDigest } =
      await activateInRecoveryMode(destination, 901);
    assert.equal(decision.decision, 'activate');
    assert.equal(
      decision.pagesRecoveryObservation.priorStatus,
      'deployment_failed',
    );
    assert.equal(/** @type {any} */ (provider).createCalls.length, 1);

    const observed = await realAdapterModule.observe({
      destination: /** @type {any} */ (destination),
      generationId,
      expectedArtifactDigest: artifactDigest,
    });
    assert.equal(observed.verified, true);
  } finally {
    await teardown();
  }
});

test('[conformance] github-pages: an unresolvable prior attempt returns the authority to reconciliation-required and leaves the destination untouched', async () => {
  const { destination, teardown } = await runtimeFixture.createDestination();
  try {
    const provider = providersByRepository.get(
      /** @type {any} */ (destination).repository,
    );
    // Never seeded: the prior build version 404s, so recovery issues exactly
    // one cancel and then cannot resolve it.
    const { decision } = await activateInRecoveryMode(destination, 902);
    assert.equal(decision.decision, 'reconcile');
    assert.equal(decision.authorityState, 'reconciliation-required');
    assert.equal(decision.destinationChanged, false);
    assert.equal(/** @type {any} */ (provider).createCalls.length, 0);
    assert.deepEqual(/** @type {any} */ (provider).cancelled, [
      RECOVERY_PRIOR_BUILD_VERSION,
    ]);

    const inspected = await realAdapterModule.inspectDestination(
      /** @type {any} */ (destination),
    );
    assert.equal(inspected.currentGenerationId, null);
  } finally {
    await teardown();
  }
});

test('[conformance] github-pages: normal mode refuses a recovery record outright', async () => {
  const { destination, teardown } = await runtimeFixture.createDestination();
  try {
    const files = buildFiles(903);
    const generationId = generateUuidV7();
    const staged = await realAdapterModule.stage({
      destination: /** @type {any} */ (destination),
      operationId: generateUuidV7(),
      attemptId: generateUuidV7(),
      idempotencyKey: generateUuidV7(),
      generationId,
      artifactId: generateUuidV7(),
      artifactDigest: computeArtifactDigest(files),
      files,
    });
    await assert.rejects(
      realAdapterModule.activate({
        destination: /** @type {any} */ (destination),
        stageToken: /** @type {string} */ (staged.stageToken),
        generationId,
        expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
        mode: 'normal',
        pagesRecovery: recoveryRecordFor(destination),
      }),
      /PAGES_RECOVERY_RECORD_FORBIDDEN/u,
    );
  } finally {
    await teardown();
  }
});
