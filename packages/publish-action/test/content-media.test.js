/**
 * Unit coverage for `normalize/content-media.js`: reading image references
 * out of sanitized HTML, the reference-path grammar, asset-root and symbolic
 * link containment, the media limits and the digest inventory. The same
 * module is exercised through whole-repository intake in
 * `test/repository-intake.test.js`.
 *
 * @module
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  MAX_MEDIA_FINDINGS,
  MEDIA_LIMITS,
  findImageSources,
  normalizeAssetRoots,
  referencePathProblem,
  resolveMediaReferences,
} from '../src/normalize/content-media.js';
import {
  TEMPLATE_ROOT,
  importTemplatePublicEntry,
} from '../src/template-bridge.js';

/**
 * @param {Buffer | string} bytes file content
 * @returns {string} its `sha256:` digest
 */
function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Run `body` against a fresh repository directory with an `assets/` root.
 *
 * @param {(directory: string) => Promise<void>} body the test body
 * @returns {Promise<void>} resolves once the directory is removed
 */
async function withRepository(body) {
  const directory = await mkdtemp(path.join(tmpdir(), 'gala-media-'));
  try {
    await mkdir(path.join(directory, 'assets'), { recursive: true });
    await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * @param {string} document the referring document
 * @param {string | null} reference the path as written
 * @param {'body' | 'hero'} [origin] where the reference comes from
 * @returns {import('../src/normalize/content-media.js').MediaReference} the reference
 */
function reference(document, reference, origin = 'body') {
  return { document, origin, path: reference, alt: 'a picture' };
}

/**
 * @param {Awaited<ReturnType<typeof resolveMediaReferences>>} result a resolution result
 * @returns {string[]} the stable reason (or limit) code of each finding
 */
function reasons(result) {
  return result.findings.map((finding) => {
    const evidence = /** @type {Record<string, unknown>} */ (finding.evidence);
    return String(evidence.reason ?? evidence.limit);
  });
}

test('findImageSources lists images in document order with decoded attributes', () => {
  assert.deepEqual(
    findImageSources(
      '<p><img src="assets/a&amp;b.png" alt="The &quot;one&quot; &lt;b&gt;" /></p>' +
        '<p><a href="https://example.com"><img src="assets/c.png" alt="" /></a></p>' +
        '<IMG alt="shouting" SRC="assets/d.png">',
    ).map(({ src, alt }) => [src, alt]),
    [
      ['assets/a&b.png', 'The "one" <b>'],
      ['assets/c.png', ''],
      // Attribute names are matched exactly as the sanitizer writes them
      // (lower case), so a shouting tag is read as an image with no usable path.
      [null, 'shouting'],
    ],
  );
});

test('findImageSources reads an image without a src as null, and does not decode twice', () => {
  assert.deepEqual(findImageSources('<p><img alt="x" /></p>'), [
    { src: null, alt: 'x' },
  ]);
  assert.deepEqual(findImageSources('<img src="" alt="empty" />'), [
    { src: null, alt: 'empty' },
  ]);
  assert.deepEqual(findImageSources('<img src="a&amp;lt;b.png" alt="x" />'), [
    { src: 'a&lt;b.png', alt: 'x' },
  ]);
  assert.deepEqual(findImageSources('<p>no pictures here</p>'), []);
});

test('findImageSources agrees with the template normalizer on every Markdown image form', async () => {
  const { normalizeAuthoredMarkdown } = /** @type {any} */ (
    await importTemplatePublicEntry()
  );
  /** @type {[string, ({src: string | null, alt: string})[]][]} */
  const cases = [
    ['![x](assets/a.png)', [{ src: 'assets/a.png', alt: 'x' }]],
    ['![x](assets/a.png "A title")', [{ src: 'assets/a.png', alt: 'x' }]],
    ['![x][r]\n\n[r]: assets/ref.png', [{ src: 'assets/ref.png', alt: 'x' }]],
    ['![a&b](assets/a&b.png)', [{ src: 'assets/a&b.png', alt: 'a&b' }]],
    // markdown-it escapes a space; the reference is then not a plain path.
    ['![x](<assets/my pic.png>)', [{ src: 'assets/my%20pic.png', alt: 'x' }]],
    ['![](assets/noalt.png)', [{ src: 'assets/noalt.png', alt: '' }]],
    ['![x](./assets/a.png)', [{ src: './assets/a.png', alt: 'x' }]],
    ['![x](../assets/a.png)', [{ src: '../assets/a.png', alt: 'x' }]],
    ['![x](/assets/a.png)', [{ src: '/assets/a.png', alt: 'x' }]],
    // The sanitizer removes the src of any image whose address has a scheme.
    ['![x](https://example.com/a.png)', [{ src: null, alt: 'x' }]],
    ['![x]()', [{ src: null, alt: 'x' }]],
    [
      '[![x](assets/linked.png)](https://example.com)',
      [{ src: 'assets/linked.png', alt: 'x' }],
    ],
    // Not images at all: literal text, code, or raw HTML (escaped).
    ['![x](//cdn.example/a.png)', []],
    ['![x](data:image/png;base64,AAAA)', []],
    ['```\n<img src="assets/code.png">\n```', []],
    ['inline `![x](assets/in-code.png)`', []],
    ['<img src="assets/raw.png">', []],
  ];
  for (const [markdown, expected] of cases) {
    assert.deepEqual(
      findImageSources(normalizeAuthoredMarkdown(markdown).html),
      expected,
      markdown,
    );
  }
});

test('normalizeAssetRoots drops slashes, empties and duplicates', () => {
  assert.deepEqual(normalizeAssetRoots(undefined), []);
  assert.deepEqual(normalizeAssetRoots([]), []);
  assert.deepEqual(
    normalizeAssetRoots([
      { path: 'assets' },
      { path: 'assets/' },
      { path: '/media//' },
      { path: '/' },
      { path: 'assets/content' },
    ]),
    ['assets', 'media', 'assets/content'],
  );
});

test('referencePathProblem accepts plain repository paths', () => {
  for (const value of [
    'assets/photo.png',
    'assets/content/2026/photo.jpeg',
    'assets/with space.png',
    'assets/a&b.png',
    'assets/café.png',
    'assets/.hidden.png',
    'assets/a..b.png',
  ]) {
    assert.equal(referencePathProblem(value), null, value);
  }
});

test('referencePathProblem names what is wrong with a reference', () => {
  /** @type {[string, string][]} */
  const cases = [
    ['https://example.com/a.png', 'EXTERNAL_ADDRESS'],
    ['http://example.com/a.png', 'EXTERNAL_ADDRESS'],
    ['data:image/png;base64,AAAA', 'EXTERNAL_ADDRESS'],
    ['javascript:alert(1)', 'EXTERNAL_ADDRESS'],
    ['//cdn.example/a.png', 'EXTERNAL_ADDRESS'],
    ['/assets/a.png', 'NOT_A_REPOSITORY_PATH'],
    ['./assets/a.png', 'NOT_A_REPOSITORY_PATH'],
    ['../assets/a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/../assets/a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets//a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/', 'NOT_A_REPOSITORY_PATH'],
    ['assets/a.png?v=1', 'NOT_A_REPOSITORY_PATH'],
    ['assets/a.png#top', 'NOT_A_REPOSITORY_PATH'],
    ['assets/a%20b.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/%2e%2e/a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets\\a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/a\u0000.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/a\u0007.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/café.png', 'NOT_A_REPOSITORY_PATH'],
    [`assets/${'a'.repeat(510)}.png`, 'NOT_A_REPOSITORY_PATH'],
  ];
  for (const [value, reason] of cases) {
    const problem = referencePathProblem(value);
    assert.equal(problem?.reason, reason, JSON.stringify(value));
    assert.ok(problem.explanation.length > 0);
  }
});

test('the media limits equal the template media pipeline limits', async () => {
  const limits = /** @type {Record<string, number>} */ (
    await import(
      pathToFileURL(
        path.join(TEMPLATE_ROOT, 'src/core/internal/media/limits.js'),
      ).href
    )
  );
  assert.deepEqual(
    { ...MEDIA_LIMITS },
    {
      maxSourceBytes: limits.MAX_IMAGE_SOURCE_BYTES,
      maxDistinctImages: limits.MAX_IMAGES_PER_PUBLICATION,
      maxTotalBytes: limits.MAX_TOTAL_MEDIA_BYTES_PER_PUBLICATION,
    },
  );
  assert.deepEqual(
    { ...MEDIA_LIMITS },
    {
      maxSourceBytes: 10 * 1024 * 1024,
      maxDistinctImages: 2048,
      maxTotalBytes: 256 * 1024 * 1024,
    },
  );
});

test('resolveMediaReferences digests each distinct file once, in UTF-8 path order', async () => {
  await withRepository(async (directory) => {
    await mkdir(path.join(directory, 'assets/content/post'), {
      recursive: true,
    });
    const one = Buffer.from('first image bytes');
    const two = Buffer.from('second image bytes');
    const hero = Buffer.from('hero image bytes');
    await writeFile(path.join(directory, 'assets/b.png'), one);
    await writeFile(path.join(directory, 'assets/content/post/a.jpg'), two);
    await writeFile(path.join(directory, 'assets/hero.webp'), hero);
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [
        reference('content/one.md', 'assets/b.png'),
        reference('content/two.md', 'assets/content/post/a.jpg'),
        reference('content/two.md', 'assets/b.png'),
        reference('content/two.md', 'assets/hero.webp', 'hero'),
      ],
    });
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.assets, [
      { path: 'assets/b.png', sourceDigest: sha256(one) },
      { path: 'assets/content/post/a.jpg', sourceDigest: sha256(two) },
      { path: 'assets/hero.webp', sourceDigest: sha256(hero) },
    ]);
  });
});

test('resolveMediaReferences orders by UTF-8 bytes, not UTF-16 code units', async () => {
  await withRepository(async (directory) => {
    // U+FF5E is one UTF-16 unit above the surrogate range but sorts before
    // U+1F600 in UTF-8; code-unit order would put the emoji first.
    const bmp = 'assets/～.png';
    const astral = 'assets/\u{1f600}.png';
    await writeFile(path.join(directory, bmp), 'bmp');
    await writeFile(path.join(directory, astral), 'astral');
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [
        reference('content/a.md', astral),
        reference('content/a.md', bmp),
      ],
    });
    assert.deepEqual(
      result.assets.map((asset) => asset.path),
      [bmp, astral],
    );
  });
});

test('resolveMediaReferences with no references yields an empty inventory', async () => {
  await withRepository(async (directory) => {
    assert.deepEqual(
      await resolveMediaReferences({
        repositoryDirectory: directory,
        assetRoots: undefined,
        references: [],
      }),
      { assets: [], findings: [] },
    );
  });
});

test('every unusable reference is reported together, naming the document and the path', async () => {
  await withRepository(async (directory) => {
    await mkdir(path.join(directory, 'elsewhere'));
    await mkdir(path.join(directory, 'assets/folder'));
    await writeFile(path.join(directory, 'elsewhere/out.png'), 'out');
    await writeFile(path.join(directory, 'assets/real.png'), 'real');
    await symlink('real.png', path.join(directory, 'assets/link.png'));
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [
        reference('content/a.md', 'assets/missing.png'),
        reference('content/a.md', 'elsewhere/out.png'),
        reference('content/b.md', null),
        reference('content/b.md', '../out.png'),
        reference('content/b.md', 'https://example.com/hero.png', 'hero'),
        reference('content/c.md', 'assets/folder'),
        reference('content/c.md', 'assets/link.png'),
        reference('content/c.md', 'assets/real.png'),
      ],
    });
    assert.deepEqual(result.assets, []);
    // Reading order: the order the references were given in.
    assert.deepEqual(reasons(result), [
      'FILE_MISSING',
      'OUTSIDE_ASSET_ROOTS',
      'NO_SOURCE',
      'NOT_A_REPOSITORY_PATH',
      'EXTERNAL_ADDRESS',
      'NOT_A_REGULAR_FILE',
      'NOT_A_REGULAR_FILE',
    ]);
    for (const finding of result.findings) {
      assert.equal(finding.code, 'MEDIA_REFERENCE_UNRESOLVED');
      assert.equal(finding.severity, 'SOURCE_ERROR');
      assert.equal(finding.overridable, false);
      const evidence = /** @type {Record<string, string | null>} */ (
        finding.evidence
      );
      assert.equal(finding.location, evidence.document);
      assert.ok(finding.detail.startsWith(`${evidence.document}: `));
      if (evidence.path !== null) {
        assert.ok(finding.detail.includes(`"${evidence.path}"`));
      }
      assert.ok(finding.recovery && finding.recovery.length > 0);
    }
    const hero = result.findings.find(
      (finding) => /** @type {any} */ (finding.evidence).origin === 'hero',
    );
    assert.match(hero?.detail ?? '', /the hero image "https:\/\/example\.com/u);
  });
});

test('a file outside every declared root says which roots are declared', async () => {
  await withRepository(async (directory) => {
    await writeFile(path.join(directory, 'assets/in.png'), 'in');
    await writeFile(path.join(directory, 'stray.png'), 'out');
    const outside = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }, { path: 'media/' }],
      references: [reference('content/a.md', 'stray.png')],
    });
    assert.deepEqual(reasons(outside), ['OUTSIDE_ASSET_ROOTS']);
    assert.match(outside.findings[0]?.detail ?? '', /"assets\/", "media\/"/u);
    assert.match(outside.findings[0]?.recovery ?? '', /"assets\/", "media\/"/u);

    const noRoots = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [],
      references: [reference('content/a.md', 'assets/in.png')],
    });
    assert.deepEqual(reasons(noRoots), ['OUTSIDE_ASSET_ROOTS']);
    assert.match(noRoots.findings[0]?.detail ?? '', /none are declared/u);
    assert.match(noRoots.findings[0]?.recovery ?? '', /assetRoots/u);
  });
});

test('a file reached through a directory symbolic link that leaves its root is refused', async () => {
  await withRepository(async (directory) => {
    const outside = await mkdtemp(path.join(tmpdir(), 'gala-media-outside-'));
    try {
      await writeFile(path.join(outside, 'secret.png'), 'secret');
      await mkdir(path.join(directory, 'private'));
      await writeFile(path.join(directory, 'private/inside.png'), 'inside');
      // assets/escape -> a directory outside the repository
      await symlink(outside, path.join(directory, 'assets/escape'));
      // assets/sibling -> another directory inside the repository but outside the root
      await symlink(
        path.join(directory, 'private'),
        path.join(directory, 'assets/sibling'),
      );
      const result = await resolveMediaReferences({
        repositoryDirectory: directory,
        assetRoots: [{ path: 'assets' }],
        references: [
          reference('content/a.md', 'assets/escape/secret.png'),
          reference('content/a.md', 'assets/sibling/inside.png'),
        ],
      });
      assert.deepEqual(reasons(result), [
        'OUTSIDE_ASSET_ROOTS',
        'OUTSIDE_ASSET_ROOTS',
      ]);
      assert.match(result.findings[0]?.detail ?? '', /symbolic link/u);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('an asset root that is itself a link out of the repository admits nothing', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'gala-media-root-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'gala-media-outside-'));
  try {
    await writeFile(path.join(outside, 'secret.png'), 'secret');
    await symlink(outside, path.join(directory, 'assets'));
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [reference('content/a.md', 'assets/secret.png')],
    });
    assert.deepEqual(reasons(result), ['OUTSIDE_ASSET_ROOTS']);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('a declared root that does not exist leaves its files missing, not an exception', async () => {
  await withRepository(async (directory) => {
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }, { path: 'nowhere' }],
      references: [
        reference('content/a.md', 'nowhere/a.png'),
        reference('content/a.md', 'assets/file/under/a/file.png'),
      ],
    });
    assert.deepEqual(reasons(result), ['FILE_MISSING', 'FILE_MISSING']);
  });
});

test('a path whose parent is a regular file is missing, not an exception', async () => {
  await withRepository(async (directory) => {
    await writeFile(path.join(directory, 'assets/plain.txt'), 'text');
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [reference('content/a.md', 'assets/plain.txt/inner.png')],
    });
    assert.deepEqual(reasons(result), ['FILE_MISSING']);
  });
});

test('the file limits are judged only when every reference is usable', async () => {
  await withRepository(async (directory) => {
    await writeFile(path.join(directory, 'assets/a.png'), Buffer.alloc(10));
    await writeFile(path.join(directory, 'assets/b.png'), Buffer.alloc(30));
    await writeFile(path.join(directory, 'assets/c.png'), Buffer.alloc(5));
    const limits = {
      maxSourceBytes: 20,
      maxDistinctImages: 3,
      maxTotalBytes: 40,
    };
    const base = {
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      limits,
    };

    const oversize = await resolveMediaReferences({
      ...base,
      references: [
        reference('content/a.md', 'assets/a.png'),
        reference('content/b.md', 'assets/b.png'),
      ],
    });
    assert.deepEqual(oversize.assets, []);
    assert.deepEqual(reasons(oversize), ['IMAGE_BYTES']);
    assert.equal(oversize.findings[0]?.code, 'MEDIA_LIMIT_EXCEEDED');
    assert.equal(oversize.findings[0]?.location, 'content/b.md');
    assert.deepEqual(oversize.findings[0]?.evidence, {
      limit: 'IMAGE_BYTES',
      document: 'content/b.md',
      path: 'assets/b.png',
      bytes: 30,
      max: 20,
    });
    assert.match(
      oversize.findings[0]?.detail ?? '',
      /content\/b\.md.*assets\/b\.png.*30 bytes/u,
    );

    // Unusable references win over limits: the missing file is reported alone.
    const unusable = await resolveMediaReferences({
      ...base,
      references: [
        reference('content/b.md', 'assets/b.png'),
        reference('content/b.md', 'assets/gone.png'),
      ],
    });
    assert.deepEqual(reasons(unusable), ['FILE_MISSING']);
  });
});

test('the total size limit counts each distinct file once', async () => {
  await withRepository(async (directory) => {
    await writeFile(path.join(directory, 'assets/a.png'), Buffer.alloc(15));
    await writeFile(path.join(directory, 'assets/b.png'), Buffer.alloc(15));
    await writeFile(path.join(directory, 'assets/c.png'), Buffer.alloc(15));
    const base = {
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      limits: { maxSourceBytes: 20, maxDistinctImages: 3, maxTotalBytes: 40 },
    };
    const together = await resolveMediaReferences({
      ...base,
      references: [
        reference('content/a.md', 'assets/a.png'),
        reference('content/a.md', 'assets/b.png'),
        reference('content/a.md', 'assets/c.png'),
      ],
    });
    assert.deepEqual(reasons(together), ['TOTAL_BYTES']);
    assert.deepEqual(together.findings[0]?.evidence, {
      limit: 'TOTAL_BYTES',
      bytes: 45,
      max: 40,
    });
    assert.equal(together.findings[0]?.location, undefined);

    const repeated = await resolveMediaReferences({
      ...base,
      references: [
        reference('content/a.md', 'assets/a.png'),
        reference('content/b.md', 'assets/a.png'),
        reference('content/c.md', 'assets/a.png'),
        reference('content/c.md', 'assets/b.png'),
      ],
    });
    assert.deepEqual(repeated.findings, []);
    assert.equal(repeated.assets.length, 2);
  });
});

test('too many distinct images fail before any file is read', async () => {
  await withRepository(async (directory) => {
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      // None of these files exist; the count is judged first.
      references: ['a', 'b', 'c', 'd'].map((name) =>
        reference('content/a.md', `assets/${name}.png`),
      ),
      limits: { maxSourceBytes: 20, maxDistinctImages: 3, maxTotalBytes: 40 },
    });
    assert.deepEqual(reasons(result), ['IMAGE_COUNT']);
    assert.deepEqual(result.findings[0]?.evidence, {
      limit: 'IMAGE_COUNT',
      count: 4,
      max: 3,
    });
  });
});

test('the same file referenced many times counts as one image', async () => {
  await withRepository(async (directory) => {
    await writeFile(path.join(directory, 'assets/a.png'), 'a');
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: Array.from({ length: 10 }, (_, index) =>
        reference(`content/post-${index}.md`, 'assets/a.png'),
      ),
      limits: { maxSourceBytes: 20, maxDistinctImages: 1, maxTotalBytes: 40 },
    });
    assert.deepEqual(result.findings, []);
    assert.equal(result.assets.length, 1);
  });
});

test('a sparse 10 MiB + 1 byte file is over the default limit and is not read', async () => {
  await withRepository(async (directory) => {
    const file = path.join(directory, 'assets/huge.png');
    await writeFile(file, '');
    await truncate(file, MEDIA_LIMITS.maxSourceBytes + 1);
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [reference('content/a.md', 'assets/huge.png')],
    });
    assert.deepEqual(reasons(result), ['IMAGE_BYTES']);

    await truncate(file, MEDIA_LIMITS.maxSourceBytes);
    const atLimit = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [reference('content/a.md', 'assets/huge.png')],
    });
    assert.deepEqual(atLimit.findings, []);
    assert.equal(atLimit.assets[0]?.path, 'assets/huge.png');
  });
});

test('a long list of problems is capped and says how many were left out', async () => {
  await withRepository(async (directory) => {
    const count = MAX_MEDIA_FINDINGS + 7;
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: Array.from({ length: count }, (_, index) =>
        reference('content/a.md', `assets/missing-${index}.png`),
      ),
    });
    assert.equal(result.findings.length, MAX_MEDIA_FINDINGS + 1);
    const last = result.findings.at(-1);
    assert.equal(last?.code, 'MEDIA_REFERENCE_UNRESOLVED');
    assert.deepEqual(last?.evidence, { omitted: 7 });
    assert.match(last?.detail ?? '', /7 more/u);
  });
});
