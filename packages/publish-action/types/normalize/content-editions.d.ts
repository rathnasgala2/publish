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
export function editionSourceDigest(rawBody: string): string;
/**
 * Decide which editions of a build to keep.
 *
 * @param {readonly EditionCandidate[]} documents every document that is part
 *   of the build (articles, pages and editions), in build order
 * @returns {{dropped: Set<string>, warnings: Finding[]}} the paths of the
 *   editions to leave out and one warning for each
 */
export function evaluateEditions(documents: readonly EditionCandidate[]): {
    dropped: Set<string>;
    warnings: Finding[];
};
export type Finding = import("../types.js").PublishActionFinding;
export type EditionCandidate = {
    /**
     * repository-relative path of the document
     */
    relativePath: string;
    /**
     * the validated front matter
     */
    frontmatter: Record<string, any>;
    /**
     * the text after the closing front matter fence line, unmodified
     */
    rawBody: string;
};
