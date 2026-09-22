/**
 * The raw GitHub Pages REST client. Every request line is resolved from the
 * frozen nine-row request-template catalog (`request-catalog.js`) by its
 * exact `(stage, callClass)` pair, never from a caller-supplied URL: a
 * `status_url` parsed out of a create response is retained verbatim as
 * evidence and is never followed (DEC-097 section 6.2).
 *
 * Three properties this module enforces rather than assumes:
 *
 * 1. Every request sends exactly the fixed headers its template declares —
 *    including the mandatory `accept-encoding: identity` and
 *    `connection: close` — plus exactly one `authorization` credential row.
 *    A request that disagrees with its template is refused before dispatch.
 * 2. The `pagesDeploymentId` path segment is chosen *statically by the call
 *    class*: the seven ordinary/current rows take the intent's reserved
 *    `pagesBuildVersion` and the two `pages-recovery-prior-*` rows take
 *    `pagesRecovery.priorPagesBuildVersion`. No provider response and no
 *    workflow value can select it.
 * 3. The two recovery-prior rows are forbidden in `normal` mode.
 *
 * The client is deliberately small and explicit: no redirect following, no
 * ambient proxy or cookie state, a bounded response body, and a caller-
 * injectable `fetch` so a conformance fixture can bind the exact same code
 * path to a local fake provider without weakening anything (the canonical
 * origin, the request line and every header are identical either way).
 *
 * @module
 */

import { NORMAL_MODE, RECOVERY_MODE } from './constants.js';
import { callClassIdBinding, requireTemplate } from './request-catalog.js';

/** Maximum response body this client will read, in bytes. */
export const MAXIMUM_RESPONSE_BODY_BYTES = 1048576;

/** The exact shape a `pagesBuildVersion` path segment must have. */
const BUILD_VERSION_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * @typedef {Readonly<{
 *   status: number,
 *   headers: Readonly<Record<string, string>>,
 *   body: unknown,
 *   rawByteCount: number
 * }>} ProviderResponse
 */

/**
 * @typedef {Readonly<{
 *   apiOrigin: string,
 *   owner: string,
 *   repository: string,
 *   token: string,
 *   mode?: string,
 *   pagesBuildVersion?: string,
 *   priorPagesBuildVersion?: string,
 *   fetch?: typeof globalThis.fetch,
 *   requestTemplates: readonly Readonly<Record<string, unknown>>[]
 * }>} RestContext
 */

/**
 * Bind the per-activation identities a call class may statically select.
 *
 * @param {RestContext} context the bound REST context
 * @param {{
 *   mode?: string,
 *   pagesBuildVersion?: string,
 *   priorPagesBuildVersion?: string
 * }} identity the identities this attempt is authorized for
 * @returns {RestContext} a new frozen context
 */
export function bindIdentity(context, identity) {
  return Object.freeze({
    ...context,
    ...(identity.mode === undefined ? {} : { mode: identity.mode }),
    ...(identity.pagesBuildVersion === undefined
      ? {}
      : { pagesBuildVersion: identity.pagesBuildVersion }),
    ...(identity.priorPagesBuildVersion === undefined
      ? {}
      : { priorPagesBuildVersion: identity.priorPagesBuildVersion }),
  });
}

/**
 * Render a catalog template's request target by substituting only the closed
 * placeholder set. An unknown placeholder is a programming error, not a
 * caller-controlled value.
 *
 * @param {string} template the `requestTargetTemplate`
 * @param {Readonly<Record<string, string>>} values placeholder values
 * @returns {string} the rendered request target
 */
export function renderRequestTarget(template, values) {
  return template.replace(/\{([A-Za-z]+)\}/gu, (_match, key) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(
        `PAGES_REQUEST_TARGET_PLACEHOLDER_UNBOUND: ${JSON.stringify(key)} has no value`,
      );
    }
    return encodeURIComponent(value);
  });
}

/**
 * Resolve the `pagesDeploymentId` a row's call class statically selects.
 *
 * @param {RestContext} context the bound REST context
 * @param {Readonly<Record<string, unknown>>} template the resolved template
 * @returns {string | undefined} the selected ID, or `undefined` for a row
 *   whose request target has no `pagesDeploymentId` variable
 */
export function selectDeploymentId(context, template) {
  const source = callClassIdBinding(
    String(template.stage),
    String(template.callClass),
  ).pagesDeploymentIdSource;
  if (source === 'none') {
    return undefined;
  }
  const value =
    source === 'recovery-prior-pages-build-version'
      ? context.priorPagesBuildVersion
      : context.pagesBuildVersion;
  const label =
    source === 'recovery-prior-pages-build-version'
      ? 'pagesRecovery.priorPagesBuildVersion'
      : "the intent's pagesBuildVersion";
  if (typeof value !== 'string' || !BUILD_VERSION_PATTERN.test(value)) {
    throw new Error(
      `PAGES_DEPLOYMENT_ID_SOURCE_UNAVAILABLE: ${String(template.stage)}/${String(template.callClass)} statically selects ${label}, which is absent or not 40 lowercase hex characters`,
    );
  }
  return value;
}

/**
 * Refuse a recovery-prior call outside `pages-reconciliation-recovery` mode.
 *
 * @param {RestContext} context the bound REST context
 * @param {Readonly<Record<string, unknown>>} tmpl the resolved template
 * @returns {void}
 */
export function assertModePermitsCall(context, tmpl) {
  const mode = context.mode ?? NORMAL_MODE;
  const recoveryOnly = callClassIdBinding(
    String(tmpl.stage),
    String(tmpl.callClass),
  ).recoveryOnly;
  if (recoveryOnly && mode !== RECOVERY_MODE) {
    throw new Error(
      `PAGES_RECOVERY_CALL_FORBIDDEN: ${String(tmpl.stage)}/${String(tmpl.callClass)} is admitted only in ${RECOVERY_MODE} mode; ${JSON.stringify(mode)} forbids every recovery-prior call`,
    );
  }
}

/**
 * Build the complete raw header map one cataloged call sends.
 *
 * @param {RestContext} context the bound REST context
 * @param {Readonly<Record<string, unknown>>} tmpl the resolved template
 * @returns {Record<string, string>} the header map, lower-case names
 */
export function buildHeaders(context, tmpl) {
  /** @type {Record<string, string>} */
  const headers = {};
  for (const fixed of /** @type {{name: string, value: string}[]} */ (
    tmpl.fixedHeaders
  )) {
    headers[fixed.name] = fixed.value;
  }
  for (const credential of /** @type {{name: string, prefix: string}[]} */ (
    tmpl.credentialHeaders
  )) {
    headers[credential.name] = `${credential.prefix}${context.token}`;
  }
  return headers;
}

/**
 * Refuse a request that disagrees with the template it claims to implement.
 *
 * @param {Readonly<Record<string, unknown>>} tmpl the resolved template
 * @param {{
 *   method: string,
 *   url: string,
 *   headers: Readonly<Record<string, string>>,
 *   body: string | undefined
 * }} request the request about to be dispatched
 * @returns {void}
 */
export function assertRequestMatchesTemplate(tmpl, request) {
  if (request.method !== tmpl.method) {
    throw new Error(
      `PAGES_REQUEST_DISAGREES_WITH_TEMPLATE: method ${request.method} is not the cataloged ${String(tmpl.method)}`,
    );
  }
  if (!request.url.startsWith(`${String(tmpl.origin)}/`)) {
    throw new Error(
      `PAGES_REQUEST_DISAGREES_WITH_TEMPLATE: the request URL is not on the cataloged origin ${String(tmpl.origin)}`,
    );
  }
  if (new URL(request.url).search !== '') {
    throw new Error(
      'PAGES_REQUEST_DISAGREES_WITH_TEMPLATE: canonicalQueryProfile is "none", so no query component is representable',
    );
  }
  for (const fixed of /** @type {{name: string, value: string}[]} */ (
    tmpl.fixedHeaders
  )) {
    if (request.headers[fixed.name] !== fixed.value) {
      throw new Error(
        `PAGES_REQUEST_DISAGREES_WITH_TEMPLATE: fixed header ${JSON.stringify(fixed.name)} is missing or not the cataloged value`,
      );
    }
  }
  const credentialNames = /** @type {{name: string}[]} */ (
    tmpl.credentialHeaders
  ).map((row) => row.name);
  const fixedNames = /** @type {{name: string}[]} */ (tmpl.fixedHeaders).map(
    (row) => row.name,
  );
  const permitted = new Set([...fixedNames, ...credentialNames]);
  for (const name of Object.keys(request.headers)) {
    if (!permitted.has(name)) {
      throw new Error(
        `PAGES_REQUEST_DISAGREES_WITH_TEMPLATE: header ${JSON.stringify(name)} is not declared by this template`,
      );
    }
  }
  const expectsBody = tmpl.requestBodyProfile !== 'empty';
  if (expectsBody !== (request.body !== undefined)) {
    throw new Error(
      `PAGES_REQUEST_DISAGREES_WITH_TEMPLATE: requestBodyProfile is ${JSON.stringify(String(tmpl.requestBodyProfile))} but the request ${request.body === undefined ? 'has no' : 'has a'} body`,
    );
  }
}

/**
 * Issue one cataloged provider call.
 *
 * @param {RestContext} context the bound REST context
 * @param {string} stage the lifecycle stage issuing the call
 * @param {string} callClass the catalog `callClass` to issue
 * @param {{
 *   bodyText?: string,
 *   acceptStatuses: readonly number[]
 * }} options the call options; `bodyText` is already-canonical JCS text,
 *   because the create body's byte length is contract-visible
 * @returns {Promise<ProviderResponse>} the parsed, bounded response
 */
export async function callProvider(context, stage, callClass, options) {
  const tmpl = requireTemplate(context.requestTemplates, stage, callClass);
  assertModePermitsCall(context, tmpl);
  const pagesDeploymentId = selectDeploymentId(context, tmpl);
  const requestTarget = renderRequestTarget(
    /** @type {string} */ (tmpl.requestTargetTemplate),
    {
      owner: context.owner,
      repository: context.repository,
      ...(pagesDeploymentId === undefined ? {} : { pagesDeploymentId }),
    },
  );
  const maximumTargetBytes = /** @type {number} */ (
    tmpl.maximumRequestTargetBytes
  );
  if (Buffer.byteLength(requestTarget, 'utf8') > maximumTargetBytes) {
    throw new Error(
      `PAGES_REQUEST_TARGET_TOO_LONG: ${requestTarget.length} characters exceed the cataloged ${maximumTargetBytes}-byte ceiling`,
    );
  }

  const headers = buildHeaders(context, tmpl);
  const url = `${context.apiOrigin}${requestTarget}`;
  const method = /** @type {string} */ (tmpl.method);
  assertRequestMatchesTemplate(
    // A fixture binds a local origin; the template equality is checked
    // against the origin this context is actually bound to.
    Object.freeze({ ...tmpl, origin: context.apiOrigin }),
    { method, url, headers, body: options.bodyText },
  );

  const doFetch = context.fetch ?? globalThis.fetch;
  const response = await doFetch(url, {
    method,
    headers,
    redirect: 'error',
    ...(options.bodyText === undefined ? {} : { body: options.bodyText }),
  });

  const rawBody = Buffer.from(await response.arrayBuffer());
  if (rawBody.byteLength > MAXIMUM_RESPONSE_BODY_BYTES) {
    throw new Error(
      `PAGES_RESPONSE_BODY_TOO_LARGE: ${rawBody.byteLength} bytes exceed the ${MAXIMUM_RESPONSE_BODY_BYTES}-byte ceiling`,
    );
  }
  if (!options.acceptStatuses.includes(response.status)) {
    throw new Error(
      `PAGES_PROVIDER_STATUS_UNEXPECTED: ${stage}/${callClass} returned HTTP ${response.status}, expected one of ${options.acceptStatuses.join(', ')}`,
    );
  }

  /** @type {Record<string, string>} */
  const responseHeaders = {};
  response.headers.forEach((value, name) => {
    responseHeaders[name.toLowerCase()] = value;
  });

  return Object.freeze({
    status: response.status,
    headers: Object.freeze(responseHeaders),
    body:
      rawBody.byteLength === 0 ? null : JSON.parse(rawBody.toString('utf8')),
    rawByteCount: rawBody.byteLength,
  });
}

/**
 * Independently construct the suffix-free poll URL for a deployment, rather
 * than reusing a provider-supplied `status_url` (DEC-097 section 6.2: "The
 * actual polling GET is the distinct suffix-free ... target constructed
 * independently from the pre-authorized ID. Equality between those two URLs
 * is forbidden.").
 *
 * @param {RestContext} context the bound REST context
 * @param {string} pagesDeploymentId the deployment identity
 * @param {string} [stage] the stage whose status row is used
 * @returns {string} the canonical poll URL
 */
export function buildPollUrl(context, pagesDeploymentId, stage = 'activate') {
  const tmpl = requireTemplate(
    context.requestTemplates,
    stage,
    'pages-deployment-status',
  );
  return `${context.apiOrigin}${renderRequestTarget(
    /** @type {string} */ (tmpl.requestTargetTemplate),
    {
      owner: context.owner,
      repository: context.repository,
      pagesDeploymentId,
    },
  )}`;
}

/**
 * The exact `status_url` shape a create response is permitted to carry. A
 * response whose `status_url` does not match is retained as evidence with
 * `createResponseStatusUrl` absent rather than trusted. It is never followed
 * and, by construction, never equal to {@link buildPollUrl}'s result.
 *
 * @param {RestContext} context the bound REST context
 * @param {string} pagesDeploymentId the deployment identity
 * @returns {string} the expected `status_url`
 */
export function expectedStatusUrl(context, pagesDeploymentId) {
  return `${buildPollUrl(context, pagesDeploymentId)}/status`;
}
