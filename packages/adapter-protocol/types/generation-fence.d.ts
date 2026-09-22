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
export function requireGenerationFence(value: unknown, adapterId?: string): GenerationFence;
/**
 * Decide whether an observed served generation disagrees with a fence.
 *
 * @param {GenerationFence} fence the resolved fence
 * @param {string | null} observedGenerationId the generation the destination
 *   is observed to be serving, or `null` when it serves none
 * @returns {boolean} whether the fence disagrees with the observation
 */
export function fenceDisagrees(fence: GenerationFence, observedGenerationId: string | null): boolean;
/**
 * Build the fence value a caller should pass for an observed destination
 * state: the observed generation, or the sentinel when nothing is served.
 *
 * @param {string | null | undefined} observedGenerationId the observed
 *   served generation, or `null`/`undefined` when nothing is served
 * @returns {string} the fence value to pass as `expectedCurrentGenerationId`
 */
export function fenceFor(observedGenerationId: string | null | undefined): string;
/**
 * The in-process adapter protocol contract version. `2.1.0` is the fence
 * sentinel revision: the eight lifecycle exports and the closed capability
 * vocabulary are unchanged, and the sole breaking change is that
 * `activate`'s `expectedCurrentGenerationId` no longer accepts `null`.
 */
export const ADAPTER_PROTOCOL_VERSION: "2.1.0";
/**
 * The explicit "I expect this destination to be serving no generation at
 * all" fence value. Its bytes deliberately cannot be confused with a
 * generation identity (every generation identity is a lowercase UUIDv7).
 */
export const EXPECT_NOTHING_SERVED: "gala:expect-nothing-served";
/**
 * The exact shape of a generation identity on the wire: the schema's
 * `stableId` (a lowercase UUIDv7). `adapter-protocol`'s activation fence is
 * `oneOf(stableId, EXPECT_NOTHING_SERVED)` in the schema package
 * (`adapter-capability`, `deployment-intent`, `deployment-receipt`), so this
 * helper admits exactly that and nothing looser: a fence value that is not a
 * generation identity cannot agree with any observed generation and would
 * only ever have produced a silent `reconcile`.
 */
export const GENERATION_ID_PATTERN: RegExp;
export type GenerationFence = Readonly<{
    expectsNothingServed: boolean;
    generationId: string | null;
}>;
