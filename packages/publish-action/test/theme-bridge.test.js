/**
 * Unit tests for `theme-bridge.js`'s `resolveThemeDirectory` (S2-T20b
 * deliverable): the three-step resolution order (installed package under
 * the author repository, `GALA_THEME_DIR` override, LOCAL-only sibling
 * checkout), verification against the lock-pinned theme identity, and
 * `theme-contract:2.0.0` schema validation, all fail closed with a typed
 * `SOURCE_ERROR` finding.
 *
 * @module
 */

import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import {
  resolveThemeDirectory,
  ThemeResolutionError,
} from '../src/theme-bridge.js';
import { findThemeCatalogEntry } from '../src/theme-catalog.js';
import { resolveWorkspaceSibling } from '../src/workspace-siblings.js';
import { runBuild } from '../src/commands/build.js';

const FIXTURE_REPOSITORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/minimal-repository',
);

const REAL_THEME = Object.freeze(
  /** @type {import('../src/theme-catalog.js').ThemeCatalogEntry} */ (
    findThemeCatalogEntry('@rathnasgala2/theme-editorial')
  ),
);

/**
 * The real `theme-editorial` sibling checkout on disk, resolved through the
 * same production resolver (`resolveWorkspaceSibling`, step 3 of
 * `resolveThemeDirectory`) `theme-bridge.js` itself uses, reading the
 * ambient `process.env` (so `WORKSPACE_ROOT` still redirects this to the
 * right place when these tests run from a git worktree, per LOCAL-38),
 * instead of a hardcoded path that would silently drift from the resolver
 * it is meant to exercise.
 */
const REAL_THEME_DIRECTORY = resolveWorkspaceSibling('theme-editorial');

/**
 * @returns {Promise<{tmp: string, cleanup: () => Promise<void>}>} a fresh
 *   temporary directory and its cleanup callback
 */
async function freshTempDir() {
  const tmp = await mkdtemp(path.join(tmpdir(), 'gala-theme-bridge-'));
  return { tmp, cleanup: () => rm(tmp, { recursive: true, force: true }) };
}

/**
 * Write a real, `theme-contract:2.0.0`-conformant fixture into `directory`,
 * cloned from the real `theme-editorial` sibling checkout's own `theme.json`
 * (so it validates, unlike a hand-rolled minimal object), with only the
 * package identity overridden.
 *
 * @param {string} directory a directory to write a theme package fixture into
 * @param {{name?: string, version?: string, themePackage?: string}} [overrides]
 * @returns {Promise<void>} resolves once the fixture is written
 */
async function writeThemeFixture(directory, overrides = {}) {
  await mkdir(directory, { recursive: true });
  const name = overrides.name ?? REAL_THEME.package;
  const version = overrides.version ?? REAL_THEME.version;
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ name, version }),
  );
  const realThemeContract = JSON.parse(
    await readFile(path.join(REAL_THEME_DIRECTORY, 'theme.json'), 'utf8'),
  );
  await writeFile(
    path.join(directory, 'theme.json'),
    JSON.stringify({
      ...realThemeContract,
      package: overrides.themePackage ?? `${name}@${version}`,
    }),
  );
}

test('resolveThemeDirectory: finds and verifies the real theme-editorial sibling checkout by default (LOCAL-only fallback)', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    // No `env` override here: this exercises the resolver's real default
    // (`env = process.env`), so it keeps passing from a git worktree where
    // `WORKSPACE_ROOT` (LOCAL-38) redirects the fixed relative default to
    // the real workspace root, exactly like `theme-bridge.js` itself.
    const themeDirectory = await resolveThemeDirectory({
      repositoryDirectory: tmp,
      theme: REAL_THEME,
    });
    assert.equal(themeDirectory, REAL_THEME_DIRECTORY);
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: an installed node_modules package under the author repository wins over every other step', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const installedDirectory = path.join(
      tmp,
      'node_modules',
      '@rathnasgala2',
      'theme-editorial',
    );
    await writeThemeFixture(installedDirectory);
    const themeDirectory = await resolveThemeDirectory({
      repositoryDirectory: tmp,
      theme: REAL_THEME,
      env: { GALA_THEME_DIR: '/does/not/exist' },
    });
    assert.equal(themeDirectory, installedDirectory);
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: GALA_THEME_DIR overrides the local-sibling fallback when no installed package exists', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const overrideDirectory = path.join(tmp, 'override-theme');
    await writeThemeFixture(overrideDirectory);
    const themeDirectory = await resolveThemeDirectory({
      repositoryDirectory: tmp,
      theme: REAL_THEME,
      env: { GALA_THEME_DIR: overrideDirectory },
    });
    assert.equal(themeDirectory, overrideDirectory);
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: WORKSPACE_ROOT redirects the local-sibling fallback to a fake theme-editorial checkout', async () => {
  const { tmp: repositoryDirectory, cleanup: cleanupRepository } =
    await freshTempDir();
  const { tmp: workspaceRoot, cleanup: cleanupWorkspaceRoot } =
    await freshTempDir();
  try {
    const fakeEditorialDirectory = path.join(workspaceRoot, 'theme-editorial');
    await writeThemeFixture(fakeEditorialDirectory);
    const themeDirectory = await resolveThemeDirectory({
      repositoryDirectory,
      theme: REAL_THEME,
      env: { WORKSPACE_ROOT: workspaceRoot },
    });
    assert.equal(
      themeDirectory,
      resolveWorkspaceSibling('theme-editorial', {
        WORKSPACE_ROOT: workspaceRoot,
      }),
    );
    assert.equal(themeDirectory, fakeEditorialDirectory);
  } finally {
    await cleanupRepository();
    await cleanupWorkspaceRoot();
  }
});

test('resolveThemeDirectory: fails closed with THEME_PACKAGE_NOT_FOUND when no candidate directory exists', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    await assert.rejects(
      () =>
        resolveThemeDirectory({
          repositoryDirectory: tmp,
          theme: {
            ...REAL_THEME,
          },
          env: {
            GALA_THEME_DIR: path.join(tmp, 'nope'),
            WORKSPACE_ROOT: path.join(tmp, 'empty-workspace'),
          },
        }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof ThemeResolutionError);
        const findings = /** @type {any} */ (error).findings;
        assert.equal(findings[0].code, 'THEME_PACKAGE_NOT_FOUND');
        assert.equal(findings[0].severity, 'SOURCE_ERROR');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: fails closed with THEME_PACKAGE_IDENTITY_MISMATCH when the resolved package.json disagrees with the lock pin', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const overrideDirectory = path.join(tmp, 'wrong-version-theme');
    await writeThemeFixture(overrideDirectory, { version: '9.9.9' });
    await assert.rejects(
      () =>
        resolveThemeDirectory({
          repositoryDirectory: tmp,
          theme: REAL_THEME,
          env: { GALA_THEME_DIR: overrideDirectory },
        }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof ThemeResolutionError);
        const findings = /** @type {any} */ (error).findings;
        assert.equal(findings[0].code, 'THEME_PACKAGE_IDENTITY_MISMATCH');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: fails closed with THEME_CONTRACT_IDENTITY_MISMATCH when theme.json\'s own "package" field disagrees', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const overrideDirectory = path.join(tmp, 'mismatched-contract-theme');
    await writeThemeFixture(overrideDirectory, {
      themePackage: '@rathnasgala2/theme-editorial@1.0.0',
    });
    await assert.rejects(
      () =>
        resolveThemeDirectory({
          repositoryDirectory: tmp,
          theme: REAL_THEME,
          env: { GALA_THEME_DIR: overrideDirectory },
        }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof ThemeResolutionError);
        const findings = /** @type {any} */ (error).findings;
        assert.equal(findings[0].code, 'THEME_CONTRACT_IDENTITY_MISMATCH');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: fails closed with THEME_CONTRACT_INVALID when theme.json does not validate against theme-contract:2.0.0', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const overrideDirectory = path.join(tmp, 'invalid-contract-theme');
    await mkdir(overrideDirectory, { recursive: true });
    await writeFile(
      path.join(overrideDirectory, 'package.json'),
      JSON.stringify({
        name: REAL_THEME.package,
        version: REAL_THEME.version,
      }),
    );
    await writeFile(
      path.join(overrideDirectory, 'theme.json'),
      JSON.stringify({
        schemaId: 'urn:gala:schema:theme-contract:2.0.0',
        package: `${REAL_THEME.package}@${REAL_THEME.version}`,
        // missing every other required field
      }),
    );
    await assert.rejects(
      () =>
        resolveThemeDirectory({
          repositoryDirectory: tmp,
          theme: REAL_THEME,
          env: { GALA_THEME_DIR: overrideDirectory },
        }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof ThemeResolutionError);
        const findings = /** @type {any} */ (error).findings;
        assert.equal(findings[0].code, 'THEME_CONTRACT_INVALID');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: fails closed with THEME_PACKAGE_NAME_INVALID for a theme package name outside the @rathnasgala2/theme-<name> convention', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    await assert.rejects(
      () =>
        resolveThemeDirectory({
          repositoryDirectory: tmp,
          theme: { ...REAL_THEME, package: '@rathnasgala2/not-a-theme' },
          env: {},
        }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof ThemeResolutionError);
        const findings = /** @type {any} */ (error).findings;
        assert.equal(findings[0].code, 'THEME_PACKAGE_NAME_INVALID');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: accepts another catalog-pinned generation-4 sibling', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const defaultTheme = findThemeCatalogEntry('@rathnasgala2/theme-default');
    assert.ok(defaultTheme);
    const themeDirectory = await resolveThemeDirectory({
      repositoryDirectory: tmp,
      theme: defaultTheme,
    });
    assert.equal(themeDirectory, resolveWorkspaceSibling('theme-default'));
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: rejects a catalog theme with a non-catalog candidate digest', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    await assert.rejects(
      () =>
        resolveThemeDirectory({
          repositoryDirectory: tmp,
          theme: {
            ...REAL_THEME,
            integrity: `sha256:${'0'.repeat(64)}`,
          },
          env: {},
        }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof ThemeResolutionError);
        const finding = error.findings[0];
        assert.ok(finding);
        assert.equal(finding.code, 'THEME_PACKAGE_UNSUPPORTED');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('resolveThemeDirectory: an existing-but-wrong candidate fails closed rather than falling through to the next step', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const installedDirectory = path.join(
      tmp,
      'node_modules',
      '@rathnasgala2',
      'theme-editorial',
    );
    await writeThemeFixture(installedDirectory, { version: '9.9.9' });
    // A correct copy exists at GALA_THEME_DIR, but step 1 (the installed
    // package) is found first and is wrong: resolution must fail, not skip
    // ahead to the override.
    const overrideDirectory = path.join(tmp, 'correct-theme');
    await writeThemeFixture(overrideDirectory);
    await assert.rejects(
      () =>
        resolveThemeDirectory({
          repositoryDirectory: tmp,
          theme: REAL_THEME,
          env: { GALA_THEME_DIR: overrideDirectory },
        }),
      (/** @type {any} */ error) => {
        assert.ok(error instanceof ThemeResolutionError);
        const findings = /** @type {any} */ (error).findings;
        assert.equal(findings[0].code, 'THEME_PACKAGE_IDENTITY_MISMATCH');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('runBuild: fails closed with a SOURCE_ERROR finding (UNSAFE_INPUT, exit 5) when the lock-pinned theme package cannot be verified', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const repositoryCopy = path.join(tmp, 'repo');
    await cp(FIXTURE_REPOSITORY, repositoryCopy, { recursive: true });
    const lockPath = path.join(repositoryCopy, 'gala.lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    // The generation-4 catalog admits Editorial 4 exactly; any other version
    // is rejected before package resolution.
    lock.theme.version = '9.9.9';
    lock.lockDigest = /** @type {any} */ (ACTIVE_DIGEST_PROFILES.lock).digest(
      lock,
    );
    await writeFile(lockPath, JSON.stringify(lock));

    const result = await runBuild({
      repositoryDirectory: repositoryCopy,
      outputDirectory: path.join(tmp, 'output'),
      workDirectory: path.join(tmp, 'work'),
    });
    assert.equal(result.resultCode, 'UNSAFE_INPUT');
    assert.equal(result.exitCode, 5);
    assert.ok(
      result.findings.some(
        (finding) => finding.code === 'LOCK_THEME_IDENTITY_INVALID',
      ),
      JSON.stringify(result.findings),
    );
    assert.equal(result.outputDirectory, undefined);
  } finally {
    await cleanup();
  }
});
