/**
 * PUB-M12 regression for `scripts/check-placeholder-markers.mjs`.
 *
 * `rathnasgala2/publish` resolved on GitHub 2026-09-25; every self-reference
 * was re-pinned to a real commit SHA in the same change that hardened this
 * gate from "warn when resolved" to "hard-fail if a placeholder survives
 * past resolution". `TRACKED_PLACEHOLDERS` is empty as a result -- these
 * tests assert that state and the new hard-fail behavior, rather than the
 * old "at least one tracked entry" shape.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  checkMarkersAreTracked,
  checkSelfReferencesResolved,
  TRACKED_PLACEHOLDERS,
} from '../scripts/check-placeholder-markers.mjs';

test('placeholder:check passes against the real repository state', () => {
  const output = execFileSync(
    process.execPath,
    ['scripts/check-placeholder-markers.mjs'],
    { encoding: 'utf8' },
  );
  assert.match(
    output,
    /placeholder:check: \d+ tracked W0-01 placeholder\(s\)/u,
  );
});

test('TRACKED_PLACEHOLDERS is empty now that W0-01 has resolved', () => {
  assert.deepEqual(TRACKED_PLACEHOLDERS, []);
});

test('checkMarkersAreTracked flags a marker in a file with no tracking entry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'placeholder-check-'));
  try {
    const file = path.join(dir, 'untracked.yml');
    await writeFile(file, 'ref: main # PLACEHOLDER (W0-01): pin later\n');
    const diagnostics = await checkMarkersAreTracked([file]);
    assert.equal(diagnostics.length, 1);
    assert.match(
      diagnostics[0] ?? '',
      /no matching entry in TRACKED_PLACEHOLDERS/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkMarkersAreTracked reports nothing for a file with no marker at all', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'placeholder-check-'));
  try {
    const file = path.join(dir, 'clean.yml');
    await writeFile(file, 'ref: 15142f8baebaff5e174ac07d784073d2d2163b88\n');
    assert.deepEqual(await checkMarkersAreTracked([file]), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkSelfReferencesResolved is silent when resolution is unknown or false', async () => {
  assert.deepEqual(await checkSelfReferencesResolved(undefined), []);
  assert.deepEqual(await checkSelfReferencesResolved(false), []);
});

test('checkSelfReferencesResolved passes today: the real ledger carries no all-zero self-reference', async () => {
  assert.deepEqual(await checkSelfReferencesResolved(true), []);
});

test('red when reverted: an all-zero self-reference SHA fails once the repository is known to resolve', async (t) => {
  const ledgerPath = 'pins/ledger.json';
  const original = await import('node:fs/promises').then((fs) =>
    fs.readFile(ledgerPath, 'utf8'),
  );
  const ledger = JSON.parse(original);
  const placeholderSha = '0'.repeat(40);
  const reverted = {
    ...ledger,
    selfReferences: (ledger.selfReferences ?? []).map(
      (/** @type {any} */ entry) => ({
        ...entry,
        sha: entry.reference.startsWith('rathnasgala2/publish/')
          ? placeholderSha
          : entry.sha,
      }),
    ),
  };
  const { writeFile: write } = await import('node:fs/promises');
  await write(ledgerPath, JSON.stringify(reverted, null, 2) + '\n');
  t.after(async () => {
    await write(ledgerPath, original);
  });

  const diagnostics = await checkSelfReferencesResolved(true);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0] ?? '', /all-zero placeholder SHA/u);
});
