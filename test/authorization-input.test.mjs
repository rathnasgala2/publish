/**
 * The real freeze path (PUBLISH-S4-5, S4-6b): `freeze.mjs` recalculates the
 * frozen envelope under the adapter the verified source's lock selects, and
 * `build-authorization-input.mjs` derives every member of the
 * `deployment-intent` authorization input from what the workflow holds —
 * the verified source, the frozen bytes, the build's validated fact records,
 * the runner's own bound identity and the verified upload — sends none of
 * the members Gala derives (schema 2.9.0, LOCAL-60), and fails closed, by
 * name, on a workflow-held member it does not have.
 *
 * The verified-inputs carrier here is the real `publish-action` minimal
 * repository fixture with its lock re-pointed at each adapter in turn, and
 * the build facts are the real `build-input:2.0.0` `publish-action`'s own
 * normalizer produces from that repository plus the real theme contract of
 * the theme it pins, so what is proved is derivation from a real lock, a
 * real publication document and a real build input, not from a hand-written
 * stand-in.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as pages from '@rathnasgala2/adapter-github-pages';
import * as spaces from '@rathnasgala2/adapter-do-spaces';

import {
  deriveAuthorizationInput,
  deriveRebuildRecord,
  taggedCommit,
} from '../scripts/workflow/build-authorization-input.mjs';
import {
  BUILD_INPUT_MEMBER,
  THEME_CONTRACT_MEMBER,
  readBuildFacts,
} from '../scripts/workflow/build-facts.mjs';
import {
  carrierDigest,
  decodeCarrier,
  encodeCarrier,
  walkDirectory,
} from '../scripts/workflow/carrier.mjs';
import {
  ADAPTER_PACKAGES,
  LOCK_PATH,
  PUBLICATION_PATH,
  readLockDocument,
  readLockFacts,
  readPublicationFacts,
} from '../scripts/workflow/verified-source.mjs';
import {
  REBUILD_RECORD_API_DERIVED,
  REBUILD_RECORD_REQUIRED,
  validateExchangeRequest,
} from '../scripts/workflow/workload-contract.mjs';
import { buildDeploymentIntentRequest } from '../scripts/workflow/workload-requests.mjs';
import { decodeFrozenEnvelope } from '../scripts/workflow/frozen-envelope.mjs';
import { MANIFEST_MEMBER } from '../scripts/workflow/pack-carrier.mjs';
import {
  fixtureBuildFacts,
  fixtureLock,
  frozenEnvelopeFor,
  manifestFor,
} from './fixtures/artifact-manifest.mjs';
import {
  ARTIFACT_FILES,
  authorizationInput,
} from './fixtures/authorization-input.mjs';
import { stableId } from './fixtures/fake-gala-api.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '../scripts/workflow');
const FIXTURE = path.resolve(
  HERE,
  '../packages/publish-action/test/fixtures/minimal-repository',
);
const OPERATION_ID = stableId();
const SHA = 'a'.repeat(40);
const PAGES = '@rathnasgala2/adapter-github-pages';
/** The checkout-only commit facts `prep` records (tree id, committer instant). */
const SOURCE_TREE = `sha1:${'b'.repeat(40)}`;
const BUILD_EPOCH = '2026-09-17T00:00:00.000Z';

/** The runner's own bound identity for one publish run. */
const RUNNER = Object.freeze({
  GITHUB_REPOSITORY: 'Gala-Author/site',
  GITHUB_REPOSITORY_ID: '4242',
  GITHUB_REPOSITORY_OWNER: 'Gala-Author',
  GITHUB_REPOSITORY_OWNER_ID: '99',
  GITHUB_REF: `refs/heads/gala/publish/${OPERATION_ID}`,
  GITHUB_RUN_ID: '987654321',
  GITHUB_RUN_NUMBER: '12',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_EVENT_NAME: 'create',
  GITHUB_ACTOR: 'gala-author',
  GITHUB_ACTOR_ID: '77',
});

/** The verified upload of the frozen envelope. */
const HANDOFF = Object.freeze({
  artifactId: '5150',
  name: 'gala-r987654321-a2-frozen-envelope-v2.bin',
  retentionDays: 7,
  expiresAt: '2026-09-25T12:00:00Z',
});

/** @type {{path: string, bytes: Buffer}[]} */
let fixtureFiles = [];
/** @type {Map<string, {buildInput: Record<string, any>, themeContract: Record<string, any>}>} */
const buildFacts = new Map();

before(async () => {
  fixtureFiles = await walkDirectory(FIXTURE);
  for (const adapterPackage of [
    '@rathnasgala2/adapter-github-pages',
    '@rathnasgala2/adapter-do-spaces',
  ]) {
    buildFacts.set(adapterPackage, await fixtureBuildFacts(adapterPackage));
  }
});

/**
 * The real build facts for one adapter's lock (the Pages facts for an
 * adapter no managed job freezes for).
 *
 * @param {string} adapterPackage the adapter package the lock selects
 * @returns {{buildInput: Record<string, any>, themeContract: Record<string, any>}}
 *   the two validated records
 */
function factsFor(adapterPackage) {
  const facts = buildFacts.get(adapterPackage) ?? buildFacts.get(PAGES);
  assert.ok(facts !== undefined, 'build facts are loaded in before()');
  return facts;
}

/**
 * The verified-inputs carrier for the fixture repository with its lock
 * re-pointed at one adapter package (the fixture itself locks
 * `local-directory`), optionally mutated further.
 *
 * @param {keyof typeof ADAPTER_PACKAGES | null} adapterPackage the adapter row
 *   to substitute for the fixture's, or `null` to drop every adapter row
 * @param {(documents: {lock: any, publication: any}) => void} [mutate] a
 *   further mutation of the two documents
 * @param {Record<string, unknown>} [metadata] metadata overrides
 * @returns {{metadata: Record<string, any>, files: {path: string, bytes: Buffer}[], bytes: Buffer}}
 *   the decoded carrier and its bytes
 */
function verifiedInputs(adapterPackage, mutate, metadata = {}) {
  const files = fixtureFiles.map((file) => ({
    path: `source/${file.path}`,
    bytes: file.bytes,
  }));
  const lockMember = files.find((file) => file.path === LOCK_PATH);
  const publicationMember = files.find(
    (file) => file.path === PUBLICATION_PATH,
  );
  assert.ok(lockMember !== undefined && publicationMember !== undefined);
  const lock = JSON.parse(lockMember.bytes.toString('utf8'));
  const publication = JSON.parse(publicationMember.bytes.toString('utf8'));
  lock.publisher = lock.publisher.flatMap((/** @type {any} */ row) => {
    if (!Object.hasOwn(ADAPTER_PACKAGES, row.package)) {
      return [row];
    }
    return adapterPackage === null ? [] : [{ ...row, package: adapterPackage }];
  });
  mutate?.({ lock, publication });
  lockMember.bytes = Buffer.from(JSON.stringify(lock), 'utf8');
  publicationMember.bytes = Buffer.from(JSON.stringify(publication), 'utf8');
  const bytes = encodeCarrier({
    purpose: 'verified-inputs',
    metadata: {
      sourceCommit: SHA,
      workflowTriggerCommit: SHA,
      sourceTree: SOURCE_TREE,
      buildEpoch: BUILD_EPOCH,
      runId: RUNNER.GITHUB_RUN_ID,
      runAttempt: RUNNER.GITHUB_RUN_ATTEMPT,
      fileCount: files.length,
      ...metadata,
    },
    files,
  });
  return { ...decodeCarrier(bytes), bytes };
}

/**
 * @param {string} adapterPackage the adapter the build facts were made for
 * @returns {{
 *   files: {path: string, bytes: Buffer}[],
 *   bytes: Buffer,
 *   manifest: Record<string, any>,
 *   provenanceDigest: string,
 *   sbomDigest: string
 * }} a real frozen envelope over the fixture artifact whose manifest is
 *   tied to the real build input, decoded
 */
function frozenEnvelope(adapterPackage) {
  const files = ARTIFACT_FILES.map((file) => ({ ...file }));
  const facts = factsFor(adapterPackage);
  const envelope = frozenEnvelopeFor(files, {
    manifest: manifestFor(files, {
      buildInputDigest: facts.buildInput.inputDigest,
    }),
  });
  return {
    files: envelope.decoded.files,
    bytes: envelope.bytes,
    manifest: envelope.manifest,
    provenanceDigest: envelope.decoded.provenanceDigest,
    sbomDigest: envelope.decoded.sbomDigest,
  };
}

/**
 * @param {keyof typeof ADAPTER_PACKAGES} adapterPackage the locked adapter
 * @param {Record<string, string | undefined>} [runner] the runner identity
 * @param {{
 *   build?: {buildInput: Record<string, any> | null, themeContract: Record<string, any> | null},
 *   metadata?: Record<string, unknown>
 * }} [levers] the build facts to hand freeze and metadata overrides
 * @returns {ReturnType<typeof deriveAuthorizationInput>} the derivation
 */
function derive(adapterPackage, runner = RUNNER, levers = {}) {
  const envelope = frozenEnvelope(adapterPackage);
  return deriveAuthorizationInput({
    inputs: verifiedInputs(adapterPackage, undefined, levers.metadata),
    envelope,
    build: levers.build ?? factsFor(adapterPackage),
    runner,
    handoff: HANDOFF,
    artifactDigest:
      adapterPackage === '@rathnasgala2/adapter-do-spaces'
        ? spaces.computeArtifactDigest(envelope.files)
        : pages.computeArtifactDigest(envelope.files),
  });
}

/**
 * The rebuild record freeze must send for one adapter: every member from
 * its DEC-097 section 5 owner, and none of the four Gala derives.
 *
 * @param {keyof typeof ADAPTER_PACKAGES} adapterPackage the locked adapter
 * @param {Record<string, any>} manifest the envelope's manifest
 * @returns {Record<string, unknown>} the expected record
 */
function expectedRebuildRecord(adapterPackage, manifest) {
  const inputs = verifiedInputs(adapterPackage);
  const lock = readLockDocument(inputs.files);
  const facts = readLockFacts(inputs.files);
  const { buildInput, themeContract } = factsFor(adapterPackage);
  const identity = (/** @type {any} */ row) => ({
    package: row.package,
    version: row.version,
    integrity: row.integrity,
    registry: row.registry,
  });
  return {
    contractVersion: '2.0.0',
    repositoryId: RUNNER.GITHUB_REPOSITORY_ID,
    sourceCommit: `sha1:${SHA}`,
    sourceTree: SOURCE_TREE,
    repositoryRootDigest: buildInput.repository.rootDigest,
    buildEpoch: BUILD_EPOCH,
    buildInputDigest: manifest.buildInputDigest,
    dependencyLockDigest: facts.lockDigest,
    stylingContractDigest: themeContract.stylingContractDigest,
    workflowIdentity: manifest.workflowIdentity,
    baseUrl: 'https://example.invalid/',
    basePath: buildInput.basePath,
    builder: facts.publisher,
    schemas: identity(lock.schemas),
    template: identity(lock.template),
    theme: identity(lock.theme),
    renderPolicy: buildInput.content[0].renderPolicy,
  };
}

test('the lock is the only source of the adapter, the publisher and the lock digest', () => {
  const inputs = verifiedInputs('@rathnasgala2/adapter-github-pages');
  const facts = readLockFacts(inputs.files);
  const lock = JSON.parse(
    String(inputs.files.find((file) => file.path === LOCK_PATH)?.bytes),
  );
  const adapterRow = lock.publisher.find(
    (/** @type {any} */ row) =>
      row.package === '@rathnasgala2/adapter-github-pages',
  );
  const publisherRow = lock.publisher.find(
    (/** @type {any} */ row) => row.package === '@rathnasgala2/publish-action',
  );
  assert.deepEqual(facts.adapter, {
    adapterId: 'github-pages',
    adapterVersion: adapterRow.version,
    // DEC-097 section 3: the adapter digest byte-equals the locked
    // package's integrity.
    adapterDigest: adapterRow.integrity,
  });
  assert.deepEqual(facts.publisher, {
    package: publisherRow.package,
    version: publisherRow.version,
    integrity: publisherRow.integrity,
    registry: publisherRow.registry,
  });
  assert.equal(facts.lockDigest, lock.lockDigest);
});

test('a lock that selects no adapter, two adapters, or no publisher is refused by name', () => {
  assert.throws(
    () => readLockFacts(verifiedInputs(null).files),
    /FREEZE_ADAPTER_SELECTION_INVALID: .*found 0/u,
  );
  assert.throws(
    () =>
      readLockFacts(
        verifiedInputs('@rathnasgala2/adapter-github-pages', ({ lock }) => {
          lock.publisher.push({
            ...lock.publisher.find(
              (/** @type {any} */ row) =>
                row.package === '@rathnasgala2/adapter-github-pages',
            ),
            package: '@rathnasgala2/adapter-do-spaces',
          });
        }).files,
      ),
    /FREEZE_ADAPTER_SELECTION_INVALID: .*found 2/u,
  );
  assert.throws(
    () =>
      readLockFacts(
        verifiedInputs('@rathnasgala2/adapter-github-pages', ({ lock }) => {
          lock.publisher = lock.publisher.filter(
            (/** @type {any} */ row) =>
              row.package !== '@rathnasgala2/publish-action',
          );
        }).files,
      ),
    /VERIFIED_SOURCE_LOCK_INVALID: .*publish-action/u,
  );
  assert.throws(
    () =>
      readLockFacts(
        verifiedInputs('@rathnasgala2/adapter-github-pages', ({ lock }) => {
          lock.lockDigest = 'not-a-digest';
        }).files,
      ),
    /VERIFIED_SOURCE_LOCK_INVALID: lockDigest/u,
  );
  assert.throws(
    () =>
      readLockFacts(
        verifiedInputs('@rathnasgala2/adapter-github-pages').files.filter(
          (file) => file.path !== LOCK_PATH,
        ),
      ),
    /VERIFIED_SOURCE_MEMBER_MISSING: .*gala\.lock\.json/u,
  );
});

test('a publication whose canonical base is not an https directory root is refused', () => {
  for (const canonicalBase of [
    'http://example.invalid/',
    'https://example.invalid',
    'https://user:pw@example.invalid/',
    'https://example.invalid/?q=1',
    undefined,
  ]) {
    const envelope = frozenEnvelope('@rathnasgala2/adapter-github-pages');
    assert.throws(
      () =>
        deriveAuthorizationInput({
          inputs: verifiedInputs(
            '@rathnasgala2/adapter-github-pages',
            ({ publication }) => {
              publication.canonicalBase = canonicalBase;
            },
          ),
          envelope,
          build: factsFor('@rathnasgala2/adapter-github-pages'),
          runner: RUNNER,
          handoff: HANDOFF,
          artifactDigest: pages.computeArtifactDigest(envelope.files),
        }),
      /VERIFIED_SOURCE_PUBLICATION_INVALID/u,
      String(canonicalBase),
    );
  }
});

test('github-pages: every member comes from the verified source, the frozen bytes, the build facts, the runner identity or the verified upload — and nothing Gala derives is sent', () => {
  const { input, missing } = derive('@rathnasgala2/adapter-github-pages');
  const envelope = frozenEnvelope('@rathnasgala2/adapter-github-pages');
  const reference = authorizationInput({
    adapterId: 'github-pages',
    operationId: OPERATION_ID,
    repositoryId: RUNNER.GITHUB_REPOSITORY_ID,
    runId: RUNNER.GITHUB_RUN_ID,
    runAttempt: 2,
    artifactDigest: pages.computeArtifactDigest(envelope.files),
  });

  assert.deepEqual(missing, [], 'the 2.9.0 request is complete');
  // Runner identity.
  assert.equal(input.purpose, 'deployment-intent');
  assert.equal(input.operationId, OPERATION_ID);
  assert.equal(input.repositoryId, '4242');
  assert.equal(input.runId, RUNNER.GITHUB_RUN_ID);
  assert.equal(input.runAttempt, 2);
  assert.equal(input.sourceCommit, `sha1:${SHA}`);
  assert.equal(input.workflowTriggerCommit, `sha1:${SHA}`);
  // Frozen bytes, under the selected adapter's own projection.
  assert.equal(
    input.artifactDigest,
    pages.computeArtifactDigest(envelope.files),
  );
  assert.equal(input.artifactFileCount, reference.artifactFileCount);
  assert.equal(input.artifactByteCount, reference.artifactByteCount);
  assert.deepEqual(
    input.verificationSubmission,
    reference.verificationSubmission,
  );
  assert.equal(input.frozenEnvelopeDigest, carrierDigest(envelope.bytes));
  assert.equal(input.frozenEnvelopeByteCount, envelope.bytes.byteLength);
  // The envelope's own metadata records, digested by the decoder.
  assert.equal(input.manifestDigest, envelope.manifest.manifestDigest);
  assert.equal(input.provenanceDigest, envelope.provenanceDigest);
  assert.equal(input.sbomDigest, envelope.sbomDigest);
  // The verified upload.
  assert.equal(input.frozenHandoffArtifactId, '5150');
  assert.equal(input.frozenHandoffName, HANDOFF.name);
  assert.equal(input.requestedArtifactRetentionDays, 7);
  assert.equal(input.effectiveArtifactExpiresAt, '2026-09-25T12:00:00.000Z');
  // The verified source.
  const facts = readLockFacts(
    verifiedInputs('@rathnasgala2/adapter-github-pages').files,
  );
  assert.equal(input.lockDigest, facts.lockDigest);
  assert.deepEqual(input.publisher, facts.publisher);
  assert.deepEqual(input.adapter, facts.adapter);
  // The request-side destination (2.9.0): no environment, no targetDigest —
  // both are Gala's — and the Pages coordinates, which can only be the
  // runner's own repository (Gala binds the same through the assertion).
  assert.deepEqual(input.destination, {
    adapterId: 'github-pages',
    adapterVersion: facts.adapter.adapterVersion,
    baseUrl: 'https://example.invalid/',
    providerBinding: { owner: 'Gala-Author', repository: 'site' },
  });
  // The request-side rebuild record: seventeen members, each from its
  // owner; none of the four Gala derives.
  assert.deepEqual(
    input.rebuildRecord,
    expectedRebuildRecord(
      '@rathnasgala2/adapter-github-pages',
      envelope.manifest,
    ),
  );
  assert.deepEqual(
    Object.keys(/** @type {any} */ (input.rebuildRecord)).sort(),
    [...REBUILD_RECORD_REQUIRED].sort(),
  );
  for (const member of REBUILD_RECORD_API_DERIVED) {
    assert.equal(
      /** @type {any} */ (input.rebuildRecord)[member],
      undefined,
      `${member} is Gala's`,
    );
  }
  assert.equal(input.capabilityDecisionDigest, undefined);
});

test('do-spaces: the request carries no provider coordinates at all — they are Gala’s destination record — and is otherwise complete', () => {
  const { input, missing } = derive('@rathnasgala2/adapter-do-spaces');
  const envelope = frozenEnvelope('@rathnasgala2/adapter-do-spaces');
  assert.deepEqual(missing, []);
  assert.equal(
    input.artifactDigest,
    spaces.computeArtifactDigest(envelope.files),
    'the artifact digest is the Spaces projection, not the Pages one',
  );
  assert.deepEqual(/** @type {any} */ (input.adapter).adapterId, 'do-spaces');
  assert.deepEqual(input.destination, {
    adapterId: 'do-spaces',
    adapterVersion: /** @type {any} */ (input.adapter).adapterVersion,
    baseUrl: 'https://example.invalid/',
  });
  assert.deepEqual(
    input.rebuildRecord,
    expectedRebuildRecord('@rathnasgala2/adapter-do-spaces', envelope.manifest),
  );
});

test('the derived input is the exact request the exchange builder sends, valid against the 2.9.0 contract with nothing added', () => {
  for (const adapterPackage of /** @type {const} */ ([
    '@rathnasgala2/adapter-github-pages',
    '@rathnasgala2/adapter-do-spaces',
  ])) {
    const { input } = derive(adapterPackage);
    const { request } = buildDeploymentIntentRequest(
      /** @type {any} */ (input),
    );
    assert.equal(validateExchangeRequest(request), 'deployment-intent');
    assert.deepEqual(request.adapter, input.adapter);
    assert.deepEqual(request.destination, input.destination);
    assert.deepEqual(request.rebuildRecord, input.rebuildRecord);
    assert.equal(request.capabilityDecisionDigest, undefined);
    assert.equal(request.lockDigest, input.lockDigest);
    assert.equal(request.provenanceDigest, input.provenanceDigest);
    assert.equal(request.sbomDigest, input.sbomDigest);
  }
});

test('a lock that selects local-directory has no managed deploy job and is refused at freeze', () => {
  assert.throws(
    () => derive('@rathnasgala2/adapter-local-directory'),
    /AUTHORIZATION_INPUT_ADAPTER_UNMANAGED: .*adapter-local-directory/u,
  );
});

test('the runner identity is required, and a candidate ref cannot produce an input', () => {
  assert.throws(
    () =>
      derive('@rathnasgala2/adapter-github-pages', {
        ...RUNNER,
        GITHUB_REPOSITORY_ID: '',
      }),
    /DEPLOY_RUNNER_IDENTITY_MISSING/u,
  );
  assert.throws(
    () =>
      derive('@rathnasgala2/adapter-github-pages', {
        ...RUNNER,
        GITHUB_REF: `refs/heads/gala/candidate/${OPERATION_ID}`,
      }),
    /WORKLOAD_PUBLISH_REF_INVALID/u,
  );
});

test('a workflow-held member the workflow does not have is named with its owner, never invented: the checkout’s commit facts and the build’s fact records', () => {
  const adapterPackage = '@rathnasgala2/adapter-github-pages';
  const facts = factsFor(adapterPackage);

  const noCommitFacts = derive(adapterPackage, RUNNER, {
    metadata: { sourceTree: null, buildEpoch: null },
  });
  assert.deepEqual(
    noCommitFacts.missing.map((entry) => entry.member),
    ['rebuildRecord.sourceTree', 'rebuildRecord.buildEpoch'],
  );
  for (const entry of noCommitFacts.missing) {
    assert.match(entry.owner, /verified-inputs carrier.*git object database/u);
  }

  const noBuildInput = derive(adapterPackage, RUNNER, {
    build: { buildInput: null, themeContract: facts.themeContract },
  });
  assert.deepEqual(
    noBuildInput.missing.map((entry) => entry.member),
    [
      'rebuildRecord.repositoryRootDigest',
      'rebuildRecord.basePath',
      'rebuildRecord.renderPolicy',
    ],
  );
  assert.match(String(noBuildInput.missing[0]?.owner), /build-input\.json/u);

  const noThemeContract = derive(adapterPackage, RUNNER, {
    build: { buildInput: facts.buildInput, themeContract: null },
  });
  assert.deepEqual(
    noThemeContract.missing.map((entry) => entry.member),
    ['rebuildRecord.stylingContractDigest'],
  );
  assert.match(
    String(noThemeContract.missing[0]?.owner),
    /theme-contract\.json/u,
  );

  const noCommit = derive(adapterPackage, RUNNER, {
    metadata: { sourceCommit: null },
  });
  assert.ok(
    noCommit.missing.some((entry) => entry.member === 'sourceCommit') &&
      noCommit.missing.some(
        (entry) => entry.member === 'rebuildRecord.sourceCommit',
      ),
  );
});

test('a build fact that disagrees with its owning record is refused, not sent', () => {
  const adapterPackage = '@rathnasgala2/adapter-github-pages';
  const facts = factsFor(adapterPackage);
  /** @type {ReadonlyArray<[string, (buildInput: any) => void, RegExp]>} */
  const cases = [
    [
      'baseUrl',
      (buildInput) => {
        buildInput.baseUrl = 'https://elsewhere.invalid/';
      },
      /baseUrl is not the publication canonicalBase/u,
    ],
    [
      'contractVersion',
      (buildInput) => {
        buildInput.contractVersion = '9.9.9';
      },
      /contractVersion/u,
    ],
    [
      'packages.theme',
      (buildInput) => {
        buildInput.packages.theme = {
          ...buildInput.packages.theme,
          version: '0.0.1',
        };
      },
      /packages\.theme is not the lock/u,
    ],
    [
      'packages.publisher',
      (buildInput) => {
        buildInput.packages.publisher[0] = {
          ...buildInput.packages.publisher[0],
          integrity: `sha256:${'f'.repeat(64)}`,
        };
      },
      /packages\.publisher\[0\]/u,
    ],
    [
      'renderPolicy',
      (buildInput) => {
        buildInput.content = [
          ...buildInput.content,
          {
            ...buildInput.content[0],
            renderPolicy: {
              ...buildInput.content[0].renderPolicy,
              version: '9.0.0',
            },
          },
        ];
      },
      /2 render policies/u,
    ],
  ];
  for (const [name, mutate, detail] of cases) {
    const buildInput = structuredClone(facts.buildInput);
    mutate(buildInput);
    assert.throws(
      () =>
        derive(adapterPackage, RUNNER, {
          build: { buildInput, themeContract: facts.themeContract },
        }),
      (error) => {
        assert.match(String(error), /AUTHORIZATION_INPUT_BUILD_DISAGREEMENT/u);
        assert.match(String(error), detail);
        return true;
      },
      name,
    );
  }
  assert.throws(
    () =>
      derive(adapterPackage, RUNNER, {
        build: {
          buildInput: facts.buildInput,
          themeContract: { ...facts.themeContract, package: 'other@1.0.0' },
        },
      }),
    /AUTHORIZATION_INPUT_BUILD_DISAGREEMENT: the carried theme contract/u,
  );
});

test('readBuildFacts validates both records against their roots and ties the build input to the manifest', () => {
  const adapterPackage = '@rathnasgala2/adapter-github-pages';
  const facts = factsFor(adapterPackage);
  const manifest = frozenEnvelope(adapterPackage).manifest;
  const members = (/** @type {Record<string, unknown>} */ overrides) => [
    {
      path: BUILD_INPUT_MEMBER,
      bytes: Buffer.from(
        JSON.stringify(overrides.buildInput ?? facts.buildInput),
      ),
    },
    {
      path: THEME_CONTRACT_MEMBER,
      bytes: Buffer.from(
        JSON.stringify(overrides.themeContract ?? facts.themeContract),
      ),
    },
  ];
  const both = readBuildFacts(members({}), manifest);
  assert.deepEqual(both.buildInput, facts.buildInput);
  assert.deepEqual(both.themeContract, facts.themeContract);
  assert.deepEqual(readBuildFacts([], manifest), {
    buildInput: null,
    themeContract: null,
  });
  assert.throws(
    () =>
      readBuildFacts(members({}), {
        ...manifest,
        buildInputDigest: `sha256:${'0'.repeat(64)}`,
      }),
    /FREEZE_BUILD_INPUT_MISMATCH/u,
  );
  assert.throws(
    () =>
      readBuildFacts(
        members({ buildInput: { ...facts.buildInput, basePath: 'no-slash' } }),
        manifest,
      ),
    /FREEZE_BUILD_FACT_INVALID: metadata\/build-input\.json/u,
  );
  assert.throws(
    () =>
      readBuildFacts(
        members({ themeContract: { schemaId: 'nope' } }),
        manifest,
      ),
    /FREEZE_BUILD_FACT_INVALID: metadata\/theme-contract\.json/u,
  );
  // deriveRebuildRecord is the pure half: the same owners, the same record.
  const inputs = verifiedInputs(adapterPackage);
  const derived = deriveRebuildRecord({
    lock: readLockFacts(inputs.files),
    lockDocument: readLockDocument(inputs.files),
    publication: readPublicationFacts(inputs.files),
    manifest,
    metadata: inputs.metadata,
    build: facts,
    repositoryId: RUNNER.GITHUB_REPOSITORY_ID,
  });
  assert.deepEqual(derived.missing, []);
  assert.deepEqual(
    derived.record,
    expectedRebuildRecord(adapterPackage, manifest),
  );
});

test('taggedCommit tags a bare object id once and leaves a tagged one alone', () => {
  assert.equal(taggedCommit(SHA), `sha1:${SHA}`);
  assert.equal(taggedCommit(`sha1:${SHA}`), `sha1:${SHA}`);
  assert.equal(taggedCommit('b'.repeat(64)), `sha256:${'b'.repeat(64)}`);
  assert.equal(taggedCommit(''), null);
  assert.equal(taggedCommit(undefined), null);
});

test('freeze.mjs then build-authorization-input.mjs: the envelope is frozen under the lock’s adapter and the complete 2.9.0 authorization input is written for the fixture repository', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'gala-freeze-'));
  const inbox = path.join(workspace, 'inbox');
  const carrier = path.join(workspace, 'carrier');
  await mkdir(inbox, { recursive: true });
  await mkdir(carrier, { recursive: true });
  after(() => rm(workspace, { recursive: true, force: true }));

  const adapterPackage = '@rathnasgala2/adapter-github-pages';
  const facts = factsFor(adapterPackage);
  const inputs = verifiedInputs(adapterPackage);
  await writeFile(path.join(inbox, 'verified-inputs.bin'), inputs.bytes);
  // The build's manifest, build input and theme contract travel in the
  // unfrozen-output carrier as the reserved metadata members
  // (pack-carrier.mjs --manifest/--build-input/--theme-contract), next to
  // publish-action's own output marker, which is not artifact inventory.
  const manifest = manifestFor(ARTIFACT_FILES, {
    lock: fixtureLock(adapterPackage),
    sourceCommit: `sha1:${SHA}`,
    buildInputDigest: facts.buildInput.inputDigest,
  });
  const outputFor = (/** @type {boolean} */ withThemeContract) =>
    encodeCarrier({
      purpose: 'unfrozen-output',
      metadata: { fileCount: ARTIFACT_FILES.length },
      files: [
        ...ARTIFACT_FILES.map((file) => ({ ...file })),
        { path: MANIFEST_MEMBER, bytes: Buffer.from(JSON.stringify(manifest)) },
        {
          path: BUILD_INPUT_MEMBER,
          bytes: Buffer.from(JSON.stringify(facts.buildInput)),
        },
        ...(withThemeContract
          ? [
              {
                path: THEME_CONTRACT_MEMBER,
                bytes: Buffer.from(JSON.stringify(facts.themeContract)),
              },
            ]
          : []),
        { path: '.gala-build-directory', bytes: Buffer.from('{}') },
      ].sort((left, right) => (left.path < right.path ? -1 : 1)),
    });
  const output = outputFor(true);
  const partialOutput = outputFor(false);
  await writeFile(path.join(inbox, 'unfrozen-output.bin'), output);
  await writeFile(
    path.join(inbox, 'unfrozen-output-partial.bin'),
    partialOutput,
  );
  const env = {
    PATH: process.env.PATH ?? '',
    ...RUNNER,
  };
  const handoffArguments = [
    '--verified-inputs-artifact-id',
    '5101',
    '--verified-inputs-name',
    'gala-r987654321-a2-verified-inputs-v2.bin',
    '--verified-inputs-byte-count',
    String(inputs.bytes.byteLength),
    '--verified-inputs-expires-at',
    '2026-09-19T12:00:00Z',
    '--unfrozen-output-artifact-id',
    '5102',
    '--unfrozen-output-name',
    'gala-r987654321-a2-unfrozen-output-v2.bin',
    '--unfrozen-output-byte-count',
    String(output.byteLength),
    '--unfrozen-output-expires-at',
    '2026-09-19T12:00:00Z',
  ];

  const freeze = (/** @type {Record<string, string>} */ runner = RUNNER) =>
    run(
      process.execPath,
      [
        path.join(SCRIPTS, 'freeze.mjs'),
        '--inbox',
        inbox,
        '--verified-inputs-digest',
        carrierDigest(inputs.bytes),
        '--unfrozen-output-digest',
        carrierDigest(output),
        ...handoffArguments,
        '--ref-kind',
        'publish',
        '--out-dir',
        carrier,
      ],
      { env: { ...env, ...runner } },
    );
  await assert.rejects(
    freeze({ ...RUNNER, GITHUB_EVENT_NAME: 'push' }),
    /PROVENANCE_INVALID: \/assertedWorkload\/eventName/u,
    'a provenance record the workflow cannot honestly assert is refused before any envelope is written',
  );
  const { stdout } = await freeze();
  const envelopePath = path.join(
    carrier,
    'gala-r987654321-a2-frozen-envelope-v2.bin',
  );
  const envelopeBytes = await readFile(envelopePath);
  const envelope = decodeFrozenEnvelope(envelopeBytes);
  assert.deepEqual(
    envelope.files.map((file) => file.path),
    [...ARTIFACT_FILES].map((file) => file.path).sort(),
    'the payload is exactly the manifest inventory; the marker and the three metadata members are not staged',
  );
  assert.deepEqual(envelope.manifest, manifest);
  assert.equal(envelope.recordCount, ARTIFACT_FILES.length + 3);
  const provenance = /** @type {any} */ (envelope.provenance);
  assert.equal(provenance.assertedWorkload.repository, 'Gala-Author/site');
  assert.equal(provenance.assertedWorkload.runAttempt, 2);
  assert.equal(
    provenance.verifiedInputHandoff.digest,
    carrierDigest(inputs.bytes),
  );
  assert.equal(provenance.unfrozenOutputHandoff.digest, carrierDigest(output));
  assert.equal(provenance.lockDigest, readLockFacts(inputs.files).lockDigest);
  assert.equal(provenance.sbomDigest, envelope.sbomDigest);
  assert.ok(
    stdout.includes(`provenanceDigest: ${envelope.provenanceDigest}`) &&
      stdout.includes(`sbomDigest: ${envelope.sbomDigest}`) &&
      stdout.includes(
        `artifactDigest (github-pages projection): ${pages.computeArtifactDigest(envelope.files)}`,
      ),
    'the freeze summary states the digests the authorization input will carry',
  );
  assert.deepEqual(
    (await readdir(carrier)).filter((name) => name.includes('authorization')),
    [],
    'freeze writes no authorization input before the upload exists',
  );

  const build = (
    /** @type {string} */ envelopeDigest,
    /** @type {Buffer} */ outputCarrier = output,
  ) =>
    run(
      process.execPath,
      [
        path.join(SCRIPTS, 'build-authorization-input.mjs'),
        '--inbox',
        inbox,
        '--verified-inputs-digest',
        carrierDigest(inputs.bytes),
        '--unfrozen-output-digest',
        carrierDigest(outputCarrier),
        '--envelope',
        envelopePath,
        '--envelope-digest',
        envelopeDigest,
        '--frozen-handoff-artifact-id',
        '5150',
        '--frozen-handoff-name',
        'gala-r987654321-a2-frozen-envelope-v2.bin',
        '--retention-days',
        '7',
        '--artifact-expires-at',
        '2026-09-25T12:00:00Z',
        '--out-dir',
        carrier,
      ],
      { env },
    );
  await assert.rejects(
    build(`sha256:${'0'.repeat(64)}`),
    /FREEZE_ENVELOPE_DIGEST_MISMATCH/u,
    'a re-observed digest that is not the local envelope’s is refused',
  );
  // A build carrier without its theme contract: the one member the
  // workflow should hold but does not is named, and nothing is written.
  await assert.rejects(
    build(carrierDigest(envelopeBytes), partialOutput),
    (error) => {
      const message = String(/** @type {any} */ (error).stderr ?? error);
      assert.match(message, /AUTHORIZATION_INPUT_INCOMPLETE/u);
      assert.match(message, /rebuildRecord\.stylingContractDigest \(/u);
      assert.doesNotMatch(
        message,
        /destination\.environment|capabilityDecisionDigest \(/u,
      );
      return true;
    },
  );
  assert.deepEqual(
    (await readdir(carrier)).filter((name) => name.includes('authorization')),
    [],
    'no partial authorization input is ever written',
  );

  // The real path: the complete 2.9.0 input is written, and it is the
  // exact request body `authorize` sends, valid against the contract.
  const { stdout: written } = await build(carrierDigest(envelopeBytes));
  const inputPath = path.join(
    carrier,
    'gala-r987654321-a2-authorization-input-v2.jcs',
  );
  assert.ok(written.includes(inputPath));
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const { request } = buildDeploymentIntentRequest(input);
  assert.equal(validateExchangeRequest(request), 'deployment-intent');
  assert.deepEqual(input.destination, {
    adapterId: 'github-pages',
    adapterVersion: readLockFacts(inputs.files).adapter.adapterVersion,
    baseUrl: 'https://example.invalid/',
    providerBinding: { owner: 'Gala-Author', repository: 'site' },
  });
  assert.deepEqual(
    input.rebuildRecord,
    expectedRebuildRecord(adapterPackage, manifest),
  );
  assert.equal(input.capabilityDecisionDigest, undefined);
  assert.equal(input.provenanceDigest, envelope.provenanceDigest);
  assert.equal(input.sbomDigest, envelope.sbomDigest);
  assert.equal(input.frozenEnvelopeDigest, carrierDigest(envelopeBytes));
});
