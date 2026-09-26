/**
 * Type-only declarations shared across `@rathnasgala2/publish-action`'s
 * source. This module has no runtime behavior; it exists so the package's
 * generated `.d.ts` surface (DEC-094) can declare `PublishActionFinding` and
 * `ResultEnvelope` as named, importable types the same way a hand-written
 * declaration file would, without falling back to a hand-maintained
 * `index.d.ts` that the declaration-drift gate cannot check.
 *
 * @module
 */

/**
 * A finding, in this package's own shared shape (`code`/`severity`/`detail`
 * required, everything else optional) -- the same shape every layer this
 * package composes (`publish-kernel`'s `KernelFinding`, `adapter-protocol`'s
 * `ProtocolFinding`, this package's own `RepositoryIntakeError`) already
 * uses.
 *
 * @typedef {object} PublishActionFinding
 * @property {string} code
 * @property {'SOURCE_ERROR'|'ARTIFACT_SAFETY_ERROR'|'TARGET_CONSTRAINT_ERROR'|'WARNING'|'ADVISORY'} severity
 * @property {string} detail
 * @property {string} [location]
 * @property {Record<string, unknown>} [evidence]
 * @property {string} [recovery]
 * @property {boolean} [overridable]
 */

/**
 * The closed result envelope every `validate`/`build`/`preview`/`publish`
 * invocation returns.
 *
 * @typedef {object} ResultEnvelope
 * @property {string} schemaId
 * @property {string} command
 * @property {string} resultCode
 * @property {number} exitCode
 * @property {readonly PublishActionFinding[]} findings
 * @property {string} [manifestPath]
 * @property {string} [manifestDigest]
 * @property {string} [artifactDirectory]
 * @property {string} [artifactDigest]
 * @property {number} [routeCount]
 * @property {string} [byteCount]
 * @property {string} [previewUrl]
 */

export {};
