/**
 * LOCAL-62: the capability decision the intent's `capabilityDecisionDigest`
 * is over is the API's issuance-phase record, and the deploy job recomputes
 * exactly that record before staging (`scripts/workflow/capability-decision.mjs`).
 *
 * What is pinned here:
 *
 * - the mirrored admission rows digest to the literals the API seeds in
 *   release 0045 (`gala_core.adapter_capability`, superseded `2.0.0` rows)
 *   and release 0046 (`0.1.0` rows, the ones actually admitted, LOCAL-64), by
 *   the API's own canonical admission-text convention — so the mirror is
 *   provably those rows, keyed by `(adapterId, adapterVersion)` exactly as
 *   the API selects them, and a version with no admitted row (superseded or
 *   never seeded) is refused;
 * - the issuance-phase member set and the deploy-phase member set partition
 *   the schema's closed `capabilityDecision` record, and agree with the
 *   pinned schema's `x-gala-decision-phase` annotations wherever the pinned
 *   package carries them (schema 2.9.1);
 * - the fake Gala's intents recompute to their own digest, a tampered
 *   digest is refused by name, and the deploy-phase evaluation is evidence
 *   with the exact totals.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import {
  ADMISSION_ROWS,
  DEPLOY_PHASE_MEMBERS,
  ISSUANCE_PHASE_MEMBERS,
  admissionCanonicalText,
  admissionRow,
  deployPhaseEvaluation,
  issuancePhaseDecision,
  markerJcs,
  pagesActionsArtifactName,
  recomputeSpacesClosedRecords,
  requireCapabilityDecisionAgreement,
} from '../scripts/workflow/capability-decision.mjs';
import { buildDeploymentIntentRequest } from '../scripts/workflow/workload-requests.mjs';
import {
  ARTIFACT_FILES,
  authorizationInput,
} from './fixtures/authorization-input.mjs';
import {
  renderIntent,
  seedWithDefaults,
  stableId,
} from './fixtures/fake-gala-api.mjs';

const schemasRoot = path.dirname(
  fileURLToPath(
    await import.meta.resolve('@rathnasgala2/schemas/package.json'),
  ),
);

/**
 * The literals the API seeds in release 0045 (`020-adapter-capability.yaml`
 * at api slice `a74ffc8`) at adapter_version `2.0.0` — superseded by release
 * 0046 (LOCAL-64) and admitting nothing, but still stored, plain hex as the
 * table stores them.
 */
const SEEDED_0045 = Object.freeze({
  'local-directory': {
    capability:
      '67116eb942a9e92b0dbf5604d97c84dce6b8d18c44cfa9e23ccce3a3fe6ce233',
  },
  'github-pages': {
    capability:
      '61ae9d1ba80ed228fb6650798fb976a3bb7487c05d01b3737465db2e8d20ef44',
    credentialEgress:
      '22ccb55dc7d503f9a7c076fbf48d9da0cbf18cf52d21268633f16250a3d1eb6b',
    pagesOidc:
      '2010f7430c3ffdd8de88c8b86be021f1aaa38bfb2a7a7d22a1e3229f024ed8d9',
  },
  'do-spaces': {
    capability:
      'd3d8f8288393f05c02898a709dbbb9ddd5d5fa17b9a994bf18214b12c526b711',
    credentialEgress:
      '373554c1b9e0e32ae822d1a97d293f2176fe8f2acf1d885475df1528cf3e6905',
  },
});

/**
 * The literals the API seeds in release 0046
 * (`010-adapter-capability-package-version.yaml` at api worktree
 * `api-followups-8`) at adapter_version `0.1.0` — the admitted rows
 * (LOCAL-64: the published adapter package version, not the protocol
 * version), plain hex as the table stores them.
 */
const SEEDED_0046 = Object.freeze({
  'local-directory': {
    capability:
      '2fa784e21d3c6805d19facb163f1cd557918ea1bbc498a32da7fe8176a85dbbc',
  },
  'github-pages': {
    capability:
      'c15d5809356f8f28e811fd2103fe33dc2dfb3b7cd8d5fc1cefa44972de6b73c4',
    credentialEgress:
      '7665829fb930773bc9e60f6fa7495503aeb3ea5d04c36ec10989653f64b0d0ba',
    pagesOidc:
      'b9f0f7a03905c060d2f8ea65ef6b17e5eab6f360576d52ae7cded5fa3728cd13',
  },
  'do-spaces': {
    capability:
      'f584f85b53cbfc3f2d004a7027c593b972cd71dd1c2ba8f87023c1025a7f4699',
    credentialEgress:
      'ca89c7b6eae56fd0577b1360fbeee2c7602c232eaf957d313cbe3f882f8e3398',
  },
});

const OPERATION_ID = stableId();
const REPOSITORY_ID = '4242';
const RUN_ID = '987654321';
const RUN_ATTEMPT = 1;

/**
 * One intent exactly as the fake Gala issues it for a request this workflow
 * built.
 *
 * @param {'github-pages' | 'local-directory'} adapterId the adapter
 * @returns {Record<string, any>} the intent
 */
function intentFor(adapterId) {
  const { request, derived } = buildDeploymentIntentRequest(
    /** @type {any} */ (
      authorizationInput({
        adapterId,
        operationId: OPERATION_ID,
        repositoryId: REPOSITORY_ID,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
      })
    ),
  );
  return renderIntent(
    request,
    seedWithDefaults({
      repository: 'gala-author/site',
      repositoryId: REPOSITORY_ID,
      operationId: OPERATION_ID,
    }),
    {
      intentId: stableId(),
      artifactId: derived.artifactId,
      attemptId: derived.attemptId,
      generationId: derived.proposedGenerationId,
      authorityId: stableId(),
      binding: {
        repositoryId: REPOSITORY_ID,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
      },
      ...(derived.pagesBuildVersion === undefined
        ? {}
        : { pagesBuildVersion: derived.pagesBuildVersion }),
    },
  );
}

/**
 * Look up a seeded row by `(adapterId, adapterVersion)` directly in
 * `ADMISSION_ROWS`, ignoring `supersededAt` — used to prove the 0045
 * `2.0.0` rows still digest to the seeded literals even though they no
 * longer admit anything.
 *
 * @param {string} adapterId the adapter
 * @param {string} adapterVersion the row's adapter_version
 * @returns {(typeof ADMISSION_ROWS)[number]} the row
 */
function seededRow(adapterId, adapterVersion) {
  const row = ADMISSION_ROWS.find(
    (candidate) =>
      candidate.adapterId === adapterId &&
      candidate.adapterVersion === adapterVersion,
  );
  assert.ok(row, `${adapterId}@${adapterVersion} is seeded`);
  return /** @type {(typeof ADMISSION_ROWS)[number]} */ (row);
}

test('the mirrored admission rows are releases 0045 (superseded 2.0.0) and 0046 (admitted 0.1.0): every digest recomputes from the canonical admission text to the seeded literal', () => {
  for (const [adapterId, seeded] of Object.entries(SEEDED_0045)) {
    const row = seededRow(adapterId, '2.0.0');
    assert.equal(row.supersededAt, '2026-09-18T12:00:00.000Z', adapterId);
    const text = admissionCanonicalText(adapterId, row);
    const digest = `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
    assert.equal(digest, `sha256:${seeded.capability}`, `${adapterId} 2.0.0`);
  }
  for (const [adapterId, seeded] of Object.entries(SEEDED_0046)) {
    const row = seededRow(adapterId, '0.1.0');
    assert.equal(row.supersededAt, null, adapterId);
    const admitted = admissionRow(adapterId, '0.1.0');
    assert.equal(admitted.adapterVersion, '0.1.0', adapterId);
    assert.equal(
      admitted.capabilityDigest,
      `sha256:${seeded.capability}`,
      adapterId,
    );
    assert.equal(
      admitted.credentialEgressProfileDigest,
      'credentialEgress' in seeded
        ? `sha256:${seeded.credentialEgress}`
        : undefined,
      `${adapterId} credential egress`,
    );
    assert.equal(
      admitted.pagesOidcOriginCatalogDigest,
      'pagesOidc' in seeded ? `sha256:${seeded.pagesOidc}` : undefined,
      `${adapterId} pages oidc catalog`,
    );
    const text = admissionCanonicalText(adapterId, row);
    for (const member of [
      'maximumFiles',
      'maximumFileBytes',
      'maximumArtifactBytes',
      'maximumPathBytes',
      'maximumStageRequestCount',
      'maximumStageRequestBytes',
      'maximumStageResponseBytes',
      'maximumStageResponseWireBytes',
    ]) {
      assert.ok(
        text.includes(
          `;${member}=${row[/** @type {keyof typeof row} */ (member)]}`,
        ),
        `${adapterId}: ${member} restates the canonical text`,
      );
    }
  }
  // LOCAL-64: a superseded version admits nothing, and neither does an
  // adapter version never seeded at all — both are the API's
  // 422 /adapter/adapterVersion.
  for (const adapterId of Object.keys(SEEDED_0045)) {
    assert.throws(
      () => admissionRow(adapterId, '2.0.0'),
      /CAPABILITY_ADMISSION_UNKNOWN/u,
      `${adapterId}@2.0.0 is superseded, not admitted`,
    );
  }
  assert.throws(
    () => admissionRow('cloudflare-pages', '0.1.0'),
    /CAPABILITY_ADMISSION_UNKNOWN/u,
  );
  assert.throws(
    () => admissionRow('local-directory', '9.9.9'),
    /CAPABILITY_ADMISSION_UNKNOWN/u,
    'a never-seeded version has no admitted row either',
  );
});

/**
 * A hard-coded reference copy of the two phase sets, restated by hand from
 * DEC-097 lines 8378-8449 rather than read from the pinned schema. This is
 * the *only* place in the repository this partition is hard-coded
 * (`capability-decision.mjs`'s exports are schema-derived, LOCAL-63 item
 * 1); its only job is to catch a schema repin that quietly reclassifies a
 * member — the test below fails the moment this reference copy and the
 * schema-derived export disagree, rather than the drift being silently
 * absorbed by both sides reading the same file.
 */
const REFERENCE_ISSUANCE_PHASE_MEMBERS = [
  'profile',
  'artifactId',
  'artifactDigest',
  'manifestDigest',
  'destination',
  'adapter',
  'capabilityDigest',
  'credentialEgressProfileDigest',
  'pagesOidcOriginCatalogDigest',
  'artifactFileCount',
  'deploymentObjectCount',
  'artifactByteCount',
  'markerByteLength',
  'deploymentByteCount',
  'maximumFinalPathByteLength',
  'maximumStageRequestCount',
  'maximumStageRequestBytes',
  'maximumStageResponseBytes',
  'maximumStageResponseWireBytes',
  'pagesActionsArtifactName',
  'pagesBuildVersion',
  'spacesStagePrefix',
  'spacesWebsiteConfigurationDigest',
  'spacesControlPlaneBindingDigest',
  'spacesControlPlaneRequestCatalogDigest',
  'spacesControlPlaneResponseCatalogDigest',
  'spacesControlPlaneTlsProfileDigest',
  'decisionDigest',
];

const REFERENCE_DEPLOY_PHASE_MEMBERS = [
  'pagesActionsArtifactByteCount',
  'pagesActionsArtifactDigest',
];

test('the issuance-phase and deploy-phase member sets partition the schema’s closed capabilityDecision record, agree with x-gala-decision-phase, and agree with the hand-restated reference copy', async () => {
  const root = JSON.parse(
    await readFile(
      path.join(schemasRoot, 'schemas/adapter-capability.schema.json'),
      'utf8',
    ),
  );
  const properties = root.$defs.capabilityDecision.properties;
  assert.deepEqual(
    [...ISSUANCE_PHASE_MEMBERS, ...DEPLOY_PHASE_MEMBERS].sort(),
    Object.keys(properties).sort(),
    'every record member is in exactly one phase',
  );
  assert.equal(
    new Set([...ISSUANCE_PHASE_MEMBERS, ...DEPLOY_PHASE_MEMBERS]).size,
    ISSUANCE_PHASE_MEMBERS.length + DEPLOY_PHASE_MEMBERS.length,
  );
  // ISSUANCE_PHASE_MEMBERS/DEPLOY_PHASE_MEMBERS are themselves derived from
  // x-gala-decision-phase (capability-decision.mjs), so this closes the
  // loop: the exported, schema-derived sets must still classify every
  // member exactly as its own annotation says.
  for (const [member, property] of Object.entries(properties)) {
    const phase = /** @type {any} */ (property)['x-gala-decision-phase'];
    assert.ok(
      phase === 'issuance' || phase === 'deploy',
      `${member}: the pinned schema must annotate x-gala-decision-phase as "issuance" or "deploy" (schema 2.10.0)`,
    );
    const expected = ISSUANCE_PHASE_MEMBERS.includes(member)
      ? 'issuance'
      : 'deploy';
    assert.equal(
      phase,
      expected,
      `${member}: the pinned schema's x-gala-decision-phase disagrees with the derived set`,
    );
  }
  // And the hand-restated reference copy above must still agree with the
  // schema-derived export — a schema repin that reclassifies a member
  // without a matching update here is a visible failure, not silent drift.
  assert.deepEqual(
    [...ISSUANCE_PHASE_MEMBERS].sort(),
    [...REFERENCE_ISSUANCE_PHASE_MEMBERS].sort(),
    'the schema-derived issuance-phase set agrees with the hand-restated reference copy',
  );
  assert.deepEqual(
    [...DEPLOY_PHASE_MEMBERS].sort(),
    [...REFERENCE_DEPLOY_PHASE_MEMBERS].sort(),
    'the schema-derived deploy-phase set agrees with the hand-restated reference copy',
  );
});

test('the issuance-phase record carries no deploy-phase member key at all, for every adapter — the digest agreement with the API holds by construction, never because the pinned schema profile projects deploy-phase members out of the digest', async () => {
  // Review finding (schema slice 482b899): the pinned capabilityDecision
  // digest profile does NOT exclude deploy-phase members from the hash —
  // it excludes only decisionDigest itself (the golden
  // capability-decision-github-pages vector's own digest is taken over a
  // record that DOES carry both deploy-phase members, and digests
  // differently once they are stripped — see the "golden capability-decision
  // vector" test below). So this module's issuance-phase digest can only
  // ever agree with the API's issuance-time capabilityDecisionDigest because
  // issuancePhaseDecision's record never has a deploy-phase key in the first
  // place (deploy-phase facts — the Pages carrier's byte count and digest —
  // do not exist yet at issuance). This test pins that structural property
  // directly, independent of any digest computation, for every adapter this
  // module issues a decision for.
  /**
   * @param {Record<string, unknown>} record the built issuance-phase record
   * @param {string} member the member name
   * @returns {boolean} whether `record` carries that key at all
   */
  const hasKey = (record, member) =>
    Object.prototype.hasOwnProperty.call(record, member);

  for (const adapterId of /** @type {const} */ ([
    'github-pages',
    'local-directory',
  ])) {
    const intent = intentFor(adapterId);
    const decision = requireCapabilityDecisionAgreement(intent, {
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
    });
    for (const member of DEPLOY_PHASE_MEMBERS) {
      assert.equal(
        hasKey(decision.record, member),
        false,
        `${adapterId}: issuance-phase record must carry no "${member}" key`,
      );
    }
  }

  // do-spaces: the fifth issuable-adapter path, through the same fake.
  const operationId = stableId();
  const repositoryId = REPOSITORY_ID;
  const { request, derived } = buildDeploymentIntentRequest(
    /** @type {any} */ (
      authorizationInput({
        adapterId: 'do-spaces',
        operationId,
        repositoryId,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
        destination: {
          baseUrl:
            'https://gala-newsletter-served.nyc3-static.digitaloceanspaces.com/',
        },
      })
    ),
  );
  const seed = seedWithDefaults({
    repository: 'gala-author/site',
    repositoryId,
    operationId,
    destination: {
      adapterId: 'do-spaces',
      spaces: {
        region: 'nyc3',
        servedBucket: 'gala-newsletter-served',
        stagingBucket: 'gala-newsletter-staging',
        basePath: '/',
      },
    },
  });
  const spacesIntent = /** @type {Record<string, any>} */ (
    renderIntent(request, seed, {
      intentId: stableId(),
      artifactId: derived.artifactId,
      attemptId: derived.attemptId,
      generationId: derived.proposedGenerationId,
      authorityId: stableId(),
      binding: { repositoryId, runId: RUN_ID, runAttempt: RUN_ATTEMPT },
      ...(derived.spacesStagePrefix === undefined
        ? {}
        : { spacesStagePrefix: derived.spacesStagePrefix }),
    })
  );
  const spacesClosedRecords = await recomputeSpacesClosedRecords(spacesIntent);
  const spacesDecision = requireCapabilityDecisionAgreement(
    spacesIntent,
    { runId: RUN_ID, runAttempt: RUN_ATTEMPT },
    spacesClosedRecords,
  );
  for (const member of DEPLOY_PHASE_MEMBERS) {
    assert.equal(
      hasKey(spacesDecision.record, member),
      false,
      `do-spaces: issuance-phase record must carry no "${member}" key`,
    );
  }
});

test('a fake-issued intent recomputes to its own capabilityDecisionDigest for both issuable adapters, and a tampered digest is refused by name before staging', () => {
  for (const adapterId of /** @type {const} */ ([
    'github-pages',
    'local-directory',
  ])) {
    const intent = intentFor(adapterId);
    const decision = requireCapabilityDecisionAgreement(intent, {
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
    });
    assert.equal(decision.decisionDigest, intent.capabilityDecisionDigest);
    assert.equal(
      decision.admission.adapterVersion,
      intent.adapter.adapterVersion,
    );
    // Issuance phase: no carrier facts, admitted bounds, the retained
    // destination and the adapter byte-for-byte.
    for (const member of DEPLOY_PHASE_MEMBERS) {
      assert.equal(
        decision.record[member],
        undefined,
        `${member} is deploy-phase`,
      );
    }
    assert.deepEqual(decision.record.destination, intent.destination);
    assert.deepEqual(decision.record.adapter, intent.adapter);
    assert.equal(
      decision.record.maximumFinalPathByteLength,
      decision.admission.maximumPathBytes,
    );
    assert.equal(
      decision.record.deploymentObjectCount,
      String(Number(intent.artifactFileCount) + 1),
    );
    assert.equal(
      decision.record.deploymentByteCount,
      String(Number(intent.artifactByteCount) + decision.markerByteLength),
    );
    assert.equal(
      decision.markerByteLength,
      Buffer.byteLength(markerJcs(intent.marker), 'utf8'),
    );
    if (adapterId === 'github-pages') {
      assert.equal(
        decision.record.pagesActionsArtifactName,
        pagesActionsArtifactName(RUN_ID, RUN_ATTEMPT),
      );
      assert.equal(
        decision.record.pagesActionsArtifactName,
        `gala-pages-r${RUN_ID}-a${RUN_ATTEMPT}`,
      );
      assert.equal(decision.record.pagesBuildVersion, intent.pagesBuildVersion);
      assert.ok(decision.record.credentialEgressProfileDigest);
      assert.ok(decision.record.pagesOidcOriginCatalogDigest);
    } else {
      assert.equal(decision.record.pagesActionsArtifactName, undefined);
      assert.equal(decision.record.credentialEgressProfileDigest, undefined);
    }
    // The profile the API's DomainSeparatedJcs mirrors: the digest is the
    // schema package's own over the record.
    const profile = /** @type {any} */ (ACTIVE_DIGEST_PROFILES)
      .capabilityDecision;
    assert.equal(profile.digest(decision.record), decision.decisionDigest);

    // A different run attempt (Pages) or a tampered digest is refused.
    assert.throws(
      () =>
        requireCapabilityDecisionAgreement(
          { ...intent, capabilityDecisionDigest: `sha256:${'0'.repeat(64)}` },
          { runId: RUN_ID, runAttempt: RUN_ATTEMPT },
        ),
      /^Error: DEPLOY_CAPABILITY_DECISION_MISMATCH: .*LOCAL-62/u,
    );
    if (adapterId === 'github-pages') {
      assert.throws(
        () =>
          requireCapabilityDecisionAgreement(intent, {
            runId: RUN_ID,
            runAttempt: RUN_ATTEMPT + 1,
          }),
        /DEPLOY_CAPABILITY_DECISION_MISMATCH/u,
        'the Pages artifact name binds the run attempt',
      );
    }
  }
});

test('the golden capability-decision vector minus its two deploy-phase members digests differently, so the two phases are genuinely different records', async () => {
  const vectors = JSON.parse(
    await readFile(
      fileURLToPath(
        import.meta
          .resolve('@rathnasgala2/schemas/parity/digest-record-vectors.json'),
      ),
      'utf8',
    ),
  );
  const vector = vectors.vectors.find(
    (/** @type {any} */ entry) =>
      entry.vectorId === 'capability-decision-github-pages',
  );
  const profile = /** @type {any} */ (ACTIVE_DIGEST_PROFILES)
    .capabilityDecision;
  assert.equal(profile.digest(vector.input), `sha256:${vector.digestHex}`);
  const issuance = { ...vector.input };
  for (const member of DEPLOY_PHASE_MEMBERS) {
    delete issuance[member];
  }
  assert.notEqual(profile.digest(issuance), `sha256:${vector.digestHex}`);
  // The builder reproduces the complete-shape vector's issuance projection
  // when handed the vector's own admission values and identities.
  const rebuilt = issuancePhaseDecision({
    artifactId: vector.input.artifactId,
    artifactDigest: vector.input.artifactDigest,
    manifestDigest: vector.input.manifestDigest,
    destination: vector.input.destination,
    adapter: vector.input.adapter,
    artifactFileCount: vector.input.artifactFileCount,
    artifactByteCount: vector.input.artifactByteCount,
    marker: {
      schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
      schemaVersion: '2.0.0',
      artifactId: vector.input.artifactId,
      artifactDigest: vector.input.artifactDigest,
      generationId: '019c0000-0000-7000-8000-000000000003',
    },
    pagesBuildVersion: vector.input.pagesBuildVersion,
    runId: '1',
    runAttempt: 1,
    admission: {
      adapterId: 'github-pages',
      adapterVersion: '2.0.0',
      capabilityDigest: vector.input.capabilityDigest,
      credentialEgressProfileDigest: vector.input.credentialEgressProfileDigest,
      pagesOidcOriginCatalogDigest: vector.input.pagesOidcOriginCatalogDigest,
      maximumFiles: '100000',
      maximumFileBytes: '1073741824',
      maximumArtifactBytes: '1073741824',
      maximumPathBytes: vector.input.maximumFinalPathByteLength,
      maximumStageRequestCount: vector.input.maximumStageRequestCount,
      maximumStageRequestBytes: vector.input.maximumStageRequestBytes,
      maximumStageResponseBytes: vector.input.maximumStageResponseBytes,
      maximumStageResponseWireBytes: vector.input.maximumStageResponseWireBytes,
    },
  });
  // Every member the vector and the builder both carry agrees, except the
  // ones whose inputs the vector does not state (marker length, artifact name).
  for (const [member, value] of Object.entries(issuance)) {
    if (
      [
        'markerByteLength',
        'deploymentByteCount',
        'pagesActionsArtifactName',
        'decisionDigest',
      ].includes(member)
    ) {
      continue;
    }
    assert.deepEqual(rebuilt.record[member], value, member);
  }
});

test('the deploy-phase evaluation is exact evidence over the payload plus the marker', () => {
  const evaluation = deployPhaseEvaluation({
    files: [...ARTIFACT_FILES],
    markerByteLength: 200,
    pagesActionsArtifactDigest: `sha256:${'a'.repeat(64)}`,
    pagesActionsArtifactByteCount: 4096,
  });
  const bytes = ARTIFACT_FILES.reduce(
    (total, file) => total + file.bytes.byteLength,
    0,
  );
  assert.deepEqual(evaluation, {
    artifactFileCount: String(ARTIFACT_FILES.length),
    deploymentObjectCount: String(ARTIFACT_FILES.length + 1),
    artifactByteCount: String(bytes),
    markerByteLength: '200',
    deploymentByteCount: String(bytes + 200),
    exactFinalPathByteLength: String(
      Buffer.byteLength('.well-known/gala-generation.json', 'utf8'),
    ),
    exactStageRequestCount: String(ARTIFACT_FILES.length + 1),
    pagesActionsArtifactDigest: `sha256:${'a'.repeat(64)}`,
    pagesActionsArtifactByteCount: '4096',
  });
});
