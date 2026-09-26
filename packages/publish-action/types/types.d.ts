/**
 * A finding, in this package's own shared shape (`code`/`severity`/`detail`
 * required, everything else optional) -- the same shape every layer this
 * package composes (`publish-kernel`'s `KernelFinding`, `adapter-protocol`'s
 * `ProtocolFinding`, this package's own `RepositoryIntakeError`) already
 * uses.
 */
export type PublishActionFinding = {
    code: string;
    severity: "SOURCE_ERROR" | "ARTIFACT_SAFETY_ERROR" | "TARGET_CONSTRAINT_ERROR" | "WARNING" | "ADVISORY";
    detail: string;
    location?: string;
    evidence?: Record<string, unknown>;
    recovery?: string;
    overridable?: boolean;
};
/**
 * The closed result envelope every `validate`/`build`/`preview`/`publish`
 * invocation returns.
 */
export type ResultEnvelope = {
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
};
