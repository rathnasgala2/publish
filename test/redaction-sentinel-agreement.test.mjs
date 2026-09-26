/**
 * PUB-L1: `publish-kernel` and `adapter-github-pages` used to define their
 * own redaction placeholder independently (`'[REDACTED]'` vs `'[redacted]'`).
 * Both now import `@rathnasgala2/adapter-protocol`'s `REDACTION_PLACEHOLDER`;
 * this proves the value a caller actually sees from each package still
 * agrees with the protocol's own constant, so a future edit to one cannot
 * silently reintroduce the split.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REDACTION_PLACEHOLDER } from '@rathnasgala2/adapter-protocol';
import { redactSecrets } from '@rathnasgala2/publish-kernel';

// adapter-github-pages/src/redaction.js is internal (not part of the
// package's public root export), so this imports it directly by path --
// the same way test/adapter-version.test.mjs reaches into an adapter's
// internal capability.js for a cross-package agreement proof.
import { REDACTION_PLACEHOLDER as pagesPlaceholder } from '../packages/adapter-github-pages/src/redaction.js';

test('adapter-github-pages uses the same sentinel adapter-protocol defines', () => {
  assert.equal(pagesPlaceholder, REDACTION_PLACEHOLDER);
});

test('publish-kernel redactSecrets uses the same sentinel', () => {
  const redacted = /** @type {{apiKey: unknown}} */ (
    redactSecrets({ apiKey: 'sk-live-abcdefghijklmnopqrstuvwxyz' })
  );
  assert.equal(redacted.apiKey, REDACTION_PLACEHOLDER);
});
