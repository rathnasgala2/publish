/**
 * PUB-M2: `ADAPTER_PROTOCOL_VERSION` and this package's own npm `version`
 * are two unrelated numbers restated throughout the workspace (README's
 * "Version numbers" section documents the mapping). This proves the
 * enforced rule -- a change to `ADAPTER_PROTOCOL_VERSION` requires at least
 * a minor bump of the package version -- against the recorded history in
 * `protocol-version-history.json`, and that the currently shipped pair is
 * recorded there.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ADAPTER_PROTOCOL_VERSION } from '../src/generation-fence.js';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * @param {string} version an `x.y.z` semver string
 * @returns {{major: number, minor: number, patch: number}} its parts
 */
function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  assert.ok(match, `expected a plain x.y.z semver, got ${version}`);
  const [, major, minor, patch] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
}

/**
 * @param {{major: number, minor: number, patch: number}} a earlier version
 * @param {{major: number, minor: number, patch: number}} b later version
 * @returns {boolean} whether b's major or minor is strictly greater than a's
 */
function hasMinorOrMajorBump(a, b) {
  return b.major > a.major || (b.major === a.major && b.minor > a.minor);
}

/**
 * @returns {Promise<readonly {packageVersion: string, protocolVersion: string}[]>}
 *   the recorded (packageVersion, protocolVersion) history, oldest first
 */
async function readHistory() {
  const raw = await readFile(
    path.join(PACKAGE_ROOT, 'protocol-version-history.json'),
    'utf8',
  );
  return JSON.parse(raw);
}

test('every recorded protocol-version change carries at least a minor package-version bump', async () => {
  const history = await readHistory();
  for (let i = 1; i < history.length; i += 1) {
    const previous = history[i - 1];
    const current = history[i];
    assert.ok(previous && current, 'history entries must be defined');
    if (current.protocolVersion !== previous.protocolVersion) {
      assert.ok(
        hasMinorOrMajorBump(
          parseSemver(previous.packageVersion),
          parseSemver(current.packageVersion),
        ),
        `protocol version changed from ${previous.protocolVersion} to ${current.protocolVersion} ` +
          `between package versions ${previous.packageVersion} and ${current.packageVersion}, ` +
          'which is not at least a minor bump',
      );
    }
  }
});

test('the checked rule actually rejects a patch-only bump alongside a protocol change', () => {
  // The property above is only meaningful if it can fail. Prove that with
  // synthetic data rather than only ever exercising the passing real history.
  assert.equal(
    hasMinorOrMajorBump(parseSemver('0.2.0'), parseSemver('0.2.1')),
    false,
  );
  assert.equal(
    hasMinorOrMajorBump(parseSemver('0.2.0'), parseSemver('0.3.0')),
    true,
  );
});

test('the currently shipped (packageVersion, protocolVersion) pair is recorded in history', async () => {
  const history = await readHistory();
  const manifest = JSON.parse(
    await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  );
  const last = history.at(-1);
  assert.ok(last, 'protocol-version-history.json must not be empty');
  assert.equal(last.packageVersion, manifest.version);
  assert.equal(last.protocolVersion, ADAPTER_PROTOCOL_VERSION);
});
