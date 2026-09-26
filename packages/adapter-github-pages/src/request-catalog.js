/**
 * The frozen `gala-github-pages-http-v2` provider request-template catalog.
 *
 * DEC-097 section 7 fixes exactly nine `(stage, callClass)` rows for this
 * adapter release's complete call plan. Every provider call this package is
 * ever permitted to make is one of those rows, declared here as data and
 * digested into the adapter's capability declaration
 * (`requestTemplateCatalogDigest`). A call this catalog does not describe
 * cannot be issued: `src/rest.js` resolves its method, origin, request
 * target and every header from this catalog and never from a caller-supplied
 * URL, and a `status_url` parsed out of a create response is retained as
 * evidence but never followed.
 *
 * The only template variables are the closed percent-encoding-free ASCII
 * `owner`/`repository` and `pagesDeploymentId`. The call class — not a
 * provider response and not a workflow value — statically selects which of
 * the two admitted sources that ID comes from: the intent's already reserved
 * 40-lowercase-hex `pagesBuildVersion` for the seven ordinary/current rows,
 * or `pagesRecovery.priorPagesBuildVersion` for the two
 * `pages-recovery-prior-*` rows, which are forbidden outside
 * `pages-reconciliation-recovery` mode.
 *
 * @module
 */

import { PagesAdapterError } from './errors.js';
import { canonicalizeJson } from '@rathnasgala2/adapter-protocol';

/** The exact request-template profile this adapter declares. */
export const REQUEST_TEMPLATE_PROFILE = 'gala-github-pages-http-v2';

/**
 * The single origin every cataloged row targets. DEC-097 section 7: "Every
 * row's origin is exactly `https://api.github.com`". The injectable
 * `apiOrigin` exists only so a fixture can bind the identical code path to a
 * local fake provider; the declared default is these exact bytes.
 */
export const GITHUB_API_ORIGIN = 'https://api.github.com';

/**
 * The GitHub REST API version header every call pins. DEC-097 section 7
 * fixes it as the exact bytes below; it is not a free choice.
 */
export const GITHUB_API_VERSION = '2026-03-10';

/**
 * The `pagesDeploymentId` source a row's call class statically selects.
 * `none` means the row's request target has no `pagesDeploymentId` variable.
 */
export const DEPLOYMENT_ID_SOURCES = Object.freeze([
  'none',
  'intent-pages-build-version',
  'recovery-prior-pages-build-version',
]);

const ACCEPT_HEADER = Object.freeze({
  name: 'accept',
  value: 'application/vnd.github+json',
});
const ACCEPT_ENCODING_HEADER = Object.freeze({
  name: 'accept-encoding',
  value: 'identity',
});
const CONNECTION_HEADER = Object.freeze({ name: 'connection', value: 'close' });
const CONTENT_TYPE_HEADER = Object.freeze({
  name: 'content-type',
  value: 'application/json',
});
const API_VERSION_HEADER = Object.freeze({
  name: 'x-github-api-version',
  value: GITHUB_API_VERSION,
});
const HOST_HEADER = Object.freeze({ name: 'host', source: 'origin-authority' });
const CONTENT_LENGTH_HEADER = Object.freeze({
  name: 'content-length',
  source: 'request-body-byte-count',
});
const INSTALLATION_TOKEN_HEADER = Object.freeze({
  name: 'authorization',
  source: 'github-token',
  prefix: 'Bearer ',
  maximumSourceBytes: 4096,
  maximumRenderedValueBytes: 4103,
});

/** The fixed header rows every bodyless cataloged call sends, name-sorted. */
const BODYLESS_FIXED_HEADERS = Object.freeze([
  ACCEPT_HEADER,
  ACCEPT_ENCODING_HEADER,
  CONNECTION_HEADER,
  API_VERSION_HEADER,
]);

/** The fixed header rows a cataloged call with a body sends, name-sorted. */
const BODY_FIXED_HEADERS = Object.freeze([
  ACCEPT_HEADER,
  ACCEPT_ENCODING_HEADER,
  CONNECTION_HEADER,
  CONTENT_TYPE_HEADER,
  API_VERSION_HEADER,
]);

const SITE_TARGET = '/repos/{owner}/{repository}/pages';
const DEPLOYMENTS_TARGET = '/repos/{owner}/{repository}/pages/deployments';
const STATUS_TARGET =
  '/repos/{owner}/{repository}/pages/deployments/{pagesDeploymentId}';
const CANCEL_TARGET = `${STATUS_TARGET}/cancel`;

/**
 * The request-body profile of the only two rows that carry an entity.
 * DEC-097 section 7: "Only `pages-create-deployment` carries
 * `requestBodyProfile: gala-pages-create-deployment-jcs-v2`".
 */
export const CREATE_BODY_PROFILE = 'gala-pages-create-deployment-jcs-v2';

/**
 * Build one catalog row.
 *
 * @param {{
 *   stage: string,
 *   callClass: string,
 *   method: string,
 *   origin: string,
 *   requestTargetTemplate: string,
 *   maximumRequestTargetBytes: number,
 *   hasBody: boolean,
 *   responseProfile: string
 * }} row the row inputs
 * @returns {Readonly<Record<string, unknown>>} the frozen row
 */
function template(row) {
  return Object.freeze({
    stage: row.stage,
    callClass: row.callClass,
    method: row.method,
    origin: row.origin,
    requestTargetTemplate: row.requestTargetTemplate,
    canonicalQueryProfile: 'none',
    maximumRequestTargetBytes: row.maximumRequestTargetBytes,
    fixedHeaders: row.hasBody ? BODY_FIXED_HEADERS : BODYLESS_FIXED_HEADERS,
    derivedHeaders: row.hasBody
      ? Object.freeze([CONTENT_LENGTH_HEADER, HOST_HEADER])
      : Object.freeze([HOST_HEADER]),
    credentialHeaders: Object.freeze([INSTALLATION_TOKEN_HEADER]),
    requestBodyProfile: row.hasBody ? CREATE_BODY_PROFILE : 'empty',
    responseProfile: row.responseProfile,
  });
}

/**
 * Compare two rows by their member JCS bytes. DEC-097 section 7:
 * `requestTemplates` is "sorted by member JCS bytes", and the
 * `callClassBinding` rows follow the same order.
 *
 * @param {Readonly<Record<string, unknown>>} left the first row
 * @param {Readonly<Record<string, unknown>>} right the second row
 * @returns {number} the byte-order comparison
 */
export function compareTemplatesByJcsBytes(left, right) {
  return Buffer.compare(
    Buffer.from(canonicalizeJson(left), 'utf8'),
    Buffer.from(canonicalizeJson(right), 'utf8'),
  );
}

/**
 * Build one `callClassBinding` row.
 *
 * @param {string} stage the lifecycle stage
 * @param {string} callClass the call class
 * @param {string} pagesDeploymentIdSource the statically selected source
 * @param {boolean} recoveryOnly whether the row is admitted only in
 *   `pages-reconciliation-recovery` mode
 * @returns {Readonly<{stage: string, callClass: string, pagesDeploymentIdSource: string, recoveryOnly: boolean}>}
 *   the frozen row
 */
function binding(stage, callClass, pagesDeploymentIdSource, recoveryOnly) {
  return Object.freeze({
    stage,
    callClass,
    pagesDeploymentIdSource,
    recoveryOnly,
  });
}

/**
 * The declared `callClassBinding` rows (`adapter-capability` 2.8.0,
 * LOCAL-52 (2)): for every `(stage, callClass)` pair of the nine-row
 * catalog, the `pagesDeploymentId` source its call class statically selects
 * and whether the row is admitted only in `pages-reconciliation-recovery`
 * mode.
 *
 * These two facts are contract-normative but cannot be members of the
 * template rows themselves: `providerRequestTemplate` is closed with
 * `additionalProperties: false`. Until schema 2.8.0 they lived here as an
 * undeclared side table; they are now declared in the capability document
 * under `limits.callClassBinding`, bound by their own
 * `callClassBindingDigest` under `GALA-PROVIDER-CALL-CLASS-BINDING-V2\0`,
 * and enforced in `rest.js`. The template catalog and its
 * `requestTemplateCatalogDigest` are byte-identical to before.
 *
 * Sorted by member JCS bytes, like the template rows.
 *
 * @type {readonly Readonly<{stage: string, callClass: string, pagesDeploymentIdSource: string, recoveryOnly: boolean}>[]}
 */
export const CALL_CLASS_BINDING = Object.freeze(
  [
    binding('inspect', 'pages-site', 'none', false),
    binding('activate', 'pages-create-deployment', 'none', false),
    binding(
      'activate',
      'pages-deployment-status',
      'intent-pages-build-version',
      false,
    ),
    binding(
      'observe',
      'pages-deployment-status',
      'intent-pages-build-version',
      false,
    ),
    binding(
      'inspect',
      'pages-recovery-prior-status',
      'recovery-prior-pages-build-version',
      true,
    ),
    binding(
      'cleanup-staged',
      'pages-cancel-deployment',
      'intent-pages-build-version',
      false,
    ),
    binding(
      'cleanup-staged',
      'pages-recovery-prior-cancel',
      'recovery-prior-pages-build-version',
      true,
    ),
    binding('rollback', 'pages-create-deployment', 'none', false),
    binding(
      'rollback',
      'pages-deployment-status',
      'intent-pages-build-version',
      false,
    ),
  ].sort(compareTemplatesByJcsBytes),
);

/**
 * Resolve the declared binding row for one `(stage, callClass)` pair.
 *
 * @param {string} stage the lifecycle stage
 * @param {string} callClass the call class
 * @returns {Readonly<{stage: string, callClass: string, pagesDeploymentIdSource: string, recoveryOnly: boolean}>}
 *   the binding row
 */
export function callClassIdBinding(stage, callClass) {
  const row = CALL_CLASS_BINDING.find(
    (entry) => entry.stage === stage && entry.callClass === callClass,
  );
  if (row === undefined) {
    throw new PagesAdapterError(
      `PAGES_CALL_NOT_IN_CATALOG`,
      `(${JSON.stringify(stage)}, ${JSON.stringify(callClass)}) has no declared callClassBinding row`,
    );
  }
  return row;
}

/**
 * Build the exact nine-template catalog bound to one API origin.
 *
 * @param {string} [apiOrigin] the canonical `https://` GitHub REST origin;
 *   defaults to the declared {@link GITHUB_API_ORIGIN}
 * @returns {readonly Readonly<Record<string, unknown>>[]} the frozen catalog,
 *   sorted by member JCS bytes
 */
export function buildRequestTemplates(apiOrigin = GITHUB_API_ORIGIN) {
  const origin = apiOrigin;
  const rows = [
    template({
      stage: 'inspect',
      callClass: 'pages-site',
      method: 'GET',
      origin,
      requestTargetTemplate: SITE_TARGET,
      maximumRequestTargetBytes: 512,
      hasBody: false,
      responseProfile: 'pages-site-json-v2',
    }),
    template({
      stage: 'activate',
      callClass: 'pages-create-deployment',
      method: 'POST',
      origin,
      requestTargetTemplate: DEPLOYMENTS_TARGET,
      maximumRequestTargetBytes: 512,
      hasBody: true,
      responseProfile: 'pages-create-deployment-json-v2',
    }),
    template({
      stage: 'activate',
      callClass: 'pages-deployment-status',
      method: 'GET',
      origin,
      requestTargetTemplate: STATUS_TARGET,
      maximumRequestTargetBytes: 640,
      hasBody: false,
      responseProfile: 'pages-deployment-status-json-v2',
    }),
    template({
      stage: 'observe',
      callClass: 'pages-deployment-status',
      method: 'GET',
      origin,
      requestTargetTemplate: STATUS_TARGET,
      maximumRequestTargetBytes: 640,
      hasBody: false,
      responseProfile: 'pages-deployment-status-json-v2',
    }),
    template({
      stage: 'inspect',
      callClass: 'pages-recovery-prior-status',
      method: 'GET',
      origin,
      requestTargetTemplate: STATUS_TARGET,
      maximumRequestTargetBytes: 640,
      hasBody: false,
      responseProfile: 'pages-deployment-status-json-v2',
    }),
    template({
      stage: 'cleanup-staged',
      callClass: 'pages-cancel-deployment',
      method: 'POST',
      origin,
      requestTargetTemplate: CANCEL_TARGET,
      maximumRequestTargetBytes: 704,
      hasBody: false,
      responseProfile: 'pages-cancel-empty-v2',
    }),
    template({
      stage: 'cleanup-staged',
      callClass: 'pages-recovery-prior-cancel',
      method: 'POST',
      origin,
      requestTargetTemplate: CANCEL_TARGET,
      maximumRequestTargetBytes: 704,
      hasBody: false,
      responseProfile: 'pages-cancel-empty-v2',
    }),
    template({
      stage: 'rollback',
      callClass: 'pages-create-deployment',
      method: 'POST',
      origin,
      requestTargetTemplate: DEPLOYMENTS_TARGET,
      maximumRequestTargetBytes: 512,
      hasBody: true,
      responseProfile: 'pages-create-deployment-json-v2',
    }),
    template({
      stage: 'rollback',
      callClass: 'pages-deployment-status',
      method: 'GET',
      origin,
      requestTargetTemplate: STATUS_TARGET,
      maximumRequestTargetBytes: 640,
      hasBody: false,
      responseProfile: 'pages-deployment-status-json-v2',
    }),
  ];
  rows.sort(compareTemplatesByJcsBytes);
  return Object.freeze(rows);
}

/**
 * The exact nine `(stage, callClass)` pairs DEC-097 section 7 admits.
 *
 * @type {readonly Readonly<{stage: string, callClass: string}>[]}
 */
export const PAGES_CALL_PLAN = Object.freeze(
  buildRequestTemplates().map((row) =>
    Object.freeze({
      stage: /** @type {string} */ (row.stage),
      callClass: /** @type {string} */ (row.callClass),
    }),
  ),
);

/**
 * Resolve one template by its `(stage, callClass)` pair. The same call class
 * appears under several stages, so the pair — never the call class alone —
 * is the catalog key.
 *
 * @param {readonly Readonly<Record<string, unknown>>[]} templates the catalog
 * @param {string} stage the lifecycle stage issuing the call
 * @param {string} callClass the call class to resolve
 * @returns {Readonly<Record<string, unknown>>} the template
 */
export function requireTemplate(templates, stage, callClass) {
  const found = templates.find(
    (entry) => entry.stage === stage && entry.callClass === callClass,
  );
  if (found === undefined) {
    throw new PagesAdapterError(
      `PAGES_CALL_NOT_IN_CATALOG`,
      `(${JSON.stringify(stage)}, ${JSON.stringify(callClass)}) is not one of the nine admitted github-pages REST calls`,
    );
  }
  return found;
}

/** The exact closed response-profile catalog this adapter can parse. */
export const RESPONSE_PROFILES = Object.freeze([
  'pages-cancel-empty-v2',
  'pages-create-deployment-json-v2',
  'pages-deployment-status-json-v2',
  'pages-site-json-v2',
]);
