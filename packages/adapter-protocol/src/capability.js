/**
 * Adapter-capability declaration validation. `@rathnasgala2/schemas` is the
 * single authoritative wire validator (LOCAL-1: consumed as a pinned local
 * tarball dependency, never re-authored); this module adds only the
 * belt-and-suspenders exact-row truthfulness check described in the slice
 * brief so a caller gets a stable `AdapterProtocolError` finding rather than
 * an Ajv diagnostic shape, and so the exact-row table is enforced even for a
 * caller that only wants the fast local check without invoking Ajv.
 *
 * @module
 */

import { GALA_SCHEMA_IDS, validateGalaDocument } from '@rathnasgala2/schemas';

import {
  CACHE_INVALIDATION,
  OPERATIONS,
  ROLLBACK,
  getCapabilityRow,
  isSameSet,
} from './capability-vocabulary.js';
import { AdapterProtocolError, finding } from './errors.js';

/** The exact schema identity every declaration is validated against. */
export const ADAPTER_CAPABILITY_SCHEMA_ID =
  'urn:gala:schema:adapter-capability:2.0.0';

if (!GALA_SCHEMA_IDS.includes(ADAPTER_CAPABILITY_SCHEMA_ID)) {
  throw new Error(
    `@rathnasgala2/schemas does not register ${ADAPTER_CAPABILITY_SCHEMA_ID}; check the consumed schema package version.`,
  );
}

/**
 * @typedef {ReturnType<typeof validateGalaDocument>['diagnostics'][number]} SchemaDiagnostic
 */

/**
 * @typedef {Readonly<{
 *   schemaValid: boolean,
 *   schemaDiagnostics: readonly SchemaDiagnostic[],
 *   exactRowValid: boolean,
 *   findings: readonly import('./errors.js').ProtocolFinding[]
 * }>} CapabilityValidationResult
 */

/**
 * Validate one candidate `adapter-capability:2.0.0` document: first against
 * the published JSON Schema (structural and closed-table validity), then
 * against this package's exact-row table for a human/kernel-readable typed
 * finding on a truthfulness violation.
 *
 * @param {unknown} declaration candidate adapter-capability document
 * @returns {CapabilityValidationResult} combined validation result
 */
export function validateCapabilityDeclaration(declaration) {
  const schemaResult = validateGalaDocument(
    ADAPTER_CAPABILITY_SCHEMA_ID,
    declaration,
  );
  const rowFindings = checkExactRow(declaration);
  return Object.freeze({
    schemaValid: schemaResult.valid,
    schemaDiagnostics: schemaResult.diagnostics,
    exactRowValid: rowFindings.length === 0,
    findings: Object.freeze(rowFindings),
  });
}

/**
 * Throw {@link AdapterProtocolError} unless a declaration passes both the
 * schema and the exact-row check.
 *
 * @param {unknown} declaration candidate adapter-capability document
 * @returns {void}
 */
export function assertValidCapabilityDeclaration(declaration) {
  const result = validateCapabilityDeclaration(declaration);
  if (result.schemaValid && result.exactRowValid) {
    return;
  }
  /** @type {import('./errors.js').ProtocolFinding[]} */
  const findings = [...result.findings];
  for (const diagnostic of result.schemaDiagnostics) {
    findings.push(
      finding(diagnostic.code, 'ARTIFACT_SAFETY_ERROR', diagnostic.rule, {
        location: diagnostic.instancePointer,
      }),
    );
  }
  throw new AdapterProtocolError(
    'Adapter capability declaration is invalid',
    findings,
  );
}

/**
 * Check a declaration against the exact DEC-097 section 7 admission row for
 * its declared `adapter.adapterId`. Every field this table closes must match
 * exactly; an adapter may not silently emulate a weaker guarantee while
 * declaring a stronger one, nor a stronger one it does not truthfully
 * implement.
 *
 * @param {unknown} declaration candidate adapter-capability document
 * @returns {import('./errors.js').ProtocolFinding[]} empty when the exact
 *   row matches; one finding per mismatched field otherwise
 */
export function checkExactRow(declaration) {
  if (
    declaration === null ||
    typeof declaration !== 'object' ||
    Array.isArray(declaration)
  ) {
    return [
      finding(
        'TARGET_CAPABILITY_DECLARATION_MALFORMED',
        'ARTIFACT_SAFETY_ERROR',
        'Adapter capability declaration must be a JSON object.',
      ),
    ];
  }
  const doc = /** @type {Record<string, unknown>} */ (declaration);
  const adapter = /** @type {Record<string, unknown> | undefined} */ (
    doc.adapter
  );
  const adapterId = adapter?.adapterId;
  const row = getCapabilityRow(adapterId);
  if (row === undefined) {
    return [
      finding(
        'TARGET_CAPABILITY_DECLARATION_MALFORMED',
        'ARTIFACT_SAFETY_ERROR',
        'adapter.adapterId is missing or is not one of the three closed adapter identities.',
        { location: '/adapter/adapterId' },
      ),
    ];
  }
  /** @type {import('./errors.js').ProtocolFinding[]} */
  const mismatches = [];

  checkField(mismatches, doc, 'staging', row.staging);
  checkField(mismatches, doc, 'activation', row.activation);
  checkField(mismatches, doc, 'concurrency', row.concurrency);
  checkField(mismatches, doc, 'idempotencyClass', row.idempotencyClass);
  checkField(
    mismatches,
    doc,
    'providerInventoryAssurance',
    row.providerInventoryAssurance,
  );
  checkField(mismatches, doc, 'rollback', ROLLBACK);
  checkField(mismatches, doc, 'cacheInvalidation', CACHE_INVALIDATION);

  const destinationKinds = doc.destinationKinds;
  if (
    !Array.isArray(destinationKinds) ||
    !isSameSet(/** @type {string[]} */ (destinationKinds), [
      row.destinationKind,
    ])
  ) {
    mismatches.push(
      finding(
        'TARGET_CAPABILITY_ROW_MISMATCH',
        'ARTIFACT_SAFETY_ERROR',
        `destinationKinds must be exactly ["${row.destinationKind}"] for adapterId "${adapterId}".`,
        { location: '/destinationKinds' },
      ),
    );
  }

  const operations = doc.operations;
  if (
    !Array.isArray(operations) ||
    !isSameSet(/** @type {string[]} */ (operations), OPERATIONS)
  ) {
    mismatches.push(
      finding(
        'TARGET_CAPABILITY_ROW_MISMATCH',
        'ARTIFACT_SAFETY_ERROR',
        'operations must be the exact six-member operation set.',
        { location: '/operations' },
      ),
    );
  }

  const verification = doc.verification;
  if (
    !Array.isArray(verification) ||
    !isSameSet(/** @type {string[]} */ (verification), row.verification)
  ) {
    mismatches.push(
      finding(
        'TARGET_CAPABILITY_ROW_MISMATCH',
        'ARTIFACT_SAFETY_ERROR',
        `verification must be exactly ${JSON.stringify(row.verification)} for adapterId "${adapterId}".`,
        { location: '/verification' },
      ),
    );
  }

  const configuration = /** @type {Record<string, unknown> | undefined} */ (
    doc.configuration
  );
  if (configuration === undefined || typeof configuration !== 'object') {
    mismatches.push(
      finding(
        'TARGET_CAPABILITY_ROW_MISMATCH',
        'ARTIFACT_SAFETY_ERROR',
        'configuration is missing.',
        { location: '/configuration' },
      ),
    );
  } else {
    for (const key of /** @type {const} */ ([
      'redirects',
      'headers',
      'customDomains',
      'immutableCaching',
    ])) {
      if (configuration[key] !== false) {
        mismatches.push(
          finding(
            'TARGET_CAPABILITY_ROW_MISMATCH',
            'ARTIFACT_SAFETY_ERROR',
            `configuration.${key} must be false.`,
            { location: `/configuration/${key}` },
          ),
        );
      }
    }
    if (configuration.notFoundBehavior !== row.notFoundBehavior) {
      mismatches.push(
        finding(
          'TARGET_CAPABILITY_ROW_MISMATCH',
          'ARTIFACT_SAFETY_ERROR',
          `configuration.notFoundBehavior must be ${row.notFoundBehavior} for adapterId "${adapterId}".`,
          { location: '/configuration/notFoundBehavior' },
        ),
      );
    }
  }

  const limits = /** @type {Record<string, unknown> | undefined} */ (
    doc.limits
  );
  if (limits === undefined || limits.transport !== row.transport) {
    mismatches.push(
      finding(
        'TARGET_CAPABILITY_ROW_MISMATCH',
        'ARTIFACT_SAFETY_ERROR',
        `limits.transport must be "${row.transport}" for adapterId "${adapterId}".`,
        { location: '/limits/transport' },
      ),
    );
  }

  return mismatches;
}

/**
 * @param {import('./errors.js').ProtocolFinding[]} mismatches accumulator
 * @param {Record<string, unknown>} doc declaration under check
 * @param {string} field field name at the document root
 * @param {unknown} expected the exact required value
 * @returns {void}
 */
function checkField(mismatches, doc, field, expected) {
  if (doc[field] !== expected) {
    mismatches.push(
      finding(
        'TARGET_CAPABILITY_ROW_MISMATCH',
        'ARTIFACT_SAFETY_ERROR',
        `${field} must be exactly ${JSON.stringify(expected)}.`,
        { location: `/${field}` },
      ),
    );
  }
}
