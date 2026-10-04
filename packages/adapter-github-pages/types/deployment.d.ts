/**
 * The `pagesBuildVersion`: the workflow run's head commit SHA (`GITHUB_SHA`,
 * the OIDC `sha` claim). GitHub validates `pages_build_version` as a commit
 * of the repository (measured on 2026-10-04: any other 40-hex value, such as
 * a synthetic hash, answers 404), so a synthetic derivation can never deploy.
 * `pagesDeploymentId` must equal it exactly.
 *
 * @param {{headSha?: string | undefined}} projection the run's head commit
 * @returns {string} the 40-character lowercase hexadecimal build version
 */
export function derivePagesBuildVersion(projection: {
    headSha?: string | undefined;
}): string;
/**
 * Refuse a create-body text that is not the exact compact JCS of the three
 * admitted members. Exported so a fixture can prove a duplicated, extra,
 * missing or reordered member is refused without reaching a provider.
 *
 * @param {string} bodyText the serialized request entity
 * @returns {void}
 */
export function assertCanonicalCreateBody(bodyText: string): void;
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
export function buildCreateDeploymentBody(input: {
    pagesArtifactId: string | number;
    pagesBuildVersion: string;
    oidcToken: string;
    githubToken: string;
}): Readonly<{
    bodyText: string;
    byteCount: number;
    artifactId: number;
}>;
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
export function createDeployment(context: import("./rest.js").RestContext, input: {
    pagesArtifactId: string | number;
    pagesBuildVersion: string;
    oidcToken: string;
    oidcExpectation: import("./oidc.js").PagesOidcExpectation;
    stage?: string;
}): Promise<Readonly<Record<string, unknown>>>;
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
export function pollDeployment(context: import("./rest.js").RestContext, pagesDeploymentId: string, options: {
    sleep?: (seconds: number) => Promise<void>;
    budgetSeconds?: number;
    stage?: string;
}): Promise<{
    status: string;
    succeeded: boolean;
    observedStatuses: string[];
    waitedSeconds: number[];
}>;
/** The exact three member names of the create request entity, in JCS order. */
export const CREATE_BODY_MEMBERS: readonly string[];
/** The inclusive upper bound on `artifact_id` (exact JSON/JCS identity). */
export const MAXIMUM_ARTIFACT_ID: 9007199254740991;
