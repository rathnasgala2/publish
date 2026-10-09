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
export function findImageSources(html: string): {
    src: string | null;
    alt: string;
}[];
/**
 * Normalize the `assetRoots` of `gala/repository.json` for comparison: no
 * leading or trailing slash, no empty entry, no duplicate.
 *
 * @param {readonly {path: string}[] | undefined} assetRoots the declared roots
 * @returns {string[]} the normalized root directories
 */
export function normalizeAssetRoots(assetRoots: readonly {
    path: string;
}[] | undefined): string[];
/**
 * Turn an `<img src>` (entities already decoded) into the repository path it
 * names, by the renderer's rule (see the module documentation).
 *
 * @param {string} source the `src` value
 * @returns {{path: string} | Problem} the path, or why there is none
 */
export function resolveImageSource(source: string): {
    path: string;
} | Problem;
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
export function heroPathProblem(value: string): Problem | null;
/**
 * Recognize an image format from a file's first bytes (the same signatures
 * as the renderer: never the file name).
 *
 * @param {Buffer} head the first bytes of the file
 * @returns {MediaFile['mediaType'] | 'svg' | null} the media type, `'svg'`
 *   for markup that looks like SVG/XML, or `null` for anything else
 */
export function sniffImageMediaType(head: Buffer): MediaFile["mediaType"] | "svg" | null;
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
export function resolveMediaReferences({ repositoryDirectory, assetRoots, references, limits, }: {
    repositoryDirectory: string;
    assetRoots: readonly {
        path: string;
    }[] | undefined;
    references: readonly MediaReference[];
    limits?: Readonly<MediaLimits> | undefined;
}): Promise<{
    files: Map<string, MediaFile>;
    documents: Map<string, MediaFile[]>;
    findings: Finding[];
}>;
/**
 * @typedef {object} MediaLimits
 * @property {number} maxSourceBytes largest admitted source image, in bytes
 * @property {number} maxDistinctImages most distinct image files one publication may reference
 * @property {number} maxTotalBytes most source bytes all referenced images may add up to
 * @property {number} maxImagesPerDocument most distinct body images one document's `media[]` may list
 */
/**
 * Media ceilings. The first three equal `template`'s `limits.js`
 * (`MAX_IMAGE_SOURCE_BYTES`, `MAX_IMAGES_PER_PUBLICATION`,
 * `MAX_TOTAL_MEDIA_BYTES_PER_PUBLICATION`); the last is the maximum length of
 * `build-input`'s `content[].media[]`.
 *
 * @type {Readonly<MediaLimits>}
 */
export const MEDIA_LIMITS: Readonly<MediaLimits>;
/** Most findings one intake failure reports; the rest are counted, not listed. */
export const MAX_MEDIA_FINDINGS: 50;
export type MediaReference = {
    /**
     * repository-relative path of the document that refers to the image
     */
    document: string;
    /**
     * whether it is a body image or the front matter hero
     */
    origin: "body" | "hero";
    /**
     * the reference as written (an `<img src>` with entities decoded, or a hero path); `null` when the image has no usable address
     */
    source: string | null;
    /**
     * the image's alternative text, for messages
     */
    alt: string;
};
/**
 * One image file as the build input lists it.
 */
export type MediaFile = {
    /**
     * repository-relative path
     */
    path: string;
    /**
     * `sha256:` plus 64 lowercase hexadecimal characters
     */
    sourceDigest: string;
    /**
     * the format, from the file's bytes
     */
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/avif" | "image/gif";
    /**
     * the file's size in bytes
     */
    byteLength: number;
};
export type Finding = import("../types.js").PublishActionFinding;
export type Problem = {
    reason: string;
    explanation: string;
};
export type OrderedReference = {
    order: number;
    reference: MediaReference;
};
export type OrderedFinding = {
    order: number;
    finding: Finding;
};
export type MediaLimits = {
    /**
     * largest admitted source image, in bytes
     */
    maxSourceBytes: number;
    /**
     * most distinct image files one publication may reference
     */
    maxDistinctImages: number;
    /**
     * most source bytes all referenced images may add up to
     */
    maxTotalBytes: number;
    /**
     * most distinct body images one document's `media[]` may list
     */
    maxImagesPerDocument: number;
};
