/**
 * `public-generation-marker:2.0.0` construction and validation for the
 * managed Pages adapter. The marker root carries only the universal
 * `schemaId`/`schemaVersion` plus `artifactId`, `artifactDigest` and
 * `generationId` — no publication, repository, provider, timestamp,
 * manifest digest, credential or self-digest (brief section 5) — and is
 * validated against `@rathnasgala2/schemas`, the authoritative validator,
 * rather than checked by hand.
 *
 * @module
 */

import { PagesAdapterError } from './errors.js';
import { validateGalaDocument } from '@rathnasgala2/schemas';

/** The exact schema identity every marker is validated against. */
export const MARKER_SCHEMA_ID =
  'urn:gala:schema:public-generation-marker:2.0.0';

/**
 * Build one schema-valid marker, throwing rather than returning an invalid
 * document: an invalid marker must never reach a carrier.
 *
 * @param {{artifactId: string, artifactDigest: string, generationId: string}} identity
 *   the marker's three identity fields
 * @returns {Readonly<Record<string, unknown>>} the validated marker
 */
export function buildValidatedMarker(identity) {
  const marker = Object.freeze({
    schemaId: MARKER_SCHEMA_ID,
    schemaVersion: '2.0.0',
    artifactId: identity.artifactId,
    artifactDigest: identity.artifactDigest,
    generationId: identity.generationId,
  });
  const validation = validateGalaDocument(MARKER_SCHEMA_ID, marker);
  if (!validation.valid) {
    throw new PagesAdapterError(
      `PAGES_MARKER_INVALID`,
      `${JSON.stringify(validation.diagnostics)}`,
    );
  }
  return marker;
}

/**
 * Parse and validate marker bytes read back from the public origin.
 *
 * @param {Buffer} bytes the raw marker bytes
 * @returns {{marker: Record<string, unknown> | null, findings: string[]}} the
 *   parsed marker, or `null` with one finding explaining why it was refused
 */
export function parsePublicMarker(bytes) {
  /** @type {string[]} */
  const findings = [];
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    findings.push('public generation marker is not parseable JSON');
    return { marker: null, findings };
  }
  const validation = validateGalaDocument(MARKER_SCHEMA_ID, parsed);
  if (!validation.valid) {
    findings.push(
      `public generation marker failed schema validation: ${JSON.stringify(validation.diagnostics)}`,
    );
    return { marker: null, findings };
  }
  return {
    marker: /** @type {Record<string, unknown>} */ (parsed),
    findings,
  };
}
