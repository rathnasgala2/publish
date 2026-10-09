/**
 * Prism editions: which `kind: edition` documents may enter a build.
 *
 * An edition is a repository document (`content/<slug>.edition.<kind>.md`,
 * `kind: edition`) that holds a shorter or longer rendering of one article. It
 * names its article with `edition.of` (the article's `slug`) and records, in
 * `edition.sourceDigest`, which text of that article it was made from. Intake
 * keeps an edition only when both still hold; otherwise it leaves the edition
 * out of the build input, says so with a warning, and the build carries on.
 * The original article is always rendered, so a dropped edition never costs a
 * reader anything but the alternative reading.
 *
 * | Situation | Finding | Edition |
 * | --- | --- | --- |
 * | no article in this build has the slug `edition.of` | `EDITION_SOURCE_MISSING` | dropped |
 * | the article's body no longer digests to `edition.sourceDigest` | `EDITION_STALE` | dropped |
 * | both hold | none | passed through with its front matter |
 *
 * "In this build" matters: an article that is a draft (outside candidate
 * mode) or archived is not part of the build, so an edition of it is dropped
 * too rather than publishing text whose original is not published.
 *
 * **The digest rule** (shared with the API, which writes `sourceDigest` when
 * it accepts a generated edition): `edition.sourceDigest` is the lowercase
 * hexadecimal SHA-256 of the UTF-8 bytes of the article's *Markdown body*,
 * that is, the text of the article's file after the closing `---` line of its
 * front matter, with each `\r\n` read as `\n` and nothing else changed. The
 * digest therefore changes with any edit to the body, including a leading or
 * trailing newline (the editor writes exactly one trailing newline), and does
 * not change with an edit to the article's front matter. It is not the digest
 * of the rendered HTML and it is not `bodyDigest`. The `\r\n` rule is the
 * content document contract's own: the API reads a document with
 * `\r\n` replaced by `\n` before it splits the front matter from the body.
 * `sourceDigest` may be written with or without a `sha256:` prefix; both
 * spellings name the same digest.
 *
 * @module
 */

import { createHash } from 'node:crypto';

/**
 * @typedef {import('../types.js').PublishActionFinding} Finding
 */

/**
 * @typedef {object} EditionCandidate
 * @property {string} relativePath repository-relative path of the document
 * @property {Record<string, any>} frontmatter the validated front matter
 * @property {string} rawBody the text after the closing front matter fence line, unmodified
 */

/**
 * The digest an edition records for its article, per the rule above.
 *
 * @param {string} rawBody the article's text after the closing front matter
 *   fence line, exactly as it is in the file
 * @returns {string} 64 lowercase hexadecimal characters
 */
export function editionSourceDigest(rawBody) {
  return createHash('sha256')
    .update(rawBody.replace(/\r\n/gu, '\n'), 'utf8')
    .digest('hex');
}

/**
 * @param {string} value a `sourceDigest` as written in front matter
 * @returns {string} the digest as 64 lowercase hexadecimal characters
 */
function digestHex(value) {
  return value.replace(/^sha256:/u, '').toLowerCase();
}

/**
 * Build one edition warning in the shared finding shape.
 *
 * @param {string} code `EDITION_SOURCE_MISSING` or `EDITION_STALE`
 * @param {EditionCandidate} edition the edition document
 * @param {string} detail what happened, naming the document
 * @param {string} recovery what the author can do
 * @returns {Finding} the finding
 */
function editionWarning(code, edition, detail, recovery) {
  const { of, kind } = edition.frontmatter.edition;
  return {
    code,
    severity: 'WARNING',
    detail,
    location: edition.relativePath,
    evidence: { document: edition.relativePath, of, editionKind: kind },
    recovery,
    overridable: false,
  };
}

/**
 * Find the article an edition belongs to among the documents of this build.
 * When more than one article has the slug (the same post in two languages),
 * the one in the edition's own language is chosen; if that does not settle it
 * either, there is no unambiguous source.
 *
 * @param {readonly EditionCandidate[]} articles the articles in this build
 * @param {string} slug `edition.of`
 * @param {string} language the edition's language
 * @returns {EditionCandidate | null} the source article, or `null`
 */
function findSourceArticle(articles, slug, language) {
  const bySlug = articles.filter(
    (article) => article.frontmatter.slug === slug,
  );
  if (bySlug.length <= 1) {
    return bySlug[0] ?? null;
  }
  const byLanguage = bySlug.filter(
    (article) => article.frontmatter.language === language,
  );
  return byLanguage.length === 1 ? (byLanguage[0] ?? null) : null;
}

/**
 * Decide which editions of a build to keep.
 *
 * @param {readonly EditionCandidate[]} documents every document that is part
 *   of the build (articles, pages and editions), in build order
 * @returns {{dropped: Set<string>, warnings: Finding[]}} the paths of the
 *   editions to leave out and one warning for each
 */
export function evaluateEditions(documents) {
  const articles = documents.filter(
    (document) => document.frontmatter.kind === 'article',
  );
  /** @type {Set<string>} */
  const dropped = new Set();
  /** @type {Finding[]} */
  const warnings = [];
  for (const document of documents) {
    if (document.frontmatter.kind !== 'edition') {
      continue;
    }
    const { edition, language } = document.frontmatter;
    const source = findSourceArticle(articles, edition.of, language);
    if (source === null) {
      dropped.add(document.relativePath);
      warnings.push(
        editionWarning(
          'EDITION_SOURCE_MISSING',
          document,
          `${document.relativePath}: the edition is of "${edition.of}", but no article with that slug is part of this build (it may be missing, a draft, or archived), so the edition is left out.`,
          'Restore or publish the article, or delete the edition document.',
        ),
      );
      continue;
    }
    if (
      editionSourceDigest(source.rawBody) !== digestHex(edition.sourceDigest)
    ) {
      dropped.add(document.relativePath);
      warnings.push(
        editionWarning(
          'EDITION_STALE',
          document,
          `${document.relativePath}: the article "${edition.of}" (${source.relativePath}) has changed since this edition was made from it, so the edition is left out.`,
          'Generate the edition again from the current article, or delete the edition document.',
        ),
      );
    }
  }
  return { dropped, warnings };
}
