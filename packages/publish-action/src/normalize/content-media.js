/**
 * Content media references: which repository files an article, page or
 * edition refers to as an image, and whether each one is a file the renderer
 * may read.
 *
 * Two kinds of reference exist. A body image is `![alt](path)` in the
 * Markdown body; a hero is the `hero.path` of the front matter. Intake checks
 * every file either kind names, digests it, and hands the renderer:
 *
 * - for a body image, one entry in that document's `content[].media[]`
 *   (`{path, sourceDigest, mediaType, byteLength}`, ordered by path), which is
 *   the inventory the renderer resolves the body's `<img src>` against;
 * - for a hero, `frontmatter.hero.file` (`{path, sourceDigest}`).
 *
 * The bytes stay on disk: the sandbox mounts the repository read-only and the
 * template's media pipeline reads each file from there, failing closed when
 * the bytes do not hash to the digest given here.
 *
 * **Where the body references come from.** From the *sanitized HTML* that
 * `template`'s `normalizeAuthoredMarkdown` produced for the body, not from the
 * Markdown text. That is the exact string the renderer will see, so both sides
 * agree on the set of references and on every `src`: reference-style images,
 * titles, escapes and code spans are all settled by the one Markdown parser,
 * and an `<img>` inside a code block is text, never a reference. The
 * sanitizer removes the `src` of an image whose address has a scheme, so an
 * external image reaches this module as an image with no path.
 *
 * **How a `src` becomes a path** is the renderer's own rule
 * (`template/src/core/internal/media/content-images.js`,
 * `repositoryPathOfImageSource`), applied here so the inventory and the
 * lookup cannot disagree: entities decoded; a scheme, a protocol-relative
 * `//`, a query, a fragment or a backslash never resolves; one leading `/` or
 * `./` is dropped (paths are relative to the repository root, never to the
 * document's directory); the rest is percent-decoded and NFC-normalized; an
 * empty, `.` or `..` segment never resolves. The result is the path the
 * inventory carries and the file is looked for at. A hero's `path` is used
 * exactly as written, so it must already be in that final form.
 *
 * **Where the file may be.** Under an `assetRoots` entry of
 * `gala/repository.json`, as a regular file whose real location (after any
 * directory symbolic link) is still inside that root and inside the
 * repository. A symbolic link is never followed. Its first bytes must be a
 * PNG, JPEG, WebP, AVIF or GIF image; SVG is refused. The `mediaType` the
 * inventory states is taken from those bytes, never from the file name.
 *
 * **Limits** mirror `template`'s media pipeline
 * (`src/core/internal/media/limits.js`): one source image at most 10 MiB, at
 * most 2048 distinct images, at most 256 MiB of source bytes together; and the
 * build input's own bounds: 200 images per document, and 5 MiB for an image
 * listed in a document's `media[]` (a hero, which is not listed there, may be
 * up to the template's 10 MiB). The template re-checks its stricter decode
 * ceilings (dimensions, pixels) when it reads the file. Tests keep these
 * numbers equal to the template's and to the installed schema's.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {object} MediaLimits
 * @property {number} maxSourceBytes largest admitted source image, in bytes
 * @property {number} maxDistinctImages most distinct image files one publication may reference
 * @property {number} maxTotalBytes most source bytes all referenced images may add up to
 * @property {number} maxImagesPerDocument most distinct body images one document's `media[]` may list
 * @property {number} maxBodyImageBytes largest image a document's `media[]` may list, in bytes
 */

/**
 * Media ceilings. The first three equal `template`'s `limits.js`
 * (`MAX_IMAGE_SOURCE_BYTES`, `MAX_IMAGES_PER_PUBLICATION`,
 * `MAX_TOTAL_MEDIA_BYTES_PER_PUBLICATION`). The last two are the build
 * input's own: the maximum length of `content[].media[]`, and the largest
 * `byteLength` an image entry of `media[]` may state (5 MiB), so a body image
 * is held to the smaller of that and the template's 10 MiB. A hero is not
 * listed in `media[]`, so it may be as large as the template allows.
 * `test/content-media.test.js` keeps this one equal to the installed schema.
 *
 * @type {Readonly<MediaLimits>}
 */
export const MEDIA_LIMITS = Object.freeze({
  maxSourceBytes: 10_485_760,
  maxDistinctImages: 2048,
  maxTotalBytes: 268_435_456,
  maxImagesPerDocument: 200,
  maxBodyImageBytes: 5_242_880,
});

/** Most findings one intake failure reports; the rest are counted, not listed. */
export const MAX_MEDIA_FINDINGS = 50;

/** The schema's bound on a repository-relative path, in UTF-8 bytes. */
const MAX_PATH_BYTES = 512;

/** How many leading bytes are read to recognize an image format. */
const SNIFF_BYTES = 4096;

const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
// eslint-disable-next-line no-control-regex -- the point is to refuse controls
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * @typedef {object} MediaReference
 * @property {string} document repository-relative path of the document that refers to the image
 * @property {'body' | 'hero'} origin whether it is a body image or the front matter hero
 * @property {string | null} source the reference as written (an `<img src>` with entities decoded, or a hero path); `null` when the image has no usable address
 * @property {string} alt the image's alternative text, for messages
 */

/**
 * One image file as the build input lists it.
 *
 * @typedef {object} MediaFile
 * @property {string} path repository-relative path
 * @property {string} sourceDigest `sha256:` plus 64 lowercase hexadecimal characters
 * @property {'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' | 'image/gif'} mediaType the format, from the file's bytes
 * @property {number} byteLength the file's size in bytes
 */

/**
 * @typedef {import('../types.js').PublishActionFinding} Finding
 */

/**
 * @typedef {{reason: string, explanation: string}} Problem
 */

/**
 * Decode the entities `sanitize-html` writes inside an attribute value, in
 * one left-to-right pass (so `&amp;lt;` stays `&lt;`).
 *
 * @param {string} value an attribute value as serialized
 * @returns {string} the decoded value
 */
function decodeAttribute(value) {
  return value.replace(
    /&(amp|lt|gt|quot|#39);/gu,
    (match, name) =>
      /** @type {Record<string, string>} */ ({
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        '#39': "'",
      })[name] ?? match,
  );
}

/**
 * List the images of a sanitized HTML body in document order.
 *
 * The input must be `normalizeAuthoredMarkdown` output. Its serializer writes
 * every attribute as `name="value"` with `&`, `<`, `>` and `"` escaped, so a
 * tag never contains a raw `>` and the scan below is exact for that output.
 *
 * @param {string} html the sanitized HTML body
 * @returns {{src: string | null, alt: string}[]} one entry per `<img>`; `src`
 *   is `null` when the sanitizer removed or never had one
 */
export function findImageSources(html) {
  /** @type {{src: string | null, alt: string}[]} */
  const images = [];
  for (const match of html.matchAll(/<img\b[^>]*>/giu)) {
    const tag = match[0];
    const src = /\ssrc="([^"]*)"/u.exec(tag);
    const alt = /\salt="([^"]*)"/u.exec(tag);
    const decodedSrc = src?.[1] === undefined ? null : decodeAttribute(src[1]);
    images.push({
      src: decodedSrc === '' ? null : decodedSrc,
      alt: alt?.[1] === undefined ? '' : decodeAttribute(alt[1]),
    });
  }
  return images;
}

/**
 * Normalize the `assetRoots` of `gala/repository.json` for comparison: no
 * leading or trailing slash, no empty entry, no duplicate.
 *
 * @param {readonly {path: string}[] | undefined} assetRoots the declared roots
 * @returns {string[]} the normalized root directories
 */
export function normalizeAssetRoots(assetRoots) {
  const roots = new Set();
  for (const entry of assetRoots ?? []) {
    const root = entry.path.replace(/^\/+/u, '').replace(/\/+$/u, '');
    if (root !== '') {
      roots.add(root);
    }
  }
  return [...roots];
}

/**
 * Turn an `<img src>` (entities already decoded) into the repository path it
 * names, by the renderer's rule (see the module documentation).
 *
 * @param {string} source the `src` value
 * @returns {{path: string} | Problem} the path, or why there is none
 */
export function resolveImageSource(source) {
  if (source.startsWith('//') || SCHEME_PREFIX.test(source)) {
    return {
      reason: 'EXTERNAL_ADDRESS',
      explanation:
        'is an external address; an image must be a file in this repository',
    };
  }
  if (/[?#\\]/u.test(source)) {
    return {
      reason: 'NOT_A_REPOSITORY_PATH',
      explanation: 'contains a query, a fragment or a backslash',
    };
  }
  const relative = source.startsWith('/')
    ? source.slice(1)
    : source.startsWith('./')
      ? source.slice(2)
      : source;
  let decoded;
  try {
    decoded = decodeURIComponent(relative).normalize('NFC');
  } catch {
    return {
      reason: 'NOT_A_REPOSITORY_PATH',
      explanation: 'contains an invalid "%" escape',
    };
  }
  if (
    decoded.includes('\\') ||
    decoded.includes('\u0000') ||
    decoded.split('/').some((segment) => ['', '.', '..'].includes(segment))
  ) {
    return {
      reason: 'NOT_A_REPOSITORY_PATH',
      explanation:
        'has an empty, "." or ".." segment; write the path from the repository root',
    };
  }
  if (Buffer.byteLength(decoded, 'utf8') > MAX_PATH_BYTES) {
    return {
      reason: 'NOT_A_REPOSITORY_PATH',
      explanation: `is longer than ${MAX_PATH_BYTES} bytes`,
    };
  }
  return { path: decoded };
}

/**
 * Why a hero path cannot be used as written, or `null` when it can. The
 * schema's `repoRelativePath` (NFC, at most 512 UTF-8 bytes, no leading
 * slash, no backslash, no NUL, no dot segment) plus what makes the string
 * safe to hand on verbatim: no scheme, no query or fragment, no `%` escape, no
 * control character, no empty segment.
 *
 * @param {string} value the front matter `hero.path`
 * @returns {Problem | null} the problem, or `null` when it is well formed
 */
export function heroPathProblem(value) {
  if (SCHEME_PREFIX.test(value) || value.startsWith('//')) {
    return {
      reason: 'EXTERNAL_ADDRESS',
      explanation:
        'is an external address; an image must be a file in this repository',
    };
  }
  /** @type {string | null} */
  let explanation = null;
  if (value.startsWith('/')) {
    explanation =
      'starts with "/"; write the path from the repository root, for example assets/hero.jpg';
  } else if (/[?#]/u.test(value)) {
    explanation = 'contains a query or fragment ("?" or "#")';
  } else if (value.includes('%')) {
    explanation =
      'contains "%"; a hero path is used exactly as written, so rename the file to a name without it';
  } else if (value.includes('\\') || CONTROL_CHARACTER.test(value)) {
    explanation = 'contains a backslash or a control character';
  } else if (
    value
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    explanation =
      'has an empty, "." or ".." segment; write the path from the repository root';
  } else if (value.normalize('NFC') !== value) {
    explanation = 'is not Unicode NFC normalized';
  } else if (Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) {
    explanation = `is longer than ${MAX_PATH_BYTES} bytes`;
  }
  return explanation === null
    ? null
    : { reason: 'NOT_A_REPOSITORY_PATH', explanation };
}

/**
 * Recognize an image format from a file's first bytes (the same signatures
 * as the renderer: never the file name).
 *
 * @param {Buffer} head the first bytes of the file
 * @returns {MediaFile['mediaType'] | 'svg' | null} the media type, `'svg'`
 *   for markup that looks like SVG/XML, or `null` for anything else
 */
export function sniffImageMediaType(head) {
  const text = head.subarray(0, SNIFF_BYTES).toString('utf8').trimStart();
  if (
    text.startsWith('﻿') ||
    text.startsWith('<?xml') ||
    text.startsWith('<!--') ||
    text.startsWith('<svg') ||
    /<svg[\s>]/iu.test(text.slice(0, 512))
  ) {
    return 'svg';
  }
  if (
    head.length >= 8 &&
    head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png';
  }
  if (
    head.length >= 3 &&
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    head.length >= 12 &&
    head.subarray(4, 8).toString('latin1') === 'ftyp' &&
    head.subarray(8, 12).toString('latin1') === 'avif'
  ) {
    return 'image/avif';
  }
  const signature = head.subarray(0, 6).toString('latin1');
  if (signature === 'GIF87a' || signature === 'GIF89a') {
    return 'image/gif';
  }
  return null;
}

/**
 * @param {string} relativePath a well-formed repository-relative path
 * @param {readonly string[]} roots normalized asset roots
 * @returns {string[]} the roots the path sits under, lexically
 */
function rootsContaining(relativePath, roots) {
  return roots.filter((root) => relativePath.startsWith(`${root}/`));
}

/**
 * @param {string} child an absolute real path
 * @param {string} parent an absolute real path
 * @returns {boolean} whether `child` is `parent` or inside it
 */
function isWithin(child, parent) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/**
 * Build one media finding in the shared finding shape.
 *
 * @param {string} code `MEDIA_REFERENCE_UNRESOLVED` or `MEDIA_LIMIT_EXCEEDED`
 * @param {string} detail human-readable detail naming the document and path
 * @param {string | undefined} document the document, when one is to blame
 * @param {Record<string, unknown>} evidence machine-readable facts
 * @param {string} recovery what the author can do
 * @returns {Finding} the finding
 */
function mediaFinding(code, detail, document, evidence, recovery) {
  return {
    code,
    severity: 'SOURCE_ERROR',
    detail,
    ...(document === undefined ? {} : { location: document }),
    evidence,
    recovery,
    overridable: false,
  };
}

/**
 * @param {readonly string[]} roots normalized asset roots
 * @returns {string} the roots as the author wrote them, for messages
 */
function describeRoots(roots) {
  return roots.length === 0
    ? 'none are declared'
    : roots.map((root) => `"${root}/"`).join(', ');
}

/**
 * The finding for a reference that cannot be used.
 *
 * @param {MediaReference} reference the reference
 * @param {string | null} resolved the path it resolved to, when it did
 * @param {Problem} problem what is wrong
 * @param {readonly string[]} roots normalized asset roots
 * @returns {Finding} the finding
 */
function unresolvedFinding(reference, resolved, problem, roots) {
  const written = reference.source;
  const kind = reference.origin === 'hero' ? 'the hero image' : 'the image';
  const subject =
    written === null
      ? `the image "${reference.alt}"`
      : `${kind} "${written}"${resolved !== null && resolved !== written ? ` (the file "${resolved}")` : ''}`;
  const recovery =
    problem.reason === 'OUTSIDE_ASSET_ROOTS'
      ? `Move the file under a declared asset root (${describeRoots(roots)}), or add its folder to "assetRoots" in gala/repository.json.`
      : problem.reason === 'UNSUPPORTED_FORMAT'
        ? 'Use a PNG, JPEG, WebP, AVIF or GIF image (SVG is not allowed).'
        : 'Add the image as a file under an asset root declared in gala/repository.json (for example "assets/"), refer to it by its path from the repository root, or remove the reference.';
  return mediaFinding(
    'MEDIA_REFERENCE_UNRESOLVED',
    `${reference.document}: ${subject} ${problem.explanation}.`,
    reference.document,
    {
      document: reference.document,
      path: written,
      origin: reference.origin,
      reason: problem.reason,
    },
    recovery,
  );
}

/**
 * Check one distinct path against the file system.
 *
 * @param {string} repositoryDirectory absolute repository root
 * @param {string} relativePath a well-formed repository-relative path under at
 *   least one asset root
 * @param {readonly string[]} roots normalized asset roots
 * @param {{real: Map<string, string | null>, repository: string}} realPaths
 *   memo of real root paths, and the real repository path
 * @returns {Promise<{size: number, mediaType: MediaFile['mediaType']} | Problem>}
 *   the file's size and format, or why it cannot be used
 */
async function inspectAsset(
  repositoryDirectory,
  relativePath,
  roots,
  realPaths,
) {
  const absolute = path.join(repositoryDirectory, ...relativePath.split('/'));
  /** @type {import('node:fs').Stats} */
  let stats;
  try {
    stats = await lstat(absolute);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG') {
      return {
        reason: 'FILE_MISSING',
        explanation: 'does not exist in the repository',
      };
    }
    if (code === 'ELOOP') {
      return {
        reason: 'NOT_A_REGULAR_FILE',
        explanation: 'goes through a symbolic link loop',
      };
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    return {
      reason: 'NOT_A_REGULAR_FILE',
      explanation: 'is a symbolic link, which is not followed',
    };
  }
  if (!stats.isFile()) {
    return {
      reason: 'NOT_A_REGULAR_FILE',
      explanation: 'is not a regular file',
    };
  }
  const realParent = await realpath(path.dirname(absolute));
  let contained = false;
  for (const root of rootsContaining(relativePath, roots)) {
    if (!realPaths.real.has(root)) {
      realPaths.real.set(
        root,
        await realpath(
          path.join(repositoryDirectory, ...root.split('/')),
        ).catch(() => null),
      );
    }
    const realRoot = realPaths.real.get(root);
    if (
      realRoot !== null &&
      realRoot !== undefined &&
      isWithin(realRoot, realPaths.repository) &&
      isWithin(realParent, realRoot)
    ) {
      contained = true;
      break;
    }
  }
  if (!contained) {
    return {
      reason: 'OUTSIDE_ASSET_ROOTS',
      explanation:
        'resolves outside its asset root through a symbolic link, which is not followed',
    };
  }
  const handle = await open(absolute, 'r');
  let head;
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    head = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  const mediaType = sniffImageMediaType(head);
  if (mediaType === 'svg') {
    return {
      reason: 'UNSUPPORTED_FORMAT',
      explanation: 'is an SVG file; SVG is not allowed',
    };
  }
  if (mediaType === null) {
    return {
      reason: 'UNSUPPORTED_FORMAT',
      explanation:
        stats.size === 0
          ? 'is empty'
          : 'is not a PNG, JPEG, WebP, AVIF or GIF image',
    };
  }
  return { size: stats.size, mediaType };
}

/**
 * Keep the first findings and say how many were left out.
 *
 * @param {Finding[]} findings every finding
 * @returns {Finding[]} at most {@link MAX_MEDIA_FINDINGS} findings
 */
function capFindings(findings) {
  if (findings.length <= MAX_MEDIA_FINDINGS) {
    return findings;
  }
  const kept = findings.slice(0, MAX_MEDIA_FINDINGS);
  const first = findings[0];
  kept.push(
    mediaFinding(
      /** @type {string} */ (first?.code),
      `${findings.length - MAX_MEDIA_FINDINGS} more finding(s) of the same kind are not listed.`,
      undefined,
      { omitted: findings.length - MAX_MEDIA_FINDINGS },
      /** @type {string} */ (first?.recovery),
    ),
  );
  return kept;
}

/**
 * @param {string} left a repository-relative path
 * @param {string} right a repository-relative path
 * @returns {number} UTF-8 byte-order comparison
 */
function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/**
 * @typedef {{order: number, reference: MediaReference}} OrderedReference
 */

/**
 * @typedef {{order: number, finding: Finding}} OrderedFinding
 */

/**
 * Sort findings by the position of the reference they came from (the order
 * the documents were read in) and cap the list.
 *
 * @param {OrderedFinding[]} problems the findings with their reference position
 * @returns {Finding[]} the findings in reading order, capped
 */
function inReadingOrder(problems) {
  return capFindings(
    [...problems]
      .sort((left, right) => left.order - right.order)
      .map(({ finding }) => finding),
  );
}

/**
 * @param {string} located a well-formed repository path
 * @param {readonly string[]} roots normalized asset roots
 * @returns {{path: string} | {path: string, problem: Problem}} the path, with
 *   a problem when it is not under any declared asset root
 */
function underAssetRoot(located, roots) {
  return rootsContaining(located, roots).length > 0
    ? { path: located }
    : {
        path: located,
        problem: {
          reason: 'OUTSIDE_ASSET_ROOTS',
          explanation: `is not under an asset root declared in gala/repository.json (${describeRoots(roots)})`,
        },
      };
}

/**
 * Where a reference points, judged without touching the file system.
 *
 * @param {MediaReference} reference the reference
 * @param {readonly string[]} roots normalized asset roots
 * @returns {{path: string} | {path: string | null, problem: Problem}} the
 *   repository path it names, or the problem (with the path, when it got that far)
 */
function locate(reference, roots) {
  const { source } = reference;
  if (source === null) {
    return {
      path: null,
      problem: {
        reason: 'NO_SOURCE',
        explanation:
          'has no repository path (it is empty, or it is an external address, which is not supported)',
      },
    };
  }
  if (reference.origin === 'hero') {
    const problem = heroPathProblem(source);
    return problem === null
      ? underAssetRoot(source, roots)
      : { path: null, problem };
  }
  const resolved = resolveImageSource(source);
  return 'path' in resolved
    ? underAssetRoot(resolved.path, roots)
    : { path: null, problem: resolved };
}

/**
 * Sort the references into the ones that cannot be used (and why), and the
 * well-formed ones grouped by the path they resolve to. Pure: nothing is read
 * from disk.
 *
 * @param {readonly MediaReference[]} references every reference
 * @param {readonly string[]} roots normalized asset roots
 * @returns {{problems: OrderedFinding[], byPath: Map<string, OrderedReference[]>}}
 *   the unusable references, and the usable ones by path
 */
function classifyReferences(references, roots) {
  /** @type {OrderedFinding[]} */
  const problems = [];
  /** @type {Map<string, OrderedReference[]>} */
  const byPath = new Map();
  references.forEach((reference, order) => {
    const located = locate(reference, roots);
    if ('problem' in located) {
      problems.push({
        order,
        finding: unresolvedFinding(
          reference,
          located.path,
          located.problem,
          roots,
        ),
      });
      return;
    }
    const known = byPath.get(located.path);
    if (known === undefined) {
      byPath.set(located.path, [{ order, reference }]);
    } else {
      known.push({ order, reference });
    }
  });
  return { problems, byPath };
}

/**
 * The limits that need only file sizes and reference counts.
 *
 * @param {ReadonlyMap<string, number>} sizes size in bytes of each distinct file, by path
 * @param {ReadonlyMap<string, OrderedReference[]>} byPath who refers to each file
 * @param {Readonly<MediaLimits>} limits the ceilings
 * @returns {Finding[]} the findings, empty when every limit holds
 */
function limitFindings(sizes, byPath, limits) {
  /** @type {Finding[]} */
  const exceeded = [];
  let total = 0;
  for (const [relativePath, size] of sizes) {
    total += size;
    const references = byPath.get(relativePath) ?? [];
    const body = references.find(
      ({ reference }) => reference.origin === 'body',
    );
    if (size > limits.maxSourceBytes) {
      const document = references[0]?.reference.document;
      exceeded.push(
        mediaFinding(
          'MEDIA_LIMIT_EXCEEDED',
          `${document}: the image "${relativePath}" is ${size} bytes; an image may be at most ${limits.maxSourceBytes} bytes (10 MiB).`,
          document,
          {
            limit: 'IMAGE_BYTES',
            document,
            path: relativePath,
            bytes: size,
            max: limits.maxSourceBytes,
          },
          'Resize or compress the image, or replace it with a smaller file.',
        ),
      );
    } else if (body !== undefined && size > limits.maxBodyImageBytes) {
      const document = body.reference.document;
      exceeded.push(
        mediaFinding(
          'MEDIA_LIMIT_EXCEEDED',
          `${document}: the image "${relativePath}" is ${size} bytes; an image in the body of a document may be at most ${limits.maxBodyImageBytes} bytes (5 MiB). Only a hero image may be larger, up to ${limits.maxSourceBytes} bytes (10 MiB).`,
          document,
          {
            limit: 'BODY_IMAGE_BYTES',
            document,
            path: relativePath,
            bytes: size,
            max: limits.maxBodyImageBytes,
          },
          'Resize or compress the image, or replace it with a smaller file.',
        ),
      );
    }
  }
  if (total > limits.maxTotalBytes) {
    exceeded.push(
      mediaFinding(
        'MEDIA_LIMIT_EXCEEDED',
        `The ${sizes.size} images this publication refers to add up to ${total} bytes; together they may be at most ${limits.maxTotalBytes} bytes (256 MiB).`,
        undefined,
        { limit: 'TOTAL_BYTES', bytes: total, max: limits.maxTotalBytes },
        'Resize or compress images, or remove references to images you no longer need.',
      ),
    );
  }
  return exceeded;
}

/**
 * Documents that list more distinct body images than `media[]` can hold.
 *
 * @param {ReadonlyMap<string, OrderedReference[]>} byPath who refers to each file
 * @param {Readonly<MediaLimits>} limits the ceilings
 * @returns {Finding[]} one finding per such document
 */
function documentCountFindings(byPath, limits) {
  /** @type {Map<string, Set<string>>} */
  const pathsByDocument = new Map();
  for (const [relativePath, references] of byPath) {
    for (const { reference } of references) {
      if (reference.origin !== 'body') {
        continue;
      }
      const paths = pathsByDocument.get(reference.document) ?? new Set();
      paths.add(relativePath);
      pathsByDocument.set(reference.document, paths);
    }
  }
  /** @type {Finding[]} */
  const findings = [];
  for (const [document, paths] of pathsByDocument) {
    if (paths.size > limits.maxImagesPerDocument) {
      findings.push(
        mediaFinding(
          'MEDIA_LIMIT_EXCEEDED',
          `${document}: the document refers to ${paths.size} distinct images; one document may list at most ${limits.maxImagesPerDocument}.`,
          document,
          {
            limit: 'DOCUMENT_IMAGES',
            document,
            count: paths.size,
            max: limits.maxImagesPerDocument,
          },
          'Split the document, or remove images it does not need.',
        ),
      );
    }
  }
  return findings;
}

/**
 * Check every referenced image and digest it.
 *
 * On success `files` has each distinct file once, and `documents` has, for
 * each document that refers to images in its body, the entries of that
 * document's `media[]` ordered by the UTF-8 bytes of their path (a hero is
 * checked and counted like any image but is not in `documents`; it is
 * `frontmatter.hero.file`, looked up in `files`). On failure only `findings`
 * is non-empty: every unusable reference is reported together, in the order
 * the documents were read (so one run shows the whole list), and the limits
 * are only judged when every reference is usable.
 *
 * @param {object} options the inputs
 * @param {string} options.repositoryDirectory absolute repository root
 * @param {readonly {path: string}[] | undefined} options.assetRoots the
 *   `assetRoots` of `gala/repository.json`
 * @param {readonly MediaReference[]} options.references every reference from
 *   the documents that are part of the build
 * @param {Readonly<MediaLimits>} [options.limits] the ceilings (injectable for tests)
 * @returns {Promise<{files: Map<string, MediaFile>, documents: Map<string, MediaFile[]>, findings: Finding[]}>}
 *   the inventory, or the findings that make the build fail
 */
export async function resolveMediaReferences({
  repositoryDirectory,
  assetRoots,
  references,
  limits = MEDIA_LIMITS,
}) {
  const roots = normalizeAssetRoots(assetRoots);
  const { problems, byPath } = classifyReferences(references, roots);
  /** @type {Map<string, MediaFile>} */
  const files = new Map();
  /** @type {Map<string, MediaFile[]>} */
  const documents = new Map();
  /**
   * @param {Finding[]} findings what went wrong
   * @returns {{files: Map<string, MediaFile>, documents: Map<string, MediaFile[]>, findings: Finding[]}} a failed resolution
   */
  const failed = (findings) => ({ files, documents, findings });

  if (byPath.size > limits.maxDistinctImages) {
    return failed(
      problems.length > 0
        ? inReadingOrder(problems)
        : [
            mediaFinding(
              'MEDIA_LIMIT_EXCEEDED',
              `This publication refers to ${byPath.size} distinct images; the limit is ${limits.maxDistinctImages}.`,
              undefined,
              {
                limit: 'IMAGE_COUNT',
                count: byPath.size,
                max: limits.maxDistinctImages,
              },
              'Remove references to images you no longer need, or split the publication.',
            ),
          ],
    );
  }

  const paths = [...byPath.keys()].sort(compareUtf8);
  const realPaths = {
    real: /** @type {Map<string, string | null>} */ (new Map()),
    repository: await realpath(repositoryDirectory),
  };
  /** @type {Map<string, {size: number, mediaType: MediaFile['mediaType']}>} */
  const inspected = new Map();
  for (const relativePath of paths) {
    const result = await inspectAsset(
      repositoryDirectory,
      relativePath,
      roots,
      realPaths,
    );
    if ('size' in result) {
      inspected.set(relativePath, result);
      continue;
    }
    for (const { order, reference } of byPath.get(relativePath) ?? []) {
      problems.push({
        order,
        finding: unresolvedFinding(reference, relativePath, result, roots),
      });
    }
  }
  if (problems.length > 0) {
    return failed(inReadingOrder(problems));
  }

  const exceeded = [
    ...limitFindings(
      new Map([...inspected].map(([key, { size }]) => [key, size])),
      byPath,
      limits,
    ),
    ...documentCountFindings(byPath, limits),
  ];
  if (exceeded.length > 0) {
    return failed(capFindings(exceeded));
  }

  for (const relativePath of paths) {
    const bytes = await readFile(
      path.join(repositoryDirectory, ...relativePath.split('/')),
    );
    const { mediaType } = /** @type {{mediaType: MediaFile['mediaType']}} */ (
      inspected.get(relativePath)
    );
    files.set(relativePath, {
      path: relativePath,
      sourceDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      mediaType,
      byteLength: bytes.byteLength,
    });
  }
  for (const [relativePath, references_] of byPath) {
    for (const { reference } of references_) {
      if (reference.origin !== 'body') {
        continue;
      }
      const entries = documents.get(reference.document) ?? [];
      if (!entries.some((entry) => entry.path === relativePath)) {
        entries.push(/** @type {MediaFile} */ (files.get(relativePath)));
      }
      documents.set(reference.document, entries);
    }
  }
  for (const entries of documents.values()) {
    entries.sort((left, right) => compareUtf8(left.path, right.path));
  }
  return { files, documents, findings: [] };
}
