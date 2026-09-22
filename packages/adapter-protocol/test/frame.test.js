import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AdapterProtocolError } from '../src/errors.js';
import {
  FRAME_CEILING_BYTES,
  FRAME_LENGTH_PREFIX_BYTES,
  decodeFrame,
  decodeFrames,
  encodeFrame,
} from '../src/frame.js';

test('encodeFrame then decodeFrame round-trips a message', () => {
  const message = { hello: 'world', n: 3 };
  const frame = encodeFrame(message);
  const decoded = decodeFrame(frame);
  assert.deepEqual(decoded.message, message);
  assert.equal(decoded.remainder.byteLength, 0);
});

test('encodeFrame writes an unsigned big-endian 32-bit length prefix', () => {
  const frame = encodeFrame('x');
  const declared = frame.readUInt32BE(0);
  assert.equal(declared, frame.byteLength - FRAME_LENGTH_PREFIX_BYTES);
});

test('encodeFrame rejects a body at exactly the DEC-086 ceiling plus one byte', () => {
  // '"' + (ceiling - 1) 'a' characters + '"' encodes to exactly the ceiling;
  // one more character pushes the JSON string one byte past it.
  const atCeiling = 'a'.repeat(FRAME_CEILING_BYTES - 2);
  const frame = encodeFrame(atCeiling);
  assert.equal(
    frame.byteLength,
    FRAME_CEILING_BYTES + FRAME_LENGTH_PREFIX_BYTES,
  );

  const overCeiling = 'a'.repeat(FRAME_CEILING_BYTES - 1);
  assert.throws(
    () => encodeFrame(overCeiling),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings[0]?.code === 'ADAPTER_FRAME_TOO_LARGE',
  );
});

test('decodeFrame accepts a frame at exactly the ceiling and rejects one byte over', () => {
  const atCeiling = encodeFrame('a'.repeat(FRAME_CEILING_BYTES - 2));
  assert.doesNotThrow(() => decodeFrame(atCeiling));

  const overCeilingBuffer = Buffer.alloc(
    FRAME_LENGTH_PREFIX_BYTES + FRAME_CEILING_BYTES + 1,
  );
  overCeilingBuffer.writeUInt32BE(FRAME_CEILING_BYTES + 1, 0);
  assert.throws(
    () => decodeFrame(overCeilingBuffer),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings[0]?.code === 'ADAPTER_FRAME_TOO_LARGE',
  );
});

test('decodeFrame rejects a zero-length declared frame', () => {
  const buffer = Buffer.alloc(FRAME_LENGTH_PREFIX_BYTES);
  buffer.writeUInt32BE(0, 0);
  assert.throws(
    () => decodeFrame(buffer),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings[0]?.code === 'ADAPTER_FRAME_EMPTY',
  );
});

test('decodeFrame rejects a frame truncated before the length prefix', () => {
  assert.throws(
    () => decodeFrame(Buffer.from([1, 2])),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings[0]?.code === 'ADAPTER_FRAME_TRUNCATED',
  );
});

test('decodeFrame rejects a frame truncated before its declared length', () => {
  const full = encodeFrame({ a: 1, b: 2, c: 3 });
  const truncated = full.subarray(0, full.byteLength - 2);
  assert.throws(
    () => decodeFrame(truncated),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings[0]?.code === 'ADAPTER_FRAME_TRUNCATED',
  );
});

test('decodeFrame rejects invalid UTF-8 in the frame body', () => {
  const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xfd]);
  const prefix = Buffer.alloc(FRAME_LENGTH_PREFIX_BYTES);
  prefix.writeUInt32BE(invalidUtf8.byteLength, 0);
  const frame = Buffer.concat([prefix, invalidUtf8]);
  assert.throws(
    () => decodeFrame(frame),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings[0]?.code === 'ADAPTER_FRAME_INVALID_UTF8',
  );
});

test('decodeFrame rejects a body that is valid UTF-8 but not valid JSON', () => {
  const body = Buffer.from('not json', 'utf8');
  const prefix = Buffer.alloc(FRAME_LENGTH_PREFIX_BYTES);
  prefix.writeUInt32BE(body.byteLength, 0);
  const frame = Buffer.concat([prefix, body]);
  assert.throws(
    () => decodeFrame(frame),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings[0]?.code === 'ADAPTER_FRAME_INVALID_JSON',
  );
});

test('decodeFrames decodes every coalesced complete frame in order', () => {
  const frames = Buffer.concat([
    encodeFrame({ i: 1 }),
    encodeFrame({ i: 2 }),
    encodeFrame({ i: 3 }),
  ]);
  const messages = decodeFrames(frames);
  assert.deepEqual(messages, [{ i: 1 }, { i: 2 }, { i: 3 }]);
});

test('decodeFrames rejects trailing bytes that do not form another complete frame', () => {
  const frames = Buffer.concat([encodeFrame({ i: 1 }), Buffer.from([9, 9])]);
  assert.throws(() => decodeFrames(frames), AdapterProtocolError);
});

test('decodeFrames on an empty buffer returns no messages', () => {
  assert.deepEqual(decodeFrames(Buffer.alloc(0)), []);
});

test('property: every encodeFrame output decodes back to an equal message', () => {
  for (let i = 0; i < 100; i += 1) {
    const message = {
      id: Math.floor(Math.random() * 1_000_000),
      values: Array.from({ length: 5 }, () => Math.random().toString(36)),
    };
    const decoded = decodeFrame(encodeFrame(message));
    assert.deepEqual(decoded.message, message);
  }
});

test('property: coalescing N frames and decoding recovers exactly N messages in order', () => {
  for (let trial = 0; trial < 25; trial += 1) {
    const count = Math.floor(Math.random() * 8) + 1;
    const messages = Array.from({ length: count }, (_, index) => ({
      index,
    }));
    const buffer = Buffer.concat(
      messages.map((message) => encodeFrame(message)),
    );
    assert.deepEqual(decodeFrames(buffer), messages);
  }
});
