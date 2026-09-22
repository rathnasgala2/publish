/**
 * The mandatory adapter lifecycle interface (DEC-020 "Mandatory adapter
 * protocol"; slice brief S2-author-owned-publication.md section 5). Every
 * accepted adapter is an in-process ESM module exporting exactly these eight
 * named functions, no more and no fewer, and no default export.
 *
 * @module
 */

import { AdapterProtocolError, finding } from './errors.js';

/**
 * The exact eight lifecycle function names, in the order the brief lists
 * them. Order carries no semantic meaning for adapter admission (it is
 * compared as a set), but this constant is also the canonical iteration
 * order used when describing or invoking a lifecycle.
 */
export const LIFECYCLE_OPERATIONS = Object.freeze([
  'describeCapabilities',
  'inspectDestination',
  'preflight',
  'stage',
  'activate',
  'observe',
  'cleanupStaged',
  'rollback',
]);

/**
 * @typedef {Readonly<{
 *   describeCapabilities: (...args: unknown[]) => unknown,
 *   inspectDestination: (...args: unknown[]) => unknown,
 *   preflight: (...args: unknown[]) => unknown,
 *   stage: (...args: unknown[]) => unknown,
 *   activate: (...args: unknown[]) => unknown,
 *   observe: (...args: unknown[]) => unknown,
 *   cleanupStaged: (...args: unknown[]) => unknown,
 *   rollback: (...args: unknown[]) => unknown
 * }>} AdapterLifecycle
 */

/**
 * Validate that a candidate module namespace exposes exactly the eight
 * mandatory lifecycle functions as named exports, and no default export.
 * Extra named exports (constants, internal helpers re-exported for testing)
 * are tolerated; a missing or non-function lifecycle export, or a present
 * default export, is not.
 *
 * @param {Record<string, unknown>} moduleNamespace an adapter module's
 *   exports (typically the result of `await import(specifier)`)
 * @returns {AdapterLifecycle} the frozen, validated lifecycle surface
 */
export function defineAdapter(moduleNamespace) {
  /** @type {import('./errors.js').ProtocolFinding[]} */
  const findings = [];

  if (Object.hasOwn(moduleNamespace, 'default')) {
    findings.push(
      finding(
        'ADAPTER_DEFAULT_EXPORT_FORBIDDEN',
        'ARTIFACT_SAFETY_ERROR',
        'An adapter module must not have a default export (DEC-094: named exports only).',
      ),
    );
  }

  /** @type {Record<string, unknown>} */
  const lifecycle = {};
  for (const operation of LIFECYCLE_OPERATIONS) {
    const candidate = moduleNamespace[operation];
    if (typeof candidate !== 'function') {
      findings.push(
        finding(
          'ADAPTER_LIFECYCLE_FUNCTION_MISSING',
          'ARTIFACT_SAFETY_ERROR',
          `Adapter module does not export a "${operation}" function.`,
          { location: `/${operation}` },
        ),
      );
      continue;
    }
    lifecycle[operation] = candidate;
  }

  if (findings.length > 0) {
    throw new AdapterProtocolError(
      'Adapter module does not implement the mandatory lifecycle interface',
      findings,
    );
  }

  return /** @type {AdapterLifecycle} */ (Object.freeze(lifecycle));
}
