/**
 * Workflow graph, permission and secret-map equality (S4-T06; DEC-097
 * section 6 and slice brief section 2.2).
 *
 * The brief calls the permission cell "normative set equality; omission or
 * addition rejects", and the job conditions "the literal expressions in
 * DEC-097 section 6" that "generated workflow tests compare byte-for-byte".
 * These tests are that comparison: the expected table below is transcribed
 * from the decision, and every assertion is exact equality, never a
 * substring or a superset check.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parse } from 'yaml';

/**
 * @param {string} file the workflow path
 * @returns {Record<string, any>} the parsed workflow
 */
function load(file) {
  return parse(readFileSync(file, 'utf8'));
}

const PUBLISH = load('.github/workflows/publish-v2.yml');
const AUTHORIZE = load('.github/workflows/authorize-v2.yml');
const REPORT = load('.github/workflows/report-v2.yml');
const CALLER = load('docs/callers/gala-publish-v2.yml');

const EXPECTED_JOBS = [
  'prep',
  'build',
  'freeze',
  'attest',
  'authorize',
  'verify-do-spaces-configuration',
  'deploy-do-spaces',
  'deploy-github-pages',
  'report',
];

/** @type {Record<string, string[] | undefined>} */
const EXPECTED_NEEDS = {
  prep: undefined,
  build: ['prep'],
  freeze: ['prep', 'build'],
  attest: ['freeze'],
  authorize: ['prep', 'freeze', 'attest'],
  'verify-do-spaces-configuration': ['authorize', 'freeze'],
  'deploy-do-spaces': ['authorize', 'freeze', 'verify-do-spaces-configuration'],
  'deploy-github-pages': ['authorize', 'freeze'],
  report: ['authorize', 'deploy-do-spaces', 'deploy-github-pages'],
};

/** @type {Record<string, Record<string, string>>} */
const EXPECTED_PERMISSIONS = {
  prep: { actions: 'read', contents: 'read' },
  build: { actions: 'read' },
  freeze: { actions: 'read' },
  attest: {
    actions: 'read',
    attestations: 'write',
    contents: 'read',
    'id-token': 'write',
  },
  authorize: { actions: 'read', 'id-token': 'write' },
  'verify-do-spaces-configuration': { actions: 'read' },
  'deploy-do-spaces': { actions: 'read' },
  'deploy-github-pages': {
    actions: 'read',
    'id-token': 'write',
    pages: 'write',
  },
  report: { actions: 'read', 'id-token': 'write' },
};

const AUTHORIZE_CONDITION =
  "${{ always() && needs.prep.result == 'success' && needs.prep.outputs.ref_kind == 'publish' && needs.freeze.result == 'success' && (needs.attest.result == 'success' || (needs.attest.result == 'skipped' && inputs.require_github_attestation == false)) }}";
const SPACES_VERIFIER_CONDITION =
  "${{ always() && needs.authorize.result == 'success' && needs.freeze.result == 'success' && needs.authorize.outputs.adapter_id == 'do-spaces' }}";
const SPACES_DEPLOY_CONDITION =
  "${{ always() && needs.authorize.result == 'success' && needs.freeze.result == 'success' && needs['verify-do-spaces-configuration'].result == 'success' && needs.authorize.outputs.adapter_id == 'do-spaces' }}";
const PAGES_DEPLOY_CONDITION =
  "${{ always() && needs.authorize.result == 'success' && needs.freeze.result == 'success' && needs.authorize.outputs.adapter_id == 'github-pages' }}";
const REPORT_CONDITION =
  "${{ always() && needs.authorize.result == 'success' && ((needs.authorize.outputs.adapter_id == 'do-spaces' && needs['deploy-do-spaces'].result == 'success' && needs['deploy-github-pages'].result == 'skipped') || (needs.authorize.outputs.adapter_id == 'github-pages' && needs['deploy-github-pages'].result == 'success' && needs['deploy-do-spaces'].result == 'skipped')) }}";

test('publish-v2 declares exactly the nine jobs, in order', () => {
  assert.deepEqual(Object.keys(PUBLISH.jobs), EXPECTED_JOBS);
});

test('every job declares exactly its DEC-097 needs', () => {
  for (const job of EXPECTED_JOBS) {
    assert.deepEqual(
      PUBLISH.jobs[job].needs,
      EXPECTED_NEEDS[job],
      `${job}: needs`,
    );
  }
});

test('every job declares exactly its DEC-097 permission set, by set equality', () => {
  for (const job of EXPECTED_JOBS) {
    assert.deepEqual(
      PUBLISH.jobs[job].permissions,
      EXPECTED_PERMISSIONS[job],
      `${job}: permissions`,
    );
  }
});

test('the called workflow itself grants nothing at file level', () => {
  assert.deepEqual(PUBLISH.permissions, {});
  assert.deepEqual(AUTHORIZE.permissions, {});
  assert.deepEqual(REPORT.permissions, {});
});

test('the three workflows have only workflow_call', () => {
  for (const workflow of [PUBLISH, AUTHORIZE, REPORT]) {
    assert.deepEqual(Object.keys(workflow.on), ['workflow_call']);
  }
});

test('the four gated job conditions are byte-equal to DEC-097 section 6', () => {
  assert.equal(PUBLISH.jobs.authorize.if, AUTHORIZE_CONDITION);
  assert.equal(
    PUBLISH.jobs['verify-do-spaces-configuration'].if,
    SPACES_VERIFIER_CONDITION,
  );
  assert.equal(PUBLISH.jobs['deploy-do-spaces'].if, SPACES_DEPLOY_CONDITION);
  assert.equal(PUBLISH.jobs['deploy-github-pages'].if, PAGES_DEPLOY_CONDITION);
  assert.equal(PUBLISH.jobs.report.if, REPORT_CONDITION);
});

test('the two deploy conditions are mutually exclusive on adapter_id', () => {
  assert.ok(SPACES_DEPLOY_CONDITION.includes("== 'do-spaces'"));
  assert.ok(PAGES_DEPLOY_CONDITION.includes("== 'github-pages'"));
  assert.ok(!SPACES_DEPLOY_CONDITION.includes('github-pages'));
  assert.ok(!PAGES_DEPLOY_CONDITION.includes('do-spaces'));
});

test('the closed caller secret map is exactly the three optional CALLER_ names', () => {
  assert.deepEqual(Object.keys(PUBLISH.on.workflow_call.secrets), [
    'CALLER_DO_SPACES_ACCESS_KEY_ID',
    'CALLER_DO_SPACES_SECRET_ACCESS_KEY',
    'CALLER_DO_SPACES_SESSION_TOKEN',
  ]);
  for (const secret of Object.values(PUBLISH.on.workflow_call.secrets)) {
    assert.equal(secret.required, false);
  }
});

test('the caller secrets are referenced only in deploy-do-spaces', () => {
  const source = readFileSync('.github/workflows/publish-v2.yml', 'utf8');
  const jobSections = source.split(/\n {2}(?=[a-z])/u);
  for (const section of jobSections) {
    if (!section.includes('secrets.CALLER_DO_SPACES')) {
      continue;
    }
    assert.ok(
      section.startsWith('deploy-do-spaces:'),
      'a CALLER_DO_SPACES secret is referenced outside deploy-do-spaces',
    );
  }
});

test('no workflow uses secrets: inherit', () => {
  for (const file of [
    '.github/workflows/publish-v2.yml',
    '.github/workflows/authorize-v2.yml',
    '.github/workflows/report-v2.yml',
    'docs/callers/gala-publish-v2.yml',
  ]) {
    assert.ok(
      !/^\s*secrets:\s*inherit\s*$/mu.test(readFileSync(file, 'utf8')),
      `${file} uses secrets: inherit`,
    );
  }
});

test('deploy-do-spaces has no environment and the other two gated jobs have the exact ones', () => {
  assert.equal(PUBLISH.jobs['deploy-do-spaces'].environment, undefined);
  assert.equal(
    PUBLISH.jobs['verify-do-spaces-configuration'].environment,
    'gala-production',
  );
  assert.equal(PUBLISH.jobs['deploy-github-pages'].environment, 'github-pages');
  assert.equal(
    PUBLISH.jobs['verify-do-spaces-configuration']['timeout-minutes'],
    30,
  );
  assert.equal(PUBLISH.jobs['deploy-github-pages']['timeout-minutes'], 30);
});

test('id-token: write is granted only where an OIDC exchange or attestation happens', () => {
  const withIdToken = EXPECTED_JOBS.filter(
    (job) => PUBLISH.jobs[job].permissions['id-token'] === 'write',
  );
  assert.deepEqual(withIdToken, [
    'attest',
    'authorize',
    'deploy-github-pages',
    'report',
  ]);
});

test('no deploy job grants contents or performs a checkout of repository content', () => {
  for (const job of ['deploy-do-spaces', 'deploy-github-pages']) {
    assert.equal(PUBLISH.jobs[job].permissions.contents, undefined);
    for (const step of PUBLISH.jobs[job].steps) {
      if (
        typeof step.uses !== 'string' ||
        !step.uses.startsWith('actions/checkout')
      ) {
        continue;
      }
      assert.equal(
        step.with.repository,
        'rathnasgala2/publish',
        'a deploy job may only check out the pinned publish toolchain, never author content',
      );
    }
  }
});

test('the build job performs no checkout of author source and no repository content read', () => {
  for (const step of PUBLISH.jobs.build.steps) {
    if (
      typeof step.uses !== 'string' ||
      !step.uses.startsWith('actions/checkout')
    ) {
      continue;
    }
    assert.equal(step.with.repository, 'rathnasgala2/publish');
  }
  assert.equal(PUBLISH.jobs.build.permissions.contents, undefined);
});

test('the only permitted caller inputs are the two Gala locations and the two author tunables', () => {
  // The Gala API origin is an input, not a constant: a hard-coded origin
  // would make the workflow untestable against a staging control plane and
  // unusable by a self-hosted one. It is still a *closed* set of inputs --
  // nothing else about Gala may be passed in.
  assert.deepEqual(Object.keys(PUBLISH.on.workflow_call.inputs), [
    'service_origin_catalog_url',
    'gala_api_origin',
    'artifact_retention_days',
    'require_github_attestation',
  ]);
  assert.equal(PUBLISH.on.workflow_call.inputs.gala_api_origin.required, true);
  assert.equal(PUBLISH.on.workflow_call.inputs.gala_api_origin.type, 'string');
  assert.equal(
    PUBLISH.on.workflow_call.inputs.artifact_retention_days.default,
    7,
  );
  assert.equal(
    PUBLISH.on.workflow_call.inputs.require_github_attestation.default,
    false,
  );
});

test('the fixed caller declares only create and workflow_dispatch and the exact five-permission union', () => {
  assert.deepEqual(Object.keys(CALLER.on).sort(), [
    'create',
    'workflow_dispatch',
  ]);
  assert.deepEqual(CALLER.permissions, {
    actions: 'read',
    contents: 'read',
    'id-token': 'write',
    pages: 'write',
    attestations: 'write',
  });
  assert.deepEqual(Object.keys(CALLER.jobs.publish.secrets), [
    'CALLER_DO_SPACES_ACCESS_KEY_ID',
    'CALLER_DO_SPACES_SECRET_ACCESS_KEY',
    'CALLER_DO_SPACES_SESSION_TOKEN',
  ]);
  assert.match(
    CALLER.jobs.publish.uses,
    /^rathnasgala2\/publish\/\.github\/workflows\/publish-v2\.yml@[0-9a-f]{40}$/u,
  );
});

test("the fixed caller's guard is byte-equal to the DEC-097 coarse guard", () => {
  const normalized = String(CALLER.jobs.publish.if)
    .replace(/\s+/gu, ' ')
    .trim();
  assert.equal(
    normalized,
    "(github.event_name == 'create' && github.event.ref_type == 'branch' && " +
      "github.ref == format('refs/heads/{0}', github.event.ref) && " +
      "(startsWith(github.event.ref, 'gala/candidate/') || " +
      "startsWith(github.event.ref, 'gala/publish/'))) || " +
      "(github.event_name == 'workflow_dispatch' && " +
      "startsWith(github.ref, 'refs/heads/gala/publish/'))",
  );
});

test('the caller passes no operation, commit, adapter, destination or schedule value', () => {
  for (const forbidden of [
    'operation',
    'operationId',
    'commit',
    'adapter',
    'destination',
    'schedule',
    'digest',
    'receipt',
  ]) {
    assert.ok(
      !Object.keys(CALLER.jobs.publish.with).some((key) =>
        key.toLowerCase().includes(forbidden.toLowerCase()),
      ),
      `the caller passes a ${forbidden} value`,
    );
  }
});

test('every carrier upload uses the pinned v7 action with overwrite: false and bounded retention', () => {
  for (const workflow of [PUBLISH, AUTHORIZE]) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (
          typeof step.uses !== 'string' ||
          !step.uses.startsWith('actions/upload-artifact@')
        ) {
          continue;
        }
        assert.equal(
          step.uses,
          'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
        );
        assert.equal(step.with.overwrite, false);
        assert.ok(step.with['retention-days'] !== undefined);
      }
    }
  }
});

test('the two helpers are invoked as same-repository reusable workflows', () => {
  assert.equal(
    PUBLISH.jobs.authorize.uses,
    './.github/workflows/authorize-v2.yml',
  );
  assert.equal(PUBLISH.jobs.report.uses, './.github/workflows/report-v2.yml');
});

test("the Pages carrier's basename and artifact name are exactly gala-pages-r<runId>-a<runAttempt>", () => {
  // Slice brief section 2.3: "Its basename and Actions artifact name are
  // exactly `gala-pages-r<runId>-a<runAttempt>`". A `.tar.gz` suffix on
  // either would make the uploaded artifact's identity disagree with the
  // name the brief fixes, so both are compared exactly.
  const job = PUBLISH.jobs['deploy-github-pages'];
  const upload = job.steps.find(
    (/** @type {any} */ step) => step.id === 'upload-carrier',
  );
  assert.equal(
    upload.with.name,
    'gala-pages-r${{ github.run_id }}-a${{ github.run_attempt }}',
  );
  assert.equal(
    upload.with.path.replaceAll(/\s+/gu, ' ').trim(),
    '${{ runner.temp }}/carrier/gala-pages-r${{ github.run_id }}-a${{ github.run_attempt }}',
  );
  assert.equal(upload.with.archive, false);
  assert.equal(upload.with['retention-days'], 1);

  const build = job.steps.find(
    (/** @type {any} */ step) =>
      typeof step.run === 'string' && step.run.includes('build-pages-carrier'),
  );
  assert.match(
    build.run,
    /--out "\$\{RUNNER_TEMP\}\/carrier\/gala-pages-r\$\{GITHUB_RUN_ID\}-a\$\{GITHUB_RUN_ATTEMPT\}"/u,
  );
  assert.ok(
    !build.run.includes('.tar.gz'),
    'the Pages carrier basename carries no suffix',
  );
});

test('attest revalidates the envelope, extracts the exact SBOM record and issues both attestations over the same subject (DEC-097 section 6)', () => {
  const steps = PUBLISH.jobs.attest.steps;
  const extract = steps.find((/** @type {any} */ step) =>
    String(step.run ?? '').includes('extract-frozen-record.mjs'),
  );
  assert.ok(
    extract,
    'the exact SBOM record is extracted from the re-observed envelope',
  );
  assert.match(String(extract.run), /--record sbom/u);
  assert.match(
    String(extract.run),
    /--expected-digest "\$\{ENVELOPE_DIGEST\}"/u,
  );
  const attestations = steps.filter(
    (/** @type {any} */ step) =>
      typeof step.uses === 'string' && step.uses.startsWith('actions/attest-'),
  );
  assert.deepEqual(
    attestations.map((/** @type {any} */ step) => step.uses.split('@')[0]),
    ['actions/attest-build-provenance', 'actions/attest-sbom'],
  );
  const [provenance, sbom] = attestations;
  assert.equal(provenance.with['sbom-path'], undefined);
  assert.equal(sbom.with['subject-path'], provenance.with['subject-path']);
  assert.match(String(sbom.with['sbom-path']), /\/attest\/sbom\.spdx\.json$/u);
  assert.ok(
    steps.indexOf(extract) < steps.indexOf(sbom),
    'the record is extracted before it is attested',
  );
  for (const step of steps) {
    if (
      typeof step.uses === 'string' &&
      step.uses.startsWith('actions/checkout')
    ) {
      assert.equal(step.with.repository, 'rathnasgala2/publish');
    }
  }
});

test('the build carrier carries the manifest and freeze retains both predecessor handoffs in the provenance record', () => {
  const pack = PUBLISH.jobs.build.steps.find((/** @type {any} */ step) =>
    String(step.run ?? '').includes('pack-carrier.mjs'),
  );
  assert.match(
    String(pack.run),
    /--manifest "\$\{RUNNER_TEMP\}\/build-output\/work\/artifact-manifest\.json"/u,
  );
  assert.match(
    String(pack.run),
    /--directory "\$\{RUNNER_TEMP\}\/build-output\/artifact"/u,
  );
  // PUBLISH-S4-6b: the build's two fact records travel with the manifest.
  assert.match(
    String(pack.run),
    /--build-input "\$\{RUNNER_TEMP\}\/build-output\/work\/build-input\.json"/u,
  );
  assert.match(
    String(pack.run),
    /--theme-contract "\$\{RUNNER_TEMP\}\/build-output\/work\/theme-contract\.json"/u,
  );
  const authorization = PUBLISH.jobs.freeze.steps.find(
    (/** @type {any} */ step) =>
      String(step.run ?? '').includes('build-authorization-input.mjs'),
  );
  assert.equal(
    authorization.env.UNFROZEN_OUTPUT_DIGEST,
    '${{ needs.build.outputs.carrier_digest }}',
  );
  assert.match(
    String(authorization.run),
    /--unfrozen-output-digest "\$\{UNFROZEN_OUTPUT_DIGEST\}"/u,
  );
  const freeze = PUBLISH.jobs.freeze.steps.find((/** @type {any} */ step) =>
    String(step.run ?? '').includes('freeze.mjs'),
  );
  for (const purpose of ['verified-inputs', 'unfrozen-output']) {
    for (const member of ['artifact-id', 'name', 'byte-count', 'expires-at']) {
      assert.match(
        String(freeze.run),
        new RegExp(`--${purpose}-${member} `, 'u'),
      );
    }
  }
  for (const job of ['prep', 'build']) {
    for (const output of [
      'carrier_id',
      'carrier_name',
      'carrier_digest',
      'carrier_byte_count',
      'carrier_expires_at',
    ]) {
      assert.ok(
        output in PUBLISH.jobs[job].outputs,
        `${job} exposes ${output}`,
      );
    }
  }
});
