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
export function defineAdapter(moduleNamespace: Record<string, unknown>): AdapterLifecycle;
/**
 * The exact eight lifecycle function names, in the order the brief lists
 * them. Order carries no semantic meaning for adapter admission (it is
 * compared as a set), but this constant is also the canonical iteration
 * order used when describing or invoking a lifecycle.
 */
export const LIFECYCLE_OPERATIONS: readonly string[];
export type AdapterLifecycle = Readonly<{
    describeCapabilities: (...args: unknown[]) => unknown;
    inspectDestination: (...args: unknown[]) => unknown;
    preflight: (...args: unknown[]) => unknown;
    stage: (...args: unknown[]) => unknown;
    activate: (...args: unknown[]) => unknown;
    observe: (...args: unknown[]) => unknown;
    cleanupStaged: (...args: unknown[]) => unknown;
    rollback: (...args: unknown[]) => unknown;
}>;
