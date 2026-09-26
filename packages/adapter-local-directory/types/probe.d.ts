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
export function runFilesystemProbe(root: string, token: string): Promise<{
    sameRootAndReleaseDevice: boolean;
    rootAndAncestorsNoFollow: boolean;
    atomicSymlinkReplacement: boolean;
    exclusiveControlPublication: boolean;
    directoryFsync: boolean;
    readerIterations: number;
    replacementIterations: number;
    unexpectedReaderOutcomes: number;
    transcriptDigest: string;
}>;
/** Reduced (documented) replacement-iteration count for the live probe. */
export const PROBE_REPLACEMENT_ITERATIONS: 64;
