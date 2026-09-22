/**
 * Duty 1 (S2-author-owned-publication.md section 5): "Artifact identity and
 * digest agreement between frozen bytes and the manifest. Reject mutation
 * after freeze."
 *
 * The kernel never reads artifact bytes itself (DEC-016: it never touches a
 * source repository, and it does not re-derive `artifact-manifest:2.0.0`
 * digests, which are `template`/schema-owned computations). This module
 * instead compares two already-computed identity records — the one frozen
 * at handoff time and the one a caller freshly recomputed for the candidate
 * about to be staged or activated — and fails closed on any disagreement.
 *
 * @module
 */

import { KernelError, kernelFinding } from './errors.js';

/**
 * @typedef {Readonly<{
 *   artifactId: string,
 *   artifactDigest: string,
 *   manifestDigest: string,
 *   artifactFileCount: number,
 *   artifactByteCount: number
 * }>} ArtifactIdentityRecord
 */

/**
 * Ordered fields compared for exact agreement.
 *
 * @type {readonly (keyof ArtifactIdentityRecord)[]}
 */
const COMPARED_FIELDS = Object.freeze([
  'artifactId',
  'artifactDigest',
  'manifestDigest',
  'artifactFileCount',
  'artifactByteCount',
]);

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
export function checkArtifactIdentityAgreement(frozen, candidate) {
  if (frozen === null) {
    return Object.freeze([]);
  }
  /** @type {import('./errors.js').KernelFinding[]} */
  const findings = [];
  for (const field of COMPARED_FIELDS) {
    if (frozen[field] !== candidate[field]) {
      findings.push(
        kernelFinding(
          'ARTIFACT_MUTATED_AFTER_FREEZE',
          'ARTIFACT_SAFETY_ERROR',
          `Field "${field}" disagrees between the frozen artifact (${JSON.stringify(
            frozen[field],
          )}) and the candidate (${JSON.stringify(candidate[field])}).`,
          'Freeze a new artifact and issue a new operation; the kernel never republishes bytes that changed after freeze.',
          { location: `/${field}`, evidence: { field } },
        ),
      );
    }
  }
  return Object.freeze(findings);
}

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
export function assertArtifactIdentityAgreement(frozen, candidate) {
  const findings = checkArtifactIdentityAgreement(frozen, candidate);
  if (findings.length > 0) {
    throw new KernelError(
      'Artifact identity disagrees with its frozen record',
      findings,
    );
  }
}
