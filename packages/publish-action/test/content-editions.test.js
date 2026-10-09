/**
 * Unit coverage for `normalize/content-editions.js`: the digest rule an
 * edition's `sourceDigest` follows, and which editions of a build are kept.
 * Whole-repository behavior (front matter on disk, the warnings reaching the
 * result envelope) is covered in `test/repository-intake.test.js`.
 *
 * @module
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  editionSourceDigest,
  evaluateEditions,
} from '../src/normalize/content-editions.js';

// Reference vectors, computed independently with `shasum -a 256`.
const EMPTY =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const HELLO_NEWLINE =
  '66a045b452102c59d840ec097d59d9467e13a3f34f6494e539ffd32c1bb35f18';
const HELLO =
  '185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969';
const NEWLINE_HELLO_NEWLINE =
  '9773a9208fd8c737242e27bcdcaa80873e47295c14ebc8f9959dd75a7d5f66b2';
const UNICODE_BODY =
  '0037d6444dd8c5db2c2fc321b51c5d99b4f5a3e649757c2c654ba51bf363c63c';

test('the digest is SHA-256 over the body text, byte for byte', () => {
  assert.equal(editionSourceDigest(''), EMPTY);
  assert.equal(editionSourceDigest('Hello\n'), HELLO_NEWLINE);
  assert.equal(editionSourceDigest('Hello\n'), HELLO_NEWLINE);
  assert.equal(editionSourceDigest('café — \u{1f600}\n'), UNICODE_BODY);
});

test('leading and trailing newlines are part of the digest', () => {
  assert.equal(editionSourceDigest('Hello'), HELLO);
  assert.notEqual(editionSourceDigest('Hello'), editionSourceDigest('Hello\n'));
  assert.equal(editionSourceDigest('\nHello\n'), NEWLINE_HELLO_NEWLINE);
  assert.notEqual(
    editionSourceDigest('Hello\n'),
    editionSourceDigest('Hello\n\n'),
  );
});

test('a CRLF line ending is read as LF, as the content document contract does', () => {
  assert.equal(editionSourceDigest('Hello\r\n'), HELLO_NEWLINE);
  assert.equal(
    editionSourceDigest('one\r\ntwo\r\n'),
    editionSourceDigest('one\ntwo\n'),
  );
  // A lone carriage return is not a line ending the contract rewrites.
  assert.notEqual(
    editionSourceDigest('one\rtwo'),
    editionSourceDigest('one\ntwo'),
  );
});

/**
 * @param {string} relativePath file path
 * @param {Record<string, unknown>} frontmatter front matter fields
 * @param {string} rawBody the body text
 * @returns {import('../src/normalize/content-editions.js').EditionCandidate} a candidate
 */
function candidate(relativePath, frontmatter, rawBody) {
  return { relativePath, frontmatter, rawBody };
}

/**
 * @param {string} slug the article slug
 * @param {string} body the article body
 * @param {string} [language] the article language
 * @returns {import('../src/normalize/content-editions.js').EditionCandidate} an article
 */
function article(slug, body, language = 'en-US') {
  return candidate(
    `content/${slug}.md`,
    { kind: 'article', slug, language },
    body,
  );
}

/**
 * @param {string} of the article slug it is of
 * @param {string} sourceDigest the digest it records
 * @param {string} [language] the edition language
 * @returns {import('../src/normalize/content-editions.js').EditionCandidate} an edition
 */
function edition(of, sourceDigest, language = 'en-US') {
  return candidate(
    `content/${of}.edition.quick-read.md`,
    {
      kind: 'edition',
      slug: `${of}-quick-read`,
      language,
      edition: { of, kind: 'QUICK_READ', sourceDigest },
    },
    'A shorter reading.\n',
  );
}

test('an edition whose digest matches its article is kept without a warning', () => {
  const post = article('post', 'Hello\n');
  const quick = edition('post', HELLO_NEWLINE);
  assert.deepEqual(evaluateEditions([quick, post]), {
    dropped: new Set(),
    warnings: [],
  });
});

test('a digest may carry a sha256: prefix and upper-case digits', () => {
  const post = article('post', 'Hello\n');
  for (const written of [
    `sha256:${HELLO_NEWLINE}`,
    HELLO_NEWLINE.toUpperCase(),
    `sha256:${HELLO_NEWLINE.toUpperCase()}`,
  ]) {
    assert.deepEqual(
      evaluateEditions([post, edition('post', written)]).warnings,
      [],
      written,
    );
  }
});

test('an edition of a changed article is dropped with EDITION_STALE', () => {
  const post = article('post', 'Hello, world\n');
  const quick = edition('post', HELLO_NEWLINE);
  const { dropped, warnings } = evaluateEditions([quick, post]);
  assert.deepEqual([...dropped], [quick.relativePath]);
  assert.equal(warnings.length, 1);
  const [warning] = warnings;
  assert.equal(warning?.code, 'EDITION_STALE');
  assert.equal(warning?.severity, 'WARNING');
  assert.equal(warning?.location, quick.relativePath);
  assert.deepEqual(warning?.evidence, {
    document: quick.relativePath,
    of: 'post',
    editionKind: 'QUICK_READ',
  });
  assert.match(
    warning?.detail ?? '',
    /content\/post\.edition\.quick-read\.md/u,
  );
  assert.match(warning?.detail ?? '', /content\/post\.md/u);
  assert.match(warning?.recovery ?? '', /Generate the edition again/u);
});

test('a whitespace-only change to the article makes its edition stale', () => {
  const quick = edition('post', HELLO_NEWLINE);
  for (const body of ['Hello', 'Hello\n\n', '\nHello\n', 'Hello \n']) {
    assert.equal(
      evaluateEditions([quick, article('post', body)]).warnings[0]?.code,
      'EDITION_STALE',
      JSON.stringify(body),
    );
  }
});

test('an edition with no article in the build is dropped with EDITION_SOURCE_MISSING', () => {
  const quick = edition('gone', HELLO_NEWLINE);
  const page = candidate(
    'content/gone-page.md',
    { kind: 'page', slug: 'gone', language: 'en-US' },
    'Hello\n',
  );
  for (const documents of [
    [quick],
    [quick, article('other', 'Hello\n')],
    [quick, page],
  ]) {
    const { dropped, warnings } = evaluateEditions(documents);
    assert.deepEqual([...dropped], [quick.relativePath]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, 'EDITION_SOURCE_MISSING');
    assert.equal(warnings[0]?.severity, 'WARNING');
    assert.match(warnings[0]?.detail ?? '', /"gone"/u);
    assert.match(warnings[0]?.recovery ?? '', /delete the edition/u);
  }
});

test('an edition is never its own source, and editions are not articles', () => {
  const lonely = edition('post-quick-read', HELLO_NEWLINE);
  const other = edition('post', HELLO_NEWLINE);
  const { warnings } = evaluateEditions([lonely, other]);
  assert.deepEqual(
    warnings.map((warning) => warning.code),
    ['EDITION_SOURCE_MISSING', 'EDITION_SOURCE_MISSING'],
  );
});

test('two articles with one slug are told apart by language, or the edition is dropped', () => {
  const english = article('post', 'Hello\n', 'en-US');
  const french = article('post', 'Bonjour\n', 'fr-FR');
  assert.deepEqual(
    evaluateEditions([edition('post', HELLO_NEWLINE, 'en-US'), english, french])
      .warnings,
    [],
  );
  assert.equal(
    evaluateEditions([edition('post', HELLO_NEWLINE, 'de-DE'), english, french])
      .warnings[0]?.code,
    'EDITION_SOURCE_MISSING',
  );
  assert.equal(
    evaluateEditions([
      edition('post', HELLO_NEWLINE, 'en-US'),
      english,
      article('post', 'Hi\n', 'en-US'),
    ]).warnings[0]?.code,
    'EDITION_SOURCE_MISSING',
  );
});

test('each edition is judged on its own and the result lists them in order', () => {
  const post = article('post', 'Hello\n');
  const keep = edition('post', HELLO_NEWLINE);
  const stale = candidate(
    'content/post.edition.deep-dive.md',
    {
      kind: 'edition',
      slug: 'post-deep-dive',
      language: 'en-US',
      edition: { of: 'post', kind: 'DEEP_DIVE', sourceDigest: HELLO },
    },
    'A longer reading.\n',
  );
  const missing = edition('absent', HELLO_NEWLINE);
  const { dropped, warnings } = evaluateEditions([stale, keep, missing, post]);
  assert.deepEqual(
    [...dropped],
    [
      'content/post.edition.deep-dive.md',
      'content/absent.edition.quick-read.md',
    ],
  );
  assert.deepEqual(
    warnings.map((warning) => warning.code),
    ['EDITION_STALE', 'EDITION_SOURCE_MISSING'],
  );
});

test('a build with no editions has nothing to report', () => {
  assert.deepEqual(
    evaluateEditions([article('a', 'x\n'), article('b', 'y\n')]),
    {
      dropped: new Set(),
      warnings: [],
    },
  );
  assert.deepEqual(evaluateEditions([]), { dropped: new Set(), warnings: [] });
});
