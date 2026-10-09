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
