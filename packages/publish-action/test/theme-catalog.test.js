/**
 * The toolchain's generation-4 theme catalog: every cataloged theme may be selected,
 * each registry package agrees with `THEME_CATALOG`, a consistent build
 * renders its CSS, and a lock/appearance disagreement is refused with
 * `THEME_SELECTION_MISMATCH`.
 *
 * Resolution mirrors the sandbox (`scripts/sandbox-build.sh`):
 * `WORKSPACE_ROOT` points at the v2 sibling checkouts before any module that
 * reads it is imported.
 */

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures/minimal-repository');
const WORKSPACE_ROOT =
  process.env.WORKSPACE_ROOT ?? path.resolve(HERE, '../../../..');
process.env.WORKSPACE_ROOT = WORKSPACE_ROOT;

const {
  THEME_CATALOG,
  findThemeCatalogEntry,
  requireThemeArtifact,
  themePackageNameOf,
} = await import('../src/theme-catalog.js');
const { ACTIVE_DIGEST_PROFILES } =
  await import('@rathnasgala2/schemas/digest-profiles');
const LOCK_DIGEST_PROFILE = /** @type {any} */ (ACTIVE_DIGEST_PROFILES.lock);
const { runBuild } = await import('../src/commands/build.js');
const { buildBuildInputFromRepository, RepositoryIntakeError } =
  await import('../src/normalize/repository-intake.js');

/**
 * @param {string} dir repository copy
 * @param {string} file repository-relative JSON file
 * @param {(doc: any) => void} mutate in-place edit
 * @returns {Promise<void>} resolves once written
 */
async function editJson(dir, file, mutate) {
  const target = path.join(dir, file);
  const doc = JSON.parse(await readFile(target, 'utf8'));
  mutate(doc);
  await writeFile(target, `${JSON.stringify(doc, null, 2)}\n`);
}

/**
 * @param {string} lockPackage package the lock names
 * @param {string} appearancePackage package appearance.json names
 * @returns {Promise<{dir: string, cleanup: () => Promise<void>}>} a fixture copy
 */
async function fixtureSelecting(lockPackage, appearancePackage) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gala-theme-catalog-'));
  await cp(FIXTURE, dir, { recursive: true });
  const entry = /** @type {any} */ (findThemeCatalogEntry(lockPackage));
  await editJson(dir, 'gala.lock.json', (lock) => {
    lock.theme = { ...entry };
    lock.lockDigest = LOCK_DIGEST_PROFILE.digest(lock);
  });
  await editJson(dir, 'gala/appearance.json', (doc) => {
    doc.theme = `${appearancePackage}@^4.0.0`;
  });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('the catalog is exactly the six registry generation-4 theme packages', async () => {
  assert.deepEqual(THEME_CATALOG.map((entry) => entry.package).sort(), [
    '@rathnasgala2/theme-amaze',
    '@rathnasgala2/theme-default',
    '@rathnasgala2/theme-editorial',
    '@rathnasgala2/theme-flashy',
    '@rathnasgala2/theme-minimal',
    '@rathnasgala2/theme-zebra',
  ]);
  for (const entry of THEME_CATALOG) {
    const directory = path.join(
      WORKSPACE_ROOT,
      entry.package.replace('@rathnasgala2/', ''),
    );
    const packageJson = JSON.parse(
      await readFile(path.join(directory, 'package.json'), 'utf8'),
    );
    const themeJson = JSON.parse(
      await readFile(path.join(directory, 'theme.json'), 'utf8'),
    );
    assert.equal(packageJson.name, entry.package);
    assert.equal(packageJson.version, entry.version);
    assert.equal(themeJson.contractVersion, entry.contractVersion);
    assert.equal(themeJson.templateRange, '^4.1.0');
    assert.ok(
      themeJson.palette && typeof themeJson.palette === 'object',
      `${entry.package} declares a palette`,
    );
    assert.match(entry.integrity, /^sha256:[0-9a-f]{64}$/u);
  }
  assert.equal(
    themePackageNameOf('@rathnasgala2/theme-editorial@^4.0.0'),
    '@rathnasgala2/theme-editorial',
  );
  assert.equal(
    themePackageNameOf('@rathnasgala2/theme-editorial'),
    '@rathnasgala2/theme-editorial',
  );
});

test('every catalog row names a registry release the lockfile resolves from the public registry', async () => {
  const lockfile = JSON.parse(
    await readFile(path.join(HERE, '../../../package-lock.json'), 'utf8'),
  );
  const fixtureLock = JSON.parse(
    await readFile(path.join(FIXTURE, 'gala.lock.json'), 'utf8'),
  );
  for (const catalogEntry of THEME_CATALOG) {
    assert.equal(catalogEntry.registry, 'https://registry.npmjs.org/');
    const installed = lockfile.packages[`node_modules/${catalogEntry.package}`];
    assert.equal(installed?.version, catalogEntry.version);
    assert.match(
      installed.resolved,
      new RegExp(
        `^https://registry\\.npmjs\\.org/${catalogEntry.package}/`,
        'u',
      ),
    );
    if (fixtureLock.theme.package === catalogEntry.package) {
      assert.equal(fixtureLock.theme.integrity, catalogEntry.integrity);
    }
  }
});

test('catalog admission binds every value and the exact six-member row shape', () => {
  const entry = THEME_CATALOG[0];
  assert.ok(entry !== undefined);
  assert.equal(requireThemeArtifact({ ...entry }, 'TEST_THEME_INVALID'), entry);

  for (const [member, tampered] of Object.entries({
    package: '@rathnasgala2/theme-unknown',
    version: '9.9.9',
    integrity: `sha256:${'f'.repeat(64)}`,
    registry: 'https://registry.invalid/',
    contractVersion: '9.9.9',
    compatibleWith: '^9.9.9',
  })) {
    assert.throws(
      () =>
        requireThemeArtifact(
          { ...entry, [member]: tampered },
          'TEST_THEME_INVALID',
        ),
      /TEST_THEME_INVALID/u,
      member,
    );
  }

  const { compatibleWith, ...incomplete } = entry;
  assert.throws(
    () => requireThemeArtifact(incomplete, 'TEST_THEME_INVALID'),
    /TEST_THEME_INVALID/u,
  );
  assert.throws(
    () =>
      requireThemeArtifact(
        { ...incomplete, compatibleWith, unapproved: true },
        'TEST_THEME_INVALID',
      ),
    /TEST_THEME_INVALID/u,
  );
});

test('repository intake rejects every schema-admitted catalog value drift before projection', async () => {
  for (const [member, tampered] of Object.entries({
    version: '9.9.9',
    integrity: `sha256:${'f'.repeat(64)}`,
    registry: 'https://registry.invalid/',
    contractVersion: '9.9.9',
    compatibleWith: '^9.9.9',
  })) {
    const { dir, cleanup } = await fixtureSelecting(
      '@rathnasgala2/theme-editorial',
      '@rathnasgala2/theme-editorial',
    );
    try {
      await editJson(dir, 'gala.lock.json', (lock) => {
        lock.theme[member] = tampered;
        lock.lockDigest = LOCK_DIGEST_PROFILE.digest(lock);
      });
      await assert.rejects(
        buildBuildInputFromRepository({ repositoryDirectory: dir }),
        /LOCK_THEME_IDENTITY_INVALID/u,
        member,
      );
    } finally {
      await cleanup();
    }
  }
});

for (const entry of THEME_CATALOG) {
  test(`build with ${entry.package} selected consistently renders that theme's CSS`, async () => {
    const { dir, cleanup } = await fixtureSelecting(
      entry.package,
      entry.package,
    );
    const out = await mkdtemp(path.join(tmpdir(), 'gala-theme-out-'));
    try {
      const result = await runBuild({
        repositoryDirectory: dir,
        outputDirectory: path.join(out, 'output'),
        workDirectory: path.join(out, 'work'),
      });
      assert.equal(
        result.resultCode,
        'SUCCESS',
        JSON.stringify(result.findings),
      );
      const installed = path.join(
        WORKSPACE_ROOT,
        entry.package.replace('@rathnasgala2/', ''),
      );
      for (const css of ['tokens.css', 'components.css']) {
        const rendered = await readFile(
          path.join(
            /** @type {string} */ (result.outputDirectory),
            'assets/theme',
            css,
          ),
        );
        assert.ok(
          rendered.equals(await readFile(path.join(installed, css))),
          `${css} must equal ${entry.package}'s own file`,
        );
      }
    } finally {
      await cleanup();
      await rm(out, { recursive: true, force: true });
    }
  });
}

test('appearance.json naming a different theme than the lock is refused with THEME_SELECTION_MISMATCH', async () => {
  const { dir, cleanup } = await fixtureSelecting(
    '@rathnasgala2/theme-editorial',
    '@rathnasgala2/theme-default',
  );
  try {
    await assert.rejects(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof RepositoryIntakeError);
        const finding = /** @type {any} */ (error.findings[0]);
        assert.equal(finding.code, 'THEME_SELECTION_MISMATCH');
        assert.match(finding.detail, /theme-default/u);
        assert.match(finding.detail, /theme-editorial/u);
        assert.match(finding.recovery, /Settings .* Appearance/u);
        return true;
      },
    );
    const out = await mkdtemp(path.join(tmpdir(), 'gala-theme-out-'));
    const result = await runBuild({
      repositoryDirectory: dir,
      outputDirectory: path.join(out, 'output'),
      workDirectory: path.join(out, 'work'),
    });
    assert.notEqual(result.resultCode, 'SUCCESS');
    assert.equal(
      /** @type {any} */ (result.findings[0]).code,
      'THEME_SELECTION_MISMATCH',
    );
    await rm(out, { recursive: true, force: true });
  } finally {
    await cleanup();
  }
});

test('intake rejects a lockDigest that does not authenticate the complete lock', async () => {
  const { dir, cleanup } = await fixtureSelecting(
    '@rathnasgala2/theme-editorial',
    '@rathnasgala2/theme-editorial',
  );
  try {
    await editJson(dir, 'gala.lock.json', (lock) => {
      lock.lockDigest = `sha256:${'f'.repeat(64)}`;
    });
    await assert.rejects(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof RepositoryIntakeError);
        const finding = error.findings[0];
        assert.ok(finding !== undefined);
        assert.equal(finding.code, 'LOCK_DIGEST_MISMATCH');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});
