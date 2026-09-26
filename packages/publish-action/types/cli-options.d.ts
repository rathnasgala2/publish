/**
 * @param {readonly string[]} argv arguments after the subcommand name
 * @param {string} cwd the process working directory
 * @returns {{
 *   repositoryDirectory: string,
 *   outputDirectory: string,
 *   workDirectory: string
 * }} the parsed, defaulted, absolute-path options
 */
export function parseCliOptions(argv: readonly string[], cwd: string): {
    repositoryDirectory: string;
    outputDirectory: string;
    workDirectory: string;
};
