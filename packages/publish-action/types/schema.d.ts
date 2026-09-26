/**
 * Validate one candidate document against a named schema; return it
 * unchanged (never mutated) when valid, throw {@link SchemaValidationError}
 * otherwise.
 *
 * @param {string} schemaId a `urn:gala:schema:*` identifier
 * @param {unknown} document the candidate document
 * @param {string} location a human-readable pointer used in error messages
 * @returns {unknown} the same document, once validated
 */
export function assertValidDocument(schemaId: string, document: unknown, location: string): unknown;
/** A validation failure against one named `urn:gala:schema:*` document. */
export class SchemaValidationError extends Error {
    /**
     * @param {string} schemaId the schema this document failed against
     * @param {string} location a human-readable pointer to the document
     * @param {readonly Record<string, unknown>[]} diagnostics the schema's own diagnostics
     */
    constructor(schemaId: string, location: string, diagnostics: readonly Record<string, unknown>[]);
    schemaId: string;
    location: string;
    /** @type {readonly Record<string, unknown>[]} */
    diagnostics: readonly Record<string, unknown>[];
}
