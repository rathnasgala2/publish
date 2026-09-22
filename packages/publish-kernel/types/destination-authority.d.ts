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
export function checkDestinationAuthority(preflightDestination: DestinationIdentity, currentDestination: DestinationIdentity): readonly import("./errors.js").KernelFinding[];
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
export function checkDestinationOwnership(authorizedDestination: DestinationIdentity, candidateDestination: DestinationIdentity): readonly import("./errors.js").KernelFinding[];
export type DestinationIdentity = Readonly<{
    environment: string;
    adapterId: string;
    adapterVersion: string;
    targetDigest: string;
    baseUrl: string;
}>;
