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
export function buildCapabilityDecision(fields: Record<string, unknown> & {
    adapter: {
        adapterId: string;
    };
}): Readonly<{
    record: (Readonly<Record<string, unknown>> & {
        decisionDigest: string;
    }) | null;
    findings: readonly import("./errors.js").KernelFinding[];
}>;
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
export function verifyCapabilityDecisionDigest(record: Readonly<Record<string, unknown>> & {
    decisionDigest: string;
}): readonly import("./errors.js").KernelFinding[];
/** Domain separator for the DEC-097 capability-decision digest. */
export const CAPABILITY_DECISION_DOMAIN: "GALA-CAPABILITY-DECISION-V2\0";
