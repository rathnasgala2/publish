/**
 * Compare two rows by their member JCS bytes. DEC-097 section 7:
 * `requestTemplates` is "sorted by member JCS bytes", and the
 * `callClassBinding` rows follow the same order.
 *
 * @param {Readonly<Record<string, unknown>>} left the first row
 * @param {Readonly<Record<string, unknown>>} right the second row
 * @returns {number} the byte-order comparison
 */
export function compareTemplatesByJcsBytes(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): number;
/**
 * Resolve the declared binding row for one `(stage, callClass)` pair.
 *
 * @param {string} stage the lifecycle stage
 * @param {string} callClass the call class
 * @returns {Readonly<{stage: string, callClass: string, pagesDeploymentIdSource: string, recoveryOnly: boolean}>}
 *   the binding row
 */
export function callClassIdBinding(stage: string, callClass: string): Readonly<{
    stage: string;
    callClass: string;
    pagesDeploymentIdSource: string;
    recoveryOnly: boolean;
}>;
/**
 * Build the exact nine-template catalog bound to one API origin.
 *
 * @param {string} [apiOrigin] the canonical `https://` GitHub REST origin;
 *   defaults to the declared {@link GITHUB_API_ORIGIN}
 * @returns {readonly Readonly<Record<string, unknown>>[]} the frozen catalog,
 *   sorted by member JCS bytes
 */
export function buildRequestTemplates(apiOrigin?: string): readonly Readonly<Record<string, unknown>>[];
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
export function requireTemplate(templates: readonly Readonly<Record<string, unknown>>[], stage: string, callClass: string): Readonly<Record<string, unknown>>;
/** The exact request-template profile this adapter declares. */
export const REQUEST_TEMPLATE_PROFILE: "gala-github-pages-http-v2";
/**
 * The single origin every cataloged row targets. DEC-097 section 7: "Every
 * row's origin is exactly `https://api.github.com`". The injectable
 * `apiOrigin` exists only so a fixture can bind the identical code path to a
 * local fake provider; the declared default is these exact bytes.
 */
export const GITHUB_API_ORIGIN: "https://api.github.com";
/**
 * The GitHub REST API version header every call pins. DEC-097 section 7
 * fixes it as the exact bytes below; it is not a free choice.
 */
export const GITHUB_API_VERSION: "2026-03-10";
/**
 * The `pagesDeploymentId` source a row's call class statically selects.
 * `none` means the row's request target has no `pagesDeploymentId` variable.
 */
export const DEPLOYMENT_ID_SOURCES: readonly string[];
/**
 * The request-body profile of the only two rows that carry an entity.
 * DEC-097 section 7: "Only `pages-create-deployment` carries
 * `requestBodyProfile: gala-pages-create-deployment-jcs-v2`".
 */
export const CREATE_BODY_PROFILE: "gala-pages-create-deployment-jcs-v2";
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
export const CALL_CLASS_BINDING: readonly Readonly<{
    stage: string;
    callClass: string;
    pagesDeploymentIdSource: string;
    recoveryOnly: boolean;
}>[];
/**
 * The exact nine `(stage, callClass)` pairs DEC-097 section 7 admits.
 *
 * @type {readonly Readonly<{stage: string, callClass: string}>[]}
 */
export const PAGES_CALL_PLAN: readonly Readonly<{
    stage: string;
    callClass: string;
}>[];
/** The exact closed response-profile catalog this adapter can parse. */
export const RESPONSE_PROFILES: readonly string[];
