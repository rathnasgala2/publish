#!/usr/bin/env node
/**
 * Registry guard: every schema-consuming workspace package pins the exact
 * registry release of `@rathnasgala2/schemas`. Mutable sibling directories,
 * ranges and the old untracked `local-packages/*.tgz` convention are
 * forbidden.
 */
import { readFile, readdir } from 'node:fs/promises';

import { runIfMain } from './run-if-main.mjs';
import {
  ADAPTER_FAMILY_SPECIFIER,
  EXPECTED_SPECIFIER,
  expectedSchemasSpecifier,
} from './schema-pins.mjs';

const FORBIDDEN = [
  /file:.*local-packages/u,
  /local-packages\/rathnasgala2-schemas-/u,
  /file:\.\.\/\.\.\/\.\.\/schema/u,
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
          '@rathnasgala2/schemas must be pinned to the registry version; ' +
          'sibling and local-packages references are forbidden.',
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
    const expected = expectedSchemasSpecifier(name);
    if (schemaSpecifier !== undefined && schemaSpecifier !== expected) {
      diagnostics.push(
        `${path}: @rathnasgala2/schemas must be ${expected} exactly.`,
      );
    }
  }
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `schema consumers pin registry ${EXPECTED_SPECIFIER} (adapter family ${ADAPTER_FAMILY_SPECIFIER}); no sibling or untracked local tarball found across ${files.length} file(s).`,
  );
}

await runIfMain(import.meta.url, main);
