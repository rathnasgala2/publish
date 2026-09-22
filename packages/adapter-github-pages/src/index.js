/**
 * `@rathnasgala2/adapter-github-pages`: the managed GitHub Pages deployment
 * adapter (S4-T04; DEC-097 section 6.2 and section 7's `github-pages` row).
 *
 * What it does: builds one deterministic gzip/ustar Pages carrier from the
 * frozen artifact plus the reserved public generation marker, hands that
 * carrier to the caller-supplied Actions-artifact publisher, creates exactly
 * one Pages deployment through the raw REST API using a caller-supplied
 * installation token, polls the deployment API to a terminal status, and
 * verifies the result through credential-free public reads of the activated
 * origin.
 *
 * What it deliberately does not do, because DEC-097 forbids it: it never
 * invokes the opaque `actions/deploy-pages` action, never mutates a branch,
 * never assumes a source commit, never mints or refreshes a token, never
 * follows a provider-supplied `status_url`, and never claims complete
 * deployed inventory. Its declared `concurrency` is `none` and its declared
 * `rollback` is `reupload`, because that is what GitHub Pages actually
 * offers; see `README.md` for the full boundary list.
 *
 * @module
 */

import {
  fenceDisagrees,
  fenceFor,
  requireGenerationFence,
  sha256Hex,
} from '@rathnasgala2/adapter-protocol';

import {
  computeArtifactDigest,
  digestEntries,
  projectEntry,
} from './artifact-projection.js';
import { describeCapabilities as buildCapabilities } from './capability.js';
import {
  AUTHORITY_MODES,
  GENERATION_MARKER_PATH,
  MAXIMUM_PAGES_CARRIER_BYTES,
  NORMAL_MODE,
  RECOVERY_MODE,
} from './constants.js';
import {
  createDeployment,
  derivePagesBuildVersion,
  pollDeployment,
} from './deployment.js';
import { decodeCarrier, encodeCarrier } from './carrier.js';
import { buildValidatedMarker, parsePublicMarker } from './marker.js';
import { readPublic } from './public-read.js';
import { requireOidcExpectation } from './oidc.js';
import {
  resolvePriorAttempt,
  validateReconciliationRecovery,
} from './recovery.js';
import { GITHUB_API_ORIGIN, buildRequestTemplates } from './request-catalog.js';
import { bindIdentity, callProvider } from './rest.js';
import { destinationKey, stateFor } from './store.js';

export {
  EXPECT_NOTHING_SERVED,
  fenceFor,
  generateUuidV7,
} from '@rathnasgala2/adapter-protocol';
export { computeArtifactDigest } from './artifact-projection.js';
export { decodeCarrier, encodeCarrier } from './carrier.js';
export { GENERATION_MARKER_PATH } from './constants.js';
export { forgetDestination } from './store.js';
export { ADAPTER_VERSION, NORMAL_MODE, RECOVERY_MODE } from './constants.js';
export {
  PAGES_OIDC_ENVIRONMENT,
  PAGES_OIDC_ISSUER,
  PAGES_OIDC_PROFILE,
  buildSubjectForms,
  verifyPagesOidcToken,
} from './oidc.js';
export {
  GAP_PROOF_PROFILE,
  NO_AUTHORITY_STATE,
  RECOVERY_RECORD_PROFILE,
  buildInterveningAttempts,
  buildRunAttemptGapProof,
  computeGapProofDigest,
  computeInterveningAttemptDigest,
  computeRecoveryDigest,
  sealRecoveryRecord,
  validateReconciliationRecovery,
  validateRunAttemptGapProof,
} from './recovery.js';
export {
  CALL_CLASS_BINDING,
  GITHUB_API_ORIGIN,
  PAGES_CALL_PLAN,
  REQUEST_TEMPLATE_PROFILE,
  buildRequestTemplates,
  callClassIdBinding,
  requireTemplate,
} from './request-catalog.js';

/**
 * @typedef {Readonly<{
 *   owner: string,
 *   repository: string,
 *   repositoryId?: string | number,
 *   repositoryOwnerId?: string | number,
 *   apiOrigin?: string,
 *   oidcToken?: string,
 *   oidcClaims?: import('./oidc.js').PagesOidcExpectation,
 *   publicBaseUrl: string,
 *   token: string,
 *   publishCarrier: (input: {bytes: Buffer, generationId: string, carrierDigest: string}) => Promise<{pagesArtifactId: string | number, artifactDigest?: string, byteCount?: number}>,
 *   fetch?: typeof globalThis.fetch,
 *   publicFetch?: typeof globalThis.fetch,
 *   sleep?: (seconds: number) => Promise<void>,
 *   runId?: string,
 *   runAttempt?: number
 * }>} PagesDestination
 */

/**
 * @typedef {Readonly<{path: string, bytes: Buffer}>} StagedFile
 */

const DEFAULT_API_ORIGIN = GITHUB_API_ORIGIN;

/**
 * Validate a destination and derive the bound REST context.
 *
 * @param {PagesDestination} destination the caller-supplied destination
 * @returns {import('./rest.js').RestContext} the bound REST context
 */
function restContextFor(destination) {
  for (const field of /** @type {const} */ ([
    'owner',
    'repository',
    'publicBaseUrl',
    'token',
  ])) {
    if (typeof destination?.[field] !== 'string' || destination[field] === '') {
      throw new TypeError(
        `destination.${field} (non-empty string) is required by adapter-github-pages`,
      );
    }
  }
  const apiOrigin = destination.apiOrigin ?? DEFAULT_API_ORIGIN;
  if (!apiOrigin.startsWith('https://')) {
    throw new TypeError(
      'destination.apiOrigin must be an https origin; adapter-github-pages refuses a cleartext control plane',
    );
  }
  if (!destination.publicBaseUrl.startsWith('https://')) {
    throw new TypeError('destination.publicBaseUrl must be an https origin');
  }
  if (typeof destination.publishCarrier !== 'function') {
    throw new TypeError(
      'destination.publishCarrier is required: adapter-github-pages never uploads an Actions artifact itself (DEC-097 section 2.3 makes direct carrier upload workflow-owned)',
    );
  }
  return Object.freeze({
    apiOrigin,
    owner: destination.owner,
    repository: destination.repository,
    token: destination.token,
    ...(destination.fetch === undefined ? {} : { fetch: destination.fetch }),
    requestTemplates: buildRequestTemplates(apiOrigin),
  });
}

/**
 * @param {PagesDestination} destination the destination
 * @returns {import('./public-read.js').PublicContext} the public context
 */
function publicContextFor(destination) {
  const injected = destination.publicFetch ?? destination.fetch;
  return Object.freeze({
    publicBaseUrl: destination.publicBaseUrl,
    ...(injected === undefined ? {} : { fetch: injected }),
  });
}

/**
 * `describeCapabilities`: the exact `github-pages` capability row.
 *
 * @param {PagesDestination} destination the bound destination
 * @returns {Promise<Readonly<Record<string, unknown>>>} the declaration
 */
export async function describeCapabilities(destination) {
  const context = restContextFor(destination);
  return Promise.resolve(buildCapabilities({ apiOrigin: context.apiOrigin }));
}

/**
 * Read the generation identity the public origin currently serves, or
 * `null` when nothing has ever been activated.
 *
 * @param {PagesDestination} destination the bound destination
 * @returns {Promise<{generationId: string | null, artifactDigest: string | null, findings: string[]}>}
 *   the observed public generation
 */
async function readServedGeneration(destination) {
  const observation = await readPublic(
    publicContextFor(destination),
    GENERATION_MARKER_PATH,
  );
  if (observation.status === 404) {
    return { generationId: null, artifactDigest: null, findings: [] };
  }
  if (observation.status !== 200 || observation.bytes === null) {
    return {
      generationId: null,
      artifactDigest: null,
      findings: [
        `public generation marker read returned HTTP ${observation.status}; the served generation is unknown, not absent`,
      ],
    };
  }
  const parsed = parsePublicMarker(observation.bytes);
  if (parsed.marker === null) {
    return {
      generationId: null,
      artifactDigest: null,
      findings: parsed.findings,
    };
  }
  return {
    generationId: String(parsed.marker.generationId),
    artifactDigest: String(parsed.marker.artifactDigest),
    findings: [],
  };
}

/**
 * `inspectDestination`: report the currently served generation from a live
 * public read plus the provider's own site state, never from memory.
 *
 * @param {PagesDestination} destination the bound destination
 * @returns {Promise<Readonly<{
 *   currentGenerationId: string | null,
 *   retainedHistory: readonly Readonly<Record<string, unknown>>[],
 *   releaseGenerationsOnDisk: readonly string[],
 *   providerSiteObserved: boolean,
 *   findings: readonly string[]
 * }>>} the inspection result
 */
export async function inspectDestination(destination) {
  const context = restContextFor(destination);
  const served = await readServedGeneration(destination);

  let providerSiteObserved = false;
  /** @type {string[]} */
  const findings = [...served.findings];
  try {
    const site = await callProvider(context, 'inspect', 'pages-site', {
      acceptStatuses: [200, 404],
    });
    providerSiteObserved = site.status === 200;
    if (site.status === 404) {
      findings.push('GitHub Pages is not enabled for this repository');
    }
  } catch (error) {
    findings.push(
      `provider site read failed: ${/** @type {Error} */ (error).message}`,
    );
  }

  const state = stateFor(destination);
  return Object.freeze({
    currentGenerationId: served.generationId,
    retainedHistory: Object.freeze([...state.activations.values()]),
    releaseGenerationsOnDisk: Object.freeze(
      served.generationId === null ? [] : [served.generationId],
    ),
    providerSiteObserved,
    findings: Object.freeze(findings),
  });
}

/**
 * `preflight`: check every declared route against the portable path rules
 * and the reserved marker coordinate, and report the currently served
 * generation for fencing. No provider mutation of any kind occurs here.
 *
 * @param {{
 *   destination: PagesDestination,
 *   entries: readonly {path: string}[],
 *   expectedGenerationId?: string
 * }} input the preflight input
 * @returns {Promise<Readonly<{
 *   verdict: 'proceed' | 'refuse',
 *   observedGenerationId: string | null,
 *   findings: readonly string[]
 * }>>} the preflight result
 */
export async function preflight(input) {
  restContextFor(input.destination);
  /** @type {string[]} */
  const findings = [];
  const seen = new Set();
  for (const entry of input.entries) {
    if (entry.path === GENERATION_MARKER_PATH) {
      findings.push(
        `${entry.path}: collides with the reserved public-generation-marker coordinate`,
      );
    }
    if (entry.path.startsWith('/') || entry.path.includes('\\')) {
      findings.push(`${entry.path}: is not a portable relative POSIX path`);
    }
    if (
      entry.path
        .split('/')
        .some(
          (segment) => segment === '..' || segment === '.' || segment === '',
        )
    ) {
      findings.push(`${entry.path}: contains an empty or dot path segment`);
    }
    if (Buffer.byteLength(entry.path, 'utf8') > 255) {
      findings.push(`${entry.path}: exceeds the 255-byte path ceiling`);
    }
    if (seen.has(entry.path)) {
      findings.push(`${entry.path}: is declared more than once`);
    }
    seen.add(entry.path);
  }

  const served = await readServedGeneration(input.destination);
  findings.push(...served.findings);
  if (
    input.expectedGenerationId !== undefined &&
    served.generationId !== null &&
    input.expectedGenerationId !== served.generationId
  ) {
    findings.push(
      `expected generation ${JSON.stringify(input.expectedGenerationId)} disagrees with the served generation ${JSON.stringify(served.generationId)}`,
    );
  }

  return Object.freeze({
    verdict: findings.length === 0 ? 'proceed' : 'refuse',
    observedGenerationId: served.generationId,
    findings: Object.freeze(findings),
  });
}

/**
 * `stage`: build the deterministic Pages carrier and publish it through the
 * caller-supplied Actions-artifact publisher. Nothing public changes here —
 * `staging: private` is literal: the carrier is an Actions artifact that no
 * public origin serves.
 *
 * @param {{
 *   destination: PagesDestination,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   files: readonly StagedFile[]
 * }} input the stage input
 * @returns {Promise<Readonly<{
 *   stageToken: string,
 *   stagedPath: string,
 *   fileCount: number,
 *   byteCount: string,
 *   carrierDigest: string,
 *   pagesArtifactId: string,
 *   idempotent: boolean
 * }>>} the stage result
 */
export async function stage(input) {
  restContextFor(input.destination);
  const state = stateFor(input.destination);

  for (const existing of state.stages.values()) {
    if (existing.idempotencyKey !== input.idempotencyKey) {
      continue;
    }
    if (existing.artifactDigest !== input.artifactDigest) {
      throw new Error(
        `IDEMPOTENCY_KEY_REUSE_CONFLICT: idempotency key ${JSON.stringify(input.idempotencyKey)} was already used for a different artifact digest`,
      );
    }
    return Object.freeze({
      stageToken: existing.stageToken,
      stagedPath: `actions-artifact:${existing.pagesArtifactId}`,
      fileCount: existing.entryPaths.length,
      byteCount: String(existing.carrierByteCount),
      carrierDigest: existing.carrierDigest,
      pagesArtifactId: existing.pagesArtifactId,
      idempotent: true,
    });
  }

  const marker = buildValidatedMarker({
    artifactId: input.artifactId,
    artifactDigest: input.artifactDigest,
    generationId: input.generationId,
  });
  const carrierFiles = [
    ...input.files.map((file) => ({ path: file.path, bytes: file.bytes })),
    {
      path: GENERATION_MARKER_PATH,
      bytes: Buffer.from(JSON.stringify(marker), 'utf8'),
    },
  ];
  const carrierBytes = encodeCarrier(carrierFiles);
  if (carrierBytes.byteLength > MAXIMUM_PAGES_CARRIER_BYTES) {
    throw new Error(
      `PAGES_CARRIER_TOO_LARGE: ${carrierBytes.byteLength} bytes exceed the ${MAXIMUM_PAGES_CARRIER_BYTES}-byte Pages artifact ceiling`,
    );
  }
  const carrierDigest = sha256Hex(carrierBytes);

  const published = await input.destination.publishCarrier({
    bytes: carrierBytes,
    generationId: input.generationId,
    carrierDigest,
  });
  const pagesArtifactId = String(published.pagesArtifactId);
  if (
    published.artifactDigest !== undefined &&
    published.artifactDigest !== carrierDigest
  ) {
    throw new Error(
      `PAGES_CARRIER_HANDOFF_MISMATCH: the artifact publisher reported digest ${published.artifactDigest} for a carrier whose bytes digest to ${carrierDigest}`,
    );
  }

  const stageToken = carrierDigest.slice(
    'sha256:'.length,
    'sha256:'.length + 32,
  );
  state.stages.set(stageToken, {
    stageToken,
    operationId: input.operationId,
    attemptId: input.attemptId,
    idempotencyKey: input.idempotencyKey,
    generationId: input.generationId,
    artifactId: input.artifactId,
    artifactDigest: input.artifactDigest,
    entryPaths: Object.freeze(input.files.map((file) => file.path)),
    carrierBytes,
    carrierDigest,
    pagesArtifactId,
    pagesArtifactDigest: carrierDigest,
    carrierByteCount: carrierBytes.byteLength,
  });

  return Object.freeze({
    stageToken,
    stagedPath: `actions-artifact:${pagesArtifactId}`,
    fileCount: input.files.length,
    byteCount: String(carrierBytes.byteLength),
    carrierDigest,
    pagesArtifactId,
    idempotent: false,
  });
}

/**
 * Resolve the prior attempt of an unresolved Pages fence before any current
 * carrier is uploaded or created. Exposed separately so the deploy script
 * can run the DEC-097 section 6.2 precheck *before* it calls `stage` (this
 * package's carrier upload happens in `stage`); `activate` runs it again,
 * ahead of any current create, when it is given recovery inputs.
 *
 * @param {{
 *   destination: PagesDestination,
 *   pagesRecovery: Readonly<Record<string, unknown>>
 * }} input the recovery input
 * @returns {Promise<import('./recovery.js').PriorAttemptObservation>} the
 *   truthful prior-attempt observation
 */
export async function recoverPriorAttempt(input) {
  const context = restContextFor(input.destination);
  const recovery = validateReconciliationRecovery(input.pagesRecovery, {
    repositoryId: input.destination.repositoryId ?? '0',
  });
  return resolvePriorAttempt(
    bindIdentity(context, {
      mode: RECOVERY_MODE,
      priorPagesBuildVersion: String(recovery.priorPagesBuildVersion),
    }),
    input.destination.sleep === undefined
      ? {}
      : { sleep: input.destination.sleep },
  );
}

/**
 * Resolve and validate the mandatory Pages OIDC credential inputs.
 *
 * This adapter never mints the token: DEC-097 section 7 places the one
 * acquisition in the workflow's `deploy-github-pages` job, which reads it
 * from `ACTIONS_ID_TOKEN_REQUEST_URL` and passes it in here.
 *
 * @param {PagesDestination} destination the bound destination
 * @param {{pagesOidcToken?: string, pagesOidcClaims?: unknown}} input the
 *   activate input
 * @returns {{
 *   token: string,
 *   expectation: import('./oidc.js').PagesOidcExpectation
 * }} the validated credential inputs
 */
function requirePagesOidc(destination, input) {
  const token = input.pagesOidcToken ?? destination.oidcToken;
  if (typeof token !== 'string' || token === '') {
    throw new Error(
      'PAGES_OIDC_TOKEN_REQUIRED: oidc_token is a mandatory member of the create request entity (DEC-097 section 7). Supply it as input.pagesOidcToken or destination.oidcToken; this repository never mints a credential.',
    );
  }
  const claims = requireOidcExpectation(
    input.pagesOidcClaims ?? destination.oidcClaims,
  );
  if (
    destination.repositoryId === undefined ||
    destination.repositoryOwnerId === undefined
  ) {
    throw new Error(
      'PAGES_OIDC_EXPECTATION_INVALID: destination.repositoryId and destination.repositoryOwnerId are required so the two admitted subject forms can be recomputed from the verified claims',
    );
  }
  return {
    token,
    expectation: /** @type {import('./oidc.js').PagesOidcExpectation} */ (
      Object.freeze({
        ...claims,
        owner: destination.owner,
        repository: destination.repository,
        repositoryId: destination.repositoryId,
        repositoryOwnerId: destination.repositoryOwnerId,
      })
    ),
  };
}

/**
 * `activate`: create exactly one Pages deployment for a staged carrier and
 * poll it to a terminal status (`activation: provider-promotion`).
 *
 * `expectedCurrentGenerationId` is the adapter-protocol `2.1.0` fence:
 * either a generation identity or the explicit `EXPECT_NOTHING_SERVED`
 * sentinel. `null` and `undefined` are refused with
 * `EXPECTED_GENERATION_FENCE_INVALID` (LOCAL-47) — there is no unfenced
 * activation. The check itself is a read-then-compare performed immediately
 * before the create call: honest best effort, not a provider fence, because
 * GitHub Pages exposes no compare-and-set on activation, which is exactly
 * why this adapter declares `concurrency: none`.
 *
 * In `pages-reconciliation-recovery` mode the prior attempt is resolved
 * first, before any current create, per DEC-097 section 6.2.
 *
 * @param {{
 *   destination: PagesDestination,
 *   stageToken: string,
 *   generationId: string,
 *   expectedCurrentGenerationId: string,
 *   expectedArtifactDigest?: string,
 *   pagesOidcToken?: string,
 *   pagesOidcClaims?: import('./oidc.js').PagesOidcExpectation,
 *   mode?: string,
 *   pagesRecovery?: Readonly<Record<string, unknown>>,
 *   crashInjectionHook?: () => void | Promise<void>
 * }} input the activate input; `crashInjectionHook`, when supplied (only
 *   ever by a conformance fixture), is awaited after the carrier is durably
 *   published but strictly before the create-deployment call
 * @returns {Promise<Readonly<Record<string, unknown>>>} the decision
 */
export async function activate(input) {
  const baseContext = restContextFor(input.destination);
  const state = stateFor(input.destination);
  const fence = requireGenerationFence(
    input.expectedCurrentGenerationId,
    'github-pages',
  );
  const mode = input.mode ?? NORMAL_MODE;
  if (!AUTHORITY_MODES.includes(mode)) {
    throw new Error(
      `PAGES_AUTHORITY_MODE_INVALID: ${JSON.stringify(mode)} is not one of ${AUTHORITY_MODES.join(', ')}`,
    );
  }
  if (mode === NORMAL_MODE && input.pagesRecovery !== undefined) {
    throw new Error(
      'PAGES_RECOVERY_RECORD_FORBIDDEN: normal mode forbids pagesRecovery and every recovery-prior call',
    );
  }
  const oidc = requirePagesOidc(input.destination, input);

  const served = await readServedGeneration(input.destination);

  /** @type {import('./recovery.js').PriorAttemptObservation | undefined} */
  let priorObservation;
  /** @type {Readonly<Record<string, unknown>> | undefined} */
  let recovery;
  if (mode === RECOVERY_MODE) {
    recovery = validateReconciliationRecovery(input.pagesRecovery, {
      repositoryId: input.destination.repositoryId ?? '0',
    });
    priorObservation = await resolvePriorAttempt(
      bindIdentity(baseContext, {
        mode: RECOVERY_MODE,
        priorPagesBuildVersion: String(recovery.priorPagesBuildVersion),
      }),
      input.destination.sleep === undefined
        ? {}
        : { sleep: input.destination.sleep },
    );
    if (priorObservation.outcome === 'prior-succeeded') {
      // The same operation's proposed generation was already selected: no
      // new create is performed and the current fence terminalizes.
      state.activations.set(input.generationId, {
        generationId: input.generationId,
        pagesDeploymentId: priorObservation.priorPagesBuildVersion,
        certifiedAt: new Date().toISOString(),
        entryPaths:
          state.stages.get(input.stageToken)?.entryPaths ?? Object.freeze([]),
      });
      return Object.freeze({
        decision: /** @type {'activate'} */ ('activate'),
        mode,
        generationId: input.generationId,
        previousGenerationId: served.generationId,
        idempotent: true,
        terminalState: 'terminal-candidate',
        pagesDeploymentId: priorObservation.priorPagesBuildVersion,
        pagesRecoveryObservation: priorObservation,
      });
    }
    if (priorObservation.outcome === 'reconciliation-required') {
      return Object.freeze({
        decision: /** @type {'reconcile'} */ ('reconcile'),
        mode,
        generationId: input.generationId,
        previousGenerationId: served.generationId,
        idempotent: false,
        destinationChanged: /** @type {false} */ (false),
        authorityState: 'reconciliation-required',
        terminalState: 'reconciliation-required',
        pagesRecoveryObservation: priorObservation,
      });
    }
  }

  if (served.generationId === input.generationId) {
    return Object.freeze({
      decision: /** @type {'activate'} */ ('activate'),
      mode,
      generationId: input.generationId,
      previousGenerationId: served.generationId,
      idempotent: true,
      ...(priorObservation === undefined
        ? {}
        : { pagesRecoveryObservation: priorObservation }),
    });
  }
  if (fenceDisagrees(fence, served.generationId)) {
    // The create call has not been made, so this is the one reconcile
    // decision that can honestly claim an unchanged destination.
    return Object.freeze({
      decision: /** @type {'reconcile'} */ ('reconcile'),
      mode,
      generationId: input.generationId,
      previousGenerationId: served.generationId,
      idempotent: false,
      destinationChanged: /** @type {false} */ (false),
      ...(priorObservation === undefined
        ? {}
        : { pagesRecoveryObservation: priorObservation }),
    });
  }

  const record = state.stages.get(input.stageToken);
  if (record === undefined) {
    throw new Error(
      `PAGES_STAGE_NOT_FOUND: stage token ${JSON.stringify(input.stageToken)} has no staged carrier in this run`,
    );
  }

  if (input.expectedArtifactDigest !== undefined) {
    // Recompute the digest from the carrier bytes that will actually be
    // deployed, not from the file list the caller handed `stage`: a torn
    // or tampered carrier must be caught here, before promotion.
    const decoded = decodeCarrier(record.carrierBytes);
    const recomputed = digestEntries(
      decoded
        .filter((file) => file.path !== GENERATION_MARKER_PATH)
        .map((file) => projectEntry(file.path, file.bytes)),
    );
    if (recomputed !== input.expectedArtifactDigest) {
      throw new Error(
        `STAGE_INTEGRITY_MISMATCH: staged carrier digests to ${recomputed}, which disagrees with the expected artifact digest ${input.expectedArtifactDigest}; refusing to promote a partial or tampered stage`,
      );
    }
  }

  if (input.crashInjectionHook !== undefined) {
    // The carrier is durably published to the provider's artifact store but
    // no deployment has been created: exactly the boundary a real crash
    // could land on. Only a conformance test ever reaches this branch.
    await input.crashInjectionHook();
  }

  const pagesBuildVersion = derivePagesBuildVersion({
    destinationKey: destinationKey(input.destination),
    operationId: record.operationId,
    attemptId: record.attemptId,
    ...(input.destination.runId === undefined
      ? {}
      : { runId: input.destination.runId }),
    ...(input.destination.runAttempt === undefined
      ? {}
      : { runAttempt: input.destination.runAttempt }),
    artifactId: record.artifactId,
    artifactDigest: record.artifactDigest,
    generationId: input.generationId,
  });

  const context = bindIdentity(baseContext, {
    mode,
    pagesBuildVersion,
    ...(recovery === undefined
      ? {}
      : { priorPagesBuildVersion: String(recovery.priorPagesBuildVersion) }),
  });

  state.inFlight.set(input.generationId, pagesBuildVersion);
  const created = await createDeployment(context, {
    pagesArtifactId: record.pagesArtifactId,
    pagesBuildVersion,
    oidcToken: oidc.token,
    oidcExpectation: oidc.expectation,
  });
  const polled = await pollDeployment(context, pagesBuildVersion, {
    ...(input.destination.sleep === undefined
      ? {}
      : { sleep: input.destination.sleep }),
  });
  state.inFlight.delete(input.generationId);

  if (!polled.succeeded) {
    throw new Error(
      `PAGES_DEPLOYMENT_FAILED: deployment ${pagesBuildVersion} reached terminal status ${polled.status}`,
    );
  }

  state.activations.set(input.generationId, {
    generationId: input.generationId,
    pagesDeploymentId: String(created.pagesDeploymentId),
    certifiedAt: new Date().toISOString(),
    // The route inventory this run deployed, retained independently of the
    // staged carrier so `cleanupStaged` can discard the carrier without
    // taking `observe`'s ability to verify the live generation with it.
    entryPaths: record.entryPaths,
  });

  return Object.freeze({
    decision: /** @type {'activate'} */ ('activate'),
    mode,
    generationId: input.generationId,
    previousGenerationId: served.generationId,
    idempotent: false,
    pagesDeploymentId: String(created.pagesDeploymentId),
    observedStatuses: Object.freeze(polled.observedStatuses),
    providerIdentity: created,
    ...(priorObservation === undefined
      ? {}
      : { pagesRecoveryObservation: priorObservation }),
  });
}

/**
 * `observe`: verify the activated generation through credential-free public
 * reads. `providerInventoryAssurance` is `none`, so this verifies exactly
 * the routes this run staged plus the marker; it never claims the deployed
 * inventory is complete.
 *
 * @param {{
 *   destination: PagesDestination,
 *   generationId: string,
 *   expectedArtifactDigest: string
 * }} input the observe input
 * @returns {Promise<Readonly<{
 *   verified: boolean,
 *   observedArtifactDigest: string | null,
 *   currentGenerationId: string | null,
 *   markerValid: boolean,
 *   claimsCompleteInventory: false,
 *   findings: readonly string[]
 * }>>} the observation result
 */
export async function observe(input) {
  restContextFor(input.destination);
  const state = stateFor(input.destination);
  const served = await readServedGeneration(input.destination);

  /** @type {string[]} */
  const findings = [...served.findings];
  if (served.generationId !== input.generationId) {
    findings.push(
      `the public marker names generation ${JSON.stringify(served.generationId)}, not the observed generation ${JSON.stringify(input.generationId)}`,
    );
  }
  const markerValid =
    served.generationId === input.generationId &&
    served.artifactDigest === input.expectedArtifactDigest;
  if (!markerValid) {
    findings.push(
      'the public generation marker is missing, invalid or disagrees with the expected identity',
    );
  }

  const activation = state.activations.get(input.generationId);
  const entryPaths =
    activation?.entryPaths ??
    [...state.stages.values()].find(
      (candidate) => candidate.generationId === input.generationId,
    )?.entryPaths;
  /** @type {string | null} */
  let observedArtifactDigest = null;
  if (entryPaths === undefined) {
    findings.push(
      'this run did not stage the observed generation, so its route inventory cannot be verified here',
    );
  } else {
    const publicContext = publicContextFor(input.destination);
    /** @type {import('./artifact-projection.js').ArtifactEntry[]} */
    const entries = [];
    for (const entryPath of entryPaths) {
      const read = await readPublic(publicContext, entryPath);
      if (read.status !== 200 || read.bytes === null) {
        findings.push(`${entryPath}: public read returned HTTP ${read.status}`);
        continue;
      }
      entries.push(projectEntry(entryPath, read.bytes));
    }
    observedArtifactDigest = digestEntries(entries);
    if (observedArtifactDigest !== input.expectedArtifactDigest) {
      findings.push(
        `the publicly observed artifact digest ${observedArtifactDigest} disagrees with the expected ${input.expectedArtifactDigest}`,
      );
    }
  }

  return Object.freeze({
    verified: findings.length === 0,
    observedArtifactDigest,
    currentGenerationId: served.generationId,
    markerValid,
    claimsCompleteInventory: /** @type {false} */ (false),
    findings: Object.freeze(findings),
  });
}

/**
 * `cleanupStaged`: drop this operation's staged carrier from run-scoped
 * memory and, when an abandoned generation is named, cancel its in-flight
 * deployment through the cataloged cancel call. It never cancels or
 * disturbs a generation that is currently served or retained.
 *
 * @param {{
 *   destination: PagesDestination,
 *   stageToken: string,
 *   generationId?: string
 * }} input the cleanup input
 * @returns {Promise<Readonly<{removed: boolean, cancelled: boolean}>>} whether
 *   staged state was removed and whether a deployment was cancelled
 */
export async function cleanupStaged(input) {
  const context = restContextFor(input.destination);
  const state = stateFor(input.destination);
  const removed = state.stages.delete(input.stageToken);

  let cancelled = false;
  if (input.generationId !== undefined) {
    const served = await readServedGeneration(input.destination);
    const isLive =
      served.generationId === input.generationId ||
      state.activations.has(input.generationId);
    const pending = state.inFlight.get(input.generationId);
    if (!isLive && pending !== undefined) {
      await callProvider(
        bindIdentity(context, { pagesBuildVersion: pending }),
        'cleanup-staged',
        'pages-cancel-deployment',
        { acceptStatuses: [200, 202, 204, 404] },
      );
      state.inFlight.delete(input.generationId);
      cancelled = true;
    }
  }

  return Object.freeze({ removed: removed || cancelled, cancelled });
}

/**
 * `rollback`: `rollback: reupload` semantics. GitHub Pages cannot natively
 * re-promote a historical deployment, so a rollback stages a fresh carrier
 * for the selected historical content under a *new* generation identity and
 * activates it through the ordinary create/poll path.
 *
 * The historical bytes are not recoverable from the provider (Pages exposes
 * no artifact read-back), so the caller supplies them through `files`. The
 * run-scoped stage memory is used only when the target generation was
 * staged by this same run.
 *
 * @param {{
 *   destination: PagesDestination,
 *   targetGenerationId: string,
 *   newGenerationId: string,
 *   newArtifactId: string,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   files?: readonly StagedFile[],
 *   artifactDigest?: string,
 *   pagesOidcToken?: string,
 *   pagesOidcClaims?: import('./oidc.js').PagesOidcExpectation
 * }} input the rollback input
 * @returns {Promise<Readonly<Record<string, unknown>>>} the activation decision
 */
export async function rollback(input) {
  restContextFor(input.destination);
  const state = stateFor(input.destination);

  /** @type {readonly StagedFile[] | undefined} */
  let files = input.files;
  if (files === undefined) {
    const record = [...state.stages.values()].find(
      (candidate) => candidate.generationId === input.targetGenerationId,
    );
    if (record === undefined) {
      throw new Error(
        `ROLLBACK_INPUT_UNAVAILABLE: generation ${JSON.stringify(input.targetGenerationId)} was not staged by this run and GitHub Pages cannot read a historical artifact back; supply its bytes through "files"`,
      );
    }
    files = decodeCarrier(record.carrierBytes).filter(
      (file) => file.path !== GENERATION_MARKER_PATH,
    );
  }

  const artifactDigest = input.artifactDigest ?? computeArtifactDigest(files);
  const staged = await stage({
    destination: input.destination,
    operationId: input.operationId,
    attemptId: input.attemptId,
    idempotencyKey: input.idempotencyKey,
    generationId: input.newGenerationId,
    artifactId: input.newArtifactId,
    artifactDigest,
    files,
  });
  const served = await readServedGeneration(input.destination);
  return activate({
    destination: input.destination,
    stageToken: staged.stageToken,
    generationId: input.newGenerationId,
    // `fenceFor` turns an observed "nothing is served" into the explicit
    // EXPECT_NOTHING_SERVED sentinel rather than the ambiguous `null` that
    // LOCAL-47 removed.
    expectedCurrentGenerationId: fenceFor(served.generationId),
    ...(input.pagesOidcToken === undefined
      ? {}
      : { pagesOidcToken: input.pagesOidcToken }),
    ...(input.pagesOidcClaims === undefined
      ? {}
      : { pagesOidcClaims: input.pagesOidcClaims }),
  });
}

/** This package's runtime status: fully implemented per S4-T04 (W4-11). */
export const PACKAGE_STATUS = Object.freeze({
  name: '@rathnasgala2/adapter-github-pages',
  implemented: true,
  implementingTask: 'S4-T04',
});
