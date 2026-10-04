/**
 * The toolchain's shipped theme catalog: every theme package the lock may
 * name is installed in the toolchain root, `THEME_CATALOG` states exactly what
 * is installed, a build with each theme selected consistently renders that
 * theme's CSS, and a lock/appearance disagreement is refused with
 * `THEME_SELECTION_MISMATCH`.
 *
 * Resolution mirrors the sandbox (`scripts/sandbox-build.sh`):
 * `WORKSPACE_ROOT` is the toolchain's own `node_modules/@rathnasgala2`, set
 * before any module that reads it is imported.
 */

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures/minimal-repository');
const INSTALLED_SCOPE = path.resolve(
  HERE,
  '../../../node_modules/@rathnasgala2',
);
process.env.WORKSPACE_ROOT = INSTALLED_SCOPE;

const { THEME_CATALOG, findThemeCatalogEntry, themePackageNameOf } =
  await import('../src/theme-catalog.js');
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
  });
  await editJson(dir, 'gala/appearance.json', (doc) => {
    doc.theme = `${appearancePackage}@^2.0.0`;
  });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('the catalog is exactly the four installed theme packages', async () => {
  assert.equal(THEME_CATALOG.length, 4);
  for (const entry of THEME_CATALOG) {
    const directory = path.join(
      INSTALLED_SCOPE,
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
    assert.match(entry.integrity, /^sha256:[0-9a-f]{64}$/u);
  }
  assert.equal(
    themePackageNameOf('@rathnasgala2/theme-zebra@^2.0.0'),
    '@rathnasgala2/theme-zebra',
  );
  assert.equal(
    themePackageNameOf('@rathnasgala2/theme-zebra'),
    '@rathnasgala2/theme-zebra',
  );
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
        INSTALLED_SCOPE,
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
    '@rathnasgala2/theme-default',
    '@rathnasgala2/theme-zebra',
  );
  try {
    await assert.rejects(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof RepositoryIntakeError);
        const finding = /** @type {any} */ (error.findings[0]);
        assert.equal(finding.code, 'THEME_SELECTION_MISMATCH');
        assert.match(finding.detail, /theme-zebra/u);
        assert.match(finding.detail, /theme-default/u);
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
