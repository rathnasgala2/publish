import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  ADAPTER_ARTIFACT_CATALOG,
  ADAPTER_PACKAGES,
  ADAPTER_REGISTRY,
  findAdapterArtifact,
  requireAdapterArtifact,
} from '../src/adapter-artifact-catalog.js';

const run = promisify(execFile);
const WORKSPACE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

test('the catalog pins the complete closed identity of all three adapters', () => {
  assert.deepEqual(
    ADAPTER_ARTIFACT_CATALOG.map((entry) => entry.adapterId),
    ['local-directory', 'github-pages', 'do-spaces'],
  );
  assert.equal(
    new Set(ADAPTER_ARTIFACT_CATALOG.map((entry) => entry.adapterId)).size,
    ADAPTER_ARTIFACT_CATALOG.length,
  );
  assert.equal(
    new Set(ADAPTER_ARTIFACT_CATALOG.map((entry) => entry.package)).size,
    ADAPTER_ARTIFACT_CATALOG.length,
  );
  for (const entry of ADAPTER_ARTIFACT_CATALOG) {
    assert.equal(entry.package, `@rathnasgala2/adapter-${entry.adapterId}`);
    assert.equal(entry.version, '0.1.1');
    assert.match(entry.integrity, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(entry.registry, ADAPTER_REGISTRY);
    assert.equal(entry.contractVersion, '2.0.0');
    assert.equal(entry.compatibleWith, '^2.0.0');
    assert.equal(ADAPTER_PACKAGES[entry.package], entry.adapterId);
    assert.equal(findAdapterArtifact(entry.package), entry);
    const { adapterId: ignoredAdapterId, ...lockRow } = entry;
    assert.equal(ignoredAdapterId, entry.adapterId);
    assert.equal(requireAdapterArtifact(lockRow, 'TEST'), entry);
  }
});

test('each catalog integrity is the SHA-256 of its deterministic source package', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'gala-adapter-catalog-'));
  try {
    for (const entry of ADAPTER_ARTIFACT_CATALOG) {
      const packageDirectory = path.join(
        WORKSPACE,
        'packages',
        entry.package.replace('@rathnasgala2/', ''),
      );
      const destination = path.join(temporary, entry.adapterId);
      const cache = path.join(temporary, `${entry.adapterId}-cache`);
      await mkdir(destination);
      const { stdout } = await run(
        'npm',
        [
          'pack',
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          destination,
        ],
        {
          cwd: packageDirectory,
          env: { ...process.env, npm_config_cache: cache },
        },
      );
      const [packed] = JSON.parse(stdout);
      const bytes = await readFile(path.join(destination, packed.filename));
      assert.equal(
        `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        entry.integrity,
        entry.package,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('catalog admission rejects drift in every package-row member', () => {
  const entry = ADAPTER_ARTIFACT_CATALOG[0];
  assert.ok(entry !== undefined);
  const { adapterId: ignoredAdapterId, ...lockRow } = entry;
  assert.equal(ignoredAdapterId, entry.adapterId);
  for (const member of [
    'package',
    'version',
    'integrity',
    'registry',
    'contractVersion',
    'compatibleWith',
  ]) {
    assert.throws(
      () =>
        requireAdapterArtifact(
          {
            ...lockRow,
            [member]: `${lockRow[/** @type {keyof typeof lockRow} */ (member)]}-tampered`,
          },
          'TEST_ADAPTER_IDENTITY_INVALID',
        ),
      /TEST_ADAPTER_IDENTITY_INVALID/u,
      member,
    );
  }
});

test('catalog admission rejects missing and extra package-row members', () => {
  const entry = ADAPTER_ARTIFACT_CATALOG[0];
  assert.ok(entry !== undefined);
  const { adapterId: ignoredAdapterId, compatibleWith, ...incomplete } = entry;
  assert.equal(ignoredAdapterId, entry.adapterId);
  assert.throws(
    () => requireAdapterArtifact(incomplete, 'TEST_ADAPTER_IDENTITY_INVALID'),
    /TEST_ADAPTER_IDENTITY_INVALID/u,
  );
  assert.throws(
    () =>
      requireAdapterArtifact(
        { ...incomplete, compatibleWith, unapproved: true },
        'TEST_ADAPTER_IDENTITY_INVALID',
      ),
    /TEST_ADAPTER_IDENTITY_INVALID/u,
  );
});
