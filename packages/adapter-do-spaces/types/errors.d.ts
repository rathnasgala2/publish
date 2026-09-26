/**
 * This adapter's one typed failure class (PUB-H6). Every refusal this
 * package raises -- SigV4 signing, the S3-compatible request catalog,
 * staging, the control plane, capability declaration, artifact
 * projection -- throws `SpacesAdapterError`, which carries a stable
 * `code` as a real property so a consumer can discriminate
 * `error.code === 'SPACES_PROVIDER_STATUS_UNEXPECTED'` without parsing
 * `.message`. `.message` is `${code}: ${detail}`, so a log line or a test
 * matching a code inside the message still works.
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
