#!/usr/bin/env node
/**
 * PUB-M9: a coverage ratchet. `npm run verify` has no coverage step, and
 * `publish-kernel`'s `test:coverage` script is defined but called by
 * nothing. This runs `node --test --experimental-test-coverage` per
 * workspace package and fails the gate if a package's line or branch
 * percentage drops below the floor recorded in `coverage-thresholds.json`
 * (a small tolerance absorbs floating-point rounding). It never lowers a
 * floor itself -- raising one after a genuine improvement is a deliberate,
 * reviewed edit to that file.
 *
 * `--test-coverage-include=src/**\/*.js` (PUB-H5) scopes the measured
 * percentage to each package's own `src/` tree. Without it, Node's
 * `--experimental-test-coverage` instruments every module the test process
 * actually loads, including a workspace-sibling package
 * (`adapter-protocol` from `publish-kernel`'s own tests) and, for
 * `adapter-local-directory`/`publish-action`, the real `v2/template`
 * sibling repository reached by absolute path (`template-bridge.js`) -- so
 * a template/theme-default release that changes how much of *their* code a
 * test exercises silently moves *this* package's recorded percentage
 * without a single line here changing. Pinning `template`/`theme-default`
 * to 2.1.0 (PUB-H5) surfaced exactly that: `adapter-local-directory`'s and
 * `publish-action`'s own `src/` coverage were unchanged byte-for-byte
 * (confirmed line-for-line against the pre-bump run), but the unscoped
 * aggregate moved because `template`'s own file set and branch shape
 * changed between 2.0.0 and 2.1.0. Scoping to `src/**\/*.js` makes every
 * floor in `coverage-thresholds.json` measure only what its own name says
 * it measures.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runIfMain } from './run-if-main.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOLERANCE = 0.05;

/**
 * @param {string} output the test runner's combined stdout+stderr
 * @returns {{line: number, branch: number} | undefined} the "all files"
 *   coverage summary row, if the report printed one
 */
export function parseAllFilesRow(output) {
  const match = output.match(
    /^ℹ all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/mu,
  );
  if (!match) {
    return undefined;
  }
  const [, line, branch] = match;
  return { line: Number(line), branch: Number(branch) };
}

/**
 * Pure pass/fail comparison against a recorded floor, with the same
 * tolerance `main()` uses. Exported so a test can exercise the ratchet's
 * actual decision logic directly, including with a real, freshly measured
 * "one test file removed" coverage row, without spawning `node --test`
 * once per workspace package.
 *
 * @param {{line: number, branch: number}} measured the measured coverage
 * @param {{line: number, branch: number}} floor the recorded floor
 * @returns {boolean} whether `measured` still meets `floor` within tolerance
 */
export function meetsFloor(measured, floor) {
  return (
    measured.line >= floor.line - TOLERANCE &&
    measured.branch >= floor.branch - TOLERANCE
  );
}

/**
 * @returns {void}
 */
function main() {
  const rootManifest = JSON.parse(
    readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
  );
  const thresholds = JSON.parse(
    readFileSync(path.join(ROOT, 'coverage-thresholds.json'), 'utf8'),
  );
  /** @type {readonly string[]} */
  const workspaces = rootManifest.workspaces ?? [];

  let failed = false;

  for (const workspace of workspaces) {
    const packageJsonPath = path.join(ROOT, workspace, 'package.json');
    /** @type {{name: string}} */
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const floor = thresholds[manifest.name];
    if (!floor) {
      console.log(
        `coverage:check: skipping ${manifest.name} (no floor recorded in coverage-thresholds.json)`,
      );
      continue;
    }

    const result = spawnSync(
      process.execPath,
      [
        '--test',
        '--experimental-test-coverage',
        '--test-coverage-include=src/**/*.js',
      ],
      { cwd: path.join(ROOT, workspace), encoding: 'utf8' },
    );
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    if (result.status !== 0) {
      console.error(
        `coverage:check: ${manifest.name}'s test suite did not pass; run its own tests for the failure.`,
      );
      failed = true;
      continue;
    }

    const measured = parseAllFilesRow(combined);
    if (!measured) {
      console.error(
        `coverage:check: could not parse a coverage summary for ${manifest.name}`,
      );
      failed = true;
      continue;
    }

    if (!meetsFloor(measured, floor)) {
      console.error(
        `coverage:check: ${manifest.name} regressed below its floor ` +
          `(line ${measured.line}% < ${floor.line}%, branch ${measured.branch}% < ${floor.branch}%)`,
      );
      failed = true;
      continue;
    }

    console.log(
      `coverage:check: ${manifest.name} line ${measured.line}% (floor ${floor.line}%), branch ${measured.branch}% (floor ${floor.branch}%)`,
    );
  }

  if (failed) {
    console.error('coverage:check: one or more packages regressed. See above.');
    process.exit(1);
  }

  console.log(
    'coverage:check: every measured package is at or above its floor.',
  );
}

await runIfMain(import.meta.url, async () => main());
