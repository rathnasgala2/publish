/**
 * Content media references: which repository files an article, page or
 * edition refers to as an image, and whether each one is a file the renderer
 * may read.
 *
 * Two kinds of reference exist. A body image is `![alt](path)` in the
 * Markdown body; a hero is the `hero.path` of the front matter. Intake lists
 * every file either kind names, checks it, digests it and hands the list to
 * the renderer as `build-input.assets[]` (`{path, sourceDigest}`). The bytes
 * stay on disk: the sandbox mounts the repository read-only and the
 * template's media pipeline reads each file from there, failing closed when
 * the bytes do not hash to the digest listed here.
 *
 * **Where the references come from.** Body images are read from the
 * *sanitized HTML* that `template`'s `normalizeAuthoredMarkdown` produced for
 * the body, not from the Markdown text. That is the exact string the
 * renderer will see, so both sides agree on the set of references and on
 * every `src`: reference-style images, titles, escapes and code spans are all
 * settled by the one Markdown parser, and an `<img>` that appears inside a
 * code block is text, never a reference.
 *
 * **What a reference may be.** A repository-relative path, written exactly as
 * the file's path: slash separators, no leading `/` or `./`, no `..`, no
 * scheme, no query or fragment, no percent-encoding, Unicode NFC. The
 * renderer matches an `<img src>` to this inventory by exact string equality
 * and never resolves a path against the document's own directory, so a
 * relative-to-the-document spelling is refused rather than guessed at. An
 * external address cannot be reached by the sanitizer at all (it removes the
 * `src` of every image whose address has a scheme), so it surfaces here as an
 * image with no usable path.
 *
 * **Where the file may be.** Under an `assetRoots` entry of
 * `gala/repository.json`, as a regular file whose real location (after any
 * directory symbolic link) is still inside that root and inside the
 * repository. A symbolic link is never followed.
 *
 * **Limits** mirror `template`'s media pipeline
 * (`src/core/internal/media/limits.js`): one source image at most 10 MiB, at
 * most 2048 distinct images, at most 256 MiB of source bytes together. The
 * template re-checks its own, stricter decode ceilings (dimensions, pixels).
 * A test keeps these numbers equal to the template's.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {object} MediaLimits
 * @property {number} maxSourceBytes largest admitted source image, in bytes
 * @property {number} maxDistinctImages most distinct image files one publication may reference
 * @property {number} maxTotalBytes most source bytes all referenced images may add up to
 */

/**
 * Media ceilings, equal to `template`'s `limits.js`
 * (`MAX_IMAGE_SOURCE_BYTES`, `MAX_IMAGES_PER_PUBLICATION`,
 * `MAX_TOTAL_MEDIA_BYTES_PER_PUBLICATION`).
 *
 * @type {Readonly<MediaLimits>}
 */
export const MEDIA_LIMITS = Object.freeze({
  /** Largest admitted source image, in bytes (10 MiB). */
  maxSourceBytes: 10_485_760,
  /** Most distinct image files one publication may reference. */
  maxDistinctImages: 2048,
  /** Most source bytes all referenced images may add up to (256 MiB). */
  maxTotalBytes: 268_435_456,
});

/** Most findings one intake failure reports; the rest are counted, not listed. */
export const MAX_MEDIA_FINDINGS = 50;

/** The schema's bound on a repository-relative path, in UTF-8 bytes. */
const MAX_PATH_BYTES = 512;

const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
// eslint-disable-next-line no-control-regex -- the point is to refuse controls
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * @typedef {object} MediaReference
 * @property {string} document repository-relative path of the document that refers to the image
 * @property {'body' | 'hero'} origin whether it is a body image or the front matter hero
 * @property {string | null} path the reference as written; `null` when the image has no usable path
 * @property {string} alt the image's alternative text, for messages
 */

/**
 * @typedef {object} MediaAsset
 * @property {string} path repository-relative path
 * @property {string} sourceDigest `sha256:` plus 64 lowercase hexadecimal characters
 */

/**
 * @typedef {import('../types.js').PublishActionFinding} Finding
 */

/**
 * Decode the four entities `sanitize-html` produces inside an attribute
 * value, in one left-to-right pass (so `&amp;lt;` stays `&lt;`).
 *
 * @param {string} value an attribute value as serialized
 * @returns {string} the decoded value
 */
function decodeAttribute(value) {
  return value.replace(
    /&(amp|lt|gt|quot);/gu,
    (_match, name) =>
      /** @type {Record<string, string>} */ ({
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
      })[name] ?? _match,
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
 * Why a reference string is not a plain repository-relative file path, or
 * `null` when it is one. The rules are the schema's `repoRelativePath`
 * (NFC, at most 512 UTF-8 bytes, no leading slash, no backslash, no NUL, no
 * dot segment) plus the ones that make a string safe to compare verbatim
 * with an `<img src>`: no scheme, query, fragment, percent-encoding,
 * control character, empty segment or leading `./`.
 *
 * @param {string} value the reference as written
 * @returns {{reason: 'EXTERNAL_ADDRESS' | 'NOT_A_REPOSITORY_PATH', explanation: string} | null}
 *   the problem, or `null` when the reference is well formed
 */
export function referencePathProblem(value) {
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
      'starts with "/"; write the path from the repository root, for example assets/photo.png';
  } else if (/[?#]/u.test(value)) {
    explanation = 'contains a query or fragment ("?" or "#")';
  } else if (value.includes('%')) {
    explanation =
      'contains "%"; escaped characters are not read, so rename the file to a name that needs no escaping';
  } else if (value.includes('\\') || CONTROL_CHARACTER.test(value)) {
    explanation = 'contains a backslash or a control character';
  } else if (
    value
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    explanation =
      'contains an empty, "." or ".." segment; write the path from the repository root without "./" or "../"';
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
 * @param {string} reason a stable reason code
 * @param {string} explanation what is wrong, completing "image ... <explanation>"
 * @param {readonly string[]} roots normalized asset roots
 * @returns {Finding} the finding
 */
function unresolvedFinding(reference, reason, explanation, roots) {
  const subject =
    reference.path === null
      ? `the image "${reference.alt}"`
      : `${reference.origin === 'hero' ? 'the hero image' : 'the image'} "${reference.path}"`;
  const recovery =
    reason === 'OUTSIDE_ASSET_ROOTS'
      ? `Move the file under a declared asset root (${describeRoots(roots)}), or add its folder to "assetRoots" in gala/repository.json.`
      : 'Add the image as a file under an asset root declared in gala/repository.json (for example "assets/"), refer to it by its path from the repository root, or remove the reference.';
  return mediaFinding(
    'MEDIA_REFERENCE_UNRESOLVED',
    `${reference.document}: ${subject} ${explanation}.`,
    reference.document,
    {
      document: reference.document,
      path: reference.path,
      origin: reference.origin,
      reason,
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
 * @returns {Promise<{size: number} | {reason: string, explanation: string}>}
 *   the file's size, or why it cannot be used
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
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {
        reason: 'FILE_MISSING',
        explanation: 'does not exist in the repository',
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
      return { size: stats.size };
    }
  }
  return {
    reason: 'OUTSIDE_ASSET_ROOTS',
    explanation:
      'resolves outside its asset root through a symbolic link, which is not followed',
  };
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
 * Why a reference cannot be used, judged without touching the file system.
 *
 * @param {MediaReference} reference the reference
 * @param {readonly string[]} roots normalized asset roots
 * @returns {{reason: string, explanation: string} | null} the problem, or
 *   `null` when the reference is a well-formed path under a declared root
 */
function referenceProblem(reference, roots) {
  if (reference.path === null) {
    return {
      reason: 'NO_SOURCE',
      explanation:
        'has no repository path (it is empty, or it is an external address, which is not supported)',
    };
  }
  const problem = referencePathProblem(reference.path);
  if (problem !== null) {
    return problem;
  }
  if (rootsContaining(reference.path, roots).length === 0) {
    return {
      reason: 'OUTSIDE_ASSET_ROOTS',
      explanation: `is not under an asset root declared in gala/repository.json (${describeRoots(roots)})`,
    };
  }
  return null;
}

/**
 * Sort the references into the ones that cannot be used (and why), and the
 * well-formed ones grouped by path. Pure: nothing is read from disk.
 *
 * @param {readonly MediaReference[]} references every reference
 * @param {readonly string[]} roots normalized asset roots
 * @returns {{problems: OrderedFinding[], byPath: Map<string, {order: number, reference: MediaReference}[]>}}
 *   the unusable references, and the usable ones by path
 */
function classifyReferences(references, roots) {
  /** @type {OrderedFinding[]} */
  const problems = [];
  /** @type {Map<string, {order: number, reference: MediaReference}[]>} */
  const byPath = new Map();
  references.forEach((reference, order) => {
    const problem = referenceProblem(reference, roots);
    if (problem !== null) {
      problems.push({
        order,
        finding: unresolvedFinding(
          reference,
          problem.reason,
          problem.explanation,
          roots,
        ),
      });
      return;
    }
    const key = /** @type {string} */ (reference.path);
    const known = byPath.get(key);
    if (known === undefined) {
      byPath.set(key, [{ order, reference }]);
    } else {
      known.push({ order, reference });
    }
  });
  return { problems, byPath };
}

/**
 * The limits that need only file sizes.
 *
 * @param {ReadonlyMap<string, number>} sizes size in bytes of each distinct file, by path
 * @param {ReadonlyMap<string, {order: number, reference: MediaReference}[]>} byPath who refers to each file
 * @param {Readonly<MediaLimits>} limits the ceilings
 * @returns {Finding[]} one finding per oversized file, then one for the total if exceeded
 */
function sizeLimitFindings(sizes, byPath, limits) {
  /** @type {Finding[]} */
  const exceeded = [];
  let total = 0;
  for (const [relativePath, size] of sizes) {
    total += size;
    if (size > limits.maxSourceBytes) {
      const document = byPath.get(relativePath)?.[0]?.reference.document;
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
 * Check every referenced image and digest it.
 *
 * On success the result lists each distinct file once, ordered by the UTF-8
 * bytes of its path. On failure it carries only findings: every unusable
 * reference is reported together, in the order the documents were read (so
 * one run shows the whole list), and the limits are only judged when every
 * reference is usable.
 *
 * @param {object} options the inputs
 * @param {string} options.repositoryDirectory absolute repository root
 * @param {readonly {path: string}[] | undefined} options.assetRoots the
 *   `assetRoots` of `gala/repository.json`
 * @param {readonly MediaReference[]} options.references every reference from
 *   the documents that are part of the build
 * @param {Readonly<MediaLimits>} [options.limits] the ceilings (injectable for tests)
 * @returns {Promise<{assets: MediaAsset[], findings: Finding[]}>} the
 *   inventory, or the findings that make the build fail
 */
export async function resolveMediaReferences({
  repositoryDirectory,
  assetRoots,
  references,
  limits = MEDIA_LIMITS,
}) {
  const roots = normalizeAssetRoots(assetRoots);
  const { problems, byPath } = classifyReferences(references, roots);

  if (byPath.size > limits.maxDistinctImages) {
    return {
      assets: [],
      findings:
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
    };
  }

  const paths = [...byPath.keys()].sort(compareUtf8);
  const realPaths = {
    real: /** @type {Map<string, string | null>} */ (new Map()),
    repository: await realpath(repositoryDirectory),
  };
  /** @type {Map<string, number>} */
  const sizes = new Map();
  for (const relativePath of paths) {
    const inspected = await inspectAsset(
      repositoryDirectory,
      relativePath,
      roots,
      realPaths,
    );
    if ('size' in inspected) {
      sizes.set(relativePath, inspected.size);
      continue;
    }
    for (const { order, reference } of byPath.get(relativePath) ?? []) {
      problems.push({
        order,
        finding: unresolvedFinding(
          reference,
          inspected.reason,
          inspected.explanation,
          roots,
        ),
      });
    }
  }
  if (problems.length > 0) {
    return { assets: [], findings: inReadingOrder(problems) };
  }

  const exceeded = sizeLimitFindings(sizes, byPath, limits);
  if (exceeded.length > 0) {
    return { assets: [], findings: capFindings(exceeded) };
  }

  /** @type {MediaAsset[]} */
  const assets = [];
  for (const relativePath of paths) {
    const bytes = await readFile(
      path.join(repositoryDirectory, ...relativePath.split('/')),
    );
    assets.push({
      path: relativePath,
      sourceDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  }
  return { assets, findings: [] };
}
