/**
 * Credential-hygiene proof.
 *
 * The deploy job runs in the author's CI with the author's keys, so the one
 * failure that must be impossible is a key reaching something the run
 * publishes: a journal, an evidence file, a job output, a capability
 * declaration or an error message. This test drives a complete Spaces
 * lifecycle with deliberately distinctive credential values, then scans
 * every artefact the run produces — including the thrown errors — for any
 * byte of them.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { EXPECT_NOTHING_SERVED } from '@rathnasgala2/adapter-protocol';

import * as spaces from '@rathnasgala2/adapter-do-spaces';
import { startFakeSpaces } from '../packages/adapter-do-spaces/test/fake-s3-server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Values no published artefact may ever contain. */
const SECRETS = Object.freeze({
  accessKeyId: 'DO00CANARYACCESSKEYID',
  secretAccessKey: 'canary-secret-access-key-6f2b1d',
  sessionToken: 'canary-session-token-9a7c4e',
});

/**
 * @param {unknown} value the value to scan
 * @param {string} what what the value is, for the failure message
 * @returns {void}
 */
function assertSecretFree(value, what) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const [name, secret] of Object.entries(SECRETS)) {
    assert.ok(
      !String(serialized).includes(secret),
      `${what} contains the ${name}`,
    );
  }
}

test('no credential byte reaches any artefact a Spaces run produces', async () => {
  const provider = await startFakeSpaces({
    servedBucket: 'gala-served-hygiene',
    stagingBucket: 'gala-staging-hygiene',
    accessKeyId: SECRETS.accessKeyId,
    secretAccessKey: SECRETS.secretAccessKey,
  });
  const destination = {
    region: provider.region,
    servedBucket: provider.servedBucket,
    stagingBucket: provider.stagingBucket,
    accessKeyId: SECRETS.accessKeyId,
    secretAccessKey: SECRETS.secretAccessKey,
    sessionToken: SECRETS.sessionToken,
    fetch: provider.fetch,
  };

  // The capability declaration is published to Gala verbatim.
  assertSecretFree(
    await spaces.describeCapabilities(destination),
    'the capability declaration',
  );

  const files = [
    { path: 'index.html', bytes: Buffer.from('<!doctype html>hi', 'utf8') },
  ];
  const generationId = spaces.generateUuidV7();
  const staged = await spaces.stage({
    destination,
    operationId: spaces.generateUuidV7(),
    attemptId: spaces.generateUuidV7(),
    idempotencyKey: spaces.generateUuidV7(),
    generationId,
    artifactId: spaces.generateUuidV7(),
    artifactDigest: spaces.computeArtifactDigest(files),
    files,
  });
  assertSecretFree(staged, 'the stage result');

  const activation = await spaces.activate({
    destination,
    stageToken: /** @type {string} */ (staged.stageToken),
    generationId,
    expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    expectedArtifactDigest: spaces.computeArtifactDigest(files),
  });
  assertSecretFree(activation, 'the activation decision');
  assertSecretFree(
    await spaces.inspectDestination(destination),
    'the inspection result',
  );
  assertSecretFree(
    await spaces.cleanupStaged({
      destination,
      stageToken: /** @type {string} */ (staged.stageToken),
    }),
    'the cleanup result',
  );

  // Every object the run left in either bucket, including the public
  // marker, is scanned: a credential must not be persisted at the
  // destination either.
  for (const [bucket, store] of provider.buckets) {
    for (const [key, object] of store) {
      assertSecretFree(object.bytes.toString('utf8'), `${bucket}/${key}`);
    }
  }

  // Failure paths are the usual leak: a typed error must name the call, not
  // the credential that signed it. The fence must agree with what is now
  // served, because a disagreeing fence is answered with a `reconcile`
  // decision before the stage is ever looked up (LOCAL-47) — and this
  // assertion is about the *thrown* path, not the fenced one.
  await assert.rejects(
    spaces.activate({
      destination,
      stageToken: 'no-such-stage-token',
      generationId: spaces.generateUuidV7(),
      expectedCurrentGenerationId: generationId,
    }),
    (error) => {
      assertSecretFree(String(error), 'a thrown activation error');
      assertSecretFree(
        /** @type {Error} */ (error).stack ?? '',
        'a thrown activation stack',
      );
      return true;
    },
  );

  // The fenced path is a decision rather than a throw, and it is published
  // to the kernel journal, so it is scanned too.
  assertSecretFree(
    await spaces.activate({
      destination,
      stageToken: 'no-such-stage-token',
      generationId: spaces.generateUuidV7(),
      expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    }),
    'a fenced-off activation decision',
  );

  await provider.stop();
});

test('no line that builds a published document mentions a credential', () => {
  // Static companion to the runtime scan above: in each writer that emits a
  // published artefact, no line that contributes to the document may name a
  // credential. The credentials may be read (the adapter needs them), just
  // never on a line that assembles what the run publishes.
  const CREDENTIAL_NAMES = [
    'CALLER_DO_SPACES_ACCESS_KEY_ID',
    'CALLER_DO_SPACES_SECRET_ACCESS_KEY',
    'CALLER_DO_SPACES_SESSION_TOKEN',
    'DO_SPACES_CONTROL_ACCESS_KEY_ID',
    'DO_SPACES_CONTROL_SECRET_ACCESS_KEY',
    'DO_SPACES_CONTROL_SESSION_TOKEN',
    'accessKeyId',
    'secretAccessKey',
    'sessionToken',
    // The two workload credentials: the single-use OIDC assertion and the
    // single-use reporting capability. Neither may be read on a line that
    // builds a journal, an evidence record or a submission.
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    'REPORTING_CAPABILITY',
    'assertion',
    'oidc.token',
  ];
  for (const file of [
    'scripts/workflow/deploy.mjs',
    'scripts/workflow/verify-spaces-configuration.mjs',
    'scripts/workflow/report.mjs',
    'scripts/workflow/exchange.mjs',
    'scripts/workflow/gala-api.mjs',
    'scripts/workflow/kernel-run.mjs',
    'scripts/workflow/workload-requests.mjs',
  ]) {
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (
        !/journal\.|journal =|evidence\.|evidence =|submission\.|submission =/u.test(
          line,
        )
      ) {
        continue;
      }
      for (const name of CREDENTIAL_NAMES) {
        assert.ok(
          !line.includes(name),
          `${file}:${index + 1} builds a published document from ${name}`,
        );
      }
    }
  }
});
