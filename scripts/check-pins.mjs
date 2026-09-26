/**
 * The pin ledger gate (S4-T08).
 *
 * `scripts/check-workflow-pins.mjs` proves every workflow reference is
 * *some* immutable identity. This script proves something stronger and in
 * both directions: every action reference in `.github/workflows` and
 * `docs/callers` is recorded in `pins/ledger.json` at exactly that SHA, and
 * every ledger entry is actually used by a file in this repository. A pin
 * that drifts, a pin added to a workflow without a ledger entry, and a
 * ledger entry left behind after its last use are all failures.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { runIfMain } from './run-if-main.mjs';

const SEARCH_DIRECTORIES = ['.github/workflows', 'docs/callers'];
const ACTION_REFERENCE =
  /uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)@([0-9a-f]{40})/gu;

/**
 * Read every YAML file under one directory, tolerating its absence.
 *
 * @param {string} directory the directory to read
 * @returns {Promise<{file: string, source: string}[]>} the files
 */
async function readYamlFiles(directory) {
  /** @type {{file: string, source: string}[]} */
  const files = [];
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return files;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) {
      continue;
    }
    const file = path.join(directory, entry.name);
    files.push({ file, source: await readFile(file, 'utf8') });
  }
  return files;
}

/**
 * Compare the ledger and the repository in both directions.
 *
 * @param {Record<string, any>} ledger the parsed ledger
 * @param {readonly {file: string, source: string}[]} yamlFiles the YAML files
 * @param {readonly {file: string, source: string}[]} otherFiles other files
 *   that may reference a container image or binary pin
 * @returns {string[]} one diagnostic per disagreement
 */
export function comparePins(ledger, yamlFiles, otherFiles) {
  /** @type {string[]} */
  const diagnostics = [];
  /** @type {Map<string, string>} */
  const declared = new Map(
    ledger.actions.map((/** @type {any} */ entry) => [
      entry.reference,
      entry.sha,
    ]),
  );
  /** @type {Map<string, string>} */
  const selfReferences = new Map(
    (ledger.selfReferences ?? []).map((/** @type {any} */ entry) => [
      entry.reference,
      entry.sha,
    ]),
  );
  /** @type {Set<string>} */
  const seen = new Set();

  for (const { file, source } of yamlFiles) {
    for (const match of source.matchAll(ACTION_REFERENCE)) {
      const reference = String(match[1]);
      const sha = String(match[2]);
      if (reference.startsWith('rathnasgala2/publish/')) {
        // A reference back into this repository is the author-replaced
        // caller pin, not a third-party action: it is recorded separately
        // in pins/ledger.json's selfReferences, pinned to a real commit SHA
        // now that W0-01 has published this repository.
        const expectedSelf = selfReferences.get(reference);
        if (expectedSelf === undefined) {
          diagnostics.push(
            `${file}: ${reference} is a self-reference with no pins/ledger.json selfReferences entry`,
          );
        } else if (expectedSelf !== sha) {
          diagnostics.push(
            `${file}: ${reference} is pinned to ${sha} but the ledger records ${expectedSelf}`,
          );
        }
        continue;
      }
      seen.add(reference);
      const expected = declared.get(reference);
      if (expected === undefined) {
        diagnostics.push(
          `${file}: ${reference}@${sha} is not recorded in pins/ledger.json`,
        );
      } else if (expected !== sha) {
        diagnostics.push(
          `${file}: ${reference} is pinned to ${sha} but the ledger records ${expected}`,
        );
      }
    }
  }

  for (const reference of declared.keys()) {
    if (!seen.has(reference)) {
      diagnostics.push(
        `pins/ledger.json: ${reference} is recorded but no workflow uses it`,
      );
    }
  }

  const haystack = [...yamlFiles, ...otherFiles]
    .map((entry) => entry.source)
    .join('\n');
  for (const image of ledger.containerImages) {
    if (!haystack.includes(image.reference)) {
      diagnostics.push(
        `pins/ledger.json: container image ${image.name} is recorded at a digest no file in this repository uses`,
      );
    }
  }
  for (const binary of ledger.binaries) {
    if (!haystack.includes(binary.sha256)) {
      diagnostics.push(
        `pins/ledger.json: binary ${binary.name} is recorded at a checksum no file in this repository uses`,
      );
    }
  }
  return diagnostics;
}

/**
 * @returns {Promise<void>} resolves when every pin agrees
 */
async function main() {
  const ledger = JSON.parse(await readFile('pins/ledger.json', 'utf8'));
  /** @type {{file: string, source: string}[]} */
  const yamlFiles = [];
  for (const directory of SEARCH_DIRECTORIES) {
    yamlFiles.push(...(await readYamlFiles(directory)));
  }
  /** @type {{file: string, source: string}[]} */
  const otherFiles = [];
  for (const file of [
    'scripts/sandbox-build.sh',
    'scripts/minio-spaces.sh',
    'scripts/workflow/build-provenance.mjs',
    'package.json',
    'package-lock.json',
    ...(await readdir('packages')).map(
      (name) => `packages/${name}/package.json`,
    ),
  ]) {
    otherFiles.push({ file, source: await readFile(file, 'utf8') });
  }

  const diagnostics = comparePins(ledger, yamlFiles, otherFiles);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  process.stdout.write(
    `Verified ${ledger.actions.length} action pin(s), ${ledger.containerImages.length} image digest(s) and ${ledger.binaries.length} binary checksum(s).\n`,
  );
}

await runIfMain(import.meta.url, main);
