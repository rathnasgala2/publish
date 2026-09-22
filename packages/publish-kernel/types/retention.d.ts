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
export function retainCertifiedDigest(history: readonly CertifiedDigestRecord[], newlyCertified: CertifiedDigestRecord, options?: {
    maximumPriorGenerations?: number;
}): readonly CertifiedDigestRecord[];
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
export function selectRetainedGeneration(history: readonly CertifiedDigestRecord[], generationId: string): Readonly<{
    record: CertifiedDigestRecord | null;
    findings: readonly import("./errors.js").KernelFinding[];
}>;
/** Default retained-history size: the active generation plus five priors. */
export const DEFAULT_MAXIMUM_PRIOR_GENERATIONS: 5;
export type CertifiedDigestRecord = Readonly<{
    generationId: string;
    artifactDigest: string;
    certifiedAt: string;
}>;
