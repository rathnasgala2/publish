/**
 * DEC-097 section 3: for the selected lock row,
 * `adapter-capability.adapter.adapterVersion` byte-equals the locked package
 * version. The only value that cannot drift from what a lock records for an
 * installed adapter package is the version that package's own manifest
 * declares, so every adapter's `ADAPTER_VERSION` is read from its
 * `package.json` rather than restated by hand, and this suite proves the
 * three agree with the lock projection `freeze` and `deploy` bind to.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as localDirectory from '@rathnasgala2/adapter-local-directory';
import * as pages from '@rathnasgala2/adapter-github-pages';
import * as spaces from '@rathnasgala2/adapter-do-spaces';

import { describeCapabilities as describeSpaces } from '../packages/adapter-do-spaces/src/capability.js';
import { describeCapabilities as describePages } from '../packages/adapter-github-pages/src/capability.js';
import { describeCapabilities as describeLocal } from '../packages/adapter-local-directory/src/capability.js';
import { requireAdapterVersionAgreement } from '../scripts/workflow/deploy.mjs';
import {
  ADAPTER_PACKAGES,
  LOCK_PATH,
  readLockFacts,
} from '../scripts/workflow/verified-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The three adapters, keyed by their locked package name. */
const ADAPTERS = Object.freeze({
  '@rathnasgala2/adapter-local-directory': localDirectory,
  '@rathnasgala2/adapter-github-pages': pages,
  '@rathnasgala2/adapter-do-spaces': spaces,
});

/**
 * @param {string} packageName the adapter package
 * @returns {Promise<{version: string, name: string}>} its manifest
 */
async function manifestOf(packageName) {
  const directory = packageName.replace('@rathnasgala2/', '');
  return JSON.parse(
    await readFile(
      path.join(ROOT, 'packages', directory, 'package.json'),
      'utf8',
    ),
  );
}

/**
 * The fixture lock with its adapter row re-pointed at one package at that
 * package's installed version, as a resolver would record it.
 *
 * @param {string} packageName the adapter package
 * @param {string} version the version the row pins
 * @returns {Promise<{path: string, bytes: Buffer}[]>} the verified-inputs members
 */
async function lockedAt(packageName, version) {
  const lock = JSON.parse(
    await readFile(
      path.join(
        ROOT,
        'packages/publish-action/test/fixtures/minimal-repository/gala.lock.json',
      ),
      'utf8',
    ),
  );
  lock.publisher = lock.publisher.map((/** @type {any} */ row) =>
    Object.hasOwn(ADAPTER_PACKAGES, row.package)
      ? { ...row, package: packageName, version }
      : row,
  );
  return [{ path: LOCK_PATH, bytes: Buffer.from(JSON.stringify(lock)) }];
}

for (const [packageName, adapter] of Object.entries(ADAPTERS)) {
  test(`${packageName}: ADAPTER_VERSION is the package manifest version and agrees with the lock row`, async () => {
    const manifest = await manifestOf(packageName);
    assert.equal(manifest.name, packageName);
    assert.equal(adapter.ADAPTER_VERSION, manifest.version);
    assert.match(adapter.ADAPTER_VERSION, /^\d+\.\d+\.\d+$/u);

    const facts = readLockFacts(await lockedAt(packageName, manifest.version));
    assert.equal(facts.adapterPackage, packageName);
    assert.equal(
      facts.adapter.adapterId,
      ADAPTER_PACKAGES[
        /** @type {keyof typeof ADAPTER_PACKAGES} */ (packageName)
      ],
    );
    assert.equal(facts.adapter.adapterVersion, adapter.ADAPTER_VERSION);
    // deploy.mjs binds the installed adapter to the intent's lock-derived
    // version: a lock pinning this package at its installed version passes,
    // any other pin is refused by name.
    requireAdapterVersionAgreement(adapter.ADAPTER_VERSION, facts.adapter);
    const other = readLockFacts(await lockedAt(packageName, '9.9.9'));
    assert.throws(
      () =>
        requireAdapterVersionAgreement(adapter.ADAPTER_VERSION, other.adapter),
      /DEPLOY_ADAPTER_VERSION_MISMATCH/u,
    );
  });
}

test('the capability documents of all three adapters declare the installed version', async () => {
  const pagesDocument = /** @type {any} */ (
    describePages({ apiOrigin: 'https://api.github.com' })
  );
  assert.equal(pagesDocument.adapter.adapterVersion, pages.ADAPTER_VERSION);
  const spacesDocument = /** @type {any} */ (
    describeSpaces({
      origins: spaces.deriveOrigins({
        region: 'nyc3',
        servedBucket: 'gala-served-disposable',
        stagingBucket: 'gala-staging-disposable',
      }),
    })
  );
  assert.equal(spacesDocument.adapter.adapterVersion, spaces.ADAPTER_VERSION);
  const destinationRoot = await mkdtemp(
    path.join(tmpdir(), 'gala-adapter-version-'),
  );
  try {
    const localDocument = /** @type {any} */ (
      await describeLocal({
        destinationRoot,
        rootStats: await stat(destinationRoot),
      })
    );
    assert.equal(
      localDocument.adapter.adapterVersion,
      localDirectory.ADAPTER_VERSION,
    );
  } finally {
    await rm(destinationRoot, { recursive: true, force: true });
  }
});

test('the fixture lock pins adapter-local-directory at the installed version, so the local e2e path deploys under the version it binds', async () => {
  const manifest = await manifestOf('@rathnasgala2/adapter-local-directory');
  const lock = JSON.parse(
    await readFile(
      path.join(
        ROOT,
        'packages/publish-action/test/fixtures/minimal-repository/gala.lock.json',
      ),
      'utf8',
    ),
  );
  const row = lock.publisher.find(
    (/** @type {any} */ entry) =>
      entry.package === '@rathnasgala2/adapter-local-directory',
  );
  assert.equal(row.version, manifest.version);
  assert.equal(row.version, localDirectory.ADAPTER_VERSION);
});
