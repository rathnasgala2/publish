/**
 * Unit coverage for `normalize/repository-intake.js`'s fail-closed
 * behavior: every documented scope reduction and every schema-validation
 * failure path is exercised against a mutated copy of the fixture
 * repository, plus the happy path already covered end to end by
 * `test/e2e-npx-and-action.test.js`.
 *
 * @module
 */

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RepositoryIntakeError,
  buildBuildInputFromRepository,
  resolveRepositoryIdentity,
} from '../src/normalize/repository-intake.js';
import { ADAPTER_PACKAGES } from '../src/normalize/destination-capabilities.js';
import { resolveSourceRevision } from '../src/normalize/source-revision.js';
import { SchemaValidationError } from '../src/schema.js';

const FIXTURE_REPOSITORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/minimal-repository',
);

/**
 * @returns {Promise<{dir: string, cleanup: () => Promise<void>}>} a fresh
 *   mutable copy of the fixture repository
 */
async function mutableFixtureCopy() {
  const dir = await mkdtemp(path.join(tmpdir(), 'gala-repo-intake-'));
  await cp(FIXTURE_REPOSITORY, dir, { recursive: true });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Assert `promise` rejects with a {@link RepositoryIntakeError} carrying at
 * least one finding with the named `code`.
 *
 * @param {Promise<unknown>} promise the candidate promise
 * @param {string} code the expected finding code
 * @returns {Promise<void>} resolves once asserted
 */
async function rejectsWithFindingCode(promise, code) {
  await assert.rejects(
    promise,
    (/** @type {RepositoryIntakeError} */ error) => {
      assert.ok(
        error instanceof RepositoryIntakeError,
        `expected a RepositoryIntakeError, got ${error}`,
      );
      assert.ok(
        error.findings.some((finding) => finding.code === code),
        `expected a finding with code ${code}, got ${JSON.stringify(error.findings)}`,
      );
      return true;
    },
  );
}

test('the fixture repository normalizes to a schema-valid build-input', async () => {
  const buildInput = await buildBuildInputFromRepository({
    repositoryDirectory: FIXTURE_REPOSITORY,
  });
  assert.equal(buildInput.schemaId, 'urn:gala:schema:build-input:2.0.0');
  assert.equal(
    /** @type {{content: unknown[]}} */ (buildInput).content.length,
    1,
  );
  assert.equal(
    /** @type {{modules: object}} */ (buildInput).modules &&
      Object.keys(buildInput.modules).length,
    0,
  );
  assert.deepEqual(
    /** @type {{placements: unknown[]}} */ (buildInput).placements,
    [],
  );
});

test('destinationCapabilities.adapter byte-equals the lock-selected adapter for all three adapters (DEC-097 sections 3 and 5)', async () => {
  for (const [adapterPackage, adapterId] of Object.entries(ADAPTER_PACKAGES)) {
    const { dir, cleanup } = await mutableFixtureCopy();
    try {
      const lockPath = path.join(dir, 'gala.lock.json');
      const lock = JSON.parse(await readFile(lockPath, 'utf8'));
      lock.publisher = lock.publisher.map((/** @type {any} */ row) =>
        Object.hasOwn(ADAPTER_PACKAGES, row.package)
          ? { ...row, package: adapterPackage, version: '3.1.4' }
          : row,
      );
      await writeFile(lockPath, JSON.stringify(lock, null, 2));
      const buildInput = /** @type {any} */ (
        await buildBuildInputFromRepository({ repositoryDirectory: dir })
      );
      const row = lock.publisher.find(
        (/** @type {any} */ entry) => entry.package === adapterPackage,
      );
      assert.deepEqual(buildInput.destinationCapabilities.adapter, {
        adapterId,
        adapterVersion: row.version,
        adapterDigest: row.integrity,
      });
      assert.equal(
        buildInput.destinationCapabilities.baseUrl,
        buildInput.publication.canonicalBase,
      );
      assert.equal(buildInput.baseUrl, buildInput.publication.canonicalBase);
      assert.match(
        buildInput.destinationCapabilities.capabilityDigest,
        /^sha256:[0-9a-f]{64}$/u,
      );
    } finally {
      await cleanup();
    }
  }
});

test('a lock that selects two adapters, or none, is refused before a build-input exists', async () => {
  for (const variant of ['two', 'none']) {
    const { dir, cleanup } = await mutableFixtureCopy();
    try {
      const lockPath = path.join(dir, 'gala.lock.json');
      const lock = JSON.parse(await readFile(lockPath, 'utf8'));
      const adapterRow = lock.publisher.find((/** @type {any} */ row) =>
        Object.hasOwn(ADAPTER_PACKAGES, row.package),
      );
      lock.publisher = lock.publisher.filter(
        (/** @type {any} */ row) => row !== adapterRow,
      );
      if (variant === 'two') {
        lock.publisher.push(adapterRow, {
          ...adapterRow,
          package: '@rathnasgala2/adapter-do-spaces',
        });
      }
      await writeFile(lockPath, JSON.stringify(lock, null, 2));
      await assert.rejects(
        buildBuildInputFromRepository({ repositoryDirectory: dir }),
        (/** @type {Error} */ error) => {
          // The lock schema itself pins exactly four publisher rows, so the
          // schema refusal is reached first; either way no build-input with
          // an invented adapter identity is produced.
          assert.ok(
            error instanceof SchemaValidationError ||
              /LOCK_ADAPTER_SELECTION_INVALID/u.test(error.message),
            error.message,
          );
          return true;
        },
      );
    } finally {
      await cleanup();
    }
  }
});

test('rejects a relative repositoryDirectory', async () => {
  await assert.rejects(
    buildBuildInputFromRepository({
      repositoryDirectory: 'test/fixtures/minimal-repository',
    }),
    RepositoryIntakeError,
  );
});

test('rejects invalid JSON in an authored document', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await writeFile(path.join(dir, 'gala/repository.json'), '{not valid json');
    await assert.rejects(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      RepositoryIntakeError,
    );
  } finally {
    await cleanup();
  }
});

test('rejects an authored document that fails schema validation', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const repositoryPath = path.join(dir, 'gala/repository.json');
    const repository = JSON.parse(await readFile(repositoryPath, 'utf8'));
    delete repository.defaultLanguage;
    await writeFile(repositoryPath, JSON.stringify(repository));
    await assert.rejects(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      SchemaValidationError,
    );
  } finally {
    await cleanup();
  }
});

test('rejects a repositoryId/publicationId mismatch between repository.json and publication.json', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const publicationPath = path.join(dir, 'gala/publication.json');
    const publication = JSON.parse(await readFile(publicationPath, 'utf8'));
    publication.id = '01912345-6789-7abc-89ab-0123456789ae';
    await writeFile(publicationPath, JSON.stringify(publication));
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'REPOSITORY_PUBLICATION_ID_MISMATCH',
    );
  } finally {
    await cleanup();
  }
});

test('rejects publication.json profile/footerCard as an unsupported scope reduction', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const publicationPath = path.join(dir, 'gala/publication.json');
    const publication = JSON.parse(await readFile(publicationPath, 'utf8'));
    publication.profile = { route: '/about', body: 'content/hello-world.md' };
    await writeFile(publicationPath, JSON.stringify(publication));
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'PUBLICATION_PROFILE_OR_FOOTER_CARD_UNSUPPORTED',
    );
  } finally {
    await cleanup();
  }
});

test('rejects an author reference not present in publication.json (author membership check)', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const contentPath = path.join(dir, 'content/hello-world.md');
    const text = await readFile(contentPath, 'utf8');
    await writeFile(
      contentPath,
      text.replace(
        '01912345-6789-7abc-89ab-0123456789ac',
        '01912345-6789-7abc-89ab-0123456789af',
      ),
    );
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'CONTENT_AUTHOR_UNKNOWN',
    );
  } finally {
    await cleanup();
  }
});

test('rejects a repository with no content files', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await rm(path.join(dir, 'content/hello-world.md'));
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'REPOSITORY_CONTENT_EMPTY',
    );
  } finally {
    await cleanup();
  }
});

test('rejects a content frontmatter fence that is never closed', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const contentPath = path.join(dir, 'content/hello-world.md');
    await writeFile(contentPath, '---\na: 1\n# no closing fence\n');
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'CONTENT_FRONTMATTER_FENCE_UNCLOSED',
    );
  } finally {
    await cleanup();
  }
});

test('rejects a content frontmatter block that uses a YAML anchor/alias', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const contentPath = path.join(dir, 'content/hello-world.md');
    const text = await readFile(contentPath, 'utf8');
    const withAlias = text.replace(
      'title: Hello World',
      'title: &t Hello World\naliasedTitle: *t',
    );
    await writeFile(contentPath, withAlias);
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'CONTENT_FRONTMATTER_PARSE_FAILED',
    );
  } finally {
    await cleanup();
  }
});

test('rejects a content frontmatter block with a duplicate key', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const contentPath = path.join(dir, 'content/hello-world.md');
    const text = await readFile(contentPath, 'utf8');
    const withDuplicate = text.replace(
      'title: Hello World',
      'title: Hello World\ntitle: Hello World Again',
    );
    await writeFile(contentPath, withDuplicate);
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'CONTENT_FRONTMATTER_PARSE_FAILED',
    );
  } finally {
    await cleanup();
  }
});

test('rejects appearance.json fontAssetRefs as an unsupported scope reduction', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const appearancePath = path.join(dir, 'gala/appearance.json');
    const appearance = JSON.parse(await readFile(appearancePath, 'utf8'));
    appearance.fontAssetRefs = ['content/hello-world.md'];
    await writeFile(appearancePath, JSON.stringify(appearance));
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'APPEARANCE_MEDIA_UNSUPPORTED',
    );
  } finally {
    await cleanup();
  }
});

test('resolveRepositoryIdentity: deterministic local stand-in when not running in Actions', () => {
  const first = resolveRepositoryIdentity('/some/repo', {});
  const second = resolveRepositoryIdentity('/some/repo', {});
  assert.deepEqual(first, second);
  assert.match(first.repositoryId, /^[1-9][0-9]{0,19}$/u);
  assert.match(first.repositoryOwnerId, /^[1-9][0-9]{0,19}$/u);
  const different = resolveRepositoryIdentity('/some/other-repo', {});
  assert.notEqual(different.repositoryId, first.repositoryId);
});

test('resolveRepositoryIdentity: real GitHub Actions environment facts are used verbatim when present', () => {
  const identity = resolveRepositoryIdentity('/some/repo', {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY_ID: '12345',
    GITHUB_REPOSITORY_OWNER_ID: '67890',
  });
  assert.deepEqual(identity, {
    repositoryId: '12345',
    repositoryOwnerId: '67890',
  });
});

test('resolveSourceRevision: falls back to a deterministic local stand-in outside a git working tree', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const first = await resolveSourceRevision(dir);
    const second = await resolveSourceRevision(dir);
    assert.equal(first, second);
    assert.match(first, /^sha256:[0-9a-f]{64}$/u);
  } finally {
    await cleanup();
  }
});
