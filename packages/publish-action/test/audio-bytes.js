/**
 * Test helper: files that start with the signature of each admitted audio
 * format and carry a label after it. They are not playable audio; intake only
 * recognizes the format from the first bytes and digests the file (the
 * template copies the bytes and never decodes them).
 *
 * @module
 */

/** @typedef {'mp3-id3' | 'mp3-sync' | 'mp3-sync-mpeg2' | 'mp3-sync-mpeg25' | 'm4a'} AudioFormat */

/** @type {Readonly<Record<AudioFormat, Buffer>>} */
const SIGNATURES = Object.freeze({
  // An ID3v2.4 tag header: "ID3", version 4.0, no flags, a tag of size 0.
  'mp3-id3': Buffer.from([
    0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]),
  // A file with no tag: it opens with an MPEG-1 Layer III frame header.
  'mp3-sync': Buffer.from([0xff, 0xfb, 0x90, 0x64]),
  // The same, as an MPEG-2 Layer III frame (0xFFF3) and an MPEG-2.5 one (0xFFE3).
  'mp3-sync-mpeg2': Buffer.from([0xff, 0xf3, 0x90, 0x64]),
  'mp3-sync-mpeg25': Buffer.from([0xff, 0xe3, 0x90, 0x64]),
  // An ISO base media file: a 24-byte `ftyp` box with the major brand "M4A ".
  m4a: Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypM4A ', 'latin1'),
    Buffer.alloc(4),
    Buffer.from('M4A mp42', 'latin1'),
  ]),
});

/** The media type each format is recognized as. */
export const AUDIO_MEDIA_TYPE_OF = Object.freeze({
  'mp3-id3': 'audio/mpeg',
  'mp3-sync': 'audio/mpeg',
  'mp3-sync-mpeg2': 'audio/mpeg',
  'mp3-sync-mpeg25': 'audio/mpeg',
  m4a: 'audio/mp4',
});

/**
 * @param {AudioFormat} format the format whose signature the file starts with
 * @param {string} [label] text after the signature, to tell files apart
 * @returns {Buffer} the file content
 */
export function audioBytes(format, label = format) {
  return Buffer.concat([SIGNATURES[format], Buffer.from(label, 'utf8')]);
}
