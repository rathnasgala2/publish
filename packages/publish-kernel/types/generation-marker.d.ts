/**
 * @typedef {Readonly<{
 *   schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
 *   schemaVersion: '2.0.0',
 *   artifactId: string,
 *   artifactDigest: string,
 *   generationId: string
 * }>} PublicGenerationMarker
 */
/**
 * Build the marker record for one artifact/generation pair. The kernel
 * never invents `artifactId`, `artifactDigest` or `generationId`; the
 * caller supplies them from the already-frozen artifact identity and the
 * proposed generation identity.
 *
 * @param {{ artifactId: string, artifactDigest: string, generationId: string }} fields
 *   the marker's three identity fields
 * @returns {PublicGenerationMarker} the closed marker record
 */
export function buildGenerationMarker(fields: {
    artifactId: string;
    artifactDigest: string;
    generationId: string;
}): PublicGenerationMarker;
/**
 * Validate a candidate marker against the published `public-generation-
 * marker:2.0.0` schema, returning one typed finding per schema diagnostic.
 *
 * @param {unknown} candidate the candidate marker document
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when the
 *   candidate is schema-valid
 */
export function checkGenerationMarker(candidate: unknown): readonly import("./errors.js").KernelFinding[];
/** The exact schema identity every marker is validated against. */
export const PUBLIC_GENERATION_MARKER_SCHEMA_ID: "urn:gala:schema:public-generation-marker:2.0.0";
export type PublicGenerationMarker = Readonly<{
    schemaId: "urn:gala:schema:public-generation-marker:2.0.0";
    schemaVersion: "2.0.0";
    artifactId: string;
    artifactDigest: string;
    generationId: string;
}>;
