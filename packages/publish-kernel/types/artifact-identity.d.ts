/**
 * Compare a frozen artifact identity record against a freshly recomputed
 * candidate. An absent `frozen` record (nothing has been frozen yet) is not
 * a violation; the function returns no findings and the caller establishes
 * the freeze by retaining `candidate` itself.
 *
 * @param {ArtifactIdentityRecord | null} frozen the identity record
 *   recorded at freeze time, or `null` before any freeze exists
 * @param {ArtifactIdentityRecord} candidate the identity record freshly
 *   computed for the artifact about to be staged or activated
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when the
 *   candidate agrees with the frozen record in every compared field
 */
export function checkArtifactIdentityAgreement(frozen: ArtifactIdentityRecord | null, candidate: ArtifactIdentityRecord): readonly import("./errors.js").KernelFinding[];
/**
 * Assert that a candidate artifact agrees with its frozen identity, or throw
 * {@link import('./errors.js').KernelError}.
 *
 * @param {ArtifactIdentityRecord | null} frozen the identity record
 *   recorded at freeze time, or `null` before any freeze exists
 * @param {ArtifactIdentityRecord} candidate the identity record freshly
 *   computed for the artifact about to be staged or activated
 * @returns {void}
 */
export function assertArtifactIdentityAgreement(frozen: ArtifactIdentityRecord | null, candidate: ArtifactIdentityRecord): void;
export type ArtifactIdentityRecord = Readonly<{
    artifactId: string;
    artifactDigest: string;
    manifestDigest: string;
    artifactFileCount: number;
    artifactByteCount: number;
}>;
