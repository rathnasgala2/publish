/**
 * The 2.9.0 exchange rules, proved through the adapters Gala can issue for
 * with the real kernel run in the middle:
 *
 *   exchange(deployment-intent) -> runKernelDeployment(adapter) ->
 *   exchange(deployment-receipt) -> deployment-receipts -> replay
 *
 * What each round trip asserts, per adapter:
 *
 * - every exchange answer carries its constant 2.8.0 `kind`, classified by
 *   `gala-api.mjs` and recorded alongside the state;
 * - LOCAL-60 / schema 2.9.0: the request carries only what the workflow
 *   holds, and the retained intent carries what Gala derived — the adapter's
 *   environment constant, a `targetDigest` that is the schema package's own
 *   `destinationProviderBinding` profile over Gala's retained binding (the
 *   Pages binding from the seeded repository, the local binding from the
 *   request's two evidence digests), retained provider coordinates for Pages
 *   and none for `local-directory`, the four Gala-owned `rebuildRecord`
 *   members and `capabilityDecisionDigest`, and the DEC-097 workload URN as
 *   `subject`;
 * - the API's server-derived `pagesBuildVersion` equals the value this
 *   workflow derives from the same closed binding (LOCAL-57);
 * - the intent the API issued is the intent the kernel run activates and
 *   the report is accepted against.
 *
 * Plus the edges LOCAL-57 and LOCAL-60 turn into contract: a sent value that
 * disagrees with a derivation is `422 VALIDATION_FAILED` naming the member,
 * omitting it is accepted with the derived value in the intent, a request
 * whose `adapter` and `destination` name different adapters is `422` at
 * `/destination/adapterId`, and a `do-spaces` request is
 * `409 INVALID_SOURCE_STATE` until the publication destination record
 * exists (C2). The eleven `parity/digest-record-vectors.json` vectors are
 * reproduced through the same profiles the fake Gala derives with.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as localDirectory from '@rathnasgala2/adapter-local-directory';
import * as pages from '@rathnasgala2/adapter-github-pages';
import * as spaces from '@rathnasgala2/adapter-do-spaces';
import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import { startFakePagesProvider } from '../packages/adapter-github-pages/test/fake-pages-provider.js';
import { oidcFor } from '../packages/adapter-github-pages/test/oidc-fixture.js';
import { startFakeSpaces } from '../packages/adapter-do-spaces/test/fake-s3-server.js';
import {
  DEPLOYMENT_INTENT_AUDIENCE,
  DEPLOYMENT_RECEIPT_AUDIENCE,
  GalaApiError,
  postDeploymentReceipt,
  postReceiptExchange,
  requestOidcAssertion,
} from '../scripts/workflow/gala-api.mjs';
import {
  AuthorizedIntentError,
  bindAuthorizedIntent,
} from '../scripts/workflow/authorized-intent.mjs';
import { requireCapabilityDecisionAgreement } from '../scripts/workflow/capability-decision.mjs';
import { runKernelDeployment } from '../scripts/workflow/kernel-run.mjs';
import {
  ADAPTER_ENVIRONMENTS,
  REBUILD_RECORD_API_DERIVED,
} from '../scripts/workflow/workload-contract.mjs';
import {
  buildDeploymentIntentRequest,
  buildReceiptExchangeRequest,
  buildReceiptSubmission,
} from '../scripts/workflow/workload-requests.mjs';
import { frozenEnvelopeFor } from './fixtures/artifact-manifest.mjs';
import {
  ARTIFACT_FILES,
  PROVIDER_BINDINGS,
  authorizationInput,
} from './fixtures/authorization-input.mjs';
import {
  deriveDestination,
  deriveRebuildRecord,
  seedWithDefaults,
  startFakeGalaApi,
  stableId,
} from './fixtures/fake-gala-api.mjs';
import {
  boundClaims,
  startFakeOidcIssuer,
} from './fixtures/fake-oidc-issuer.mjs';

const OWNER = 'gala-author';
const REPOSITORY_NAME = 'site';
const REPOSITORY = `${OWNER}/${REPOSITORY_NAME}`;
const REPOSITORY_ID = '4242';
const REPOSITORY_OWNER_ID = '99';
const RUN_ID = '987654321';
const RUN_ATTEMPT = 1;
const SHA = 'c'.repeat(40);
const HELPERS = Object.freeze({
  [DEPLOYMENT_INTENT_AUDIENCE]: 'authorize-v2.yml',
  [DEPLOYMENT_RECEIPT_AUDIENCE]: 'report-v2.yml',
});
/**
 * @param {string} name a DEC-097 record profile the schema package exports
 * @returns {{digest: (value: unknown) => string}} the profile
 */
function profile(name) {
  const found =
    /** @type {Record<string, {digest: (value: unknown) => string} | undefined>} */ (
      /** @type {unknown} */ (ACTIVE_DIGEST_PROFILES)
    )[name];
  assert.ok(found !== undefined, `${name} is exported`);
  return found;
}

/**
 * One issuer/Gala pair bound to one operation, plus the runner environment
 * `requestOidcAssertion` reads.
 *
 * @returns {Promise<{
 *   operationId: string,
 *   gala: Awaited<ReturnType<typeof startFakeGalaApi>>,
 *   assertionFor: (audience: string) => Promise<string>,
 *   close: () => Promise<void>
 * }>} the bound pair
 */
async function startBoundGala() {
  const operationId = stableId();
  /** @type {{origin: string}} */
  const self = { origin: '' };
  const issuer = await startFakeOidcIssuer({
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
        workflowRef: `rathnasgala2/publish/.github/workflows/publish-v2.yml@${SHA}`,
      }),
  });
  self.origin = issuer.issuer;
  const gala = await startFakeGalaApi({
    issuer: issuer.issuer,
    jwksUri: issuer.jwksUri,
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    repositoryOwnerId: REPOSITORY_OWNER_ID,
    operationId,
  });
  return {
    operationId,
    gala,
    assertionFor: async (audience) => {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = issuer.tokenRequestUrl;
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = issuer.runnerBearer;
      try {
        return await requestOidcAssertion(audience);
      } finally {
        delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
        delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
      }
    },
    close: async () => {
      await gala.close();
      await issuer.close();
    },
  };
}

/**
 * @typedef {{
 *   adapterId: 'github-pages' | 'do-spaces' | 'local-directory',
 *   module: Record<string, unknown>,
 *   destination: Record<string, unknown>,
 *   providerBinding: Record<string, string> | undefined,
 *   retainedProviderBinding: Record<string, string> | undefined,
 *   baseUrl: string,
 *   artifactDigest: string,
 *   activateExtras?: Record<string, unknown>,
 *   stop: () => Promise<void>
 * }} BoundAdapter
 */

/** @type {ReadonlyArray<{adapterId: BoundAdapter['adapterId'], bind: () => Promise<BoundAdapter>}>} */
const ISSUABLE_ADAPTERS = [
  {
    adapterId: 'github-pages',
    bind: async () => {
      const provider = await startFakePagesProvider({
        owner: OWNER,
        repository: REPOSITORY_NAME,
      });
      const destination = {
        owner: provider.owner,
        repository: provider.repository,
        repositoryId: REPOSITORY_ID,
        repositoryOwnerId: REPOSITORY_OWNER_ID,
        apiOrigin: provider.apiOrigin,
        publicBaseUrl: provider.publicBaseUrl,
        token: provider.token,
        publishCarrier: provider.publishCarrier,
        fetch: provider.fetch,
        /**
         * @returns {Promise<void>} resolves immediately
         */
        sleep: () => Promise.resolve(),
      };
      const coordinates = {
        owner: provider.owner,
        repository: provider.repository,
      };
      return {
        adapterId: 'github-pages',
        module: { ...pages },
        destination,
        providerBinding: coordinates,
        retainedProviderBinding: coordinates,
        baseUrl: `${provider.publicBaseUrl}/`,
        artifactDigest: pages.computeArtifactDigest(ARTIFACT_FILES),
        activateExtras: oidcFor(destination),
        stop: () => provider.stop(),
      };
    },
  },
  {
    adapterId: 'local-directory',
    bind: async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'gala-derivation-'));
      return {
        adapterId: 'local-directory',
        module: { ...localDirectory },
        destination: { root },
        // The two DEC-097 section 7 local evidence digests the request
        // supplies; the retained destination carries no coordinates.
        providerBinding: {
          .../** @type {Record<string, string>} */ (
            PROVIDER_BINDINGS['local-directory']
          ),
        },
        retainedProviderBinding: undefined,
        baseUrl: 'https://example.test/',
        artifactDigest: localDirectory.computeArtifactDigest(ARTIFACT_FILES),
        stop: () => rm(root, { recursive: true, force: true }),
      };
    },
  },
];

/**
 * @returns {Promise<BoundAdapter>} the bound Pages adapter and its fake provider
 */
function bindPages() {
  const pages_ = ISSUABLE_ADAPTERS.find(
    (entry) => entry.adapterId === 'github-pages',
  );
  assert.ok(pages_ !== undefined);
  return pages_.bind();
}

/**
 * The exchange request for one bound adapter.
 *
 * @param {BoundAdapter} bound the bound adapter
 * @param {string} operationId the operation
 * @param {Record<string, unknown>} [overrides] builder input overrides
 * @returns {ReturnType<typeof buildDeploymentIntentRequest>} the built request
 */
function requestFor(bound, operationId, overrides = {}) {
  return buildDeploymentIntentRequest(
    /** @type {any} */ ({
      ...authorizationInput({
        adapterId: bound.adapterId,
        operationId,
        repositoryId: REPOSITORY_ID,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
        artifactDigest: bound.artifactDigest,
        destination: {
          baseUrl: bound.baseUrl,
          ...(bound.providerBinding === undefined
            ? {}
            : { providerBinding: bound.providerBinding }),
        },
      }),
      ...overrides,
    }),
  );
}

/**
 * The provider binding record Gala retains for one bound adapter and the
 * two digests DEC-097 sections 6 and 7 take over it, computed here with the
 * schema package's own profiles — independently of the fake Gala.
 *
 * @param {BoundAdapter} bound the bound adapter
 * @returns {{targetDigest: string, mutationKeyDigest: string}} the two digests
 */
function expectedDestinationDigests(bound) {
  if (bound.adapterId === 'github-pages') {
    return {
      targetDigest: profile('destinationProviderBinding').digest({
        kind: 'github-pages',
        repository: REPOSITORY,
        repositoryId: REPOSITORY_ID,
        apiOrigin: 'https://api.github.com',
        environment: 'github-pages',
      }),
      mutationKeyDigest: profile('destinationMutationKey').digest({
        kind: 'github-pages',
        repositoryId: REPOSITORY_ID,
      }),
    };
  }
  const binding = /** @type {Record<string, string>} */ (bound.providerBinding);
  return {
    targetDigest: profile('destinationProviderBinding').digest({
      kind: 'local-directory',
      rootIdentityDigest: binding.rootIdentityDigest,
      mutationSurfaceDigest: binding.mutationSurfaceDigest,
    }),
    mutationKeyDigest: profile('destinationMutationKey').digest({
      kind: 'local-directory',
      mutationSurfaceDigest: binding.mutationSurfaceDigest,
    }),
  };
}

/**
 * The runner identity a deploy job holds for one operation.
 *
 * @param {string} operationId the operation the publish ref names
 * @returns {Record<string, string>} the runner environment
 */
function runnerFor(operationId) {
  return {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REF: `refs/heads/gala/publish/${operationId}`,
    GITHUB_REPOSITORY_ID: REPOSITORY_ID,
    GITHUB_REPOSITORY_OWNER_ID: REPOSITORY_OWNER_ID,
    GITHUB_RUN_ID: RUN_ID,
    GITHUB_RUN_ATTEMPT: String(RUN_ATTEMPT),
  };
}

/**
 * @param {Promise<unknown>} action the refused exchange
 * @param {number} status the expected status
 * @param {string} problemCode the expected wire code
 * @param {string} [pointer] the expected `errors[0].pointer`
 * @returns {Promise<void>} resolves once the refusal matched
 */
async function refused(action, status, problemCode, pointer) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof GalaApiError, String(error));
    assert.equal(error.code, 'WORKLOAD_EXCHANGE_REFUSED');
    assert.equal(error.status, status);
    assert.equal(error.problemCode, problemCode);
    if (pointer !== undefined) {
      assert.deepEqual(
        error.errors.map((entry) => entry.pointer),
        [pointer],
      );
    }
    return true;
  });
}

for (const { adapterId, bind } of ISSUABLE_ADAPTERS) {
  test(`${adapterId}: the exchange, the kernel run, the receipt exchange and the report agree on kind and binding`, async () => {
    const bound = await bind();
    const site = await startBoundGala();
    try {
      // --- exchange(deployment-intent) -----------------------------------
      const { request, derived } = requestFor(bound, site.operationId);
      const authorized = await postReceiptExchange({
        origin: site.gala.origin,
        assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
        request,
      });
      assert.equal(authorized.state, 'deployment-authorization');
      assert.equal(authorized.kind, 'deployment-intent');
      const intent = /** @type {Record<string, any>} */ (
        authorized.body.deploymentIntent
      );
      // LOCAL-60: what Gala derived, checked against the schema package's
      // own profiles rather than against the fake's arithmetic.
      const digests = expectedDestinationDigests(bound);
      assert.equal(
        intent.destination.environment,
        ADAPTER_ENVIRONMENTS[adapterId],
      );
      assert.equal(intent.destination.targetDigest, digests.targetDigest);
      assert.equal(
        intent.destinationMutationAuthority.destinationMutationKeyDigest,
        digests.mutationKeyDigest,
        'the fence key is its own domain, not the request or target digest',
      );
      assert.notEqual(digests.mutationKeyDigest, digests.targetDigest);
      assert.deepEqual(
        intent.destination.providerBinding,
        bound.retainedProviderBinding,
        'the retained intent names Gala’s coordinates for Pages and none for local-directory',
      );
      for (const member of ['adapterId', 'adapterVersion', 'baseUrl']) {
        assert.equal(
          intent.destination[member],
          /** @type {any} */ (request.destination)[member],
        );
      }
      for (const member of REBUILD_RECORD_API_DERIVED) {
        assert.match(
          String(intent.rebuildRecord[member]),
          /^(?:sha256:[0-9a-f]{64}|[0-9a-f-]{36})$/u,
        );
        assert.equal(
          /** @type {any} */ (request.rebuildRecord)[member],
          undefined,
        );
      }
      assert.equal(
        intent.rebuildRecord.policyReleaseId,
        intent.policyReleaseId,
      );
      for (const [member, value] of Object.entries(
        /** @type {Record<string, unknown>} */ (request.rebuildRecord),
      )) {
        assert.deepEqual(intent.rebuildRecord[member], value, member);
      }
      assert.match(intent.capabilityDecisionDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(
        intent.subject,
        `urn:gala:workload:github:${REPOSITORY_ID}:${RUN_ID}:${RUN_ATTEMPT}`,
      );
      assert.equal(intent.artifactId, derived.artifactId);
      assert.equal(intent.attemptId, derived.attemptId);
      assert.equal(intent.proposedGenerationId, derived.proposedGenerationId);
      assert.equal(intent.pagesBuildVersion, derived.pagesBuildVersion);
      assert.equal(intent.spacesStagePrefix, undefined);
      // The intent binds the frozen envelope's own metadata records: the
      // fixture input is derived from a real envelope over ARTIFACT_FILES,
      // so the retained digests are the decoder's recomputation, not a
      // placeholder the API echoed.
      const envelope = frozenEnvelopeFor([...ARTIFACT_FILES]).decoded;
      assert.equal(intent.manifestDigest, envelope.manifestDigest);
      assert.equal(intent.provenanceDigest, envelope.provenanceDigest);
      assert.equal(intent.sbomDigest, envelope.sbomDigest);
      assert.equal(
        String(intent.frozenEnvelopeByteCount),
        String(envelope.frozenEnvelopeByteCount),
      );
      assert.equal(intent.frozenEnvelopeDigest, envelope.frozenEnvelopeDigest);

      // --- the deploy-side binding: the intent is the only source ---------
      const authorized_ = bindAuthorizedIntent({
        authorization: {
          deploymentIntent: intent,
          marker: intent.marker,
          responseKind: authorized.kind,
        },
        runner: runnerFor(site.operationId),
      });
      assert.equal(authorized_.adapterId, adapterId);
      assert.deepEqual(authorized_.destination, intent.destination);
      assert.deepEqual(
        authorized_.providerBinding,
        bound.retainedProviderBinding ?? null,
      );
      assert.equal(
        authorized_.expectedGenerationId,
        'gala:expect-nothing-served',
        'Gala issued a first-publish intent: the fence is the explicit sentinel',
      );
      assert.equal(authorized_.journal.intentDigest, intent.intentDigest);
      assert.equal(authorized_.journal.subject, intent.subject);
      // LOCAL-62: the deploy job's recomputation of the issuance-phase
      // capability decision agrees with what Gala issued.
      assert.equal(
        requireCapabilityDecisionAgreement(intent, {
          runId: RUN_ID,
          runAttempt: RUN_ATTEMPT,
        }).decisionDigest,
        intent.capabilityDecisionDigest,
      );
      assert.equal(
        authorized_.journal.workloadBindingDigest,
        intent.workloadBindingDigest,
      );

      // --- the kernel run against the adapter, with the issued intent ----
      const outcome = await runKernelDeployment({
        adapterModule: bound.module,
        destination: bound.destination,
        destinationIdentity: authorized_.destination,
        intent: authorized_.intent,
        files: [...ARTIFACT_FILES],
        ...(bound.activateExtras === undefined
          ? {}
          : { activateExtras: bound.activateExtras }),
      });
      assert.equal(outcome.decision, 'activate', adapterId);
      assert.equal(outcome.verified, true, adapterId);
      assert.equal(outcome.generationId, intent.proposedGenerationId);
      assert.equal(
        JSON.parse(JSON.stringify(outcome.journal.attempts[1])).inputDigest !==
          undefined,
        true,
      );

      // --- exchange(deployment-receipt) ----------------------------------
      const issued = await postReceiptExchange({
        origin: site.gala.origin,
        assertion: await site.assertionFor(DEPLOYMENT_RECEIPT_AUDIENCE),
        request: buildReceiptExchangeRequest({
          operationId: intent.operationId,
          attemptId: intent.attemptId,
          intentDigest: intent.intentDigest,
          reportChallengeId: String(authorized.body.reportChallengeId),
        }),
      });
      assert.equal(issued.state, 'capability-issued');
      assert.equal(issued.kind, 'deployment-receipt-capability-issued');

      // --- the report ----------------------------------------------------
      const evidence = await postDeploymentReceipt({
        origin: site.gala.origin,
        capability: String(issued.body.reportingCapability),
        submission: buildReceiptSubmission({
          intent,
          journal: {
            attempts: outcome.journal.attempts,
            observations: outcome.journal.observations,
          },
          repositoryId: REPOSITORY_ID,
          runId: RUN_ID,
          runAttempt: RUN_ATTEMPT,
          publisherVersion: '0.1.0',
          observedRoutes: outcome.journal.observedRoutes,
          workflowStartedAt: '2026-09-17T00:00:00.000Z',
          // `toISOString` is the contract's millisecond subset exactly; the
          // cutoff must not precede the journal's own last instant.
          workflowCompletedAt: new Date(Date.now() + 500).toISOString(),
          destinationGenerationId: String(outcome.generationId),
        }),
      });
      assert.equal(evidence.outcome, 'submission-recorded');
      assert.equal(evidence.status, 202);
      assert.equal(evidence.operationId, site.operationId);

      // --- the replay ----------------------------------------------------
      const replayed = await postReceiptExchange({
        origin: site.gala.origin,
        assertion: await site.assertionFor(DEPLOYMENT_RECEIPT_AUDIENCE),
        request: buildReceiptExchangeRequest({
          operationId: intent.operationId,
          attemptId: intent.attemptId,
          intentDigest: intent.intentDigest,
          reportChallengeId: String(authorized.body.reportChallengeId),
        }),
      });
      assert.equal(replayed.state, 'submission-recorded');
      assert.equal(replayed.kind, 'deployment-receipt-submission-recorded');
    } finally {
      await site.close();
      await bound.stop();
    }
  });

  test(`${adapterId}: an intent whose Gala-stated fence disagrees with the destination is refused before staging`, async () => {
    const bound = await bind();
    const site = await startBoundGala();
    try {
      // Gala believes some generation is already served; the destination
      // serves nothing. The fence comes from the intent, not from what the
      // run observes, so the kernel refuses before the adapter stages.
      site.gala.state.expectedGenerationId = stableId();
      const { request } = requestFor(bound, site.operationId);
      const authorized = await postReceiptExchange({
        origin: site.gala.origin,
        assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
        request,
      });
      const intent = /** @type {Record<string, any>} */ (
        authorized.body.deploymentIntent
      );
      assert.equal(
        intent.expectedGenerationId,
        site.gala.state.expectedGenerationId,
      );
      const bound_ = bindAuthorizedIntent({
        authorization: { deploymentIntent: intent, marker: intent.marker },
        runner: runnerFor(site.operationId),
      });
      assert.equal(bound_.expectedGenerationId, intent.expectedGenerationId);
      assert.equal(bound_.journal.fenceSource, 'intent');

      let staged = 0;
      const outcome = await runKernelDeployment({
        adapterModule: {
          ...bound.module,
          /**
           * @param {unknown} input the stage input
           * @returns {Promise<unknown>} the adapter's own result
           */
          stage: (input) => {
            staged += 1;
            return /** @type {any} */ (bound.module).stage(input);
          },
        },
        destination: bound.destination,
        destinationIdentity: bound_.destination,
        intent: bound_.intent,
        files: [...ARTIFACT_FILES],
        ...(bound.activateExtras === undefined
          ? {}
          : { activateExtras: bound.activateExtras }),
      });
      assert.equal(outcome.decision, 'reconcile', adapterId);
      assert.equal(staged, 0, 'nothing was staged');
      assert.deepEqual(
        outcome.journal.attempts.map((attempt) => attempt.outcome),
        ['skipped'],
      );
    } finally {
      await site.close();
      await bound.stop();
    }
  });

  test(`${adapterId}: a present member that disagrees with Gala’s derivation is 422 VALIDATION_FAILED naming it; the agreeing value is accepted (LOCAL-60)`, async () => {
    const bound = await bind();
    try {
      // First, learn what Gala derives by sending nothing derivable.
      const learn = await startBoundGala();
      /** @type {Record<string, any>} */
      let intent;
      try {
        const { request } = requestFor(bound, learn.operationId);
        assert.equal(
          /** @type {any} */ (request.destination).environment,
          undefined,
        );
        assert.equal(
          /** @type {any} */ (request.destination).targetDigest,
          undefined,
        );
        assert.equal(request.capabilityDecisionDigest, undefined);
        const authorized = await postReceiptExchange({
          origin: learn.gala.origin,
          assertion: await learn.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
          request,
        });
        intent = /** @type {Record<string, any>} */ (
          authorized.body.deploymentIntent
        );
      } finally {
        await learn.close();
      }

      // A sent environment other than the adapter's constant is outside the
      // contract's own `if`/`then` vocabulary: `400 VALIDATION_FAILED` at
      // the member, before any derivation.
      {
        const site = await startBoundGala();
        try {
          const outside = /** @type {any} */ (
            structuredClone(requestFor(bound, site.operationId).request)
          );
          outside.destination.environment =
            adapterId === 'github-pages' ? 'local-directory' : 'github-pages';
          await refused(
            postReceiptExchange({
              origin: site.gala.origin,
              assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
              request: outside,
            }),
            400,
            'VALIDATION_FAILED',
            '/destination/environment',
          );
        } finally {
          await site.close();
        }
      }

      // Every disagreeing member is refused by pointer, before any intent
      // is retained.
      /** @type {ReadonlyArray<[string, (request: any) => void]>} */
      const disagreements = [
        [
          '/destination/targetDigest',
          (request) => {
            request.destination.targetDigest = `sha256:${'d'.repeat(64)}`;
          },
        ],
        ...(adapterId === 'github-pages'
          ? /** @type {ReadonlyArray<[string, (request: any) => void]>} */ ([
              [
                '/destination/providerBinding/repository',
                (request) => {
                  request.destination.providerBinding.repository = 'other';
                },
              ],
            ])
          : []),
        ...REBUILD_RECORD_API_DERIVED.map(
          (member) =>
            /** @type {[string, (request: any) => void]} */ ([
              `/rebuildRecord/${member}`,
              (request) => {
                request.rebuildRecord[member] =
                  member === 'policyReleaseId'
                    ? stableId()
                    : `sha256:${'e'.repeat(64)}`;
              },
            ]),
        ),
        [
          '/capabilityDecisionDigest',
          (request) => {
            request.capabilityDecisionDigest = `sha256:${'a'.repeat(64)}`;
          },
        ],
        // API-INTENT-DERIVATION-1 review / LOCAL-64: the admission row is
        // selected by (adapterId, adapterVersion) among the admitted rows —
        // a never-admitted version and the superseded 0045 `2.0.0` row are
        // both refused — and the destination names that same version.
        [
          '/adapter/adapterVersion',
          (request) => {
            request.adapter.adapterVersion = '9.9.9';
            request.destination.adapterVersion = '9.9.9';
          },
        ],
        [
          '/adapter/adapterVersion',
          (request) => {
            request.adapter.adapterVersion = '2.0.0';
            request.destination.adapterVersion = '2.0.0';
          },
        ],
        [
          '/destination/adapterVersion',
          (request) => {
            request.destination.adapterVersion = '2.0.1';
          },
        ],
      ];
      for (const [pointer, mutate] of disagreements) {
        const site = await startBoundGala();
        try {
          const disagreeing = structuredClone(
            requestFor(bound, site.operationId).request,
          );
          mutate(disagreeing);
          await refused(
            postReceiptExchange({
              origin: site.gala.origin,
              assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
              request: disagreeing,
            }),
            422,
            'VALIDATION_FAILED',
            pointer,
          );
          assert.equal(
            site.gala.state.intent,
            null,
            `${pointer}: no intent retained`,
          );
        } finally {
          await site.close();
        }
      }

      // The agreeing values — exactly what Gala derived — are accepted, and
      // the derivations are the same for the same seed and request.
      const site = await startBoundGala();
      try {
        const agreeing = /** @type {any} */ (
          structuredClone(requestFor(bound, site.operationId).request)
        );
        agreeing.destination.environment = intent.destination.environment;
        agreeing.destination.targetDigest = intent.destination.targetDigest;
        for (const member of REBUILD_RECORD_API_DERIVED) {
          agreeing.rebuildRecord[member] = intent.rebuildRecord[member];
        }
        const authorized = await postReceiptExchange({
          origin: site.gala.origin,
          assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
          request: agreeing,
        });
        const again = /** @type {Record<string, any>} */ (
          authorized.body.deploymentIntent
        );
        assert.equal(
          again.destination.targetDigest,
          intent.destination.targetDigest,
        );
        for (const member of REBUILD_RECORD_API_DERIVED) {
          assert.equal(
            again.rebuildRecord[member],
            intent.rebuildRecord[member],
          );
        }
      } finally {
        await site.close();
      }
    } finally {
      await bound.stop();
    }
  });
}

test('github-pages: a server that does not retain providerBinding cannot authorize a managed deploy; local-directory needs none', async () => {
  for (const { adapterId, bind } of ISSUABLE_ADAPTERS) {
    const bound = await bind();
    const site = await startBoundGala();
    try {
      site.gala.state.omitProviderBinding = true;
      const { request } = requestFor(bound, site.operationId);
      const authorized = await postReceiptExchange({
        origin: site.gala.origin,
        assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
        request,
      });
      const intent = /** @type {Record<string, any>} */ (
        authorized.body.deploymentIntent
      );
      assert.equal(intent.destination.providerBinding, undefined);
      const bindIt = () =>
        bindAuthorizedIntent({
          authorization: { deploymentIntent: intent, marker: intent.marker },
          runner: runnerFor(site.operationId),
        });
      if (adapterId === 'local-directory') {
        assert.equal(bindIt().providerBinding, null);
        continue;
      }
      assert.throws(bindIt, (error) => {
        assert.ok(error instanceof AuthorizedIntentError);
        assert.equal(error.code, 'DEPLOY_DESTINATION_BINDING_INVALID');
        assert.match(error.message, /providerBinding is absent/u);
        return true;
      });
    } finally {
      await site.close();
      await bound.stop();
    }
  }
});

test('github-pages: a sent pagesBuildVersion that disagrees is 422 VALIDATION_FAILED, and omitting it is accepted (LOCAL-57)', async () => {
  const bound = await bindPages();
  const site = await startBoundGala();
  try {
    const { request, derived } = requestFor(bound, site.operationId);
    await refused(
      postReceiptExchange({
        origin: site.gala.origin,
        assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
        request: { ...request, pagesBuildVersion: 'f'.repeat(40) },
      }),
      422,
      'VALIDATION_FAILED',
    );
    assert.equal(
      site.gala.state.intent,
      null,
      'a refused disagreement retains no intent',
    );

    const omitted = requestFor(bound, site.operationId, {
      sendDerivedConditionalMembers: false,
    });
    assert.equal(omitted.request.pagesBuildVersion, undefined);
    const answer = await postReceiptExchange({
      origin: site.gala.origin,
      assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
      request: omitted.request,
    });
    assert.equal(answer.kind, 'deployment-intent');
    const intent = /** @type {Record<string, any>} */ (
      answer.body.deploymentIntent
    );
    assert.equal(
      intent.pagesBuildVersion,
      derived.pagesBuildVersion,
      'the retained intent carries the server derivation, which is the one this workflow derives too',
    );
  } finally {
    await site.close();
    await bound.stop();
  }
});

test('a request whose adapter and destination name different adapters is 422 at /destination/adapterId; local-directory without its evidence digests is 422 at /destination/providerBinding', async () => {
  const bound = await bindPages();
  const site = await startBoundGala();
  try {
    const mismatched = /** @type {any} */ (
      structuredClone(requestFor(bound, site.operationId).request)
    );
    mismatched.destination = {
      adapterId: 'local-directory',
      adapterVersion: mismatched.destination.adapterVersion,
      baseUrl: mismatched.destination.baseUrl,
      providerBinding: { ...PROVIDER_BINDINGS['local-directory'] },
    };
    await refused(
      postReceiptExchange({
        origin: site.gala.origin,
        assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
        request: mismatched,
      }),
      422,
      'VALIDATION_FAILED',
      '/destination/adapterId',
    );

    const local = /** @type {any} */ (
      structuredClone(
        requestFor(
          {
            ...bound,
            adapterId: 'local-directory',
            artifactDigest:
              localDirectory.computeArtifactDigest(ARTIFACT_FILES),
            providerBinding: { ...PROVIDER_BINDINGS['local-directory'] },
          },
          site.operationId,
        ).request,
      )
    );
    delete local.destination.providerBinding;
    await refused(
      postReceiptExchange({
        origin: site.gala.origin,
        assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
        request: local,
      }),
      422,
      'VALIDATION_FAILED',
      '/destination/providerBinding',
    );
    assert.equal(site.gala.state.intent, null);
  } finally {
    await site.close();
    await bound.stop();
  }
});

test('do-spaces: Gala refuses issuance with 409 INVALID_SOURCE_STATE until the publication destination record exists (C2), and the request itself carries no coordinates', async () => {
  const provider = await startFakeSpaces();
  const site = await startBoundGala();
  try {
    const destination = {
      region: provider.region,
      servedBucket: provider.servedBucket,
      stagingBucket: provider.stagingBucket,
      accessKeyId: provider.accessKeyId,
      secretAccessKey: provider.secretAccessKey,
      fetch: provider.fetch,
      publicFetch: provider.fetch,
    };
    const { request } = buildDeploymentIntentRequest(
      /** @type {any} */ (
        authorizationInput({
          adapterId: 'do-spaces',
          operationId: site.operationId,
          repositoryId: REPOSITORY_ID,
          runId: RUN_ID,
          runAttempt: RUN_ATTEMPT,
          artifactDigest: spaces.computeArtifactDigest(ARTIFACT_FILES),
          destination: {
            baseUrl: `${spaces.deriveOrigins(destination).publicOrigin}/`,
          },
        })
      ),
    );
    assert.equal(
      /** @type {any} */ (request.destination).providerBinding,
      undefined,
    );
    assert.ok(String(request.spacesStagePrefix).startsWith('_gala/staged/v2/'));
    await refused(
      postReceiptExchange({
        origin: site.gala.origin,
        assertion: await site.assertionFor(DEPLOYMENT_INTENT_AUDIENCE),
        request,
      }),
      409,
      'INVALID_SOURCE_STATE',
    );
    assert.equal(site.gala.state.intent, null);
  } finally {
    await site.close();
    await provider.stop?.();
  }
});

test('the fake Gala derives with the schema package’s profiles: the sixteen digest-record vectors reproduce, and the fake’s own derivations equal the vectors on the vectors’ inputs', async () => {
  const vectors = JSON.parse(
    await readFile(
      fileURLToPath(
        import.meta
          .resolve('@rathnasgala2/schemas/parity/digest-record-vectors.json'),
      ),
      'utf8',
    ),
  );
  // Schema 2.10.0 (LOCAL-63) added five Spaces vectors to the 2.9.0 eleven:
  // the website-configuration root and docs base-path records, the
  // control-plane binding, the region catalog, and the chained realistic
  // destinationProviderBinding.
  assert.equal(vectors.vectors.length, 16);
  for (const vector of vectors.vectors) {
    assert.equal(
      profile(vector.profile).digest(vector.input),
      `sha256:${vector.digestHex}`,
      vector.vectorId,
    );
  }
  const byId = new Map(
    vectors.vectors.map((/** @type {any} */ vector) => [
      vector.vectorId,
      vector,
    ]),
  );

  // Pages: the seeded repository of the vector yields the vector's target
  // digest and mutation key; the request members are optional.
  const pagesVector = byId.get('destination-provider-binding-github-pages');
  const seed = seedWithDefaults({
    repository: pagesVector.input.repository,
    repositoryId: pagesVector.input.repositoryId,
    operationId: stableId(),
  });
  const pagesRequest = {
    adapter: { adapterId: 'github-pages', adapterVersion: '0.1.0' },
    destination: {
      adapterId: 'github-pages',
      adapterVersion: '0.1.0',
      baseUrl: 'https://example.site/',
    },
  };
  const pagesDerived = deriveDestination(pagesRequest, seed);
  assert.equal(
    pagesDerived.destination.targetDigest,
    `sha256:${pagesVector.digestHex}`,
  );
  assert.equal(
    pagesDerived.mutationKeyDigest,
    `sha256:${byId.get('destination-mutation-key-github-pages').digestHex}`,
  );
  assert.deepEqual(pagesDerived.destination.providerBinding, {
    owner: 'rathnasgala2',
    repository: 'example.site',
  });
  assert.equal(pagesDerived.destination.environment, 'github-pages');

  // Local: the request's two evidence digests yield the vector's digests.
  const localVector = byId.get('destination-provider-binding-local-directory');
  const localDerived = deriveDestination(
    {
      adapter: { adapterId: 'local-directory', adapterVersion: '0.1.0' },
      destination: {
        adapterId: 'local-directory',
        adapterVersion: '0.1.0',
        baseUrl: 'https://example.site/',
        providerBinding: {
          rootIdentityDigest: localVector.input.rootIdentityDigest,
          mutationSurfaceDigest: localVector.input.mutationSurfaceDigest,
        },
      },
    },
    seed,
  );
  assert.equal(
    localDerived.destination.targetDigest,
    `sha256:${localVector.digestHex}`,
  );
  assert.equal(
    localDerived.mutationKeyDigest,
    `sha256:${byId.get('destination-mutation-key-local-directory').digestHex}`,
  );
  assert.equal(localDerived.destination.providerBinding, undefined);

  // Spaces (LOCAL-63 C2): a seeded publication_destination-equivalent
  // record yields the chained realistic vector's targetDigest, and the
  // rendered destination.providerBinding is exactly the three retained
  // coordinates (never the full ten-member closed record).
  const spacesVector = byId.get(
    'destination-provider-binding-do-spaces-realistic',
  );
  const spacesSeed = seedWithDefaults({
    repository: pagesVector.input.repository,
    repositoryId: pagesVector.input.repositoryId,
    operationId: stableId(),
    destination: {
      adapterId: 'do-spaces',
      spaces: {
        region: spacesVector.input.region,
        servedBucket: spacesVector.input.servedBucket,
        stagingBucket: spacesVector.input.stagingBucket,
        basePath: '/',
      },
    },
  });
  const spacesDerived = deriveDestination(
    {
      adapter: { adapterId: 'do-spaces', adapterVersion: '0.1.0' },
      destination: { adapterId: 'do-spaces', adapterVersion: '0.1.0' },
      rebuildRecord: { basePath: '/' },
    },
    spacesSeed,
  );
  assert.equal(
    spacesDerived.destination.targetDigest,
    `sha256:${spacesVector.digestHex}`,
  );
  assert.deepEqual(spacesDerived.destination.providerBinding, {
    region: spacesVector.input.region,
    servedBucket: spacesVector.input.servedBucket,
    stagingBucket: spacesVector.input.stagingBucket,
  });
  assert.ok(spacesDerived.spacesClosedRecordDigests !== undefined);
  assert.equal(
    spacesDerived.spacesClosedRecordDigests.spacesWebsiteConfigurationDigest,
    spacesVector.input.websiteConfigurationDigest,
  );
  assert.equal(
    spacesDerived.spacesClosedRecordDigests.spacesControlPlaneBindingDigest,
    spacesVector.input.controlPlaneBindingDigest,
  );

  // The mutation-key vector uses a different bucket pair than the realistic
  // binding vector; prove the fence key separately against its own seed.
  const spacesMutationKeyVector = byId.get(
    'destination-mutation-key-do-spaces',
  );
  const spacesMutationKeySeed = seedWithDefaults({
    repository: pagesVector.input.repository,
    repositoryId: pagesVector.input.repositoryId,
    operationId: stableId(),
    destination: {
      adapterId: 'do-spaces',
      spaces: {
        region: spacesMutationKeyVector.input.region,
        servedBucket: spacesMutationKeyVector.input.servedBucket,
        stagingBucket: 'gala-example-staging',
        basePath: '/',
      },
    },
  });
  const spacesMutationKeyDerived = deriveDestination(
    {
      adapter: { adapterId: 'do-spaces', adapterVersion: '0.1.0' },
      destination: { adapterId: 'do-spaces', adapterVersion: '0.1.0' },
      rebuildRecord: { basePath: '/' },
    },
    spacesMutationKeySeed,
  );
  assert.equal(
    spacesMutationKeyDerived.mutationKeyDigest,
    `sha256:${spacesMutationKeyVector.digestHex}`,
  );

  // A do-spaces request with no seeded destination is refused 409, never
  // silently derived from the request (LOCAL-63: no request member can
  // supply Spaces provider coordinates).
  assert.throws(
    () =>
      deriveDestination(
        {
          adapter: { adapterId: 'do-spaces', adapterVersion: '0.1.0' },
          destination: { adapterId: 'do-spaces', adapterVersion: '0.1.0' },
          rebuildRecord: { basePath: '/' },
        },
        seedWithDefaults({
          repository: pagesVector.input.repository,
          repositoryId: pagesVector.input.repositoryId,
          operationId: stableId(),
        }),
      ),
    /SOURCE_STATE_INVALID/u,
  );

  // Build policy: the vector's release and manifest yield the vector's
  // decision digest.
  const policyVector = byId.get('build-policy-decision-pass');
  const rebuilt = deriveRebuildRecord(
    {
      manifestDigest: policyVector.input.manifestDigest,
      rebuildRecord: {},
    },
    seedWithDefaults({ policyReleaseId: policyVector.input.policyReleaseId }),
    `sha256:${pagesVector.digestHex}`,
  );
  assert.equal(
    rebuilt.buildPolicyDecisionDigest,
    `sha256:${policyVector.digestHex}`,
  );
  assert.equal(rebuilt.policyReleaseId, policyVector.input.policyReleaseId);
});
