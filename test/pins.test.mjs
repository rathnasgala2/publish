/**
 * Pin ledger gate (S4-T08). The ledger is only useful if drift actually
 * fails, so these tests feed `comparePins` deliberately drifted inputs and
 * assert it reports them, then run it against the real repository state.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { comparePins, verifyPackageTarballs } from '../scripts/check-pins.mjs';

/**
 * Search roots for `verifyPackageTarballs`'s own unit tests below. These
 * tests exercise the function directly (not through the real ledger, which
 * no longer carries a LOCAL-1 package pin) so they need a real file on disk
 * to hash. `test/fixtures/local-packages` holds a small tarball built once
 * and committed as bytes precisely so this does not depend on ambient
 * developer state: a GitHub Actions runner, like a bare clone, has no
 * sibling `local-packages`
 * checkout, and even where one exists its tarball's bytes are not
 * reproducible from run to run (tar/gzip metadata varies by OS and tool).
 * A fixture checked into git is read back byte-for-byte on every platform.
 */
const LOCAL_PACKAGES = [resolve('test', 'fixtures', 'local-packages')];

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
    /Verified 6 action pin\(s\), 2 image digest\(s\), 2 binary checksum\(s\)/u,
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

test('the LOCAL-1/LOCAL-43 local-tarball schemas pin is retired from the ledger', () => {
  // @rathnasgala2/schemas publishes to the registry as of the 2026-09-22
  // contract re-pin; the ledger no longer records a local-tarball pin for
  // it, and no manifest in this workspace should declare a `file:` schemas
  // dependency (schema-pin:check enforces the latter independently).
  const schemas = LEDGER.packages.find(
    (/** @type {any} */ entry) => entry.name === '@rathnasgala2/schemas',
  );
  assert.equal(schemas, undefined);
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

test('a package pin whose tarball hashes differently is drift', async () => {
  const diagnostics = await verifyPackageTarballs(
    [
      {
        name: '@rathnasgala2/schemas',
        version: '2.10.0',
        source: 'file:../../local-packages/rathnasgala2-schemas-2.10.0.tgz',
        sha256: '0'.repeat(64),
      },
    ],
    LOCAL_PACKAGES,
  );
  assert.equal(diagnostics.length, 1);
  assert.match(String(diagnostics[0]), /sha256 is b9133cff/u);
});

test('a package pin whose tarball is missing fails closed rather than passing', async () => {
  const diagnostics = await verifyPackageTarballs(
    [
      {
        name: '@rathnasgala2/schemas',
        version: '9.9.9',
        source: 'file:../../local-packages/rathnasgala2-schemas-9.9.9.tgz',
        sha256: '0'.repeat(64),
      },
    ],
    LOCAL_PACKAGES,
  );
  assert.equal(diagnostics.length, 1);
  assert.match(String(diagnostics[0]), /was not found/u);
});

test('a ledger package entry no manifest or lockfile declares is refused', () => {
  const ledger = {
    ...LEDGER,
    packages: [
      {
        name: '@rathnasgala2/unused',
        version: '1.0.0',
        source: 'file:../../local-packages/rathnasgala2-unused-1.0.0.tgz',
        sha256: '0'.repeat(64),
      },
    ],
  };
  const diagnostics = comparePins(ledger, yaml(''), supportingFiles());
  assert.ok(
    diagnostics.some((entry) => entry.includes('@rathnasgala2/unused')),
    'an unused package pin must be reported',
  );
});
