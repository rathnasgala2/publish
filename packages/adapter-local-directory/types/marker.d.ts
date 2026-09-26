/**
 * Build one marker document for a given artifact/generation pair.
 *
 * @param {{artifactId: string, artifactDigest: string, generationId: string}} fields
 *   the marker's three identity fields
 * @returns {Readonly<Record<string, unknown>>} the closed marker record
 */
export function buildGenerationMarker(fields: {
    artifactId: string;
    artifactDigest: string;
    generationId: string;
}): Readonly<Record<string, unknown>>;
/**
 * Validate a candidate marker document against the published schema.
 *
 * @param {unknown} candidate the candidate marker document
 * @returns {{valid: boolean, diagnostics: readonly unknown[]}} the
 *   validation result
 */
export function validateGenerationMarker(candidate: unknown): {
    valid: boolean;
    diagnostics: readonly unknown[];
};
/** The exact schema identity every marker is validated against. */
export const PUBLIC_GENERATION_MARKER_SCHEMA_ID: "urn:gala:schema:public-generation-marker:2.0.0";
