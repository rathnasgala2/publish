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

test('loadAdapterModule refuses a specifier that is neither admitted nor a file: URL (PUB-M8)', async () => {
  await assert.rejects(
    () => loadAdapterModule('@rathnasgala2/adapter-not-a-real-adapter'),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings.some(
        (finding) => finding.code === 'ADAPTER_SPECIFIER_NOT_ADMITTED',
      ),
  );
});

test('loadAdapterModule refuses a relative-path specifier', async () => {
  await assert.rejects(
    () => loadAdapterModule('./sneaky-adapter.js'),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings.some(
        (finding) => finding.code === 'ADAPTER_SPECIFIER_NOT_ADMITTED',
      ),
  );
});

test('loadAdapterModule refuses an http(s) URL specifier', async () => {
  await assert.rejects(
    () => loadAdapterModule('https://example.test/adapter.js'),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings.some(
        (finding) => finding.code === 'ADAPTER_SPECIFIER_NOT_ADMITTED',
      ),
  );
});

test("design check: a file: specifier with a .. segment resolves and loads normally (the loader trusts its caller for file: paths; containment is the composition root's responsibility, not this allowlist's)", async () => {
  const traversal = pathToFileURL(
    path.join(here, 'fixtures', 'adapters', 'nested', '..', 'valid-adapter.js'),
  ).href;
  // The URL constructor normalizes the .. segment away before loadAdapterModule
  // ever sees the string, so this is not a path-traversal vector: it resolves
  // to exactly the same file a non-traversing specifier would name.
  assert.ok(!traversal.includes('..'));
  const lifecycle = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (await loadAdapterModule(traversal))
  );
  for (const name of LIFECYCLE_OPERATIONS) {
    assert.equal(typeof lifecycle[name], 'function');
  }
});
