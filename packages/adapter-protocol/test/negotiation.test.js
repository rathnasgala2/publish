import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AdapterProtocolError } from '../src/errors.js';
import {
  negotiateCapability,
  requireCapabilityMatch,
} from '../src/negotiation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    path.join(here, 'fixtures', 'lowercase-capabilities.json'),
    'utf8',
  ),
);

/**
 * @param {string} caseId fixture case identity
 * @returns {any} the case's instance document
 */
function fixtureInstance(caseId) {
  return fixture.cases.find(
    (/** @type {{ caseId: string }} */ entry) => entry.caseId === caseId,
  ).instance;
}

const localDirectory = fixtureInstance(
  'capability-local-directory-valid-lowercase',
);
const githubPages = fixtureInstance('capability-github-pages-valid-lowercase');
const doSpaces = fixtureInstance('capability-do-spaces-valid-lowercase');

test('negotiateCapability is satisfied when every requirement matches the declaration', () => {
  const decision = negotiateCapability(localDirectory, {
    destinationKind: 'local-directory',
    concurrency: 'expected-generation',
    verification: ['artifact-digest'],
  });
  assert.equal(decision.satisfied, true);
  assert.ok(decision.outcomes.every((entry) => entry.satisfied));
  assert.equal(decision.decisionDigest.startsWith('sha256:'), true);
});

test('negotiateCapability with no requirements is trivially satisfied', () => {
  const decision = negotiateCapability(localDirectory, {});
  assert.equal(decision.satisfied, true);
  assert.deepEqual(decision.outcomes, []);
});

test('negotiateCapability is unsatisfied when concurrency does not match (DEC-020 example)', () => {
  // "a profile requiring expected-generation fencing rejects an adapter
  // declaring concurrency: none" — github-pages truthfully declares `none`.
  const decision = negotiateCapability(githubPages, {
    concurrency: 'expected-generation',
  });
  assert.equal(decision.satisfied, false);
  assert.deepEqual(decision.outcomes[0], {
    capability: 'concurrency',
    required: 'expected-generation',
    declared: 'none',
    satisfied: false,
  });
});

test('negotiateCapability checks destinationKind against the declared set', () => {
  const decision = negotiateCapability(doSpaces, {
    destinationKind: 'github-pages',
  });
  assert.equal(decision.satisfied, false);
});

test('negotiateCapability checks a verification requirement not fully covered', () => {
  const decision = negotiateCapability(githubPages, {
    verification: ['artifact-digest'],
  });
  assert.equal(decision.satisfied, false);
});

test('negotiateCapability checks transport', () => {
  assert.equal(
    negotiateCapability(localDirectory, { transport: 'filesystem' }).satisfied,
    true,
  );
  assert.equal(
    negotiateCapability(localDirectory, { transport: 'http' }).satisfied,
    false,
  );
});

test('negotiateCapability checks configuration booleans, including the Spaces exception', () => {
  assert.equal(
    negotiateCapability(doSpaces, {
      configuration: { notFoundBehavior: true },
    }).satisfied,
    true,
  );
  assert.equal(
    negotiateCapability(localDirectory, {
      configuration: { notFoundBehavior: true },
    }).satisfied,
    false,
  );
});

test('negotiateCapability throws when the declaration itself is invalid', () => {
  assert.throws(
    () => negotiateCapability({ not: 'a capability' }, {}),
    AdapterProtocolError,
  );
});

test('negotiateCapability decisionDigest is deterministic for the same inputs', () => {
  const first = negotiateCapability(localDirectory, {
    concurrency: 'expected-generation',
  });
  const second = negotiateCapability(localDirectory, {
    concurrency: 'expected-generation',
  });
  assert.equal(first.decisionDigest, second.decisionDigest);
});

test('negotiateCapability decisionDigest changes when requirements change', () => {
  const first = negotiateCapability(localDirectory, {
    concurrency: 'expected-generation',
  });
  const second = negotiateCapability(localDirectory, {
    concurrency: 'best-effort',
  });
  assert.notEqual(first.decisionDigest, second.decisionDigest);
});

test('requireCapabilityMatch returns the decision when satisfied', () => {
  const decision = requireCapabilityMatch(localDirectory, {
    destinationKind: 'local-directory',
  });
  assert.equal(decision.satisfied, true);
});

test('requireCapabilityMatch throws TARGET_CAPABILITY_UNAVAILABLE before staging when unmet', () => {
  try {
    requireCapabilityMatch(githubPages, { concurrency: 'expected-generation' });
    assert.fail('expected AdapterProtocolError');
  } catch (error) {
    assert.ok(error instanceof AdapterProtocolError);
    assert.ok(
      error.findings.every(
        (finding) => finding.code === 'TARGET_CAPABILITY_UNAVAILABLE',
      ),
    );
    assert.equal(error.findings.length, 1);
  }
});

test('requireCapabilityMatch reports one finding per unmet requirement', () => {
  try {
    requireCapabilityMatch(localDirectory, {
      concurrency: 'best-effort',
      staging: 'private',
    });
    assert.fail('expected AdapterProtocolError');
  } catch (error) {
    assert.ok(error instanceof AdapterProtocolError);
    assert.equal(error.findings.length, 2);
  }
});

test('property: negotiating against the exact declared values is always satisfied', () => {
  for (const declaration of [localDirectory, githubPages, doSpaces]) {
    for (let trial = 0; trial < 10; trial += 1) {
      const decision = negotiateCapability(declaration, {
        destinationKind: declaration.destinationKinds[0],
        staging: declaration.staging,
        activation: declaration.activation,
        concurrency: declaration.concurrency,
        idempotencyClass: declaration.idempotencyClass,
        providerInventoryAssurance: declaration.providerInventoryAssurance,
        transport: declaration.limits.transport,
      });
      assert.equal(decision.satisfied, true);
    }
  }
});

test('property: negotiating against a value the adapter never declares is always unsatisfied', () => {
  const impossible = ['definitely-not-a-real-capability-value'];
  for (const declaration of [localDirectory, githubPages, doSpaces]) {
    for (const field of [
      'staging',
      'activation',
      'concurrency',
      'idempotencyClass',
    ]) {
      const decision = negotiateCapability(declaration, {
        [field]: impossible[0],
      });
      assert.equal(decision.satisfied, false);
    }
  }
});
