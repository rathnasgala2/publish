/**
 * The activation fence input: `expectedCurrentGenerationId`.
 *
 * Until protocol `2.1.0` this field was `string | null`, and `null` meant
 * two incompatible things at once: "I expect this destination to be serving
 * nothing" and "I have no expectation, do not fence me". Every adapter
 * implemented the second reading (`!== null` guards), so the caller that
 * genuinely meant "this is a first publish, refuse if anything is already
 * served" silently got no fence at all and would happily overwrite a live
 * generation (LOCAL-47).
 *
 * Protocol `2.1.0` removes the ambiguity: the field is mandatory and is
 * either a generation identity or the explicit {@link EXPECT_NOTHING_SERVED}
 * sentinel. `null` and `undefined` are refused, so the ambiguous call can no
 * longer be written at all — there is no "unfenced" activation.
 *
 * @module
 */

import { AdapterProtocolError, finding } from './errors.js';

/**
 * The in-process adapter protocol contract version. `2.1.0` is the fence
 * sentinel revision: the eight lifecycle exports and the closed capability
 * vocabulary are unchanged, and the sole breaking change is that
 * `activate`'s `expectedCurrentGenerationId` no longer accepts `null`.
 */
export const ADAPTER_PROTOCOL_VERSION = '2.1.0';

/**
 * The explicit "I expect this destination to be serving no generation at
 * all" fence value. Its bytes deliberately cannot be confused with a
 * generation identity (every generation identity is a lowercase UUIDv7).
 */
export const EXPECT_NOTHING_SERVED = 'gala:expect-nothing-served';

/**
 * The exact shape of a generation identity on the wire: the schema's
 * `stableId` (a lowercase UUIDv7). `adapter-protocol`'s activation fence is
 * `oneOf(stableId, EXPECT_NOTHING_SERVED)` in the schema package
 * (`adapter-capability`, `deployment-intent`, `deployment-receipt`), so this
 * helper admits exactly that and nothing looser: a fence value that is not a
 * generation identity cannot agree with any observed generation and would
 * only ever have produced a silent `reconcile`.
 */
export const GENERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * @typedef {Readonly<{
 *   expectsNothingServed: boolean,
 *   generationId: string | null
 * }>} GenerationFence
 */

/**
 * Validate one `expectedCurrentGenerationId` input and resolve it to a fence.
 *
 * @param {unknown} value the caller-supplied `expectedCurrentGenerationId`
 * @param {string} [adapterId] the adapter identity, for the diagnostic
 * @returns {GenerationFence} the resolved fence
 */
export function requireGenerationFence(value, adapterId = 'adapter') {
  if (value === EXPECT_NOTHING_SERVED) {
    return Object.freeze({ expectsNothingServed: true, generationId: null });
  }
  if (typeof value === 'string' && GENERATION_ID_PATTERN.test(value)) {
    return Object.freeze({ expectsNothingServed: false, generationId: value });
  }
  throw new AdapterProtocolError(
    `${adapterId}: expectedCurrentGenerationId must be a generation identity or the EXPECT_NOTHING_SERVED sentinel`,
    [
      finding(
        'EXPECTED_GENERATION_FENCE_INVALID',
        'TARGET_CONSTRAINT_ERROR',
        value === null || value === undefined
          ? `expectedCurrentGenerationId is ${String(value)}. Adapter protocol ${ADAPTER_PROTOCOL_VERSION} refuses it: "nothing is served" is now the explicit ${JSON.stringify(EXPECT_NOTHING_SERVED)} sentinel, so a missing expectation can never silently disable the activation fence (LOCAL-47).`
          : `expectedCurrentGenerationId must be a lowercase UUIDv7 generation identity or ${JSON.stringify(EXPECT_NOTHING_SERVED)}, exactly as the schema's activation fence admits; received ${JSON.stringify(value)}.`,
        { location: '/expectedCurrentGenerationId' },
      ),
    ],
  );
}

/**
 * Decide whether an observed served generation disagrees with a fence.
 *
 * @param {GenerationFence} fence the resolved fence
 * @param {string | null} observedGenerationId the generation the destination
 *   is observed to be serving, or `null` when it serves none
 * @returns {boolean} whether the fence disagrees with the observation
 */
export function fenceDisagrees(fence, observedGenerationId) {
  return fence.expectsNothingServed
    ? observedGenerationId !== null
    : observedGenerationId !== fence.generationId;
}

/**
 * Build the fence value a caller should pass for an observed destination
 * state: the observed generation, or the sentinel when nothing is served.
 *
 * @param {string | null | undefined} observedGenerationId the observed
 *   served generation, or `null`/`undefined` when nothing is served
 * @returns {string} the fence value to pass as `expectedCurrentGenerationId`
 */
export function fenceFor(observedGenerationId) {
  return observedGenerationId === null || observedGenerationId === undefined
    ? EXPECT_NOTHING_SERVED
    : observedGenerationId;
}
