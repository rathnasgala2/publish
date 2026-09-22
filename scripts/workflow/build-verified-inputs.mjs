/**
 * `prep`: build the deterministic verified-input carrier from the checked
 * out, operation-bound source revision.
 *
 * This is the only job that ever sees a repository checkout. Everything the
 * build step is allowed to read must travel inside this one carrier — and
 * so must every fact only the checkout can state: besides the bound commit,
 * the commit's tree object id (`sourceTree`) and its committer instant
 * (`buildEpoch`, DEC-097 section 5), which the network-disabled build
 * sandbox cannot recover because it receives the source tree without
 * `.git`. Both are read from the checkout's own git object database for
 * exactly `GITHUB_SHA`, and recorded as `null` — never a stand-in — when
 * that database is unavailable, so a later job names them missing rather
 * than inventing them.
 */

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  carrierDigest,
  encodeCarrier,
  parseOptions,
  requireOption,
  walkDirectory,
} from './carrier.mjs';
import { runIfMain } from '../run-if-main.mjs';

const execFileAsync = promisify(execFile);

/**
 * Read the tree object id and the committer instant of one commit from the
 * checkout's git object database.
 *
 * @param {string} source the checkout directory
 * @param {string | undefined} commit the bound commit (`GITHUB_SHA`)
 * @returns {Promise<{sourceTree: string | null, buildEpoch: string | null}>}
 *   the tagged tree id and the rfc3339 committer instant, each `null` when
 *   git cannot state it
 */
export async function readCommitFacts(source, commit) {
  if (commit === undefined || !/^[0-9a-f]{40}$/u.test(commit)) {
    return { sourceTree: null, buildEpoch: null };
  }
  try {
    const tree = (
      await execFileAsync(
        'git',
        ['-C', source, 'rev-parse', `${commit}^{tree}`],
        { timeout: 5000 },
      )
    ).stdout.trim();
    const epoch = (
      await execFileAsync(
        'git',
        ['-C', source, 'show', '-s', '--format=%ct', commit],
        { timeout: 5000 },
      )
    ).stdout.trim();
    if (!/^[0-9a-f]{40}$/u.test(tree) || !/^\d+$/u.test(epoch)) {
      return { sourceTree: null, buildEpoch: null };
    }
    return {
      sourceTree: `sha1:${tree}`,
      buildEpoch: new Date(Number(epoch) * 1000).toISOString(),
    };
  } catch {
    return { sourceTree: null, buildEpoch: null };
  }
}

/**
 * @returns {Promise<void>} resolves once the carrier has been written
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const source = requireOption(options, 'source');
  const out = requireOption(options, 'out');

  const files = (await walkDirectory(source)).filter(
    (file) => !file.path.startsWith('.git/'),
  );
  const commit = await readCommitFacts(source, process.env.GITHUB_SHA);
  const carrier = encodeCarrier({
    purpose: 'verified-inputs',
    metadata: {
      sourceCommit: process.env.GITHUB_SHA ?? null,
      workflowTriggerCommit: process.env.GITHUB_SHA ?? null,
      sourceTree: commit.sourceTree,
      buildEpoch: commit.buildEpoch,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      fileCount: files.length,
    },
    files: files.map((file) => ({
      path: `source/${file.path}`,
      bytes: file.bytes,
    })),
  });
  await writeFile(out, carrier);
  process.stdout.write(
    `verified-inputs carrier: ${files.length} file(s), ${carrier.byteLength} bytes, ${carrierDigest(carrier)}\n`,
  );
}

await runIfMain(import.meta.url, main);
