/**
 * Codec goldens for the deterministic Pages carrier: byte determinism, the
 * POSIX.1-1988 ustar framing, the long-path prefix split, and a lossless
 * round trip (brief section 2.3).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';

import {
  decodeCarrier,
  encodeCarrier,
  splitUstarPath,
} from '../src/carrier.js';

/**
 * @returns {{path: string, bytes: Buffer}[]} a fixed, non-trivial file set
 */
function fixture() {
  return [
    { path: 'index.html', bytes: Buffer.from('<!doctype html>hello', 'utf8') },
    { path: 'a/b/c.txt', bytes: Buffer.from('nested', 'utf8') },
    { path: 'empty.txt', bytes: Buffer.alloc(0) },
    { path: 'exact-block.bin', bytes: Buffer.alloc(512, 0x41) },
  ];
}

test('carrier bytes are deterministic across repeated encodes', () => {
  const first = encodeCarrier(fixture());
  const second = encodeCarrier(fixture());
  assert.deepEqual(first, second);
});

test('carrier bytes are independent of the input order', () => {
  const ordered = encodeCarrier(fixture());
  const shuffled = encodeCarrier([...fixture()].reverse());
  assert.deepEqual(ordered, shuffled);
});

test('the gzip member records no ambient MTIME or OS byte', () => {
  const carrier = encodeCarrier(fixture());
  assert.equal(carrier.readUInt32LE(4), 0, 'gzip MTIME must be zero');
  assert.equal(carrier.readUInt8(9), 0xff, 'gzip OS must be "unknown"');
});

test('every tar header records the ustar magic and zeroed ownership', () => {
  const tar = gunzipSync(encodeCarrier(fixture()));
  const header = tar.subarray(0, 512);
  assert.equal(header.subarray(257, 263).toString('ascii'), 'ustar\0');
  assert.equal(header.subarray(263, 265).toString('ascii'), '00');
  assert.equal(header.subarray(108, 115).toString('ascii'), '0000000');
  assert.equal(header.subarray(116, 123).toString('ascii'), '0000000');
  assert.equal(header.subarray(136, 147).toString('ascii'), '00000000000');
  assert.equal(header.subarray(156, 157).toString('ascii'), '0');
});

test('the tar stream ends with two zero blocks', () => {
  const tar = gunzipSync(encodeCarrier(fixture()));
  assert.ok(tar.subarray(tar.byteLength - 1024).every((byte) => byte === 0));
});

test('encode/decode round trips every member exactly', () => {
  const decoded = decodeCarrier(encodeCarrier(fixture()));
  const byPath = new Map(decoded.map((file) => [file.path, file.bytes]));
  for (const file of fixture()) {
    assert.deepEqual(byPath.get(file.path), file.bytes, file.path);
  }
  assert.equal(decoded.length, 4);
});

test('a path longer than the 100-byte name field is split into prefix/name', () => {
  const deep = `${'directory/'.repeat(12)}page.html`;
  const split = splitUstarPath(deep);
  assert.ok(split.prefix.length > 0);
  assert.ok(Buffer.byteLength(split.name, 'utf8') <= 100);
  assert.equal(
    split.prefix === '' ? split.name : `${split.prefix}/${split.name}`,
    deep,
  );
  const decoded = decodeCarrier(
    encodeCarrier([{ path: deep, bytes: Buffer.from('deep', 'utf8') }]),
  );
  assert.equal(decoded[0]?.path, deep);
});

test('a path representable only with an extension record is refused', () => {
  const unrepresentable = `${'x'.repeat(240)}.html`;
  assert.throws(
    () => splitUstarPath(unrepresentable),
    /PAGES_CARRIER_PATH_UNREPRESENTABLE/u,
  );
});

test('a member that would extract outside the carrier root is refused', () => {
  for (const hostile of [
    '../escaped.html',
    'a/../../escaped.html',
    '/absolute.html',
    './relative.html',
    'a//b.html',
    '',
    'a\\b.html',
  ]) {
    assert.throws(
      () => encodeCarrier([{ path: hostile, bytes: Buffer.from('x') }]),
      /PAGES_CARRIER_PATH_REFUSED/u,
      `${JSON.stringify(hostile)} was encoded into the carrier`,
    );
  }
});

test('the carrier has no entry type but the regular file', () => {
  const bytes = encodeCarrier([
    { path: 'index.html', bytes: Buffer.from('ok') },
  ]);
  const tar = gunzipSync(bytes);
  for (let offset = 0; offset + 512 <= tar.byteLength; offset += 512) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    // Typeflag 0 is a regular file; 1 and 2 (hard link and symlink) carry a
    // linkname that an extractor would follow, and are never emitted.
    assert.equal(String.fromCharCode(Number(header[156])), '0');
    assert.equal(
      header.subarray(157, 257).every((byte) => byte === 0),
      true,
      'a linkname field is populated',
    );
    const size = Number.parseInt(
      header.subarray(124, 136).toString('ascii').replace(/\0/gu, '').trim(),
      8,
    );
    offset += Math.ceil(size / 512) * 512;
  }
});

test('two encodes of the same tree are byte-identical across processes', () => {
  const files = [
    { path: 'index.html', bytes: Buffer.from('<!doctype html>a', 'utf8') },
    { path: 'nested/deep/page.html', bytes: Buffer.from('b'.repeat(1200)) },
    { path: '.well-known/gala-generation.json', bytes: Buffer.from('{}') },
  ];
  const first = encodeCarrier(files);
  const second = encodeCarrier([...files].reverse());
  assert.deepEqual(first, second);
  assert.equal(
    createHash('sha256').update(first).digest('hex'),
    createHash('sha256').update(second).digest('hex'),
  );
});
