/**
 * `@rathnasgala2/template` consumption bridge.
 *
 * `v2/template` is a full sibling repository with its own independently
 * installed `node_modules` (including its own copy of
 * `@rathnasgala2/schemas`). Adding it as an npm `file:` dependency of this
 * workspace makes `npm ls`/`cyclonedx-npm` (this workspace's SBOM generator)
 * crawl into that foreign `node_modules` tree and report an unrelated
 * "invalid" package there — the exact friction point
 * `packages/adapter-local-directory/test/e2e-kernel-template.test.js`
 * documents and works around by resolving `v2/template`'s package root
 * directly from this file's own path and dynamically importing exactly the
 * module `template`'s own `package.json` `exports` map publishes for `.`
 * (`src/core/index.js`). This module is `publish-action`'s one place doing
 * the same thing for production code (the composition root), so every
 * caller (the `npx` subcommands and the GitHub Action entry) shares one
 * resolution path instead of re-deriving `TEMPLATE_ROOT`.
 *
 * `template@2.1.0` publishes `computeRenderPolicyIdentity` from its public
 * entry point (`src/core/index.js`), so this bridge no longer reaches into
 * `internal/content-security.js` (PUB-H5's deferred half, closed once
 * `template` shipped the public helper).
 *
 * `TEMPLATE_ROOT`'s resolution (fixed relative sibling, or the
 * `WORKSPACE_ROOT` override) is shared with `theme-bridge.js` via
 * `workspace-siblings.js` (FOLLOW-UP SUPPLY-CHAIN-JS, 2026-09-17): a CI
 * checkout has no `v2/template` sibling at all, so the fixed relative
 * default alone cannot work there.
 *
 * @module
 */

import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  resolveWorkspaceSibling,
  WorkspaceSiblingNotFoundError,
} from './workspace-siblings.js';

/**
 * The `v2/template` sibling repository's root: `<WORKSPACE_ROOT>/template`
 * when `WORKSPACE_ROOT` is set, otherwise the fixed relative default from
 * this file's own path. Resolved once at import time from `process.env`
 * (this export has no per-call env override; set `WORKSPACE_ROOT` before
 * this module is first imported).
 */
export const TEMPLATE_ROOT = resolveWorkspaceSibling('template');

/**
 * @param {string} candidate an absolute path
 * @returns {Promise<boolean>} whether `candidate` exists and is a directory
 *   (never throws)
 */
async function isDirectory(candidate) {
  try {
    return (await lstat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve one `@rathnasgala2/template` module by absolute path, rooted at
 * {@link TEMPLATE_ROOT}. Fails closed with a clear
 * {@link WorkspaceSiblingNotFoundError} (naming `WORKSPACE_ROOT`) when
 * `TEMPLATE_ROOT` itself does not exist on disk, instead of letting a raw
 * module-not-found error escape.
 *
 * @param {string} relativePath a path relative to the `template` package root
 * @returns {Promise<Record<string, unknown>>} the imported module namespace
 */
async function importTemplateModule(relativePath) {
  if (!(await isDirectory(TEMPLATE_ROOT))) {
    throw new WorkspaceSiblingNotFoundError('template', TEMPLATE_ROOT);
  }
  return /** @type {Record<string, unknown>} */ (
    await import(pathToFileURL(path.join(TEMPLATE_ROOT, relativePath)).href)
  );
}

/**
 * `template`'s documented public entry point
 * (`renderPublication`, `normalizeAuthoredMarkdown`, `computeBodyDigest`,
 * the typed error classes, `TEMPLATE_PACKAGE_NAME`/`TEMPLATE_PACKAGE_VERSION`).
 *
 * @returns {Promise<Record<string, unknown>>} the public module namespace
 */
export function importTemplatePublicEntry() {
  return importTemplateModule('src/core/index.js');
}

/**
 * The current published render-policy identity
 * (`{name, version, digest}`), reached through `template`'s public entry
 * point (see module documentation above for why this no longer reaches into
 * `internal/`).
 *
 * @returns {Promise<{name: string, version: string, digest: string}>}
 *   the current renderPolicyIdentity
 */
export async function currentRenderPolicyIdentity() {
  const publicEntry = await importTemplateModule('src/core/index.js');
  const compute =
    /** @type {() => Promise<{name: string, version: string, digest: string}>} */ (
      publicEntry.computeRenderPolicyIdentity
    );
  return compute();
}
