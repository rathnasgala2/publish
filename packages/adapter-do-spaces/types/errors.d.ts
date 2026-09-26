/**
 * This adapter's one typed failure class (PUB-H6). Every refusal this
 * package raises -- SigV4 signing, the S3-compatible request catalog,
 * staging, the control plane, capability declaration, artifact
 * projection -- used to throw a bare `Error` whose only structure was a
 * `CODE: detail` string a caller had to parse. `SpacesAdapterError`
 * carries the same stable `code` as a real property instead, so a
 * consumer can discriminate
 * `error.code === 'SPACES_PROVIDER_STATUS_UNEXPECTED'` without touching
 * `.message`. `.message` is unchanged (`${code}: ${detail}`) so existing
 * log lines and tests that match a code inside the message keep working
 * exactly as before; `.code` is additive, not a replacement.
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
export class SpacesAdapterError extends Error {
    /**
     * @param {string} code stable, machine-readable failure code
     * @param {string} detail human-readable detail (never a credential byte)
     */
    constructor(code: string, detail: string);
    /** @type {string} */
    code: string;
}
