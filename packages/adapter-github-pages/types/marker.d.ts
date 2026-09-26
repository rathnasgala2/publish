/**
 * Build one schema-valid marker, throwing rather than returning an invalid
 * document: an invalid marker must never reach a carrier.
 *
 * @param {{artifactId: string, artifactDigest: string, generationId: string}} identity
 *   the marker's three identity fields
 * @returns {Readonly<Record<string, unknown>>} the validated marker
 */
export function buildValidatedMarker(identity: {
    artifactId: string;
    artifactDigest: string;
    generationId: string;
}): Readonly<Record<string, unknown>>;
/**
 * Parse and validate marker bytes read back from the public origin.
 *
 * @param {Buffer} bytes the raw marker bytes
 * @returns {{marker: Record<string, unknown> | null, findings: string[]}} the
 *   parsed marker, or `null` with one finding explaining why it was refused
 */
export function parsePublicMarker(bytes: Buffer): {
    marker: Record<string, unknown> | null;
    findings: string[];
};
/** The exact schema identity every marker is validated against. */
export const MARKER_SCHEMA_ID: "urn:gala:schema:public-generation-marker:2.0.0";
