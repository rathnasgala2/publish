#!/usr/bin/env node
/**
 * CI guard (PUB-H2, 2026-09-25): every published package's CHANGELOG had
 * exactly one heading, `## [Unreleased]`, even for versions already on npm
 * -- the shipped bytes described no released version at all, and several of
 * the "Unreleased" entries were marked breaking. Fail the build when a
 * package's own `version` has no matching `## [<version>]` heading in its
 * CHANGELOG, so cutting a release without cutting its CHANGELOG section is
 * caught here instead of by a consumer reading the shipped file.
 *
 * A package that has never been published (no `## [` heading at all besides
 * `Unreleased`) is exempt: it has no released version yet to document.
 */
import { readFile, readdir } from 'node:fs/promises';

import { runIfMain } from './run-if-main.mjs';

const HEADING_PATTERN = /^## \[([^\]]+)\]/gm;

/**
 * @param {string} changelogPath diagnostic path for this package's CHANGELOG
 * @param {string} changelog CHANGELOG.md contents
 * @param {string} version the package's current `package.json` version
 * @returns {string[]} zero or one diagnostic
 */
export function changelogDiagnostics(changelogPath, changelog, version) {
  const headings = [...changelog.matchAll(HEADING_PATTERN)].map(
    (match) => match[1],
  );
  const releasedHeadings = headings.filter((h) => h !== 'Unreleased');
  if (releasedHeadings.length === 0) {
    // Never published: nothing to check yet.
    return [];
  }
  if (!releasedHeadings.includes(version)) {
    return [
      `${changelogPath}: no "## [${version}]" heading for the current package.json version (found: ${releasedHeadings.join(', ') || 'none'}).`,
    ];
  }
  return [];
}

/**
 * @returns {Promise<void>} resolves when every package's CHANGELOG carries a
 *   heading for its current `package.json` version
 */
async function main() {
  const packageDirs = (await readdir('packages')).sort();
  /** @type {string[]} */
  const diagnostics = [];

  for (const dir of packageDirs) {
    const manifest = JSON.parse(
      await readFile(`packages/${dir}/package.json`, 'utf8'),
    );
    const changelogPath = `packages/${dir}/CHANGELOG.md`;
    const changelog = await readFile(changelogPath, 'utf8');
    diagnostics.push(
      ...changelogDiagnostics(changelogPath, changelog, manifest.version),
    );
  }

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `changelog:check: every published package's CHANGELOG has a heading for its current version.`,
  );
}

await runIfMain(import.meta.url, main);
