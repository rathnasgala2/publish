#!/usr/bin/env node
/**
 * CI guard (contract re-pin packet, 2026-09-22): fails the build if
 * `@rathnasgala2/schemas` is ever pinned back to the LOCAL-1 local-tarball
 * convention (`file:../../../../local-packages/rathnasgala2-schemas-*.tgz`)
 * in the workspace root manifest/lockfile or in any workspace package's own
 * `package.json`. That convention was retired once `@rathnasgala2/schemas`
 * published to the registry; a GitHub Actions runner has no
 * `local-packages` directory, so a regression here previously surfaced only
 * as an opaque `ENOENT` in CI. This check fails loudly and locally instead.
 */
import { readFile, readdir } from 'node:fs/promises';

import { runIfMain } from './run-if-main.mjs';

const FORBIDDEN = [
  /file:.*local-packages/u,
  /local-packages\/rathnasgala2-schemas-/u,
];

/**
 * @param {string} path the file to scan
 * @returns {Promise<string[]>} one diagnostic per forbidden match found
 */
async function checkFile(path) {
  /** @type {string[]} */
  const diagnostics = [];
  const text = await readFile(path, 'utf8');
  for (const pattern of FORBIDDEN) {
    if (pattern.test(text)) {
      diagnostics.push(
        `${path}: found a local-tarball schema reference (${pattern}). ` +
          '@rathnasgala2/schemas must be pinned to a registry version; ' +
          'the file:../local-packages/... convention (LOCAL-1) is retired.',
      );
    }
  }
  return diagnostics;
}

/**
 * @returns {Promise<void>} resolves when no forbidden reference is found
 */
async function main() {
  const packageNames = await readdir('packages');
  const files = [
    'package.json',
    'package-lock.json',
    ...packageNames.map((name) => `packages/${name}/package.json`),
  ];
  const diagnostics = (await Promise.all(files.map(checkFile))).flat();
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `no local-tarball @rathnasgala2/schemas reference found across ${files.length} file(s).`,
  );
}

await runIfMain(import.meta.url, main);
