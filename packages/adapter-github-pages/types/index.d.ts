/**
 * `describeCapabilities`: the exact `github-pages` capability row.
 *
 * @param {PagesDestination} destination the bound destination
 * @returns {Promise<Readonly<Record<string, unknown>>>} the declaration
 */
export function describeCapabilities(destination: PagesDestination): Promise<Readonly<Record<string, unknown>>>;
/**
 * `inspectDestination`: report the currently served generation from a live
 * public read plus the provider's own site state, never from memory.
 *
 * @param {PagesDestination} destination the bound destination
 * @returns {Promise<Readonly<{
 *   currentGenerationId: string | null,
 *   retainedHistory: readonly Readonly<Record<string, unknown>>[],
 *   releaseGenerationsOnDisk: readonly string[],
 *   providerSiteObserved: boolean,
 *   findings: readonly string[]
 * }>>} the inspection result
 */
export function inspectDestination(destination: PagesDestination): Promise<Readonly<{
    currentGenerationId: string | null;
    retainedHistory: readonly Readonly<Record<string, unknown>>[];
    releaseGenerationsOnDisk: readonly string[];
    providerSiteObserved: boolean;
    findings: readonly string[];
}>>;
/**
 * `preflight`: check every declared route against the portable path rules
 * and the reserved marker coordinate, and report the currently served
 * generation for fencing. No provider mutation of any kind occurs here.
 *
 * @param {{
 *   destination: PagesDestination,
 *   entries: readonly {path: string}[],
 *   expectedGenerationId?: string
 * }} input the preflight input
 * @returns {Promise<Readonly<{
 *   verdict: 'proceed' | 'refuse',
 *   observedGenerationId: string | null,
 *   findings: readonly string[]
 * }>>} the preflight result
 */
export function preflight(input: {
    destination: PagesDestination;
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
 * `stage`: build the deterministic Pages carrier and publish it through the
 * caller-supplied Actions-artifact publisher. Nothing public changes here —
 * `staging: private` is literal: the carrier is an Actions artifact that no
 * public origin serves.
 *
 * @param {{
 *   destination: PagesDestination,
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
 *   carrierDigest: string,
 *   pagesArtifactId: string,
 *   idempotent: boolean
 * }>>} the stage result
 */
export function stage(input: {
    destination: PagesDestination;
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
    carrierDigest: string;
    pagesArtifactId: string;
    idempotent: boolean;
}>>;
/**
 * Resolve the prior attempt of an unresolved Pages fence before any current
 * carrier is uploaded or created. Exposed separately so the deploy script
 * can run the DEC-097 section 6.2 precheck *before* it calls `stage` (this
 * package's carrier upload happens in `stage`); `activate` runs it again,
 * ahead of any current create, when it is given recovery inputs.
 *
 * @param {{
 *   destination: PagesDestination,
 *   pagesRecovery: Readonly<Record<string, unknown>>
 * }} input the recovery input
 * @returns {Promise<import('./recovery.js').PriorAttemptObservation>} the
 *   truthful prior-attempt observation
 */
export function recoverPriorAttempt(input: {
    destination: PagesDestination;
    pagesRecovery: Readonly<Record<string, unknown>>;
}): Promise<import("./recovery.js").PriorAttemptObservation>;
/**
 * `activate`: create exactly one Pages deployment for a staged carrier and
 * poll it to a terminal status (`activation: provider-promotion`).
 *
 * `expectedCurrentGenerationId` is the adapter-protocol `2.1.0` fence:
 * either a generation identity or the explicit `EXPECT_NOTHING_SERVED`
 * sentinel. `null` and `undefined` are refused with
 * `EXPECTED_GENERATION_FENCE_INVALID` (LOCAL-47) — there is no unfenced
 * activation. The check itself is a read-then-compare performed immediately
 * before the create call: honest best effort, not a provider fence, because
 * GitHub Pages exposes no compare-and-set on activation, which is exactly
 * why this adapter declares `concurrency: none`.
 *
 * In `pages-reconciliation-recovery` mode the prior attempt is resolved
 * first, before any current create, per DEC-097 section 6.2.
 *
 * @param {{
 *   destination: PagesDestination,
 *   stageToken: string,
 *   generationId: string,
 *   expectedCurrentGenerationId: string,
 *   expectedArtifactDigest?: string,
 *   pagesOidcToken?: string,
 *   pagesOidcClaims?: import('./oidc.js').PagesOidcExpectation,
 *   mode?: string,
 *   pagesRecovery?: Readonly<Record<string, unknown>>,
 *   crashInjectionHook?: () => void | Promise<void>
 * }} input the activate input; `crashInjectionHook`, when supplied (only
 *   ever by a conformance fixture), is awaited after the carrier is durably
 *   published but strictly before the create-deployment call
 * @returns {Promise<Readonly<Record<string, unknown>>>} the decision
 */
export function activate(input: {
    destination: PagesDestination;
    stageToken: string;
    generationId: string;
    expectedCurrentGenerationId: string;
    expectedArtifactDigest?: string;
    pagesOidcToken?: string;
    pagesOidcClaims?: import("./oidc.js").PagesOidcExpectation;
    mode?: string;
    pagesRecovery?: Readonly<Record<string, unknown>>;
    crashInjectionHook?: () => void | Promise<void>;
}): Promise<Readonly<Record<string, unknown>>>;
/**
 * `observe`: verify the activated generation through credential-free public
 * reads. `providerInventoryAssurance` is `none`, so this verifies exactly
 * the routes this run staged plus the marker; it never claims the deployed
 * inventory is complete.
 *
 * @param {{
 *   destination: PagesDestination,
 *   generationId: string,
 *   expectedArtifactDigest: string
 * }} input the observe input
 * @returns {Promise<Readonly<{
 *   verified: boolean,
 *   observedArtifactDigest: string | null,
 *   currentGenerationId: string | null,
 *   markerValid: boolean,
 *   claimsCompleteInventory: false,
 *   findings: readonly string[]
 * }>>} the observation result
 */
export function observe(input: {
    destination: PagesDestination;
    generationId: string;
    expectedArtifactDigest: string;
}): Promise<Readonly<{
    verified: boolean;
    observedArtifactDigest: string | null;
    currentGenerationId: string | null;
    markerValid: boolean;
    claimsCompleteInventory: false;
    findings: readonly string[];
}>>;
/**
 * `cleanupStaged`: drop this operation's staged carrier from run-scoped
 * memory and, when an abandoned generation is named, cancel its in-flight
 * deployment through the cataloged cancel call. It never cancels or
 * disturbs a generation that is currently served or retained.
 *
 * @param {{
 *   destination: PagesDestination,
 *   stageToken: string,
 *   generationId?: string
 * }} input the cleanup input
 * @returns {Promise<Readonly<{removed: boolean, cancelled: boolean}>>} whether
 *   staged state was removed and whether a deployment was cancelled
 */
export function cleanupStaged(input: {
    destination: PagesDestination;
    stageToken: string;
    generationId?: string;
}): Promise<Readonly<{
    removed: boolean;
    cancelled: boolean;
}>>;
/**
 * `rollback`: `rollback: reupload` semantics. GitHub Pages cannot natively
 * re-promote a historical deployment, so a rollback stages a fresh carrier
 * for the selected historical content under a *new* generation identity and
 * activates it through the ordinary create/poll path.
 *
 * The historical bytes are not recoverable from the provider (Pages exposes
 * no artifact read-back), so the caller supplies them through `files`. The
 * run-scoped stage memory is used only when the target generation was
 * staged by this same run.
 *
 * @param {{
 *   destination: PagesDestination,
 *   targetGenerationId: string,
 *   newGenerationId: string,
 *   newArtifactId: string,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   files?: readonly StagedFile[],
 *   artifactDigest?: string,
 *   pagesOidcToken?: string,
 *   pagesOidcClaims?: import('./oidc.js').PagesOidcExpectation
 * }} input the rollback input
 * @returns {Promise<Readonly<Record<string, unknown>>>} the activation decision
 */
export function rollback(input: {
    destination: PagesDestination;
    targetGenerationId: string;
    newGenerationId: string;
    newArtifactId: string;
    operationId: string;
    attemptId: string;
    idempotencyKey: string;
    files?: readonly StagedFile[];
    artifactDigest?: string;
    pagesOidcToken?: string;
    pagesOidcClaims?: import("./oidc.js").PagesOidcExpectation;
}): Promise<Readonly<Record<string, unknown>>>;
export { PagesAdapterError } from "./errors.js";
export { computeArtifactDigest } from "./artifact-projection.js";
export { forgetDestination } from "./store.js";
/** This package's runtime status: fully implemented per S4-T04 (W4-11). */
export const PACKAGE_STATUS: Readonly<{
    name: "@rathnasgala2/adapter-github-pages";
    implemented: true;
    implementingTask: "S4-T04";
}>;
export type PagesDestination = Readonly<{
    owner: string;
    repository: string;
    repositoryId?: string | number;
    repositoryOwnerId?: string | number;
    apiOrigin?: string;
    oidcToken?: string;
    oidcClaims?: import("./oidc.js").PagesOidcExpectation;
    publicBaseUrl: string;
    token: string;
    publishCarrier: (input: {
        bytes: Buffer;
        generationId: string;
        carrierDigest: string;
    }) => Promise<{
        pagesArtifactId: string | number;
        artifactDigest?: string;
        byteCount?: number;
    }>;
    fetch?: typeof globalThis.fetch;
    publicFetch?: typeof globalThis.fetch;
    sleep?: (seconds: number) => Promise<void>;
    runId?: string;
    runAttempt?: number;
}>;
export type StagedFile = Readonly<{
    path: string;
    bytes: Buffer;
}>;
export { EXPECT_NOTHING_SERVED, fenceFor, generateUuidV7 } from "@rathnasgala2/adapter-protocol";
export { decodeCarrier, encodeCarrier } from "./carrier.js";
export { GENERATION_MARKER_PATH, ADAPTER_VERSION, NORMAL_MODE, RECOVERY_MODE } from "./constants.js";
export { PAGES_OIDC_ENVIRONMENT, PAGES_OIDC_ISSUER, PAGES_OIDC_PROFILE, buildSubjectForms, verifyPagesOidcToken } from "./oidc.js";
export { GAP_PROOF_PROFILE, NO_AUTHORITY_STATE, RECOVERY_RECORD_PROFILE, buildInterveningAttempts, buildRunAttemptGapProof, computeGapProofDigest, computeInterveningAttemptDigest, computeRecoveryDigest, sealRecoveryRecord, validateReconciliationRecovery, validateRunAttemptGapProof } from "./recovery.js";
export { CALL_CLASS_BINDING, GITHUB_API_ORIGIN, PAGES_CALL_PLAN, REQUEST_TEMPLATE_PROFILE, buildRequestTemplates, callClassIdBinding, requireTemplate } from "./request-catalog.js";
