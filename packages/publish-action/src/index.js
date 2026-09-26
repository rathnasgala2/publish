/**
 * `@rathnasgala2/publish-action`: the author-facing publish orchestration
 * entry, in two invocation shapes over one implementation (S2-T20): the
 * GitHub Action (`action.yml`, `src/action/run.js`) and the local `npx`
 * subcommands `validate`, `build` and `preview` (`src/bin/cli.js`). See
 * `README.md` for the full specification this package implements.
 *
 * This public entry re-exports the composition-root building blocks the
 * `npx` subcommands and the Action entry are both built from, so a test or
 * another in-process caller can drive them without going through the CLI's
 * `argv`/`process.exit` surface.
 *
 * @module
 */

export { runValidate } from './commands/validate.js';
export { runBuild } from './commands/build.js';
export { runPreview, serveDirectoryReadOnly } from './commands/preview.js';
export {
  buildBuildInputFromRepository,
  RepositoryIntakeError,
} from './normalize/repository-intake.js';
export { buildProvenance } from './normalize/provenance.js';
export { resolveThemeDirectory, ThemeResolutionError } from './theme-bridge.js';
export { deployToLocalDirectory } from './deploy-local-directory.js';
export { assertImplementedAdapter } from './adapter-select.js';
export { runAction } from './action/run.js';
export { buildResultEnvelope, classifyFindings, EXIT_CODES } from './result.js';
export { SchemaValidationError } from './schema.js';
export * from './types.js';

/** Package readiness marker. */
export const PACKAGE_STATUS = Object.freeze({
  name: '@rathnasgala2/publish-action',
  implemented: true,
  implementingTask: 'S2-T20b',
});
