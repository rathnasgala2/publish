/**
 * Decode one canonical unpadded base64url segment.
 *
 * @param {string} segment the segment text
 * @param {string} label the segment name, for the diagnostic
 * @returns {Buffer} the decoded bytes
 */
export function decodeCanonicalBase64Url(segment: string, label: string): Buffer;
/**
 * Parse one JSON object, refusing any duplicate member name at any depth.
 *
 * `JSON.parse` silently keeps the last of two identical member names, which
 * would let a crafted token present one `sub` to a scanner and another to a
 * parser. This scanner rejects that before the value is used.
 *
 * @param {string} text the JSON text
 * @param {string} label the value's name, for the diagnostic
 * @returns {Record<string, unknown>} the parsed object
 */
export function parseDuplicateKeyFreeJsonObject(text: string, label: string): Record<string, unknown>;
/**
 * The two GitHub-supported default-environment subject forms, recomputed
 * from the separately verified identity claims.
 *
 * @param {{
 *   owner: string,
 *   repository: string,
 *   repositoryId: string,
 *   repositoryOwnerId: string
 * }} identity the verified identity claims
 * @returns {{name: string, id: string}} the two admitted subject forms
 */
export function buildSubjectForms(identity: {
    owner: string;
    repository: string;
    repositoryId: string;
    repositoryOwnerId: string;
}): {
    name: string;
    id: string;
};
/**
 * Verify one caller-supplied Pages OIDC JWT against its expected bindings.
 *
 * Performs no network call and no signature verification; see this module's
 * header for why that is correct and where the real trust boundary is.
 *
 * @param {unknown} token the caller-supplied compact JWT
 * @param {PagesOidcExpectation} expected the expected bindings
 * @returns {Readonly<{
 *   profile: string,
 *   subjectForm: 'name' | 'identifier',
 *   issuerSignatureVerified: false,
 *   tokenByteCount: number
 * }>} non-secret evidence about the accepted token
 */
export function verifyPagesOidcToken(token: unknown, expected: PagesOidcExpectation): Readonly<{
    profile: string;
    subjectForm: "name" | "identifier";
    issuerSignatureVerified: false;
    tokenByteCount: number;
}>;
/**
 * Validate one caller-supplied expectation record before it is used.
 *
 * @param {unknown} expected the caller-supplied expectation
 * @returns {PagesOidcExpectation} the validated expectation
 */
export function requireOidcExpectation(expected: unknown): PagesOidcExpectation;
/**
 * The `gala-pages-oidc-v2` credential-source profile: the local, structural
 * binding checks this adapter performs on the Pages OIDC JWT immediately
 * before placing it — and only it — in the create-deployment request body.
 *
 * ## Trust boundary (read this before changing anything here)
 *
 * This adapter **never mints a credential**. The JWT is caller-supplied
 * input: DEC-097 section 7 places the one token acquisition in the Pages
 * environment job, which calls the GitHub-hosted runner URL from
 * `ACTIONS_ID_TOKEN_REQUEST_URL` exactly once with
 * `ACTIONS_ID_TOKEN_REQUEST_TOKEN` (that is what the job's `id-token: write`
 * permission is for), against an origin that must byte-equal one member of
 * the capability-authorized `githubActionsOidcOriginCatalog`.
 *
 * For this in-job, single-use credential the trust boundary is therefore
 * that exact catalog-authorized, DNS/TLS-authenticated runner token endpoint
 * and bearer exchange — **not** anything this module does. GitHub Pages is
 * the relying party that cryptographically validates the JWT when it
 * processes create-deployment. Accordingly this module **deliberately
 * performs no issuer-signature or JWKS verification and makes no discovery,
 * issuer-key or JWKS network call of any kind**; no such unbudgeted request,
 * cache or key-set digest may be inferred from it. The checks below prevent
 * a token minted for another bound context from being forwarded; they are
 * expressly not an independent issuer-authenticity proof, and a stale or
 * signature-substituted token is not a locally authenticated finding — it
 * reaches the disposable Pages relying party, which must reject it before
 * any candidate activation can be derived.
 *
 * ## What is checked
 *
 * Three compact-JWT segments in canonical unpadded base64url; duplicate-key-
 * free JSON object header and payload; and the exact binding claims: issuer,
 * audience `https://github.com/<repository_owner>`, one of the two supported
 * default-environment subject forms with every inserted component recomputed
 * from the separately verified `repository`, `repository_owner`,
 * `repository_id` and `repository_owner_id` claims, `environment`, and the
 * caller-supplied ref/SHA/run id/run attempt/`job_workflow_ref`/
 * `job_workflow_sha` expectations.
 *
 * No error raised here ever contains a token byte.
 *
 * @module
 */
/** The closed credential-source profile this module implements. */
export const PAGES_OIDC_PROFILE: "gala-pages-oidc-v2";
/** The exact required `iss` claim. */
export const PAGES_OIDC_ISSUER: "https://token.actions.githubusercontent.com";
/** The exact required `environment` claim and subject environment segment. */
export const PAGES_OIDC_ENVIRONMENT: "github-pages";
/** Inclusive byte bounds on the compact JWT (DEC-097 section 7). */
export const PAGES_OIDC_MINIMUM_BYTES: 1;
/** Inclusive upper byte bound on the compact JWT. */
export const PAGES_OIDC_MAXIMUM_BYTES: 8000;
export type PagesOidcExpectation = Readonly<{
    owner: string;
    repository: string;
    repositoryId: string | number;
    repositoryOwnerId: string | number;
    ref: string;
    sha: string;
    runId: string | number;
    runAttempt: string | number;
    jobWorkflowRef: string;
    jobWorkflowSha: string;
}>;
