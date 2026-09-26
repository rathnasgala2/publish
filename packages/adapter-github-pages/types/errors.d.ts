/**
 * This adapter's one typed failure class (PUB-H6). Every refusal this
 * package raises -- OIDC verification, the Pages REST catalog, the request
 * catalog, carrier construction, capability declaration, recovery --
 * throws `PagesAdapterError`, which carries a stable `code` as a real
 * property so a consumer can discriminate
 * `error.code === 'PAGES_OIDC_SUBJECT_MISMATCH'` without parsing
 * `.message`. `.message` is `${code}: ${detail}`, so a log line or the
 * credential-hygiene scan still matches a code inside the message.
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
