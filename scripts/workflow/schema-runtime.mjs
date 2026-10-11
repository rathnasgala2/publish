/**
 * Resolve the schema runtime used by workflow-side validation. Production
 * imports the exact package dependency; focused pre-release tests use the
 * real `<WORKSPACE_ROOT>/schema` sibling when present, without fabricating a
 * package-lock or registry installation.
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

/** The active document validator. */
export const validateGalaDocument = schemasModule.validateGalaDocument;
