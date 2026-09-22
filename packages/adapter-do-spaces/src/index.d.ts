import type { Buffer } from 'node:buffer';

export interface SpacesFile {
  readonly path: string;
  readonly bytes: Buffer;
  /**
   * Whether this entry is an immutable manifest asset. `true` selects
   * `public, max-age=31536000, immutable`; anything else selects `no-cache`.
   */
  readonly immutable?: boolean;
}

export interface ProviderCallRecord {
  readonly stage: string;
  readonly callClass: string;
  readonly method: string;
  readonly origin: string;
  readonly requestTarget: string;
  /** Header names only — never a value, so no credential can be observed. */
  readonly headerNames: readonly string[];
}

export interface SpacesDestination {
  readonly region: string;
  readonly servedBucket: string;
  readonly stagingBucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly publicBaseUrl?: string;
  readonly controlPlaneEvidence?: Readonly<Record<string, unknown>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly publicFetch?: typeof globalThis.fetch;
  /**
   * Credential-free diagnostics hook, invoked immediately before each
   * cataloged request leaves, naming the `(stage, callClass)` row it renders.
   */
  readonly onProviderCall?: (record: ProviderCallRecord) => void;
}

export interface SpacesOrigins {
  readonly region: string;
  readonly servedBucket: string;
  readonly stagingBucket: string;
  readonly servedApiHost: string;
  readonly stagingApiHost: string;
  readonly servedApiOrigin: string;
  readonly stagingApiOrigin: string;
  readonly publicOrigin: string;
}

export declare const ADAPTER_VERSION: string;
export declare const GENERATION_MARKER_KEY: string;
export declare const MAXIMUM_SINGLE_PART_BYTES: number;
export declare const WEBSITE_CONFIGURATION: Readonly<Record<string, unknown>>;
/**
 * The three DEC-097 8443-8444 Spaces control-plane catalog digests (request
 * catalog, response catalog, TLS profile) for one destination's origins.
 * LOCAL-63(g): per-destination facts, never a per-adapter admission
 * constant — the request catalog closes over `origins`. Credential-free.
 */
export declare function spacesControlPlaneCatalogDigests(
  origins: SpacesOrigins,
): Readonly<{
  spacesControlPlaneRequestCatalogDigest: string;
  spacesControlPlaneResponseCatalogDigest: string;
  spacesControlPlaneTlsProfileDigest: string;
}>;
export declare const DEPLOYMENT_MEDIA_TYPES: readonly string[];
export declare const IMMUTABLE_CACHE_CONTROL: string;
export declare const DEFAULT_CACHE_CONTROL: string;
/**
 * The explicit "I expect this destination to be serving no generation at
 * all" activation fence (adapter protocol 2.1.0, LOCAL-47). `null` and
 * `undefined` are refused.
 */
export declare const EXPECT_NOTHING_SERVED: string;
export declare const PACKAGE_STATUS: Readonly<{
  name: string;
  implemented: true;
  implementingTask: string;
}>;

export declare function generateUuidV7(): string;
export declare function computeArtifactDigest(
  objects: readonly SpacesFile[],
): string;
export declare function deriveOrigins(destination: {
  region: string;
  servedBucket: string;
  stagingBucket: string;
}): SpacesOrigins;

export declare function errorDocumentKeyFor(basePath: string): string;
export declare function spacesWebsiteConfiguration(input: {
  basePath: string;
}): Readonly<{
  profile: 'gala-do-spaces-website-configuration-v2';
  indexDocumentSuffix: 'index.html';
  errorDocumentKey: string;
  routingRules: readonly [];
  configurationDigest: string;
}>;
export declare function spacesControlPlaneBinding(input: {
  servedBucket: string;
  stagingBucket: string;
  region: string;
  websiteOrigin: string;
  websiteConfigurationDigest: string;
}): Readonly<{
  profile: 'gala-do-spaces-control-plane-binding-v2';
  servedBucket: string;
  stagingBucket: string;
  region: string;
  websiteOrigin: string;
  websiteConfigurationDigest: string;
  stagingWebsiteConfiguration: 'absent';
  deploymentCredentialWebsiteAccess: 'denied';
  bindingDigest: string;
}>;
export declare function spacesRegionCatalog(input: {
  regions: readonly string[];
}): Readonly<{
  profile: 'gala-do-spaces-regions-v2';
  regions: readonly string[];
  digest: string;
}>;
export declare function mediaTypeFor(key: string): string;
export declare function cacheControlFor(file: { immutable?: boolean }): string;
/** Discard this run's in-process stage memory for one destination. */
export declare function forgetDestination(destination: {
  region: string;
  servedBucket: string;
  stagingBucket: string;
}): void;

export interface LimitedKeyDenialObservation {
  readonly credentialRole: 'limited-deployment';
  readonly target: 'served' | 'staging';
  readonly method: 'GET';
  readonly origin: string;
  readonly requestTarget: string;
  readonly responseProfile: 'spaces-website-access-denied-v2';
  readonly observedStatus: number;
  readonly observedErrorCode: string;
}

export declare const CONTROL_PLANE_REQUEST_PROFILE: string;
export declare const CONTROL_PLANE_RESPONSE_PROFILE: string;
export declare const CONTROL_PLANE_REQUEST_TARGET: string;
export declare const CONTROL_PLANE_RESPONSE_PROFILES: readonly string[];
export declare function buildControlPlaneRequestCatalog(
  origins: SpacesOrigins,
  bound: { bindingDigest: string; tlsProfileDigest: string },
): Readonly<Record<string, unknown>>;
export declare function buildControlPlaneResponseCatalog(): Readonly<
  Record<string, unknown>
>;
/**
 * Prove, before any mutation, that the limited deployment credential cannot
 * read either bucket's website configuration. Throws
 * `SPACES_LIMITED_KEY_OVERPRIVILEGED` when it can, and
 * `SPACES_LIMITED_KEY_DENIAL_UNPROVEN` when the answer does not prove denial.
 */
export declare function proveLimitedKeyAccessDenied(input: {
  destination: SpacesDestination;
  fetch?: typeof globalThis.fetch;
}): Promise<
  Readonly<{
    profile: string;
    requestProfile: string;
    responseProfile: string;
    proven: true;
    observations: readonly LimitedKeyDenialObservation[];
  }>
>;

export declare function describeCapabilities(
  destination: SpacesDestination,
): Promise<Readonly<Record<string, unknown>>>;
export declare function inspectDestination(
  destination: SpacesDestination,
): Promise<Readonly<Record<string, unknown>>>;
export declare function preflight(input: {
  destination: SpacesDestination;
  entries: readonly { path: string }[];
  expectedGenerationId?: string;
}): Promise<Readonly<Record<string, unknown>>>;
export declare function stage(input: {
  destination: SpacesDestination;
  operationId: string;
  attemptId: string;
  idempotencyKey: string;
  generationId: string;
  artifactId: string;
  artifactDigest: string;
  files: readonly SpacesFile[];
}): Promise<Readonly<Record<string, unknown>>>;
export declare function activate(input: {
  destination: SpacesDestination;
  /** The stage this run recorded; omit only when `files` is supplied. */
  stageToken?: string;
  generationId: string;
  /**
   * Mandatory activation fence: a generation identity, or
   * `EXPECT_NOTHING_SERVED`. `null`/`undefined` are refused with
   * `EXPECTED_GENERATION_FENCE_INVALID`.
   */
  expectedCurrentGenerationId: string;
  expectedArtifactDigest?: string;
  /** The exact bytes to serve; required when this run did not stage them. */
  files?: readonly SpacesFile[];
  /** The marker's artifact identity; required alongside a foreign `files`. */
  artifactId?: string;
  artifactDigest?: string;
  crashInjectionHook?: () => void | Promise<void>;
}): Promise<Readonly<Record<string, unknown>>>;
export declare function observe(input: {
  destination: SpacesDestination;
  generationId: string;
  expectedArtifactDigest: string;
}): Promise<Readonly<Record<string, unknown>>>;
export declare function cleanupStaged(input: {
  destination: SpacesDestination;
  stageToken?: string;
  generationId?: string;
}): Promise<Readonly<{ removed: boolean; deletedObjectCount: number }>>;
export declare function rollback(input: {
  destination: SpacesDestination;
  targetGenerationId: string;
  newGenerationId: string;
  newArtifactId: string;
  operationId: string;
  attemptId: string;
  idempotencyKey: string;
  /**
   * The historical bytes. When absent, only a generation this run itself
   * staged can be rolled back; anything else fails closed with
   * `ROLLBACK_INPUT_UNAVAILABLE`.
   */
  files?: readonly SpacesFile[];
}): Promise<Readonly<Record<string, unknown>>>;
