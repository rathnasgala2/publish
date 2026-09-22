import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PACKAGE_STATUS } from '../src/index.js';

test('the package reports itself as implemented (S2-T20)', () => {
  assert.equal(PACKAGE_STATUS.implemented, true);
  assert.equal(PACKAGE_STATUS.implementingTask, 'S2-T20b');
});
