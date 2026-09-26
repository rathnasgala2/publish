/**
 * Pin ledger gate (S4-T08). The ledger is only useful if drift actually
 * fails, so these tests feed `comparePins` deliberately drifted inputs and
 * assert it reports them, then run it against the real repository state.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { comparePins } from '../scripts/check-pins.mjs';

const LEDGER = JSON.parse(readFileSync('pins/ledger.json', 'utf8'));

/**
 * @param {string} source a synthetic workflow body
 * @returns {{file: string, source: string}[]} a single-file YAML set
 */
function yaml(source) {
  return [{ file: 'synthetic.yml', source }];
}

/**
 * @returns {{file: string, source: string}[]} the non-YAML files the real
 *   check reads, so a synthetic run does not report false unused pins
 */
function supportingFiles() {
  return [
    'scripts/sandbox-build.sh',
    'scripts/minio-spaces.sh',
    'scripts/workflow/build-provenance.mjs',
    'package.json',
    'package-lock.json',
    '.github/workflows/ci.yml',
    '.github/workflows/nightly.yml',
    ...readdirSync('packages').map((name) => `packages/${name}/package.json`),
  ].map((file) => ({ file, source: readFileSync(file, 'utf8') }));
}

test('the real repository state has no pin drift', () => {
  const result = spawnSync('node', ['scripts/check-pins.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Verified 6 action pin\(s\), 2 image digest\(s\) and 2 binary checksum\(s\)/u,
  );
});

test('a reference at a different SHA than the ledger records is drift', () => {
  const diagnostics = comparePins(
    LEDGER,
    yaml(
      LEDGER.actions
        .map(
          (/** @type {any} */ entry, /** @type {number} */ index) =>
            `      - uses: ${entry.reference}@${index === 0 ? 'a'.repeat(40) : entry.sha}`,
        )
        .join('\n'),
    ),
    supportingFiles(),
  );
  assert.equal(diagnostics.length, 1);
  assert.match(
    String(diagnostics[0]),
    /is pinned to a{40} but the ledger records/u,
  );
});

test('a reference absent from the ledger is refused', () => {
  const diagnostics = comparePins(
    LEDGER,
    yaml(
      [
        ...LEDGER.actions.map(
          (/** @type {any} */ entry) =>
            `      - uses: ${entry.reference}@${entry.sha}`,
        ),
        `      - uses: some-org/unreviewed-action@${'b'.repeat(40)}`,
      ].join('\n'),
    ),
    supportingFiles(),
  );
  assert.equal(diagnostics.length, 1);
  assert.match(
    String(diagnostics[0]),
    /is not recorded in pins\/ledger\.json/u,
  );
});

test('a ledger entry no workflow uses is refused', () => {
  const diagnostics = comparePins(
    LEDGER,
    yaml(
      LEDGER.actions
        .slice(1)
        .map(
          (/** @type {any} */ entry) =>
            `      - uses: ${entry.reference}@${entry.sha}`,
        )
        .join('\n'),
    ),
    supportingFiles(),
  );
  assert.equal(diagnostics.length, 1);
  assert.match(String(diagnostics[0]), /is recorded but no workflow uses it/u);
});

test('a self-reference with a changed pin is refused', () => {
  const diagnostics = comparePins(
    LEDGER,
    yaml(
      [
        ...LEDGER.actions.map(
          (/** @type {any} */ entry) =>
            `      - uses: ${entry.reference}@${entry.sha}`,
        ),
        `    uses: rathnasgala2/publish/.github/workflows/publish-v2.yml@${'c'.repeat(40)}`,
      ].join('\n'),
    ),
    supportingFiles(),
  );
  assert.equal(diagnostics.length, 1);
  assert.match(String(diagnostics[0]), /but the ledger records/u);
});

test('the minio image digest mirrors infra/release/container-images.json exactly', () => {
  const workspaceRoot =
    process.env.WORKSPACE_ROOT ?? new URL('../../..', import.meta.url).pathname;
  /** @type {Record<string, any> | null} */
  let images;
  try {
    images = JSON.parse(
      readFileSync(
        `${workspaceRoot}/infra/release/container-images.json`,
        'utf8',
      ),
    );
  } catch {
    images = null;
  }
  if (images === null) {
    // The infra sibling is optional in a bare checkout; the ledger still
    // records where the digest came from.
    const recorded = LEDGER.containerImages.find(
      (/** @type {any} */ entry) => entry.name === 'minio',
    );
    assert.equal(
      recorded.mirrorOf,
      'infra/release/container-images.json#images.minio',
    );
    return;
  }
  const recorded = LEDGER.containerImages.find(
    (/** @type {any} */ entry) => entry.name === 'minio',
  );
  assert.ok(images.images.minio.endsWith(recorded.reference.split('@')[1]));
});

test('every ledger action pin is a full 40-character lowercase commit SHA', () => {
  for (const entry of LEDGER.actions) {
    assert.match(entry.sha, /^[0-9a-f]{40}$/u, entry.reference);
    assert.ok(typeof entry.purpose === 'string' && entry.purpose.length > 0);
  }
});

test('PUB-L6: the ledger no longer carries a packages field at all', () => {
  // @rathnasgala2/schemas publishes to the registry as of the 2026-09-22
  // contract re-pin, and schema-pin:check now forbids the LOCAL-1
  // local-tarball convention outright for every package, not only schemas
  // -- so no ledger entry of this shape can ever legitimately exist again.
  // The field itself (and the verifyPackageTarballs/comparePins machinery
  // that read it) was removed rather than kept permanently empty.
  assert.equal(LEDGER.packages, undefined);
});

test('every workspace package declares exactly the registry-pinned schemas version', () => {
  const expected = '2.11.0';
  const declaring = readdirSync('packages')
    .map((name) => ({
      name,
      manifest: JSON.parse(
        readFileSync(`packages/${name}/package.json`, 'utf8'),
      ),
    }))
    .filter(({ manifest }) => manifest.dependencies?.['@rathnasgala2/schemas']);
  assert.ok(declaring.length > 0, 'at least one package consumes the schemas');
  for (const { name, manifest } of declaring) {
    assert.equal(
      manifest.dependencies['@rathnasgala2/schemas'],
      expected,
      `${name} must consume exactly the registry-pinned schemas version`,
    );
  }
});
