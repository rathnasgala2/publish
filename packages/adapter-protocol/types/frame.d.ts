/**
 * Encode one in-process protocol message as a length-prefixed frame,
 * enforcing the DEC-086 ceiling before any allocation beyond the encoded
 * body itself.
 *
 * @param {unknown} message schema-valid I-JSON message value
 * @returns {Buffer} the 4-byte big-endian length prefix followed by the
 *   exact UTF-8 JSON body
 */
export function encodeFrame(message: unknown): Buffer;
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
export function decodeFrame(buffer: Buffer): DecodedFrame;
/**
 * Decode every complete frame coalesced in a buffer, rejecting any trailing
 * bytes that do not form another complete bounded frame.
 *
 * @param {Buffer} buffer bytes holding zero or more complete frames
 * @returns {unknown[]} the decoded messages, in order
 */
export function decodeFrames(buffer: Buffer): unknown[];
/** Exact DEC-086 frame ceiling, in bytes, of the complete UTF-8 JSON body. */
export const FRAME_CEILING_BYTES: 1048576;
/** Byte width of the unsigned big-endian length prefix DEC-086 fixes. */
export const FRAME_LENGTH_PREFIX_BYTES: 4;
export type DecodedFrame = Readonly<{
    message: unknown;
    byteLength: number;
    remainder: Buffer;
}>;
