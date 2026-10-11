#!/usr/bin/env node
/**
 * Source-delivery guard: generation 4 is intentionally not published to npm.
 * Every schema-consuming workspace package therefore resolves the one
 * committed, manifest-verified tarball owned by this repository. Mutable
 * sibling directories, registry ranges and the old untracked
 * `local-packages/*.tgz` convention remain forbidden.
 */
import { readFile, readdir } from 'node:fs/promises';

import { runIfMain } from './run-if-main.mjs';

const FORBIDDEN = [
  /file:.*local-packages/u,
  /local-packages\/rathnasgala2-schemas-/u,
  /file:\.\.\/\.\.\/\.\.\/schema/u,
];
const EXPECTED_SPECIFIER =
  'file:../../vendor/packages/rathnasgala2-schemas-3.8.0.tgz';

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
          '@rathnasgala2/schemas must resolve the committed publish-owned ' +
          'vendor tarball; sibling and local-packages references are forbidden.',
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
  for (const name of packageNames) {
    const path = `packages/${name}/package.json`;
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    const schemaSpecifier = manifest.dependencies?.['@rathnasgala2/schemas'];
    if (
      schemaSpecifier !== undefined &&
      schemaSpecifier !== EXPECTED_SPECIFIER
    ) {
      diagnostics.push(
        `${path}: @rathnasgala2/schemas must be ${EXPECTED_SPECIFIER} for source-only generation-4 delivery.`,
      );
    }
  }
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `schema consumers use the committed 3.8.0 vendor tarball; no sibling or untracked local tarball found across ${files.length} file(s).`,
  );
}

await runIfMain(import.meta.url, main);
