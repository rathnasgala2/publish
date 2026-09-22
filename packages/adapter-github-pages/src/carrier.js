/**
 * The deterministic Pages carrier codec (slice brief section 2.3: "its
 * deterministic one-member gzip/POSIX.1-1988 ustar bytes"). The carrier is
 * the *only* thing this adapter ever hands the provider, and it is
 * byte-deterministic for a given file set: identical inputs always produce
 * identical carrier bytes, so a lost create response can be recovered
 * without re-deriving a different artifact identity.
 *
 * Determinism comes from fixing every field a tar writer would normally
 * take from the ambient environment: modification time `0`, owner/group id
 * `0`, empty owner/group names, a fixed file mode, no PAX or GNU extension
 * records, entries emitted in ascending UTF-8 path order, and a gzip member
 * written with a zeroed MTIME/OS byte.
 *
 * @module
 */

import { gunzipSync, gzipSync } from 'node:zlib';

const BLOCK_BYTES = 512;
const NAME_FIELD_BYTES = 100;
const PREFIX_FIELD_BYTES = 155;
const FILE_MODE = '0000644';
const USTAR_MAGIC = 'ustar\0' + '00';

/**
 * @typedef {Readonly<{path: string, bytes: Buffer}>} CarrierFile
 */

/**
 * Write one fixed-width, NUL-padded ASCII field into a header block.
 *
 * @param {Buffer} block the 512-byte header block
 * @param {number} offset the field's byte offset
 * @param {number} length the field's byte length
 * @param {string} value the ASCII value (must fit in `length - 1` bytes when
 *   a terminating NUL is required by the caller's field choice)
 * @returns {void}
 */
function writeField(block, offset, length, value) {
  const bytes = Buffer.from(value, 'ascii');
  if (bytes.byteLength > length) {
    throw new RangeError(
      `PAGES_CARRIER_FIELD_OVERFLOW: value of ${bytes.byteLength} bytes does not fit a ${length}-byte ustar field`,
    );
  }
  bytes.copy(block, offset);
}

/**
 * Split one POSIX path into the ustar `prefix`/`name` pair, refusing any
 * path that cannot be represented without a GNU/PAX extension record (which
 * would make the carrier writer-dependent rather than deterministic).
 *
 * @param {string} entryPath the artifact-relative POSIX path
 * @returns {{name: string, prefix: string}} the split fields
 */
export function splitUstarPath(entryPath) {
  const bytes = Buffer.from(entryPath, 'utf8');
  if (bytes.byteLength <= NAME_FIELD_BYTES) {
    return { name: entryPath, prefix: '' };
  }
  const segments = entryPath.split('/');
  for (let cut = 1; cut < segments.length; cut += 1) {
    const prefix = segments.slice(0, cut).join('/');
    const name = segments.slice(cut).join('/');
    if (
      Buffer.byteLength(prefix, 'utf8') <= PREFIX_FIELD_BYTES &&
      Buffer.byteLength(name, 'utf8') <= NAME_FIELD_BYTES
    ) {
      return { name, prefix };
    }
  }
  throw new RangeError(
    `PAGES_CARRIER_PATH_UNREPRESENTABLE: ${JSON.stringify(entryPath)} cannot be written as POSIX.1-1988 ustar without an extension record`,
  );
}

/**
 * Refuse any member path that would not extract inside the carrier root.
 *
 * The carrier is extracted by the provider, not by this process, so the
 * only place an escaping member can be stopped is here, at the point it is
 * written. Only regular-file entries are ever emitted (typeflag `0`): this
 * codec has no link, device or directory entry, so a symlink/hardlink
 * member cannot exist to be followed.
 *
 * @param {string} entryPath the artifact-relative POSIX path
 * @returns {string} the accepted path
 */
export function requireContainedPath(entryPath) {
  const segments = entryPath.split('/');
  if (
    entryPath === '' ||
    entryPath.startsWith('/') ||
    entryPath.includes('\\') ||
    entryPath.includes('\0') ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new RangeError(
      `PAGES_CARRIER_PATH_REFUSED: ${JSON.stringify(entryPath)} is not a contained relative POSIX path; the carrier never emits a member that can extract outside its own root`,
    );
  }
  return entryPath;
}

/**
 * Build one 512-byte ustar header block for a regular file.
 *
 * @param {string} entryPath the artifact-relative POSIX path
 * @param {number} byteLength the member's byte length
 * @returns {Buffer} the header block, with its checksum applied
 */
function buildHeaderBlock(entryPath, byteLength) {
  const block = Buffer.alloc(BLOCK_BYTES);
  const { name, prefix } = splitUstarPath(requireContainedPath(entryPath));

  writeField(block, 0, NAME_FIELD_BYTES, name);
  writeField(block, 100, 8, FILE_MODE);
  writeField(block, 108, 8, '0000000');
  writeField(block, 116, 8, '0000000');
  writeField(block, 124, 12, byteLength.toString(8).padStart(11, '0'));
  writeField(block, 136, 12, '00000000000');
  block.fill(0x20, 148, 156);
  block.write('0', 156, 1, 'ascii');
  writeField(block, 257, 8, USTAR_MAGIC);
  writeField(block, 345, PREFIX_FIELD_BYTES, prefix);

  let checksum = 0;
  for (const byte of block) {
    checksum += byte;
  }
  writeField(block, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return block;
}

/**
 * Encode a complete file set as deterministic one-member gzip/ustar carrier
 * bytes.
 *
 * @param {readonly CarrierFile[]} files the complete artifact file set,
 *   including the reserved public generation marker
 * @returns {Buffer} the carrier bytes
 */
export function encodeCarrier(files) {
  const ordered = [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  /** @type {Buffer[]} */
  const blocks = [];
  for (const file of ordered) {
    blocks.push(buildHeaderBlock(file.path, file.bytes.byteLength));
    blocks.push(file.bytes);
    const remainder = file.bytes.byteLength % BLOCK_BYTES;
    if (remainder !== 0) {
      blocks.push(Buffer.alloc(BLOCK_BYTES - remainder));
    }
  }
  blocks.push(Buffer.alloc(BLOCK_BYTES * 2));

  const gzipped = gzipSync(Buffer.concat(blocks), { level: 9 });
  // Zero the gzip header's MTIME (bytes 4..7) and OS (byte 9) fields, the
  // only two places zlib is permitted to record ambient facts.
  gzipped.writeUInt32LE(0, 4);
  gzipped.writeUInt8(0xff, 9);
  return gzipped;
}

/**
 * Decode carrier bytes back into the exact file set they were built from.
 * The adapter itself never needs this (it only ever writes a carrier); it
 * exists so a caller — the Pages provider, a conformance fixture or a
 * codec golden test — can prove the round trip is lossless.
 *
 * @param {Buffer} carrier the carrier bytes
 * @returns {CarrierFile[]} the decoded file set, in carrier order
 */
export function decodeCarrier(carrier) {
  const tar = gunzipSync(carrier);
  /** @type {CarrierFile[]} */
  const files = [];
  let offset = 0;
  while (offset + BLOCK_BYTES <= tar.byteLength) {
    const header = tar.subarray(offset, offset + BLOCK_BYTES);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = readAsciiField(header, 0, NAME_FIELD_BYTES);
    const prefix = readAsciiField(header, 345, PREFIX_FIELD_BYTES);
    const size = Number.parseInt(
      readAsciiField(header, 124, 12).trim() || '0',
      8,
    );
    offset += BLOCK_BYTES;
    files.push({
      path: prefix === '' ? name : `${prefix}/${name}`,
      bytes: Buffer.from(tar.subarray(offset, offset + size)),
    });
    offset += Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
  }
  return files;
}

/**
 * @param {Buffer} block a header block
 * @param {number} offset field offset
 * @param {number} length field length
 * @returns {string} the field value up to its first NUL
 */
function readAsciiField(block, offset, length) {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}
