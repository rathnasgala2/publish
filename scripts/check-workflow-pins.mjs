import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { runIfMain } from './run-if-main.mjs';

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;
const IMMUTABLE_CONTAINER_DIGEST = /^docker:\/\/[^\s@]+@sha256:[0-9a-f]{64}$/u;

/**
 * Return external action references that are not pinned to immutable identities.
 *
 * @param {string} source workflow YAML source
 * @param {string} file workflow path used in diagnostics
 * @returns {string[]} stable diagnostics
 */
export function findUnpinnedActionReferences(source, file) {
  const diagnostics = [];
  const actionReference = /^\s*-?\s*uses:\s*([^\s#]+).*$/gmu;

  for (const match of source.matchAll(actionReference)) {
    const reference = match[1];
    if (reference === undefined || reference.startsWith('./')) {
      continue;
    }

    if (reference.startsWith('docker://')) {
      if (!IMMUTABLE_CONTAINER_DIGEST.test(reference)) {
        diagnostics.push(
          `${file}: ${reference} is not pinned by sha256 digest`,
        );
      }
      continue;
    }

    const separator = reference.lastIndexOf('@');
    const revision = separator === -1 ? '' : reference.slice(separator + 1);
    if (!FULL_COMMIT_SHA.test(revision)) {
      diagnostics.push(
        `${file}: ${reference} is not pinned to a full commit SHA`,
      );
    }
  }

  return diagnostics;
}

async function main() {
  const workflowDirectory = path.resolve('.github/workflows');
  // This repository has no `.github/workflows` directory yet (DEC-016: no
  // CI workflows are owned here today). Treat a missing directory as zero
  // workflow files to verify — a deliberate trivial pass, not an oversight —
  // rather than letting the ENOENT from readdir fail the gate.
  let entries;
  try {
    entries = await readdir(workflowDirectory, { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      process.stdout.write(
        'No .github/workflows directory found: 0 workflow file(s) to verify.\n',
      );
      return;
    }
    throw error;
  }
  const workflowNames = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')),
    )
    .map((entry) => entry.name)
    .sort();

  const diagnostics = [];
  for (const workflowName of workflowNames) {
    const workflowPath = path.join(workflowDirectory, workflowName);
    const source = await readFile(workflowPath, 'utf8');
    diagnostics.push(...findUnpinnedActionReferences(source, workflowPath));
  }

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }

  process.stdout.write(
    `Verified ${workflowNames.length} workflow file(s): all external references are immutable.\n`,
  );
}

await runIfMain(import.meta.url, main);
