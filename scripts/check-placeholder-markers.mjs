#!/usr/bin/env node
/**
 * PUB-M12: a `PLACEHOLDER (W0-01)` marker (or the all-zero self-reference
 * SHA it used to accompany in `.github/workflows/*` before PUB-H5 pinned
 * the sibling checkouts by SHA) is a correctness hole a test or gate
 * previously tolerated *by design*, on the understanding that W0-01
 * (`rathnasgala2/publish` publishing itself) would close it later.
 *
 * `rathnasgala2/publish` now resolves on GitHub (verified 2026-09-25), so the
 * one placeholder that inherently could not be resolved before that day --
 * `pins/ledger.json`'s `selfReferences` all-zero SHA for the documented
 * caller example, and the two script comments explaining why it could not
 * yet be real -- has been reconciled in the same change that hardened this
 * gate: every self-reference now pins the real commit SHA, and
 * `scripts/check-pins.mjs` / `scripts/workflow/build-provenance.mjs` no
 * longer describe it as unresolvable.
 *
 * This does two things:
 *
 * 1. Fails if the literal marker text `PLACEHOLDER (W0-01)` appears
 *    anywhere in the scanned files without a corresponding entry in
 *    {@link TRACKED_PLACEHOLDERS} below -- an untracked placeholder can
 *    land invisibly today; this makes adding one require adding its
 *    tracking entry in the same change. `TRACKED_PLACEHOLDERS` is empty
 *    now that W0-01 has landed; a future placeholder needs a fresh entry
 *    and a fresh reviewed reason it cannot be resolved today.
 * 2. Hard-fails -- it no longer only warns -- if `rathnasgala2/publish`
 *    resolves on GitHub (which it now does, permanently) and
 *    `pins/ledger.json`'s `selfReferences` still records the all-zero
 *    placeholder SHA for it. A gate that only warns once the blocking
 *    condition is gone is not a gate; nothing else in `verify` would ever
 *    catch a placeholder SHA regressing back in. A network failure while
 *    checking is never treated as "resolved" -- only a definite answer
 *    either way changes the outcome, so an offline run never fails on this
 *    account.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { runIfMain } from './run-if-main.mjs';

const MARKER_TEXT = 'PLACEHOLDER (W0-01)';
const ALL_ZERO_SHA = '0000000000000000000000000000000000000000';
const SELF_REFERENCE_REPOSITORY = 'rathnasgala2/publish';

/**
 * The complete, reviewed inventory of every place a W0-01 placeholder is
 * known to live today that cannot yet be resolved. Empty now that
 * `rathnasgala2/publish` has published and every self-reference has been
 * re-pinned to a real commit SHA. Raising this list is a deliberate,
 * reviewed edit -- it is the "tracking entry" the marker-scan gate below
 * requires.
 *
 * @type {readonly {file: string, note: string}[]}
 */
export const TRACKED_PLACEHOLDERS = Object.freeze([]);

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
      `https://api.github.com/repos/${SELF_REFERENCE_REPOSITORY}`,
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
 * Hard-fail once `rathnasgala2/publish` is known to resolve on GitHub and
 * `pins/ledger.json` still records an all-zero placeholder self-reference
 * SHA for it. Below this point in time there is nothing left that
 * legitimately excuses the placeholder.
 *
 * @param {boolean | undefined} resolved the result of
 *   {@link repositoryResolvesOnGitHub}
 * @returns {Promise<string[]>} one diagnostic per still-placeholder
 *   self-reference, empty if there is none or `resolved` is not `true`
 */
export async function checkSelfReferencesResolved(resolved) {
  if (resolved !== true) {
    return [];
  }
  const ledger = JSON.parse(await readFile('pins/ledger.json', 'utf8'));
  /** @type {string[]} */
  const diagnostics = [];
  for (const entry of ledger.selfReferences ?? []) {
    if (
      typeof entry.reference === 'string' &&
      entry.reference.startsWith(`${SELF_REFERENCE_REPOSITORY}/`) &&
      entry.sha === ALL_ZERO_SHA
    ) {
      diagnostics.push(
        `pins/ledger.json: selfReferences entry for ${entry.reference} still carries the all-zero placeholder SHA, but ${SELF_REFERENCE_REPOSITORY} now resolves on GitHub -- re-pin it to a real commit SHA.`,
      );
    }
  }
  return diagnostics;
}

/**
 * @returns {Promise<void>} resolves when every placeholder is tracked and
 *   no self-reference placeholder survives past the point it could be
 *   resolved
 */
async function main() {
  const files = await scanScope();
  const diagnostics = await checkMarkersAreTracked(files);

  const resolved = await repositoryResolvesOnGitHub();
  if (resolved === undefined) {
    console.log(
      'placeholder:check: could not reach the GitHub API to test whether ' +
        `${SELF_REFERENCE_REPOSITORY} resolves; skipping the self-reference ` +
        'resolution check for this run (not a failure).',
    );
  }
  diagnostics.push(...(await checkSelfReferencesResolved(resolved)));

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
  console.log(
    `placeholder:check: ${TRACKED_PLACEHOLDERS.length} tracked W0-01 placeholder(s), no untracked marker found, no unresolved self-reference.`,
  );
}

await runIfMain(import.meta.url, main);
