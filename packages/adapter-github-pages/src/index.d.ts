import type { Buffer } from 'node:buffer';

export interface PagesCarrierFile {
  readonly path: string;
  readonly bytes: Buffer;
}

/**
 * The caller-supplied expected bindings a Pages OIDC token must carry. The
 * adapter never mints the token and cannot invent these values; the
 * `deploy-github-pages` job supplies both.
 */
export interface PagesOidcClaims {
  readonly ref: string;
  readonly sha: string;
  readonly runId: string | number;
  readonly runAttempt: string | number;
  readonly jobWorkflowRef: string;
  readonly jobWorkflowSha: string;
}

export interface PagesDestination {
  readonly owner: string;
  readonly repository: string;
  readonly repositoryId?: string | number;
  readonly repositoryOwnerId?: string | number;
  /** The Pages OIDC JWT, when supplied at destination level. */
  readonly oidcToken?: string;
  /** The expected OIDC bindings, when supplied at destination level. */
  readonly oidcClaims?: PagesOidcClaims;
  readonly apiOrigin?: string;
  readonly publicBaseUrl: string;
  readonly token: string;
  readonly publishCarrier: (input: {
    bytes: Buffer;
    generationId: string;
    carrierDigest: string;
  }) => Promise<{
    pagesArtifactId: string | number;
    artifactDigest?: string;
    byteCount?: number;
  }>;
  readonly fetch?: typeof globalThis.fetch;
  readonly publicFetch?: typeof globalThis.fetch;
  readonly sleep?: (seconds: number) => Promise<void>;
  readonly runId?: string;
  readonly runAttempt?: number;
}

export declare const ADAPTER_VERSION: string;
export declare const GENERATION_MARKER_PATH: string;
export declare const PACKAGE_STATUS: Readonly<{
  name: string;
  implemented: true;
  implementingTask: string;
}>;

export declare function generateUuidV7(): string;
/** Re-exported adapter-protocol 2.1.0 fence sentinel (LOCAL-47). */
export declare const EXPECT_NOTHING_SERVED: string;
/** Re-exported adapter-protocol fence constructor for an observation. */
export declare function fenceFor(
  observedGenerationId: string | null | undefined,
): string;
export declare function computeArtifactDigest(
  files: readonly PagesCarrierFile[],
): string;
export declare function encodeCarrier(
  files: readonly PagesCarrierFile[],
): Buffer;
export declare function decodeCarrier(carrier: Buffer): PagesCarrierFile[];
export declare function forgetDestination(destination: {
  owner: string;
  repository: string;
  repositoryId?: string | number;
}): void;

export declare function describeCapabilities(
  destination: PagesDestination,
): Promise<Readonly<Record<string, unknown>>>;
export declare function inspectDestination(
  destination: PagesDestination,
): Promise<Readonly<Record<string, unknown>>>;
export declare function preflight(input: {
  destination: PagesDestination;
  entries: readonly { path: string }[];
  expectedGenerationId?: string;
}): Promise<Readonly<Record<string, unknown>>>;
export declare function stage(input: {
  destination: PagesDestination;
  operationId: string;
  attemptId: string;
  idempotencyKey: string;
  generationId: string;
  artifactId: string;
  artifactDigest: string;
  files: readonly PagesCarrierFile[];
}): Promise<Readonly<Record<string, unknown>>>;
export declare function activate(input: {
  destination: PagesDestination;
  stageToken: string;
  generationId: string;
  /**
   * Adapter protocol 2.1.0 fence: a generation identity, or the
   * `EXPECT_NOTHING_SERVED` sentinel. `null`/`undefined` are refused
   * (`EXPECTED_GENERATION_FENCE_INVALID`, LOCAL-47).
   */
  expectedCurrentGenerationId: string;
  expectedArtifactDigest?: string;
  /** The mandatory Pages OIDC JWT, unless supplied on the destination. */
  pagesOidcToken?: string;
  /** The mandatory expected OIDC bindings, unless on the destination. */
  pagesOidcClaims?: PagesOidcClaims;
  /** `normal` (default) or `pages-reconciliation-recovery`. */
  mode?: 'normal' | 'pages-reconciliation-recovery';
  /** The server-minted recovery record; forbidden in `normal` mode. */
  pagesRecovery?: Readonly<Record<string, unknown>>;
  crashInjectionHook?: () => void | Promise<void>;
}): Promise<Readonly<Record<string, unknown>>>;

export declare function recoverPriorAttempt(input: {
  destination: PagesDestination;
  pagesRecovery: Readonly<Record<string, unknown>>;
}): Promise<Readonly<Record<string, unknown>>>;
export declare function observe(input: {
  destination: PagesDestination;
  generationId: string;
  expectedArtifactDigest: string;
}): Promise<Readonly<Record<string, unknown>>>;
export declare function cleanupStaged(input: {
  destination: PagesDestination;
  stageToken: string;
  generationId?: string;
}): Promise<Readonly<{ removed: boolean; cancelled: boolean }>>;
export declare function rollback(input: {
  destination: PagesDestination;
  targetGenerationId: string;
  newGenerationId: string;
  newArtifactId: string;
  operationId: string;
  attemptId: string;
  idempotencyKey: string;
  files?: readonly PagesCarrierFile[];
  artifactDigest?: string;
  pagesOidcToken?: string;
  pagesOidcClaims?: PagesOidcClaims;
}): Promise<Readonly<Record<string, unknown>>>;

export declare const NORMAL_MODE: 'normal';
export declare const RECOVERY_MODE: 'pages-reconciliation-recovery';
export declare const GITHUB_API_ORIGIN: string;
export declare const REQUEST_TEMPLATE_PROFILE: string;
export declare const PAGES_OIDC_PROFILE: string;
export declare const PAGES_OIDC_ISSUER: string;
export declare const PAGES_OIDC_ENVIRONMENT: string;
export declare const GAP_PROOF_PROFILE: string;
export declare const RECOVERY_RECORD_PROFILE: string;
export declare const NO_AUTHORITY_STATE: 'closed-no-destination-authority';
export declare const PAGES_CALL_PLAN: readonly Readonly<{
  stage: string;
  callClass: string;
}>[];
export declare const CALL_CLASS_BINDING: readonly Readonly<{
  stage: string;
  callClass: string;
  pagesDeploymentIdSource: string;
  recoveryOnly: boolean;
}>[];
export declare function callClassIdBinding(
  stage: string,
  callClass: string,
): Readonly<{
  stage: string;
  callClass: string;
  pagesDeploymentIdSource: string;
  recoveryOnly: boolean;
}>;

export declare function buildRequestTemplates(
  apiOrigin?: string,
): readonly Readonly<Record<string, unknown>>[];
export declare function requireTemplate(
  templates: readonly Readonly<Record<string, unknown>>[],
  stage: string,
  callClass: string,
): Readonly<Record<string, unknown>>;

export declare function verifyPagesOidcToken(
  token: unknown,
  expected: PagesOidcClaims & {
    owner: string;
    repository: string;
    repositoryId: string | number;
    repositoryOwnerId: string | number;
  },
): Readonly<{
  profile: string;
  subjectForm: 'name' | 'identifier';
  issuerSignatureVerified: false;
  tokenByteCount: number;
}>;
export declare function buildSubjectForms(identity: {
  owner: string;
  repository: string;
  repositoryId: string;
  repositoryOwnerId: string;
}): { name: string; id: string };

export declare function computeInterveningAttemptDigest(input: {
  repositoryId: string | number;
  runId: string | number;
  runAttempt: number;
}): string;
export declare function buildInterveningAttempts(input: {
  repositoryId: string | number;
  runId: string | number;
  priorRunAttempt: number;
  claimingRunAttempt: number;
}): readonly Readonly<{
  runAttempt: number;
  authorityState: string;
  decisionDigest: string;
}>[];
export declare function buildRunAttemptGapProof(input: {
  repositoryId: string | number;
  runId: string | number;
  priorRunAttempt: number;
  claimingRunAttempt: number;
}): Readonly<Record<string, unknown>>;
export declare function computeGapProofDigest(
  proof: Readonly<Record<string, unknown>>,
): string;
export declare function validateRunAttemptGapProof(
  proof: unknown,
  binding: { repositoryId: string | number },
): Readonly<Record<string, unknown>>;
export declare function computeRecoveryDigest(
  recovery: Readonly<Record<string, unknown>>,
): string;
export declare function sealRecoveryRecord(
  withoutDigest: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>>;
export declare function validateReconciliationRecovery(
  recovery: unknown,
  binding: { repositoryId: string | number },
): Readonly<Record<string, unknown>>;
