/**
 * @typedef {ReturnType<typeof validateGalaDocument>['diagnostics'][number]} SchemaDiagnostic
 */
/**
 * @typedef {Readonly<{
 *   schemaValid: boolean,
 *   schemaDiagnostics: readonly SchemaDiagnostic[],
 *   exactRowValid: boolean,
 *   findings: readonly import('./errors.js').ProtocolFinding[]
 * }>} CapabilityValidationResult
 */
/**
 * Validate one candidate `adapter-capability:2.0.0` document: first against
 * the published JSON Schema (structural and closed-table validity), then
 * against this package's exact-row table for a human/kernel-readable typed
 * finding on a truthfulness violation.
 *
 * @param {unknown} declaration candidate adapter-capability document
 * @returns {CapabilityValidationResult} combined validation result
 */
export function validateCapabilityDeclaration(declaration: unknown): CapabilityValidationResult;
/**
 * Throw {@link AdapterProtocolError} unless a declaration passes both the
 * schema and the exact-row check.
 *
 * @param {unknown} declaration candidate adapter-capability document
 * @returns {void}
 */
export function assertValidCapabilityDeclaration(declaration: unknown): void;
/**
 * Check a declaration against the exact DEC-097 section 7 admission row for
 * its declared `adapter.adapterId`. Every field this table closes must match
 * exactly; an adapter may not silently emulate a weaker guarantee while
 * declaring a stronger one, nor a stronger one it does not truthfully
 * implement.
 *
 * @param {unknown} declaration candidate adapter-capability document
 * @returns {import('./errors.js').ProtocolFinding[]} empty when the exact
 *   row matches; one finding per mismatched field otherwise
 */
export function checkExactRow(declaration: unknown): import("./errors.js").ProtocolFinding[];
/** The exact schema identity every declaration is validated against. */
export const ADAPTER_CAPABILITY_SCHEMA_ID: "urn:gala:schema:adapter-capability:2.0.0";
export type SchemaDiagnostic = ReturnType<typeof validateGalaDocument>["diagnostics"][number];
export type CapabilityValidationResult = Readonly<{
    schemaValid: boolean;
    schemaDiagnostics: readonly SchemaDiagnostic[];
    exactRowValid: boolean;
    findings: readonly import("./errors.js").ProtocolFinding[];
}>;
import { validateGalaDocument } from '@rathnasgala2/schemas';
