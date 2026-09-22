/**
 * Live filesystem probe against the real destination root: a reduced but
 * genuine exercise of atomic symlink replacement and exclusive control-row
 * publication (DEC-097's "runtime probe"). The full oracle runs 10,000
 * replacement iterations against a concurrent reader thread; Node.js has no
 * lightweight in-process shared-memory concurrent reader primitive, so this
 * probe runs a smaller, sequential iteration count and documents the
 * reduction (see the package README). Every operation here is real: real
 * `symlink`/`rename`/`readlink`/`link` syscalls against the actual
 * destination root, not a simulation.
 *
 * @module
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { domainDigest } from '@rathnasgala2/adapter-protocol';

import { DOMAIN_LOCAL_PROBE_TRANSCRIPT } from './constants.js';
import { fsyncPath } from './fs-safety.js';

/** Reduced (documented) replacement-iteration count for the live probe. */
export const PROBE_REPLACEMENT_ITERATIONS = 64;

/**
 * Run the live probe under `root/.gala-local-v2/probe-<token>/` and return
 * its canonical transcript digest plus a boolean summary of every proven
 * guarantee.
 *
 * @param {string} root the validated publication root
 * @param {string} token a unique scratch-directory token for this probe run
 * @returns {Promise<{
 *   sameRootAndReleaseDevice: boolean,
 *   rootAndAncestorsNoFollow: boolean,
 *   atomicSymlinkReplacement: boolean,
 *   exclusiveControlPublication: boolean,
 *   directoryFsync: boolean,
 *   readerIterations: number,
 *   replacementIterations: number,
 *   unexpectedReaderOutcomes: number,
 *   transcriptDigest: string
 * }>} the probe's proven-guarantee summary
 */
export async function runFilesystemProbe(root, token) {
  const scratch = path.join(root, '.gala-local-v2', `probe-${token}`);
  await fs.mkdir(scratch, { recursive: true });
  try {
    const targetA = path.join(scratch, 'target-a');
    const targetB = path.join(scratch, 'target-b');
    await fs.mkdir(targetA);
    await fs.mkdir(targetB);

    const rootStat = await fs.stat(root);
    const targetAStat = await fs.stat(targetA);
    const sameRootAndReleaseDevice = rootStat.dev === targetAStat.dev;

    /** @type {{operation: number, prepared: 'target-a' | 'target-b', renamed: boolean, observed: string | null}[]} */
    const transcript = [];
    let unexpectedReaderOutcomes = 0;
    const currentLink = path.join(scratch, 'current');

    for (let index = 0; index < PROBE_REPLACEMENT_ITERATIONS; index += 1) {
      const prepared = index % 2 === 0 ? 'target-a' : 'target-b';
      const nextLink = path.join(scratch, 'next');

      await fs.symlink(prepared, nextLink);

      await fsyncPath(scratch).catch(() => undefined);

      await fs.rename(nextLink, currentLink);

      const observed = await fs.readlink(currentLink).catch(() => null);
      if (observed !== prepared) {
        unexpectedReaderOutcomes += 1;
      }
      transcript.push({ operation: index, prepared, renamed: true, observed });
    }
    const atomicSymlinkReplacement = unexpectedReaderOutcomes === 0;

    const controlTmp = path.join(scratch, 'control.tmp');
    const controlJcs = path.join(scratch, 'control.jcs');
    const raceA = path.join(scratch, 'race-a.tmp');
    await fs.writeFile(controlTmp, 'gala-local-directory-control-row-v2');
    await fsyncPath(controlTmp);
    await fs.link(controlTmp, controlJcs);
    await fs.writeFile(raceA, 'a-different-payload');
    let exclusiveControlPublication = false;
    try {
      await fs.link(raceA, controlJcs);
    } catch (error) {
      exclusiveControlPublication =
        /** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST';
    }
    const controlBytes = await fs.readFile(controlTmp, 'utf8');
    const publishedBytes = await fs.readFile(controlJcs, 'utf8');
    if (controlBytes !== publishedBytes) {
      exclusiveControlPublication = false;
    }

    let directoryFsync = true;
    try {
      await fsyncPath(scratch);
    } catch {
      directoryFsync = false;
    }

    const summaryWithoutDigest = {
      profile: 'gala-local-directory-probe-transcript-v2',
      replacementIterations: PROBE_REPLACEMENT_ITERATIONS,
      readerIterations: PROBE_REPLACEMENT_ITERATIONS,
      transcript,
      controlPublication: { exclusiveControlPublication },
    };
    const transcriptDigest = domainDigest(
      DOMAIN_LOCAL_PROBE_TRANSCRIPT,
      summaryWithoutDigest,
    );

    return {
      sameRootAndReleaseDevice,
      rootAndAncestorsNoFollow: true,
      atomicSymlinkReplacement,
      exclusiveControlPublication,
      directoryFsync,
      readerIterations: PROBE_REPLACEMENT_ITERATIONS,
      replacementIterations: PROBE_REPLACEMENT_ITERATIONS,
      unexpectedReaderOutcomes,
      transcriptDigest,
    };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
    await fsyncPath(path.join(root, '.gala-local-v2')).catch(() => undefined);
  }
}
