/** Fixture adapter module exporting exactly the eight lifecycle functions. */

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
