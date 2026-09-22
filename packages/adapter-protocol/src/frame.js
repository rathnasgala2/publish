/**
 * The in-process adapter message contract and its DEC-086 frame ceiling.
 *
 * S2 adapters are in-process ESM modules (DEC-097 section 1, product-owner
 * override): the kernel calls an adapter's lifecycle functions directly, in
 * the same process, with plain JavaScript values. No process boundary, pipe
 * or socket carries an adapter message in S2, and this module implements no
 * such transport — the out-of-process framed protocol
 * (`adapter-message:2.0.0`) is explicitly deferred (DEC-097 section 1) and
 * forbidden in this task.
 *
 * What DEC-086 fixes is not a transport but a size discipline: "the v2
 * adapter protocol accepts an unsigned-big-endian 32-bit length prefix but
 * imposes an exact ... frame ceiling of 1,048,576 bytes. The ceiling applies
 * to the complete UTF-8 JSON frame bytes after encoding and before parsing."
 * This module gives the in-process kernel/adapter boundary the same
 * discipline today, so a request or response message can never silently grow
 * into something the future out-of-process transport could not carry, and so
 * that boundary is exercised by tests before any process boundary exists.
 * Artifact and content bytes never travel through this contract; only
 * bounded identities, capability declarations, operation metadata and
 * evidence digests do (DEC-086).
 *
 * @module
 */

import { AdapterProtocolError, finding } from './errors.js';

/** Exact DEC-086 frame ceiling, in bytes, of the complete UTF-8 JSON body. */
export const FRAME_CEILING_BYTES = 1_048_576;

/** Byte width of the unsigned big-endian length prefix DEC-086 fixes. */
export const FRAME_LENGTH_PREFIX_BYTES = 4;

/**
 * Encode one in-process protocol message as a length-prefixed frame,
 * enforcing the DEC-086 ceiling before any allocation beyond the encoded
 * body itself.
 *
 * @param {unknown} message schema-valid I-JSON message value
 * @returns {Buffer} the 4-byte big-endian length prefix followed by the
 *   exact UTF-8 JSON body
 */
export function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.byteLength === 0) {
    throw new AdapterProtocolError('Adapter protocol frame body is empty', [
      finding(
        'ADAPTER_FRAME_EMPTY',
        'ARTIFACT_SAFETY_ERROR',
        'A protocol frame must carry at least one byte of UTF-8 JSON.',
      ),
    ]);
  }
  if (body.byteLength > FRAME_CEILING_BYTES) {
    throw new AdapterProtocolError(
      `Adapter protocol frame body exceeds the ${FRAME_CEILING_BYTES}-byte DEC-086 ceiling`,
      [
        finding(
          'ADAPTER_FRAME_TOO_LARGE',
          'ARTIFACT_SAFETY_ERROR',
          `Frame body is ${body.byteLength} bytes; the DEC-086 ceiling is ${FRAME_CEILING_BYTES} bytes.`,
          { evidence: { byteLength: body.byteLength } },
        ),
      ],
    );
  }
  const prefix = Buffer.alloc(FRAME_LENGTH_PREFIX_BYTES);
  prefix.writeUInt32BE(body.byteLength, 0);
  return Buffer.concat([prefix, body]);
}

/**
 * @typedef {Readonly<{ message: unknown, byteLength: number, remainder: Buffer }>} DecodedFrame
 */

/**
 * Decode exactly one length-prefixed frame from the head of a buffer,
 * enforcing the ceiling on the *declared* length before trusting it for any
 * allocation or slice, and rejecting a truncated, oversized, zero-length or
 * invalid-UTF-8 frame.
 *
 * @param {Buffer} buffer bytes beginning with one complete or partial frame
 * @returns {DecodedFrame} the decoded message, its declared byte length, and
 *   any bytes after this frame
 */
export function decodeFrame(buffer) {
  if (buffer.byteLength < FRAME_LENGTH_PREFIX_BYTES) {
    throw new AdapterProtocolError(
      'Adapter protocol frame is truncated before its length prefix',
      [
        finding(
          'ADAPTER_FRAME_TRUNCATED',
          'ARTIFACT_SAFETY_ERROR',
          `Buffer has ${buffer.byteLength} byte(s); a frame needs at least ${FRAME_LENGTH_PREFIX_BYTES}.`,
        ),
      ],
    );
  }
  const declaredLength = buffer.readUInt32BE(0);
  if (declaredLength === 0) {
    throw new AdapterProtocolError('Adapter protocol frame is empty', [
      finding(
        'ADAPTER_FRAME_EMPTY',
        'ARTIFACT_SAFETY_ERROR',
        'A protocol frame must declare a positive body length.',
      ),
    ]);
  }
  if (declaredLength > FRAME_CEILING_BYTES) {
    throw new AdapterProtocolError(
      `Adapter protocol frame declares a length above the ${FRAME_CEILING_BYTES}-byte DEC-086 ceiling`,
      [
        finding(
          'ADAPTER_FRAME_TOO_LARGE',
          'ARTIFACT_SAFETY_ERROR',
          `Declared length ${declaredLength} exceeds the DEC-086 ceiling of ${FRAME_CEILING_BYTES} bytes.`,
          { evidence: { declaredLength } },
        ),
      ],
    );
  }
  const available = buffer.byteLength - FRAME_LENGTH_PREFIX_BYTES;
  if (available < declaredLength) {
    throw new AdapterProtocolError(
      'Adapter protocol frame is truncated before its declared length',
      [
        finding(
          'ADAPTER_FRAME_TRUNCATED',
          'ARTIFACT_SAFETY_ERROR',
          `Declared length ${declaredLength} but only ${available} byte(s) are available.`,
          { evidence: { declaredLength, available } },
        ),
      ],
    );
  }
  const body = buffer.subarray(
    FRAME_LENGTH_PREFIX_BYTES,
    FRAME_LENGTH_PREFIX_BYTES + declaredLength,
  );
  const text = decodeStrictUtf8(body);
  /** @type {unknown} */
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    throw new AdapterProtocolError(
      'Adapter protocol frame body is not valid JSON',
      [
        finding(
          'ADAPTER_FRAME_INVALID_JSON',
          'ARTIFACT_SAFETY_ERROR',
          'Frame body decoded as UTF-8 but did not parse as JSON.',
        ),
      ],
    );
  }
  return Object.freeze({
    message,
    byteLength: declaredLength,
    remainder: buffer.subarray(FRAME_LENGTH_PREFIX_BYTES + declaredLength),
  });
}

/**
 * Decode every complete frame coalesced in a buffer, rejecting any trailing
 * bytes that do not form another complete bounded frame.
 *
 * @param {Buffer} buffer bytes holding zero or more complete frames
 * @returns {unknown[]} the decoded messages, in order
 */
export function decodeFrames(buffer) {
  /** @type {unknown[]} */
  const messages = [];
  let remaining = buffer;
  while (remaining.byteLength > 0) {
    const decoded = decodeFrame(remaining);
    messages.push(decoded.message);
    remaining = decoded.remainder;
  }
  return messages;
}

/**
 * Decode bytes as strict UTF-8, rejecting any invalid sequence rather than
 * silently substituting the Unicode replacement character.
 *
 * @param {Buffer} bytes candidate UTF-8 bytes
 * @returns {string} decoded text
 */
function decodeStrictUtf8(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    return decoder.decode(bytes);
  } catch {
    throw new AdapterProtocolError(
      'Adapter protocol frame body is not valid UTF-8',
      [
        finding(
          'ADAPTER_FRAME_INVALID_UTF8',
          'ARTIFACT_SAFETY_ERROR',
          'Frame body bytes did not decode as strict UTF-8.',
        ),
      ],
    );
  }
}
