/**
 * Single source of truth for the exact `@rathnasgala2/schemas` release each
 * workspace package pins. Read by the schema-pin guard and by the pins test.
 */
export const EXPECTED_SPECIFIER = '3.19.0';
// The adapter family stays on the schemas release its published packs were built
// against, so the artifact catalog digests keep equalling the deterministic packs.
export const ADAPTER_FAMILY_SPECIFIER = '3.8.0';
export const ADAPTER_FAMILY = new Set([
  'adapter-protocol',
  'adapter-conformance-kit',
  'adapter-local-directory',
  'adapter-github-pages',
  'adapter-do-spaces',
]);

/**
 * @param {string} name the workspace package directory name
 * @returns {string} the exact schemas specifier that package must declare
 */
export function expectedSchemasSpecifier(name) {
  return ADAPTER_FAMILY.has(name)
    ? ADAPTER_FAMILY_SPECIFIER
    : EXPECTED_SPECIFIER;
}
