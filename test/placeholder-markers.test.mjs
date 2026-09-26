/**
 * PUB-M12 regression for `scripts/check-placeholder-markers.mjs`.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  checkMarkersAreTracked,
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

test('TRACKED_PLACEHOLDERS is non-empty and every entry carries a note', () => {
  assert.ok(TRACKED_PLACEHOLDERS.length > 0);
  for (const entry of TRACKED_PLACEHOLDERS) {
    assert.equal(typeof entry.file, 'string');
    assert.ok(entry.note.length > 0);
  }
});

test('checkMarkersAreTracked accepts a tracked file containing the marker', async () => {
  const [tracked] = TRACKED_PLACEHOLDERS;
  assert.ok(tracked, 'expected at least one tracked placeholder');
  const diagnostics = await checkMarkersAreTracked([tracked.file]);
  assert.deepEqual(diagnostics, []);
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
