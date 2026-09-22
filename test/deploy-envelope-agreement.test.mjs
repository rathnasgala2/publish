/**
 * `deploy.mjs` deploys only the envelope the intent authorizes: the three
 * metadata digests the envelope decoder recomputes (`manifestDigest`,
 * `provenanceDigest`, `sbomDigest`) must be the ones the retained intent
 * binds (DEC-097 section 6), and a disagreement on any of them is refused
 * by name before any adapter module is loaded and before the kernel is
 * driven — so no staging call is ever made for a substituted envelope.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { requireEnvelopeIntentAgreement } from '../scripts/workflow/deploy.mjs';

const DEPLOY_SOURCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../scripts/workflow/deploy.mjs',
);

/**
 * @param {string} seed a distinct seed
 * @returns {string} a well-formed tagged digest
 */
function digestOf(seed) {
  return `sha256:${seed.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)}`;
}

const ENVELOPE = Object.freeze({
  manifestDigest: digestOf('m'),
  provenanceDigest: digestOf('p'),
  sbomDigest: digestOf('s'),
});

test('an intent binding exactly the envelope’s three digests is accepted', () => {
  assert.doesNotThrow(() =>
    requireEnvelopeIntentAgreement({ ...ENVELOPE, artifactId: 'x' }, ENVELOPE),
  );
});

for (const member of ['manifestDigest', 'provenanceDigest', 'sbomDigest']) {
  test(`an intent whose ${member} is not the envelope’s is refused by name`, () => {
    assert.throws(
      () =>
        requireEnvelopeIntentAgreement(
          { ...ENVELOPE, [member]: digestOf('z') },
          ENVELOPE,
        ),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^DEPLOY_ENVELOPE_INTENT_MISMATCH: /u);
        assert.ok(error.message.includes(member), error.message);
        return true;
      },
    );
  });
  test(`an intent missing ${member} is refused, not treated as agreement`, () => {
    const intent = /** @type {Record<string, unknown>} */ ({ ...ENVELOPE });
    delete intent[member];
    assert.throws(
      () => requireEnvelopeIntentAgreement(intent, ENVELOPE),
      /DEPLOY_ENVELOPE_INTENT_MISMATCH/u,
    );
  });
}

test('deploy.mjs refuses the disagreement before any adapter is imported and before the kernel is driven (no staging call)', async () => {
  const source = await readFile(DEPLOY_SOURCE, 'utf8');
  const mainStart = source.indexOf('async function main()');
  assert.ok(mainStart > 0, 'main() is where the job runs');
  const main = source.slice(mainStart);
  const agreement = main.indexOf(
    'requireEnvelopeIntentAgreement(intent, envelope)',
  );
  const firstAdapterImport = main.indexOf(
    "await import('@rathnasgala2/adapter-",
  );
  const kernelRun = main.indexOf('await runKernelDeployment(');
  assert.ok(agreement > 0, 'main() requires the agreement');
  assert.ok(firstAdapterImport > 0 && kernelRun > 0);
  assert.ok(
    agreement < firstAdapterImport,
    'the agreement is required before the adapter module is loaded',
  );
  assert.ok(
    agreement < kernelRun,
    'the agreement is required before the kernel drives any stage',
  );
  assert.equal(
    main.indexOf('proveLimitedKeyAccessDenied') > agreement,
    true,
    'the first destination contact (the Spaces limited-key proof) comes after the agreement',
  );
});
