/**
 * @typedef {import('./lifecycle.js').AdapterLifecycle} AdapterLifecycle
 */
/**
 * Import an adapter module in-process and validate its lifecycle surface.
 *
 * @param {string} specifier an ESM module specifier resolvable from this
 *   package (a bare package specifier such as
 *   `@rathnasgala2/adapter-local-directory`, or a `file:`/relative URL)
 * @returns {Promise<AdapterLifecycle>} the validated lifecycle surface
 */
export function loadAdapterModule(specifier: string): Promise<AdapterLifecycle>;
export type AdapterLifecycle = import("./lifecycle.js").AdapterLifecycle;
