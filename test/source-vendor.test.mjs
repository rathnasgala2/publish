import assert from 'node:assert/strict';
import {
  appendFile,
  cp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SOURCE_PACKAGES,
  tarballFilename,
  verifyVendoredPackages,
} from '../scripts/vendor-source-packages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {(vendorRoot: string) => Promise<void>} assertion test body
 * @returns {Promise<void>} resolves after deleting the isolated copy
 */
async function withVendorCopy(assertion) {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'gala-vendor-test-'),
  );
  const vendorRoot = path.join(temporaryDirectory, 'vendor');
  try {
    await cp(path.join(ROOT, 'vendor'), vendorRoot, { recursive: true });
    await assertion(vendorRoot);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('the committed source vendor set verifies without sibling repositories', async () => {
  await verifyVendoredPackages();
});

test('source vendor verification fails closed when tarball bytes change', async () => {
  await withVendorCopy(async (vendorRoot) => {
    const schema = SOURCE_PACKAGES[0];
    assert.ok(schema);
    const archive = path.join(
      vendorRoot,
      'packages',
      tarballFilename(schema.name, schema.version),
    );
    await appendFile(archive, Buffer.from([0]));
    await assert.rejects(
      verifyVendoredPackages({ vendorRoot, checkLockfile: false }),
      /SHA-256 does not match vendor manifest/u,
    );
  });
});

test('source vendor verification fails closed when a required tarball is missing', async () => {
  await withVendorCopy(async (vendorRoot) => {
    const theme = SOURCE_PACKAGES.at(-1);
    assert.ok(theme);
    await unlink(
      path.join(
        vendorRoot,
        'packages',
        tarballFilename(theme.name, theme.version),
      ),
    );
    await assert.rejects(
      verifyVendoredPackages({ vendorRoot, checkLockfile: false }),
      /vendored tarball is missing/u,
    );
  });
});

test('source vendor verification fails closed when its manifest is edited', async () => {
  await withVendorCopy(async (vendorRoot) => {
    const manifestPath = path.join(vendorRoot, 'source-packages.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.packages[0].byteLength += 1;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(
      verifyVendoredPackages({ vendorRoot, checkLockfile: false }),
      /manifestDigest is invalid/u,
    );
  });
});
