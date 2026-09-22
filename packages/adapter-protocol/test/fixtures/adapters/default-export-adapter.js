/**
 * Fixture adapter module carrying a forbidden default export, otherwise
 * complete. `defineAdapter` must reject this.
 */

/** @returns {string} fixture value */
export function describeCapabilities() {
  return 'describeCapabilities';
}
/** @returns {string} fixture value */
export function inspectDestination() {
  return 'inspectDestination';
}
/** @returns {string} fixture value */
export function preflight() {
  return 'preflight';
}
/** @returns {string} fixture value */
export function stage() {
  return 'stage';
}
/** @returns {string} fixture value */
export function activate() {
  return 'activate';
}
/** @returns {string} fixture value */
export function observe() {
  return 'observe';
}
/** @returns {string} fixture value */
export function cleanupStaged() {
  return 'cleanupStaged';
}
/** @returns {string} fixture value */
export function rollback() {
  return 'rollback';
}

// Fixture deliberately exercises the forbidden-default-export rejection path.
// eslint-disable-next-line no-restricted-syntax
export default 'forbidden';
