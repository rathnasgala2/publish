/**
 * Test helper: files that start with the signature of each admitted image
 * format and carry a label after it. They are not decodable images; intake
 * only recognizes the format from the first bytes and digests the file (the
 * template's media pipeline is the one that decodes, and is not run here).
 *
 * @module
 */

import { crc32, deflateSync } from 'node:zlib';

/** @typedef {'png' | 'jpeg' | 'webp' | 'avif' | 'gif'} ImageFormat */

/** @type {Readonly<Record<ImageFormat, Buffer>>} */
const SIGNATURES = Object.freeze({
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  webp: Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'latin1'),
  ]),
  avif: Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif', 'latin1')]),
  gif: Buffer.from('GIF89a', 'latin1'),
});

/** The media type each format is recognized as. */
export const MEDIA_TYPE_OF = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
});

/**
 * @param {ImageFormat} format the format whose signature the file starts with
 * @param {string} [label] text after the signature, to tell files apart
 * @returns {Buffer} the file content
 */
export function imageBytes(format, label = format) {
  return Buffer.concat([SIGNATURES[format], Buffer.from(label, 'utf8')]);
}

const PNG_SIGNATURE = SIGNATURES.png;

/**
 * One PNG chunk, with its length and CRC.
 *
 * @param {string} type the four-letter chunk type
 * @param {Buffer} data the chunk data
 * @returns {Buffer} the chunk
 */
export function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A PNG with the given header fields and well-formed chunks to IEND. Its
 * pixel data is one deflated run of zero bytes of the length the template's
 * decoder expects for an 8-bit, non-interlaced image.
 *
 * @param {object} options the file
 * @param {number} options.width the stated width
 * @param {number} options.height the stated height
 * @param {number} [options.bitDepth] default 8
 * @param {number} [options.colorType] default 2 (truecolor)
 * @param {number} [options.interlace] default 0
 * @param {string} [options.label] text kept in a `tEXt` chunk, to tell files apart
 * @param {boolean} [options.palette] add a `PLTE` chunk (colour type 3)
 * @param {boolean} [options.idat] default true
 * @returns {Buffer} the file content
 */
export function pngBytes({
  width,
  height,
  bitDepth = 8,
  colorType = 2,
  interlace = 0,
  label = 'cover',
  palette = false,
  idat = true,
}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([bitDepth, colorType, 0, 0, interlace], 8);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] ?? 1;
  const raw = Buffer.alloc(height * (1 + width * channels));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from(`Comment\0${label}`, 'latin1')),
    ...(palette ? [pngChunk('PLTE', Buffer.alloc(3))] : []),
    ...(idat ? [pngChunk('IDAT', deflateSync(raw))] : []),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * One JPEG marker segment (marker, length, payload).
 *
 * @param {number} marker the second marker byte
 * @param {Buffer} payload the bytes after the length field
 * @returns {Buffer} the segment
 */
export function jpegSegment(marker, payload) {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/**
 * A start-of-frame payload.
 *
 * @param {number} width the stated width
 * @param {number} height the stated height
 * @param {number} components the component count
 * @returns {Buffer} the payload
 */
export function jpegFramePayload(width, height, components = 3) {
  const payload = Buffer.alloc(6 + 3 * components);
  payload[0] = 8;
  payload.writeUInt16BE(height, 1);
  payload.writeUInt16BE(width, 3);
  payload[5] = components;
  for (let index = 0; index < components; index += 1) {
    payload.set([index + 1, 0x11, 0], 6 + 3 * index);
  }
  return payload;
}

/** A one-scan start-of-scan segment followed by entropy-coded bytes. */
export const JPEG_SCAN = Buffer.concat([
  jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
  Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
]);

/**
 * A JPEG with well-formed marker segments: SOI, JFIF, a start-of-frame, one
 * scan, EOI. Not a decodable picture.
 *
 * @param {object} options the file
 * @param {number} options.width the stated width
 * @param {number} options.height the stated height
 * @param {number} [options.sof] the start-of-frame marker byte, default 0xc0
 * @param {number} [options.components] default 3
 * @param {boolean} [options.adobe] add an Adobe APP14 segment
 * @param {string} [options.label] a comment, to tell files apart
 * @returns {Buffer} the file content
 */
export function jpegBytes({
  width,
  height,
  sof = 0xc0,
  components = 3,
  adobe = false,
  label = 'cover',
}) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(
      0xe0,
      Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'),
    ),
    ...(adobe
      ? [jpegSegment(0xee, Buffer.from('Adobe\0\0\0\0\0\0\0\0\0', 'latin1'))]
      : []),
    jpegSegment(0xfe, Buffer.from(label, 'utf8')),
    jpegSegment(sof, jpegFramePayload(width, height, components)),
    JPEG_SCAN,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/**
 * A PNG or JPEG whose header states the given size and whose structure is
 * well formed: what intake reads to judge a podcast cover.
 *
 * @param {'png' | 'jpeg'} format the format
 * @param {number} width the stated width in pixels
 * @param {number} height the stated height in pixels
 * @param {string} [label] text kept in the file, to tell files apart
 * @returns {Buffer} the file content
 */
export function sizedImageBytes(format, width, height, label = 'cover') {
  return format === 'png'
    ? pngBytes({ width, height, label })
    : jpegBytes({ width, height, label });
}
