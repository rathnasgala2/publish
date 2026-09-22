/**
 * Hand-maintained declaration surface for `@rathnasgala2/publish-action`
 * (DEC-094: JSDoc-typed JavaScript ESM, no TypeScript sources).
 */

export interface PublishActionFinding {
  [key: string]: unknown;
  code: string;
  severity:
    | 'SOURCE_ERROR'
    | 'ARTIFACT_SAFETY_ERROR'
    | 'TARGET_CONSTRAINT_ERROR'
    | 'WARNING'
    | 'ADVISORY';
  detail: string;
  location?: string;
  evidence?: Record<string, unknown>;
  recovery?: string;
  overridable?: boolean;
}

export interface ResultEnvelope {
  [key: string]: unknown;
  schemaId: string;
  command: string;
  resultCode: string;
  exitCode: number;
  findings: readonly PublishActionFinding[];
  manifestPath?: string;
  manifestDigest?: string;
  artifactDirectory?: string;
  artifactDigest?: string;
  routeCount?: number;
  byteCount?: string;
  previewUrl?: string;
}

export declare function runValidate(options: {
  repositoryDirectory: string;
}): Promise<ResultEnvelope>;

export declare function runBuild(options: {
  repositoryDirectory: string;
  outputDirectory: string;
  workDirectory: string;
  routeNormalizationProfile?: 'directory-index' | 'explicit-file';
}): Promise<
  ResultEnvelope & {
    outputDirectory?: string;
    manifest?: Record<string, unknown>;
  }
>;

export declare function runPreview(options: {
  repositoryDirectory: string;
  outputDirectory: string;
  workDirectory: string;
}): Promise<{
  envelope: ResultEnvelope;
  server?: { url: string; close: () => Promise<void> };
}>;

export declare function serveDirectoryReadOnly(
  rootDirectory: string,
): Promise<{ url: string; close: () => Promise<void> }>;

export declare function buildBuildInputFromRepository(options: {
  repositoryDirectory: string;
}): Promise<Record<string, unknown>>;

export declare class RepositoryIntakeError extends Error {
  findings: readonly PublishActionFinding[];
  constructor(message: string, findings?: readonly PublishActionFinding[]);
}

export declare function buildProvenance(
  theme: {
    package: string;
    version: string;
    integrity: string;
    registry: string;
  },
  env?: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>>;

export declare function resolveThemeDirectory(options: {
  repositoryDirectory: string;
  theme: {
    package: string;
    version: string;
    integrity: string;
    registry: string;
  };
  env?: NodeJS.ProcessEnv;
}): Promise<string>;

export declare class ThemeResolutionError extends Error {
  findings: readonly PublishActionFinding[];
  constructor(message: string, findings?: readonly PublishActionFinding[]);
}

export declare function deployToLocalDirectory(input: {
  outputDirectory: string;
  manifest: Record<string, unknown>;
  destinationRoot: string;
}): Promise<{
  decision: 'activate' | 'reconcile';
  generationId: string;
  artifactId: string;
  artifactDigest: string;
  byteCount: string;
  routeCount: number;
  findings: readonly PublishActionFinding[];
}>;

export declare function assertImplementedAdapter(adapterId: string): void;

export declare function runAction(env?: NodeJS.ProcessEnv): Promise<number>;

export declare function buildResultEnvelope(
  fields: Partial<ResultEnvelope> & {
    command: string;
    resultCode: string;
    exitCode: number;
  },
): ResultEnvelope;

export declare function classifyFindings(
  findings: readonly PublishActionFinding[],
): { resultCode: string; exitCode: number };

export declare const EXIT_CODES: Readonly<{
  SUCCESS: 0;
  FINDINGS: 1;
  INCOMPATIBLE_CONTRACT: 2;
  CONFLICT: 3;
  MISSING_DEPENDENCY: 4;
  UNSAFE_INPUT: 5;
  BUILD_OR_PUBLISH_FAILURE: 6;
  REDACTED_INTERNAL_FAILURE: 70;
}>;

export declare class SchemaValidationError extends Error {
  schemaId: string;
  location: string;
  diagnostics: readonly Record<string, unknown>[];
  constructor(
    schemaId: string,
    location: string,
    diagnostics: readonly Record<string, unknown>[],
  );
}

export declare const PACKAGE_STATUS: Readonly<{
  name: string;
  implemented: true;
  implementingTask: string;
}>;
