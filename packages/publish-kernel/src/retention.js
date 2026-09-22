/**
 * Duty 9: "Last-known-good retention: active plus five prior certified
 * digest records by default (DEC-024/026). Gala retains no artifact bytes;
 * in S2 there is no Gala at all, so the digest history is local to the
 * execution context."
 *
 * This module holds no state itself; a caller (the adapter or
 * `publish-action` composing the kernel) persists the returned history
 * explicitly wherever its own execution context lives (S2: a local file
 * next to the destination; there is no server-side retention yet).
 *
 * @module
 */

import { kernelFinding } from './errors.js';

/** Default retained-history size: the active generation plus five priors. */
export const DEFAULT_MAXIMUM_PRIOR_GENERATIONS = 5;

/**
 * @typedef {Readonly<{
 *   generationId: string,
 *   artifactDigest: string,
 *   certifiedAt: string
 * }>} CertifiedDigestRecord
 */

/**
 * Insert a newly certified digest record at the head of the retained
 * history and prune anything beyond the retention cap (the active record
 * plus, by default, five priors). `history` is ordered most-recent-first;
 * this function never reorders, only inserts and truncates.
 *
 * @param {readonly CertifiedDigestRecord[]} history the current retained
 *   history, most-recent-first, before this certification
 * @param {CertifiedDigestRecord} newlyCertified the record just certified
 * @param {{maximumPriorGenerations?: number}} [options] override the
 *   default retention cap
 * @returns {readonly CertifiedDigestRecord[]} the pruned history,
 *   most-recent-first, with `newlyCertified` at index 0
 */
export function retainCertifiedDigest(history, newlyCertified, options = {}) {
  const maximumPriorGenerations =
    options.maximumPriorGenerations ?? DEFAULT_MAXIMUM_PRIOR_GENERATIONS;
  const withoutDuplicate = history.filter(
    (entry) => entry.generationId !== newlyCertified.generationId,
  );
  const inserted = [newlyCertified, ...withoutDuplicate];
  return Object.freeze(inserted.slice(0, maximumPriorGenerations + 1));
}

/**
 * Select the retained record for a specific generation, used by rollback to
 * exactly select a historical certification to reconstruct (S2-author-
 * owned-publication.md section 5: "the declared rollback mode, or refuse
 * before mutation when unavailable").
 *
 * @param {readonly CertifiedDigestRecord[]} history the retained history,
 *   most-recent-first
 * @param {string} generationId the generation identity to select
 * @returns {Readonly<{
 *   record: CertifiedDigestRecord | null,
 *   findings: readonly import('./errors.js').KernelFinding[]
 * }>} the selected record, or a finding when it is not retained
 */
export function selectRetainedGeneration(history, generationId) {
  const record =
    history.find((entry) => entry.generationId === generationId) ?? null;
  if (record !== null) {
    return Object.freeze({ record, findings: Object.freeze([]) });
  }
  return Object.freeze({
    record: null,
    findings: Object.freeze([
      kernelFinding(
        'ROLLBACK_GENERATION_NOT_RETAINED',
        'TARGET_CONSTRAINT_ERROR',
        `Generation ${JSON.stringify(generationId)} is not in the retained last-known-good history and cannot be rolled back to.`,
        'Select a generation identity present in the retained history, or refuse the rollback before any mutation.',
      ),
    ]),
  });
}
