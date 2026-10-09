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
export function referencePathProblem(value: string): {
    reason: "EXTERNAL_ADDRESS" | "NOT_A_REPOSITORY_PATH";
    explanation: string;
} | null;
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
export function resolveMediaReferences({ repositoryDirectory, assetRoots, references, limits, }: {
    repositoryDirectory: string;
    assetRoots: readonly {
        path: string;
    }[] | undefined;
    references: readonly MediaReference[];
    limits?: Readonly<MediaLimits> | undefined;
}): Promise<{
    assets: MediaAsset[];
    findings: Finding[];
}>;
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
     * the reference as written; `null` when the image has no usable path
     */
    path: string | null;
    /**
     * the image's alternative text, for messages
     */
    alt: string;
};
export type MediaAsset = {
    /**
     * repository-relative path
     */
    path: string;
    /**
     * `sha256:` plus 64 lowercase hexadecimal characters
     */
    sourceDigest: string;
};
export type Finding = import("../types.js").PublishActionFinding;
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
};
