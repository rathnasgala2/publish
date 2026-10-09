/**
 * Unit coverage for `normalize/content-media.js`: reading image references
 * out of sanitized HTML, the rule that turns an `<img src>` into a repository
 * path, asset-root and symbolic link containment, format recognition, the
 * media limits and the digest inventory. The same module is exercised through
 * whole-repository intake in `test/repository-intake.test.js`.
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
  heroPathProblem,
  normalizeAssetRoots,
  resolveImageSource,
  resolveMediaReferences,
  sniffImageMediaType,
} from '../src/normalize/content-media.js';
import {
  TEMPLATE_ROOT,
  importTemplatePublicEntry,
} from '../src/template-bridge.js';
import { MEDIA_TYPE_OF, imageBytes } from './image-bytes.js';

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
 * @param {string | null} source the reference as written
 * @param {'body' | 'hero'} [origin] where the reference comes from
 * @returns {import('../src/normalize/content-media.js').MediaReference} the reference
 */
function reference(document, source, origin = 'body') {
  return { document, origin, source, alt: 'a picture' };
}

/**
 * @param {{findings: import('../src/types.js').PublishActionFinding[]}} result a resolution result
 * @returns {string[]} the stable reason (or limit) code of each finding
 */
function reasons(result) {
  return result.findings.map((finding) => {
    const evidence = /** @type {Record<string, unknown>} */ (finding.evidence);
    return String(evidence.reason ?? evidence.limit);
  });
}

/**
 * @param {string} file repository-relative path
 * @param {Buffer} bytes the file content
 * @param {string} mediaType the expected media type
 * @returns {object} the `media[]` entry intake should produce
 */
function entry(file, bytes, mediaType) {
  return {
    path: file,
    sourceDigest: sha256(bytes),
    mediaType,
    byteLength: bytes.byteLength,
  };
}

const SMALL_LIMITS = {
  maxSourceBytes: 50,
  maxDistinctImages: 3,
  maxTotalBytes: 100,
  maxImagesPerDocument: 2,
};

test('findImageSources lists images in document order with decoded attributes', () => {
  assert.deepEqual(
    findImageSources(
      '<p><img src="assets/a&amp;b.png" alt="The &quot;one&quot; &lt;b&gt; it&#39;s" /></p>' +
        '<p><a href="https://example.com"><img src="assets/c.png" alt="" /></a></p>' +
        '<IMG alt="shouting" SRC="assets/d.png">',
    ).map(({ src, alt }) => [src, alt]),
    [
      ['assets/a&b.png', 'The "one" <b> it\'s'],
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
    // markdown-it escapes a space; the renderer's rule decodes it again.
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

test('resolveImageSource applies the renderer rule to an <img src>', () => {
  /** @type {[string, string][]} */
  const resolved = [
    ['assets/photo.png', 'assets/photo.png'],
    ['assets/content/2026/photo.jpeg', 'assets/content/2026/photo.jpeg'],
    // One leading "/" or "./" is dropped: paths are relative to the repository root.
    ['./assets/photo.png', 'assets/photo.png'],
    ['/assets/photo.png', 'assets/photo.png'],
    // Percent escapes are decoded, then NFC-normalized.
    ['assets/my%20pic.png', 'assets/my pic.png'],
    ['assets/caf%C3%A9.png', 'assets/café.png'],
    ['assets/cafe%CC%81.png', 'assets/café.png'],
    ['assets/100%25.png', 'assets/100%.png'],
    // Already decoded text passes through unchanged.
    ['assets/with space.png', 'assets/with space.png'],
    ['assets/a&b.png', 'assets/a&b.png'],
    ['assets/.hidden.png', 'assets/.hidden.png'],
    ['assets/a..b.png', 'assets/a..b.png'],
  ];
  for (const [source, expected] of resolved) {
    assert.deepEqual(resolveImageSource(source), { path: expected }, source);
  }
});

test('resolveImageSource names why a src names no repository file', () => {
  /** @type {[string, string][]} */
  const refused = [
    ['https://example.com/a.png', 'EXTERNAL_ADDRESS'],
    ['HTTP://EXAMPLE.COM/A.PNG', 'EXTERNAL_ADDRESS'],
    ['data:image/png;base64,AAAA', 'EXTERNAL_ADDRESS'],
    ['javascript:alert(1)', 'EXTERNAL_ADDRESS'],
    ['//cdn.example/a.png', 'EXTERNAL_ADDRESS'],
    ['assets/a.png?v=1', 'NOT_A_REPOSITORY_PATH'],
    ['assets/a.png#top', 'NOT_A_REPOSITORY_PATH'],
    ['assets\\a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/a%5Cb.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/a%00.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/%E0%A4%A', 'NOT_A_REPOSITORY_PATH'],
    ['../assets/a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/../assets/a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/%2e%2e/a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/./a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets//a.png', 'NOT_A_REPOSITORY_PATH'],
    ['assets/', 'NOT_A_REPOSITORY_PATH'],
    ['.//assets/a.png', 'NOT_A_REPOSITORY_PATH'],
    ['//', 'EXTERNAL_ADDRESS'],
    ['.', 'NOT_A_REPOSITORY_PATH'],
    ['/', 'NOT_A_REPOSITORY_PATH'],
    [`assets/${'a'.repeat(510)}.png`, 'NOT_A_REPOSITORY_PATH'],
  ];
  for (const [source, reason] of refused) {
    const result = /** @type {{reason: string, explanation: string}} */ (
      resolveImageSource(source)
    );
    assert.equal(result.reason, reason, JSON.stringify(source));
    assert.ok(result.explanation.length > 0, source);
  }
});

test('heroPathProblem accepts plain repository paths and names what is wrong otherwise', () => {
  for (const value of [
    'assets/hero.jpg',
    'assets/content/2026/hero.webp',
    'assets/with space.png',
    'assets/café.png',
    'assets/.hidden.png',
    'assets/a..b.png',
  ]) {
    assert.equal(heroPathProblem(value), null, value);
  }
  /** @type {[string, string][]} */
  const refused = [
    ['https://example.com/hero.jpg', 'EXTERNAL_ADDRESS'],
    ['data:image/png;base64,AAAA', 'EXTERNAL_ADDRESS'],
    ['//cdn.example/hero.jpg', 'EXTERNAL_ADDRESS'],
    ['/assets/hero.jpg', 'NOT_A_REPOSITORY_PATH'],
    ['./assets/hero.jpg', 'NOT_A_REPOSITORY_PATH'],
    ['../assets/hero.jpg', 'NOT_A_REPOSITORY_PATH'],
    ['assets//hero.jpg', 'NOT_A_REPOSITORY_PATH'],
    ['assets/', 'NOT_A_REPOSITORY_PATH'],
    ['assets/hero.jpg?v=1', 'NOT_A_REPOSITORY_PATH'],
    ['assets/hero.jpg#top', 'NOT_A_REPOSITORY_PATH'],
    ['assets/hero%20x.jpg', 'NOT_A_REPOSITORY_PATH'],
    ['assets\\hero.jpg', 'NOT_A_REPOSITORY_PATH'],
    ['assets/hero\u0007.jpg', 'NOT_A_REPOSITORY_PATH'],
    ['assets/café.jpg', 'NOT_A_REPOSITORY_PATH'],
    [`assets/${'a'.repeat(510)}.jpg`, 'NOT_A_REPOSITORY_PATH'],
  ];
  for (const [value, reason] of refused) {
    const problem = heroPathProblem(value);
    assert.equal(problem?.reason, reason, JSON.stringify(value));
    assert.ok((problem?.explanation ?? '').length > 0);
  }
});

test('sniffImageMediaType recognizes the five formats from their first bytes only', () => {
  for (const format of /** @type {const} */ ([
    'png',
    'jpeg',
    'webp',
    'avif',
    'gif',
  ])) {
    assert.equal(
      sniffImageMediaType(imageBytes(format)),
      MEDIA_TYPE_OF[format],
      format,
    );
  }
  assert.equal(
    sniffImageMediaType(Buffer.from('GIF87a....', 'latin1')),
    'image/gif',
  );
});

test('sniffImageMediaType refuses SVG, other bytes, and anything too short to be an image', () => {
  for (const svg of [
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '  \n<svg></svg>',
    '<?xml version="1.0"?><svg></svg>',
    '<!-- comment --><svg></svg>',
    '﻿<svg></svg>',
    '<html><body><svg viewBox="0 0 1 1"></svg></body></html>',
  ]) {
    assert.equal(sniffImageMediaType(Buffer.from(svg)), 'svg', svg);
  }
  for (const other of [
    Buffer.alloc(0),
    Buffer.from('just some text'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.from([0xff, 0xd8]),
    Buffer.from('RIFF....WAVE', 'latin1'),
    Buffer.from('....ftypheic', 'latin1'),
    Buffer.from('GIF90a', 'latin1'),
    Buffer.from('BM......', 'latin1'),
  ]) {
    assert.equal(sniffImageMediaType(other), null, other.toString('hex'));
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
    {
      maxSourceBytes: MEDIA_LIMITS.maxSourceBytes,
      maxDistinctImages: MEDIA_LIMITS.maxDistinctImages,
      maxTotalBytes: MEDIA_LIMITS.maxTotalBytes,
    },
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
      // The maximum length of build-input's content[].media[].
      maxImagesPerDocument: 200,
    },
  );
});

test('each document lists its own body images; a file is digested once', async () => {
  await withRepository(async (directory) => {
    await mkdir(path.join(directory, 'assets/content/post'), {
      recursive: true,
    });
    const shared = imageBytes('png', 'shared');
    const jpeg = imageBytes('jpeg', 'jpeg');
    const hero = imageBytes('webp', 'hero');
    await writeFile(path.join(directory, 'assets/b.png'), shared);
    await writeFile(path.join(directory, 'assets/content/post/a.jpg'), jpeg);
    await writeFile(path.join(directory, 'assets/hero.webp'), hero);
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [
        reference('content/one.md', 'assets/b.png'),
        reference('content/one.md', './assets/b.png'),
        reference('content/two.md', '/assets/content/post/a.jpg'),
        reference('content/two.md', 'assets/b.png'),
        reference('content/two.md', 'assets/hero.webp', 'hero'),
      ],
    });
    assert.deepEqual(result.findings, []);
    assert.deepEqual(
      [...result.files.keys()],
      ['assets/b.png', 'assets/content/post/a.jpg', 'assets/hero.webp'],
    );
    assert.deepEqual(result.documents.get('content/one.md'), [
      entry('assets/b.png', shared, 'image/png'),
    ]);
    assert.deepEqual(result.documents.get('content/two.md'), [
      entry('assets/b.png', shared, 'image/png'),
      entry('assets/content/post/a.jpg', jpeg, 'image/jpeg'),
    ]);
    // The hero is checked and digested, but is not in any document's media[].
    assert.deepEqual(
      result.files.get('assets/hero.webp'),
      entry('assets/hero.webp', hero, 'image/webp'),
    );
    assert.equal(result.documents.size, 2);
  });
});

test('a reference is looked up by the path the renderer resolves it to', async () => {
  await withRepository(async (directory) => {
    const bytes = imageBytes('gif', 'spaced');
    await writeFile(path.join(directory, 'assets/my pic.gif'), bytes);
    await writeFile(path.join(directory, 'assets/café.gif'), bytes);
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [
        reference('content/a.md', 'assets/my%20pic.gif'),
        reference('content/a.md', 'assets/caf%C3%A9.gif'),
      ],
    });
    assert.deepEqual(result.findings, []);
    assert.deepEqual(
      result.documents.get('content/a.md')?.map((file) => file.path),
      ['assets/café.gif', 'assets/my pic.gif'],
    );
  });
});

test('files and entries are ordered by UTF-8 bytes, not UTF-16 code units', async () => {
  await withRepository(async (directory) => {
    // U+FF5E is one UTF-16 unit above the surrogate range but sorts before
    // U+1F600 in UTF-8; code-unit order would put the emoji first.
    const bmp = 'assets/～.png';
    const astral = 'assets/\u{1f600}.png';
    await writeFile(path.join(directory, bmp), imageBytes('png', 'bmp'));
    await writeFile(path.join(directory, astral), imageBytes('png', 'astral'));
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [
        reference('content/a.md', astral),
        reference('content/a.md', bmp),
      ],
    });
    assert.deepEqual([...result.files.keys()], [bmp, astral]);
    assert.deepEqual(
      result.documents.get('content/a.md')?.map((file) => file.path),
      [bmp, astral],
    );
  });
});

test('the format comes from the bytes, never from the file name', async () => {
  await withRepository(async (directory) => {
    await writeFile(
      path.join(directory, 'assets/liar.png'),
      imageBytes('jpeg'),
    );
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [reference('content/a.md', 'assets/liar.png')],
    });
    assert.equal(result.files.get('assets/liar.png')?.mediaType, 'image/jpeg');
  });
});

test('with no references the inventory is empty', async () => {
  await withRepository(async (directory) => {
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: undefined,
      references: [],
    });
    assert.equal(result.files.size, 0);
    assert.equal(result.documents.size, 0);
    assert.deepEqual(result.findings, []);
  });
});

test('every unusable reference is reported together, naming the document and the path', async () => {
  await withRepository(async (directory) => {
    await mkdir(path.join(directory, 'elsewhere'));
    await mkdir(path.join(directory, 'assets/folder'));
    await writeFile(
      path.join(directory, 'elsewhere/out.png'),
      imageBytes('png'),
    );
    await writeFile(path.join(directory, 'assets/real.png'), imageBytes('png'));
    await writeFile(path.join(directory, 'assets/vector.svg'), '<svg></svg>');
    await writeFile(path.join(directory, 'assets/notes.png'), 'plain text');
    await writeFile(path.join(directory, 'assets/empty.png'), '');
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
        reference('content/c.md', 'assets/vector.svg'),
        reference('content/c.md', 'assets/notes.png'),
        reference('content/c.md', 'assets/empty.png'),
        reference('content/c.md', 'assets/real.png'),
      ],
    });
    assert.equal(result.files.size, 0);
    assert.equal(result.documents.size, 0);
    // Reading order: the order the references were given in.
    assert.deepEqual(reasons(result), [
      'FILE_MISSING',
      'OUTSIDE_ASSET_ROOTS',
      'NO_SOURCE',
      'NOT_A_REPOSITORY_PATH',
      'EXTERNAL_ADDRESS',
      'NOT_A_REGULAR_FILE',
      'NOT_A_REGULAR_FILE',
      'UNSUPPORTED_FORMAT',
      'UNSUPPORTED_FORMAT',
      'UNSUPPORTED_FORMAT',
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
    const byPath = (/** @type {string} */ wanted) =>
      result.findings.find(
        (finding) => /** @type {any} */ (finding.evidence).path === wanted,
      );
    const hero = result.findings.find(
      (finding) => /** @type {any} */ (finding.evidence).origin === 'hero',
    );
    assert.match(hero?.detail ?? '', /the hero image "https:\/\/example\.com/u);
    const svg = byPath('assets/vector.svg');
    assert.match(svg?.detail ?? '', /is an SVG file; SVG is not allowed/u);
    assert.match(svg?.recovery ?? '', /PNG, JPEG, WebP, AVIF or GIF/u);
    assert.match(byPath('assets/empty.png')?.detail ?? '', /is empty/u);
    assert.match(
      byPath('assets/notes.png')?.detail ?? '',
      /is not a PNG, JPEG, WebP, AVIF or GIF image/u,
    );
  });
});

test('a finding for a rewritten reference names both the written and the resolved path', async () => {
  await withRepository(async (directory) => {
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [reference('content/a.md', './assets/my%20pic.png')],
    });
    assert.deepEqual(reasons(result), ['FILE_MISSING']);
    assert.match(
      result.findings[0]?.detail ?? '',
      /^content\/a\.md: the image "\.\/assets\/my%20pic\.png" \(the file "assets\/my pic\.png"\) does not exist/u,
    );
  });
});

test('a file outside every declared root says which roots are declared', async () => {
  await withRepository(async (directory) => {
    await writeFile(path.join(directory, 'assets/in.png'), imageBytes('png'));
    await writeFile(path.join(directory, 'stray.png'), imageBytes('png'));
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
      await writeFile(path.join(outside, 'secret.png'), imageBytes('png'));
      await mkdir(path.join(directory, 'private'));
      await writeFile(
        path.join(directory, 'private/inside.png'),
        imageBytes('png'),
      );
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
    await writeFile(path.join(outside, 'secret.png'), imageBytes('png'));
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

test('a symbolic link loop and an over-long name are reported, not thrown', async () => {
  await withRepository(async (directory) => {
    await symlink('loop', path.join(directory, 'assets/loop'));
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [
        reference('content/a.md', 'assets/loop/image.png'),
        reference('content/a.md', `assets/${'n'.repeat(300)}.png`),
      ],
    });
    assert.deepEqual(reasons(result), ['NOT_A_REGULAR_FILE', 'FILE_MISSING']);
    assert.match(result.findings[0]?.detail ?? '', /symbolic link loop/u);
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

test('the size limits are judged only when every reference is usable', async () => {
  await withRepository(async (directory) => {
    await writeFile(
      path.join(directory, 'assets/a.png'),
      imageBytes('png', 'x'),
    );
    await writeFile(
      path.join(directory, 'assets/b.png'),
      Buffer.concat([imageBytes('png'), Buffer.alloc(60)]),
    );
    const base = {
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      limits: SMALL_LIMITS,
    };

    const oversize = await resolveMediaReferences({
      ...base,
      references: [
        reference('content/a.md', 'assets/a.png'),
        reference('content/b.md', 'assets/b.png'),
      ],
    });
    assert.equal(oversize.files.size, 0);
    assert.deepEqual(reasons(oversize), ['IMAGE_BYTES']);
    assert.equal(oversize.findings[0]?.code, 'MEDIA_LIMIT_EXCEEDED');
    assert.equal(oversize.findings[0]?.location, 'content/b.md');
    const size = imageBytes('png').byteLength + 60;
    assert.deepEqual(oversize.findings[0]?.evidence, {
      limit: 'IMAGE_BYTES',
      document: 'content/b.md',
      path: 'assets/b.png',
      bytes: size,
      max: 50,
    });
    assert.match(
      oversize.findings[0]?.detail ?? '',
      new RegExp(`content/b\\.md.*assets/b\\.png.*${size} bytes`, 'u'),
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
    for (const name of ['a', 'b', 'c']) {
      await writeFile(
        path.join(directory, `assets/${name}.png`),
        Buffer.concat([imageBytes('png', name), Buffer.alloc(32)]),
      );
    }
    const each = imageBytes('png', 'a').byteLength + 32;
    const base = {
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      limits: { ...SMALL_LIMITS, maxTotalBytes: each * 2 + 1 },
    };
    const together = await resolveMediaReferences({
      ...base,
      references: [
        reference('content/a.md', 'assets/a.png'),
        reference('content/a.md', 'assets/b.png'),
        reference('content/a.md', 'assets/c.png'),
      ],
      limits: { ...base.limits, maxImagesPerDocument: 3 },
    });
    assert.deepEqual(reasons(together), ['TOTAL_BYTES']);
    assert.deepEqual(together.findings[0]?.evidence, {
      limit: 'TOTAL_BYTES',
      bytes: each * 3,
      max: each * 2 + 1,
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
    assert.equal(repeated.files.size, 2);
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
      limits: { ...SMALL_LIMITS, maxImagesPerDocument: 10 },
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
    await writeFile(path.join(directory, 'assets/a.png'), imageBytes('png'));
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: Array.from({ length: 10 }, (_, index) =>
        reference(`content/post-${index}.md`, 'assets/a.png'),
      ),
      limits: { ...SMALL_LIMITS, maxDistinctImages: 1 },
    });
    assert.deepEqual(result.findings, []);
    assert.equal(result.files.size, 1);
    assert.equal(result.documents.size, 10);
  });
});

test('one document may list at most 200 distinct body images', async () => {
  await withRepository(async (directory) => {
    for (const name of ['a', 'b', 'c']) {
      await writeFile(
        path.join(directory, `assets/${name}.png`),
        imageBytes('png', name),
      );
    }
    const result = await resolveMediaReferences({
      repositoryDirectory: directory,
      assetRoots: [{ path: 'assets' }],
      references: [
        reference('content/big.md', 'assets/a.png'),
        reference('content/big.md', 'assets/b.png'),
        reference('content/big.md', 'assets/c.png'),
        reference('content/big.md', 'assets/c.png'),
        reference('content/ok.md', 'assets/a.png'),
        // A hero is not in media[], so it does not count against the document.
        reference('content/ok.md', 'assets/b.png', 'hero'),
        reference('content/ok.md', 'assets/c.png', 'hero'),
      ],
      limits: { ...SMALL_LIMITS, maxDistinctImages: 5 },
    });
    assert.deepEqual(reasons(result), ['DOCUMENT_IMAGES']);
    assert.deepEqual(result.findings[0]?.evidence, {
      limit: 'DOCUMENT_IMAGES',
      document: 'content/big.md',
      count: 3,
      max: 2,
    });
    assert.equal(result.findings[0]?.location, 'content/big.md');
  });
});

test('a sparse 10 MiB + 1 byte file is over the default limit and is not read', async () => {
  await withRepository(async (directory) => {
    const file = path.join(directory, 'assets/huge.png');
    await writeFile(file, imageBytes('png'));
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
    assert.equal(
      atLimit.files.get('assets/huge.png')?.byteLength,
      MEDIA_LIMITS.maxSourceBytes,
    );
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
