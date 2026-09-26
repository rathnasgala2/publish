/** The exact schema identity every marker is validated against. */
export const MARKER_SCHEMA_ID: "urn:gala:schema:public-generation-marker:2.0.0";
/**
 * The media type the marker object is stored and served with. DEC-097
 * section 7 fixes the marker's three object-metadata values exactly, and the
 * charset parameter is part of the fixed value: a bare `application/json`
 * is a different, non-admitted media type.
 */
export const MARKER_MEDIA_TYPE: "application/json; charset=utf-8";
/**
 * The cache directive the marker object is stored and served with. The
 * marker is the activation pointer: a cached copy is a stale generation
 * claim, so DEC-097 fixes it at `no-store`. It is a *signed* header on the
 * cataloged marker write, because the catalog declares it.
 */
export const MARKER_CACHE_CONTROL: "no-store";
/**
 * The marker codec. Encoding throws rather than returning an invalid
 * document; decoding returns a typed refusal rather than throwing, because
 * a missing or unreadable marker is an ordinary observation.
 */
export const MARKER: Readonly<{
    /**
     * @param {{artifactId: string, artifactDigest: string, generationId: string}} identity
     *   the marker's three identity fields
     * @returns {Buffer} the canonical marker bytes
     */
    encode(identity: {
        artifactId: string;
        artifactDigest: string;
        generationId: string;
    }): Buffer;
    /**
     * @param {Buffer} bytes the raw marker bytes
     * @returns {{generationId: string, artifactDigest: string} | {refusal: string}}
     *   the marker identity, or a typed refusal
     */
    decode(bytes: Buffer): {
        generationId: string;
        artifactDigest: string;
    } | {
        refusal: string;
    };
}>;
