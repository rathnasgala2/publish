/**
 * Convert every typed error this package's normalization/render/deploy
 * pipeline can throw into this package's shared {@link import('./result.js').Finding}
 * shape, so every subcommand and the Action entry can build one result
 * envelope regardless of which layer failed.
 *
 * @module
 */

import { SchemaValidationError } from './schema.js';
import { RepositoryIntakeError } from './normalize/repository-intake.js';
import { ThemeResolutionError } from './theme-bridge.js';
import { UnsafeBuildDirectoryError } from './build-directory-safety.js';

/**
 * @param {unknown} error the thrown error
 * @returns {readonly import('./index.d.ts').PublishActionFinding[]} the
 *   error's findings, or one synthesized `ARTIFACT_SAFETY_ERROR` finding for
 *   an error this module does not specifically recognize (never lets an
 *   unrecognized error escape without a typed finding)
 */
export function findingsFromError(error) {
  if (error instanceof RepositoryIntakeError) {
    return error.findings;
  }
  if (error instanceof ThemeResolutionError) {
    return error.findings;
  }
  if (error instanceof UnsafeBuildDirectoryError) {
    return error.findings;
  }
  if (error instanceof SchemaValidationError) {
    return [
      {
        code: 'SCHEMA_VALIDATION_FAILED',
        severity: 'SOURCE_ERROR',
        detail: error.message,
        location: error.location,
        evidence: { schemaId: error.schemaId, diagnostics: error.diagnostics },
        recovery:
          'Fix the referenced document so it validates against the named schema.',
        overridable: false,
      },
    ];
  }
  // publish-kernel's KernelError, adapter-protocol's AdapterProtocolError,
  // and template's typed errors (BuildInputValidationError,
  // RenderOptionsError, RenderPolicyViolationError, MediaPipelineError,
  // ArtifactManifestValidationError) all carry a `findings`/`diagnostics`
  // array shaped closely enough to this package's own finding shape to pass
  // through directly.
  const candidate = /** @type {{findings?: unknown, diagnostics?: unknown}} */ (
    error
  );
  if (Array.isArray(candidate?.findings)) {
    return /** @type {readonly import('./index.d.ts').PublishActionFinding[]} */ (
      candidate.findings
    );
  }
  if (Array.isArray(candidate?.diagnostics)) {
    return candidate.diagnostics.map((diagnostic) => ({
      code: 'RENDER_DIAGNOSTIC',
      severity: 'SOURCE_ERROR',
      detail: JSON.stringify(diagnostic),
      recovery: 'Fix the referenced build-input field.',
      overridable: false,
    }));
  }
  const message = error instanceof Error ? error.message : String(error);
  return [
    {
      code: 'UNCLASSIFIED_FAILURE',
      severity: 'ARTIFACT_SAFETY_ERROR',
      detail: message,
      recovery:
        'Inspect the error and retry once the underlying condition is fixed.',
      overridable: false,
    },
  ];
}
