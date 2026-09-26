#!/usr/bin/env node
/**
 * @param {readonly string[]} argv `process.argv.slice(2)`
 * @param {string} cwd `process.cwd()`
 * @returns {Promise<{envelope: Record<string, unknown>, keepAlive?: () => Promise<void>}>}
 *   the result envelope, plus (only for a successful `preview`) a callback
 *   that resolves once the preview server has stopped
 */
export function runCli(argv: readonly string[], cwd: string): Promise<{
    envelope: Record<string, unknown>;
    keepAlive?: () => Promise<void>;
}>;
