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

import { PagesAdapterError } from './errors.js';
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
import { maxAgeSeconds, readPublic } from './public-read.js';
import { requireOidcExpectation } from './oidc.js';
import {
  resolvePriorAttempt,
  validateReconciliationRecovery,
} from './recovery.js';
import { GITHUB_API_ORIGIN, buildRequestTemplates } from './request-catalog.js';
import { bindIdentity, callProvider } from './rest.js';
import { stateFor } from './store.js';

export {
  EXPECT_NOTHING_SERVED,
  fenceFor,
  generateUuidV7,
} from '@rathnasgala2/adapter-protocol';
export { PagesAdapterError } from './errors.js';
export { computeArtifactDigest } from './artifact-projection.js';
export { decodeCarrier, encodeCarrier } from './carrier.js';
export { buildValidatedMarker } from './marker.js';
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
 *   verificationBaseUrl?: string,
 *   token: string,
 *   publishCarrier: (input: {bytes: Buffer, generationId: string, carrierDigest: string}) => Promise<{pagesArtifactId: string | number, artifactDigest?: string, byteCount?: number}>,
 *   fetch?: typeof globalThis.fetch,
 *   publicFetch?: typeof globalThis.fetch,
 *   sleep?: (seconds: number) => Promise<void>,
 *   now?: () => number,
 *   runId?: string,
 *   runAttempt?: number,
 *   headSha?: string
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
  if (
    destination.verificationBaseUrl !== undefined &&
    !destination.verificationBaseUrl.startsWith('https://')
  ) {
    throw new TypeError(
      'destination.verificationBaseUrl must be an https origin',
    );
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
 * The public context every verification read uses: the marker read, the
 * route reads and the inspection. The origin that is serving right now
 * (`verificationBaseUrl`: the `github.io` project path before the Pages CNAME
 * is set, the custom base once the custom domain serves) when the destination
 * names one, else `publicBaseUrl`. Artifact-relative paths are joined to it
 * the same way under either.
 *
 * @param {PagesDestination} destination the destination
 * @returns {import('./public-read.js').PublicContext} the public context
 */
function publicContextFor(destination) {
  const injected = destination.publicFetch ?? destination.fetch;
  return Object.freeze({
    publicBaseUrl: destination.verificationBaseUrl ?? destination.publicBaseUrl,
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
 * The classified failure the adapter reports when the public origin answers
 * with a redirect instead of the route: the destination's `publicBaseUrl` no
 * longer names the host that serves the site (typically a custom domain was
 * attached while the repository still carries the `github.io` base). The
 * adapter follows no redirect, so it cannot tell what the origin serves.
 *
 * @typedef {Readonly<{
 *   code: 'PAGES_PUBLIC_REDIRECT',
 *   toHost: string | null,
 *   location: string | null
 * }>} PublicRedirectFailure
 */

/**
 * @param {{toHost?: string | null, location?: string | null}} redirect a
 *   `'redirect'` public read
 * @returns {PublicRedirectFailure} the classified failure
 */
function publicRedirectFailure(redirect) {
  return Object.freeze({
    code: /** @type {const} */ ('PAGES_PUBLIC_REDIRECT'),
    toHost: redirect.toHost ?? null,
    location: redirect.location ?? null,
  });
}

/**
 * @param {PublicRedirectFailure} failure the classified failure
 * @returns {string} the finding that states it
 */
function publicRedirectFinding(failure) {
  return `${failure.code}: the public origin answered with a redirect to ${failure.toHost ?? 'a target it did not name as an http(s) URL'} instead of serving the route; the site's base URL no longer names the host that serves it, so set the base URL to the redirect target and publish again`;
}

/**
 * Read the generation identity the public origin currently serves, or
 * `null` when nothing has ever been activated. A redirecting origin is
 * reported as the `PAGES_PUBLIC_REDIRECT` failure with the generation
 * unknown, never thrown.
 *
 * @param {PagesDestination} destination the bound destination
 * @returns {Promise<{generationId: string | null, artifactDigest: string | null, findings: string[], cacheControl?: string | null | undefined, failure?: PublicRedirectFailure}>}
 *   the observed public generation
 */
async function readServedGeneration(destination) {
  const observation = await readPublic(
    publicContextFor(destination),
    GENERATION_MARKER_PATH,
  );
  if (observation.status === 'redirect') {
    const failure = publicRedirectFailure(observation);
    return {
      generationId: null,
      artifactDigest: null,
      findings: [publicRedirectFinding(failure)],
      failure,
    };
  }
  if (observation.status === 404) {
    return {
      generationId: null,
      artifactDigest: null,
      findings: [],
      cacheControl: observation.cacheControl,
    };
  }
  if (observation.status !== 200 || observation.bytes === null) {
    return {
      generationId: null,
      artifactDigest: null,
      cacheControl: observation.cacheControl,
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
      cacheControl: observation.cacheControl,
    };
  }
  return {
    generationId: String(parsed.marker.generationId),
    artifactDigest: String(parsed.marker.artifactDigest),
    findings: [],
    cacheControl: observation.cacheControl,
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
 *   findings: readonly string[],
 *   failure?: PublicRedirectFailure
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
    ...(served.failure === undefined ? {} : { failure: served.failure }),
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
      throw new PagesAdapterError(
        `IDEMPOTENCY_KEY_REUSE_CONFLICT`,
        `idempotency key ${JSON.stringify(input.idempotencyKey)} was already used for a different artifact digest`,
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
    throw new PagesAdapterError(
      `PAGES_CARRIER_TOO_LARGE`,
      `${carrierBytes.byteLength} bytes exceed the ${MAXIMUM_PAGES_CARRIER_BYTES}-byte Pages artifact ceiling`,
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
    throw new PagesAdapterError(
      `PAGES_CARRIER_HANDOFF_MISMATCH`,
      `the artifact publisher reported digest ${published.artifactDigest} for a carrier whose bytes digest to ${carrierDigest}`,
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
    entries: Object.freeze(
      input.files.map((file) => projectEntry(file.path, file.bytes)),
    ),
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
    throw new PagesAdapterError(
      'PAGES_OIDC_TOKEN_REQUIRED',
      'oidc_token is a mandatory member of the create request entity (DEC-097 section 7). Supply it as input.pagesOidcToken or destination.oidcToken; this repository never mints a credential.',
    );
  }
  const claims = requireOidcExpectation(
    input.pagesOidcClaims ?? destination.oidcClaims,
  );
  if (
    destination.repositoryId === undefined ||
    destination.repositoryOwnerId === undefined
  ) {
    throw new PagesAdapterError(
      'PAGES_OIDC_EXPECTATION_INVALID',
      'destination.repositoryId and destination.repositoryOwnerId are required so the two admitted subject forms can be recomputed from the verified claims',
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
    throw new PagesAdapterError(
      `PAGES_AUTHORITY_MODE_INVALID`,
      `${JSON.stringify(mode)} is not one of ${AUTHORITY_MODES.join(', ')}`,
    );
  }
  if (mode === NORMAL_MODE && input.pagesRecovery !== undefined) {
    throw new PagesAdapterError(
      'PAGES_RECOVERY_RECORD_FORBIDDEN',
      'normal mode forbids pagesRecovery and every recovery-prior call',
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
        entries:
          state.stages.get(input.stageToken)?.entries ?? Object.freeze([]),
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
    throw new PagesAdapterError(
      `PAGES_STAGE_NOT_FOUND`,
      `stage token ${JSON.stringify(input.stageToken)} has no staged carrier in this run`,
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
      throw new PagesAdapterError(
        `STAGE_INTEGRITY_MISMATCH`,
        `staged carrier digests to ${recomputed}, which disagrees with the expected artifact digest ${input.expectedArtifactDigest}; refusing to promote a partial or tampered stage`,
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
    headSha: input.destination.headSha,
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
    throw new PagesAdapterError(
      `PAGES_DEPLOYMENT_FAILED`,
      `deployment ${pagesBuildVersion} reached terminal status ${polled.status}`,
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
    entries: record.entries,
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
 *   findings: readonly string[],
 *   failure?: PublicRedirectFailure
 * }>>} the observation result
 */
export async function observe(input) {
  restContextFor(input.destination);
  const sleep = input.destination.sleep ?? defaultSleep;
  const clock = input.destination.now ?? Date.now;
  const startedAt = clock();
  let slept = 0;
  let delay = OBSERVE_FIRST_DELAY_SECONDS;
  /** @type {ObserveProgress} */
  const progress = {
    matched: new Map(),
    matchedPass: new Map(),
    latest: new Map(),
    statuses: new Map(),
    served: null,
    markerPass: -1,
    pass: 0,
    cursor: 0,
    confirmed: false,
    errorCode: null,
    errorStreak: 0,
  };
  let attempt = await observeOnce(input, progress);
  let deadline = observeDeadlineSeconds(attempt.maxAgeSeconds);
  for (;;) {
    const result = { ...attempt };
    const retryable = attempt.retryable;
    // @ts-expect-error the retry hints are internal and never returned
    delete result.retryable;
    // @ts-expect-error the retry hints are internal and never returned
    delete result.maxAgeSeconds;
    if (result.verified || !retryable) {
      return Object.freeze(result);
    }
    deadline = Math.max(
      deadline,
      observeDeadlineSeconds(attempt.maxAgeSeconds),
    );
    const elapsed = Math.max(slept, (clock() - startedAt) / 1000);
    const wait = Math.min(delay, deadline - elapsed);
    if (wait <= 0) {
      return Object.freeze(result);
    }
    await sleep(wait);
    slept += wait;
    delay = Math.min(delay * 2, OBSERVE_MAXIMUM_DELAY_SECONDS);
    attempt = await observeOnce(input, progress);
  }
}

/** First wait between observations, doubling up to the maximum. */
const OBSERVE_FIRST_DELAY_SECONDS = 5;
/** Longest wait between two observations. */
const OBSERVE_MAXIMUM_DELAY_SECONDS = 30;
/** Lifetime assumed when the origin declares no `max-age`. */
const OBSERVE_DEFAULT_MAX_AGE_SECONDS = 600;
/** Longest declared `max-age` that is waited out. */
const OBSERVE_MAXIMUM_MAX_AGE_SECONDS = 900;
/** Margin added to the cache lifetime. */
const OBSERVE_MARGIN_SECONDS = 60;

/**
 * How long a stale public read may keep disagreeing: the CDN lifetime plus a
 * margin.
 *
 * @param {number | null} declared the largest `max-age` seen, if any
 * @returns {number} the deadline in seconds since the first observation
 */
function observeDeadlineSeconds(declared) {
  const lifetime = Math.min(
    declared ?? OBSERVE_DEFAULT_MAX_AGE_SECONDS,
    OBSERVE_MAXIMUM_MAX_AGE_SECONDS,
  );
  return Math.max(lifetime, 0) + OBSERVE_MARGIN_SECONDS;
}

/**
 * @param {number} seconds seconds to wait
 * @returns {Promise<void>} resolves after the wait
 */
function defaultSleep(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

/**
 * What `observe` keeps between passes so a retry reads only what is still
 * wrong: the routes whose bytes already match the staged entry, the latest
 * bytes of the others, and the marker read until it matches.
 *
 * @typedef {{
 *   matched: Map<string, import('./artifact-projection.js').ArtifactEntry>,
 *   matchedPass: Map<string, number>,
 *   latest: Map<string, import('./artifact-projection.js').ArtifactEntry>,
 *   statuses: Map<string, number>,
 *   served: Awaited<ReturnType<typeof readServedGeneration>> | null,
 *   markerPass: number,
 *   pass: number,
 *   cursor: number,
 *   confirmed: boolean,
 *   errorCode: string | null,
 *   errorStreak: number
 * }} ObserveProgress
 */

/**
 * Stale routes re-read per pass after the first. A pass reads at most this
 * many plus the marker until the sample matches; the request count is about
 * passes x (K + 1) + 2 x routes, with no cap that can fire inside a CDN
 * lifetime.
 */
const OBSERVE_SAMPLE_ROUTES = 20;
/** Largest site whose early matches are confirmed again before success. */
const OBSERVE_CONFIRM_MAXIMUM_ROUTES = 50;
/** Consecutive passes failing with one transient code before giving up. */
const OBSERVE_TRANSIENT_STREAK = 3;
/** Most unmatched routes named individually in the findings. */
const OBSERVE_FINDINGS_NAMED = 10;

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * @param {string} code a network error code
 * @returns {boolean} whether it is a certificate, TLS or name-resolution
 *   failure that waiting cannot cure
 */
function isFatalCode(code) {
  return (
    code === 'ENOTFOUND' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS_') ||
    code.startsWith('ERR_SSL_')
  );
}

/**
 * Every error code carried by a thrown fetch failure, its cause and the
 * causes' aggregated errors.
 *
 * @param {unknown} error the thrown value
 * @returns {string[]} the codes found
 */
function errorCodes(error) {
  /** @type {string[]} */
  const codes = [];
  /** @type {unknown[]} */
  const queue = [error];
  for (let depth = 0; queue.length > 0 && depth < 16; depth += 1) {
    const current = /** @type {any} */ (queue.shift());
    if (current === null || typeof current !== 'object') {
      continue;
    }
    if (typeof current.code === 'string') {
      codes.push(current.code);
    }
    queue.push(current.cause);
    if (Array.isArray(current.errors)) {
      queue.push(...current.errors);
    }
  }
  return codes;
}

/**
 * Classify a failed public read. Only transient transport failures are
 * waited out; typed adapter errors, name-resolution, certificate and TLS
 * failures and programming errors fail fast.
 *
 * @param {unknown} error the thrown value
 * @returns {string | null} the transient code, or null when it must throw
 */
function transientCode(error) {
  if (error instanceof PagesAdapterError) {
    return null;
  }
  const codes = errorCodes(error);
  if (codes.some(isFatalCode)) {
    return null;
  }
  const code = codes.find((candidate) => TRANSIENT_CODES.has(candidate));
  if (code !== undefined) {
    return code;
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'TimeoutError';
  }
  return null;
}

/**
 * @param {unknown} error the thrown value
 * @returns {string} a short, single-line description
 */
function describeReadError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replaceAll(/\s+/gu, ' ').slice(0, 200);
}

/**
 * One observation pass. `retryable` is false for hard failures (a redirect,
 * a generation this run never staged, a repeating transport failure), which
 * no waiting can change. The first pass reads the marker and every route.
 * Later passes read the marker until it matches and a rotating sample of the
 * still-unmatched routes; once the sample and the marker match, the rest of
 * the unmatched routes are read in the same pass. Before success a small
 * site re-reads what matched in earlier passes. The digest is computed over
 * the whole coherent set.
 *
 * @param {Parameters<typeof observe>[0]} input the observe input
 * @param {ObserveProgress} progress what earlier passes learned
 * @returns {Promise<Awaited<ReturnType<typeof observe>> & {retryable: boolean, maxAgeSeconds: number | null}>}
 *   the observation and its retry hints
 */
async function observeOnce(input, progress) {
  const state = stateFor(input.destination);
  const staged =
    state.activations.get(input.generationId) ??
    [...state.stages.values()].find(
      (candidate) => candidate.generationId === input.generationId,
    );
  const entryPaths = staged?.entryPaths;
  const pass = progress.pass;
  progress.pass += 1;
  /** @type {{text: string, code: string}[]} */
  const readErrors = [];
  /** @type {number | null} */
  let seenMaxAge = null;
  /** @type {PublicRedirectFailure | undefined} */
  let failure;

  const markerMatches = () =>
    progress.served !== null &&
    progress.served.generationId === input.generationId &&
    progress.served.artifactDigest === input.expectedArtifactDigest;

  const readMarker = async () => {
    try {
      progress.served = await readServedGeneration(input.destination);
      progress.markerPass = pass;
    } catch (error) {
      const code = transientCode(error);
      if (code === null) {
        throw error;
      }
      readErrors.push({
        text: `${GENERATION_MARKER_PATH}: ${describeReadError(error)}`,
        code,
      });
      progress.served ??= {
        generationId: null,
        artifactDigest: null,
        findings: [],
      };
    }
    if (progress.served.failure !== undefined) {
      failure = progress.served.failure;
    }
    const age = maxAgeSeconds(progress.served.cacheControl);
    if (age !== null && age > (seenMaxAge ?? -1)) {
      seenMaxAge = age;
    }
  };

  if (!markerMatches()) {
    await readMarker();
  }

  /** @type {string | undefined} */
  let redirectedRoute;
  if (failure === undefined && entryPaths !== undefined) {
    const publicContext = publicContextFor(input.destination);
    const expectedByPath = new Map(
      (staged?.entries ?? []).map((entry) => [entry.path, entry]),
    );
    /**
     * @param {string} entryPath the route
     * @returns {Promise<boolean>} false when the origin redirects
     */
    const readRoute = async (entryPath) => {
      /** @type {Awaited<ReturnType<typeof readPublic>>} */
      let read;
      try {
        read = await readPublic(publicContext, entryPath);
      } catch (error) {
        const code = transientCode(error);
        if (code === null) {
          throw error;
        }
        readErrors.push({
          text: `${entryPath}: ${describeReadError(error)}`,
          code,
        });
        return true;
      }
      const age = maxAgeSeconds(read.cacheControl);
      if (age !== null && age > (seenMaxAge ?? -1)) {
        seenMaxAge = age;
      }
      if (read.status === 'redirect') {
        failure = publicRedirectFailure(read);
        redirectedRoute = entryPath;
        return false;
      }
      if (read.status !== 200 || read.bytes === null) {
        progress.latest.delete(entryPath);
        progress.matched.delete(entryPath);
        progress.statuses.set(entryPath, read.status);
        return true;
      }
      progress.statuses.delete(entryPath);
      const entry = projectEntry(entryPath, read.bytes);
      const expected = expectedByPath.get(entryPath);
      if (
        expected !== undefined &&
        expected.sha256 === entry.sha256 &&
        expected.byteLength === entry.byteLength
      ) {
        progress.matched.set(entryPath, entry);
        progress.matchedPass.set(entryPath, pass);
        progress.latest.delete(entryPath);
      } else {
        progress.matched.delete(entryPath);
        progress.latest.set(entryPath, entry);
      }
      return true;
    };

    const unmatched = entryPaths.filter(
      (entryPath) => !progress.matched.has(entryPath),
    );
    /** @type {string[]} */
    let sample = unmatched;
    if (pass > 0 && unmatched.length > OBSERVE_SAMPLE_ROUTES) {
      const start = progress.cursor % unmatched.length;
      sample = [];
      for (let offset = 0; offset < OBSERVE_SAMPLE_ROUTES; offset += 1) {
        sample.push(
          /** @type {string} */ (
            unmatched[(start + offset) % unmatched.length]
          ),
        );
      }
      progress.cursor += OBSERVE_SAMPLE_ROUTES;
    }
    let redirected = false;
    for (const entryPath of sample) {
      if (!(await readRoute(entryPath))) {
        redirected = true;
        break;
      }
    }
    if (
      !redirected &&
      sample.length < unmatched.length &&
      markerMatches() &&
      sample.every((entryPath) => progress.matched.has(entryPath))
    ) {
      const sampled = new Set(sample);
      for (const entryPath of unmatched) {
        if (!sampled.has(entryPath) && !(await readRoute(entryPath))) {
          redirected = true;
          break;
        }
      }
    }
    if (
      !redirected &&
      !progress.confirmed &&
      pass > 0 &&
      entryPaths.length <= OBSERVE_CONFIRM_MAXIMUM_ROUTES &&
      readErrors.length === 0 &&
      markerMatches() &&
      entryPaths.every((entryPath) => progress.matched.has(entryPath))
    ) {
      // About to succeed: re-read what matched only in earlier passes.
      progress.confirmed = true;
      if (progress.markerPass < pass) {
        await readMarker();
      }
      for (const entryPath of entryPaths) {
        if (
          (progress.matchedPass.get(entryPath) ?? pass) < pass &&
          !(await readRoute(entryPath))
        ) {
          break;
        }
      }
    }
  }

  const served = /** @type {NonNullable<typeof progress.served>} */ (
    progress.served
  );
  /** @type {string[]} */
  const findings = [...served.findings];
  if (served.generationId !== input.generationId) {
    findings.push(
      `the public marker names generation ${JSON.stringify(served.generationId)}, not the observed generation ${JSON.stringify(input.generationId)}`,
    );
  }
  const markerValid = markerMatches();
  if (!markerValid) {
    findings.push(
      'the public generation marker is missing, invalid or disagrees with the expected identity',
    );
  }

  let retryable = true;
  /** @type {string | null} */
  let observedArtifactDigest = null;
  if (failure !== undefined) {
    // The origin redirects, so every route would redirect too: say so once
    // instead of asking for each of them.
    retryable = false;
    if (redirectedRoute !== undefined) {
      findings.push(`${redirectedRoute}: ${publicRedirectFinding(failure)}`);
    }
  } else if (entryPaths === undefined) {
    retryable = false;
    findings.push(
      'this run did not stage the observed generation, so its route inventory cannot be verified here',
    );
  } else {
    const unmatchedNow = entryPaths.filter(
      (entryPath) => !progress.matched.has(entryPath),
    );
    for (const entryPath of unmatchedNow.slice(0, OBSERVE_FINDINGS_NAMED)) {
      const status = progress.statuses.get(entryPath);
      if (status !== undefined) {
        findings.push(`${entryPath}: public read returned HTTP ${status}`);
      } else if (progress.latest.has(entryPath)) {
        findings.push(`${entryPath}: bytes do not yet match the staged entry`);
      } else if (
        !readErrors.some((error) => error.text.startsWith(`${entryPath}: `))
      ) {
        findings.push(`${entryPath}: not yet read`);
      }
    }
    if (unmatchedNow.length > OBSERVE_FINDINGS_NAMED) {
      findings.push(
        `${unmatchedNow.length - OBSERVE_FINDINGS_NAMED} more routes do not yet match the staged entries`,
      );
    }
    for (const readError of readErrors) {
      findings.push(`public read failed: ${readError.text}`);
    }
    const coherent = [
      ...progress.matched.values(),
      ...progress.latest.values(),
    ];
    if (coherent.length === entryPaths.length) {
      observedArtifactDigest = digestEntries(coherent);
      if (observedArtifactDigest !== input.expectedArtifactDigest) {
        findings.push(
          `the publicly observed artifact digest ${observedArtifactDigest} disagrees with the expected ${input.expectedArtifactDigest}`,
        );
      }
    }
    if (unmatchedNow.length === 0 && markerValid) {
      // Every route matches its staged entry and the marker matches, yet
      // the digest disagrees: no further reading can change that.
      retryable = false;
    }
    const code = readErrors[0]?.code ?? null;
    if (code === null) {
      progress.errorStreak = 0;
    } else if (code === progress.errorCode) {
      progress.errorStreak += 1;
    } else {
      progress.errorStreak = 1;
    }
    progress.errorCode = code;
    if (progress.errorStreak >= OBSERVE_TRANSIENT_STREAK) {
      retryable = false;
      findings.push(
        `the public read failed with ${code} on ${progress.errorStreak} consecutive passes; giving up`,
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
    ...(failure === undefined ? {} : { failure }),
    retryable,
    maxAgeSeconds: seenMaxAge,
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
      throw new PagesAdapterError(
        `ROLLBACK_INPUT_UNAVAILABLE`,
        `generation ${JSON.stringify(input.targetGenerationId)} was not staged by this run and GitHub Pages cannot read a historical artifact back; supply its bytes through "files"`,
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
