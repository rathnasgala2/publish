/**
 * Test helper: files that start with the signature of each admitted image
 * format and carry a label after it. They are not decodable images; intake
 * only recognizes the format from the first bytes and digests the file (the
 * template's media pipeline is the one that decodes, and is not run here).
 *
 * @module
 */

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

/**
 * A PNG or JPEG whose header states the given size (not a decodable image):
 * what intake reads to judge a podcast cover.
 *
 * @param {'png' | 'jpeg'} format the format
 * @param {number} width the stated width in pixels
 * @param {number} height the stated height in pixels
 * @param {string} [label] text after the header, to tell files apart
 * @returns {Buffer} the file content
 */
export function sizedImageBytes(format, width, height, label = 'cover') {
  if (format === 'png') {
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write('IHDR', 4, 'latin1');
    ihdr.writeUInt32BE(width, 8);
    ihdr.writeUInt32BE(height, 12);
    return Buffer.concat([SIGNATURES.png, ihdr, Buffer.from(label, 'utf8')]);
  }
  const frame = Buffer.alloc(15);
  frame.set([0xff, 0xc0, 0x00, 0x0b, 0x08]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame.set([0x01, 0x01, 0x11, 0x00], 9);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]),
    frame,
    Buffer.from(label, 'utf8'),
  ]);
}
