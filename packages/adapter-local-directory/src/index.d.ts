export interface LocalDirectoryDestination {
  readonly root: string;
}

export interface StagedFile {
  readonly path: string;
  readonly bytes: Buffer;
}

export declare function describeCapabilities(
  destination: LocalDirectoryDestination,
): Promise<Readonly<Record<string, unknown>>>;

export declare function inspectDestination(
  destination: LocalDirectoryDestination,
): Promise<
  Readonly<{
    currentGenerationId: string | null;
    retainedHistory: readonly Readonly<Record<string, unknown>>[];
    releaseGenerationsOnDisk: readonly string[];
  }>
>;

export declare function preflight(input: {
  destination: LocalDirectoryDestination;
  entries: readonly { path: string }[];
  expectedGenerationId?: string;
}): Promise<
  Readonly<{
    verdict: 'proceed' | 'refuse';
    observedGenerationId: string | null;
    findings: readonly string[];
  }>
>;

export declare function stage(input: {
  destination: LocalDirectoryDestination;
  operationId: string;
  attemptId: string;
  idempotencyKey: string;
  generationId: string;
  artifactId: string;
  artifactDigest: string;
  files: readonly StagedFile[];
}): Promise<
  Readonly<{
    stageToken: string;
    stagedPath: string;
    fileCount: number;
    byteCount: string;
    idempotent: boolean;
  }>
>;

export declare function activate(input: {
  destination: LocalDirectoryDestination;
  stageToken: string;
  generationId: string;
  /**
   * The activation fence: a generation identity, or the protocol's
   * `EXPECT_NOTHING_SERVED` sentinel when the caller expects the
   * destination to be serving nothing. `null`/`undefined` are refused
   * (LOCAL-47).
   */
  expectedCurrentGenerationId: string;
  expectedArtifactDigest?: string;
  crashInjectionHook?: () => void | Promise<void>;
}): Promise<
  Readonly<{
    decision: 'activate' | 'reconcile';
    generationId: string;
    previousGenerationId: string | null;
    idempotent: boolean;
  }>
>;

export declare function observe(input: {
  destination: LocalDirectoryDestination;
  generationId: string;
  expectedArtifactDigest: string;
}): Promise<
  Readonly<{
    verified: boolean;
    observedArtifactDigest: string;
    currentGenerationId: string | null;
    markerValid: boolean;
    findings: readonly string[];
  }>
>;

export declare function cleanupStaged(input: {
  destination: LocalDirectoryDestination;
  stageToken: string;
  generationId?: string;
}): Promise<Readonly<{ removed: boolean }>>;

export declare function rollback(input: {
  destination: LocalDirectoryDestination;
  targetGenerationId: string;
  newGenerationId: string;
  newArtifactId: string;
  operationId: string;
  attemptId: string;
  idempotencyKey: string;
}): Promise<
  Readonly<{
    decision: 'activate' | 'reconcile';
    generationId: string;
    previousGenerationId: string | null;
    idempotent: boolean;
  }>
>;

export declare function computeArtifactDigest(
  files: readonly StagedFile[],
): string;

export declare function generateUuidV7(): string;

/**
 * Re-export of the adapter protocol's explicit "expect nothing served"
 * activation fence sentinel, so a caller of this adapter never has to reach
 * past it for the one value that means "this is a first publish".
 */
export declare const EXPECT_NOTHING_SERVED: string;

/**
 * Re-export of the adapter protocol's fence constructor: maps an observed
 * served generation (or `null`/`undefined` when nothing is served) onto the
 * value to pass as `expectedCurrentGenerationId`.
 */
export declare function fenceFor(
  observedGenerationId: string | null | undefined,
): string;

/** Package readiness marker: fully implemented per S2-T17. */
export declare const PACKAGE_STATUS: Readonly<{
  name: string;
  implemented: true;
  implementingTask: string;
}>;

/** This adapter's published package version. */
export declare const ADAPTER_VERSION: string;
