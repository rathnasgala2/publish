/**
 * Thin `validateGalaDocument` wrapper that fails closed with a typed
 * {@link SchemaValidationError} carrying the schema's own diagnostics, used
 * by every normalization step in this package (repository:2.0.0,
 * lock:2.0.0, publication:2.0.0, author:2.0.0, navigation:2.0.0,
 * appearance:2.0.0, content-frontmatter:2.0.0, build-input:2.0.0). No schema
 * is re-authored here; `@rathnasgala2/schemas` remains the single source of
 * truth for validity (LOCAL-1). When `WORKSPACE_ROOT` contains the real
 * `schema` sibling, focused local tests use it; production resolves the exact
 * package dependency normally.
 *
 * @module
 */

import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const schemaSibling = process.env.WORKSPACE_ROOT
  ? path.join(path.resolve(process.env.WORKSPACE_ROOT), 'schema')
  : null;
const useSchemaSibling = schemaSibling
  ? await lstat(schemaSibling)
      .then((stats) => stats.isDirectory())
      .catch(() => false)
  : false;
const schemasModule = /** @type {typeof import('@rathnasgala2/schemas')} */ (
  useSchemaSibling
    ? await import(
        pathToFileURL(
          path.join(/** @type {string} */ (schemaSibling), 'src/index.js'),
        ).href
      )
    : await import('@rathnasgala2/schemas')
);

/** The active schema validator, optionally loaded from the schema sibling. */
export const validateGalaDocument = schemasModule.validateGalaDocument;

/** A validation failure against one named `urn:gala:schema:*` document. */
export class SchemaValidationError extends Error {
  /**
   * @param {string} schemaId the schema this document failed against
   * @param {string} location a human-readable pointer to the document
   * @param {readonly Record<string, unknown>[]} diagnostics the schema's own diagnostics
   */
  constructor(schemaId, location, diagnostics) {
    super(
      `${location} failed validation against ${schemaId}: ${JSON.stringify(diagnostics)}`,
    );
    this.name = 'SchemaValidationError';
    this.schemaId = schemaId;
    this.location = location;
    /** @type {readonly Record<string, unknown>[]} */
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

/**
 * Validate one candidate document against a named schema; return it
 * unchanged (never mutated) when valid, throw {@link SchemaValidationError}
 * otherwise.
 *
 * @param {string} schemaId a `urn:gala:schema:*` identifier
 * @param {unknown} document the candidate document
 * @param {string} location a human-readable pointer used in error messages
 * @returns {unknown} the same document, once validated
 */
export function assertValidDocument(schemaId, document, location) {
  const result = validateGalaDocument(schemaId, document);
  if (!result.valid) {
    throw new SchemaValidationError(schemaId, location, result.diagnostics);
  }
  return document;
}
