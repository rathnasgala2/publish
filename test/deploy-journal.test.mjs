/**
 * `deploy.mjs` writes exactly one kernel journal on every exit.
 *
 * Production incident 2026-10-21: an uncaught adapter exception ended the
 * deploy before it wrote its journal, the journal upload failed with ENOENT,
 * the report job was skipped and the destination fence stayed held. These
 * tests drive the real `runDeploy` over a real inbox (the fixture envelope and
 * authorization carriers) and stop it at each exit path the incident analysis
 * lists, asserting the journal that path leaves behind: `outcome: failed`, the
 * classified `failure: {code, stage, message}`, and the identity members known
 * by then.
 */

import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import * as pages from '@rathnasgala2/adapter-github-pages';

import { carrierDigest } from '../scripts/workflow/carrier.mjs';
import { requireCapabilityDecisionAgreement } from '../scripts/workflow/capability-decision.mjs';
import { classifyFailure, runDeploy } from '../scripts/workflow/deploy.mjs';
import { buildDeploymentIntentRequest } from '../scripts/workflow/workload-requests.mjs';
import { frozenEnvelopeFor } from './fixtures/artifact-manifest.mjs';
import {
  ARTIFACT_FILES,
  authorizationInput,
} from './fixtures/authorization-input.mjs';
import {
  renderIntent,
  seedWithDefaults,
  stableId,
} from './fixtures/fake-gala-api.mjs';

const REPOSITORY = 'gala-author/site';
const REPOSITORY_ID = '4242';
const RUN_ID = '987654321';
const OPERATION_ID = stableId();
const OIDC_URL =
  'https://pipelinesghubeus2.actions.githubusercontent.com/ORG/PROJ/_apis/distributedtask/hubs/Actions/plans/PLAN/jobs/JOB/idtoken?api-version=2.0';
const FAKE_TOKEN = ['eyJhbGciOiJSUzI1NiJ9', 'eyJpc3MiOiJmYWtlIn0', 'c2ln'].join(
  '.',
);
const SEED = Object.freeze({
  galaIssuer: 'https://api.gala.example/',
  repository: REPOSITORY,
  repositoryId: REPOSITORY_ID,
  operationId: OPERATION_ID,
  policyReleaseId: '019c0000-0000-7000-8000-0000000000bb',
});

/** The environment a Pages deploy job sees; restored after every test. */
const RUNNER_ENV = Object.freeze({
  GITHUB_REPOSITORY: REPOSITORY,
  GITHUB_REF: `refs/heads/gala/publish/${OPERATION_ID}`,
  GITHUB_REPOSITORY_ID: REPOSITORY_ID,
  GITHUB_REPOSITORY_OWNER_ID: '99',
  GITHUB_RUN_ID: RUN_ID,
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: '1c14dcdff9501ef74b8b7a5897fba69c586fa76a',
  GALA_PUBLISH_TOOLCHAIN_SHA: 'b'.repeat(40),
  GH_TOKEN: 'installation-token',
  ACTIONS_ID_TOKEN_REQUEST_URL: OIDC_URL,
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-bearer',
});

/** The Spaces credentials a test may set; absent unless it does. */
const SPACES_CREDENTIALS = Object.freeze([
  'CALLER_DO_SPACES_ACCESS_KEY_ID',
  'CALLER_DO_SPACES_SECRET_ACCESS_KEY',
  'CALLER_DO_SPACES_SESSION_TOKEN',
]);

/** @type {Record<string, string | undefined>} */
let savedEnv;
const savedFetch = globalThis.fetch;
const savedStderr = process.stderr.write;
/** @type {string[]} */
let stderr;
/** @type {string} */
let dir;

beforeEach(async () => {
  savedEnv = { ...process.env };
  Object.assign(process.env, RUNNER_ENV);
  for (const name of SPACES_CREDENTIALS) {
    delete process.env[name];
  }
  stderr = [];
  process.stderr.write = /** @type {any} */ (
    (/** @type {string} */ chunk) => {
      stderr.push(String(chunk));
      return true;
    }
  );
  dir = await mkdtemp(path.join(tmpdir(), 'gala-deploy-journal-'));
});

afterEach(async () => {
  process.stderr.write = savedStderr;
  globalThis.fetch = savedFetch;
  for (const name of [...Object.keys(RUNNER_ENV), ...SPACES_CREDENTIALS]) {
    if (savedEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnv[name];
    }
  }
  await rm(dir, { recursive: true, force: true });
});

/**
 * Lay out one inbox, the Pages carrier file and the argument list.
 *
 * @param {{
 *   envelopeFiles?: readonly {path: string, bytes: Buffer}[],
 *   artifactDigest?: string,
 *   mutateIntent?: (intent: Record<string, any>) => void,
 *   carrier?: boolean,
 *   authorization?: boolean,
 *   adapterId?: 'github-pages' | 'do-spaces',
 *   adapter?: string,
 *   out?: string
 * }} [options] the levers; the default is a fully valid github-pages run
 * @returns {Promise<{argv: string[], out: string, intent: Record<string, any>}>}
 *   the arguments, the journal path and the intent
 */
async function scenario(options = {}) {
  const inbox = path.join(dir, 'inbox');
  await mkdir(inbox, { recursive: true });
  const envelope = frozenEnvelopeFor(options.envelopeFiles ?? ARTIFACT_FILES);
  await writeFile(path.join(inbox, 'envelope.bin'), envelope.bytes);

  const adapterId = options.adapterId ?? 'github-pages';
  const spaces = adapterId === 'do-spaces';
  const { request, derived } = buildDeploymentIntentRequest(
    /** @type {any} */ (
      authorizationInput({
        adapterId,
        operationId: OPERATION_ID,
        repositoryId: REPOSITORY_ID,
        runId: RUN_ID,
        runAttempt: 1,
        ...(spaces
          ? {
              destination: {
                baseUrl:
                  'https://gala-newsletter-served.nyc3-static.digitaloceanspaces.com/',
              },
            }
          : {
              artifactDigest:
                options.artifactDigest ??
                pages.computeArtifactDigest(
                  options.envelopeFiles ?? ARTIFACT_FILES,
                ),
            }),
      })
    ),
  );
  const seed = seedWithDefaults({
    ...SEED,
    ...(spaces
      ? {
          destination: {
            adapterId: 'do-spaces',
            spaces: {
              region: 'nyc3',
              servedBucket: 'gala-newsletter-served',
              stagingBucket: 'gala-newsletter-staging',
              basePath: '/',
            },
          },
        }
      : {}),
  });
  const intent = renderIntent(request, seed, {
    intentId: stableId(),
    artifactId: derived.artifactId,
    attemptId: derived.attemptId,
    generationId: derived.proposedGenerationId,
    authorityId: stableId(),
    binding: { repositoryId: REPOSITORY_ID, runId: RUN_ID, runAttempt: 1 },
    ...(derived.pagesBuildVersion === undefined
      ? {}
      : { pagesBuildVersion: derived.pagesBuildVersion }),
    ...(derived.spacesStagePrefix === undefined
      ? {}
      : { spacesStagePrefix: derived.spacesStagePrefix }),
  });
  options.mutateIntent?.(intent);
  if (options.authorization !== false) {
    await writeFile(
      path.join(inbox, 'gala-r1-a1-deployment-authorization-v2.json'),
      JSON.stringify({
        deploymentIntent: intent,
        marker: intent.marker,
        responseKind: 'deployment-intent',
      }),
    );
  }
  const carrier = path.join(dir, 'pages-carrier');
  if (options.carrier !== false) {
    await writeFile(carrier, 'carrier bytes');
  }
  const out = options.out ?? path.join(dir, 'journal.jcs');
  return {
    intent,
    out,
    argv: [
      '--adapter',
      options.adapter ?? adapterId,
      '--inbox',
      inbox,
      '--envelope-digest',
      carrierDigest(envelope.bytes),
      '--pages-artifact-id',
      '11298103317',
      '--pages-artifact-digest',
      'a'.repeat(64),
      '--pages-carrier',
      carrier,
      '--out',
      out,
    ],
  };
}

/**
 * A fetch for everything a Pages deploy reaches over the network: the runner
 * token endpoint, GitHub's REST API, and the public origin.
 *
 * @param {{publicOrigin?: 'redirects' | 'not-found', publicUrls?: string[]}} [behaviour]
 *   how the public origin answers, and where to record every public URL read
 * @returns {typeof globalThis.fetch} the stub
 */
function networkStub(behaviour = {}) {
  return /** @type {typeof globalThis.fetch} */ (
    async (url, init = {}) => {
      const target = new URL(String(url));
      if (target.host === 'pipelinesghubeus2.actions.githubusercontent.com') {
        return new Response(JSON.stringify({ value: FAKE_TOKEN }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.host === 'api.github.com') {
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      behaviour.publicUrls?.push(String(url));
      if (behaviour.publicOrigin === 'redirects') {
        if (init.redirect === 'manual') {
          return new Response(null, {
            status: 301,
            headers: { location: 'https://www.example.com/' },
          });
        }
        throw new TypeError('fetch failed', {
          cause: new Error('unexpected redirect'),
        });
      }
      return new Response(null, { status: 404 });
    }
  );
}

/**
 * Name the verification base on an intent the way the API issues it: as a
 * destination member, covered by the capability decision digest.
 *
 * @param {Record<string, any>} intent the intent, changed in place
 * @param {string} base the verification base URL
 * @returns {void}
 */
function withVerificationBase(intent, base) {
  intent.destination.verificationBaseUrl = base;
  try {
    requireCapabilityDecisionAgreement(
      { ...intent, capabilityDecisionDigest: 'x' },
      { runId: RUN_ID, runAttempt: 1 },
    );
  } catch (error) {
    intent.capabilityDecisionDigest = /to (sha256:[0-9a-f]{64}),/u.exec(
      /** @type {Error} */ (error).message,
    )?.[1];
  }
}

/**
 * Run the deploy and return the journal it left, asserting it failed with the
 * given code and stage.
 *
 * @param {Awaited<ReturnType<typeof scenario>>} run the scenario
 * @param {string} code the expected failure code
 * @param {string} stage the expected failure stage
 * @returns {Promise<Record<string, any>>} the journal
 */
async function failsWithJournal(run, code, stage) {
  await assert.rejects(runDeploy(run.argv));
  const journal = JSON.parse(await readFile(run.out, 'utf8'));
  assert.equal(journal.outcome, 'failed');
  assert.equal(journal.schemaVersion, '2.0.0');
  assert.equal(journal.failure.code, code);
  assert.equal(journal.failure.stage, stage);
  assert.equal(typeof journal.failure.message, 'string');
  assert.ok(journal.failure.message.length > 0);
  assert.ok(
    !stderr.some((line) => line.includes('GALA_DEPLOY_NO_JOURNAL')),
    'a journal was written, so no marker is printed',
  );
  return journal;
}

/**
 * @param {Record<string, any>} journal a failure journal
 * @returns {void}
 */
function assertNoKernelEvidence(journal) {
  assert.deepEqual(journal.attempts, []);
  assert.deepEqual(journal.observations, []);
  assert.deepEqual(journal.observedRoutes, []);
}

test('the fixture run activates when nothing is wrong, and writes the kernel journal once', async () => {
  // The control for every failing case below: same inbox, same environment.
  globalThis.fetch = networkStub();
  const run = await scenario();
  await assert.rejects(runDeploy(run.argv), /DEPLOY_NOT_ACTIVATED/u);
  const journal = JSON.parse(await readFile(run.out, 'utf8'));
  assert.equal(journal.outcome, 'failed');
  assert.ok(journal.attempts.length > 0, 'the kernel ran and journalled');
  assert.equal(journal.lockedAdapterVersion, pages.ADAPTER_VERSION);
  assert.equal(journal.installedAdapterVersion, pages.ADAPTER_VERSION);
});

test('OPTIONS_INVALID: an unreadable or incomplete argument list leaves a journal at --out', async () => {
  const run = await scenario();
  const withoutAdapter = run.argv.filter(
    (_, index) => index !== 0 && index !== 1,
  );
  await assert.rejects(
    runDeploy(withoutAdapter),
    /WORKFLOW_ARGUMENT_REQUIRED/u,
  );
  const journal = JSON.parse(await readFile(run.out, 'utf8'));
  assert.equal(journal.failure.code, 'OPTIONS_INVALID');
  assert.equal(journal.failure.stage, 'options');
  assertNoKernelEvidence(journal);
});

test('OPTIONS_INVALID without --out has nowhere to write: the marker is printed', async () => {
  await assert.rejects(
    runDeploy(['--adapter']),
    /WORKFLOW_ARGUMENT_VALUE_MISSING/u,
  );
  assert.deepEqual(stderr, ['GALA_DEPLOY_NO_JOURNAL OPTIONS_INVALID\n']);
});

test('OPTIONS_INVALID: a malformed Pages artifact digest is refused as an option', async () => {
  globalThis.fetch = networkStub();
  const run = await scenario();
  run.argv[run.argv.indexOf('--pages-artifact-digest') + 1] = 'not-a-digest';
  const journal = await failsWithJournal(run, 'OPTIONS_INVALID', 'options');
  assert.match(
    journal.failure.message,
    /DEPLOY_PAGES_ARTIFACT_DIGEST_INVALID/u,
  );
  assert.equal(journal.adapterId, 'github-pages', 'the known identity is kept');
});

test('ENVELOPE_INVALID: an envelope that is not in the inbox', async () => {
  const run = await scenario();
  run.argv[run.argv.indexOf('--envelope-digest') + 1] =
    `sha256:${'0'.repeat(64)}`;
  const journal = await failsWithJournal(run, 'ENVELOPE_INVALID', 'envelope');
  assertNoKernelEvidence(journal);
});

test('AUTHORIZATION_INVALID: a missing authorization carrier', async () => {
  const run = await scenario({ authorization: false });
  const journal = await failsWithJournal(
    run,
    'AUTHORIZATION_INVALID',
    'authorization',
  );
  assert.match(journal.failure.message, /DEPLOYMENT_AUTHORIZATION_NOT_FOUND/u);
});

test('AUTHORIZATION_INVALID: an intent that names another adapter than the job selected', async () => {
  const run = await scenario({ adapter: 'do-spaces' });
  const journal = await failsWithJournal(
    run,
    'AUTHORIZATION_INVALID',
    'authorization',
  );
  assert.match(journal.failure.message, /DEPLOY_ADAPTER_MISMATCH/u);
});

test('AUTHORIZATION_INVALID: an authorization issued for another publish ref', async () => {
  const run = await scenario();
  process.env.GITHUB_REF = 'refs/heads/main';
  await failsWithJournal(run, 'AUTHORIZATION_INVALID', 'authorization');
});

test('INTENT_MISMATCH: an envelope whose records are not the ones the intent binds', async () => {
  const run = await scenario();
  const other = frozenEnvelopeFor([
    ...ARTIFACT_FILES,
    { path: 'extra.html', bytes: Buffer.from('<p>extra', 'utf8') },
  ]);
  await writeFile(path.join(dir, 'inbox', 'envelope.bin'), other.bytes);
  run.argv[run.argv.indexOf('--envelope-digest') + 1] = carrierDigest(
    other.bytes,
  );
  const journal = await failsWithJournal(run, 'INTENT_MISMATCH', 'intent');
  assert.match(journal.failure.message, /DEPLOY_ENVELOPE_INTENT_MISMATCH/u);
  assert.equal(journal.operationId, OPERATION_ID, 'the bound identity is kept');
  assert.equal(journal.authorization.intentDigest.startsWith('sha256:'), true);
});

test('CAPABILITY_MISMATCH: a capability decision that does not recompute to the intent’s digest', async () => {
  const run = await scenario({
    mutateIntent(intent) {
      intent.capabilityDecisionDigest = `sha256:${'9'.repeat(64)}`;
    },
  });
  const journal = await failsWithJournal(
    run,
    'CAPABILITY_MISMATCH',
    'capability-decision',
  );
  assertNoKernelEvidence(journal);
});

test('CARRIER_UNREADABLE: the Pages carrier file is missing', async () => {
  globalThis.fetch = networkStub();
  const run = await scenario({ carrier: false });
  const journal = await failsWithJournal(run, 'CARRIER_UNREADABLE', 'carrier');
  assert.match(journal.failure.message, /ENOENT/u);
  assert.equal(journal.pagesOidcTokenAcquired, undefined);
});

test('OIDC_FAILED: the job holds no runner token endpoint', async () => {
  globalThis.fetch = networkStub();
  const run = await scenario();
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const journal = await failsWithJournal(run, 'OIDC_FAILED', 'oidc');
  assert.match(journal.failure.message, /id-token: write/u);
  assert.equal(journal.pagesCarrierDigest.startsWith('sha256:'), true);
});

test('BINDING_INVALID: the installation token is absent', async () => {
  globalThis.fetch = networkStub();
  const run = await scenario();
  delete process.env.GH_TOKEN;
  const journal = await failsWithJournal(run, 'BINDING_INVALID', 'destination');
  assert.match(journal.failure.message, /GH_TOKEN/u);
  assert.equal(
    journal.pagesOidcTokenAcquired,
    true,
    'the journal records how far the job got',
  );
  assert.ok(!JSON.stringify(journal).includes(FAKE_TOKEN));
});

test('DIGEST_MISMATCH: the envelope digests to something the intent did not authorize', async () => {
  globalThis.fetch = networkStub();
  const run = await scenario({
    artifactDigest: `sha256:${'7'.repeat(64)}`,
  });
  const journal = await failsWithJournal(
    run,
    'DIGEST_MISMATCH',
    'artifact-digest',
  );
  assert.match(journal.failure.message, /not the sha256:7{64} the intent/u);
  assert.equal(
    journal.artifactDigest,
    pages.computeArtifactDigest(ARTIFACT_FILES),
  );
});

test('BINDING_INVALID: a Spaces job without its caller-mapped limited key', async () => {
  const run = await scenario({ adapterId: 'do-spaces' });
  const journal = await failsWithJournal(run, 'BINDING_INVALID', 'destination');
  assert.match(journal.failure.message, /CALLER_DO_SPACES_ACCESS_KEY_ID/u);
  assert.equal(journal.adapterId, 'do-spaces');
  assert.ok(journal.capabilityDecision.issuancePhaseDigest);
});

test('CREDENTIAL_PROOF_FAILED: a limited key that can read a bucket configuration', async () => {
  process.env.CALLER_DO_SPACES_ACCESS_KEY_ID = 'limited-id';
  process.env.CALLER_DO_SPACES_SECRET_ACCESS_KEY = 'limited-secret';
  globalThis.fetch = /** @type {typeof globalThis.fetch} */ (
    async () => new Response('<Configuration/>', { status: 200 })
  );
  const run = await scenario({ adapterId: 'do-spaces' });
  const journal = await failsWithJournal(
    run,
    'CREDENTIAL_PROOF_FAILED',
    'credential-proof',
  );
  assert.match(journal.failure.message, /SPACES_LIMITED_KEY/u);
  assert.ok(!JSON.stringify(journal).includes('limited-secret'));
  assertNoKernelEvidence(journal);
});

test('KERNEL_<STAGE>_FAILED and PAGES_PUBLIC_REDIRECT: the 2026-10-21 incident leaves one kernel journal, not a crash', async () => {
  globalThis.fetch = networkStub({ publicOrigin: 'redirects' });
  const run = await scenario();
  await assert.rejects(runDeploy(run.argv), /DEPLOY_NOT_ACTIVATED/u);
  const journal = JSON.parse(await readFile(run.out, 'utf8'));
  assert.equal(journal.outcome, 'failed');
  assert.equal(journal.failure.code, 'PAGES_PUBLIC_REDIRECT');
  assert.equal(journal.failure.stage, 'inspect');
  assert.match(journal.failure.message, /www\.example\.com/u);
  assert.ok(
    journal.attempts.length > 0,
    'the kernel journal was written once and not replaced by a failure journal',
  );
  assert.equal(journal.decision, 'reconcile');
});

test('a kernel stage that throws is journalled by the kernel and the journal carries its failure', async () => {
  globalThis.fetch = /** @type {typeof globalThis.fetch} */ (
    async (url, init) => {
      if (new URL(String(url)).host === 'example.test') {
        throw new TypeError('fetch failed', {
          cause: new Error('socket hang up'),
        });
      }
      return networkStub()(url, init);
    }
  );
  const run = await scenario();
  await assert.rejects(runDeploy(run.argv), /DEPLOY_NOT_ACTIVATED/u);
  const journal = JSON.parse(await readFile(run.out, 'utf8'));
  assert.equal(journal.failure.code, 'KERNEL_INSPECT_FAILED');
  assert.equal(journal.failure.stage, 'inspect');
  assert.equal(journal.attempts[0].outcome, 'failed');
});

test('JOURNAL_WRITE_FAILED can only be logged: the marker is printed and the write is not retried', async () => {
  globalThis.fetch = networkStub({ publicOrigin: 'redirects' });
  const run = await scenario({ out: path.join(dir, 'missing', 'journal.jcs') });
  await assert.rejects(runDeploy(run.argv), /ENOENT/u);
  assert.deepEqual(stderr, ['GALA_DEPLOY_NO_JOURNAL JOURNAL_WRITE_FAILED\n']);
});

test('a failure journal that cannot be written falls back to the marker with the original code', async () => {
  const run = await scenario({ out: path.join(dir, 'missing', 'journal.jcs') });
  run.argv[run.argv.indexOf('--envelope-digest') + 1] =
    `sha256:${'0'.repeat(64)}`;
  await assert.rejects(runDeploy(run.argv), /CARRIER_DIGEST_NOT_FOUND/u);
  assert.deepEqual(stderr, ['GALA_DEPLOY_NO_JOURNAL ENVELOPE_INVALID\n']);
});

test('the journal is renamed into place: no partial file is left beside it', async () => {
  globalThis.fetch = networkStub({ publicOrigin: 'redirects' });
  const run = await scenario();
  await assert.rejects(runDeploy(run.argv), /DEPLOY_NOT_ACTIVATED/u);
  const names = await readdir(dir);
  assert.ok(names.includes('journal.jcs'));
  assert.deepEqual(
    names.filter((name) => name.includes('.partial-')),
    [],
  );
});

test('a journal that cannot be moved into place leaves neither a partial file nor a journal', async () => {
  globalThis.fetch = networkStub({ publicOrigin: 'redirects' });
  const occupied = path.join(dir, 'occupied');
  await mkdir(path.join(occupied, 'child'), { recursive: true });
  const run = await scenario({ out: occupied });
  await assert.rejects(runDeploy(run.argv));
  assert.deepEqual(stderr, ['GALA_DEPLOY_NO_JOURNAL JOURNAL_WRITE_FAILED\n']);
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.includes('.partial-')),
    [],
  );
});

test('verificationBaseUrl present: every public read goes to it, the build base is not read, and the journal says so', async () => {
  const publicUrls = /** @type {string[]} */ ([]);
  globalThis.fetch = networkStub({ publicUrls });
  const run = await scenario({
    mutateIntent(intent) {
      withVerificationBase(
        intent,
        'https://gala-author.github.io/galascribe-blog/',
      );
    },
  });
  await assert.rejects(runDeploy(run.argv), /DEPLOY_NOT_ACTIVATED/u);
  assert.ok(publicUrls.length > 0, 'the run made public reads');
  assert.ok(
    publicUrls.every((url) =>
      url.startsWith('https://gala-author.github.io/galascribe-blog/'),
    ),
    publicUrls.join(', '),
  );
  assert.ok(
    publicUrls.includes(
      'https://gala-author.github.io/galascribe-blog/.well-known/gala-generation.json',
    ),
    'the marker is read under the project path',
  );
  const journal = JSON.parse(await readFile(run.out, 'utf8'));
  assert.deepEqual(journal.verifiedAt, {
    origin: 'https://gala-author.github.io',
    baseUrl: 'https://gala-author.github.io/galascribe-blog/',
  });
});

test('verificationBaseUrl absent: public reads use the build base, which the journal records', async () => {
  const publicUrls = /** @type {string[]} */ ([]);
  globalThis.fetch = networkStub({ publicUrls });
  const run = await scenario();
  assert.equal(run.intent.destination.verificationBaseUrl, undefined);
  await assert.rejects(runDeploy(run.argv), /DEPLOY_NOT_ACTIVATED/u);
  assert.ok(
    publicUrls.length > 0 &&
      publicUrls.every((url) => url.startsWith(run.intent.destination.baseUrl)),
    publicUrls.join(', '),
  );
  const journal = JSON.parse(await readFile(run.out, 'utf8'));
  assert.deepEqual(journal.verifiedAt, {
    origin: new URL(run.intent.destination.baseUrl).origin,
    baseUrl: run.intent.destination.baseUrl,
  });
});

test('a redirect at the verification origin is still PAGES_PUBLIC_REDIRECT', async () => {
  globalThis.fetch = networkStub({ publicOrigin: 'redirects' });
  const run = await scenario({
    mutateIntent(intent) {
      withVerificationBase(
        intent,
        'https://gala-author.github.io/galascribe-blog/',
      );
    },
  });
  await assert.rejects(runDeploy(run.argv), /DEPLOY_NOT_ACTIVATED/u);
  const journal = JSON.parse(await readFile(run.out, 'utf8'));
  assert.equal(journal.failure.code, 'PAGES_PUBLIC_REDIRECT');
  assert.equal(journal.verifiedAt.origin, 'https://gala-author.github.io');
});

for (const invalid of [
  'http://gala-author.github.io/blog/',
  'https://user@gala-author.github.io/blog/',
  'https://gala-author.github.io:8443/blog/',
  'https://gala-author.github.io/blog/#top',
  'https://gala-author.github.io/blog/?x=1',
  'https://Gala-Author.github.io/blog/',
  'https://gala-author.github.io/a/../b/',
  'not a url',
  42,
]) {
  test(`INTENT_MISMATCH: an invalid verificationBaseUrl (${JSON.stringify(invalid)}) is refused before any contact`, async () => {
    const publicUrls = /** @type {string[]} */ ([]);
    globalThis.fetch = networkStub({ publicUrls });
    const run = await scenario({
      mutateIntent(intent) {
        intent.destination.verificationBaseUrl = invalid;
      },
    });
    const journal = await failsWithJournal(
      run,
      'INTENT_MISMATCH',
      'verification-origin',
    );
    assert.match(
      journal.failure.message,
      /DEPLOY_VERIFICATION_BASE_URL_INVALID/u,
    );
    assert.equal(journal.verifiedAt, undefined);
    assert.deepEqual(publicUrls, []);
    assertNoKernelEvidence(journal);
  });
}

test('classifyFailure keeps a classified failure and calls anything else DEPLOY_CRASHED', () => {
  const crash = classifyFailure(new Error('boom'));
  assert.equal(crash.code, 'DEPLOY_CRASHED');
  assert.equal(crash.stage, 'unknown');
  assert.equal(crash.message, 'boom');
  assert.equal(classifyFailure(crash), crash);
  assert.equal(classifyFailure('not an error').message, 'not an error');
});
