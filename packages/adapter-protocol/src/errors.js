/**
 * Typed protocol failures. `adapter-protocol` never throws a bare `Error`
 * for a domain condition: every rejection carries a stable machine code so a
 * caller (the kernel, an adapter, or a test) can branch on it without
 * parsing a message string.
 *
 * @module
 */

/**
 * @typedef {Readonly<{
 *   code: string,
 *   severity: 'SOURCE_ERROR' | 'ARTIFACT_SAFETY_ERROR' | 'TARGET_CONSTRAINT_ERROR' | 'WARNING' | 'ADVISORY',
 *   detail: string,
 *   location?: string,
 *   evidence?: Readonly<Record<string, unknown>>
 * }>} ProtocolFinding
 */

/**
 * A typed adapter-protocol failure. Carries one or more {@link ProtocolFinding}
 * records so a caller can inspect exactly what was rejected and why, per
 * WORKSPACE.md section 5's "truthful typed diagnostics" convention.
 */
export class AdapterProtocolError extends Error {
  /**
   * @param {string} message human-readable summary
   * @param {readonly ProtocolFinding[]} findings one or more typed findings
   */
  constructor(message, findings) {
    super(message);
    this.name = 'AdapterProtocolError';
    /** @type {readonly ProtocolFinding[]} */
    this.findings = Object.freeze([...findings]);
  }
}

/**
 * Build one typed finding.
 *
 * @param {string} code stable machine-readable finding code
 * @param {ProtocolFinding['severity']} severity owning-layer severity class
 * @param {string} detail human-readable detail
 * @param {{location?: string, evidence?: Record<string, unknown>}} [extra] optional location/evidence
 * @returns {ProtocolFinding} frozen finding
 */
export function finding(code, severity, detail, extra = {}) {
  return Object.freeze({
    code,
    severity,
    detail,
    ...(extra.location === undefined ? {} : { location: extra.location }),
    ...(extra.evidence === undefined
      ? {}
      : { evidence: Object.freeze({ ...extra.evidence }) }),
  });
}
