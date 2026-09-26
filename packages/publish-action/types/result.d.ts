/**
 * @param {readonly Finding[]} findings candidate findings
 * @returns {boolean} whether any finding blocks
 */
export function hasBlockingFinding(findings: readonly Finding[]): boolean;
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
export function exitCodeForFindings(findings: readonly Finding[]): number;
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
 * @returns {import('./types.js').ResultEnvelope} the frozen envelope
 */
export function buildResultEnvelope(fields: {
    command: "validate" | "build" | "preview" | "publish";
    resultCode: string;
    exitCode: number;
    findings?: readonly Finding[];
    manifestPath?: string;
    manifestDigest?: string;
    artifactDirectory?: string;
    artifactDigest?: string;
    routeCount?: number;
    byteCount?: string;
    previewUrl?: string;
}): import("./types.js").ResultEnvelope;
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
export function classifyFindings(findings: readonly Finding[]): {
    resultCode: string;
    exitCode: number;
};
export { EXIT_CODES };
/**
 * A finding, in this package's own shared shape (`code`/`severity`/`detail`
 * required, everything else optional) -- the same shape every layer this
 * package composes (`publish-kernel`'s `KernelFinding`, `adapter-protocol`'s
 * `ProtocolFinding`, this package's own `RepositoryIntakeError`) already
 * uses, aliased here from the published declaration surface so both stay in
 * sync.
 */
export type Finding = import("./types.js").PublishActionFinding;
import { EXIT_CODES } from './constants.js';
