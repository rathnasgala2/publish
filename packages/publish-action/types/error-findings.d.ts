/**
 * @param {unknown} error the thrown error
 * @returns {readonly import('./types.js').PublishActionFinding[]} the
 *   error's findings, or one synthesized `ARTIFACT_SAFETY_ERROR` finding for
 *   an error this module does not specifically recognize (never lets an
 *   unrecognized error escape without a typed finding)
 */
export function findingsFromError(error: unknown): readonly import("./types.js").PublishActionFinding[];
