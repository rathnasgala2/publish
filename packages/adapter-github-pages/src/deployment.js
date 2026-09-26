/**
 * The Pages deployment call sequence: the `pagesBuildVersion` projection,
 * the exact `gala-pages-create-deployment-jcs-v2` request entity, the single
 * create call, and the bounded poll loop over the exact eleven accepted
 * statuses (DEC-097 sections 6.2 and 7).
 *
 * The create body is the one place either credential is allowed to meet the
 * other's destination, so both directions are enforced here: the OIDC token
 * goes only into the body and never into a header, evidence, digest, output
 * or thrown message, and the GitHub token goes only into the `authorization`
 * header and never into the body.
 *
 * @module
 */

import { PagesAdapterError } from './errors.js';
import { canonicalizeJson, domainDigest } from '@rathnasgala2/adapter-protocol';

import {
  DOMAIN_PAGES_BUILD_VERSION,
  POLL_BUDGET_SECONDS,
  POLL_SCHEDULE_SECONDS,
  POLL_TAIL_SECONDS,
  PAGES_DEPLOYMENT_STATUSES,
  SUCCESS_STATUS,
  TEMPORARY_STATUSES,
  TERMINAL_FAILURE_STATUSES,
} from './constants.js';
import { verifyPagesOidcToken } from './oidc.js';
import { assertFreeOfSecrets, withRedactedFailures } from './redaction.js';
import { CREATE_BODY_PROFILE } from './request-catalog.js';
import { buildPollUrl, callProvider, expectedStatusUrl } from './rest.js';

/** The exact three member names of the create request entity, in JCS order. */
export const CREATE_BODY_MEMBERS = Object.freeze([
  'artifact_id',
  'oidc_token',
  'pages_build_version',
]);

/** The inclusive upper bound on `artifact_id` (exact JSON/JCS identity). */
export const MAXIMUM_ARTIFACT_ID = 9007199254740991;

const BUILD_VERSION_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * Derive the `pagesBuildVersion`: the first 40 lowercase hex characters of
 * the domain-separated repository/operation/attempt/run/artifact/generation
 * projection (DEC-097 section 6.2). `pagesDeploymentId` must equal it
 * exactly.
 *
 * @param {{
 *   destinationKey: string,
 *   operationId: string,
 *   attemptId: string,
 *   runId?: string,
 *   runAttempt?: number,
 *   artifactId: string,
 *   artifactDigest: string,
 *   generationId: string
 * }} projection the closed projection inputs
 * @returns {string} the 40-character lowercase hexadecimal build version
 */
export function derivePagesBuildVersion(projection) {
  return domainDigest(DOMAIN_PAGES_BUILD_VERSION, {
    destinationKey: projection.destinationKey,
    operationId: projection.operationId,
    attemptId: projection.attemptId,
    runId: projection.runId ?? null,
    runAttempt: projection.runAttempt ?? null,
    artifactId: projection.artifactId,
    artifactDigest: projection.artifactDigest,
    generationId: projection.generationId,
  })
    .slice('sha256:'.length)
    .slice(0, 40);
}

/**
 * Refuse a create-body text that is not the exact compact JCS of the three
 * admitted members. Exported so a fixture can prove a duplicated, extra,
 * missing or reordered member is refused without reaching a provider.
 *
 * @param {string} bodyText the serialized request entity
 * @returns {void}
 */
export function assertCanonicalCreateBody(bodyText) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new PagesAdapterError(
      'PAGES_CREATE_BODY_NONCANONICAL',
      'the create request entity is not JSON',
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PagesAdapterError(
      'PAGES_CREATE_BODY_NONCANONICAL',
      'the create request entity is not a JSON object',
    );
  }
  const keys = Object.keys(/** @type {Record<string, unknown>} */ (parsed));
  if (
    keys.length !== CREATE_BODY_MEMBERS.length ||
    !CREATE_BODY_MEMBERS.every((name, index) => keys[index] === name)
  ) {
    throw new PagesAdapterError(
      `PAGES_CREATE_BODY_NONCANONICAL`,
      `the create request entity must have exactly the three members ${CREATE_BODY_MEMBERS.join(', ')} in JCS order`,
    );
  }
  if (canonicalizeJson(parsed) !== bodyText) {
    throw new PagesAdapterError(
      'PAGES_CREATE_BODY_NONCANONICAL',
      'the create request entity is not compact RFC 8785 JCS',
    );
  }
}

/**
 * Build the exact `gala-pages-create-deployment-jcs-v2` request entity.
 *
 * @param {{
 *   pagesArtifactId: string | number,
 *   pagesBuildVersion: string,
 *   oidcToken: string,
 *   githubToken: string
 * }} input the body inputs
 * @returns {Readonly<{bodyText: string, byteCount: number, artifactId: number}>}
 *   the canonical body text and its non-secret measurements
 */
export function buildCreateDeploymentBody(input) {
  const artifactId = Number(input.pagesArtifactId);
  if (
    !Number.isSafeInteger(artifactId) ||
    artifactId < 1 ||
    artifactId > MAXIMUM_ARTIFACT_ID ||
    String(artifactId) !== String(input.pagesArtifactId)
  ) {
    throw new PagesAdapterError(
      `PAGES_ARTIFACT_ID_INVALID`,
      `${JSON.stringify(String(input.pagesArtifactId))} is not a JSON integer in 1..${MAXIMUM_ARTIFACT_ID}; a string artifact id, a non-integer and an unsafe integer are all refused`,
    );
  }
  if (!BUILD_VERSION_PATTERN.test(input.pagesBuildVersion)) {
    throw new PagesAdapterError(
      'PAGES_BUILD_VERSION_INVALID',
      'pages_build_version must be exactly 40 lowercase hexadecimal characters',
    );
  }
  if (typeof input.oidcToken !== 'string' || input.oidcToken === '') {
    throw new PagesAdapterError(
      'PAGES_OIDC_TOKEN_REQUIRED',
      'oidc_token is a mandatory member of the create request entity',
    );
  }
  const bodyText = canonicalizeJson({
    artifact_id: artifactId,
    oidc_token: input.oidcToken,
    pages_build_version: input.pagesBuildVersion,
  });
  assertCanonicalCreateBody(bodyText);
  if (bodyText.includes(input.githubToken)) {
    throw new PagesAdapterError(
      'PAGES_SECRET_LEAK_DETECTED',
      'the GitHub token reached the create request body; DEC-097 section 7 forbids it',
    );
  }
  return Object.freeze({
    bodyText,
    byteCount: Buffer.byteLength(bodyText, 'utf8'),
    artifactId,
  });
}

/**
 * Issue the single create-deployment call and return the closed provider
 * identity projection. `createResponseStatusUrl` is carried only on the
 * `createResponseObserved: true` branch and only when it equals the exact
 * expected shape; it is evidence, never a URL this adapter follows.
 *
 * The OIDC token is verified against its expected bindings and then placed
 * only in the body. Neither credential can reach the returned evidence: the
 * whole projection is scanned before it is returned, and every failure
 * message is scrubbed.
 *
 * @param {import('./rest.js').RestContext} context the bound REST context
 * @param {{
 *   pagesArtifactId: string | number,
 *   pagesBuildVersion: string,
 *   oidcToken: string,
 *   oidcExpectation: import('./oidc.js').PagesOidcExpectation,
 *   stage?: string
 * }} input the create inputs
 * @returns {Promise<Readonly<Record<string, unknown>>>} the provider identity
 */
export async function createDeployment(context, input) {
  const secrets = [input.oidcToken, context.token];
  return withRedactedFailures(secrets, async () => {
    const oidcEvidence = verifyPagesOidcToken(
      input.oidcToken,
      input.oidcExpectation,
    );
    const body = buildCreateDeploymentBody({
      pagesArtifactId: input.pagesArtifactId,
      pagesBuildVersion: input.pagesBuildVersion,
      oidcToken: input.oidcToken,
      githubToken: context.token,
    });

    const response = await callProvider(
      context,
      input.stage ?? 'activate',
      'pages-create-deployment',
      { bodyText: body.bodyText, acceptStatuses: [200, 201] },
    );

    const parsed = /** @type {Record<string, unknown>} */ (response.body ?? {});
    const observedId = parsed.id === undefined ? undefined : String(parsed.id);
    if (observedId !== input.pagesBuildVersion) {
      throw new PagesAdapterError(
        `PAGES_DEPLOYMENT_ID_MISMATCH`,
        `provider returned deployment id ${JSON.stringify(observedId)} for requested pages_build_version ${JSON.stringify(input.pagesBuildVersion)}`,
      );
    }

    const expected = expectedStatusUrl(context, input.pagesBuildVersion);
    const observedStatusUrl =
      typeof parsed.status_url === 'string' && parsed.status_url === expected
        ? expected
        : undefined;
    const pollUrl = buildPollUrl(context, input.pagesBuildVersion);
    if (observedStatusUrl === pollUrl) {
      throw new PagesAdapterError(
        'PAGES_STATUS_URL_EQUALS_POLL_URL',
        'DEC-097 section 7 forbids equality between the create response status_url and the independently constructed poll URL',
      );
    }

    // Retained evidence records only the body profile, its byte count and
    // the non-secret artifact ID and build version (DEC-097 section 7).
    const identity = Object.freeze({
      createResponseObserved: true,
      pagesDeploymentId: input.pagesBuildVersion,
      ...(observedStatusUrl === undefined
        ? {}
        : { createResponseStatusUrl: observedStatusUrl }),
      pollUrl,
      requestBodyProfile: CREATE_BODY_PROFILE,
      requestBodyByteCount: body.byteCount,
      pagesArtifactId: String(body.artifactId),
      pagesBuildVersion: input.pagesBuildVersion,
      oidcCredentialSourceProfile: oidcEvidence.profile,
      oidcSubjectForm: oidcEvidence.subjectForm,
      oidcIssuerSignatureVerified: oidcEvidence.issuerSignatureVerified,
    });
    assertFreeOfSecrets(identity, secrets, 'create-deployment evidence');
    return identity;
  });
}

/**
 * Poll one deployment to a terminal state under the fixed budget, waiting
 * exactly `5, 8, 12, 18, 27, 30` seconds and then repeating `30`.
 *
 * @param {import('./rest.js').RestContext} context the bound REST context
 * @param {string} pagesDeploymentId the deployment identity, used only to
 *   name the deployment in diagnostics; the request target's segment is
 *   selected statically by the call class from the bound context
 * @param {{
 *   sleep?: (seconds: number) => Promise<void>,
 *   budgetSeconds?: number,
 *   stage?: string
 * }} options polling controls; `sleep` is injectable so a test proves the
 *   schedule without spending it in wall-clock time
 * @returns {Promise<{
 *   status: string,
 *   succeeded: boolean,
 *   observedStatuses: string[],
 *   waitedSeconds: number[]
 * }>} the terminal observation
 */
export async function pollDeployment(context, pagesDeploymentId, options) {
  const sleep = options.sleep ?? defaultSleep;
  const budget = options.budgetSeconds ?? POLL_BUDGET_SECONDS;
  const stage = options.stage ?? 'activate';
  /** @type {string[]} */
  const observedStatuses = [];
  /** @type {number[]} */
  const waitedSeconds = [];
  let spent = 0;

  for (let attempt = 0; ; attempt += 1) {
    const response = await callProvider(
      context,
      stage,
      'pages-deployment-status',
      { acceptStatuses: [200] },
    );
    const status = String(
      /** @type {Record<string, unknown>} */ (response.body ?? {}).status,
    );
    observedStatuses.push(status);

    if (!PAGES_DEPLOYMENT_STATUSES.includes(status)) {
      throw new PagesAdapterError(
        `PAGES_DEPLOYMENT_STATUS_UNKNOWN`,
        `${JSON.stringify(status)} is outside the eleven accepted statuses; the destination fence stays held`,
      );
    }
    if (status === SUCCESS_STATUS) {
      return { status, succeeded: true, observedStatuses, waitedSeconds };
    }
    if (TERMINAL_FAILURE_STATUSES.includes(status)) {
      return { status, succeeded: false, observedStatuses, waitedSeconds };
    }
    if (!TEMPORARY_STATUSES.includes(status)) {
      throw new PagesAdapterError(
        `PAGES_DEPLOYMENT_STATUS_UNPARTITIONED`,
        `${JSON.stringify(status)} is neither temporary nor terminal`,
      );
    }

    const wait = POLL_SCHEDULE_SECONDS[attempt] ?? POLL_TAIL_SECONDS;
    if (spent + wait > budget) {
      throw new PagesAdapterError(
        `PAGES_DEPLOYMENT_POLL_BUDGET_EXHAUSTED`,
        `${pagesDeploymentId} was still ${status} after ${spent} seconds; the outcome is ambiguous and the destination fence stays held`,
      );
    }
    spent += wait;
    waitedSeconds.push(wait);
    await sleep(wait);
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
