/**
 * The exact-ID carrier codec the nine-job graph hands between jobs.
 *
 * DEC-097 section 2.3 requires a consumer to rehash and fully validate a
 * carrier before decoding a byte, so the codec's integrity check is the
 * thing under test here: a carrier whose bytes were altered after upload
 * must fail to decode rather than decode into something plausible.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  carrierDigest,
  decodeCarrier,
  encodeCarrier,
  materialize,
  parseOptions,
  requireOption,
} from '../scripts/workflow/carrier.mjs';

/**
 * @returns {{path: string, bytes: Buffer}[]} a fixed file set
 */
function files() {
  return [
    { path: 'index.html', bytes: Buffer.from('<!doctype html>a', 'utf8') },
    { path: 'nested/page.html', bytes: Buffer.from('b', 'utf8') },
    { path: 'empty.txt', bytes: Buffer.alloc(0) },
  ];
}

test('carrier bytes are deterministic for identical inputs', () => {
  const envelope = {
    purpose: 'frozen-envelope',
    metadata: { runId: '1' },
    files: files(),
  };
  assert.deepEqual(encodeCarrier(envelope), encodeCarrier(envelope));
});

test('encode/decode round trips purpose, metadata and every member', () => {
  const decoded = decodeCarrier(
    encodeCarrier({
      purpose: 'verified-inputs',
      metadata: { runId: '7', runAttempt: '2' },
      files: files(),
    }),
  );
  assert.equal(decoded.purpose, 'verified-inputs');
  assert.deepEqual(decoded.metadata, { runId: '7', runAttempt: '2' });
  assert.deepEqual(decoded.files, files());
});

test('a member whose bytes were altered after upload fails to decode', () => {
  const carrier = encodeCarrier({
    purpose: 'frozen-envelope',
    metadata: {},
    files: files(),
  });
  // Flip a byte inside the compressed stream: a consumer must never get a
  // plausible-looking decode out of a corrupted or substituted carrier.
  const tampered = Buffer.from(carrier);
  tampered.writeUInt8(
    (tampered.readUInt8(tampered.length - 6) + 1) % 256,
    tampered.length - 6,
  );
  assert.notEqual(carrierDigest(tampered), carrierDigest(carrier));
  assert.throws(() => decodeCarrier(tampered));
});

test('a member path that escapes the destination is refused on materialize', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gala-carrier-'));
  await assert.rejects(
    materialize(root, [{ path: '../escaped.txt', bytes: Buffer.from('x') }]),
    /CARRIER_MEMBER_PATH_REFUSED/u,
  );
  await assert.rejects(
    materialize(root, [{ path: '/absolute.txt', bytes: Buffer.from('x') }]),
    /CARRIER_MEMBER_PATH_REFUSED/u,
  );
});

test('materialize writes every member under the destination', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gala-carrier-out-'));
  await materialize(root, files());
  assert.equal(readFileSync(path.join(root, 'nested/page.html'), 'utf8'), 'b');
});

test('option parsing refuses an unknown or valueless argument', () => {
  assert.deepEqual(parseOptions(['--source', 'a', '--out', 'b']), {
    source: 'a',
    out: 'b',
  });
  assert.throws(
    () => parseOptions(['source', 'a']),
    /WORKFLOW_ARGUMENT_UNKNOWN/u,
  );
  assert.throws(
    () => parseOptions(['--source']),
    /WORKFLOW_ARGUMENT_VALUE_MISSING/u,
  );
  assert.throws(
    () => requireOption({}, 'source'),
    /WORKFLOW_ARGUMENT_REQUIRED: --source/u,
  );
});
