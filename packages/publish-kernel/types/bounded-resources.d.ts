/**
 * @typedef {Readonly<{
 *   artifactFileCount: number | string,
 *   artifactByteCount: number | string,
 *   longestPathBytes: number | string
 * }>} ArtifactResourceTotals
 */
/**
 * @typedef {Readonly<{
 *   maximumFiles: number | string,
 *   maximumArtifactBytes: number | string,
 *   maximumPathBytes: number | string
 * }>} ProviderResourceLimits
 */
/**
 * Check an artifact's counted totals against the negotiated provider's
 * bounded-resource limits. The marker itself (one additional file and its
 * byte length) participates in the file/byte totals exactly as DEC-097
 * section 7 requires; a caller includes it in `totals` before calling this
 * function.
 *
 * @param {ArtifactResourceTotals} totals the artifact's own counted totals,
 *   including the generated marker
 * @param {ProviderResourceLimits} limits the negotiated adapter's declared
 *   provider limits
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when
 *   every total is within its bound
 */
export function checkBoundedResources(totals: ArtifactResourceTotals, limits: ProviderResourceLimits): readonly import("./errors.js").KernelFinding[];
export type ArtifactResourceTotals = Readonly<{
    artifactFileCount: number | string;
    artifactByteCount: number | string;
    longestPathBytes: number | string;
}>;
export type ProviderResourceLimits = Readonly<{
    maximumFiles: number | string;
    maximumArtifactBytes: number | string;
    maximumPathBytes: number | string;
}>;
