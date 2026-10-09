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
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { runBuild } from '../src/commands/build.js';
import { runValidate } from '../src/commands/validate.js';
import {
  RepositoryIntakeError,
  buildBuildInputFromRepository,
  resolveRepositoryIdentity,
} from '../src/normalize/repository-intake.js';
import { ADAPTER_PACKAGES } from '../src/normalize/destination-capabilities.js';
import {
  resolveBuildEpoch,
  resolveSourceRevision,
} from '../src/normalize/source-revision.js';
import { SchemaValidationError } from '../src/schema.js';
import { imageBytes } from './image-bytes.js';

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

test('managed build identity uses the exact verified GitHub commit and commit epoch without a .git directory', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
      GALA_BUILD_EPOCH: '2026-09-30T17:31:50.000Z',
    };
    assert.equal(
      await resolveSourceRevision(dir, env),
      'sha1:0123456789abcdef0123456789abcdef01234567',
    );
    assert.equal(await resolveBuildEpoch(dir, env), '2026-09-30T17:31:50.000Z');
  } finally {
    await cleanup();
  }
});

/**
 * @param {string} dir the mutable repository copy
 * @param {string} status the frontmatter status to write
 * @returns {Promise<void>} resolves once rewritten
 */
async function setHelloWorldStatus(dir, status) {
  const contentPath = path.join(dir, 'content/hello-world.md');
  const text = await readFile(contentPath, 'utf8');
  await writeFile(
    contentPath,
    text
      .replace('status: published', `status: ${status}`)
      .replace(/^publishedAt: .*\n/mu, ''),
  );
}

/**
 * @param {string} dir the repository directory
 * @param {boolean | undefined} includeDraftsAsUnlisted candidate-render policy
 * @returns {Promise<Record<string, unknown>[]>} the built content entries
 */
async function builtContent(dir, includeDraftsAsUnlisted) {
  const buildInput = await buildBuildInputFromRepository({
    repositoryDirectory: dir,
    ...(includeDraftsAsUnlisted === undefined
      ? {}
      : { includeDraftsAsUnlisted }),
  });
  return /** @type {Record<string, unknown>[]} */ (buildInput.content);
}

test('a draft is omitted from build-input in publish mode', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await setHelloWorldStatus(dir, 'draft');
    await assert.rejects(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      SchemaValidationError,
    );
  } finally {
    await cleanup();
  }
});

test('candidate mode admits a draft as unlisted', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await setHelloWorldStatus(dir, 'draft');
    const content = await builtContent(dir, true);
    assert.equal(content.length, 1);
    const [entry] = /** @type {[{frontmatter: {status: string}}]} */ (
      /** @type {unknown} */ (content)
    );
    assert.equal(entry.frontmatter.status, 'unlisted');
  } finally {
    await cleanup();
  }
});

test('an archived entry is omitted even in candidate mode', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await setHelloWorldStatus(dir, 'archived');
    await assert.rejects(builtContent(dir, true), SchemaValidationError);
  } finally {
    await cleanup();
  }
});

test('resolveSourceRevision ignores a malformed GITHUB_SHA and non-Actions env', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    assert.match(
      await resolveSourceRevision(dir, {
        GITHUB_ACTIONS: 'true',
        GITHUB_SHA: 'abc',
      }),
      /^sha256:/u,
    );
    assert.match(
      await resolveSourceRevision(dir, {
        GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
      }),
      /^sha256:/u,
    );
  } finally {
    await cleanup();
  }
});

test('resolveBuildEpoch ignores a malformed GALA_BUILD_EPOCH and non-Actions env', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    const fallback = await resolveBuildEpoch(dir, {});
    assert.equal(
      await resolveBuildEpoch(dir, {
        GITHUB_ACTIONS: 'true',
        GALA_BUILD_EPOCH: 'yesterday',
      }),
      fallback,
    );
    assert.equal(
      await resolveBuildEpoch(dir, {
        GALA_BUILD_EPOCH: '2026-09-30T17:31:50.000Z',
      }),
      fallback,
    );
  } finally {
    await cleanup();
  }
});

const VALID_INTERACTIONS_CONFIG = {
  schemaId: 'urn:gala:schema:interactions-config:2.0.0',
  schemaVersion: '2.0.0',
  reactions: {
    enabled: true,
    definitions: [
      {
        key: 'insightful',
        label: 'Insightful',
        visual: { kind: 'emoji', token: '💡' },
        order: 1,
        enabled: true,
      },
    ],
  },
  comments: { enabled: true, allowReplies: true, maxDepth: 3 },
  publicCounts: { reactions: true, comments: true },
};

/**
 * @param {string} dir a mutable fixture copy
 * @param {unknown} document the interactions.json content
 * @returns {Promise<void>} resolves once written
 */
async function writeInteractionsConfig(dir, document) {
  await mkdir(path.join(dir, 'gala/modules'), { recursive: true });
  await writeFile(
    path.join(dir, 'gala/modules/interactions.json'),
    typeof document === 'string' ? document : JSON.stringify(document),
  );
}

test('an absent interactions.json leaves modules empty', async () => {
  const buildInput = /** @type {any} */ (
    await buildBuildInputFromRepository({
      repositoryDirectory: FIXTURE_REPOSITORY,
      env: { GALA_API_ORIGIN: 'https://ignored.example' },
    })
  );
  assert.deepEqual(buildInput.modules, {});
});

test('a valid interactions.json sets modules.interactions with default origins', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await writeInteractionsConfig(dir, VALID_INTERACTIONS_CONFIG);
    const buildInput = /** @type {any} */ (
      await buildBuildInputFromRepository({
        repositoryDirectory: dir,
        env: {},
      })
    );
    assert.deepEqual(buildInput.modules, {
      interactions: {
        config: VALID_INTERACTIONS_CONFIG,
        apiOrigin: 'https://api.galascribe.com',
        appOrigin: 'https://app.galascribe.com',
      },
    });
  } finally {
    await cleanup();
  }
});

test('GALA_API_ORIGIN and GALA_APP_ORIGIN override the defaults, including http localhost', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await writeInteractionsConfig(dir, VALID_INTERACTIONS_CONFIG);
    const buildInput = /** @type {any} */ (
      await buildBuildInputFromRepository({
        repositoryDirectory: dir,
        env: {
          GALA_API_ORIGIN: 'http://localhost:8080',
          GALA_APP_ORIGIN: 'http://127.0.0.1:5173/',
        },
      })
    );
    assert.equal(
      buildInput.modules.interactions.apiOrigin,
      'http://localhost:8080',
    );
    assert.equal(
      buildInput.modules.interactions.appOrigin,
      'http://127.0.0.1:5173',
    );
  } finally {
    await cleanup();
  }
});

test('a non-https, non-localhost or non-bare origin is refused', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await writeInteractionsConfig(dir, VALID_INTERACTIONS_CONFIG);
    for (const bad of [
      'http://api.example.com',
      'http://localhost.evil.example',
      'ftp://api.example.com',
      'https://api.example.com/v1',
      'https://api.example.com?x=1',
      'https://user:pw@api.example.com',
      'not a url',
    ]) {
      await rejectsWithFindingCode(
        buildBuildInputFromRepository({
          repositoryDirectory: dir,
          env: { GALA_API_ORIGIN: bad },
        }),
        'INTERACTIONS_ORIGIN_INVALID',
      );
      await rejectsWithFindingCode(
        buildBuildInputFromRepository({
          repositoryDirectory: dir,
          env: { GALA_APP_ORIGIN: bad },
        }),
        'INTERACTIONS_ORIGIN_INVALID',
      );
    }
  } finally {
    await cleanup();
  }
});

test('an unparseable interactions.json is a build error naming the path', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await writeInteractionsConfig(dir, '{ not json');
    await assert.rejects(
      buildBuildInputFromRepository({ repositoryDirectory: dir, env: {} }),
      (/** @type {RepositoryIntakeError} */ error) => {
        assert.ok(error instanceof RepositoryIntakeError);
        assert.match(error.message, /gala\/modules\/interactions\.json/u);
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

/** @type {[string, (config: any) => void][]} */
const INVALID_INTERACTIONS_MUTATIONS = [
  ['unknown top-level property', (c) => (c.extra = true)],
  ['reserved key "like"', (c) => (c.reactions.definitions[0].key = 'like')],
  ['key pattern', (c) => (c.reactions.definitions[0].key = 'Not Valid')],
  [
    'emoji outside the approved list',
    (c) => (c.reactions.definitions[0].visual.token = '🦄'),
  ],
  [
    'label longer than 32 characters',
    (c) => (c.reactions.definitions[0].label = 'x'.repeat(33)),
  ],
  ['order out of range', (c) => (c.reactions.definitions[0].order = 17)],
  ['maxDepth above 4', (c) => (c.comments.maxDepth = 5)],
  ['maxDepth below 1', (c) => (c.comments.maxDepth = 0)],
  [
    'more than 16 definitions',
    (c) => {
      c.reactions.definitions = Array.from({ length: 17 }, (_, i) => ({
        key: `reaction-${i}`,
        label: `R${i}`,
        visual: { kind: 'emoji', token: '👍' },
        order: (i % 16) + 1,
        enabled: true,
      }));
    },
  ],
  [
    'missing publicCounts',
    (c) => {
      delete c.publicCounts;
    },
  ],
  ['wrong schemaVersion', (c) => (c.schemaVersion = '1.0.0')],
];

for (const [rule, mutate] of INVALID_INTERACTIONS_MUTATIONS) {
  test(`interactions.json violating "${rule}" is a build error naming the file`, async () => {
    const { dir, cleanup } = await mutableFixtureCopy();
    try {
      const config = structuredClone(VALID_INTERACTIONS_CONFIG);
      mutate(config);
      await writeInteractionsConfig(dir, config);
      await assert.rejects(
        buildBuildInputFromRepository({ repositoryDirectory: dir, env: {} }),
        (/** @type {SchemaValidationError} */ error) => {
          assert.ok(error instanceof SchemaValidationError);
          assert.equal(error.location, 'gala/modules/interactions.json');
          assert.equal(
            error.schemaId,
            'urn:gala:schema:interactions-config:2.0.0',
          );
          assert.ok(error.diagnostics.length > 0);
          return true;
        },
      );
    } finally {
      await cleanup();
    }
  });
}

test('duplicate reaction keys and duplicate orders are refused', async () => {
  for (const field of ['key', 'order']) {
    const { dir, cleanup } = await mutableFixtureCopy();
    try {
      const config = /** @type {any} */ (
        structuredClone(VALID_INTERACTIONS_CONFIG)
      );
      config.reactions.definitions.push({
        ...config.reactions.definitions[0],
        ...(field === 'key' ? { order: 2 } : { key: 'other' }),
      });
      await writeInteractionsConfig(dir, config);
      await rejectsWithFindingCode(
        buildBuildInputFromRepository({ repositoryDirectory: dir, env: {} }),
        'INTERACTIONS_REACTION_DUPLICATE',
      );
    } finally {
      await cleanup();
    }
  }
});

// --- content media, attribution and Prism editions --------------------------

const AUTHOR_ID = '01912345-6789-7abc-89ab-0123456789ac';
const GENERATION_ID = '01912345-6789-7abc-89ab-0123456789c0';

/**
 * @param {Buffer | string} bytes content
 * @returns {string} its `sha256:` digest
 */
function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * A complete content document: valid front matter (overridden by `fields`)
 * and `body`, exactly as it is laid out on disk.
 *
 * @param {Record<string, unknown>} fields front matter overrides
 * @param {string} body everything after the closing fence line
 * @returns {string} the document text
 */
function contentDocument(fields, body) {
  const frontmatter = {
    schemaId: 'urn:gala:schema:content-frontmatter:2.0.0',
    schemaVersion: '2.0.0',
    id: '01912345-6789-7abc-89ab-0123456789b0',
    kind: 'article',
    title: 'A post',
    language: 'en-US',
    authors: [AUTHOR_ID],
    tags: [],
    status: 'published',
    createdAt: '2026-09-15T00:00:00.000Z',
    publishedAt: '2026-09-15T00:00:00.000Z',
    slug: 'a-post',
    redirects: [],
    extensions: {},
    ...fields,
  };
  return `---\n${YAML.stringify(frontmatter)}---\n${body}`;
}

/**
 * @param {string} dir the mutable repository copy
 * @param {string} name file name under content/
 * @param {Record<string, unknown>} fields front matter overrides
 * @param {string} body everything after the closing fence line
 * @returns {Promise<void>} resolves once written
 */
async function addDocument(dir, name, fields, body) {
  await writeFile(
    path.join(dir, 'content', name),
    contentDocument(fields, body),
  );
}

/**
 * @param {string} dir the mutable repository copy
 * @param {string} relativePath repository-relative file path
 * @param {Buffer | string} bytes the file content
 * @returns {Promise<void>} resolves once written
 */
async function addFile(dir, relativePath, bytes) {
  await mkdir(path.dirname(path.join(dir, relativePath)), { recursive: true });
  await writeFile(path.join(dir, relativePath), bytes);
}

/**
 * @param {string} dir the mutable repository copy
 * @param {string[]} roots the `assetRoots` paths to declare
 * @returns {Promise<void>} resolves once gala/repository.json is rewritten
 */
async function declareAssetRoots(dir, roots) {
  const file = path.join(dir, 'gala/repository.json');
  const repository = JSON.parse(await readFile(file, 'utf8'));
  repository.assetRoots = roots.map((root) => ({ path: root }));
  await writeFile(file, JSON.stringify(repository));
}

/**
 * @param {string} dir the mutable repository copy
 * @param {Record<string, unknown>} fields appearance.json fields to set
 * @returns {Promise<void>} resolves once rewritten
 */
async function setAppearance(dir, fields) {
  const file = path.join(dir, 'gala/appearance.json');
  const appearance = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...appearance, ...fields }));
}

/**
 * Build with a warnings collector.
 *
 * @param {string} dir the repository directory
 * @param {boolean} [includeDraftsAsUnlisted] candidate-render policy
 * @returns {Promise<{buildInput: any, warnings: import('../src/types.js').PublishActionFinding[]}>} the build input and its warnings
 */
async function buildWithWarnings(dir, includeDraftsAsUnlisted = false) {
  /** @type {import('../src/types.js').PublishActionFinding[]} */
  const warnings = [];
  const buildInput = await buildBuildInputFromRepository({
    repositoryDirectory: dir,
    includeDraftsAsUnlisted,
    warnings,
  });
  return { buildInput, warnings };
}

/**
 * @param {Promise<unknown>} promise the candidate promise
 * @returns {Promise<import('../src/types.js').PublishActionFinding[]>} the findings of the intake error it rejects with
 */
async function intakeFindings(promise) {
  /** @type {import('../src/types.js').PublishActionFinding[]} */
  let findings = [];
  await assert.rejects(
    promise,
    (/** @type {RepositoryIntakeError} */ error) => {
      assert.ok(error instanceof RepositoryIntakeError, String(error));
      findings = [...error.findings];
      return true;
    },
  );
  return findings;
}

/**
 * @param {any} buildInput the build input
 * @param {string} sourcePath a document's repository path
 * @returns {any} that document's content record
 */
function recordOf(buildInput, sourcePath) {
  return buildInput.content.find(
    (/** @type {any} */ record) => record.sourcePath === sourcePath,
  );
}

test('a repository without images, a hero, attribution or editions builds the same input shape as before', async () => {
  const buildInput = /** @type {any} */ (
    await buildBuildInputFromRepository({
      repositoryDirectory: FIXTURE_REPOSITORY,
    })
  );
  assert.equal('assets' in buildInput, false);
  assert.equal('attribution' in buildInput.appearance, false);
  assert.equal('media' in buildInput.content[0], false);
  assert.equal('hero' in buildInput.content[0].frontmatter, false);
  assert.equal('edition' in buildInput.content[0].frontmatter, false);
  assert.deepEqual(Object.keys(buildInput.content[0].frontmatter), [
    'id',
    'kind',
    'title',
    'language',
    'authorIds',
    'tags',
    'status',
    'createdAt',
    'publishedAt',
    'slug',
    'redirects',
  ]);
  assert.deepEqual(Object.keys(buildInput.content[0]), [
    'frontmatter',
    'body',
    'bodyMediaType',
    'bodyDigest',
    'renderPolicy',
    'sourcePath',
    'sourceRevision',
    'sourceDigest',
    'resolvedAuthorIds',
  ]);
});

test('a body image becomes an entry of its document media[] with the digest, type and size of its bytes', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    const photo = imageBytes('png', 'photo');
    const diagram = imageBytes('webp', 'diagram');
    await addFile(dir, 'assets/content/photo.png', photo);
    await addFile(dir, 'assets/content/diagram.webp', diagram);
    await addDocument(
      dir,
      'one.md',
      { slug: 'one', id: '01912345-6789-7abc-89ab-0123456789b1' },
      'Text\n\n![First](assets/content/photo.png)\n\n![Again](assets/content/photo.png)\n\n![Diagram](assets/content/diagram.webp)\n',
    );
    await addDocument(
      dir,
      'two.md',
      { slug: 'two', id: '01912345-6789-7abc-89ab-0123456789b2' },
      '![Second](assets/content/photo.png "with a title")\n',
    );
    const { buildInput } = await buildWithWarnings(dir);
    assert.equal('assets' in buildInput, false);
    assert.deepEqual(recordOf(buildInput, 'content/one.md').media, [
      {
        path: 'assets/content/diagram.webp',
        sourceDigest: digestOf(diagram),
        mediaType: 'image/webp',
        byteLength: diagram.byteLength,
      },
      {
        path: 'assets/content/photo.png',
        sourceDigest: digestOf(photo),
        mediaType: 'image/png',
        byteLength: photo.byteLength,
      },
    ]);
    assert.deepEqual(recordOf(buildInput, 'content/two.md').media, [
      {
        path: 'assets/content/photo.png',
        sourceDigest: digestOf(photo),
        mediaType: 'image/png',
        byteLength: photo.byteLength,
      },
    ]);
    assert.equal(
      'media' in recordOf(buildInput, 'content/hello-world.md'),
      false,
    );
    // The body keeps the reference exactly as written: the renderer resolves
    // an <img src> against media[] by the same rule intake used.
    assert.match(
      recordOf(buildInput, 'content/one.md').body,
      /<img src="assets\/content\/photo\.png" alt="First" \/>/u,
    );
  } finally {
    await cleanup();
  }
});

test('an image is found by the path the renderer resolves its src to', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    const spaced = imageBytes('jpeg', 'spaced');
    await addFile(dir, 'assets/my pic.jpg', spaced);
    await addDocument(
      dir,
      'spelled.md',
      { slug: 'spelled', id: '01912345-6789-7abc-89ab-0123456789b1' },
      [
        '![a](assets/my%20pic.jpg)',
        '![b](<assets/my pic.jpg>)',
        '![c](./assets/my%20pic.jpg)',
        '![d](/assets/my%20pic.jpg)',
        '',
      ].join('\n'),
    );
    const { buildInput } = await buildWithWarnings(dir);
    assert.deepEqual(recordOf(buildInput, 'content/spelled.md').media, [
      {
        path: 'assets/my pic.jpg',
        sourceDigest: digestOf(spaced),
        mediaType: 'image/jpeg',
        byteLength: spaced.byteLength,
      },
    ]);
  } finally {
    await cleanup();
  }
});

test('a hero is admitted: it becomes frontmatter.hero and is not listed in media[]', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    const hero = imageBytes('jpeg', 'hero');
    await addFile(dir, 'assets/hero.jpg', hero);
    await addDocument(
      dir,
      'with-hero.md',
      {
        slug: 'with-hero',
        id: '01912345-6789-7abc-89ab-0123456789b1',
        hero: {
          path: 'assets/hero.jpg',
          alt: 'A lake at dawn',
          role: 'informative',
        },
      },
      'Body\n',
    );
    await addDocument(
      dir,
      'decorative.md',
      {
        slug: 'decorative',
        id: '01912345-6789-7abc-89ab-0123456789b2',
        hero: { path: 'assets/hero.jpg', alt: '', role: 'decorative' },
      },
      '![also in the body](assets/hero.jpg)\n',
    );
    const { buildInput } = await buildWithWarnings(dir);
    assert.deepEqual(
      recordOf(buildInput, 'content/with-hero.md').frontmatter.hero,
      {
        file: { path: 'assets/hero.jpg', sourceDigest: digestOf(hero) },
        alt: 'A lake at dawn',
        role: 'informative',
      },
    );
    assert.equal(
      'media' in recordOf(buildInput, 'content/with-hero.md'),
      false,
    );
    assert.deepEqual(
      recordOf(buildInput, 'content/decorative.md').frontmatter.hero,
      {
        file: { path: 'assets/hero.jpg', sourceDigest: digestOf(hero) },
        alt: '',
        role: 'decorative',
      },
    );
    assert.deepEqual(
      recordOf(buildInput, 'content/decorative.md').media.map(
        (/** @type {any} */ entry) => entry.path,
      ),
      ['assets/hero.jpg'],
    );
    assert.equal(
      'hero' in recordOf(buildInput, 'content/hello-world.md').frontmatter,
      false,
    );
  } finally {
    await cleanup();
  }
});

test('socialImageRef is still refused, with the same code as before', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    await addFile(dir, 'assets/social.png', imageBytes('png'));
    await addDocument(
      dir,
      'social.md',
      {
        slug: 'social',
        id: '01912345-6789-7abc-89ab-0123456789b1',
        socialImageRef: 'assets/social.png',
      },
      'Body\n',
    );
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'CONTENT_MEDIA_UNSUPPORTED',
    );
    // It is refused even for a draft that is not part of the build: this
    // rule has always been checked before the draft/archived skip.
    await addDocument(
      dir,
      'social.md',
      {
        slug: 'social',
        id: '01912345-6789-7abc-89ab-0123456789b1',
        status: 'draft',
        publishedAt: undefined,
        socialImageRef: 'assets/social.png',
      },
      'Body\n',
    );
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'CONTENT_MEDIA_UNSUPPORTED',
    );
  } finally {
    await cleanup();
  }
});

test('an unusable image fails the build with MEDIA_REFERENCE_UNRESOLVED naming the document and the path', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    await addFile(dir, 'stray.png', imageBytes('png'));
    await addFile(dir, 'assets/vector.svg', '<svg></svg>');
    await addDocument(
      dir,
      'broken.md',
      { slug: 'broken', id: '01912345-6789-7abc-89ab-0123456789b1' },
      [
        '![missing](assets/missing.png)',
        '![stray](stray.png)',
        '![external](https://example.com/a.png)',
        '![empty]()',
        '![up](../assets/a.png)',
        '![query](assets/a.png?v=1)',
        '![vector](assets/vector.svg)',
        '![escaped](./assets/my%20pic.png)',
        '',
      ].join('\n'),
    );
    const findings = await intakeFindings(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
    );
    assert.ok(findings.length > 0);
    assert.ok(
      findings.every(
        (finding) => finding.code === 'MEDIA_REFERENCE_UNRESOLVED',
      ),
    );
    assert.deepEqual(
      findings.map((finding) => {
        const evidence = /** @type {any} */ (finding.evidence);
        return [evidence.reason, evidence.path];
      }),
      [
        ['FILE_MISSING', 'assets/missing.png'],
        ['OUTSIDE_ASSET_ROOTS', 'stray.png'],
        ['NO_SOURCE', null],
        ['NO_SOURCE', null],
        ['NOT_A_REPOSITORY_PATH', '../assets/a.png'],
        ['NOT_A_REPOSITORY_PATH', 'assets/a.png?v=1'],
        ['UNSUPPORTED_FORMAT', 'assets/vector.svg'],
        ['FILE_MISSING', './assets/my%20pic.png'],
      ],
    );
    for (const finding of findings) {
      assert.equal(finding.location, 'content/broken.md');
      assert.ok(finding.detail.startsWith('content/broken.md: '));
    }
    assert.match(
      findings[0]?.detail ?? '',
      /"assets\/missing\.png" does not exist/u,
    );
    assert.match(
      findings[7]?.detail ?? '',
      /"\.\/assets\/my%20pic\.png" \(the file "assets\/my pic\.png"\) does not exist/u,
    );
  } finally {
    await cleanup();
  }
});

test('with no declared asset root every image is refused', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await addFile(dir, 'assets/pic.png', imageBytes('png'));
    await addDocument(
      dir,
      'pic.md',
      { slug: 'pic', id: '01912345-6789-7abc-89ab-0123456789b1' },
      '![pic](assets/pic.png)\n',
    );
    const [finding] = await intakeFindings(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
    );
    assert.equal(finding?.code, 'MEDIA_REFERENCE_UNRESOLVED');
    assert.equal(
      /** @type {Record<string, unknown>} */ (finding?.evidence ?? {}).reason,
      'OUTSIDE_ASSET_ROOTS',
    );
    assert.match(finding?.detail ?? '', /none are declared/u);
  } finally {
    await cleanup();
  }
});

test('a hero whose file is missing, external or not an image fails the build', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    await addFile(dir, 'assets/notes.txt', 'not an image');
    for (const [heroPath, reason] of [
      ['assets/gone.jpg', 'FILE_MISSING'],
      ['https://example.com/hero.jpg', 'EXTERNAL_ADDRESS'],
      ['assets/notes.txt', 'UNSUPPORTED_FORMAT'],
    ]) {
      await addDocument(
        dir,
        'hero.md',
        {
          slug: 'hero',
          id: '01912345-6789-7abc-89ab-0123456789b1',
          hero: { path: heroPath, alt: 'A hero', role: 'informative' },
        },
        'Body\n',
      );
      const [finding] = await intakeFindings(
        buildBuildInputFromRepository({ repositoryDirectory: dir }),
      );
      assert.equal(finding?.code, 'MEDIA_REFERENCE_UNRESOLVED');
      assert.deepEqual(finding?.evidence, {
        document: 'content/hero.md',
        path: heroPath,
        origin: 'hero',
        reason,
      });
      assert.match(
        finding?.detail ?? '',
        /^content\/hero\.md: the hero image /u,
      );
    }
  } finally {
    await cleanup();
  }
});

test('an image over 10 MiB fails the build with MEDIA_LIMIT_EXCEEDED naming the document and the path', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    await addFile(dir, 'assets/huge.png', imageBytes('png'));
    await truncate(path.join(dir, 'assets/huge.png'), 10 * 1024 * 1024 + 1);
    await addDocument(
      dir,
      'huge.md',
      { slug: 'huge', id: '01912345-6789-7abc-89ab-0123456789b1' },
      '![huge](assets/huge.png)\n',
    );
    const [finding] = await intakeFindings(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
    );
    assert.equal(finding?.code, 'MEDIA_LIMIT_EXCEEDED');
    assert.deepEqual(finding?.evidence, {
      limit: 'IMAGE_BYTES',
      document: 'content/huge.md',
      path: 'assets/huge.png',
      bytes: 10 * 1024 * 1024 + 1,
      max: 10 * 1024 * 1024,
    });
    assert.equal(finding?.location, 'content/huge.md');
  } finally {
    await cleanup();
  }
});

test('a body image over 5 MiB fails the build, because media[] cannot list it; as a hero the same file is accepted', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    await addFile(dir, 'assets/large.jpg', imageBytes('jpeg'));
    const large = path.join(dir, 'assets/large.jpg');
    await truncate(large, 6 * 1024 * 1024);
    await addDocument(
      dir,
      'body.md',
      { slug: 'body', id: '01912345-6789-7abc-89ab-0123456789b1' },
      '![large](assets/large.jpg)\n',
    );
    const [finding] = await intakeFindings(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
    );
    assert.equal(finding?.code, 'MEDIA_LIMIT_EXCEEDED');
    assert.deepEqual(finding?.evidence, {
      limit: 'BODY_IMAGE_BYTES',
      document: 'content/body.md',
      path: 'assets/large.jpg',
      bytes: 6 * 1024 * 1024,
      max: 5 * 1024 * 1024,
    });

    await addDocument(
      dir,
      'body.md',
      {
        slug: 'body',
        id: '01912345-6789-7abc-89ab-0123456789b1',
        hero: {
          path: 'assets/large.jpg',
          alt: 'A large photo',
          role: 'informative',
        },
      },
      'No body image this time.\n',
    );
    const { buildInput } = await buildWithWarnings(dir);
    const record = recordOf(buildInput, 'content/body.md');
    assert.equal('media' in record, false);
    assert.equal(
      record.frontmatter.hero.file.sourceDigest,
      digestOf(await readFile(large)),
    );
  } finally {
    await cleanup();
  }
});

test('only documents that are part of the build are looked at for images', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    await addDocument(
      dir,
      'draft.md',
      {
        slug: 'draft',
        id: '01912345-6789-7abc-89ab-0123456789b1',
        status: 'draft',
        publishedAt: undefined,
        hero: { path: 'assets/nope.jpg', alt: 'x', role: 'informative' },
      },
      '![missing](assets/missing.png)\n',
    );
    await addDocument(
      dir,
      'archived.md',
      {
        slug: 'archived',
        id: '01912345-6789-7abc-89ab-0123456789b2',
        status: 'archived',
        publishedAt: undefined,
      },
      '![missing](assets/missing-too.png)\n',
    );
    // Publish mode: neither is built, so neither image is looked for.
    const { buildInput } = await buildWithWarnings(dir);
    assert.equal(
      buildInput.content.some((/** @type {any} */ record) => 'media' in record),
      false,
    );
    // Candidate mode builds the draft (as unlisted), so its images are required;
    // the archived document is still not built.
    const findings = await intakeFindings(
      buildBuildInputFromRepository({
        repositoryDirectory: dir,
        includeDraftsAsUnlisted: true,
      }),
    );
    assert.deepEqual(
      findings.map((finding) => /** @type {any} */ (finding.evidence).path),
      ['assets/missing.png', 'assets/nope.jpg'],
    );
  } finally {
    await cleanup();
  }
});

test('appearance.attribution is copied into the build-input appearance; absent stays absent', async () => {
  for (const attribution of [{ showMadeWith: false }, { showMadeWith: true }]) {
    const { dir, cleanup } = await mutableFixtureCopy();
    try {
      await setAppearance(dir, { attribution });
      const { buildInput } = await buildWithWarnings(dir);
      assert.deepEqual(buildInput.appearance.attribution, attribution);
    } finally {
      await cleanup();
    }
  }
  const { buildInput } = await buildWithWarnings(FIXTURE_REPOSITORY);
  assert.equal('attribution' in buildInput.appearance, false);
});

const ARTICLE_BODY = 'The original article.\n\nIt has two paragraphs.\n';

/**
 * Write the article `post.md` and an edition of it.
 *
 * @param {string} dir the mutable repository copy
 * @param {object} [options] what to vary
 * @param {string} [options.articleBody] the article text after the front matter
 * @param {string} [options.digestOfBody] the text the edition's `sourceDigest` is taken over
 * @param {Record<string, unknown>} [options.articleFields] article front matter overrides
 * @param {Record<string, unknown>} [options.editionFields] edition front matter overrides
 * @param {string} [options.editionBody] the edition text
 * @returns {Promise<void>} resolves once written
 */
async function addArticleWithEdition(
  dir,
  {
    articleBody = ARTICLE_BODY,
    digestOfBody = articleBody,
    articleFields = {},
    editionFields = {},
    editionBody = 'A shorter reading.\n',
  } = {},
) {
  await addDocument(
    dir,
    'post.md',
    {
      slug: 'post',
      title: 'The post',
      id: '01912345-6789-7abc-89ab-0123456789b1',
      ...articleFields,
    },
    articleBody,
  );
  // `post.edition.quick-read.md` sorts before `post.md`.
  await addDocument(
    dir,
    'post.edition.quick-read.md',
    {
      kind: 'edition',
      slug: 'post-quick-read',
      title: 'The post, quick read',
      id: '01912345-6789-7abc-89ab-0123456789b3',
      edition: {
        of: 'post',
        kind: 'QUICK_READ',
        sourceDigest: digestOf(digestOfBody),
        generation: {
          provider: 'anthropic',
          model: 'claude-sonnet-5-5',
          generationId: GENERATION_ID,
        },
        approvedAt: '2026-09-16T00:00:00.000Z',
      },
      ...editionFields,
    },
    editionBody,
  );
}

/**
 * @param {any} buildInput the build input
 * @returns {string[]} the `sourcePath` of every content record
 */
function contentPaths(buildInput) {
  return buildInput.content.map(
    (/** @type {any} */ record) => record.sourcePath,
  );
}

test('an edition of an unchanged article is passed through with its front matter', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await addArticleWithEdition(dir);
    const { buildInput, warnings } = await buildWithWarnings(dir);
    assert.deepEqual(warnings, []);
    assert.deepEqual(contentPaths(buildInput), [
      'content/hello-world.md',
      'content/post.edition.quick-read.md',
      'content/post.md',
    ]);
    const edition = buildInput.content[1].frontmatter;
    assert.equal(edition.kind, 'edition');
    assert.equal(edition.slug, 'post-quick-read');
    assert.deepEqual(edition.edition, {
      of: 'post',
      kind: 'QUICK_READ',
      sourceDigest: digestOf(ARTICLE_BODY),
      generation: {
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        generationId: GENERATION_ID,
      },
      approvedAt: '2026-09-16T00:00:00.000Z',
    });
    assert.equal('edition' in buildInput.content[2].frontmatter, false);
    assert.match(buildInput.content[1].body, /A shorter reading/u);
  } finally {
    await cleanup();
  }
});

test('the digest is over the exact text after the front matter, leading newlines included', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    // The renderer drops a body's leading empty lines; the digest does not.
    const body = '\n\nStarts with two empty lines.\n\n\n';
    await addArticleWithEdition(dir, { articleBody: body });
    const text = await readFile(path.join(dir, 'content/post.md'), 'utf8');
    // The rule, read the way the API reads a document: LF line endings, the
    // text after the first "\n---\n" that follows the opening fence.
    const afterFence = text.slice(
      text.indexOf('\n---\n', 3) + '\n---\n'.length,
    );
    assert.equal(afterFence, body);
    const { warnings } = await buildWithWarnings(dir);
    assert.deepEqual(warnings, []);

    // Trimming it the way the renderer does is a different digest.
    await addArticleWithEdition(dir, {
      articleBody: body,
      digestOfBody: body.trim(),
    });
    const stale = await buildWithWarnings(dir);
    assert.deepEqual(
      stale.warnings.map((warning) => warning.code),
      ['EDITION_STALE'],
    );
  } finally {
    await cleanup();
  }
});

test('an article with CRLF line endings in its body digests as LF', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await addArticleWithEdition(dir, {
      articleBody: 'Line one\r\nLine two\r\n',
      digestOfBody: 'Line one\nLine two\n',
    });
    const { warnings } = await buildWithWarnings(dir);
    assert.deepEqual(warnings, []);
  } finally {
    await cleanup();
  }
});

test('changing only the article front matter does not make its edition stale; changing the body does', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await addArticleWithEdition(dir, {
      articleFields: { title: 'A different title', tags: ['new-tag'] },
    });
    assert.deepEqual((await buildWithWarnings(dir)).warnings, []);

    await addArticleWithEdition(dir, {
      articleBody: `${ARTICLE_BODY}One more sentence.\n`,
      digestOfBody: ARTICLE_BODY,
    });
    const { buildInput, warnings } = await buildWithWarnings(dir);
    assert.deepEqual(contentPaths(buildInput), [
      'content/hello-world.md',
      'content/post.md',
    ]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, 'EDITION_STALE');
    assert.equal(warnings[0]?.severity, 'WARNING');
    assert.equal(warnings[0]?.location, 'content/post.edition.quick-read.md');
    assert.equal('edition' in buildInput.content[1].frontmatter, false);
  } finally {
    await cleanup();
  }
});

test('the schema requires the sha256: spelling of an edition sourceDigest', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await addArticleWithEdition(dir, {
      editionFields: {
        edition: {
          of: 'post',
          kind: 'QUICK_READ',
          sourceDigest: digestOf(ARTICLE_BODY).slice('sha256:'.length),
          generation: {
            provider: 'anthropic',
            model: 'claude-sonnet-5-5',
            generationId: GENERATION_ID,
          },
          approvedAt: '2026-09-16T00:00:00.000Z',
        },
      },
    });
    await assert.rejects(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      (/** @type {SchemaValidationError} */ error) => {
        assert.ok(error instanceof SchemaValidationError);
        assert.equal(error.location, 'content/post.edition.quick-read.md');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('an edition with no article, or whose article is not in the build, is dropped with EDITION_SOURCE_MISSING', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await addArticleWithEdition(dir, {
      editionFields: {
        edition: {
          of: 'no-such-post',
          kind: 'QUICK_READ',
          sourceDigest: digestOf(ARTICLE_BODY),
          generation: {
            provider: 'anthropic',
            model: 'claude-sonnet-5-5',
            generationId: GENERATION_ID,
          },
          approvedAt: '2026-09-16T00:00:00.000Z',
        },
      },
    });
    const missing = await buildWithWarnings(dir);
    assert.deepEqual(contentPaths(missing.buildInput), [
      'content/hello-world.md',
      'content/post.md',
    ]);
    assert.deepEqual(
      missing.warnings.map((warning) => warning.code),
      ['EDITION_SOURCE_MISSING'],
    );
    assert.match(missing.warnings[0]?.detail ?? '', /"no-such-post"/u);

    // The article exists but is a draft: not built in publish mode, so its
    // edition is not published either. In candidate mode both are built.
    await addArticleWithEdition(dir, {
      articleFields: { status: 'draft', publishedAt: undefined },
    });
    const draft = await buildWithWarnings(dir);
    assert.deepEqual(contentPaths(draft.buildInput), [
      'content/hello-world.md',
    ]);
    assert.deepEqual(
      draft.warnings.map((warning) => warning.code),
      ['EDITION_SOURCE_MISSING'],
    );
    const candidate = await buildWithWarnings(dir, true);
    assert.deepEqual(candidate.warnings, []);
    assert.equal(candidate.buildInput.content.length, 3);
  } finally {
    await cleanup();
  }
});

test('a dropped edition is not checked for authors or images, a kept one is', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    const unknownAuthor = '01912345-6789-7abc-89ab-0123456789af';
    const brokenImage = '![gone](assets/gone.png)\n';
    await addArticleWithEdition(dir, {
      articleBody: ARTICLE_BODY,
      digestOfBody: 'not the article text',
      editionFields: { authors: [unknownAuthor] },
      editionBody: brokenImage,
    });
    // Stale, so left out: the unknown author and the missing image are moot.
    const stale = await buildWithWarnings(dir);
    assert.deepEqual(
      stale.warnings.map((warning) => warning.code),
      ['EDITION_STALE'],
    );

    // Kept, so it is held to the same rules as any document.
    await addArticleWithEdition(dir, {
      editionFields: { authors: [unknownAuthor] },
    });
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'CONTENT_AUTHOR_UNKNOWN',
    );
    await addArticleWithEdition(dir, { editionBody: brokenImage });
    await rejectsWithFindingCode(
      buildBuildInputFromRepository({ repositoryDirectory: dir }),
      'MEDIA_REFERENCE_UNRESOLVED',
    );
  } finally {
    await cleanup();
  }
});

test('a kept edition lists its own images in its media[]', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await declareAssetRoots(dir, ['assets']);
    const chart = imageBytes('png', 'chart');
    await addFile(dir, 'assets/chart.png', chart);
    await addArticleWithEdition(dir, {
      editionBody: 'A shorter reading.\n\n![Chart](assets/chart.png)\n',
    });
    const { buildInput } = await buildWithWarnings(dir);
    assert.deepEqual(
      recordOf(buildInput, 'content/post.edition.quick-read.md').media,
      [
        {
          path: 'assets/chart.png',
          sourceDigest: digestOf(chart),
          mediaType: 'image/png',
          byteLength: chart.byteLength,
        },
      ],
    );
  } finally {
    await cleanup();
  }
});

test('warnings are optional: without a collector a dropped edition is simply left out', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  try {
    await addArticleWithEdition(dir, { digestOfBody: 'other text' });
    const buildInput = /** @type {any} */ (
      await buildBuildInputFromRepository({ repositoryDirectory: dir })
    );
    assert.deepEqual(contentPaths(buildInput), [
      'content/hello-world.md',
      'content/post.md',
    ]);
  } finally {
    await cleanup();
  }
});

test('validate and build report a dropped edition as a warning on a successful result', async () => {
  const { dir, cleanup } = await mutableFixtureCopy();
  const work = await mkdtemp(path.join(tmpdir(), 'gala-edition-envelope-'));
  try {
    await addArticleWithEdition(dir, { digestOfBody: 'other text' });
    const validated = await runValidate({ repositoryDirectory: dir });
    assert.equal(validated.resultCode, 'SUCCESS');
    assert.equal(validated.exitCode, 0);
    assert.deepEqual(
      validated.findings.map((finding) => [finding.code, finding.severity]),
      [['EDITION_STALE', 'WARNING']],
    );

    const built = await runBuild({
      repositoryDirectory: dir,
      outputDirectory: path.join(work, 'output'),
      workDirectory: path.join(work, 'work'),
    });
    assert.equal(built.resultCode, 'SUCCESS', JSON.stringify(built.findings));
    assert.equal(built.exitCode, 0);
    assert.deepEqual(
      built.findings.map((finding) => finding.code),
      ['EDITION_STALE'],
    );

    // A clean repository still reports nothing at all.
    const clean = await runValidate({
      repositoryDirectory: FIXTURE_REPOSITORY,
    });
    assert.deepEqual(clean.findings, []);
  } finally {
    await cleanup();
    await rm(work, { recursive: true, force: true });
  }
});
