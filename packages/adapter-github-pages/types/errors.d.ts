/**
 * This adapter's one typed failure class (PUB-H6). Every refusal this
 * package raises -- OIDC verification, the Pages REST catalog, the request
 * catalog, carrier construction, capability declaration, recovery -- used
 * to throw a bare `Error` whose only structure was a `CODE: detail` string
 * a caller had to parse. `PagesAdapterError` carries the same stable `code`
 * as a real property instead, so a consumer can discriminate
 * `error.code === 'PAGES_OIDC_SUBJECT_MISMATCH'` without touching
 * `.message`. `.message` is unchanged (`${code}: ${detail}`) so existing
 * log lines and the credential-hygiene scan keep working exactly as
 * before; `.code` is additive, not a replacement.
 *
 * The closed code vocabulary this class carries is documented in
 * `README.md`.
 *
 * @module
 */
/**
 * A typed failure this adapter raises, carrying a stable `code`
 * alongside the ordinary `Error` message.
 */
export class PagesAdapterError extends Error {
    /**
     * @param {string} code stable, machine-readable failure code
     * @param {string} detail human-readable detail (never a token byte)
     */
    constructor(code: string, detail: string);
    /** @type {string} */
    code: string;
}
