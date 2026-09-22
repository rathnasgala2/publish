/**
 * The managed deploy job's destination binding (schema 2.8.0
 * `destination.providerBinding`, LOCAL-55 (2)): the authorized intent is the
 * only source of provider coordinates, the runner's own identity supplies
 * the numeric ids the Pages OIDC subject is recomputed against, and an
 * intent that omits the binding — or names a repository this runner cannot
 * deploy to — fails closed before any credential is read. The intent here
 * carries the *retained* destination identity (what Gala rendered from its
 * own record, schema 2.9.0), not the request-side one the workflow sent.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  destinationIdentityFrom,
  pagesDestinationBinding,
  requireAdapterVersionAgreement,
  spacesDestination,
} from '../scripts/workflow/deploy.mjs';
import {
  recomputeSpacesClosedRecords,
  requireCapabilityDecisionAgreement,
} from '../scripts/workflow/capability-decision.mjs';
import { buildDeploymentIntentRequest } from '../scripts/workflow/workload-requests.mjs';
import * as spaces from '@rathnasgala2/adapter-do-spaces';

import {
  authorizationInput,
  retainedDestinationFor,
} from './fixtures/authorization-input.mjs';
import {
  renderIntent,
  seedWithDefaults,
  stableId,
} from './fixtures/fake-gala-api.mjs';

const RUNNER = Object.freeze({
  GITHUB_REPOSITORY: 'Gala-Author/site',
  GITHUB_REPOSITORY_ID: '4242',
  GITHUB_REPOSITORY_OWNER_ID: '99',
});

/**
 * @param {'github-pages' | 'do-spaces' | 'local-directory'} adapterId the adapter
 * @returns {Record<string, unknown>} a minimal intent carrying that destination
 */
function intentFor(adapterId) {
  return { destination: retainedDestinationFor(adapterId) };
}

test('the Pages destination is the authorized providerBinding plus the runner identity', () => {
  const bound = pagesDestinationBinding(intentFor('github-pages'), RUNNER);
  assert.deepEqual(bound, {
    owner: 'gala-author',
    repository: 'site',
    repositoryId: '4242',
    repositoryOwnerId: '99',
    publicBaseUrl: 'https://example.test/',
  });
});

test('a Pages binding naming another repository than the runner is refused', () => {
  assert.throws(
    () =>
      pagesDestinationBinding(intentFor('github-pages'), {
        ...RUNNER,
        GITHUB_REPOSITORY: 'someone-else/site',
      }),
    /DEPLOY_DESTINATION_BINDING_INVALID: .*other than the one this job runs in/u,
  );
  for (const missing of [
    'GITHUB_REPOSITORY_ID',
    'GITHUB_REPOSITORY_OWNER_ID',
  ]) {
    assert.throws(
      () =>
        pagesDestinationBinding(intentFor('github-pages'), {
          ...RUNNER,
          [missing]: '',
        }),
      new RegExp(`DEPLOY_RUNNER_IDENTITY_MISSING: ${missing}`, 'u'),
    );
  }
});

test('an intent without a providerBinding fails closed by name instead of inventing one', () => {
  const intent = intentFor('github-pages');
  delete (
    /** @type {Record<string, any>} */ (intent.destination).providerBinding
  );
  assert.throws(
    () => pagesDestinationBinding(intent, RUNNER),
    /destination\.providerBinding is absent/u,
  );
  const partial = intentFor('do-spaces');
  delete (
    /** @type {Record<string, any>} */ (partial.destination).providerBinding
      .stagingBucket
  );
  assert.throws(
    () => spacesDestination(partial),
    /destination\.providerBinding\.stagingBucket is missing/u,
  );
});

test('the Spaces destination is the authorized providerBinding plus the caller-mapped key', () => {
  const previous = {
    id: process.env.CALLER_DO_SPACES_ACCESS_KEY_ID,
    secret: process.env.CALLER_DO_SPACES_SECRET_ACCESS_KEY,
  };
  process.env.CALLER_DO_SPACES_ACCESS_KEY_ID = 'limited-id';
  process.env.CALLER_DO_SPACES_SECRET_ACCESS_KEY = 'limited-secret';
  try {
    const destination = spacesDestination(intentFor('do-spaces'));
    assert.equal(destination.region, 'nyc3');
    assert.equal(destination.servedBucket, 'gala-served-disposable');
    assert.equal(destination.stagingBucket, 'gala-staging-disposable');
    assert.equal(destination.publicBaseUrl, 'https://example.test/');
    assert.equal(destination.accessKeyId, 'limited-id');
  } finally {
    process.env.CALLER_DO_SPACES_ACCESS_KEY_ID = previous.id;
    process.env.CALLER_DO_SPACES_SECRET_ACCESS_KEY = previous.secret;
  }
});

test('the kernel destination identity carries the providerBinding exactly as authorized', () => {
  const spaces = intentFor('do-spaces');
  assert.deepEqual(destinationIdentityFrom(spaces), spaces.destination);
  const local = intentFor('local-directory');
  assert.equal(destinationIdentityFrom(local).providerBinding, undefined);
});

test('the installed adapter must be the release the intent authorizes', () => {
  requireAdapterVersionAgreement(spaces.ADAPTER_VERSION, {
    adapterId: 'do-spaces',
    adapterVersion: spaces.ADAPTER_VERSION,
  });
  assert.throws(
    () =>
      requireAdapterVersionAgreement(spaces.ADAPTER_VERSION, {
        adapterId: 'do-spaces',
        adapterVersion: '9.9.9',
      }),
    /DEPLOY_ADAPTER_VERSION_MISMATCH: .*do-spaces@9\.9\.9 .*/u,
  );
});

test('a do-spaces intent through the fake: the deploy job’s own recomputation of the two closed records agrees with the issued capabilityDecisionDigest, and spacesDestination binds the caller-mapped key over the retained coordinates', async () => {
  const operationId = stableId();
  const repositoryId = '4242';
  const runId = '987654321';
  const runAttempt = 1;
  const { request, derived } = buildDeploymentIntentRequest(
    /** @type {any} */ (
      authorizationInput({
        adapterId: 'do-spaces',
        operationId,
        repositoryId,
        runId,
        runAttempt,
        destination: {
          baseUrl:
            'https://gala-newsletter-served.nyc3-static.digitaloceanspaces.com/',
        },
      })
    ),
  );
  const seed = seedWithDefaults({
    repository: 'gala-author/site',
    repositoryId,
    operationId,
    destination: {
      adapterId: 'do-spaces',
      spaces: {
        region: 'nyc3',
        servedBucket: 'gala-newsletter-served',
        stagingBucket: 'gala-newsletter-staging',
        basePath: '/',
      },
    },
  });
  const intent = /** @type {Record<string, any>} */ (
    renderIntent(request, seed, {
      intentId: stableId(),
      artifactId: derived.artifactId,
      attemptId: derived.attemptId,
      generationId: derived.proposedGenerationId,
      authorityId: stableId(),
      binding: { repositoryId, runId, runAttempt },
      ...(derived.spacesStagePrefix === undefined
        ? {}
        : { spacesStagePrefix: derived.spacesStagePrefix }),
    })
  );

  assert.deepEqual(intent.destination.providerBinding, {
    region: 'nyc3',
    servedBucket: 'gala-newsletter-served',
    stagingBucket: 'gala-newsletter-staging',
  });

  // The single shared recomputation `verify-spaces-configuration.mjs` and
  // `deploy.mjs` both call, from the intent's own retained members only.
  const spacesClosedRecords = await recomputeSpacesClosedRecords(intent);
  const decision = requireCapabilityDecisionAgreement(
    intent,
    { runId, runAttempt },
    spacesClosedRecords,
  );
  assert.equal(decision.decisionDigest, intent.capabilityDecisionDigest);
  assert.equal(
    decision.record.spacesWebsiteConfigurationDigest,
    spacesClosedRecords.spacesWebsiteConfigurationDigest,
  );
  assert.equal(
    decision.record.spacesControlPlaneBindingDigest,
    spacesClosedRecords.spacesControlPlaneBindingDigest,
  );

  // Without the recomputed records the do-spaces decision cannot be built
  // at all (fails closed by name rather than silently omitting the members).
  assert.throws(
    () => requireCapabilityDecisionAgreement(intent, { runId, runAttempt }),
    /CAPABILITY_DECISION_SPACES_DIGEST_MISSING/u,
  );

  // deploy.mjs's own destination binding over the same intent.
  const previous = {
    id: process.env.CALLER_DO_SPACES_ACCESS_KEY_ID,
    secret: process.env.CALLER_DO_SPACES_SECRET_ACCESS_KEY,
  };
  process.env.CALLER_DO_SPACES_ACCESS_KEY_ID = 'limited-id';
  process.env.CALLER_DO_SPACES_SECRET_ACCESS_KEY = 'limited-secret';
  try {
    const destination = spacesDestination(intent);
    assert.equal(destination.region, 'nyc3');
    assert.equal(destination.servedBucket, 'gala-newsletter-served');
    assert.equal(destination.stagingBucket, 'gala-newsletter-staging');
  } finally {
    process.env.CALLER_DO_SPACES_ACCESS_KEY_ID = previous.id;
    process.env.CALLER_DO_SPACES_SECRET_ACCESS_KEY = previous.secret;
  }
});
