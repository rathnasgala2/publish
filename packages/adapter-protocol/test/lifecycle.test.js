import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AdapterProtocolError } from '../src/errors.js';
import { LIFECYCLE_OPERATIONS, defineAdapter } from '../src/lifecycle.js';

test('LIFECYCLE_OPERATIONS is exactly the eight mandatory function names', () => {
  assert.deepEqual(
    [...LIFECYCLE_OPERATIONS].sort(),
    [
      'activate',
      'cleanupStaged',
      'describeCapabilities',
      'inspectDestination',
      'observe',
      'preflight',
      'rollback',
      'stage',
    ].sort(),
  );
  assert.equal(LIFECYCLE_OPERATIONS.length, 8);
});

test('defineAdapter accepts a module exporting exactly the eight functions', () => {
  /** @type {Record<string, unknown>} */
  const moduleNamespace = {};
  for (const name of LIFECYCLE_OPERATIONS) {
    moduleNamespace[name] = () => name;
  }
  const lifecycle = /** @type {Record<string, () => unknown>} */ (
    /** @type {unknown} */ (defineAdapter(moduleNamespace))
  );
  for (const name of LIFECYCLE_OPERATIONS) {
    assert.equal(typeof lifecycle[name], 'function');
    assert.equal(lifecycle[name]?.(), name);
  }
  assert.ok(Object.isFrozen(lifecycle));
});

test('defineAdapter tolerates extra named exports', () => {
  /** @type {Record<string, unknown>} */
  const moduleNamespace = { EXTRA_CONSTANT: 42 };
  for (const name of LIFECYCLE_OPERATIONS) {
    moduleNamespace[name] = () => undefined;
  }
  assert.doesNotThrow(() => defineAdapter(moduleNamespace));
});

test('defineAdapter rejects a module missing one lifecycle function', () => {
  /** @type {Record<string, unknown>} */
  const moduleNamespace = {};
  for (const name of LIFECYCLE_OPERATIONS) {
    if (name !== 'rollback') {
      moduleNamespace[name] = () => undefined;
    }
  }
  assert.throws(
    () => defineAdapter(moduleNamespace),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings.some(
        (finding) =>
          finding.code === 'ADAPTER_LIFECYCLE_FUNCTION_MISSING' &&
          finding.location === '/rollback',
      ),
  );
});

test('defineAdapter rejects a module where a lifecycle export is not a function', () => {
  /** @type {Record<string, unknown>} */
  const moduleNamespace = {};
  for (const name of LIFECYCLE_OPERATIONS) {
    moduleNamespace[name] = () => undefined;
  }
  moduleNamespace.stage = 'not-a-function';
  assert.throws(
    () => defineAdapter(moduleNamespace),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings.some(
        (finding) =>
          finding.code === 'ADAPTER_LIFECYCLE_FUNCTION_MISSING' &&
          finding.location === '/stage',
      ),
  );
});

test('defineAdapter rejects a module with a default export', () => {
  /** @type {Record<string, unknown>} */
  const moduleNamespace = { default: () => undefined };
  for (const name of LIFECYCLE_OPERATIONS) {
    moduleNamespace[name] = () => undefined;
  }
  assert.throws(
    () => defineAdapter(moduleNamespace),
    (error) =>
      error instanceof AdapterProtocolError &&
      error.findings.some(
        (finding) => finding.code === 'ADAPTER_DEFAULT_EXPORT_FORBIDDEN',
      ),
  );
});

test('defineAdapter reports every missing function at once', () => {
  try {
    defineAdapter({ describeCapabilities: () => undefined });
    assert.fail('expected AdapterProtocolError');
  } catch (error) {
    assert.ok(error instanceof AdapterProtocolError);
    const missing = error.findings
      .filter(
        (finding) => finding.code === 'ADAPTER_LIFECYCLE_FUNCTION_MISSING',
      )
      .map((finding) => finding.location);
    assert.equal(missing.length, LIFECYCLE_OPERATIONS.length - 1);
  }
});
