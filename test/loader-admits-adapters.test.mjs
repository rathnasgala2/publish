/**
 * PUB-M8: `loadAdapterModule` now refuses any specifier that is not one of
 * the three admitted adapter package specifiers or a `file:` URL. This is
 * the repository-level proof that the allowlist is not merely
 * self-consistent but actually admits and loads the three real, published
 * adapters -- `adapter-protocol` itself stays dependency-free (its own
 * package.json declares none of the three as a dependency), so this
 * cross-package proof lives here rather than in that package's own test
 * suite.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LIFECYCLE_OPERATIONS,
  loadAdapterModule,
} from '@rathnasgala2/adapter-protocol';

test('loadAdapterModule admits and loads the three closed adapter package specifiers', async () => {
  for (const specifier of [
    '@rathnasgala2/adapter-local-directory',
    '@rathnasgala2/adapter-github-pages',
    '@rathnasgala2/adapter-do-spaces',
  ]) {
    const lifecycle = /** @type {Record<string, unknown>} */ (
      /** @type {unknown} */ (await loadAdapterModule(specifier))
    );
    for (const operation of LIFECYCLE_OPERATIONS) {
      assert.equal(
        typeof lifecycle[operation],
        'function',
        `${specifier} must export ${operation}`,
      );
    }
  }
});
