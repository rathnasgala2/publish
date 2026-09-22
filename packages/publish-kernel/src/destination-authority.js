/**
 * Duty 4: "Destination authority: reject destination-authority mismatch and
 * destination change after preflight."
 *
 * The kernel treats a destination identity as immutable for the life of one
 * operation: whatever `preflight` inspected is the only destination `stage`
 * and `activate` may ever mutate. This module compares destination identity
 * records field-by-field; it never trusts an adapter's own restatement over
 * the one recorded at preflight time.
 *
 * @module
 */

import { kernelFinding } from './errors.js';

/**
 * @typedef {Readonly<{
 *   environment: string,
 *   adapterId: string,
 *   adapterVersion: string,
 *   targetDigest: string,
 *   baseUrl: string
 * }>} DestinationIdentity
 */

/** @type {readonly (keyof DestinationIdentity)[]} */
const COMPARED_FIELDS = Object.freeze([
  'environment',
  'adapterId',
  'adapterVersion',
  'targetDigest',
  'baseUrl',
]);

/**
 * Check that the destination identity recorded at preflight time still
 * matches the destination identity a later stage (`stage`, `activate`,
 * `observe`, `cleanup-staged` or `rollback`) is about to act against.
 *
 * @param {DestinationIdentity} preflightDestination the destination
 *   identity recorded when `preflight` ran
 * @param {DestinationIdentity} currentDestination the destination identity
 *   the current stage is about to act against
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when the
 *   destination has not changed since preflight
 */
export function checkDestinationAuthority(
  preflightDestination,
  currentDestination,
) {
  /** @type {import('./errors.js').KernelFinding[]} */
  const findings = [];
  for (const field of COMPARED_FIELDS) {
    if (preflightDestination[field] !== currentDestination[field]) {
      findings.push(
        kernelFinding(
          'DESTINATION_AUTHORITY_MISMATCH',
          'TARGET_CONSTRAINT_ERROR',
          `Destination field "${field}" changed since preflight: was ${JSON.stringify(
            preflightDestination[field],
          )}, is now ${JSON.stringify(currentDestination[field])}.`,
          'Run preflight again against the new destination and issue a new operation; the kernel never mutates a destination that changed after preflight.',
          { location: `/${field}` },
        ),
      );
    }
  }
  return Object.freeze(findings);
}

/**
 * Check that a destination identity is one the operation's authorized
 * destination-mutation authority actually names, rejecting an attempt to
 * mutate any other destination under the same operation.
 *
 * @param {DestinationIdentity} authorizedDestination the destination the
 *   operation's authority names
 * @param {DestinationIdentity} candidateDestination the destination a
 *   lifecycle call is about to act against
 * @returns {readonly import('./errors.js').KernelFinding[]} empty when the
 *   candidate is the authorized destination
 */
export function checkDestinationOwnership(
  authorizedDestination,
  candidateDestination,
) {
  const mismatch = COMPARED_FIELDS.some(
    (field) => authorizedDestination[field] !== candidateDestination[field],
  );
  if (!mismatch) {
    return Object.freeze([]);
  }
  return Object.freeze([
    kernelFinding(
      'DESTINATION_AUTHORITY_UNOWNED',
      'TARGET_CONSTRAINT_ERROR',
      'The candidate destination is not the destination this operation is authorized to mutate.',
      'Issue a new operation authorized against the intended destination.',
      { evidence: { authorizedDestination, candidateDestination } },
    ),
  ]);
}
