/**
 * A deliberately broken fake adapter: everything `fake-adapter.js` does,
 * except `activate` never checks `expectedArtifactDigest`, never invokes
 * `crashInjectionHook` before promoting, and still reads
 * `expectedCurrentGenerationId: null` as "no fence" (the pre-2.1.0 protocol
 * reading LOCAL-47 abolished). This exists only so
 * `suite-catches-broken-adapter.test.js` can prove the reusable conformance
 * suite actually fails against an adapter that skips integrity checking and
 * can never be genuinely interrupted before its pointer swap — the exact
 * defect class the review that added this file caught in an earlier,
 * incorrectly structured version of the digest-mismatch test (see
 * `src/index.js`'s "activation refuses a stage whose bytes disagree..."
 * test for the full explanation) — and, since LOCAL-47, so the suite's new
 * fence cases are likewise proven non-vacuous against an adapter that still
 * treats a `null` fence as an unfenced publish.
 *
 * @module
 */

import {
  fenceDisagrees,
  requireGenerationFence,
} from '@rathnasgala2/adapter-protocol';

import { fakeAdapterModule } from './fake-adapter.js';

export const brokenFakeAdapterModule = Object.freeze({
  ...fakeAdapterModule,
  /**
   * @param {any} input the activate input
   * @returns {Promise<Record<string, unknown>>} the activation decision,
   *   built without ever checking `expectedArtifactDigest`, without ever
   *   invoking `crashInjectionHook`, and with the abolished pre-2.1.0
   *   `!== null` fence guard still in place
   */
  async activate(input) {
    const d = /** @type {any} */ (input.destination);
    // BROKEN ON PURPOSE (LOCAL-47): this is the abolished pre-2.1.0 guard.
    // `null` and `undefined` are read as "no expectation, do not fence me"
    // instead of being refused, so the caller that meant "refuse if
    // anything is already served" publishes completely unfenced over a live
    // generation. Every *other* fence value is handled correctly, so the
    // suite's failure isolates exactly this defect.
    if (
      input.expectedCurrentGenerationId !== undefined &&
      input.expectedCurrentGenerationId !== null
    ) {
      const fence = requireGenerationFence(
        input.expectedCurrentGenerationId,
        'broken-fake-adapter',
      );
      if (fenceDisagrees(fence, d.current)) {
        return {
          decision: 'reconcile',
          generationId: input.generationId,
          previousGenerationId: d.current,
          idempotent: false,
        };
      }
    }
    const staged = d.stages.get(input.stageToken);
    if (!d.releases.has(input.generationId) && staged) {
      // BROKEN ON PURPOSE: no `expectedArtifactDigest` check, and
      // `crashInjectionHook` is never invoked, so this adapter can never be
      // genuinely interrupted before its pointer swap either.
      d.releases.set(input.generationId, staged);
    }
    const previous = d.current;
    d.current = input.generationId;
    return {
      decision: 'activate',
      generationId: input.generationId,
      previousGenerationId: previous,
      idempotent: previous === input.generationId,
    };
  },
});
