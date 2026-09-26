/**
 * The `public-generation-marker:2.0.0` codec for the Spaces adapter.
 *
 * The marker is this adapter's activation pointer: it is written last, it
 * is the object public verification reads first, and it is the only object
 * whose identity decides which generation the destination is serving. It is
 * validated against `@rathnasgala2/schemas` on the way out and on the way
 * back in, so neither a malformed write nor a tampered read is ever
 * mistaken for a generation claim.
 *
 * @module
 */

import { SpacesAdapterError } from './errors.js';
import { canonicalizeJson } from '@rathnasgala2/adapter-protocol';
import { validateGalaDocument } from '@rathnasgala2/schemas';

/** The exact schema identity every marker is validated against. */
export const MARKER_SCHEMA_ID =
  'urn:gala:schema:public-generation-marker:2.0.0';

/**
 * The media type the marker object is stored and served with. DEC-097
 * section 7 fixes the marker's three object-metadata values exactly, and the
 * charset parameter is part of the fixed value: a bare `application/json`
 * is a different, non-admitted media type.
 */
export const MARKER_MEDIA_TYPE = 'application/json; charset=utf-8';

/**
 * The cache directive the marker object is stored and served with. The
 * marker is the activation pointer: a cached copy is a stale generation
 * claim, so DEC-097 fixes it at `no-store`. It is a *signed* header on the
 * cataloged marker write, because the catalog declares it.
 */
export const MARKER_CACHE_CONTROL = 'no-store';

/**
 * The marker codec. Encoding throws rather than returning an invalid
 * document; decoding returns a typed refusal rather than throwing, because
 * a missing or unreadable marker is an ordinary observation.
 */
export const MARKER = Object.freeze({
  /**
   * @param {{artifactId: string, artifactDigest: string, generationId: string}} identity
   *   the marker's three identity fields
   * @returns {Buffer} the canonical marker bytes
   */
  encode(identity) {
    const document = {
      schemaId: MARKER_SCHEMA_ID,
      schemaVersion: '2.0.0',
      artifactId: identity.artifactId,
      artifactDigest: identity.artifactDigest,
      generationId: identity.generationId,
    };
    const result = validateGalaDocument(MARKER_SCHEMA_ID, document);
    if (!result.valid) {
      throw new SpacesAdapterError(
        `SPACES_MARKER_INVALID`,
        `${JSON.stringify(result.diagnostics)}`,
      );
    }
    // The marker body profile is `spaces-generation-marker-jcs-v2`: the
    // exact intent-bound *compact JCS* bytes, not whatever key order this
    // object literal happens to have.
    return Buffer.from(canonicalizeJson(document), 'utf8');
  },

  /**
   * @param {Buffer} bytes the raw marker bytes
   * @returns {{generationId: string, artifactDigest: string} | {refusal: string}}
   *   the marker identity, or a typed refusal
   */
  decode(bytes) {
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      return { refusal: 'the generation marker is not parseable JSON' };
    }
    const result = validateGalaDocument(MARKER_SCHEMA_ID, parsed);
    if (!result.valid) {
      return {
        refusal: `the generation marker failed schema validation: ${JSON.stringify(result.diagnostics)}`,
      };
    }
    const document = /** @type {Record<string, unknown>} */ (parsed);
    return {
      generationId: String(document.generationId),
      artifactDigest: String(document.artifactDigest),
    };
  },
});
