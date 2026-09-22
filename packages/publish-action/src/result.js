/**
 * The one closed machine-readable result envelope every subcommand and the
 * Action entry emits, plus the DEC-006 exit-code mapping (S2-T20
 * deliverable (2): "Machine output goes to stdout as one closed result
 * envelope, human diagnostics and progress to stderr.").
 *
 * @module
 */

import { EXIT_CODES } from './constants.js';

/**
 * A finding, in this package's own shared shape (`code`/`severity`/`detail`
 * required, everything else optional) -- the same shape every layer this
 * package composes (`publish-kernel`'s `KernelFinding`, `adapter-protocol`'s
 * `ProtocolFinding`, this package's own `RepositoryIntakeError`) already
 * uses, aliased here from the published declaration surface so both stay in
 * sync.
 *
 * @typedef {import('./index.d.ts').PublishActionFinding} Finding
 */

const BLOCKING_SEVERITIES = Object.freeze([
  'SOURCE_ERROR',
  'ARTIFACT_SAFETY_ERROR',
  'TARGET_CONSTRAINT_ERROR',
]);

/**
 * @param {readonly Finding[]} findings candidate findings
 * @returns {boolean} whether any finding blocks
 */
export function hasBlockingFinding(findings) {
  return findings.some((entry) =>
    BLOCKING_SEVERITIES.includes(/** @type {string} */ (entry.severity)),
  );
}

/**
 * Choose the exit code for a successful (possibly findings-bearing) run.
 *
 * @param {readonly Finding[]} findings the run's findings
 * @returns {number} `0` when there are none, `1` when there are only
 *   non-blocking ones is impossible by construction (callers only reach this
 *   path once every blocking condition has already been handled as a
 *   distinct exit code) — findings reaching here are always exactly the
 *   `WARNING`/`ADVISORY` set, so this returns `EXIT_CODES.FINDINGS` whenever
 *   any finding is present and `EXIT_CODES.SUCCESS` otherwise.
 */
export function exitCodeForFindings(findings) {
  return findings.length === 0 ? EXIT_CODES.SUCCESS : EXIT_CODES.FINDINGS;
}

/**
 * Build the closed result envelope.
 *
 * @param {{
 *   command: 'validate' | 'build' | 'preview' | 'publish',
 *   resultCode: string,
 *   exitCode: number,
 *   findings?: readonly Finding[],
 *   manifestPath?: string,
 *   manifestDigest?: string,
 *   artifactDirectory?: string,
 *   artifactDigest?: string,
 *   routeCount?: number,
 *   byteCount?: string,
 *   previewUrl?: string
 * }} fields the envelope's fields
 * @returns {import('./index.d.ts').ResultEnvelope} the frozen envelope
 */
export function buildResultEnvelope(fields) {
  return Object.freeze({
    schemaId: 'urn:gala:publish-action:result:1',
    command: fields.command,
    resultCode: fields.resultCode,
    exitCode: fields.exitCode,
    findings: Object.freeze([...(fields.findings ?? [])]),
    ...(fields.manifestPath !== undefined
      ? { manifestPath: fields.manifestPath }
      : {}),
    ...(fields.manifestDigest !== undefined
      ? { manifestDigest: fields.manifestDigest }
      : {}),
    ...(fields.artifactDirectory !== undefined
      ? { artifactDirectory: fields.artifactDirectory }
      : {}),
    ...(fields.artifactDigest !== undefined
      ? { artifactDigest: fields.artifactDigest }
      : {}),
    ...(fields.routeCount !== undefined
      ? { routeCount: fields.routeCount }
      : {}),
    ...(fields.byteCount !== undefined ? { byteCount: fields.byteCount } : {}),
    ...(fields.previewUrl !== undefined
      ? { previewUrl: fields.previewUrl }
      : {}),
  });
}

/**
 * Choose a `{resultCode, exitCode}` pair for a finding set that may include
 * blocking findings, following DEC-006's exit-code vocabulary: a
 * `TARGET_CONSTRAINT_ERROR` (the destination/adapter cannot satisfy the
 * request, e.g. an unimplemented adapter selection) maps to
 * `INCOMPATIBLE_CONTRACT`; a `SOURCE_ERROR`/`ARTIFACT_SAFETY_ERROR` (the
 * author input, or the artifact built from it, is unsafe) maps to
 * `UNSAFE_INPUT`; a purely non-blocking finding set (`WARNING`/`ADVISORY`
 * only) maps to `FINDINGS`; an empty set maps to `SUCCESS`.
 *
 * @param {readonly Finding[]} findings the complete finding set
 * @returns {{resultCode: string, exitCode: number}} the chosen pair
 */
export function classifyFindings(findings) {
  if (findings.some((entry) => entry.severity === 'TARGET_CONSTRAINT_ERROR')) {
    return {
      resultCode: 'INCOMPATIBLE_CONTRACT',
      exitCode: EXIT_CODES.INCOMPATIBLE_CONTRACT,
    };
  }
  if (
    findings.some(
      (entry) =>
        entry.severity === 'SOURCE_ERROR' ||
        entry.severity === 'ARTIFACT_SAFETY_ERROR',
    )
  ) {
    return { resultCode: 'UNSAFE_INPUT', exitCode: EXIT_CODES.UNSAFE_INPUT };
  }
  if (findings.length > 0) {
    return { resultCode: 'FINDINGS', exitCode: EXIT_CODES.FINDINGS };
  }
  return { resultCode: 'SUCCESS', exitCode: EXIT_CODES.SUCCESS };
}

export { EXIT_CODES };
