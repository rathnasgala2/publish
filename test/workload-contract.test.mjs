/**
 * Drift gate: `scripts/workflow/workload-contract.mjs` must state exactly
 * what the pinned `@rathnasgala2/schemas` OpenAPI document states for the two
 * workload request bodies.
 *
 * The validator in `scripts/workflow` is hand-written (see that module's own
 * header for why it is not an ajv run over the document). That is only
 * defensible while it is *proved* to agree with the contract, so this test
 * reads the pinned document itself and compares, by exact set and value
 * equality, every declared member set, every required member set and every
 * numeric bound the validator enforces. A contract change that this
 * repository has not caught up with fails here rather than at a live
 * exchange.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import * as contract from '../scripts/workflow/workload-contract.mjs';

const schemasRoot = path.dirname(
  fileURLToPath(
    await import.meta.resolve('@rathnasgala2/schemas/package.json'),
  ),
);
const document = YAML.parse(
  await readFile(path.join(schemasRoot, 'openapi/openapi.yaml'), 'utf8'),
);
const components = document.components.schemas;

/**
 * Resolve every `$ref` in one subtree against the document's components.
 *
 * @param {unknown} node the subtree
 * @param {number} depth the current resolution depth
 * @returns {any} the resolved subtree
 */
function resolve(node, depth = 0) {
  if (node === null || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((entry) => resolve(entry, depth));
  }
  const record = /** @type {Record<string, unknown>} */ (node);
  if (typeof record.$ref === 'string') {
    if (depth > 12) {
      return {};
    }
    const name = /** @type {string} */ (record.$ref).split('/').pop() ?? '';
    return resolve(components[name], depth + 1);
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = resolve(value, depth);
  }
  return out;
}

const exchangeRequest = resolve(
  components.PostWorkloadsGithubReceiptExchangesRequest,
);
const intentArm = exchangeRequest.oneOf[0];
const receiptArm = exchangeRequest.oneOf[1];
const submission = resolve(components.PostWorkloadsDeploymentReceiptsRequest);

/**
 * @param {readonly string[]} left one member list
 * @param {readonly string[]} right the other
 * @returns {void}
 */
function assertSameMembers(left, right) {
  assert.deepEqual([...left].sort(), [...right].sort());
}

test('the exchange union is exactly the two purposes this repository sends', () => {
  assert.equal(exchangeRequest.oneOf.length, 2);
  assert.equal(
    exchangeRequest.discriminator.propertyName,
    'purpose',
    'the contract discriminates on purpose',
  );
  assert.equal(
    intentArm.properties.purpose['x-gala-const'],
    'deployment-intent',
  );
  assert.equal(
    receiptArm.properties.purpose['x-gala-const'],
    'deployment-receipt',
  );
});

test('the deployment-intent arm declares and requires exactly what the builder sends', () => {
  assert.equal(intentArm.additionalProperties, false);
  assertSameMembers(Object.keys(intentArm.properties), contract.INTENT_FIELDS);
  assertSameMembers(intentArm.required, contract.INTENT_REQUIRED);
  assert.equal(
    intentArm.properties.pagesBuildVersion.pattern,
    contract.PAGES_BUILD_VERSION_PATTERN.source,
  );
  assert.equal(intentArm.properties.spacesStagePrefix.minLength, 1);
  assert.equal(intentArm.properties.spacesStagePrefix.maxLength, 512);
  assert.equal(intentArm.properties.requestedArtifactRetentionDays.minimum, 1);
  assert.equal(intentArm.properties.requestedArtifactRetentionDays.maximum, 7);
});

test('the three conditional adapter branches admit each member only for its own adapter', () => {
  const branches = intentArm.allOf.map(
    (/** @type {any} */ branch) =>
      branch.if.properties.adapter.properties.adapterId['x-gala-const'],
  );
  assert.deepEqual(branches, ['github-pages', 'do-spaces', 'local-directory']);
  // 2.8.0 (LOCAL-57): neither member is required for its own adapter any
  // more, and each stays forbidden for the other two.
  assert.deepEqual(intentArm.allOf[0].then, {
    not: { required: ['spacesStagePrefix'] },
  });
  assert.deepEqual(intentArm.allOf[1].then, {
    not: { required: ['pagesBuildVersion'] },
  });
  assert.deepEqual(intentArm.allOf[2].then.not.anyOf, [
    { required: ['pagesBuildVersion'] },
    { required: ['spacesStagePrefix'] },
  ]);
  for (const member of [
    'pagesBuildVersion',
    'spacesStagePrefix',
    'capabilityDecisionDigest',
  ]) {
    assert.ok(!intentArm.required.includes(member), `${member} is optional`);
    assert.ok(!contract.INTENT_REQUIRED.includes(member));
  }
});

test('the request-side destination (2.9.0) requires the lock-derived adapter and canonical base, keys providerBinding and environment on the adapter, and admits nothing for do-spaces', () => {
  const destination = intentArm.properties.destination;
  assert.equal(destination.additionalProperties, false);
  assertSameMembers(
    Object.keys(destination.properties),
    contract.DESTINATION_FIELDS,
  );
  assertSameMembers(
    destination.required,
    contract.REQUEST_DESTINATION_REQUIRED,
  );
  assertSameMembers(
    destination.properties.adapterId.enum,
    contract.ADMITTED_ADAPTER_IDS,
  );
  assertSameMembers(
    destination.properties.environment.enum,
    Object.values(contract.ADAPTER_ENVIRONMENTS),
  );
  const binding = destination.properties.providerBinding;
  assert.equal(binding.additionalProperties, false);
  assert.equal(binding.required, undefined);
  assertSameMembers(
    Object.keys(binding.properties),
    contract.REQUEST_PROVIDER_BINDING_MEMBERS,
  );
  assert.equal(
    binding.properties.owner.pattern,
    contract.GITHUB_OWNER_PATTERN.source,
  );
  assert.equal(
    binding.properties.repository.pattern,
    contract.GITHUB_REPOSITORY_NAME_PATTERN.source,
  );
  for (const digest of ['rootIdentityDigest', 'mutationSurfaceDigest']) {
    assert.equal(
      binding.properties[digest].pattern,
      contract.DIGEST_PATTERN.source,
    );
  }
  const branches = destination.allOf.map(
    (/** @type {any} */ branch) =>
      branch.if.properties.adapterId['x-gala-const'],
  );
  assert.deepEqual(branches, ['github-pages', 'do-spaces', 'local-directory']);
  for (const [index, adapterId] of branches.entries()) {
    assert.equal(
      destination.allOf[index].then.properties.environment['x-gala-const'],
      contract.ADAPTER_ENVIRONMENTS[
        /** @type {keyof typeof contract.ADAPTER_ENVIRONMENTS} */ (adapterId)
      ],
      `${adapterId}: environment is the adapter constant`,
    );
  }
  assertSameMembers(
    destination.allOf[0].then.properties.providerBinding.required,
    contract.REQUEST_PROVIDER_BINDING_FIELDS['github-pages'],
  );
  assertSameMembers(
    Object.keys(
      destination.allOf[0].then.properties.providerBinding.properties,
    ),
    contract.REQUEST_PROVIDER_BINDING_FIELDS['local-directory'],
  );
  assert.deepEqual(destination.allOf[1].then.not, {
    required: ['providerBinding'],
  });
  assert.deepEqual(contract.REQUEST_PROVIDER_BINDING_FIELDS['do-spaces'], []);
  assertSameMembers(
    destination.allOf[2].then.properties.providerBinding.required,
    contract.REQUEST_PROVIDER_BINDING_FIELDS['local-directory'],
  );
  assertSameMembers(
    Object.keys(
      destination.allOf[2].then.properties.providerBinding.properties,
    ),
    contract.REQUEST_PROVIDER_BINDING_FIELDS['github-pages'],
  );
});

test('the retained destinationIdentity is unchanged apart from the closed environment vocabulary, and its providerBinding is the per-adapter coordinate set every job binds to', async () => {
  const root = JSON.parse(
    await readFile(
      path.join(schemasRoot, 'schemas/deployment-intent.schema.json'),
      'utf8',
    ),
  );
  const retained = root.$defs.destinationIdentity;
  assert.equal(retained.additionalProperties, false);
  assertSameMembers(
    Object.keys(retained.properties),
    contract.DESTINATION_FIELDS,
  );
  assertSameMembers(retained.required, contract.DESTINATION_REQUIRED);
  assertSameMembers(
    retained.properties.environment.enum,
    Object.values(contract.ADAPTER_ENVIRONMENTS),
  );
  const constants = retained.allOf
    .filter((/** @type {any} */ branch) => branch.then.properties.environment)
    .map((/** @type {any} */ branch) => [
      branch.if.properties.adapterId.const,
      branch.then.properties.environment.const,
    ]);
  assert.deepEqual(
    Object.fromEntries(constants),
    contract.ADAPTER_ENVIRONMENTS,
  );
  const coordinates = root.$defs.destinationProviderCoordinates;
  assert.equal(coordinates.additionalProperties, false);
  assertSameMembers(Object.keys(coordinates.properties), [
    ...contract.PROVIDER_BINDING_FIELDS['github-pages'],
    ...contract.PROVIDER_BINDING_FIELDS['do-spaces'],
  ]);
  assert.deepEqual(contract.PROVIDER_BINDING_FIELDS['local-directory'], []);
  // The retained coordinates reference the root's own `$defs`; resolve one
  // level so the patterns compare.
  const patternOf = (/** @type {any} */ property) =>
    property.pattern ??
    root.$defs[String(property.$ref).split('/').pop() ?? ''].pattern;
  assert.equal(
    patternOf(coordinates.properties.region),
    contract.SPACES_REGION_PATTERN.source,
  );
  for (const bucket of ['servedBucket', 'stagingBucket']) {
    assert.equal(
      patternOf(coordinates.properties[bucket]),
      contract.SPACES_BUCKET_PATTERN.source,
    );
  }
  assert.equal(
    coordinates.properties.owner.pattern,
    contract.GITHUB_OWNER_PATTERN.source,
  );
});

test('the deployment-receipt arm is the five-member challenge exchange', () => {
  assert.equal(receiptArm.additionalProperties, false);
  assertSameMembers(
    Object.keys(receiptArm.properties),
    contract.RECEIPT_FIELDS,
  );
  assertSameMembers(receiptArm.required, contract.RECEIPT_FIELDS);
});

test('the verificationSubmission union is the named fit/unfit pair discriminated on state', () => {
  const raw =
    components.ReceiptExchangeDeploymentIntentRequest.properties
      .verificationSubmission;
  assert.deepEqual(raw.oneOf, [
    { $ref: '#/components/schemas/VerificationSubmissionFit' },
    { $ref: '#/components/schemas/VerificationSubmissionUnfit' },
  ]);
  assert.deepEqual(raw.discriminator, {
    propertyName: 'state',
    mapping: {
      fit: '#/components/schemas/VerificationSubmissionFit',
      unfit: '#/components/schemas/VerificationSubmissionUnfit',
    },
  });
  const union = intentArm.properties.verificationSubmission.oneOf;
  assert.equal(union.length, 2);
  const [fit, unfit] = union;
  assert.equal(fit.additionalProperties, false);
  assert.equal(fit.properties.state['x-gala-const'], 'fit');
  assert.equal(
    fit.properties.verificationEntries.maxItems,
    contract.MAXIMUM_VERIFICATION_ENTRIES,
  );
  assert.equal(fit.properties.verificationEntries.minItems, 1);
  assertSameMembers(
    fit.properties.verificationEntries.items.required,
    contract.VERIFICATION_ENTRY_FIELDS,
  );
  assert.equal(unfit.additionalProperties, false);
  assert.equal(unfit.properties.state['x-gala-const'], 'unfit');
  assertSameMembers(
    unfit.properties.reason.enum,
    contract.ADMITTED_UNFIT_REASONS,
  );
  assert.equal(unfit.properties.requiredVerificationEntryCount.maximum, 200000);
});

test('the request-side rebuildRecord (2.9.0) declares the retained record’s members with exactly the four Gala-derived ones optional, and the retained record requires all of them', async () => {
  const record = intentArm.properties.rebuildRecord;
  assertSameMembers(
    Object.keys(record.properties),
    contract.REBUILD_RECORD_FIELDS,
  );
  assertSameMembers(record.required, contract.REBUILD_RECORD_REQUIRED);
  assert.equal(contract.REBUILD_RECORD_API_DERIVED.length, 4);
  const retained = JSON.parse(
    await readFile(
      path.join(schemasRoot, 'schemas/deployment-intent.schema.json'),
      'utf8',
    ),
  ).$defs.reproducibleBuildRecord;
  assertSameMembers(retained.required, contract.REBUILD_RECORD_FIELDS);
  assertSameMembers(
    Object.keys(retained.properties),
    contract.REBUILD_RECORD_FIELDS,
  );
  assert.equal(
    record.properties.builder.allOf[1].properties.package['x-gala-const'],
    contract.PUBLISHER_PACKAGE,
  );
  assert.equal(
    record.properties.schemas.allOf[1].properties.package['x-gala-const'],
    '@rathnasgala2/schemas',
  );
  assert.equal(
    record.properties.template.allOf[1].properties.package['x-gala-const'],
    '@rathnasgala2/template',
  );
  assertSameMembers(
    record.properties.theme.allOf[1].properties.package.enum,
    contract.ADMITTED_THEME_PACKAGES,
  );
});

test('the receipt submission declares 21 members and requires exactly 19', () => {
  assert.equal(submission.additionalProperties, false);
  assertSameMembers(
    Object.keys(submission.properties),
    contract.SUBMISSION_FIELDS,
  );
  assertSameMembers(submission.required, contract.SUBMISSION_REQUIRED);
  assert.equal(contract.SUBMISSION_FIELDS.length, 21);
  assert.equal(contract.SUBMISSION_REQUIRED.length, 19);
  assert.equal(
    submission.properties.publisherPackage['x-gala-const'],
    contract.PUBLISHER_PACKAGE,
  );
  assert.equal(submission.properties.runAttempt.minimum, 1);
  assert.equal(submission.properties.runAttempt.maximum, 51);
  assert.equal(
    submission.properties.observedRoutes.maxItems,
    contract.MAXIMUM_OBSERVED_ROUTES,
  );
  assertSameMembers(
    Object.keys(submission.properties.observedRoutes.items.properties),
    contract.OBSERVED_ROUTE_FIELDS,
  );
  assertSameMembers(
    submission.properties.observedRoutes.items.required,
    contract.OBSERVED_ROUTE_REQUIRED,
  );
});

test('the kernel journal streams carry the contract bounds and vocabularies', () => {
  const journal = submission.properties.kernelJournal;
  assertSameMembers(Object.keys(journal.properties), [
    'attempts',
    'observations',
  ]);
  for (const stream of ['attempts', 'observations']) {
    assert.equal(journal.properties[stream].minItems, 1);
    assert.equal(
      journal.properties[stream].maxItems,
      contract.MAXIMUM_JOURNAL_ENTRIES_PER_STREAM,
    );
  }
  const attempt = journal.properties.attempts.items;
  assertSameMembers(Object.keys(attempt.properties), contract.ATTEMPT_FIELDS);
  assertSameMembers(attempt.required, contract.ATTEMPT_REQUIRED);
  assertSameMembers(attempt.properties.stage.enum, contract.ADMITTED_STAGES);
  assertSameMembers(
    attempt.properties.outcome.enum,
    contract.ADMITTED_ATTEMPT_OUTCOMES,
  );
  assertSameMembers(
    attempt.properties.destinationChanged.enum,
    contract.ADMITTED_DESTINATION_CHANGED,
  );
  assertSameMembers(
    attempt.properties.failureCode.enum,
    contract.ADMITTED_FAILURE_CODES,
  );
  assert.equal(attempt.properties.kernelSequence.maximum, 100);

  const observation = journal.properties.observations.items;
  assertSameMembers(
    Object.keys(observation.properties),
    contract.OBSERVATION_FIELDS,
  );
  assertSameMembers(observation.required, contract.OBSERVATION_REQUIRED);
  assertSameMembers(
    observation.properties.observationClass.enum,
    contract.ADMITTED_OBSERVATION_CLASSES,
  );
  assertSameMembers(
    observation.properties.outcome.enum,
    contract.ADMITTED_OBSERVATION_OUTCOMES,
  );
});

test('the exchange response is three flat members keyed on an optional kind', () => {
  const union = components.PostWorkloadsGithubReceiptExchangesResponse;
  assert.deepEqual(union.oneOf, [
    { $ref: '#/components/schemas/ReceiptExchangeDeploymentIntentResponse' },
    { $ref: '#/components/schemas/ReceiptExchangeCapabilityIssuedResponse' },
    {
      $ref: '#/components/schemas/ReceiptExchangeSubmissionRecordedResponse',
    },
  ]);
  assert.equal(union.discriminator.propertyName, 'kind');
  assert.deepEqual(union.discriminator.mapping, {
    'deployment-intent':
      '#/components/schemas/ReceiptExchangeDeploymentIntentResponse',
    'deployment-receipt-capability-issued':
      '#/components/schemas/ReceiptExchangeCapabilityIssuedResponse',
    'deployment-receipt-submission-recorded':
      '#/components/schemas/ReceiptExchangeSubmissionRecordedResponse',
  });
  assert.equal(
    components.ReceiptExchangeDeploymentReceiptResponse,
    undefined,
    'the intermediate nested-state schema is gone',
  );
  for (const [kind, reference] of Object.entries(union.discriminator.mapping)) {
    const arm = resolve(components[String(reference).split('/').pop() ?? '']);
    assert.equal(arm.additionalProperties, false);
    assert.equal(arm.properties.kind['x-gala-const'], kind);
    assert.ok(
      !arm.required.includes('kind'),
      `${kind}: kind is optional so a 2.7.x body still validates`,
    );
    assert.ok(arm.required.includes('purpose'));
  }
  const issued = resolve(components.ReceiptExchangeCapabilityIssuedResponse);
  assert.equal(issued.properties.purpose['x-gala-const'], 'deployment-receipt');
  assert.equal(issued.properties.state['x-gala-const'], 'capability-issued');
  assert.equal(
    issued.properties.reportingCapability.pattern,
    contract.REPORTING_CAPABILITY_PATTERN.source,
  );
  assert.equal(issued.properties.capabilityGeneration.minimum, 1);
  assert.equal(issued.properties.capabilityGeneration.maximum, 20);

  const recorded = resolve(
    components.ReceiptExchangeSubmissionRecordedResponse,
  );
  assert.equal(
    recorded.properties.state['x-gala-const'],
    'submission-recorded',
  );
  assert.deepEqual([...recorded.required].sort(), [
    'operationId',
    'purpose',
    'state',
    'statusUrl',
  ]);

  const intent = resolve(components.ReceiptExchangeDeploymentIntentResponse);
  assert.equal(intent.properties.purpose['x-gala-const'], 'deployment-intent');
  assert.deepEqual([...intent.required].sort(), [
    'deploymentIntent',
    'purpose',
    'reportChallengeExpiresAt',
    'reportChallengeId',
  ]);
});

test('the activation fence is one string pattern carrying the expect-nothing-served sentinel', async () => {
  const { EXPECT_NOTHING_SERVED } =
    await import('@rathnasgala2/adapter-protocol');
  for (const contractName of ['deployment-intent', 'deployment-receipt']) {
    const root = JSON.parse(
      await readFile(
        path.join(schemasRoot, `schemas/${contractName}.schema.json`),
        'utf8',
      ),
    );
    const fence = root.$defs.generationFence;
    assert.equal(fence.type, 'string');
    assert.equal(fence.oneOf, undefined);
    const stableId = String(root.$defs.stableId.pattern).slice(1, -1);
    assert.equal(fence.pattern, `^(?:${EXPECT_NOTHING_SERVED}|${stableId})$`);
    assert.deepEqual(
      root.$defs.destinationMutationAuthority.properties.expectedGenerationId,
      { $ref: '#/$defs/generationFence' },
    );
  }
});
