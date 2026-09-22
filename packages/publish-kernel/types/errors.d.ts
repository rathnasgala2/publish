/**
 * @typedef {'SOURCE_ERROR' | 'ARTIFACT_SAFETY_ERROR' | 'TARGET_CONSTRAINT_ERROR' | 'WARNING' | 'ADVISORY'} KernelFindingSeverity
 */
/**
 * @typedef {Readonly<{
 *   code: string,
 *   severity: KernelFindingSeverity,
 *   detail: string,
 *   location?: string,
 *   evidence?: Readonly<Record<string, unknown>>,
 *   recovery: string,
 *   overridable: boolean
 * }>} KernelFinding
 */
/**
 * Build one fully typed kernel finding. `recovery` is always a plain-text
 * instruction for what a caller can do about the finding (never omitted:
 * duty 10 requires every finding to carry recovery semantics), and
 * `overridable` states whether an author-approved override can ever admit
 * the underlying condition. A `SOURCE_ERROR`, `ARTIFACT_SAFETY_ERROR` or
 * `TARGET_CONSTRAINT_ERROR` finding is never overridable in S2: the kernel
 * is non-disableable (DEC-016) and there is no managed policy yet to record
 * an approved override against.
 *
 * @param {string} code stable machine-readable finding code
 * @param {KernelFindingSeverity} severity owning-layer severity class
 * @param {string} detail human-readable detail
 * @param {string} recovery human-readable recovery instruction
 * @param {{location?: string, evidence?: Record<string, unknown>, overridable?: boolean}} [extra]
 *   optional location, evidence and override flag
 * @returns {KernelFinding} frozen finding
 */
export function kernelFinding(code: string, severity: KernelFindingSeverity, detail: string, recovery: string, extra?: {
    location?: string;
    evidence?: Record<string, unknown>;
    overridable?: boolean;
}): KernelFinding;
/**
 * Test whether a finding set contains at least one blocking finding
 * (`SOURCE_ERROR`, `ARTIFACT_SAFETY_ERROR` or `TARGET_CONSTRAINT_ERROR`).
 * `WARNING` and `ADVISORY` findings never block.
 *
 * @param {readonly KernelFinding[]} findings candidate finding set
 * @returns {boolean} whether the set blocks the operation
 */
export function hasBlockingFinding(findings: readonly KernelFinding[]): boolean;
/**
 * Throw a {@link KernelError} when a finding set contains a blocking
 * finding; otherwise return the findings unchanged (fail-closed helper used
 * by every duty's `assert*` counterpart).
 *
 * @param {string} message human-readable summary used when throwing
 * @param {readonly KernelFinding[]} findings candidate finding set
 * @returns {readonly KernelFinding[]} the same findings, when none blocks
 */
export function assertNoBlockingFinding(message: string, findings: readonly KernelFinding[]): readonly KernelFinding[];
/**
 * Typed kernel diagnostics (S2-T16 duty 10: "Truthful typed diagnostics:
 * every finding carries stable code, owning layer, severity, location,
 * evidence, recovery and override semantics."). Every kernel duty rejects or
 * warns through a {@link KernelFinding}; none throws a bare `Error` for a
 * domain condition.
 *
 * The owning-layer classification and the severity are the same closed
 * five-member vocabulary the slice brief names: `SOURCE_ERROR` (author input
 * is wrong), `ARTIFACT_SAFETY_ERROR` (the kernel itself refuses),
 * `TARGET_CONSTRAINT_ERROR` (the destination/adapter cannot satisfy the
 * request), `WARNING` (non-blocking but recorded) and `ADVISORY`
 * (informational). `MANAGED_POLICY_DENIAL` never appears here: there is no
 * managed policy in S2.
 *
 * @module
 */
/** Closed finding severity / owning-layer vocabulary (duty 10). */
export const FINDING_SEVERITIES: readonly string[];
/**
 * A typed publish-kernel failure. Carries one or more {@link KernelFinding}
 * records so a caller can inspect exactly what was rejected and why. The
 * kernel fails closed: any duty that produces a non-empty
 * `ARTIFACT_SAFETY_ERROR`, `SOURCE_ERROR` or `TARGET_CONSTRAINT_ERROR`
 * finding set stops the operation before mutation.
 */
export class KernelError extends Error {
    /**
     * @param {string} message human-readable summary
     * @param {readonly KernelFinding[]} findings one or more typed findings
     */
    constructor(message: string, findings: readonly KernelFinding[]);
    /** @type {readonly KernelFinding[]} */
    findings: readonly KernelFinding[];
}
export type KernelFindingSeverity = "SOURCE_ERROR" | "ARTIFACT_SAFETY_ERROR" | "TARGET_CONSTRAINT_ERROR" | "WARNING" | "ADVISORY";
export type KernelFinding = Readonly<{
    code: string;
    severity: KernelFindingSeverity;
    detail: string;
    location?: string;
    evidence?: Readonly<Record<string, unknown>>;
    recovery: string;
    overridable: boolean;
}>;
