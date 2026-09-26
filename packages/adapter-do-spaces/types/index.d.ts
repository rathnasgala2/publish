/**
 * `describeCapabilities`: the exact `do-spaces` capability row.
 *
 * @param {SpacesDestination} destination the bound destination
 * @returns {Promise<Readonly<Record<string, unknown>>>} the declaration
 */
export function describeCapabilities(destination: SpacesDestination): Promise<Readonly<Record<string, unknown>>>;
/**
 * `inspectDestination`: report the served generation from the activation
 * pointer plus the complete served-root enumeration used for
 * reconciliation.
 *
 * @param {SpacesDestination} destination the bound destination
 * @returns {Promise<Readonly<Record<string, unknown>>>} the inspection result
 */
export function inspectDestination(destination: SpacesDestination): Promise<Readonly<Record<string, unknown>>>;
/**
 * `preflight`: check every declared route against the portable path rules
 * and the reserved marker coordinate, and read the served pointer for
 * fencing. No credential writes anything here.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   entries: readonly {path: string}[],
 *   expectedGenerationId?: string
 * }} input the preflight input
 * @returns {Promise<Readonly<Record<string, unknown>>>} the preflight result
 */
export function preflight(input: {
    destination: SpacesDestination;
    entries: readonly {
        path: string;
    }[];
    expectedGenerationId?: string;
}): Promise<Readonly<Record<string, unknown>>>;
/**
 * Label an object key with an admitted deployment media type. The set is
 * deliberately tiny and closed: this adapter never interprets content, it
 * only labels the handful of extensions a static site genuinely needs, and
 * every value it can produce is a member of {@link DEPLOYMENT_MEDIA_TYPES}.
 *
 * @param {string} key the object key
 * @returns {string} the media type
 */
export function mediaTypeFor(key: string): string;
/**
 * The cache directive one deployment object is written with: the immutable
 * directive exactly when the entry is an immutable manifest asset, and
 * `no-cache` otherwise.
 *
 * @param {{immutable?: boolean}} file the staged file entry
 * @returns {string} the cache directive
 */
export function cacheControlFor(file: {
    immutable?: boolean;
}): string;
/**
 * `stage`: write the complete generation, plus its marker, under this
 * operation's exact private prefix in the staging bucket. Nothing in the
 * served bucket is read or written.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   generationId: string,
 *   artifactId: string,
 *   artifactDigest: string,
 *   files: readonly StagedFile[]
 * }} input the stage input; a file may carry `immutable: true` to be written
 *   with the immutable cache directive
 * @returns {Promise<Readonly<Record<string, unknown>>>} the stage result
 */
export function stage(input: {
    destination: SpacesDestination;
    operationId: string;
    attemptId: string;
    idempotencyKey: string;
    generationId: string;
    artifactId: string;
    artifactDigest: string;
    files: readonly StagedFile[];
}): Promise<Readonly<Record<string, unknown>>>;
/**
 * `activate`: replace the served root in place with a staged generation,
 * writing the activation pointer last.
 *
 * The bytes written are the frozen envelope's own: either `files`, or — when
 * the caller does not supply them — the exact bytes this run recorded when it
 * staged `stageToken`. There is no provider read-back, because DEC-097's
 * closed Spaces catalog has no object-`GET` row.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   stageToken?: string,
 *   generationId: string,
 *   expectedCurrentGenerationId: string,
 *   expectedArtifactDigest?: string,
 *   files?: readonly StagedFile[],
 *   artifactId?: string,
 *   artifactDigest?: string,
 *   crashInjectionHook?: () => void | Promise<void>
 * }} input the activate input; `expectedCurrentGenerationId` is mandatory and
 *   is either a generation identity or the `EXPECT_NOTHING_SERVED` sentinel
 * @returns {Promise<Readonly<Record<string, unknown>>>} the decision
 */
export function activate(input: {
    destination: SpacesDestination;
    stageToken?: string;
    generationId: string;
    expectedCurrentGenerationId: string;
    expectedArtifactDigest?: string;
    files?: readonly StagedFile[];
    artifactId?: string;
    artifactDigest?: string;
    crashInjectionHook?: () => void | Promise<void>;
}): Promise<Readonly<Record<string, unknown>>>;
/**
 * `observe`: verify the served generation through the public website origin
 * plus the complete served-root enumeration. Enumeration is used for
 * reconciliation, never as an inventory-completeness claim
 * (`providerInventoryAssurance: none`).
 *
 * @param {{
 *   destination: SpacesDestination,
 *   generationId: string,
 *   expectedArtifactDigest: string
 * }} input the observe input
 * @returns {Promise<Readonly<Record<string, unknown>>>} the observation
 */
export function observe(input: {
    destination: SpacesDestination;
    generationId: string;
    expectedArtifactDigest: string;
}): Promise<Readonly<Record<string, unknown>>>;
/**
 * `cleanupStaged`: delete exactly this operation's private stage prefix.
 * The served bucket is never read for mutation here and never written.
 *
 * The prefix comes from inverting the stage token, not from a bucket-resident
 * control object: the token is a pure projection of the three identity
 * segments, and only a prefix this adapter could itself have derived is ever
 * deleted by prefix.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   stageToken?: string,
 *   generationId?: string
 * }} input the cleanup input
 * @returns {Promise<Readonly<{removed: boolean, deletedObjectCount: number}>>}
 *   the cleanup result
 */
export function cleanupStaged(input: {
    destination: SpacesDestination;
    stageToken?: string;
    generationId?: string;
}): Promise<Readonly<{
    removed: boolean;
    deletedObjectCount: number;
}>>;
/**
 * `rollback`: `rollback: reupload` semantics. Spaces cannot natively
 * re-promote a historical generation, so a rollback stages a fresh copy of
 * the selected generation's bytes under a new generation identity and
 * re-promotes it through the `rollback/*` served-root rows.
 *
 * The historical bytes come from the caller when it supplies them, and
 * otherwise from what this run itself staged. There is no third source: the
 * closed Spaces catalog has no object-`GET` row, so a generation neither
 * supplied nor staged in this run cannot be read back, and the rollback fails
 * closed rather than pretending it can.
 *
 * @param {{
 *   destination: SpacesDestination,
 *   targetGenerationId: string,
 *   newGenerationId: string,
 *   newArtifactId: string,
 *   operationId: string,
 *   attemptId: string,
 *   idempotencyKey: string,
 *   files?: readonly StagedFile[]
 * }} input the rollback input
 * @returns {Promise<Readonly<Record<string, unknown>>>} the decision
 */
export function rollback(input: {
    destination: SpacesDestination;
    targetGenerationId: string;
    newGenerationId: string;
    newArtifactId: string;
    operationId: string;
    attemptId: string;
    idempotencyKey: string;
    files?: readonly StagedFile[];
}): Promise<Readonly<Record<string, unknown>>>;
export { SpacesAdapterError } from "./errors.js";
export * from "./types.js";
export { computeArtifactDigest } from "./artifact-projection.js";
export { deriveOrigins } from "./origins.js";
export { forgetDestination } from "./store.js";
/**
 * The exact closed set of deployment-object media types DEC-097 admits. A
 * value outside this list is not representable as
 * `deployment-object-media-type`, so {@link mediaTypeFor} can only ever
 * return a member of it.
 */
export const DEPLOYMENT_MEDIA_TYPES: readonly string[];
/** The cache directive an immutable manifest asset is written with. */
export const IMMUTABLE_CACHE_CONTROL: "public, max-age=31536000, immutable";
/** The cache directive every other deployment object is written with. */
export const DEFAULT_CACHE_CONTROL: "no-cache";
export { MAXIMUM_SINGLE_PART_BYTES };
/** This package's runtime status: fully implemented per S4-T05 (W4-11). */
export const PACKAGE_STATUS: Readonly<{
    name: "@rathnasgala2/adapter-do-spaces";
    implemented: true;
    implementingTask: "S4-T05";
}>;
export type SpacesDestination = import("./types.js").SpacesDestination;
export type StagedFile = Readonly<{
    path: string;
    bytes: Buffer;
    immutable?: boolean;
}>;
export type SpacesContext = Readonly<{
    origins: import("./origins.js").SpacesOrigins;
    served: import("./s3.js").BucketClient;
    staging: import("./s3.js").BucketClient;
    publicOrigin: string;
    publicFetch: typeof globalThis.fetch;
    identity: {
        region: string;
        servedBucket: string;
        stagingBucket: string;
    };
}>;
import { MAXIMUM_SINGLE_PART_BYTES } from './constants.js';
export { generateUuidV7, EXPECT_NOTHING_SERVED } from "@rathnasgala2/adapter-protocol";
export { ADAPTER_VERSION, GENERATION_MARKER_KEY } from "./constants.js";
export { WEBSITE_CONFIGURATION, spacesControlPlaneCatalogDigests } from "./capability.js";
export { errorDocumentKeyFor, spacesControlPlaneBinding, spacesRegionCatalog, spacesWebsiteConfiguration } from "./dec097-records.js";
export { CONTROL_PLANE_REQUEST_PROFILE, CONTROL_PLANE_REQUEST_TARGET, CONTROL_PLANE_RESPONSE_PROFILE, CONTROL_PLANE_RESPONSE_PROFILES, buildControlPlaneRequestCatalog, buildControlPlaneResponseCatalog, proveLimitedKeyAccessDenied } from "./control-plane.js";
