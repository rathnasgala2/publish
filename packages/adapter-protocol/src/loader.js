/**
 * In-process adapter loading. S2 adapters are ordinary ESM modules imported
 * directly into the kernel's process (DEC-097 section 1, product-owner
 * override: "In S2 adapters are in-process ESM modules; `adapter-message:2.0.0`
 * framing is not implemented."). This loader is the one admitted way to
 * obtain a validated {@link AdapterLifecycle} from a module specifier; it
 * performs no process spawn, no socket, and no out-of-process handshake.
 *
 * @module
 */

import { defineAdapter } from './lifecycle.js';

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
export async function loadAdapterModule(specifier) {
  const moduleNamespace = /** @type {Record<string, unknown>} */ (
    await import(specifier)
  );
  return defineAdapter(moduleNamespace);
}
