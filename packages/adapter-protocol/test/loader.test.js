import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AdapterProtocolError } from '../src/errors.js';
import { LIFECYCLE_OPERATIONS } from '../src/lifecycle.js';
import { loadAdapterModule } from '../src/loader.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} name fixture file basename under test/fixtures/adapters
 * @returns {string} an absolute file: URL specifier
 */
function fixtureSpecifier(name) {
  return pathToFileURL(path.join(here, 'fixtures', 'adapters', name)).href;
}

test('loadAdapterModule loads a valid in-process adapter module', async () => {
  const lifecycle = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (
      await loadAdapterModule(fixtureSpecifier('valid-adapter.js'))
    )
  );
  for (const name of LIFECYCLE_OPERATIONS) {
    assert.equal(typeof lifecycle[name], 'function');
  }
});

test('loadAdapterModule rejects a module missing a lifecycle function', async () => {
  await assert.rejects(
    () => loadAdapterModule(fixtureSpecifier('missing-function-adapter.js')),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings.some(
        (finding) =>
          finding.code === 'ADAPTER_LIFECYCLE_FUNCTION_MISSING' &&
          finding.location === '/rollback',
      ),
  );
});

test('loadAdapterModule rejects a module with a default export', async () => {
  await assert.rejects(
    () => loadAdapterModule(fixtureSpecifier('default-export-adapter.js')),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings.some(
        (finding) => finding.code === 'ADAPTER_DEFAULT_EXPORT_FORBIDDEN',
      ),
  );
});
