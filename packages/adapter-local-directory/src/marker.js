/**
 * `public-generation-marker:2.0.0` construction and validation, owned by
 * this adapter directly against `@rathnasgala2/schemas` (the same
 * authoritative validator `publish-kernel`'s own `generation-marker.js`
 * uses; this adapter cannot import `publish-kernel` itself, so it validates
 * independently rather than reimplementing the kernel's duty).
 *
 * @module
 */

import { validateGalaDocument } from '@rathnasgala2/schemas';

/** The exact schema identity every marker is validated against. */
export const PUBLIC_GENERATION_MARKER_SCHEMA_ID =
  'urn:gala:schema:public-generation-marker:2.0.0';

/**
 * Build one marker document for a given artifact/generation pair.
 *
 * @param {{artifactId: string, artifactDigest: string, generationId: string}} fields
 *   the marker's three identity fields
 * @returns {Readonly<Record<string, unknown>>} the closed marker record
 */
export function buildGenerationMarker(fields) {
  return Object.freeze({
    schemaId: PUBLIC_GENERATION_MARKER_SCHEMA_ID,
    schemaVersion: '2.0.0',
    artifactId: fields.artifactId,
    artifactDigest: fields.artifactDigest,
    generationId: fields.generationId,
  });
}

/**
 * Validate a candidate marker document against the published schema.
 *
 * @param {unknown} candidate the candidate marker document
 * @returns {{valid: boolean, diagnostics: readonly unknown[]}} the
 *   validation result
 */
export function validateGenerationMarker(candidate) {
  const result = validateGalaDocument(
    PUBLIC_GENERATION_MARKER_SCHEMA_ID,
    candidate,
  );
  return { valid: result.valid, diagnostics: result.diagnostics };
}
