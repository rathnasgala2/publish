/**
 * `freeze`, second half: write the `deployment-intent` authorization input
 * for a publish ref, after the frozen envelope has been uploaded and
 * re-observed by exact ID.
 *
 * The input is the exact request body `authorize` sends (DEC-097 section
 * 6: "`authorize` downloads the authorization input and sends those exact
 * bytes as its request body"), so every member in it must have an honest
 * source the workflow itself holds:
 *
 * - **the verified source** (`prep`'s carrier): the lock — `lockDigest`, the
 *   publisher row and the one selected adapter package, which DEC-097
 *   section 3 maps onto `adapterId`/`adapterVersion`/`adapterDigest`, and
 *   the three direct package projections the rebuild record repeats — the
 *   publication's canonical base, which is `destination.baseUrl`, and the
 *   checkout-only commit facts `prep` recorded (`sourceTree`, `buildEpoch`);
 * - **the frozen bytes** (the envelope this job uploaded): artifact digest
 *   under the selected adapter's own projection, manifest digest, counts,
 *   verification plan, envelope digest and byte count, plus the manifest's
 *   own `buildInputDigest` and `workflowIdentity`;
 * - **the build's validated fact records** (`build-facts.mjs`, carried by
 *   the build job next to its manifest): the normalized build input's
 *   repository root digest, base URL/path and render policy, and the theme
 *   contract's `stylingContractDigest`;
 * - **the runner's bound identity**: the operation the publish ref names,
 *   the repository id, run id and attempt, the source and trigger commits,
 *   and — for GitHub Pages only — the provider coordinates, which can only
 *   ever be this repository (the OIDC assertion binds the same);
 * - **the upload this job just verified**: the frozen handoff artifact id,
 *   name, requested retention and observed expiry;
 * - **the frozen envelope's own metadata records**: `provenanceDigest` and
 *   `sbomDigest` are the digests of the `metadata/provenance.jcs` and
 *   `metadata/sbom.spdx.json` records the envelope carries, recomputed by
 *   the envelope decoder.
 *
 * What the workflow does *not* hold, it does not send (schema 2.9.0,
 * LOCAL-60/LOCAL-63, DEC-097 section 7): `destination.environment` and
 * `destination.targetDigest` (the adapter constant and the digest of Gala's
 * retained provider binding), and the Spaces provider coordinates. The
 * Spaces coordinates are never proposed by a deploy job at all — C2 makes
 * the publication's destination (region, served bucket, staging bucket,
 * base path) a server-owned record the publication admin sets once through
 * the App before the first publish, and Gala derives the complete Spaces
 * binding from that record at issuance; a request that still tries to name
 * a bucket or region is refused the same way a request naming
 * `destination.environment` is. The four Gala-owned `rebuildRecord` members
 * (`policyReleaseId`, `buildPolicyDecisionDigest`,
 * `packageReleaseCatalogDigest`, `destinationCapabilityDigest`) and
 * `capabilityDecisionDigest` are likewise never sent. The API derives every
 * one of them from what it owns and refuses a present disagreeing value
 * with `422 VALIDATION_FAILED`.
 *
 * A member the workflow *should* hold but does not — a checkout whose git
 * object database could not state the tree or committer instant, a build
 * carrier that did not carry its build input or theme contract — is named
 * with its owner and this job fails closed with
 * `AUTHORIZATION_INPUT_INCOMPLETE`, writing no carrier: a partial document
 * is not an authorization input, and uploading one would only move the same
 * refusal one job later.
 *
 * @module
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { findCarrier } from './decode-carrier.mjs';
import { readBuildFacts } from './build-facts.mjs';
import {
  carrierDigest,
  decodeCarrier,
  parseOptions,
  requireOption,
} from './carrier.mjs';
import { decodeFrozenEnvelope } from './frozen-envelope.mjs';
import {
  canonicalJson,
  operationIdFromPublishRef,
} from './workload-identity.mjs';
import { deriveArtifactFacts } from './workload-requests.mjs';
import {
  readLockDocument,
  readLockFacts,
  readPublicationFacts,
} from './verified-source.mjs';
import { runIfMain } from '../run-if-main.mjs';

/** The adapters that have a managed deploy job (brief section 1). */
const MANAGED_ADAPTERS = Object.freeze(['github-pages', 'do-spaces']);

/** Where each workflow-held rebuild-record member comes from, for the diagnostic. */
const OWNERS = Object.freeze({
  checkout:
    "prep's verified-inputs carrier (the checkout's git object database for GITHUB_SHA)",
  buildInput:
    "the build job's carrier (publish-action writes work/build-input.json; pack-carrier.mjs --build-input)",
  themeContract:
    "the build job's carrier (publish-action writes work/theme-contract.json; pack-carrier.mjs --theme-contract)",
});

/**
 * Tag one bare git object id the way the contract's `gitObjectId` domain
 * requires, leaving an already tagged value alone.
 *
 * @param {unknown} value the recorded commit
 * @returns {string | null} the tagged commit, or `null` when absent
 */
export function taggedCommit(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  if (value.startsWith('sha1:') || value.startsWith('sha256:')) {
    return value;
  }
  return `${value.length === 40 ? 'sha1' : 'sha256'}:${value}`;
}

/**
 * The selected adapter's own artifact projection, which is what the kernel's
 * duty 1 and the adapter's activation check compare against — not a fixed
 * adapter's, and never a placeholder.
 *
 * @param {string} adapterPackage the locked adapter package
 * @param {readonly {path: string, bytes: Buffer}[]} files the frozen files
 * @returns {Promise<string>} the tagged artifact digest
 */
export async function artifactDigestUnder(adapterPackage, files) {
  const adapter =
    /** @type {{computeArtifactDigest: (files: readonly {path: string, bytes: Buffer}[]) => string}} */ (
      await import(adapterPackage)
    );
  return adapter.computeArtifactDigest(files);
}

/**
 * rfc3339 with exactly three fractional digits, from any parseable instant
 * (GitHub's artifact `expires_at` carries none).
 *
 * @param {string} value the instant
 * @returns {string} the contract's instant shape
 */
function milliseconds(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      'AUTHORIZATION_INPUT_EXPIRY_INVALID: the observed artifact expiry is not an instant',
    );
  }
  return new Date(parsed).toISOString();
}

/**
 * @param {unknown} row a lock package row
 * @returns {{package: string, version: string, integrity: string, registry: string}}
 *   its four-member identity
 */
function identity(row) {
  const record = /** @type {Record<string, unknown>} */ (row ?? {});
  return {
    package: String(record.package),
    version: String(record.version),
    integrity: String(record.integrity),
    registry: String(record.registry),
  };
}

/**
 * Refuse a build fact that disagrees with its owning record. The rebuild
 * record is "one byte-identical closed object" (DEC-097 section 5); a
 * member two of this job's own sources state differently is not one this
 * job can send.
 *
 * @param {boolean} agrees whether the two sources agree
 * @param {string} detail which member disagreed, and between what
 * @returns {void}
 */
function agree(agrees, detail) {
  if (!agrees) {
    throw new Error(`AUTHORIZATION_INPUT_BUILD_DISAGREEMENT: ${detail}`);
  }
}

/**
 * Derive the request-side reproducible build record (schema 2.9.0
 * `ReceiptExchangeIntentRequestRebuildRecord`): every member the workflow
 * holds, each from its DEC-097 section 5 owner, and none of the four the
 * API derives.
 *
 * @param {{
 *   lock: ReturnType<typeof readLockFacts>,
 *   lockDocument: Record<string, any>,
 *   publication: {canonicalBase: string},
 *   manifest: Record<string, any>,
 *   metadata: Record<string, any>,
 *   build: {buildInput: Record<string, any> | null, themeContract: Record<string, any> | null},
 *   repositoryId: string
 * }} facts the owning records
 * @returns {{
 *   record: Record<string, unknown>,
 *   missing: {member: string, owner: string}[]
 * }} the record (complete only when `missing` is empty) and every member
 *   with no honest source
 */
export function deriveRebuildRecord(facts) {
  /** @type {{member: string, owner: string}[]} */
  const missing = [];
  const { buildInput, themeContract } = facts.build;
  const schemas = identity(facts.lockDocument.schemas);
  const template = identity(facts.lockDocument.template);
  const theme = identity(facts.lockDocument.theme);

  const sourceCommit = taggedCommit(facts.metadata.sourceCommit);
  if (sourceCommit === null) {
    missing.push({
      member: 'rebuildRecord.sourceCommit',
      owner: OWNERS.checkout,
    });
  }
  for (const member of ['sourceTree', 'buildEpoch']) {
    if (typeof facts.metadata[member] !== 'string') {
      missing.push({
        member: `rebuildRecord.${member}`,
        owner: OWNERS.checkout,
      });
    }
  }

  /** @type {Record<string, unknown> | undefined} */
  let renderPolicy;
  if (buildInput === null) {
    for (const member of ['repositoryRootDigest', 'basePath', 'renderPolicy']) {
      missing.push({
        member: `rebuildRecord.${member}`,
        owner: OWNERS.buildInput,
      });
    }
  } else {
    agree(
      buildInput.contractVersion === '2.0.0',
      'the build input declares a contractVersion other than 2.0.0',
    );
    agree(
      buildInput.baseUrl === facts.publication.canonicalBase,
      'the build input baseUrl is not the publication canonicalBase',
    );
    const packages = buildInput.packages ?? {};
    for (const [name, expected] of /** @type {const} */ ([
      ['schemas', schemas],
      ['template', template],
      ['theme', theme],
    ])) {
      agree(
        canonicalJson(identity(packages[name])) === canonicalJson(expected),
        `the build input packages.${name} is not the lock's ${name} row`,
      );
    }
    agree(
      canonicalJson(identity((packages.publisher ?? [])[0])) ===
        canonicalJson(facts.lock.publisher),
      "the build input packages.publisher[0] is not the lock's publish-action row",
    );
    const policies = new Set(
      /** @type {Record<string, unknown>[]} */ (buildInput.content ?? []).map(
        (entry) => canonicalJson(entry.renderPolicy),
      ),
    );
    agree(
      policies.size === 1,
      `the build input content entries name ${policies.size} render policies, not exactly one`,
    );
    renderPolicy = /** @type {Record<string, unknown>} */ (
      buildInput.content[0].renderPolicy
    );
  }

  if (themeContract === null) {
    missing.push({
      member: 'rebuildRecord.stylingContractDigest',
      owner: OWNERS.themeContract,
    });
  } else {
    agree(
      themeContract.package === `${theme.package}@${theme.version}`,
      "the carried theme contract is not the lock's theme package and version",
    );
  }

  const record = {
    contractVersion: '2.0.0',
    repositoryId: facts.repositoryId,
    sourceCommit,
    sourceTree: facts.metadata.sourceTree ?? null,
    repositoryRootDigest: buildInput?.repository?.rootDigest ?? null,
    buildEpoch: facts.metadata.buildEpoch ?? null,
    buildInputDigest: facts.manifest.buildInputDigest,
    dependencyLockDigest: facts.lock.lockDigest,
    stylingContractDigest: themeContract?.stylingContractDigest ?? null,
    workflowIdentity: facts.manifest.workflowIdentity,
    baseUrl: facts.publication.canonicalBase,
    basePath: buildInput?.basePath ?? null,
    builder: facts.lock.publisher,
    schemas,
    template,
    theme,
    renderPolicy: renderPolicy ?? null,
  };
  return { record, missing };
}

/**
 * Derive the authorization input from what the workflow holds.
 *
 * @param {{
 *   inputs: {metadata: Record<string, any>, files: readonly {path: string, bytes: Buffer}[]},
 *   envelope: {
 *     bytes: Buffer,
 *     files: readonly {path: string, bytes: Buffer}[],
 *     manifest: Record<string, unknown>,
 *     provenanceDigest: string,
 *     sbomDigest: string
 *   },
 *   build: {buildInput: Record<string, any> | null, themeContract: Record<string, any> | null},
 *   runner: Readonly<Record<string, string | undefined>>,
 *   handoff: {artifactId: string, name: string, retentionDays: number, expiresAt: string},
 *   artifactDigest: string
 * }} facts the verified-inputs carrier, the decoded frozen envelope, the
 *   build's validated fact records, the runner's bound identity, the
 *   verified upload and the artifact digest under the selected adapter
 * @returns {{
 *   input: Record<string, unknown>,
 *   missing: readonly {member: string, owner: string}[]
 * }} the derived document plus every required member it could not derive
 *   and who owns it
 */
export function deriveAuthorizationInput(facts) {
  const lock = readLockFacts(facts.inputs.files);
  const lockDocument = readLockDocument(facts.inputs.files);
  const publication = readPublicationFacts(facts.inputs.files);
  if (!MANAGED_ADAPTERS.includes(lock.adapter.adapterId)) {
    throw new Error(
      `AUTHORIZATION_INPUT_ADAPTER_UNMANAGED: the lock selects ${lock.adapterPackage}, which has no managed deploy job; local-directory is the disposable conformance oracle only`,
    );
  }
  const ref = facts.runner.GITHUB_REF ?? '';
  const repository = facts.runner.GITHUB_REPOSITORY ?? '';
  const repositoryId = facts.runner.GITHUB_REPOSITORY_ID ?? '';
  if (repository === '' || repositoryId === '') {
    throw new Error(
      'DEPLOY_RUNNER_IDENTITY_MISSING: GITHUB_REPOSITORY and GITHUB_REPOSITORY_ID are required',
    );
  }
  const artifact = deriveArtifactFacts(
    facts.envelope.files,
    facts.envelope.manifest,
  );

  /** @type {{member: string, owner: string}[]} */
  const missing = [];
  const sourceCommit = taggedCommit(facts.inputs.metadata.sourceCommit);
  const workflowTriggerCommit = taggedCommit(
    facts.inputs.metadata.workflowTriggerCommit,
  );
  for (const [member, value] of [
    ['sourceCommit', sourceCommit],
    ['workflowTriggerCommit', workflowTriggerCommit],
  ]) {
    if (value === null) {
      missing.push({ member: String(member), owner: OWNERS.checkout });
    }
  }
  const rebuild = deriveRebuildRecord({
    lock,
    lockDocument,
    publication,
    manifest: /** @type {Record<string, any>} */ (facts.envelope.manifest),
    metadata: facts.inputs.metadata,
    build: facts.build,
    repositoryId,
  });
  missing.push(...rebuild.missing);

  // The request-side destination (schema 2.9.0): the lock-selected adapter
  // and the publication's canonical base, plus — for GitHub Pages only —
  // the provider coordinates, which are this repository by construction.
  // `environment`, `targetDigest` and the Spaces coordinates are the API's.
  /** @type {Record<string, unknown>} */
  const destination = {
    adapterId: lock.adapter.adapterId,
    adapterVersion: lock.adapter.adapterVersion,
    baseUrl: publication.canonicalBase,
  };
  if (lock.adapter.adapterId === 'github-pages') {
    const [owner, name] = repository.split('/');
    destination.providerBinding = { owner, repository: name };
  }

  const input = {
    purpose: 'deployment-intent',
    operationId: operationIdFromPublishRef(ref),
    repositoryId,
    runId: facts.runner.GITHUB_RUN_ID ?? '0',
    runAttempt: Number.parseInt(facts.runner.GITHUB_RUN_ATTEMPT ?? '1', 10),
    sourceCommit,
    workflowTriggerCommit,
    artifactDigest: facts.artifactDigest,
    manifestDigest: artifact.manifestDigest,
    artifactFileCount: artifact.artifactFileCount,
    artifactByteCount: artifact.artifactByteCount,
    verificationSubmission: artifact.verificationSubmission,
    // The two metadata digests are the envelope decoder's recomputation
    // over the exact records it carries (DEC-097 section 6), never quoted
    // from any earlier job's output.
    provenanceDigest: facts.envelope.provenanceDigest,
    sbomDigest: facts.envelope.sbomDigest,
    frozenEnvelopeDigest: carrierDigest(facts.envelope.bytes),
    frozenEnvelopeByteCount: facts.envelope.bytes.byteLength,
    frozenHandoffArtifactId: facts.handoff.artifactId,
    frozenHandoffName: facts.handoff.name,
    requestedArtifactRetentionDays: facts.handoff.retentionDays,
    effectiveArtifactExpiresAt: milliseconds(facts.handoff.expiresAt),
    lockDigest: lock.lockDigest,
    rebuildRecord: rebuild.record,
    publisher: lock.publisher,
    adapter: lock.adapter,
    destination,
  };
  return { input, missing };
}

/**
 * @returns {Promise<void>} resolves once the authorization input is written
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const inbox = requireOption(options, 'inbox');
  const envelopePath = requireOption(options, 'envelope');
  const outDir = requireOption(options, 'out-dir');

  const inputs = decodeCarrier(
    (await findCarrier(inbox, requireOption(options, 'verified-inputs-digest')))
      .bytes,
  );
  const output = decodeCarrier(
    (await findCarrier(inbox, requireOption(options, 'unfrozen-output-digest')))
      .bytes,
  );
  const envelopeBytes = await readFile(envelopePath);
  const expectedDigest = requireOption(options, 'envelope-digest');
  if (carrierDigest(envelopeBytes) !== expectedDigest) {
    throw new Error(
      'FREEZE_ENVELOPE_DIGEST_MISMATCH: the re-observed upload digest is not the digest of the local frozen envelope',
    );
  }
  const envelope = decodeFrozenEnvelope(envelopeBytes);
  const lock = readLockFacts(inputs.files);

  const { input, missing } = deriveAuthorizationInput({
    inputs,
    envelope: {
      bytes: envelopeBytes,
      files: envelope.files,
      manifest: envelope.manifest,
      provenanceDigest: envelope.provenanceDigest,
      sbomDigest: envelope.sbomDigest,
    },
    build: readBuildFacts(output.files, envelope.manifest),
    runner: process.env,
    handoff: {
      artifactId: requireOption(options, 'frozen-handoff-artifact-id'),
      name: requireOption(options, 'frozen-handoff-name'),
      retentionDays: Number.parseInt(
        requireOption(options, 'retention-days'),
        10,
      ),
      expiresAt: requireOption(options, 'artifact-expires-at'),
    },
    artifactDigest: await artifactDigestUnder(
      lock.adapterPackage,
      envelope.files,
    ),
  });
  if (missing.length > 0) {
    // Derivable members are reported so a reader can see how far the
    // honest path reaches; the document itself is not written.
    process.stdout.write(
      `authorization input derived for ${String(input.adapter && /** @type {any} */ (input.adapter).adapterId)}: ${Object.keys(input).sort().join(', ')}\n`,
    );
    throw new Error(
      `AUTHORIZATION_INPUT_INCOMPLETE: the workflow holds no honest source for members the deployment-intent request requires, so no authorization input is written — ${missing
        .map((entry) => `${entry.member} (${entry.owner})`)
        .join('; ')}`,
    );
  }

  const runId = process.env.GITHUB_RUN_ID ?? '0';
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? '1';
  const target = path.join(
    outDir,
    `gala-r${runId}-a${runAttempt}-authorization-input-v2.jcs`,
  );
  await writeFile(target, Buffer.from(JSON.stringify(input), 'utf8'));
  process.stdout.write(
    `authorization input: ${target} (${String(/** @type {any} */ (input.adapter).adapterId)}; environment, targetDigest, the policy members and capabilityDecisionDigest are the API's to derive, schema 2.9.0)\n`,
  );
}

await runIfMain(import.meta.url, main);
