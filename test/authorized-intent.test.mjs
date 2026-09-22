/**
 * The deploy-side binding to the Gala-side authorization
 * (`scripts/workflow/authorized-intent.mjs`).
 *
 * The intent the exchange returned is the only source of the adapter, the
 * destination, the provider coordinates, the activation fence and every
 * operation identity a managed job uses. These tests pin that: a member
 * taken from anywhere else is a defect, every internal disagreement is a
 * named refusal, and an intent bound to another repository or operation is
 * refused before a destination is touched.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EXPECT_NOTHING_SERVED } from '@rathnasgala2/adapter-protocol';

import {
  AuthorizedIntentError,
  assertIntentBoundToRunner,
  assertJournalAgreesWithIntent,
  bindAuthorizedIntent,
  providerBindingOf,
} from '../scripts/workflow/authorized-intent.mjs';
import { buildDeploymentIntentRequest } from '../scripts/workflow/workload-requests.mjs';
import { authorizationInput } from './fixtures/authorization-input.mjs';
import {
  renderIntent,
  seedWithDefaults,
  stableId,
} from './fixtures/fake-gala-api.mjs';

const REPOSITORY = 'gala-author/site';
const REPOSITORY_ID = '4242';
const OPERATION_ID = stableId();
const RUN_ID = '987654321';
const RUN_ATTEMPT = 1;
const SEED = Object.freeze({
  galaIssuer: 'https://api.gala.example/',
  repository: REPOSITORY,
  repositoryId: REPOSITORY_ID,
  operationId: OPERATION_ID,
  policyReleaseId: '019c0000-0000-7000-8000-0000000000bb',
});
/** The verified workload binding the fake Gala renders the subject URN from. */
const BINDING = Object.freeze({
  repositoryId: REPOSITORY_ID,
  runId: RUN_ID,
  runAttempt: RUN_ATTEMPT,
});

/**
 * The runner environment a deploy job sees for this operation.
 *
 * @param {Record<string, string>} [extra] overrides
 * @returns {Record<string, string>} the runner identity
 */
function runner(extra = {}) {
  return {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REF: `refs/heads/gala/publish/${OPERATION_ID}`,
    GITHUB_REPOSITORY_ID: REPOSITORY_ID,
    GITHUB_REPOSITORY_OWNER_ID: '99',
    GITHUB_RUN_ID: RUN_ID,
    GITHUB_RUN_ATTEMPT: String(RUN_ATTEMPT),
    ...extra,
  };
}

/**
 * One retained intent exactly as the fake Gala renders it for a request
 * this workflow built. Gala can issue for `github-pages` and
 * `local-directory` today (LOCAL-60; Spaces waits for C2).
 *
 * @param {'local-directory' | 'github-pages'} adapterId the adapter
 * @param {{expectedGenerationId?: string, omitProviderBinding?: boolean}} [levers]
 *   the Gala-side levers
 * @returns {Record<string, any>} the intent
 */
function intentFor(adapterId, levers = {}) {
  const { request, derived } = buildDeploymentIntentRequest(
    /** @type {any} */ (
      authorizationInput({
        adapterId,
        operationId: OPERATION_ID,
        repositoryId: REPOSITORY_ID,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
      })
    ),
  );
  return renderIntent(request, seedWithDefaults({ ...SEED }), {
    intentId: stableId(),
    artifactId: derived.artifactId,
    attemptId: derived.attemptId,
    generationId: derived.proposedGenerationId,
    authorityId: stableId(),
    binding: { ...BINDING },
    ...(derived.pagesBuildVersion === undefined
      ? {}
      : { pagesBuildVersion: derived.pagesBuildVersion }),
    ...(derived.spacesStagePrefix === undefined
      ? {}
      : { spacesStagePrefix: derived.spacesStagePrefix }),
    ...levers,
  });
}

/**
 * @param {Record<string, unknown>} intent the intent
 * @param {Record<string, string>} [env] the runner
 * @returns {ReturnType<typeof bindAuthorizedIntent>} the binding
 */
function bind(intent, env = runner()) {
  return bindAuthorizedIntent({
    authorization: {
      deploymentIntent: intent,
      marker: intent.marker,
      responseKind: 'deployment-intent',
    },
    runner: env,
  });
}

/**
 * @param {() => unknown} action the refused action
 * @param {string} code the expected closed code
 * @param {RegExp} [detail] an expected detail fragment
 * @returns {void}
 */
function refused(action, code, detail) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AuthorizedIntentError, String(error));
    assert.equal(error.code, code);
    if (detail !== undefined) {
      assert.match(error.message, detail);
    }
    return true;
  });
}

test('every value a deploy job uses is the intent’s, member by member, and the journal says so', () => {
  for (const adapterId of /** @type {const} */ ([
    'github-pages',
    'local-directory',
  ])) {
    const intent = intentFor(adapterId);
    const bound = bind(intent);
    assert.equal(bound.adapterId, adapterId);
    assert.equal(bound.adapterVersion, intent.adapter.adapterVersion);
    assert.equal(bound.adapterDigest, intent.adapter.adapterDigest);
    assert.deepEqual(bound.destination, intent.destination);
    assert.deepEqual(
      bound.providerBinding,
      adapterId === 'local-directory'
        ? null
        : intent.destination.providerBinding,
    );
    assert.equal(bound.operationId, intent.operationId);
    assert.equal(bound.attemptId, intent.attemptId);
    assert.equal(bound.proposedGenerationId, intent.proposedGenerationId);
    assert.equal(bound.artifactId, intent.artifactId);
    assert.equal(bound.artifactDigest, intent.artifactDigest);
    assert.equal(bound.intentDigest, intent.intentDigest);
    assert.equal(
      bound.expectedGenerationId,
      EXPECT_NOTHING_SERVED,
      'an intent without expectedGenerationId is a first publish: the explicit sentinel, never null',
    );
    assert.equal(bound.journal.source, 'deployment-intent');
    assert.equal(bound.journal.fenceSource, 'intent-first-publish-sentinel');
    assert.deepEqual(bound.journal.adapter, intent.adapter);
    assert.deepEqual(bound.journal.destination, intent.destination);
    assert.equal(bound.journal.intentDigest, intent.intentDigest);
    assert.equal(bound.journal.responseKind, 'deployment-intent');
    assert.equal(
      bound.journal.subject,
      `urn:gala:workload:github:${REPOSITORY_ID}:${RUN_ID}:${RUN_ATTEMPT}`,
    );
    assert.equal(
      bound.journal.workloadBindingDigest,
      intent.workloadBindingDigest,
    );
    assert.equal(
      /** @type {any} */ (bound.journal.authority).destinationMutationKeyDigest,
      intent.destinationMutationAuthority.destinationMutationKeyDigest,
    );
  }
});

test('the fence is the intent’s expectedGenerationId when Gala states one', () => {
  const served = stableId();
  const bound = bind(
    intentFor('github-pages', { expectedGenerationId: served }),
  );
  assert.equal(bound.expectedGenerationId, served);
  assert.equal(bound.journal.fenceSource, 'intent');
});

test('a fence that is neither a generation identity nor the sentinel is malformed', () => {
  // `null` included: the wire never admits it, and only an *absent* member
  // is a first publish, so it must not be read as the sentinel.
  for (const value of [
    'not-a-generation',
    '',
    'GALA:EXPECT-NOTHING-SERVED',
    null,
  ]) {
    const intent = intentFor('github-pages');
    intent.expectedGenerationId = value;
    intent.destinationMutationAuthority.expectedGenerationId = value;
    refused(
      () => bind(intent),
      'DEPLOY_INTENT_MALFORMED',
      /expectedGenerationId/u,
    );
  }
});

test('an intent bound to another workload or operation is refused before anything else', () => {
  const intent = intentFor('github-pages');
  // The subject is the DEC-097 workload URN: the numeric repository id, the
  // run id and the attempt. A repository *name* is not part of the binding
  // (it can be renamed under a running operation), so it is never compared.
  for (const [name, value] of [
    ['GITHUB_REPOSITORY_ID', '9999'],
    ['GITHUB_RUN_ID', '1'],
    ['GITHUB_RUN_ATTEMPT', '2'],
  ]) {
    refused(
      () => bind(intent, runner({ [String(name)]: String(value) })),
      'DEPLOY_INTENT_IDENTITY_MISMATCH',
      /repository, run or attempt/u,
    );
  }
  for (const name of [
    'GITHUB_REPOSITORY_ID',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
  ]) {
    refused(
      () => bind(intent, runner({ [name]: '' })),
      'DEPLOY_RUNNER_IDENTITY_MISSING',
      new RegExp(name, 'u'),
    );
  }
  assert.equal(
    assertIntentBoundToRunner(
      intent,
      runner({ GITHUB_REPOSITORY: 'Renamed/Elsewhere' }),
    ).operationId,
    OPERATION_ID,
    'a renamed repository does not unbind a workload bound by immutable ids',
  );
  refused(
    () =>
      bind(
        intent,
        runner({ GITHUB_REF: `refs/heads/gala/publish/${stableId()}` }),
      ),
    'DEPLOY_INTENT_IDENTITY_MISMATCH',
    /operation other than/u,
  );
  refused(
    () => bind(intent, runner({ GITHUB_REF: 'refs/heads/main' })),
    'DEPLOY_INTENT_IDENTITY_MISMATCH',
    /publish\/<operationId> ref/u,
  );
  refused(
    () => bind(intent, runner({ GITHUB_REF: '' })),
    'DEPLOY_RUNNER_IDENTITY_MISSING',
    /GITHUB_REF/u,
  );
  const bound = assertIntentBoundToRunner(intent, runner());
  assert.deepEqual(
    { ...bound, workloadBindingDigest: undefined },
    {
      ref: `refs/heads/gala/publish/${OPERATION_ID}`,
      operationId: OPERATION_ID,
      repositoryId: REPOSITORY_ID,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      subject: intent.subject,
      workloadBindingDigest: undefined,
    },
  );
  assert.equal(bound.workloadBindingDigest, intent.workloadBindingDigest);
});

test('the OIDC subject form of a pre-API-INTENT-DERIVATION-1 server is refused by its own code; a malformed subject or a missing binding digest is malformed', () => {
  const legacy = intentFor('github-pages');
  legacy.subject = `repo:${REPOSITORY}:ref:refs/heads/gala/publish/${OPERATION_ID}`;
  refused(
    () => bind(legacy),
    'DEPLOY_INTENT_SUBJECT_LEGACY',
    /not the DEC-097 workload URN/u,
  );
  for (const subject of [
    'urn:gala:workload:github:4242:987654321',
    'urn:gala:workload:github:04242:987654321:1',
    'urn:gala:workload:github:4242:987654321:52',
    'urn:gala:workload:gitlab:4242:987654321:1',
    '',
  ]) {
    const intent = intentFor('github-pages');
    intent.subject = subject;
    refused(() => bind(intent), 'DEPLOY_INTENT_MALFORMED', /subject/u);
  }
  const unbound = intentFor('github-pages');
  delete unbound.workloadBindingDigest;
  refused(
    () => bind(unbound),
    'DEPLOY_INTENT_MALFORMED',
    /workloadBindingDigest/u,
  );
});

test('an expired intent, or one past its operation deadline, is refused', () => {
  const intent = intentFor('github-pages');
  refused(
    () =>
      bindAuthorizedIntent({
        authorization: { deploymentIntent: intent, marker: intent.marker },
        runner: runner(),
        now: () => new Date(Date.parse(intent.expiresAt) + 1),
      }),
    'DEPLOY_INTENT_EXPIRED',
  );
});

test('an intent whose members disagree with each other is refused by name', () => {
  /** @type {ReadonlyArray<{name: string, mutate: (intent: any) => void, detail: RegExp}>} */
  const cases = [
    {
      name: 'adapter vs destination',
      mutate: (intent) => {
        intent.destination.adapterVersion = '9.9.9';
        intent.destinationMutationAuthority.destination.adapterVersion =
          '9.9.9';
      },
      detail: /adapter and destination/u,
    },
    {
      name: 'marker vs intent',
      mutate: (intent) => {
        intent.marker.generationId = stableId();
      },
      detail: /public marker/u,
    },
    {
      name: 'authority operation',
      mutate: (intent) => {
        intent.destinationMutationAuthority.operationId = stableId();
      },
      detail: /authority names another operation/u,
    },
    {
      name: 'authority destination',
      mutate: (intent) => {
        intent.destinationMutationAuthority.destination = {
          ...intent.destination,
          baseUrl: 'https://elsewhere.test/',
        };
      },
      detail: /another destination/u,
    },
    {
      name: 'authority fence',
      mutate: (intent) => {
        intent.destinationMutationAuthority.expectedGenerationId = stableId();
      },
      detail: /different activation fences/u,
    },
  ];
  for (const { name, mutate, detail } of cases) {
    const intent = intentFor('github-pages');
    mutate(intent);
    refused(() => bind(intent), 'DEPLOY_INTENT_INCONSISTENT', detail);
    assert.ok(name);
  }
  // The fence key is Gala's own `destinationMutationKey` digest (a
  // different domain from `targetDigest`, DEC-097 lines 3295-3317): the job
  // records it and never recomputes it, but it must be a digest.
  const keyed = intentFor('github-pages');
  assert.notEqual(
    keyed.destinationMutationAuthority.destinationMutationKeyDigest,
    keyed.destination.targetDigest,
  );
  keyed.destinationMutationAuthority.destinationMutationKeyDigest = 'nope';
  refused(
    () => bind(keyed),
    'DEPLOY_INTENT_MALFORMED',
    /destinationMutationKeyDigest/u,
  );
  // The carrier's own top-level marker must be the intent's marker.
  const intent = intentFor('github-pages');
  refused(
    () =>
      bindAuthorizedIntent({
        authorization: {
          deploymentIntent: intent,
          marker: { ...intent.marker, artifactId: stableId() },
        },
        runner: runner(),
      }),
    'DEPLOY_INTENT_INCONSISTENT',
    /carrier marker/u,
  );
});

test('a required member that is absent or off-shape is malformed, never defaulted', () => {
  for (const [member, value] of /** @type {const} */ ([
    ['operationId', undefined],
    ['proposedGenerationId', 'gen-1'],
    ['artifactDigest', 'sha1:abc'],
    ['intentDigest', undefined],
    ['adapter', undefined],
    ['destination', { adapterId: 'github-pages' }],
    ['marker', undefined],
    ['destinationMutationAuthority', undefined],
    ['expiresAt', '2026-09-17T00:00:00Z'],
    ['capability', 'observe'],
    ['audience', 'urn:gala:something-else:v2'],
  ])) {
    const intent = intentFor('github-pages');
    if (value === undefined) {
      delete intent[member];
    } else {
      intent[member] = value;
    }
    refused(() => bind(intent), 'DEPLOY_INTENT_MALFORMED');
  }
  const outside = intentFor('github-pages');
  outside.adapter.adapterId = 'cloudflare-pages';
  outside.destination.adapterId = 'cloudflare-pages';
  refused(
    () => bind(outside),
    'DEPLOY_INTENT_MALFORMED',
    /closed adapter vocabulary|destination/u,
  );
});

test('a managed intent without providerBinding fails closed by name; local-directory must carry none', () => {
  for (const adapterId of /** @type {const} */ (['github-pages'])) {
    const intent = intentFor(adapterId, { omitProviderBinding: true });
    assert.equal(intent.destination.providerBinding, undefined);
    refused(
      () => bind(intent),
      'DEPLOY_DESTINATION_BINDING_INVALID',
      /providerBinding is absent/u,
    );
    refused(
      () => providerBindingOf(intent),
      'DEPLOY_DESTINATION_BINDING_INVALID',
    );
  }
  const local = intentFor('local-directory');
  assert.equal(providerBindingOf(local), null);
  local.destination.providerBinding = { owner: 'x', repository: 'y' };
  local.destinationMutationAuthority.destination = { ...local.destination };
  refused(() => bind(local), 'DEPLOY_INTENT_MALFORMED', /providerBinding/u);
});

test('the report refuses a kernel journal that was not produced under this intent', () => {
  const intent = intentFor('github-pages');
  const head = {
    operationId: intent.operationId,
    attemptId: intent.attemptId,
    generationId: intent.proposedGenerationId,
    adapterId: intent.adapter.adapterId,
    adapterVersion: intent.adapter.adapterVersion,
    authorization: { intentDigest: intent.intentDigest },
  };
  assertJournalAgreesWithIntent(head, intent);
  for (const [member, value] of [
    ['operationId', stableId()],
    ['generationId', stableId()],
    ['adapterId', 'do-spaces'],
    ['authorization', { intentDigest: `sha256:${'e'.repeat(64)}` }],
    ['authorization', undefined],
  ]) {
    refused(
      () =>
        assertJournalAgreesWithIntent(
          { ...head, [String(member)]: value },
          intent,
        ),
      'DEPLOY_INTENT_IDENTITY_MISMATCH',
      new RegExp(String(member).replace('.', '\\.'), 'u'),
    );
  }
});
