#!/usr/bin/env node
/**
 * `npx @rathnasgala2/publish-action <validate|build|preview>`: the local
 * entry point. No `bin` named `gala`, no global executable, no `publish`
 * subcommand (S2 brief section 5: "a local author previews locally and
 * deploys through the Action"). Machine output goes to stdout as one closed
 * result envelope; human diagnostics and progress go to stderr; color and
 * interactivity disable automatically outside a terminal (`preview`'s human
 * progress line only, since this package never prints ANSI color codes to
 * begin with).
 *
 * @module
 */

import { parseCliOptions } from '../cli-options.js';
import { runValidate } from '../commands/validate.js';
import { runBuild } from '../commands/build.js';
import { runPreview } from '../commands/preview.js';
import { EXIT_CODES } from '../constants.js';

const KNOWN_SUBCOMMANDS = Object.freeze(['validate', 'build', 'preview']);

/**
 * @param {readonly string[]} argv `process.argv.slice(2)`
 * @param {string} cwd `process.cwd()`
 * @returns {Promise<{envelope: Record<string, unknown>, keepAlive?: () => Promise<void>}>}
 *   the result envelope, plus (only for a successful `preview`) a callback
 *   that resolves once the preview server has stopped
 */
export async function runCli(argv, cwd) {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || !KNOWN_SUBCOMMANDS.includes(subcommand)) {
    return {
      envelope: {
        schemaId: 'urn:gala:publish-action:result:1',
        command: subcommand ?? null,
        resultCode: 'MISSING_DEPENDENCY',
        exitCode: EXIT_CODES.MISSING_DEPENDENCY,
        findings: [
          {
            code: 'UNKNOWN_SUBCOMMAND',
            severity: 'SOURCE_ERROR',
            detail: `Unknown subcommand "${subcommand ?? ''}". Expected one of: ${KNOWN_SUBCOMMANDS.join(', ')}.`,
            recovery:
              'Run "npx @rathnasgala2/publish-action <validate|build|preview>".',
            overridable: false,
          },
        ],
      },
    };
  }

  const options = parseCliOptions(rest, cwd);

  if (subcommand === 'validate') {
    return { envelope: await runValidate(options) };
  }
  if (subcommand === 'build') {
    const result = await runBuild(options);
    return { envelope: result };
  }

  const { envelope, server } = await runPreview(options);
  if (!server) {
    return { envelope };
  }
  process.stderr.write(
    `Preview serving at ${envelope.previewUrl} (loopback only; Ctrl+C to stop)\n`,
  );
  return {
    envelope,
    keepAlive: () =>
      new Promise((resolve) => {
        const stop = async () => {
          await server.close();
          resolve();
        };
        process.once('SIGINT', () => void stop());
        process.once('SIGTERM', () => void stop());
      }),
  };
}

/* c8 ignore start -- process entry glue, exercised end-to-end by tests calling runCli directly */
async function main() {
  const { envelope, keepAlive } = await runCli(
    process.argv.slice(2),
    process.cwd(),
  );
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  if (
    envelope.findings &&
    /** @type {unknown[]} */ (envelope.findings).length > 0
  ) {
    process.stderr.write(`${JSON.stringify(envelope.findings, null, 2)}\n`);
  }
  if (keepAlive) {
    await keepAlive();
    process.exitCode = 0;
    return;
  }
  process.exitCode = /** @type {number} */ (envelope.exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${(error && error.stack) || String(error)}\n`);
    process.exitCode = 70;
  });
}
/* c8 ignore stop */
