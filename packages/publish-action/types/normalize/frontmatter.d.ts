/**
 * Parse one bounded YAML frontmatter block under DEC-006's constrained
 * subset, failing closed on every forbidden construct.
 *
 * @param {string} yamlText the frontmatter block's raw text (without the
 *   `---` fence lines)
 * @returns {Record<string, unknown>} the parsed frontmatter, as a plain
 *   JSON-data-model object
 */
export function parseConstrainedYamlFrontmatter(yamlText: string): Record<string, unknown>;
/** A frontmatter block that violates DEC-006's constrained YAML subset. */
export class FrontmatterParseError extends Error {
    /**
     * @param {string} message human-readable summary
     * @param {string} reasonCode a stable machine-readable reason
     */
    constructor(message: string, reasonCode: string);
    reasonCode: string;
}
