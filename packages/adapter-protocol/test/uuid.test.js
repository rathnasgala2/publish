import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateUuidV7 } from '../src/uuid.js';

const STABLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

test('generateUuidV7 produces a lowercase canonical UUIDv7 matching the stableId pattern', () => {
  for (let i = 0; i < 100; i += 1) {
    assert.match(generateUuidV7(), STABLE_ID_PATTERN);
  }
});

test('generateUuidV7 never repeats across many calls', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const id = generateUuidV7();
    assert.ok(!seen.has(id), `unexpected duplicate UUIDv7: ${id}`);
    seen.add(id);
  }
});

test('generateUuidV7 timestamps are monotonically non-decreasing across sequential calls', () => {
  /**
   * @param {string} id a canonical UUIDv7 string
   * @returns {bigint} the 48-bit millisecond timestamp encoded in its first
   *   three octets
   */
  function extractTimestampMs(id) {
    const hex = id.replaceAll('-', '').slice(0, 12);
    return BigInt(`0x${hex}`);
  }

  let previous = extractTimestampMs(generateUuidV7());
  for (let i = 0; i < 20; i += 1) {
    const current = extractTimestampMs(generateUuidV7());
    assert.ok(current >= previous);
    previous = current;
  }
});
