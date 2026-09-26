/**
 * `describeCapabilities`: the adapter's exact `adapter-capability:2.0.0`
 * declaration for the `local-directory` row, computed live against the
 * destination root.
 *
 * @param {LocalDirectoryDestination} destination the destination whose root
 *   this declaration is bound to
 * @returns {Promise<Readonly<Record<string, unknown>>>} the validated
 *   capability declaration
 */
export function describeCapabilities(destination: LocalDirectoryDestination): Promise<Readonly<Record<string, unknown>>>;
/**
 * `inspectDestination`: report the destination's currently active
 * generation (if any) and its retained on-disk generation history, without
 * mutating anything beyond idempotent bootstrap.
 *
 * @param {LocalDirectoryDestination} destination the destination to inspect
 * @returns {Promise<Readonly<{
 *   currentGenerationId: string | null,
 *   retainedHistory: readonly Readonly<Record<string, unknown>>[],
 *   releaseGenerationsOnDisk: readonly string[]
 * }>>} the inspection result
 */
export function inspectDestination(destination: LocalDirectoryDestination): Promise<Readonly<{
    currentGenerationId: string | null;
    retainedHistory: readonly Readonly<Record<string, unknown>>[];
    releaseGenerationsOnDisk: readonly string[];
}>>;
/**
 * `preflight`: validate every declared manifest path with the on-disk
 * symlink-escape probe `publish-kernel`'s path-containment module defers to
 * this adapter, and report the destination's current generation for
 * concurrency fencing.
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   entries: readonly {path: string}[],
 *   expectedGenerationId?: string
 * }} input the preflight input; `expectedGenerationId`, when supplied, is
 *   an activation fence value (a generation identity or the protocol's
 *   `EXPECT_NOTHING_SERVED` sentinel) and is validated as one. `null` is
 *   refused, and a destination that serves nothing no longer silently
 *   satisfies an expectation of some generation (LOCAL-47).
 * @returns {Promise<Readonly<{
 *   verdict: 'proceed' | 'refuse',
 *   observedGenerationId: string | null,
 *   findings: readonly string[]
 * }>>} the preflight result
 */
export function preflight(input: {
    destination: LocalDirectoryDestination;
    entries: readonly {
        path: string;
    }[];
    expectedGenerationId?: string;
}): Promise<Readonly<{
    verdict: "proceed" | "refuse";
    observedGenerationId: string | null;
    findings: readonly string[];
}>>;
/**
 * `stage`: write a candidate generation's complete file set into a private,
 * unreachable staging directory (`staging: unreachable-generation`), plus
 * the generation marker. Idempotent: replaying the same
 * `operationId`/`attemptId`/`generationId` returns the existing stage
 * without rewriting bytes.
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   files: readonly StagedFile[]
 * }} input the stage input
 * @returns {Promise<Readonly<{
 *   stageToken: string,
 *   stagedPath: string,
 *   fileCount: number,
 *   byteCount: string,
 *   idempotent: boolean
 * }>>} the stage result
 */
export function stage(input: {
    destination: LocalDirectoryDestination;
    operationId: string;
    attemptId: string;
    idempotencyKey: string;
    generationId: string;
    artifactId: string;
    artifactDigest: string;
    files: readonly StagedFile[];
}): Promise<Readonly<{
    stageToken: string;
    stagedPath: string;
    fileCount: number;
    byteCount: string;
    idempotent: boolean;
}>>;
/**
 * `activate`: promote a staged generation to `current` under the
 * `expected-generation` concurrency fence (`activation: pointer-swap`).
 * Never overwrites blindly: when the destination's currently observed
 * generation disagrees with `expectedCurrentGenerationId`, the candidate
 * reconciles instead of activating.
 *
 * `expectedCurrentGenerationId` is mandatory and is either a generation
 * identity or the protocol's `EXPECT_NOTHING_SERVED` sentinel. `null` and
 * `undefined` are refused with `EXPECTED_GENERATION_FENCE_INVALID`: under
 * adapter protocol 2.1.0 there is no value that silently disables the
 * activation fence (LOCAL-47).
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   stageToken: string,
 *   generationId: string,
 *   expectedCurrentGenerationId: string,
 *   expectedArtifactDigest?: string,
 *   crashInjectionHook?: () => void | Promise<void>
 * }} input the activate input; when `expectedArtifactDigest` is supplied,
 *   the staged bytes are re-walked and digested before promotion and
 *   activation refuses (never promoting a partial or tampered stage) on
 *   disagreement. `crashInjectionHook`, when supplied, is awaited after
 *   staging is durably committed into `releases/<generationId>` but
 *   strictly before the `current` pointer swap; a caller (only ever a
 *   conformance test — no production caller ever supplies this) uses it to
 *   prove a genuine interruption at that boundary never serves a partial
 *   generation. If it throws, `activate` propagates the error without
 *   swapping the pointer.
 * @returns {Promise<Readonly<{
 *   decision: 'activate' | 'reconcile',
 *   generationId: string,
 *   previousGenerationId: string | null,
 *   idempotent: boolean
 * }>>} the activation decision
 */
export function activate(input: {
    destination: LocalDirectoryDestination;
    stageToken: string;
    generationId: string;
    expectedCurrentGenerationId: string;
    expectedArtifactDigest?: string;
    crashInjectionHook?: () => void | Promise<void>;
}): Promise<Readonly<{
    decision: "activate" | "reconcile";
    generationId: string;
    previousGenerationId: string | null;
    idempotent: boolean;
}>>;
/**
 * `observe`: verify the currently served generation against its manifest-
 * equal artifact digest and its generation marker
 * (`providerInventoryAssurance: complete-artifact-digest`).
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   generationId: string,
 *   expectedArtifactDigest: string
 * }} input the observe input
 * @returns {Promise<Readonly<{
 *   verified: boolean,
 *   observedArtifactDigest: string,
 *   currentGenerationId: string | null,
 *   markerValid: boolean,
 *   findings: readonly string[]
 * }>>} the observation result
 */
export function observe(input: {
    destination: LocalDirectoryDestination;
    generationId: string;
    expectedArtifactDigest: string;
}): Promise<Readonly<{
    verified: boolean;
    observedArtifactDigest: string;
    currentGenerationId: string | null;
    markerValid: boolean;
    findings: readonly string[];
}>>;
/**
 * `cleanupStaged`: remove exactly this operation's private staging
 * scratch directory, never touching `current`, a selected release or
 * another operation's staging directory. When `generationId` is also
 * supplied, this additionally recovers an *abandoned* release directory
 * left behind by an activation interrupted after staging completed (the
 * `releases/<generationId>` rename already happened) but before the
 * pointer swap: that directory is only ever removed when it is neither the
 * currently active generation nor present in the retained
 * (activation-certified) history, so a genuinely completed activation can
 * never be cleaned up by this path.
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   stageToken: string,
 *   generationId?: string
 * }} input the cleanup input
 * @returns {Promise<Readonly<{removed: boolean}>>} whether the staging
 *   scratch directory, the abandoned release directory, or both were
 *   present and removed
 */
export function cleanupStaged(input: {
    destination: LocalDirectoryDestination;
    stageToken: string;
    generationId?: string;
}): Promise<Readonly<{
    removed: boolean;
}>>;
/**
 * `rollback`: `rollback: reupload` semantics — stage a fresh copy of a
 * retained prior generation's bytes under a new generation identity, then
 * activate it through the ordinary pointer-swap path. Refuses before any
 * mutation when the target generation is not physically retained on disk.
 *
 * @param {{
 *   destination: LocalDirectoryDestination,
 *   targetGenerationId: string,
 *   newGenerationId: string,
 *   newArtifactId: string,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string
 * }} input the rollback input
 * @returns {Promise<Readonly<{
 *   decision: 'activate' | 'reconcile',
 *   generationId: string,
 *   previousGenerationId: string | null,
 *   idempotent: boolean
 * }>>} the activation decision for the reuploaded generation
 */
export function rollback(input: {
    destination: LocalDirectoryDestination;
    targetGenerationId: string;
    newGenerationId: string;
    newArtifactId: string;
    operationId: string;
    attemptId: string;
    idempotencyKey: string;
}): Promise<Readonly<{
    decision: "activate" | "reconcile";
    generationId: string;
    previousGenerationId: string | null;
    idempotent: boolean;
}>>;
/** This package's runtime status: fully implemented per S2-T17. */
/**
 * Compute the same `GALA-ARTIFACT-V2 ` artifact digest `stage`/`activate`/
 * `observe` verify against, directly from an in-memory file set. Exported
 * so a caller (a test fixture, `publish-action`'s composition root, or the
 * conformance kit) can compute the correct `artifactDigest` to pass into
 * `stage` for a given file set, without duplicating the digest formula.
 *
 * @param {readonly StagedFile[]} files the complete file set
 * @returns {string} the `GALA-ARTIFACT-V2 ` artifact digest
 */
export function computeArtifactDigest(files: readonly StagedFile[]): string;
export { ADAPTER_VERSION } from "./capability.js";
export const PACKAGE_STATUS: Readonly<{
    name: "@rathnasgala2/adapter-local-directory";
    implemented: true;
    implementingTask: "S2-T17";
}>;
export type LocalDirectoryDestination = Readonly<{
    root: string;
}>;
export type StagedFile = Readonly<{
    path: string;
    bytes: Buffer;
}>;
export { EXPECT_NOTHING_SERVED, fenceFor, generateUuidV7 } from "@rathnasgala2/adapter-protocol";
