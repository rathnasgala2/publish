/**
 * Serialize one JSON-compatible value as RFC 8785 JSON Canonicalization
 * Scheme bytes: object keys sorted by UTF-16 code unit, no insignificant
 * whitespace, and no trailing newline.
 *
 * @param {unknown} value schema-valid I-JSON value (object, array, string,
 *   finite number, boolean or null)
 * @returns {string} canonical JSON text
 */
export function canonicalizeJson(value: unknown): string;
/**
 * Compute a domain-separated SHA-256 digest over one canonical value:
 * `SHA256(UTF8(domainSeparator) || JCS(value))`, matching every DEC-097
 * digest construction in this repository's contracts.
 *
 * @param {string} domainSeparator exact domain-separator string, including
 *   its trailing `\0` where the owning decision specifies one
 * @param {unknown} value the value to canonicalize and digest (typically the
 *   record with its own digest field omitted)
 * @returns {string} `sha256:<64 lowercase hex characters>`
 */
export function domainDigest(domainSeparator: string, value: unknown): string;
/**
 * Compute a plain (non-domain-separated) SHA-256 digest over raw bytes.
 *
 * @param {Uint8Array | Buffer} bytes bytes to digest
 * @returns {string} `sha256:<64 lowercase hex characters>`
 */
export function sha256Hex(bytes: Uint8Array | Buffer): string;
/**
 * Test whether a value is a syntactically valid Gala digest string.
 *
 * @param {unknown} value candidate value
 * @returns {boolean} whether it matches `sha256:<64 lowercase hex>`
 */
export function isDigestString(value: unknown): boolean;
