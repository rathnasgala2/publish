/**
 * Duty 3: "Bounded resources: file count, byte count, path length."
 *
 * Limits come from the negotiated adapter's declared
 * `adapter-capability:2.0.0` limits (`adapter-protocol` validates and
 * discriminates the filesystem/HTTP limits shape); this module performs the
 * checked-arithmetic comparison against an artifact's own counted totals.
 * Every numeric comparison uses `BigInt` so a 64-bit provider limit (carried
 * on the wire as a decimal string, per the schema's `positiveInt64`
 * convention) is never silently coerced through a lossy `Number`.
 *
 * @module
 */

import { kernelFinding } from './errors.js';

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
export function checkBoundedResources(totals, limits) {
  /** @type {import('./errors.js').KernelFinding[]} */
  const findings = [];

  pushIfExceeded(
    findings,
    'ARTIFACT_FILE_COUNT_EXCEEDED',
    'artifactFileCount',
    totals.artifactFileCount,
    limits.maximumFiles,
    'maximumFiles',
  );
  pushIfExceeded(
    findings,
    'ARTIFACT_BYTE_COUNT_EXCEEDED',
    'artifactByteCount',
    totals.artifactByteCount,
    limits.maximumArtifactBytes,
    'maximumArtifactBytes',
  );
  pushIfExceeded(
    findings,
    'ARTIFACT_PATH_LENGTH_EXCEEDED',
    'longestPathBytes',
    totals.longestPathBytes,
    limits.maximumPathBytes,
    'maximumPathBytes',
  );

  return Object.freeze(findings);
}

/**
 * Compare one counted total against its bound using `BigInt` arithmetic and
 * push a finding when the total exceeds the bound.
 *
 * @param {import('./errors.js').KernelFinding[]} findings accumulator
 * @param {string} code stable finding code for this bound
 * @param {string} field the field name in `totals` this bound checks
 * @param {number | string} actual the artifact's counted total
 * @param {number | string} maximum the provider's declared bound
 * @param {string} limitField the field name in `limits` this bound reads
 * @returns {void}
 */
function pushIfExceeded(findings, code, field, actual, maximum, limitField) {
  const actualBig = BigInt(actual);
  const maximumBig = BigInt(maximum);
  if (actualBig < 0n) {
    findings.push(
      kernelFinding(
        'ARTIFACT_RESOURCE_TOTAL_NEGATIVE',
        'ARTIFACT_SAFETY_ERROR',
        `Field "${field}" is negative (${actualBig}); a counted total can never be negative.`,
        'Recompute the artifact totals; a negative count indicates a corrupted manifest.',
        { location: `/${field}` },
      ),
    );
    return;
  }
  if (actualBig > maximumBig) {
    findings.push(
      kernelFinding(
        code,
        'TARGET_CONSTRAINT_ERROR',
        `Field "${field}" (${actualBig}) exceeds the negotiated adapter's "${limitField}" bound (${maximumBig}).`,
        'Reduce the artifact below the negotiated provider limit, or select a destination with a higher bound.',
        {
          location: `/${field}`,
          evidence: {
            actual: actualBig.toString(),
            maximum: maximumBig.toString(),
          },
        },
      ),
    );
  }
}
