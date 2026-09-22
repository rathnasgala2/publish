import assert from 'node:assert/strict';

/**
 * Return the first element of a non-empty array, asserting it is non-empty.
 * A small test-only helper so assertions on "the first finding" read
 * naturally without `noUncheckedIndexedAccess` forcing an inline cast at
 * every call site.
 *
 * @template T
 * @param {readonly T[]} array a non-empty array
 * @returns {T} the first element
 */
export function first(array) {
  assert.ok(array.length > 0, 'expected a non-empty array');
  return /** @type {T} */ (array[0]);
}

/**
 * Return the element of a non-empty array at `index`, asserting it exists.
 *
 * @template T
 * @param {readonly T[]} array the array to index
 * @param {number} index the index to read
 * @returns {T} the element at `index`
 */
export function at(array, index) {
  assert.ok(index < array.length, `expected index ${index} to exist`);
  return /** @type {T} */ (array[index]);
}
