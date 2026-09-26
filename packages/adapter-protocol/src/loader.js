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

import { AdapterProtocolError, finding } from './errors.js';
import { defineAdapter } from './lifecycle.js';

/**
 * @typedef {import('./lifecycle.js').AdapterLifecycle} AdapterLifecycle
 */

/**
 * The exact three admitted adapter package specifiers (PUB-M8): the
 * protocol's own admission table already closes the `adapterId` vocabulary
 * to these three, so a specifier allowlist here costs nothing and closes
 * the gap between "three admitted adapters" and "any module specifier a
 * caller can construct".
 */
const ADMITTED_BARE_SPECIFIERS = Object.freeze(
  new Set([
    '@rathnasgala2/adapter-local-directory',
    '@rathnasgala2/adapter-github-pages',
    '@rathnasgala2/adapter-do-spaces',
  ]),
);

/**
 * Test whether a specifier is one this loader admits without further
 * opt-in: one of the three admitted package specifiers, or a `file:` URL
 * (the documented way to load a local fixture or a not-yet-published
 * adapter build).
 *
 * @param {string} specifier candidate module specifier
 * @returns {boolean} whether the specifier is admitted
 */
function isAdmittedSpecifier(specifier) {
  return (
    ADMITTED_BARE_SPECIFIERS.has(specifier) || specifier.startsWith('file:')
  );
}

/**
 * Import an adapter module in-process and validate its lifecycle surface.
 *
 * @param {string} specifier an ESM module specifier: one of the three
 *   admitted adapter package specifiers (`@rathnasgala2/adapter-local-directory`,
 *   `@rathnasgala2/adapter-github-pages`, `@rathnasgala2/adapter-do-spaces`)
 *   or a `file:` URL. Anything else — a bare specifier this loader does not
 *   admit, a relative path, an `http:`/`https:` URL — is refused before any
 *   `import()` is attempted; this is a defense-in-depth allowlist, not a
 *   substitute for treating the argument as trusted configuration.
 * @returns {Promise<AdapterLifecycle>} the validated lifecycle surface
 */
export async function loadAdapterModule(specifier) {
  if (!isAdmittedSpecifier(specifier)) {
    throw new AdapterProtocolError(
      `loadAdapterModule refuses an unadmitted specifier: ${JSON.stringify(specifier)}`,
      [
        finding(
          'ADAPTER_SPECIFIER_NOT_ADMITTED',
          'SOURCE_ERROR',
          `${JSON.stringify(specifier)} is not one of the three admitted adapter package specifiers and is not a file: URL`,
        ),
      ],
    );
  }
  const moduleNamespace = /** @type {Record<string, unknown>} */ (
    await import(specifier)
  );
  return defineAdapter(moduleNamespace);
}
