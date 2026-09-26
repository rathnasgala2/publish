/**
 * PUB-H6 regression: every failure this adapter raises must be a typed
 * `SpacesAdapterError` carrying a stable `.code`, never a bare `Error` a
 * caller can only discriminate by parsing `.message`. Structural (grep)
 * test over the committed source rather than an exhaustive call-site
 * exercise, so a future bare `throw new Error(...)` reintroduced anywhere
 * in `src/` fails the build immediately instead of waiting for a consumer
 * to hit that one path.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SpacesAdapterError } from '../src/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');

/**
 * @param {string} dir directory to walk
 * @returns {string[]} every `.js` file under it, recursively
 */
function listJsFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

test('no source file throws a bare Error; every throw is a SpacesAdapterError', () => {
  const offenders = [];
  for (const file of listJsFiles(srcDir)) {
    if (file.endsWith(`${path.sep}errors.js`)) {
      continue; // defines the class itself, via `extends Error`
    }
    const text = readFileSync(file, 'utf8');
    // Only the bare `Error` constructor is in scope: `TypeError`/`RangeError`
    // remain for programmer-error argument validation, which is not a
    // documented adapter failure code and is not what PUB-H6 is about.
    for (const match of text.matchAll(/throw new Error\(/g)) {
      offenders.push(
        `${path.relative(srcDir, file)}:${text.slice(0, match.index).split('\n').length}`,
      );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `every documented failure in src/ must throw SpacesAdapterError, not a bare Error:\n${offenders.join('\n')}`,
  );
});

test('SpacesAdapterError carries a stable .code alongside .message', () => {
  const error = new SpacesAdapterError('SPACES_EXAMPLE_CODE', 'detail text');
  assert.equal(error.code, 'SPACES_EXAMPLE_CODE');
  assert.equal(error.message, 'SPACES_EXAMPLE_CODE: detail text');
  assert.ok(error instanceof Error);
});
