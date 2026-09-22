/**
 * Unit and `runBuild`-level tests for `build-directory-safety.js`: the
 * fail-closed guard in front of `runBuild`'s `rm(outputDirectory, {recursive:
 * true})`/`rm(workDirectory, {recursive: true})` removal, added after an
 * independent review finding on the STAGE_INTEGRITY_MISMATCH fix (commit
 * 5f2486b) noted both directories are caller-controlled (`--output`/
 * `--work`, the Action's `output-directory`/`work-directory` inputs, or
 * their `<repositoryDirectory>/.gala/{output,work}` defaults) and an
 * unguarded `--output .` (or an equivalent ancestor/cwd/home/root value)
 * would delete the author's own repository.
 *
 * @module
 */

import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertDistinctBuildDirectories,
  assertWipeableBuildDirectory,
  BUILD_DIRECTORY_MARKER_FILENAME,
  UnsafeBuildDirectoryError,
  writeBuildDirectoryMarker,
} from '../src/build-directory-safety.js';
import { runBuild } from '../src/commands/build.js';

const FIXTURE_REPOSITORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/minimal-repository',
);

/**
 * @returns {Promise<{tmp: string, cleanup: () => Promise<void>}>} a fresh
 *   temporary directory and its cleanup callback
 */
async function freshTempDir() {
  const tmp = await mkdtemp(
    path.join(tmpdir(), 'gala-build-directory-safety-'),
  );
  return { tmp, cleanup: () => rm(tmp, { recursive: true, force: true }) };
}

/**
 * @param {string} directory a directory
 * @returns {Promise<string[]>} its sorted entry names, or `[]` if absent
 */
async function readdirSafe(directory) {
  try {
    return (await readdir(directory)).sort();
  } catch {
    return [];
  }
}

// --- assertDistinctBuildDirectories: ancestor/self refusals ----------------

test('assertDistinctBuildDirectories: refuses an outputDirectory equal to repositoryDirectory', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    assert.throws(
      () =>
        assertDistinctBuildDirectories({
          outputDirectory: tmp,
          workDirectory: path.join(tmp, 'work'),
          repositoryDirectory: tmp,
        }),
      UnsafeBuildDirectoryError,
    );
  } finally {
    await cleanup();
  }
});

test('assertDistinctBuildDirectories: refuses an outputDirectory that is an ancestor of repositoryDirectory', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const repositoryDirectory = path.join(tmp, 'nested', 'repo');
    assert.throws(
      () =>
        assertDistinctBuildDirectories({
          outputDirectory: tmp,
          workDirectory: path.join(tmp, 'work-elsewhere'),
          repositoryDirectory,
        }),
      UnsafeBuildDirectoryError,
    );
  } finally {
    await cleanup();
  }
});

test('assertDistinctBuildDirectories: refuses a workDirectory equal to repositoryDirectory', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    assert.throws(
      () =>
        assertDistinctBuildDirectories({
          outputDirectory: path.join(tmp, 'output'),
          workDirectory: tmp,
          repositoryDirectory: tmp,
        }),
      UnsafeBuildDirectoryError,
    );
  } finally {
    await cleanup();
  }
});

test('assertDistinctBuildDirectories: refuses an outputDirectory equal to the current working directory', () => {
  assert.throws(
    () =>
      assertDistinctBuildDirectories({
        outputDirectory: process.cwd(),
        workDirectory: path.join(process.cwd(), '..', 'gala-work-elsewhere'),
        repositoryDirectory: path.join(
          process.cwd(),
          '..',
          'gala-repo-elsewhere',
        ),
      }),
    UnsafeBuildDirectoryError,
  );
});

test('assertDistinctBuildDirectories: refuses a workDirectory that is an ancestor of the current working directory', () => {
  const ancestor = path.resolve(process.cwd(), '..');
  assert.throws(
    () =>
      assertDistinctBuildDirectories({
        outputDirectory: path.join(process.cwd(), '.gala-output-elsewhere'),
        workDirectory: ancestor,
        repositoryDirectory: path.join(process.cwd(), '.gala-repo-elsewhere'),
      }),
    UnsafeBuildDirectoryError,
  );
});

test("assertDistinctBuildDirectories: refuses an outputDirectory equal to the user's home directory", async () => {
  const { homedir } = await import('node:os');
  assert.throws(
    () =>
      assertDistinctBuildDirectories({
        outputDirectory: homedir(),
        workDirectory: path.join(homedir(), '..', 'gala-work-elsewhere'),
        repositoryDirectory: path.join(homedir(), '..', 'gala-repo-elsewhere'),
      }),
    UnsafeBuildDirectoryError,
  );
});

test('assertDistinctBuildDirectories: refuses an outputDirectory equal to the filesystem root', () => {
  const root = path.parse(process.cwd()).root;
  assert.throws(
    () =>
      assertDistinctBuildDirectories({
        outputDirectory: root,
        workDirectory: path.join(root, 'gala-work-elsewhere'),
        repositoryDirectory: path.join(root, 'gala-repo-elsewhere'),
      }),
    UnsafeBuildDirectoryError,
  );
});

test('assertDistinctBuildDirectories: refuses outputDirectory and workDirectory being the same path', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const shared = path.join(tmp, 'shared');
    assert.throws(
      () =>
        assertDistinctBuildDirectories({
          outputDirectory: shared,
          workDirectory: shared,
          repositoryDirectory: path.join(tmp, 'repo'),
        }),
      UnsafeBuildDirectoryError,
    );
  } finally {
    await cleanup();
  }
});

test('assertDistinctBuildDirectories: refuses workDirectory nested inside outputDirectory', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const outputDirectory = path.join(tmp, 'output');
    assert.throws(
      () =>
        assertDistinctBuildDirectories({
          outputDirectory,
          workDirectory: path.join(outputDirectory, 'work'),
          repositoryDirectory: path.join(tmp, 'repo'),
        }),
      UnsafeBuildDirectoryError,
    );
  } finally {
    await cleanup();
  }
});

test('assertDistinctBuildDirectories: refuses outputDirectory nested inside workDirectory', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const workDirectory = path.join(tmp, 'work');
    assert.throws(
      () =>
        assertDistinctBuildDirectories({
          outputDirectory: path.join(workDirectory, 'output'),
          workDirectory,
          repositoryDirectory: path.join(tmp, 'repo'),
        }),
      UnsafeBuildDirectoryError,
    );
  } finally {
    await cleanup();
  }
});

test('assertDistinctBuildDirectories: passes for three distinct, unnested, non-dangerous directories', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    assert.doesNotThrow(() =>
      assertDistinctBuildDirectories({
        outputDirectory: path.join(tmp, 'output'),
        workDirectory: path.join(tmp, 'work'),
        repositoryDirectory: path.join(tmp, 'repo'),
      }),
    );
  } finally {
    await cleanup();
  }
});

// --- assertWipeableBuildDirectory: marker-gated non-empty refusal ----------

test('assertWipeableBuildDirectory: allows an absent directory', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    await assert.doesNotReject(
      assertWipeableBuildDirectory(path.join(tmp, 'absent'), 'output'),
    );
  } finally {
    await cleanup();
  }
});

test('assertWipeableBuildDirectory: allows an existing empty directory', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const directory = path.join(tmp, 'empty');
    await mkdir(directory, { recursive: true });
    await assert.doesNotReject(
      assertWipeableBuildDirectory(directory, 'output'),
    );
  } finally {
    await cleanup();
  }
});

test('assertWipeableBuildDirectory: refuses an existing non-empty directory with no marker', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const directory = path.join(tmp, 'dirty');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'unexpected-file.txt'), 'hello\n');
    await assert.rejects(
      assertWipeableBuildDirectory(directory, 'output'),
      UnsafeBuildDirectoryError,
    );
  } finally {
    await cleanup();
  }
});

test('assertWipeableBuildDirectory: allows an existing non-empty directory carrying the marker', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const directory = path.join(tmp, 'owned');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'leftover-from-prior-build.html'),
      '<p>hi</p>\n',
    );
    await writeBuildDirectoryMarker(directory);
    await assert.doesNotReject(
      assertWipeableBuildDirectory(directory, 'output'),
    );
  } finally {
    await cleanup();
  }
});

test('writeBuildDirectoryMarker writes a readable marker file at the given filename', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    await mkdir(tmp, { recursive: true });
    await writeBuildDirectoryMarker(tmp);
    const markerPath = path.join(tmp, BUILD_DIRECTORY_MARKER_FILENAME);
    const content = await readFile(markerPath, 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.package, '@rathnasgala2/publish-action');
  } finally {
    await cleanup();
  }
});

// --- runBuild-level: the guard actually blocks the dangerous default -------

test('runBuild: refuses when outputDirectory equals repositoryDirectory, and never touches the repository', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const before = await readdirSafe(FIXTURE_REPOSITORY);

    const result = await runBuild({
      repositoryDirectory: FIXTURE_REPOSITORY,
      outputDirectory: FIXTURE_REPOSITORY,
      workDirectory: path.join(tmp, 'work'),
    });

    assert.equal(result.resultCode, 'UNSAFE_INPUT');
    assert.equal(result.exitCode, 5);
    assert.ok(
      result.findings.some(
        (finding) => finding.code === 'UNSAFE_BUILD_DIRECTORY',
      ),
      JSON.stringify(result.findings),
    );

    const after = await readdirSafe(FIXTURE_REPOSITORY);
    assert.deepEqual(
      before,
      after,
      'a refused build must never remove or alter the repository directory',
    );
  } finally {
    await cleanup();
  }
});

test('runBuild: refuses when outputDirectory equals the process working directory', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const result = await runBuild({
      repositoryDirectory: FIXTURE_REPOSITORY,
      outputDirectory: process.cwd(),
      workDirectory: path.join(tmp, 'work'),
    });
    assert.equal(result.resultCode, 'UNSAFE_INPUT');
    assert.equal(result.exitCode, 5);
    assert.ok(
      result.findings.some(
        (finding) => finding.code === 'UNSAFE_BUILD_DIRECTORY',
      ),
      JSON.stringify(result.findings),
    );
  } finally {
    await cleanup();
  }
});

test('runBuild: refuses when outputDirectory and workDirectory are the same path', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const shared = path.join(tmp, 'shared');
    const result = await runBuild({
      repositoryDirectory: FIXTURE_REPOSITORY,
      outputDirectory: shared,
      workDirectory: shared,
    });
    assert.equal(result.resultCode, 'UNSAFE_INPUT');
    assert.equal(result.exitCode, 5);
    assert.ok(
      result.findings.some(
        (finding) => finding.code === 'UNSAFE_BUILD_DIRECTORY',
      ),
      JSON.stringify(result.findings),
    );
  } finally {
    await cleanup();
  }
});

test('runBuild: refuses to reuse a non-empty output directory left over from something other than a prior runBuild call', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const outputDirectory = path.join(tmp, 'output');
    const workDirectory = path.join(tmp, 'work');
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, 'not-ours.txt'),
      'do not delete me\n',
    );

    const result = await runBuild({
      repositoryDirectory: FIXTURE_REPOSITORY,
      outputDirectory,
      workDirectory,
    });
    assert.equal(result.resultCode, 'UNSAFE_INPUT');
    assert.equal(result.exitCode, 5);
    assert.ok(
      result.findings.some(
        (finding) => finding.code === 'UNSAFE_BUILD_DIRECTORY',
      ),
      JSON.stringify(result.findings),
    );

    // The unrelated file must still be there -- the refusal happens before
    // any removal.
    const survivingEntries = await readdirSafe(outputDirectory);
    assert.deepEqual(survivingEntries, ['not-ours.txt']);
  } finally {
    await cleanup();
  }
});

test('runBuild: a second call into the exact same output/work directories succeeds (marker-gated reuse) and writes the marker both times', async () => {
  const { tmp, cleanup } = await freshTempDir();
  try {
    const outputDirectory = path.join(tmp, 'output');
    const workDirectory = path.join(tmp, 'work');

    const first = await runBuild({
      repositoryDirectory: FIXTURE_REPOSITORY,
      outputDirectory,
      workDirectory,
    });
    assert.equal(first.resultCode, 'SUCCESS', JSON.stringify(first.findings));
    await assert.doesNotReject(
      readFile(path.join(outputDirectory, BUILD_DIRECTORY_MARKER_FILENAME)),
    );
    await assert.doesNotReject(
      readFile(path.join(workDirectory, BUILD_DIRECTORY_MARKER_FILENAME)),
    );

    const second = await runBuild({
      repositoryDirectory: FIXTURE_REPOSITORY,
      outputDirectory,
      workDirectory,
    });
    assert.equal(second.resultCode, 'SUCCESS', JSON.stringify(second.findings));
    assert.equal(second.artifactDigest, first.artifactDigest);

    // The marker itself must never leak into the rendered route/asset set.
    const manifest =
      /** @type {{routes: {path: string}[], assets?: {path: string}[]}} */ (
        second.manifest
      );
    const manifestPaths = [
      ...manifest.routes.map((route) => route.path),
      ...(manifest.assets ?? []).map((asset) => asset.path),
    ];
    assert.ok(!manifestPaths.includes(BUILD_DIRECTORY_MARKER_FILENAME));
  } finally {
    await cleanup();
  }
});
