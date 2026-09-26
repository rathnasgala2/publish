#!/usr/bin/env node
/**
 * CI guard (PUB-C1, 2026-09-25): every published package's `package.json`
 * declares an Apache-2.0 licence and lists `"LICENSE"` in `files`, but
 * `files` entries that do not resolve to a real path are silently dropped
 * by `npm pack` -- no warning, no error. That let all six live
 * `@rathnasgala2/*` packages ship tarballs with zero licence text while
 * claiming Apache-2.0.
 *
 * This check runs `npm pack --dry-run --json` for every workspace package
 * and fails the build if `LICENSE` is not among the files npm would
 * actually include in the tarball.
 */
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { runIfMain } from './run-if-main.mjs';

/**
 * @param {string} workspace the workspace package directory name
 * @returns {Promise<string[]>} every file path `npm pack` would include
 */
export function packedFiles(workspace) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npm',
      ['pack', '--dry-run', '--json', '-w', `packages/${workspace}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`npm pack --dry-run failed for ${workspace}: ${stderr}`),
        );
        return;
      }
      try {
        const [entry] = JSON.parse(stdout);
        resolve(entry.files.map((/** @type {{path: string}} */ f) => f.path));
      } catch (error) {
        reject(
          new Error(
            `could not parse npm pack --dry-run --json output for ${workspace}: ${String(error)}`,
          ),
        );
      }
    });
  });
}

/**
 * @param {string} name workspace package directory name
 * @param {string[]} files every file path `npm pack` would include for it
 * @returns {string[]} zero or one diagnostic for this package
 */
export function missingLicenseDiagnostics(name, files) {
  if (files.includes('LICENSE')) {
    return [];
  }
  return [
    `packages/${name}: npm pack --dry-run would not include LICENSE ` +
      `in the tarball (files: ${files.join(', ')}).`,
  ];
}

/**
 * @returns {Promise<void>} resolves when every package's tarball would
 *   include LICENSE
 */
async function main() {
  const packageNames = (await readdir('packages')).sort();
  /** @type {string[]} */
  const diagnostics = [];
  for (const name of packageNames) {
    const files = await packedFiles(name);
    diagnostics.push(...missingLicenseDiagnostics(name, files));
  }
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `LICENSE present in the packed tarball of all ${packageNames.length} package(s).`,
  );
}

await runIfMain(import.meta.url, main);
