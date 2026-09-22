/**
 * The one place a managed job reads its authorization from.
 *
 * The deployment-intent exchange response *is* the Gala-side authorization:
 * its retained `deployment-intent:2.0.0` document names the adapter, the
 * destination (identity plus, since 2.8.0, the provider coordinates), the
 * activation fence, the operation/attempt/generation identities and the
 * public marker. Every later job — the Spaces configuration verifier, the
 * selected deploy job and the report — binds to that document and to nothing
 * else: never to a workflow input, never to an environment variable naming a
 * destination, never to a value a caller could have chosen.
 *
 * What a job *does* hold besides the intent is its own runner identity
 * (`GITHUB_REF`, `GITHUB_REPOSITORY_ID`, `GITHUB_RUN_ID`,
 * `GITHUB_RUN_ATTEMPT`), and the intent must agree with it. DEC-097 (lines
 * 3258-3260, 6898-6900) makes the intent's `subject` Gala's stable workload
 * URN `urn:gala:workload:github:<repositoryId>:<runId>:<runAttempt>`,
 * derived from the immutable claims Gala verified — "not a copy of GitHub's
 * rename-sensitive `sub` string" — and the intent's required
 * `workloadBindingDigest` commits the retained `verifiedWorkloadBinding`,
 * whose closed members include the `ref`, `repository`, `repositoryId`,
 * `runId` and `runAttempt` (DEC-097 lines 2451-2476). So a job binds to the
 * URN's three ids against its own runner identity, to the operation the
 * publish ref names, and records the binding digest as the commitment to
 * the ref; it never compares a repository *name*, which can be renamed
 * under a running operation. An intent still carrying the OIDC
 * `repo:<owner>/<repo>:ref:<ref>` form (an API predating
 * API-INTENT-DERIVATION-1) is refused by its own code — there is no
 * compatibility branch, because the two forms bind different things.
 *
 * Every refusal here is a closed, named code:
 *
 * - `DEPLOY_INTENT_MALFORMED` — a required member is absent or off-shape;
 * - `DEPLOY_INTENT_INCONSISTENT` — two members of the same document disagree
 *   (adapter vs destination, marker vs intent, authority vs intent);
 * - `DEPLOY_INTENT_IDENTITY_MISMATCH` — the intent is bound to a workload
 *   or operation other than the runner's;
 * - `DEPLOY_INTENT_SUBJECT_LEGACY` — the intent's `subject` is the OIDC
 *   `repo:…:ref:…` string, not the DEC-097 workload URN;
 * - `DEPLOY_INTENT_EXPIRED` — the intent's own `expiresAt` or
 *   `operationDeadline` has passed;
 * - `DEPLOY_DESTINATION_BINDING_INVALID` — the managed adapter's provider
 *   coordinates are absent or off-shape (a job never invents them; until
 *   API-CONSUME-2.8 retains `providerBinding`, a 2.8.0 server that omits it
 *   fails closed here by name).
 *
 * @module
 */

import {
  AdapterProtocolError,
  EXPECT_NOTHING_SERVED,
  requireGenerationFence,
} from '@rathnasgala2/adapter-protocol';

import {
  ADMITTED_ADAPTER_IDS,
  DIGEST_PATTERN,
  INSTANT_PATTERN,
  PROVIDER_BINDING_FIELDS,
  SEMVER_PATTERN,
  STABLE_ID_PATTERN,
  WorkloadContractError,
  checkDestination,
} from './workload-contract.mjs';
import {
  canonicalJson,
  operationIdFromPublishRef,
} from './workload-identity.mjs';

/** The kernel audience every issued intent is addressed to. */
export const KERNEL_AUDIENCE = 'urn:gala:deployment-kernel:v2';

/** The marker schema the intent's `marker` must declare. */
export const MARKER_SCHEMA_ID =
  'urn:gala:schema:public-generation-marker:2.0.0';

/** The destination mutation authority profile the intent must carry. */
export const AUTHORITY_PROFILE = 'gala-destination-mutation-authority-v2';

/**
 * DEC-097's workload URN: canonical positive decimal repository id and run
 * id, and a run attempt in `1..51`.
 */
export const WORKLOAD_SUBJECT_PATTERN =
  /^urn:gala:workload:github:([1-9][0-9]{0,19}):([1-9][0-9]{0,19}):([1-9]|[1-4][0-9]|5[01])$/u;

/** The OIDC subject form a pre-API-INTENT-DERIVATION-1 server rendered. */
const LEGACY_SUBJECT_PATTERN = /^repo:[^:]+:ref:.+$/u;

/** A refusal with a closed code and a pointer or a plain reason. */
export class AuthorizedIntentError extends Error {
  /**
   * @param {'DEPLOY_INTENT_MALFORMED' | 'DEPLOY_INTENT_INCONSISTENT' | 'DEPLOY_INTENT_IDENTITY_MISMATCH' | 'DEPLOY_INTENT_SUBJECT_LEGACY' | 'DEPLOY_INTENT_EXPIRED' | 'DEPLOY_DESTINATION_BINDING_INVALID' | 'DEPLOY_RUNNER_IDENTITY_MISSING'} code
   *   the closed refusal code
   * @param {string} detail what disagreed, never quoting a credential
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'AuthorizedIntentError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * @param {Record<string, unknown>} record the record
 * @param {string} name the member
 * @param {RegExp} pattern the exact shape
 * @param {string} pointer the record's pointer
 * @returns {string} the matched member
 */
function shaped(record, name, pattern, pointer) {
  const value = record[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_MALFORMED',
      `${pointer}/${name} is absent or not the contract's shape`,
    );
  }
  return value;
}

/**
 * @param {unknown} value the candidate
 * @param {string} pointer its pointer
 * @returns {Record<string, unknown>} the object
 */
function object(value, pointer) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_MALFORMED',
      `${pointer} is absent or not an object`,
    );
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {boolean} agrees whether the two members agree
 * @param {string} detail what disagreed
 * @returns {void}
 */
function consistent(agrees, detail) {
  if (!agrees) {
    throw new AuthorizedIntentError('DEPLOY_INTENT_INCONSISTENT', detail);
  }
}

/**
 * Read one member of the runner's own bound identity.
 *
 * @param {Readonly<Record<string, string | undefined>>} runner the runner
 *   environment
 * @param {string} name the variable
 * @returns {string} the non-empty value
 */
export function requireRunner(runner, name) {
  const value = runner[name];
  if (value === undefined || value === '') {
    throw new AuthorizedIntentError(
      'DEPLOY_RUNNER_IDENTITY_MISSING',
      `${name} is empty or unset`,
    );
  }
  return value;
}

/**
 * The authorized intent's `destination.providerBinding` for one managed
 * adapter (schema 2.8.0, LOCAL-55 (2)): the provider coordinates the deploy
 * job targets. `local-directory` has none and must carry none.
 *
 * @param {Record<string, unknown>} intent the deployment intent
 * @returns {Readonly<Record<string, string>> | null} the closed coordinates,
 *   or `null` for `local-directory`
 */
export function providerBindingOf(intent) {
  const destination = object(intent.destination, '/destination');
  const adapterId = String(destination.adapterId);
  const members =
    PROVIDER_BINDING_FIELDS[
      /** @type {keyof typeof PROVIDER_BINDING_FIELDS} */ (adapterId)
    ] ?? [];
  const binding = destination.providerBinding;
  if (members.length === 0) {
    if (binding !== undefined) {
      throw new AuthorizedIntentError(
        'DEPLOY_DESTINATION_BINDING_INVALID',
        `${adapterId} admits no destination.providerBinding`,
      );
    }
    return null;
  }
  if (typeof binding !== 'object' || binding === null) {
    throw new AuthorizedIntentError(
      'DEPLOY_DESTINATION_BINDING_INVALID',
      "the authorized intent's destination.providerBinding is absent; a managed deploy job never invents its provider coordinates (API-CONSUME-2.8 retains it; a server that omits it cannot authorize a managed deploy)",
    );
  }
  /** @type {Record<string, string>} */
  const bound = {};
  for (const member of members) {
    const value = /** @type {Record<string, unknown>} */ (binding)[member];
    if (typeof value !== 'string' || value === '') {
      throw new AuthorizedIntentError(
        'DEPLOY_DESTINATION_BINDING_INVALID',
        `the authorized intent's destination.providerBinding.${member} is missing or not a non-empty string`,
      );
    }
    bound[member] = value;
  }
  return Object.freeze(bound);
}

/**
 * The provider-neutral destination identity the kernel's duty 4 compares,
 * taken byte for byte from the authorized intent.
 *
 * @param {Record<string, unknown>} intent the deployment intent
 * @returns {Record<string, unknown>} the destination identity
 */
export function destinationIdentityFrom(intent) {
  const destination = object(intent.destination, '/destination');
  return {
    environment: shaped(destination, 'environment', /^.+$/u, '/destination'),
    adapterId: shaped(destination, 'adapterId', /^.+$/u, '/destination'),
    adapterVersion: shaped(
      destination,
      'adapterVersion',
      SEMVER_PATTERN,
      '/destination',
    ),
    targetDigest: shaped(
      destination,
      'targetDigest',
      DIGEST_PATTERN,
      '/destination',
    ),
    baseUrl: shaped(destination, 'baseUrl', /^https:\/\//u, '/destination'),
    ...(destination.providerBinding === undefined
      ? {}
      : { providerBinding: destination.providerBinding }),
  };
}

/**
 * Refuse an intent bound to a workload or operation other than the
 * runner's own. Gala renders `subject` as the DEC-097 workload URN from the
 * immutable claims it verified — the numeric repository id, run id and run
 * attempt — and binds the ref through `workloadBindingDigest`; the runner
 * knows all three ids and the exact publish ref from its own environment.
 *
 * @param {Record<string, unknown>} intent the deployment intent
 * @param {Readonly<Record<string, string | undefined>>} runner the runner
 *   environment (`GITHUB_REF`, `GITHUB_REPOSITORY_ID`, `GITHUB_RUN_ID`,
 *   `GITHUB_RUN_ATTEMPT`)
 * @returns {{
 *   ref: string,
 *   operationId: string,
 *   repositoryId: string,
 *   runId: string,
 *   runAttempt: number,
 *   subject: string,
 *   workloadBindingDigest: string
 * }} the agreed identity
 */
export function assertIntentBoundToRunner(intent, runner) {
  const ref = requireRunner(runner, 'GITHUB_REF');
  /** @type {string} */
  let operationId;
  try {
    operationId = operationIdFromPublishRef(ref);
  } catch {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_IDENTITY_MISMATCH',
      'this job is not running on an exact refs/heads/gala/publish/<operationId> ref',
    );
  }
  if (intent.operationId !== operationId) {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_IDENTITY_MISMATCH',
      'the authorized intent names an operation other than the one this publish ref names',
    );
  }
  const subject = String(intent.subject ?? '');
  if (LEGACY_SUBJECT_PATTERN.test(subject)) {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_SUBJECT_LEGACY',
      'the authorized intent’s subject is the OIDC repo:<owner>/<repository>:ref:<ref> string, not the DEC-097 workload URN urn:gala:workload:github:<repositoryId>:<runId>:<runAttempt>; the API must render the URN (API-INTENT-DERIVATION-1)',
    );
  }
  const match = WORKLOAD_SUBJECT_PATTERN.exec(subject);
  if (match === null) {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_MALFORMED',
      '/subject is not the DEC-097 workload URN',
    );
  }
  const workloadBindingDigest = shaped(
    intent,
    'workloadBindingDigest',
    DIGEST_PATTERN,
    '',
  );
  const repositoryId = requireRunner(runner, 'GITHUB_REPOSITORY_ID');
  const runId = requireRunner(runner, 'GITHUB_RUN_ID');
  const runAttempt = requireRunner(runner, 'GITHUB_RUN_ATTEMPT');
  if (
    match[1] !== repositoryId ||
    match[2] !== runId ||
    match[3] !== String(Number.parseInt(runAttempt, 10))
  ) {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_IDENTITY_MISMATCH',
      'the authorized intent is bound to a repository, run or attempt other than the one this job runs in',
    );
  }
  return {
    ref,
    operationId,
    repositoryId,
    runId,
    runAttempt: Number.parseInt(runAttempt, 10),
    subject,
    workloadBindingDigest,
  };
}

/**
 * Bind one deployment-authorization carrier to a job.
 *
 * @param {{
 *   authorization: Record<string, unknown>,
 *   runner: Readonly<Record<string, string | undefined>>,
 *   now?: () => Date
 * }} input the carrier the authorize job wrote, the runner's environment
 *   and the clock
 * @returns {{
 *   intent: Record<string, unknown>,
 *   responseKind: string | null,
 *   adapterId: string,
 *   adapterVersion: string,
 *   adapterDigest: string,
 *   destination: Record<string, unknown>,
 *   providerBinding: Readonly<Record<string, string>> | null,
 *   operationId: string,
 *   attemptId: string,
 *   proposedGenerationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   idempotencyKey: string,
 *   expectedGenerationId: string,
 *   intentDigest: string,
 *   marker: Record<string, unknown>,
 *   journal: Record<string, unknown>
 * }} the bound authorization and the credential-free record of what was used
 */
export function bindAuthorizedIntent(input) {
  const now = input.now ?? (() => new Date());
  const intent = object(
    input.authorization.deploymentIntent,
    '/deploymentIntent',
  );
  const responseKind =
    typeof input.authorization.responseKind === 'string'
      ? input.authorization.responseKind
      : null;

  const operationId = shaped(intent, 'operationId', STABLE_ID_PATTERN, '');
  const attemptId = shaped(intent, 'attemptId', STABLE_ID_PATTERN, '');
  const proposedGenerationId = shaped(
    intent,
    'proposedGenerationId',
    STABLE_ID_PATTERN,
    '',
  );
  const artifactId = shaped(intent, 'artifactId', STABLE_ID_PATTERN, '');
  const idempotencyKey = shaped(
    intent,
    'idempotencyKey',
    STABLE_ID_PATTERN,
    '',
  );
  const artifactDigest = shaped(intent, 'artifactDigest', DIGEST_PATTERN, '');
  shaped(intent, 'manifestDigest', DIGEST_PATTERN, '');
  const intentDigest = shaped(intent, 'intentDigest', DIGEST_PATTERN, '');
  const expiresAt = shaped(intent, 'expiresAt', INSTANT_PATTERN, '');
  const operationDeadline = shaped(
    intent,
    'operationDeadline',
    INSTANT_PATTERN,
    '',
  );
  if (intent.audience !== KERNEL_AUDIENCE || intent.capability !== 'deploy') {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_MALFORMED',
      `the intent is not a ${KERNEL_AUDIENCE} deploy capability`,
    );
  }

  // --- adapter and destination -------------------------------------------
  const adapter = object(intent.adapter, '/adapter');
  const adapterId = shaped(adapter, 'adapterId', /^.+$/u, '/adapter');
  if (!ADMITTED_ADAPTER_IDS.includes(adapterId)) {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_MALFORMED',
      '/adapter/adapterId is outside the closed adapter vocabulary',
    );
  }
  const adapterVersion = shaped(
    adapter,
    'adapterVersion',
    SEMVER_PATTERN,
    '/adapter',
  );
  const adapterDigest = shaped(
    adapter,
    'adapterDigest',
    DIGEST_PATTERN,
    '/adapter',
  );
  try {
    checkDestination(intent.destination, '/destination');
  } catch (failure) {
    if (failure instanceof WorkloadContractError) {
      throw new AuthorizedIntentError(
        'DEPLOY_INTENT_MALFORMED',
        `${failure.pointer} is not the contract's destinationIdentity`,
      );
    }
    throw failure;
  }
  const destination = destinationIdentityFrom(intent);
  consistent(
    destination.adapterId === adapterId &&
      destination.adapterVersion === adapterVersion,
    'adapter and destination name different adapter identities',
  );
  const providerBinding = providerBindingOf(intent);

  // --- marker --------------------------------------------------------------
  const marker = object(intent.marker, '/marker');
  consistent(
    marker.schemaId === MARKER_SCHEMA_ID &&
      marker.artifactId === artifactId &&
      marker.artifactDigest === artifactDigest &&
      marker.generationId === proposedGenerationId,
    'the public marker does not name the intent artifact and proposed generation',
  );
  if (input.authorization.marker !== undefined) {
    consistent(
      canonicalJson(input.authorization.marker) === canonicalJson(marker),
      'the carrier marker differs from the intent marker',
    );
  }

  // --- destination mutation authority ------------------------------------
  const authority = object(
    intent.destinationMutationAuthority,
    '/destinationMutationAuthority',
  );
  consistent(
    authority.profile === AUTHORITY_PROFILE &&
      authority.operationId === operationId &&
      authority.attemptId === attemptId &&
      authority.proposedGenerationId === proposedGenerationId,
    'the destination mutation authority names another operation, attempt or generation',
  );
  consistent(
    canonicalJson(authority.destination) === canonicalJson(intent.destination),
    'the destination mutation authority names another destination',
  );
  // The fence key is Gala's `GALA-DESTINATION-MUTATION-KEY-V2` digest over
  // the retained binding's key material (DEC-097 lines 3295-3317), a
  // different domain from `targetDigest` (lines 7289-7322); the job
  // records it and never recomputes it, because the material is Gala's.
  shaped(
    authority,
    'destinationMutationKeyDigest',
    DIGEST_PATTERN,
    '/destinationMutationAuthority',
  );
  if (authority.expectedGenerationId !== undefined) {
    consistent(
      authority.expectedGenerationId === intent.expectedGenerationId,
      'the authority and the intent carry different activation fences',
    );
  }

  // --- fence ---------------------------------------------------------------
  // DEC-097: `expectedGenerationId` is absent exactly for a first publish,
  // which adapter protocol 2.1.0 spells as the explicit sentinel. Nothing
  // observed at the destination selects the fence; the intent does.
  // Only an *absent* member is a first publish; `null` is invalid on the
  // wire and is refused below rather than read as the sentinel.
  const fenceValue =
    intent.expectedGenerationId === undefined
      ? EXPECT_NOTHING_SERVED
      : intent.expectedGenerationId;
  /** @type {string} */
  let expectedGenerationId;
  try {
    const fence = requireGenerationFence(fenceValue, adapterId);
    expectedGenerationId = fence.expectsNothingServed
      ? EXPECT_NOTHING_SERVED
      : String(fence.generationId);
  } catch (failure) {
    if (failure instanceof AdapterProtocolError) {
      throw new AuthorizedIntentError(
        'DEPLOY_INTENT_MALFORMED',
        '/expectedGenerationId is neither a generation identity nor the expect-nothing-served sentinel',
      );
    }
    throw failure;
  }

  // --- runner identity and time ------------------------------------------
  const workload = assertIntentBoundToRunner(intent, input.runner);
  const instant = now().getTime();
  if (
    Date.parse(expiresAt) <= instant ||
    Date.parse(operationDeadline) <= instant
  ) {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_EXPIRED',
      'the authorized intent has expired or its operation deadline has passed; a new exchange is required',
    );
  }

  return {
    intent,
    responseKind,
    adapterId,
    adapterVersion,
    adapterDigest,
    destination,
    providerBinding,
    operationId,
    attemptId,
    proposedGenerationId,
    artifactId,
    artifactDigest,
    idempotencyKey,
    expectedGenerationId,
    intentDigest,
    marker,
    // What the job used, and where each value came from: every member is
    // the intent's, and the journal says so rather than leaving a reader
    // to infer it from the code.
    journal: {
      source: 'deployment-intent',
      responseKind,
      intentDigest,
      operationId,
      attemptId,
      proposedGenerationId,
      artifactId,
      artifactDigest,
      expectedGenerationId,
      fenceSource:
        intent.expectedGenerationId === undefined
          ? 'intent-first-publish-sentinel'
          : 'intent',
      adapter: { adapterId, adapterVersion, adapterDigest },
      destination,
      authority: {
        authorityId: authority.authorityId,
        epoch: authority.epoch,
        mode: authority.mode,
        destinationMutationKeyDigest: authority.destinationMutationKeyDigest,
      },
      // The workload URN and the digest that commits the retained
      // verified binding (ref, repository, ids): what the run was bound to.
      subject: workload.subject,
      workloadBindingDigest: workload.workloadBindingDigest,
      expiresAt,
      operationDeadline,
    },
  };
}

/**
 * Refuse a kernel journal that was not produced under this intent: the
 * report path's analogue of the deploy binding. The deploy job writes the
 * operation, attempt, generation and adapter it ran under into the journal
 * head, so a journal carried in from another run cannot be reported against
 * this operation's challenge.
 *
 * @param {Record<string, unknown>} journal the kernel journal carrier
 * @param {Record<string, unknown>} intent the retained intent
 * @returns {void}
 */
export function assertJournalAgreesWithIntent(journal, intent) {
  const adapter = object(intent.adapter, '/adapter');
  const authorization =
    typeof journal.authorization === 'object' && journal.authorization !== null
      ? /** @type {Record<string, unknown>} */ (journal.authorization)
      : {};
  const disagreements = [
    ['operationId', journal.operationId, intent.operationId],
    ['attemptId', journal.attemptId, intent.attemptId],
    ['generationId', journal.generationId, intent.proposedGenerationId],
    ['adapterId', journal.adapterId, adapter.adapterId],
    ['adapterVersion', journal.adapterVersion, adapter.adapterVersion],
    [
      'authorization.intentDigest',
      authorization.intentDigest,
      intent.intentDigest,
    ],
  ].filter(([, recorded, expected]) => recorded !== expected);
  if (disagreements.length > 0) {
    throw new AuthorizedIntentError(
      'DEPLOY_INTENT_IDENTITY_MISMATCH',
      `the kernel journal was not produced under this intent (${disagreements
        .map(([name]) => name)
        .join(', ')} disagree)`,
    );
  }
}
