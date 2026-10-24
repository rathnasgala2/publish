#!/usr/bin/env node
/**
 * Structural guard for the generation-4 delivery decision. The toolchain is
 * consumed by commit, so only the adapter protocol and the destination adapters
 * (installed by npm consumers) may be publishable, and no owned workflow may
 * invoke npm's publication command except `release.yaml`, the one
 * workflow that publishes those four packages through npm trusted publishing
 * (`test/adapter-release.test.mjs` pins its shape).
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { runIfMain } from './run-if-main.mjs';

/** The only workflows allowed to invoke the publication command. */
const PUBLISHING_WORKFLOWS = new Set(['release.yaml']);

/**
 * @returns {Promise<void>} resolves only when npm publication is disabled
 */
async function main() {
  const publishable = new Set([
    'adapter-protocol',
    'adapter-local-directory',
    'adapter-github-pages',
    'adapter-do-spaces',
  ]);
  /** @type {string[]} */
  const diagnostics = [];
  const packageNames = (await readdir('packages')).sort();
  for (const packageName of packageNames) {
    const manifestPath = path.join('packages', packageName, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (publishable.has(packageName)) {
      if (manifest.private === true) {
        diagnostics.push(
          `${manifestPath}: published packages (the adapter protocol and the destination adapters) must not be private`,
        );
      }
    } else if (manifest.private !== true) {
      diagnostics.push(
        `${manifestPath}: private must be true during source-only delivery`,
      );
    }
  }

  const workflowRoot = path.join('.github', 'workflows');
  const workflowNames = (await readdir(workflowRoot))
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();
  for (const workflowName of workflowNames) {
    const workflowPath = path.join(workflowRoot, workflowName);
    const source = await readFile(workflowPath, 'utf8');
    if (
      !PUBLISHING_WORKFLOWS.has(workflowName) &&
      /\bnpm\s+publish\b/u.test(source)
    ) {
      diagnostics.push(
        `${workflowPath}: npm publish is forbidden outside ${[...PUBLISHING_WORKFLOWS].join(', ')}`,
      );
    }
  }

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  process.stdout.write(
    `source-only: ${packageNames.length} workspace packages are checked (protocol and adapters publishable, the rest private) and ${workflowNames.filter((name) => !PUBLISHING_WORKFLOWS.has(name)).length} of ${workflowNames.length} workflows contain no npm publish command (the rest: ${[...PUBLISHING_WORKFLOWS].join(', ')})\n`,
  );
}

await runIfMain(import.meta.url, main);
