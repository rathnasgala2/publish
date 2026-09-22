/**
 * Prove the reusable conformance suite is not vacuously green: run it, in a
 * genuinely isolated child `node --test` process, against a deliberately
 * broken fake adapter (`broken-fake-adapter.js`: `activate` never checks
 * `expectedArtifactDigest`, never invokes `crashInjectionHook`, and still
 * reads `expectedCurrentGenerationId: null` as "no fence"), and assert that
 * run FAILS — including, specifically, on the LOCAL-47 fence case, so the
 * suite is proven to actually catch an adapter that treats `null` as an
 * unfenced publish rather than refusing it. This is the regression test for the review finding
 * that the digest-mismatch test's original `assert.fail`-inside-a-`try`
 * structure was satisfied even by an adapter with no integrity checking at
 * all: without this test, a future change could reintroduce a similarly
 * vacuous assertion and nothing here would notice.
 *
 * The broken-adapter suite run is spawned as a separate `node --test`
 * process (not executed in-process) so its expected test failures never
 * appear as failures of *this* package's own `npm test`.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The scratch script lives under the OS temp directory, and every import it
// makes is an absolute `file:` URL, so it needs no bare-specifier
// resolution and this test writes nothing at all inside the repository.
//
// That matters beyond tidiness: creating (or removing) any file inside a
// workspace package directory makes `npm ls` consider the install tree
// out of date, after which it stops reporting the `integrity` and
// development-scope facts that `cyclonedx-npm` records. A regeneration
// after this test therefore produced a *different* SBOM from the committed
// one, and `npm run verify` failed at `sbom:check` purely because a test
// had run first. Keeping the scratch file outside the package tree removes
// that coupling entirely.
const protocolEntry = pathToFileURL(
  path.join(here, '..', '..', 'adapter-protocol', 'src', 'index.js'),
).href;
const kitEntry = pathToFileURL(path.join(here, '..', 'src', 'index.js')).href;
const brokenAdapterModule = pathToFileURL(
  path.join(here, 'broken-fake-adapter.js'),
).href;
const fakeAdapterHelpers = pathToFileURL(
  path.join(here, 'fake-adapter.js'),
).href;

const SCRIPT = `
import { fenceFor, generateUuidV7 } from ${JSON.stringify(protocolEntry)};
import { randomUUID } from 'node:crypto';
import { runAdapterConformanceSuite } from ${JSON.stringify(kitEntry)};
import { brokenFakeAdapterModule } from ${JSON.stringify(brokenAdapterModule)};
import { computeArtifactDigest, createFakeDestination } from ${JSON.stringify(fakeAdapterHelpers)};

function buildFiles(seed) {
  return [
    { path: 'index.html', bytes: Buffer.from(\`<html>seed-\${seed}</html>\`) },
    { path: 'about/index.html', bytes: Buffer.from(\`about-\${seed}\`) },
  ];
}

runAdapterConformanceSuite({
  adapterModule: brokenFakeAdapterModule,
  adapterId: 'local-directory',
  async createDestination() {
    const { destination } = createFakeDestination();
    return { destination, teardown: async () => undefined };
  },
  computeArtifactDigest,
  makeFiles: buildFiles,
  async tamperServedByte(destination, generationId) {
    const release = destination.releases.get(generationId);
    if (release && release.files.length > 0) {
      const file = release.files[0];
      const tampered = Buffer.from(file.bytes);
      tampered.writeUInt8((tampered.readUInt8(0) + 1) % 256, 0);
      file.bytes = tampered;
    }
  },
  async simulateInterruptedActivation(destination, seed) {
    const files = buildFiles(seed);
    const artifactDigest = computeArtifactDigest(files);
    const generationId = generateUuidV7();
    const staged = await brokenFakeAdapterModule.stage({
      destination,
      operationId: randomUUID(),
      attemptId: randomUUID(),
      idempotencyKey: randomUUID(),
      generationId,
      artifactId: generateUuidV7(),
      artifactDigest,
      files,
    });
    let threw = false;
    try {
      await brokenFakeAdapterModule.activate({
        destination,
        stageToken: staged.stageToken,
        generationId,
        expectedCurrentGenerationId: fenceFor(destination.current),
        crashInjectionHook: () => {
          throw new Error('INJECTED_ACTIVATION_CRASH: simulated interruption');
        },
      });
    } catch (error) {
      threw = true;
      if (!/INJECTED_ACTIVATION_CRASH/.test(error.message)) {
        throw error;
      }
    }
    if (!threw) {
      throw new Error('simulateInterruptedActivation: the crash injection hook did not interrupt activation');
    }
    return { stageToken: staged.stageToken, generationId };
  },
});
`;

test('runAdapterConformanceSuite fails (does not vacuously pass) against a deliberately broken adapter', async () => {
  const scratchDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gala-broken-suite-'),
  );
  const scriptPath = path.join(
    scratchDirectory,
    `broken-suite-${randomBytes(4).toString('hex')}.mjs`,
  );
  try {
    await writeFile(scriptPath, SCRIPT, 'utf8');
    // `node --test` refuses to run recursively when it detects it is
    // already executing inside a test-runner process (it propagates that
    // fact to child processes via `NODE_TEST_CONTEXT`); this spawn is a
    // genuinely separate, isolated conformance run, not a recursive test
    // invocation, so that marker is stripped from the child's environment.
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', scriptPath], {
      encoding: 'utf8',
      env: childEnv,
    });
    assert.notEqual(
      result.status,
      0,
      `expected the conformance suite to FAIL against a broken adapter, but the child process exited 0.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const combined = `${result.stdout}\n${result.stderr}`;
    assert.match(
      combined,
      /fail [1-9]/u,
      `expected at least one failing test in the child run's summary.\n${combined}`,
    );
    // Specifically: the suite must catch the LOCAL-47 defect — an adapter
    // that still reads `expectedCurrentGenerationId: null` as "no fence"
    // instead of refusing it. Without this assertion the fence cases could
    // be reintroduced vacuously and nothing here would notice.
    assert.match(
      combined,
      /✖ .*LOCAL-47 — activate refuses expectedCurrentGenerationId: null/u,
      `expected the LOCAL-47 null-fence conformance case to FAIL against the broken adapter.\n${combined}`,
    );
  } finally {
    await rm(scratchDirectory, { force: true, recursive: true });
  }
});
