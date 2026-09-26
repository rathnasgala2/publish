/**
 * PUB-M4: a deterministic, reproducible replacement for bare `Math.random()`
 * in the property tests. A failure using this generator can be replayed
 * exactly by fixing `TEST_SEED` (or the seed a test prints on failure) --
 * `Math.random()` with no seed and no printed value produces a failure whose
 * inputs never recur.
 *
 * @module
 */

/**
 * Pick a seed for one test run: `TEST_SEED` if set (for replaying a reported
 * failure), otherwise a fresh random seed that the caller must print before
 * using it, so a failure is always reproducible from the test's own output.
 *
 * @returns {number} a 32-bit unsigned seed
 */
export function pickSeed() {
  const fromEnv = process.env.TEST_SEED;
  if (fromEnv !== undefined && fromEnv !== '') {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isInteger(parsed)) {
      return parsed >>> 0;
    }
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

/**
 * A small, fast, deterministic PRNG (mulberry32). Not cryptographic --
 * exactly what a seeded property test needs: the same seed always produces
 * the same sequence.
 *
 * @param {number} seed a 32-bit unsigned seed
 * @returns {() => number} a `Math.random`-shaped generator in `[0, 1)`
 */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An unbiased Fisher-Yates shuffle, driven by a supplied generator. Replaces
 * `array.toSorted(() => random() - 0.5)`, whose comparator-as-shuffle is a
 * well-known non-uniform shuffle that, for small arrays, frequently returns
 * the input order unchanged -- which silently weakens any property being
 * asserted specifically to be order-independent.
 *
 * @template T
 * @param {readonly T[]} array the array to shuffle
 * @param {() => number} random a `Math.random`-shaped generator in `[0, 1)`
 * @returns {T[]} a new, shuffled array; the input is not mutated
 */
export function fisherYatesShuffle(array, random) {
  const result = [...array];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    const swapped = result[swapIndex];
    if (current !== undefined && swapped !== undefined) {
      result[index] = swapped;
      result[swapIndex] = current;
    }
  }
  return result;
}
