#!/usr/bin/env node
/**
 * CI guard (PUB-H1, PUB-H3, PUB-H7, 2026-09-25): one manifest-shape gate
 * that every published package's manifest must pass. Asserts:
 *
 * - PUB-H1: `engines.node` states a compatibility floor (`>=`), never an
 *   exact build-time toolchain version, and no package declares
 *   `engines.npm` at all (the build toolchain pin belongs in `devEngines`
 *   at the workspace root, not on a published library).
 * - PUB-H3: every in-workspace runtime `dependencies` entry is a caret
 *   range, so a consumer's resolver can deduplicate to one copy.
 *   `@rathnasgala2/schemas` is exempt: CLAUDE.md records that its exact pin
 *   is deliberate (no re-authoring, no range drift against the published
 *   contract source).
 * - PUB-H7: `repository`, `homepage`, `bugs` and `keywords` are present,
 *   and `repository.directory` matches the package's own path.
 * - PUB-M11: `sideEffects` is exactly `false`, so a bundler can tree-shake
 *   these side-effect-free barrel entry points instead of conservatively
 *   retaining the whole package.
 */
import { readFile, readdir } from 'node:fs/promises';

import { runIfMain } from './run-if-main.mjs';

const SCOPE = '@rathnasgala2';
const SCHEMAS_PACKAGE = `${SCOPE}/schemas`;
const REPO_URL = 'git+https://github.com/rathnasgala2/publish.git';

/**
 * @param {string} name workspace package directory name
 * @param {Record<string, unknown>} manifest parsed package.json
 * @param {ReadonlySet<string>} workspacePackageNames every in-workspace
 *   package's published name
 * @returns {string[]} diagnostics for this one manifest
 */
export function checkOne(name, manifest, workspacePackageNames) {
  /** @type {string[]} */
  const diagnostics = [];
  const manifestPath = `packages/${name}/package.json`;

  // PUB-H1
  const engines = /** @type {Record<string, unknown> | undefined} */ (
    manifest.engines
  );
  const node = engines?.node;
  if (typeof node !== 'string' || !node.startsWith('>=')) {
    diagnostics.push(
      `${manifestPath}: engines.node must be a floor ("${'>='}x.y.z"), got ${JSON.stringify(node)}.`,
    );
  }
  if (engines !== undefined && 'npm' in engines) {
    diagnostics.push(
      `${manifestPath}: engines.npm must not be set on a published package; pin the toolchain in root devEngines instead.`,
    );
  }

  // PUB-H3
  const dependencies = /** @type {Record<string, string> | undefined} */ (
    manifest.dependencies
  );
  for (const [depName, range] of Object.entries(dependencies ?? {})) {
    if (!workspacePackageNames.has(depName) || depName === SCHEMAS_PACKAGE) {
      continue;
    }
    if (!range.startsWith('^')) {
      diagnostics.push(
        `${manifestPath}: dependencies["${depName}"] must be a caret range ("^${range}"), got ${JSON.stringify(range)}.`,
      );
    }
  }

  // PUB-H7
  const repository =
    /** @type {{type?: string, url?: string, directory?: string} | undefined} */ (
      manifest.repository
    );
  const expectedDirectory = `packages/${name}`;
  if (
    repository?.type !== 'git' ||
    repository.url !== REPO_URL ||
    repository.directory !== expectedDirectory
  ) {
    diagnostics.push(
      `${manifestPath}: repository must be {"type":"git","url":${JSON.stringify(
        REPO_URL,
      )},"directory":${JSON.stringify(expectedDirectory)}}.`,
    );
  }
  if (typeof manifest.homepage !== 'string' || manifest.homepage.length === 0) {
    diagnostics.push(`${manifestPath}: homepage must be a non-empty string.`);
  }
  const bugs = /** @type {{url?: string} | undefined} */ (manifest.bugs);
  if (typeof bugs?.url !== 'string' || bugs.url.length === 0) {
    diagnostics.push(`${manifestPath}: bugs.url must be a non-empty string.`);
  }
  const keywords = manifest.keywords;
  if (!Array.isArray(keywords) || keywords.length === 0) {
    diagnostics.push(`${manifestPath}: keywords must be a non-empty array.`);
  }

  // PUB-M11
  if (manifest.sideEffects !== false) {
    diagnostics.push(
      `${manifestPath}: sideEffects must be exactly false, got ${JSON.stringify(manifest.sideEffects)}.`,
    );
  }

  return diagnostics;
}

/**
 * @returns {Promise<void>} resolves when every package manifest conforms
 */
async function main() {
  const packageDirs = (await readdir('packages')).sort();
  /** @type {Map<string, Record<string, unknown>>} */
  const manifestsByDir = new Map();
  for (const dir of packageDirs) {
    manifestsByDir.set(
      dir,
      JSON.parse(await readFile(`packages/${dir}/package.json`, 'utf8')),
    );
  }
  const workspacePackageNames = new Set(
    [...manifestsByDir.values()].map(
      (manifest) => /** @type {string} */ (manifest.name),
    ),
  );

  /** @type {string[]} */
  const diagnostics = [];
  for (const [dir, manifest] of manifestsByDir) {
    diagnostics.push(...checkOne(dir, manifest, workspacePackageNames));
  }

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `manifest:check: ${manifestsByDir.size} package(s) conform (engines floor, caret in-workspace ranges, repository/homepage/bugs/keywords, sideEffects: false).`,
  );
}

await runIfMain(import.meta.url, main);
