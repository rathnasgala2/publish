/**
 * PUB-M13: discriminate an `npm view <pkg>@<version> --json` outcome from
 * its **stdout alone**, never from stdout and stderr merged into one
 * stream.
 *
 * `release.yaml`'s publish step used to capture `npm view ... --json
 * 2>&1`. npm 11 writes its structured `{"error":{"code":...}}` document to
 * stdout but *also* writes human-readable `npm error ...` prose to stderr;
 * merging the two puts that prose before the JSON, so `JSON.parse` throws
 * and the extracted error code silently becomes `''`. `'' !== 'E404'` is
 * true, so a plain 404 -- the expected, common case for a package version
 * this release is about to publish for the first time -- was
 * indistinguishable from a registry 5xx, a network timeout, an auth
 * failure or a rate limit, and the workflow aborted the whole
 * dependency-ordered publish loop on every legitimate first publish. This
 * module captures stdout and stderr as two separate strings and classifies
 * from stdout only, so a stderr preamble can never corrupt the parse.
 *
 * @typedef {{ status: 'published' }} PublishedResult
 * @typedef {{ status: 'unpublished' }} UnpublishedResult
 * @typedef {{ status: 'error', message: string }} ErrorResult
 * @typedef {PublishedResult | UnpublishedResult | ErrorResult} NpmViewStatus
 */

import { spawnSync } from 'node:child_process';

import { runIfMain } from '../run-if-main.mjs';

/**
 * Classify a completed `npm view <pkg>@<version> --json` invocation from
 * its exit status and separately captured stdout/stderr.
 *
 * - Exit status `0`: the version resolved, so it is already published.
 * - Non-zero exit with stdout parsing as JSON whose `error.code` is
 *   `'E404'`: the version does not exist yet, so it is unpublished and
 *   safe to publish.
 * - Anything else (stdout is not JSON, or `error.code` is something other
 *   than `'E404'`, such as a 5xx, a timeout, an auth failure or a rate
 *   limit): an error the caller must treat as fatal, never as
 *   "unpublished".
 *
 * @param {{ exitStatus: number, stdout: string, stderr: string }} result
 *   the process result to classify, with stdout and stderr kept separate
 * @returns {NpmViewStatus} the classified outcome
 */
export function classifyNpmViewResult({ exitStatus, stdout, stderr }) {
  if (exitStatus === 0) {
    return { status: 'published' };
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const message = stderr.trim() !== '' ? stderr.trim() : stdout.trim();
    return {
      status: 'error',
      message:
        message !== ''
          ? message
          : `npm view exited ${exitStatus} with no output on either stream`,
    };
  }

  const code = /** @type {{ error?: { code?: unknown } } | null} */ (parsed)
    ?.error?.code;
  if (code === 'E404') {
    return { status: 'unpublished' };
  }

  const message = stderr.trim() !== '' ? stderr.trim() : JSON.stringify(parsed);
  return { status: 'error', message };
}

/**
 * Run `npm view <packageName>@<version> --json`, keeping stdout and
 * stderr in separate buffers, and classify the outcome.
 *
 * @param {string} packageName the published package name, e.g.
 *   `@rathnasgala2/adapter-protocol`
 * @param {string} version the exact version to look up, e.g. `0.2.1`
 * @returns {NpmViewStatus} the classified outcome
 */
export function npmViewStatus(packageName, version) {
  const result = spawnSync(
    'npm',
    ['view', `${packageName}@${version}`, '--json'],
    { encoding: 'utf8' },
  );
  return classifyNpmViewResult({
    exitStatus: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  });
}

/**
 * CLI entry point: `node scripts/release/npm-view-status.mjs <package> <version>`.
 * Prints the classified `NpmViewStatus` as one JSON line on stdout and
 * exits non-zero only for `status: 'error'`, so a caller can branch on
 * exit status alone or parse the JSON for the reason.
 *
 * @returns {Promise<void>} resolves once the status has been printed
 */
async function main() {
  const [packageName, version] = process.argv.slice(2);
  if (packageName === undefined || version === undefined) {
    process.stderr.write(
      'usage: node scripts/release/npm-view-status.mjs <package-name> <version>\n',
    );
    process.exitCode = 2;
    return;
  }

  const result = npmViewStatus(packageName, version);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === 'error') {
    process.exitCode = 1;
  }
}

await runIfMain(import.meta.url, main);
