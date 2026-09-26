/**
 * The `buildProvenance:2.0.0` record `freeze` writes into the frozen
 * envelope's `metadata/provenance.jcs` (DEC-097 section 6, "Build provenance
 * and verified workload binding"), built only from facts the freeze job
 * holds.
 *
 * DEC-097 closes the record with members whose owners are three different
 * parties. This module emits exactly the members the *workflow* is the
 * honest source of — the runner's asserted identity, the 21-claim binding
 * catalog, the two predecessor carrier handoffs it re-observed by exact ID,
 * the lock digest, the manifest's build-input digest, the three artifact
 * digests the envelope itself binds, the pinned official SPDX schema digest
 * and the empty secret-input set — and emits nothing else. Every remaining
 * DEC-097 member is listed in {@link PROVENANCE_MEMBERS_NOT_YET_HELD} with
 * the party that owns it; none is invented, none is filled with a
 * placeholder, and no schema root in the pinned contract requires one, so
 * the record is complete for what this repository can attest and silent
 * about what it cannot. The Gala-side derivation of the policy and
 * capability members is API-INTENT-DERIVATION-1 / schema 2.9.0 work.
 *
 * @module
 */

import { validateGalaDocument } from '@rathnasgala2/schemas';

import { taggedCommit } from './build-authorization-input.mjs';

/** The constant schema identity of the record. */
export const BUILD_PROVENANCE_SCHEMA_ID =
  'urn:gala:metadata:build-provenance:2.0.0';

/**
 * DEC-097's exact 21-member binding/audit claim catalog, ASCII-sorted to
 * byte-match the pinned schema's `requiredOidcClaims` `const`
 * (`schemas/build-provenance.schema.json`, promoted to a root in 2.10.0 —
 * item 5 surfaced that this module's previous DEC-097-narrative order never
 * validated against the wire's fixed spelling).
 */
export const REQUIRED_OIDC_CLAIMS = Object.freeze([
  'actor',
  'actor_id',
  'aud',
  'event_name',
  'iss',
  'job_workflow_ref',
  'job_workflow_sha',
  'jti',
  'ref',
  'repository',
  'repository_id',
  'repository_owner',
  'repository_owner_id',
  'run_attempt',
  'run_id',
  'run_number',
  'runner_environment',
  'sha',
  'sub',
  'workflow_ref',
  'workflow_sha',
]);

/** The two events a publish ref may be created by. */
export const ADMITTED_EVENT_NAMES = Object.freeze([
  'create',
  'workflow_dispatch',
]);

/** The fixed author-caller path DEC-097 section 6 admits. */
export const CALLER_PATH = '.github/workflows/gala-publish-v2.yml';

/**
 * The tagged SHA-256 of the official SPDX 2.3 JSON Schema bytes at
 * `spdx/spdx-spec` commit `aadf3b0b8dbbabdb4d880b0fc714255fea436ff7`, path
 * `schemas/spdx-schema.json` (DEC-097 section 6, "Deterministic SPDX SBOM
 * profile"). `scripts/workflow/sbom.mjs` proves the vendored copy hashes to
 * exactly this before it validates anything against it.
 */
export const SPDX_23_JSON_SCHEMA_DIGEST =
  'sha256:239208b7ac287b3cf5d9a9af23f9d69863971102a5e1587a27a398b43490b89b';

/**
 * DEC-097 `buildProvenance` members this record does not carry, each with
 * the party that owns the fact. They are documented, never invented.
 */
export const PROVENANCE_MEMBERS_NOT_YET_HELD = Object.freeze({
  workflowFiles:
    "the four workflow-file evidence rows need rathnasgala2/publish's numeric repository id (now 1381257185, since W0-01 published it 2026-09-25) plus a content digest of each pinned workflow file at that commit; assembling those rows is unimplemented, not blocked on the id",
  actionPins:
    'actionDefinitionDigest is a digest over each pinned action definition at its commit; the runner does not hold those bytes',
  rebuildRecord:
    'policyReleaseId, buildPolicyDecisionDigest, packageReleaseCatalogDigest and destinationCapabilityDigest are Gala-derived (LOCAL-60, API-INTENT-DERIVATION-1 / schema 2.9.0); a partial reproducibleBuildRecord is not the one byte-identical closed object DEC-097 requires',
  packageReleaseCatalogDigest: 'server-selected package release catalog (Gala)',
  artifactId:
    'the intent binds artifactId to the closed run binding (LOCAL-57); the manifest record carries the template-minted id',
  spdxLicenseListVersion:
    'the accepted immutable SPDX license-list release is a Gala runtime-catalog fact',
  spdxLicenseListDigest:
    'the accepted immutable SPDX license-list release is a Gala runtime-catalog fact',
  artifactLicenseConclusions:
    'per-asset license conclusions need the theme contract’s asset license map; the SBOM records NOASSERTION per file until it is carried',
  policyReleaseId: 'Gala policy release (API-INTENT-DERIVATION-1)',
  buildPolicyDecisionDigest:
    'Gala build-policy decision (API-INTENT-DERIVATION-1)',
  capabilityDecisionDigest:
    'server-owned capability decision (DEC-097 section 7)',
  stylingContractDigest:
    'template styling contract; not carried by the build carrier',
  renderPolicy:
    'template render policy identity; not carried by the build carrier',
  sandbox:
    'runnerImageReleaseDigest is a Gala compatibility-catalog row; the runner cannot attest an admitted row it has never read',
});

const POSITIVE_DECIMAL = /^[1-9][0-9]{0,19}$/u;
const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^(?:sha1:[0-9a-f]{40}|sha256:[0-9a-f]{64})$/u;
const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * One stable provenance failure.
 */
export class BuildProvenanceError extends Error {
  /**
   * @param {string} code the stable code
   * @param {string} detail what was observed
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'BuildProvenanceError';
    this.code = code;
  }
}

/**
 * Read one required runner variable.
 *
 * @param {Readonly<Record<string, string | undefined>>} runner the runner environment
 * @param {string} name the variable
 * @returns {string} its non-empty value
 */
function runnerFact(runner, name) {
  const value = runner[name];
  if (value === undefined || value === '') {
    throw new BuildProvenanceError(
      'PROVENANCE_RUNNER_IDENTITY_MISSING',
      `${name} is required to assert the workload`,
    );
  }
  return value;
}

/**
 * @typedef {{
 *   purpose: 'verified-inputs' | 'unfrozen-output',
 *   artifactId: string,
 *   name: string,
 *   byteCount: string,
 *   digest: string,
 *   expiresAt: string
 * }} CarrierHandoff `byteCount` is the schema's canonical non-negative
 *   decimal string (`gala-int64`, `schemas/build-provenance.schema.json`
 *   `$defs.nonNegativeInt64`), not a JS number — the 2.10.0 root promotion
 *   (item 5) surfaced this module previously carrying a JS number nothing
 *   had ever validated against the wire type
 */

/**
 * Build the provenance record.
 *
 * @param {{
 *   runner: Readonly<Record<string, string | undefined>>,
 *   sourceCommit: unknown,
 *   workflowTriggerCommit: unknown,
 *   verifiedInputHandoff: CarrierHandoff,
 *   unfrozenOutputHandoff: CarrierHandoff,
 *   lockDigest: string,
 *   buildInputDigest: unknown,
 *   artifactDigest: string,
 *   manifestDigest: string,
 *   sbomDigest: string
 * }} facts the runner identity, the verified source's commits, the two
 *   re-observed predecessor handoffs, the lock digest, the manifest's
 *   build-input digest and the three digests the envelope binds
 * @returns {Record<string, unknown>} the validated record
 */
export function buildProvenanceRecord(facts) {
  const runner = facts.runner;
  const record = {
    schemaId: BUILD_PROVENANCE_SCHEMA_ID,
    schemaVersion: '2.0.0',
    assertedWorkload: {
      repository: runnerFact(runner, 'GITHUB_REPOSITORY'),
      repositoryId: runnerFact(runner, 'GITHUB_REPOSITORY_ID'),
      repositoryOwner: runnerFact(runner, 'GITHUB_REPOSITORY_OWNER'),
      repositoryOwnerId: runnerFact(runner, 'GITHUB_REPOSITORY_OWNER_ID'),
      ref: runnerFact(runner, 'GITHUB_REF'),
      sourceCommit: taggedCommit(facts.sourceCommit),
      workflowTriggerCommit: taggedCommit(facts.workflowTriggerCommit),
      runId: runnerFact(runner, 'GITHUB_RUN_ID'),
      runNumber: runnerFact(runner, 'GITHUB_RUN_NUMBER'),
      runAttempt: Number.parseInt(runnerFact(runner, 'GITHUB_RUN_ATTEMPT'), 10),
      eventName: runnerFact(runner, 'GITHUB_EVENT_NAME'),
      actor: runnerFact(runner, 'GITHUB_ACTOR'),
      actorId: runnerFact(runner, 'GITHUB_ACTOR_ID'),
      callerPath: CALLER_PATH,
      verificationState: 'pending-authorize-oidc',
    },
    requiredOidcClaims: [...REQUIRED_OIDC_CLAIMS],
    verifiedInputHandoff: { ...facts.verifiedInputHandoff },
    unfrozenOutputHandoff: { ...facts.unfrozenOutputHandoff },
    lockDigest: facts.lockDigest,
    buildInputDigest: facts.buildInputDigest,
    artifactDigest: facts.artifactDigest,
    manifestDigest: facts.manifestDigest,
    sbomDigest: facts.sbomDigest,
    spdx23JsonSchemaDigest: SPDX_23_JSON_SCHEMA_DIGEST,
    secretInputs: [],
  };
  validateProvenanceRecord(record);
  return record;
}

/**
 * @param {Record<string, unknown>} value the object
 * @param {readonly string[]} members the exact member set
 * @param {string} pointer where, for the diagnostic
 * @returns {void}
 */
function requireExactMembers(value, members, pointer) {
  const present = Object.keys(value).sort();
  const expected = [...members].sort();
  if (JSON.stringify(present) !== JSON.stringify(expected)) {
    throw new BuildProvenanceError(
      'PROVENANCE_INVALID',
      `${pointer} carries [${present.join(', ')}], not exactly [${expected.join(', ')}]`,
    );
  }
}

/**
 * @param {unknown} value the value
 * @param {RegExp} pattern the admitted shape
 * @param {string} pointer where, for the diagnostic
 * @returns {void}
 */
function requireShape(value, pattern, pointer) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new BuildProvenanceError(
      'PROVENANCE_INVALID',
      `${pointer} is ${JSON.stringify(value)}`,
    );
  }
}

/**
 * @param {unknown} value the handoff
 * @param {'verified-inputs' | 'unfrozen-output'} purpose its exact purpose
 * @param {string} pointer where, for the diagnostic
 * @returns {void}
 */
function requireHandoff(value, purpose, pointer) {
  const handoff = /** @type {Record<string, unknown>} */ (value ?? {});
  requireExactMembers(
    handoff,
    ['purpose', 'artifactId', 'name', 'byteCount', 'digest', 'expiresAt'],
    pointer,
  );
  if (handoff.purpose !== purpose) {
    throw new BuildProvenanceError('PROVENANCE_INVALID', `${pointer}/purpose`);
  }
  requireShape(handoff.artifactId, POSITIVE_DECIMAL, `${pointer}/artifactId`);
  requireShape(handoff.name, /^\S.*$/u, `${pointer}/name`);
  requireShape(handoff.byteCount, NON_NEGATIVE_DECIMAL, `${pointer}/byteCount`);
  requireShape(handoff.digest, DIGEST_PATTERN, `${pointer}/digest`);
  requireShape(handoff.expiresAt, INSTANT_PATTERN, `${pointer}/expiresAt`);
}

/**
 * Validate the closed shape of the record this module emits: exactly its
 * member set, every scalar in its DEC-097 domain, and no member DEC-097
 * assigns to another owner.
 *
 * Schema 2.10.0 promotes `buildProvenance` from an internal `$defs` entry
 * (reachable only through whatever root referenced it, so "no schema root
 * in the pinned contract requires one" was literally true) to its own root
 * schema, `urn:gala:metadata:build-provenance:2.0.0`
 * (`schemas/build-provenance.schema.json`), whose `required` names the
 * complete DEC-097 member set. This module still emits only the members it
 * is the honest source of — deliberately, by design, per
 * {@link PROVENANCE_MEMBERS_NOT_YET_HELD} — so validating the partial
 * record against the *complete* root would fail on every documented
 * omission and prove nothing. Instead: every member this module DOES emit
 * is validated against the pinned root's own per-property rules (shape,
 * pattern, enum — the authoritative, generator-agnostic check), and the
 * only diagnostics tolerated are "required field missing" for exactly the
 * top-level members {@link PROVENANCE_MEMBERS_NOT_YET_HELD} names; any
 * other diagnostic — a held member's value violating its schema rule, or a
 * missing member this list does not document — fails closed. The
 * hand-written member-by-member checks below run in addition, never
 * instead: they prove this module emits nothing DEC-097 assigns to another
 * party, a fact `additionalProperties: false` alone would not distinguish
 * from "this module simply omitted a member it does hold."
 *
 * @param {Record<string, unknown>} record the candidate record
 * @returns {void}
 */
export function validateProvenanceRecord(record) {
  const verdict = validateGalaDocument(BUILD_PROVENANCE_SCHEMA_ID, record);
  if (!verdict.valid) {
    const tolerated = new Set(
      Object.keys(PROVENANCE_MEMBERS_NOT_YET_HELD).map(
        (member) => `/${member}`,
      ),
    );
    const unexpected = verdict.diagnostics.filter(
      (diagnostic) =>
        !(
          diagnostic.code === 'SCHEMA_REQUIRED_FIELD_MISSING' &&
          tolerated.has(diagnostic.instancePointer)
        ),
    );
    if (unexpected.length > 0) {
      throw new BuildProvenanceError(
        'PROVENANCE_INVALID',
        `${unexpected.map((diagnostic) => diagnostic.instancePointer).join(', ')} — not a ${BUILD_PROVENANCE_SCHEMA_ID} instance for the members this module holds: ${JSON.stringify(unexpected).slice(0, 2000)}`,
      );
    }
  }
  requireExactMembers(
    record,
    [
      'schemaId',
      'schemaVersion',
      'assertedWorkload',
      'requiredOidcClaims',
      'verifiedInputHandoff',
      'unfrozenOutputHandoff',
      'lockDigest',
      'buildInputDigest',
      'artifactDigest',
      'manifestDigest',
      'sbomDigest',
      'spdx23JsonSchemaDigest',
      'secretInputs',
    ],
    '',
  );
  if (
    record.schemaId !== BUILD_PROVENANCE_SCHEMA_ID ||
    record.schemaVersion !== '2.0.0'
  ) {
    throw new BuildProvenanceError('PROVENANCE_INVALID', '/schemaId');
  }
  const workload = /** @type {Record<string, unknown>} */ (
    record.assertedWorkload ?? {}
  );
  requireExactMembers(
    workload,
    [
      'repository',
      'repositoryId',
      'repositoryOwner',
      'repositoryOwnerId',
      'ref',
      'sourceCommit',
      'workflowTriggerCommit',
      'runId',
      'runNumber',
      'runAttempt',
      'eventName',
      'actor',
      'actorId',
      'callerPath',
      'verificationState',
    ],
    '/assertedWorkload',
  );
  requireShape(
    workload.repository,
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/u,
    '/assertedWorkload/repository',
  );
  for (const member of [
    'repositoryId',
    'repositoryOwnerId',
    'runId',
    'runNumber',
    'actorId',
  ]) {
    requireShape(
      workload[member],
      POSITIVE_DECIMAL,
      `/assertedWorkload/${member}`,
    );
  }
  requireShape(
    workload.repositoryOwner,
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u,
    '/assertedWorkload/repositoryOwner',
  );
  requireShape(workload.ref, /^[\x21-\x7e]{1,512}$/u, '/assertedWorkload/ref');
  requireShape(
    workload.sourceCommit,
    COMMIT_PATTERN,
    '/assertedWorkload/sourceCommit',
  );
  requireShape(
    workload.workflowTriggerCommit,
    COMMIT_PATTERN,
    '/assertedWorkload/workflowTriggerCommit',
  );
  if (
    typeof workload.runAttempt !== 'number' ||
    !Number.isInteger(workload.runAttempt) ||
    workload.runAttempt < 1 ||
    workload.runAttempt > 51
  ) {
    throw new BuildProvenanceError(
      'PROVENANCE_INVALID',
      '/assertedWorkload/runAttempt',
    );
  }
  if (
    !ADMITTED_EVENT_NAMES.includes(/** @type {string} */ (workload.eventName))
  ) {
    throw new BuildProvenanceError(
      'PROVENANCE_INVALID',
      `/assertedWorkload/eventName is ${JSON.stringify(workload.eventName)}; a publish ref is created only by create or workflow_dispatch`,
    );
  }
  requireShape(
    workload.actor,
    /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?|[A-Za-z0-9](?:[A-Za-z0-9-]{0,92}[A-Za-z0-9])?\[bot\])$/u,
    '/assertedWorkload/actor',
  );
  if (
    workload.callerPath !== CALLER_PATH ||
    workload.verificationState !== 'pending-authorize-oidc'
  ) {
    throw new BuildProvenanceError(
      'PROVENANCE_INVALID',
      '/assertedWorkload/callerPath',
    );
  }
  if (
    JSON.stringify(record.requiredOidcClaims) !==
    JSON.stringify(REQUIRED_OIDC_CLAIMS)
  ) {
    throw new BuildProvenanceError('PROVENANCE_INVALID', '/requiredOidcClaims');
  }
  requireHandoff(
    record.verifiedInputHandoff,
    'verified-inputs',
    '/verifiedInputHandoff',
  );
  requireHandoff(
    record.unfrozenOutputHandoff,
    'unfrozen-output',
    '/unfrozenOutputHandoff',
  );
  for (const member of [
    'lockDigest',
    'buildInputDigest',
    'artifactDigest',
    'manifestDigest',
    'sbomDigest',
  ]) {
    requireShape(record[member], DIGEST_PATTERN, `/${member}`);
  }
  if (record.spdx23JsonSchemaDigest !== SPDX_23_JSON_SCHEMA_DIGEST) {
    throw new BuildProvenanceError(
      'PROVENANCE_INVALID',
      '/spdx23JsonSchemaDigest',
    );
  }
  if (!Array.isArray(record.secretInputs) || record.secretInputs.length !== 0) {
    throw new BuildProvenanceError('PROVENANCE_INVALID', '/secretInputs');
  }
}
