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
