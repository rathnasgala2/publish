#!/usr/bin/env node
/**
 * PUB-M12: a `PLACEHOLDER (W0-01)` marker (or the all-zero self-reference
 * SHA it used to accompany in `.github/workflows/*` before PUB-H5 pinned
 * the sibling checkouts by SHA) is a correctness hole a test or gate
 * currently tolerates *by design*, on the understanding that W0-01
 * (`rathnasgala2/publish` publishing itself) will close it later. Nothing
 * previously failed once that day arrives, so the natural outcome was that
 * the placeholder just stayed.
 *
 * This does two things:
 *
 * 1. Fails if the literal marker text `PLACEHOLDER (W0-01)` appears
 *    anywhere in the scanned files without a corresponding entry in
 *    {@link TRACKED_PLACEHOLDERS} below -- an untracked placeholder can
 *    land invisibly today; this makes adding one require adding its
 *    tracking entry in the same change.
 * 2. Turns the one remaining, inherently unresolvable-until-publish
 *    placeholder -- the `pins/ledger.json` `selfReferences` all-zero SHA
 *    for `rathnasgala2/publish` -- into a gate that closes itself: once
 *    that repository actually resolves on GitHub, this prints a loud,
 *    impossible-to-miss warning on every single `verify` run instead of
 *    silently continuing to accept the placeholder forever. It warns
 *    rather than fails `verify`: the W0-01 reconciliation itself (re-pin
 *    every self-reference to the real commit SHA, delete the
 *    placeholder-handling branches in `scripts/check-pins.mjs` and
 *    `scripts/workflow/build-provenance.mjs`) is a deliberate, reviewed
 *    change of its own, not something this check should perform or force
 *    on an unrelated commit the moment the repository happens to go
 *    public. A network failure while checking is never treated as
 *    "resolved" -- only a definite answer either way changes the outcome.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { runIfMain } from './run-if-main.mjs';

const MARKER_TEXT = 'PLACEHOLDER (W0-01)';

/**
 * The complete, reviewed inventory of every place a W0-01 placeholder is
 * known to live today. Each entry documents *why* it cannot be resolved
 * before `rathnasgala2/publish` exists. Raising or lowering this list is a
 * deliberate, reviewed edit -- it is the "tracking entry" the marker-scan
 * gate below requires.
 *
 * @type {readonly {file: string, note: string}[]}
 */
export const TRACKED_PLACEHOLDERS = Object.freeze([
  {
    file: 'pins/ledger.json',
    note: 'selfReferences[0]: the rathnasgala2/publish caller pin cannot be a real SHA until this repository exists.',
  },
  {
    file: 'scripts/check-pins.mjs',
    note: 'documents why the self-reference is not expected to resolve until W0-01 publishes this repository.',
  },
  {
    file: 'scripts/workflow/build-provenance.mjs',
    note: "documents that the workflow-file evidence rows need rathnasgala2/publish's numeric repository id, unavailable until W0-01.",
  },
]);

/**
 * A conservative, explicit file scope: every place a placeholder marker has
 * ever appeared in this repository (workflows, the pin ledger, the two
 * scripts above, the documented caller example). Deliberately not a
 * recursive walk of the whole tree, so `node_modules` and a contributor's
 * own scratch files are never in scope.
 *
 * @returns {Promise<string[]>} every file to scan
 */
async function scanScope() {
  const workflowDir = '.github/workflows';
  const workflowFiles = (await readdir(workflowDir)).map((name) =>
    path.join(workflowDir, name),
  );
  const callerDir = 'docs/callers';
  const callerFiles = (await readdir(callerDir)).map((name) =>
    path.join(callerDir, name),
  );
  return [
    ...workflowFiles,
    ...callerFiles,
    'pins/ledger.json',
    'scripts/check-pins.mjs',
    'scripts/workflow/build-provenance.mjs',
  ];
}

/**
 * @param {readonly string[]} files files to scan for the literal marker text
 * @returns {Promise<string[]>} one diagnostic per untracked marker occurrence
 */
export async function checkMarkersAreTracked(files) {
  const trackedFiles = new Set(TRACKED_PLACEHOLDERS.map((entry) => entry.file));
  /** @type {string[]} */
  const diagnostics = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (text.includes(MARKER_TEXT) && !trackedFiles.has(file)) {
      diagnostics.push(
        `${file}: contains "${MARKER_TEXT}" with no matching entry in TRACKED_PLACEHOLDERS (scripts/check-placeholder-markers.mjs); resolve it or add a tracking entry.`,
      );
    }
  }
  return diagnostics;
}

/**
 * Ask whether `rathnasgala2/publish` resolves on GitHub today. A network
 * failure is reported as `undefined` ("inconclusive"), never as `false`, so
 * a runner with no network access never causes a false "still
 * unpublished".
 *
 * @returns {Promise<boolean | undefined>} true if it resolves, false if it
 *   definitively 404s, undefined if the check could not be completed
 */
async function repositoryResolvesOnGitHub() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      'https://api.github.com/repos/rathnasgala2/publish',
      {
        signal: controller.signal,
        headers: { 'user-agent': 'publish-repo-check-placeholder-markers' },
      },
    );
    if (response.status === 200) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @returns {Promise<void>} resolves when every placeholder is tracked and
 *   (where checkable) still genuinely unresolved
 */
async function main() {
  const files = await scanScope();
  const diagnostics = await checkMarkersAreTracked(files);

  const resolved = await repositoryResolvesOnGitHub();
  if (resolved === true) {
    console.warn(
      '\n'.repeat(2) +
        '################################################################\n' +
        '# PUB-M12: rathnasgala2/publish now resolves on GitHub, but     #\n' +
        '# pins/ledger.json still records the all-zero selfReferences    #\n' +
        '# placeholder. W0-01 has landed: file a deliberate change to    #\n' +
        '# re-pin every self-reference to the real commit SHA and remove #\n' +
        '# the placeholder-handling branches in scripts/check-pins.mjs   #\n' +
        '# and scripts/workflow/build-provenance.mjs.                    #\n' +
        '################################################################\n',
    );
  } else if (resolved === undefined) {
    console.log(
      'placeholder:check: could not reach the GitHub API to test whether ' +
        'rathnasgala2/publish now resolves; treating the self-reference ' +
        'placeholder as still open (not a failure).',
    );
  }

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `placeholder:check: ${TRACKED_PLACEHOLDERS.length} tracked W0-01 placeholder(s), no untracked marker found.`,
  );
}

await runIfMain(import.meta.url, main);
