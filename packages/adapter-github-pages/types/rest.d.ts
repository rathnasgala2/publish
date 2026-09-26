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
export function bindIdentity(context: RestContext, identity: {
    mode?: string;
    pagesBuildVersion?: string;
    priorPagesBuildVersion?: string;
}): RestContext;
/**
 * Render a catalog template's request target by substituting only the closed
 * placeholder set. An unknown placeholder is a programming error, not a
 * caller-controlled value.
 *
 * @param {string} template the `requestTargetTemplate`
 * @param {Readonly<Record<string, string>>} values placeholder values
 * @returns {string} the rendered request target
 */
export function renderRequestTarget(template: string, values: Readonly<Record<string, string>>): string;
/**
 * Resolve the `pagesDeploymentId` a row's call class statically selects.
 *
 * @param {RestContext} context the bound REST context
 * @param {Readonly<Record<string, unknown>>} template the resolved template
 * @returns {string | undefined} the selected ID, or `undefined` for a row
 *   whose request target has no `pagesDeploymentId` variable
 */
export function selectDeploymentId(context: RestContext, template: Readonly<Record<string, unknown>>): string | undefined;
/**
 * Refuse a recovery-prior call outside `pages-reconciliation-recovery` mode.
 *
 * @param {RestContext} context the bound REST context
 * @param {Readonly<Record<string, unknown>>} tmpl the resolved template
 * @returns {void}
 */
export function assertModePermitsCall(context: RestContext, tmpl: Readonly<Record<string, unknown>>): void;
/**
 * Build the complete raw header map one cataloged call sends.
 *
 * @param {RestContext} context the bound REST context
 * @param {Readonly<Record<string, unknown>>} tmpl the resolved template
 * @returns {Record<string, string>} the header map, lower-case names
 */
export function buildHeaders(context: RestContext, tmpl: Readonly<Record<string, unknown>>): Record<string, string>;
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
export function assertRequestMatchesTemplate(tmpl: Readonly<Record<string, unknown>>, request: {
    method: string;
    url: string;
    headers: Readonly<Record<string, string>>;
    body: string | undefined;
}): void;
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
export function callProvider(context: RestContext, stage: string, callClass: string, options: {
    bodyText?: string;
    acceptStatuses: readonly number[];
}): Promise<ProviderResponse>;
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
export function buildPollUrl(context: RestContext, pagesDeploymentId: string, stage?: string): string;
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
export function expectedStatusUrl(context: RestContext, pagesDeploymentId: string): string;
/** Maximum response body this client will read, in bytes. */
export const MAXIMUM_RESPONSE_BODY_BYTES: 1048576;
export type ProviderResponse = Readonly<{
    status: number;
    headers: Readonly<Record<string, string>>;
    body: unknown;
    rawByteCount: number;
}>;
export type RestContext = Readonly<{
    apiOrigin: string;
    owner: string;
    repository: string;
    token: string;
    mode?: string;
    pagesBuildVersion?: string;
    priorPagesBuildVersion?: string;
    fetch?: typeof globalThis.fetch;
    requestTemplates: readonly Readonly<Record<string, unknown>>[];
}>;
