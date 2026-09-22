/**
 * `public-generation-marker:2.0.0` construction and validation. This is the
 * one small wire document a fully local S2 kernel can construct end to end
 * (it names only `artifactId`, `artifactDigest` and `generationId`); the
 * kernel validates it against the real published schema via
 * `@rathnasgala2/schemas`, the same authoritative validator
 * `adapter-protocol` uses for `adapter-capability:2.0.0`.
 *
 * @module
 */

import { GALA_SCHEMA_IDS, validateGalaDocument } from '@rathnasgala2/schemas';

import { kernelFinding } from './errors.js';

/** The exact schema identity every marker is validated against. */
export const PUBLIC_GENERATION_MARKER_SCHEMA_ID =
  'urn:gala:schema:public-generation-marker:2.0.0';

if (!GALA_SCHEMA_IDS.includes(PUBLIC_GENERATION_MARKER_SCHEMA_ID)) {
  throw new Error(
    `@rathnasgala2/schemas does not register ${PUBLIC_GENERATION_MARKER_SCHEMA_ID}; check the consumed schema package version.`,
  );
}

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
export function buildGenerationMarker(fields) {
  return Object.freeze(
    /** @type {PublicGenerationMarker} */ ({
      schemaId: PUBLIC_GENERATION_MARKER_SCHEMA_ID,
      schemaVersion: '2.0.0',
      artifactId: fields.artifactId,
      artifactDigest: fields.artifactDigest,
      generationId: fields.generationId,
    }),
  );
}

/**
 * Validate a candidate marker against the published `public-generation-
 * marker:2.0.0` schema, returning one typed finding per schema diagnostic.
 *
 * @param {unknown} candidate the candidate marker document
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when the
 *   candidate is schema-valid
 */
export function checkGenerationMarker(candidate) {
  const result = validateGalaDocument(
    PUBLIC_GENERATION_MARKER_SCHEMA_ID,
    candidate,
  );
  if (result.valid) {
    return Object.freeze([]);
  }
  return Object.freeze(
    result.diagnostics.map((diagnostic) =>
      kernelFinding(
        diagnostic.code,
        'ARTIFACT_SAFETY_ERROR',
        diagnostic.rule,
        'Correct the marker so it validates against urn:gala:schema:public-generation-marker:2.0.0.',
        { location: diagnostic.instancePointer },
      ),
    ),
  );
}
