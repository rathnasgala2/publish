/**
 * The DEC-097 section 7/8 `capabilityDecision` record and its
 * `capabilityDecisionDigest`. This is the kernel's own construction of the
 * closed compact-JCS record cited by the S2-T16 task packet; it composes
 * only `@rathnasgala2/adapter-protocol`'s general-purpose
 * {@link canonicalizeJson}/{@link domainDigest} primitives, never
 * re-authoring canonicalization or hashing itself.
 *
 * `decisionDigest` is
 * `SHA256(UTF8("GALA-CAPABILITY-DECISION-V2\0") || JCS(the complete record with decisionDigest omitted))`.
 * Field presence is exact per adapter: the four `pages*` fields and
 * `pagesOidcOriginCatalogDigest` are present exactly for `github-pages`; the
 * six `spaces*` fields are present exactly for `do-spaces`;
 * `credentialEgressProfileDigest` is required for both HTTP adapters and
 * absent for `local-directory`.
 *
 * @module
 */

import {
  DESTINATION_KINDS,
  domainDigest,
} from '@rathnasgala2/adapter-protocol';

import { kernelFinding } from './errors.js';

/** Domain separator for the DEC-097 capability-decision digest. */
export const CAPABILITY_DECISION_DOMAIN = 'GALA-CAPABILITY-DECISION-V2\0';

/** Always-required fields, independent of `adapter.adapterId`. */
const REQUIRED_FIELDS = Object.freeze([
  'artifactId',
  'artifactDigest',
  'manifestDigest',
  'destination',
  'adapter',
  'capabilityDigest',
  'artifactFileCount',
  'deploymentObjectCount',
  'artifactByteCount',
  'markerByteLength',
  'deploymentByteCount',
  'maximumFinalPathByteLength',
  'maximumStageRequestCount',
  'maximumStageRequestBytes',
  'maximumStageResponseBytes',
  'maximumStageResponseWireBytes',
]);

/** Adapter-conditional optional field groups, keyed by `adapterId`. */
const CONDITIONAL_FIELDS = Object.freeze({
  'local-directory': Object.freeze([]),
  'github-pages': Object.freeze([
    'credentialEgressProfileDigest',
    'pagesOidcOriginCatalogDigest',
    'pagesActionsArtifactName',
    'pagesActionsArtifactByteCount',
    'pagesActionsArtifactDigest',
    'pagesBuildVersion',
  ]),
  'do-spaces': Object.freeze([
    'credentialEgressProfileDigest',
    'spacesStagePrefix',
    'spacesWebsiteConfigurationDigest',
    'spacesControlPlaneBindingDigest',
    'spacesControlPlaneRequestCatalogDigest',
    'spacesControlPlaneResponseCatalogDigest',
    'spacesControlPlaneTlsProfileDigest',
  ]),
});

/** The full closed set of every conditional field name, across all adapters. */
const ALL_CONDITIONAL_FIELD_NAMES = Object.freeze(
  Array.from(new Set(Object.values(CONDITIONAL_FIELDS).flat())),
);

/**
 * Build and validate the DEC-097 `capabilityDecision` record, computing its
 * `decisionDigest`. Fails closed: a missing always-required field, a
 * missing adapter-conditional field, or a present field that must be absent
 * for the declared `adapter.adapterId` is reported as a finding and no
 * record is returned.
 *
 * @param {Record<string, unknown> & { adapter: { adapterId: string } }} fields
 *   every field of the record except `profile` and `decisionDigest`, which
 *   this function supplies
 * @returns {Readonly<{
 *   record: (Readonly<Record<string, unknown>> & { decisionDigest: string }) | null,
 *   findings: readonly import('./errors.js').KernelFinding[]
 * }>} the completed, digested record, or findings explaining why it could
 *   not be built
 */
export function buildCapabilityDecision(fields) {
  const adapterId = fields.adapter?.adapterId;
  if (!DESTINATION_KINDS.includes(adapterId)) {
    return Object.freeze({
      record: null,
      findings: Object.freeze([
        kernelFinding(
          'CAPABILITY_DECISION_ADAPTER_UNKNOWN',
          'ARTIFACT_SAFETY_ERROR',
          `adapter.adapterId ${JSON.stringify(adapterId)} is not one of the three closed adapter identities.`,
          'Supply a capability decision only for local-directory, github-pages or do-spaces.',
          { location: '/adapter/adapterId' },
        ),
      ]),
    });
  }

  /** @type {import('./errors.js').KernelFinding[]} */
  const findings = [];

  for (const field of REQUIRED_FIELDS) {
    if (fields[field] === undefined) {
      findings.push(missingFieldFinding(field));
    }
  }

  const required = new Set(
    CONDITIONAL_FIELDS[
      /** @type {keyof typeof CONDITIONAL_FIELDS} */ (adapterId)
    ],
  );
  for (const field of ALL_CONDITIONAL_FIELD_NAMES) {
    const present = fields[field] !== undefined;
    if (required.has(field) && !present) {
      findings.push(missingFieldFinding(field));
    }
    if (!required.has(field) && present) {
      findings.push(
        kernelFinding(
          'CAPABILITY_DECISION_FIELD_FORBIDDEN',
          'ARTIFACT_SAFETY_ERROR',
          `Field "${field}" must be absent for adapterId ${JSON.stringify(adapterId)}.`,
          `Remove "${field}" from the capability decision; it is exact per adapter.`,
          { location: `/${field}` },
        ),
      );
    }
  }

  if (findings.length > 0) {
    return Object.freeze({ record: null, findings: Object.freeze(findings) });
  }

  const withoutDigest = { profile: 'gala-capability-decision-v2', ...fields };
  const decisionDigest = domainDigest(
    CAPABILITY_DECISION_DOMAIN,
    withoutDigest,
  );
  return Object.freeze({
    record: Object.freeze({ ...withoutDigest, decisionDigest }),
    findings: Object.freeze([]),
  });
}

/**
 * @param {string} field the missing field's name
 * @returns {import('./errors.js').KernelFinding} a typed missing-field finding
 */
function missingFieldFinding(field) {
  return kernelFinding(
    'CAPABILITY_DECISION_FIELD_MISSING',
    'ARTIFACT_SAFETY_ERROR',
    `Field "${field}" is required and was not supplied.`,
    `Supply "${field}" before building the capability decision.`,
    { location: `/${field}` },
  );
}

/**
 * Recompute a record's `decisionDigest` and byte-compare it against the
 * digest carried on the record, catching a tampered or stale copy anywhere
 * the digest was retained separately from the record (DEC-097 section 7:
 * "Each value is recomputed before staging.").
 *
 * @param {Readonly<Record<string, unknown>> & { decisionDigest: string }} record
 *   a previously built capability-decision record
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when the
 *   carried digest byte-equals the recomputed digest
 */
export function verifyCapabilityDecisionDigest(record) {
  const { decisionDigest, ...withoutDigest } = record;
  const recomputed = domainDigest(CAPABILITY_DECISION_DOMAIN, withoutDigest);
  if (recomputed === decisionDigest) {
    return Object.freeze([]);
  }
  return Object.freeze([
    kernelFinding(
      'CAPABILITY_DECISION_DIGEST_MISMATCH',
      'ARTIFACT_SAFETY_ERROR',
      `The capability decision's carried digest ${JSON.stringify(decisionDigest)} disagrees with its recomputed digest ${JSON.stringify(recomputed)}.`,
      'Recompute and republish the capability decision; a stale or tampered digest is never staged against.',
    ),
  ]);
}
