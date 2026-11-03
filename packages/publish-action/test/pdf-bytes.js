/**
 * Test helper: files that start with the PDF signature and carry a label after
 * it. They are not renderable documents; intake only checks the first bytes
 * and digests the file (the template copies the bytes and never parses them).
 *
 * @module
 */

/**
 * @param {string} [label] text after the signature, to tell files apart
 * @returns {Buffer} the file content
 */
export function pdfBytes(label = 'file') {
  return Buffer.from(`%PDF-1.7\n${label}\n%%EOF\n`, 'utf8');
}
