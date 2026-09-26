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
export function loadAdapterModule(specifier: string): Promise<AdapterLifecycle>;
export type AdapterLifecycle = import("./lifecycle.js").AdapterLifecycle;
