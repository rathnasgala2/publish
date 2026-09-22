/**
 * Minimal `argv` parsing shared by every `npx` subcommand: no dependency,
 * no `bin` named `gala`, no CLI grammar beyond DEC-006's borrowed
 * subcommand semantics (S2 brief section 5).
 *
 * @module
 */

import path from 'node:path';

/**
 * @param {readonly string[]} argv arguments after the subcommand name
 * @param {string} cwd the process working directory
 * @returns {{
 *   repositoryDirectory: string,
 *   outputDirectory: string,
 *   workDirectory: string
 * }} the parsed, defaulted, absolute-path options
 */
export function parseCliOptions(argv, cwd) {
  /** @type {Record<string, string>} */
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== undefined && token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[index + 1];
      if (value !== undefined) {
        flags[key] = value;
      }
      index += 1;
    }
  }
  const repositoryDirectory = path.resolve(cwd, flags.repository ?? '.');
  const outputDirectory = path.resolve(
    cwd,
    flags.output ?? path.join(repositoryDirectory, '.gala', 'output'),
  );
  const workDirectory = path.resolve(
    cwd,
    flags.work ?? path.join(repositoryDirectory, '.gala', 'work'),
  );
  return { repositoryDirectory, outputDirectory, workDirectory };
}
