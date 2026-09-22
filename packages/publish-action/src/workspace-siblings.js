/**
 * Shared LOCAL-only workspace-sibling resolution (FOLLOW-UP SUPPLY-CHAIN-JS,
 * 2026-09-17): `theme-bridge.js` and `template-bridge.js` both need to
 * locate a sibling repository checkout (`v2/theme-<name>`, `v2/template`)
 * from this package's own file location. Both bridges resolve from the
 * same directory (`packages/publish-action/src/`), so both use this one
 * resolver instead of each re-deriving the relative depth.
 *
 * Default behaviour (no env override) is unchanged from before this
 * module existed: resolve `../../../../<name>` from this file's own
 * location, i.e. `/Users/anand/ws/galascribe/v2/<name>` in the workspace
 * layout `orchestration/README.md`/`scrap/implementer-rules.md` describe.
 * This is a LOCAL-only workspace-layout convenience (LOCAL-4): never a path
 * a real Action run on a contributor's own machine or CI runner can rely on
 * (there is no `v2/<name>` sibling repository there at all in a single-repo
 * CI checkout — FOLLOW-UP SUPPLY-CHAIN-JS).
 *
 * `WORKSPACE_ROOT` (DEC-015 name) overrides the default: when set to a
 * non-empty string, every sibling resolves as `<WORKSPACE_ROOT>/<name>`
 * instead. This is the one escape hatch for running from a location where
 * the fixed relative default does not reach the siblings — for example a
 * git worktree one level deeper than the real checkout (LOCAL-38), where
 * `WORKSPACE_ROOT=/Users/anand/ws/galascribe/v2` is the real workspace root
 * and the relative default would resolve one level too high.
 *
 * This module only resolves paths; it never clones, installs, or executes
 * anything at the resolved location (`publish`'s repository `CLAUDE.md`:
 * this repository never clones a source repository, installs author
 * dependencies, or executes author build code).
 *
 * @module
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** This file's own directory, the fixed anchor for the relative default. */
const THIS_FILE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

/**
 * The LOCAL-only relative default from this file's own location to the
 * directory containing the sibling repository checkouts
 * (`packages/publish-action/src/` -> `../../../../` -> the workspace's
 * `v2/` directory).
 */
const DEFAULT_RELATIVE_WORKSPACE_ROOT = '../../../../';

/**
 * A named workspace sibling repository could not be found on disk at the
 * resolved location. Always names `WORKSPACE_ROOT` in its message so the
 * fix is discoverable without reading this module's source.
 */
export class WorkspaceSiblingNotFoundError extends Error {
  /**
   * @param {string} siblingName the sibling directory name that was sought
   *   (e.g. `template`, `theme-default`)
   * @param {string} searchedDirectory the absolute directory that was
   *   checked and not found
   */
  constructor(siblingName, searchedDirectory) {
    super(
      `workspace sibling "${siblingName}" was not found at ` +
        `${searchedDirectory}. This is a LOCAL-only convenience that expects ` +
        `a sibling checkout next to this repository; set WORKSPACE_ROOT to ` +
        'the directory containing the sibling repositories (e.g. ' +
        '/Users/anand/ws/galascribe/v2) to override the relative default.',
    );
    this.name = 'WorkspaceSiblingNotFoundError';
    this.siblingName = siblingName;
    this.searchedDirectory = searchedDirectory;
  }
}

/**
 * Resolve the workspace root directory that contains this repository's
 * sibling checkouts: `WORKSPACE_ROOT` (DEC-015 name) when set to a
 * non-empty string, otherwise the fixed relative default from this
 * module's own file location.
 *
 * @param {NodeJS.ProcessEnv} [env] the process environment (injectable for
 *   tests; defaults to `process.env`)
 * @returns {string} the absolute workspace root directory
 */
export function resolveWorkspaceRoot(env = process.env) {
  const override = env.WORKSPACE_ROOT;
  if (override && override.length > 0) {
    return path.resolve(override);
  }
  return path.resolve(THIS_FILE_DIRECTORY, DEFAULT_RELATIVE_WORKSPACE_ROOT);
}

/**
 * Resolve one named sibling repository checkout's absolute directory under
 * {@link resolveWorkspaceRoot}. This does not check the directory actually
 * exists — callers that require existence check it themselves (typically
 * as one candidate among several, or to raise
 * {@link WorkspaceSiblingNotFoundError} when it does not).
 *
 * @param {string} siblingName the sibling repository's directory name
 *   (e.g. `template`, `theme-default`)
 * @param {NodeJS.ProcessEnv} [env] the process environment (injectable for
 *   tests; defaults to `process.env`)
 * @returns {string} the absolute candidate directory
 */
export function resolveWorkspaceSibling(siblingName, env = process.env) {
  return path.join(resolveWorkspaceRoot(env), siblingName);
}
