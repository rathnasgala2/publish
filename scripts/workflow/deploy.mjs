/**
 * The selected deploy job's entry point: verify every exact-ID input, run
 * the kernel-driven adapter lifecycle against the authorized destination,
 * and publish exactly one credential-free kernel-journal carrier.
 *
 * The adapter is chosen by the authorization's own `adapter.adapterId`, not
 * by anything the caller passed: `local-directory` is refused here, before
 * destination access, because it has no managed deploy job (brief section 1)
 * and DEC-097 forbids it from receiving a `GITHUB_WORKLOAD` intent at all.
 * The provider-neutral run itself lives in `kernel-run.mjs` and is exercised
 * end to end against `local-directory` by this repository's own tests — the
 * adapter is the conformance oracle, which is exactly the role a managed job
 * must not give it.
 *
 * Two pre-mutation proofs run before the adapter is allowed to touch a
 * destination, and both fail closed:
 *
 * - **do-spaces** (brief section 6.3): the three caller-mapped limited
 *   credentials must be proved to be limited. The job issues the two
 *   `(limited-deployment, served|staging)` rows of DEC-097's closed
 *   `gala-do-spaces-control-plane-http-v2` catalog and requires an exact
 *   `403 AccessDenied` from each. A limited key that can read a bucket
 *   configuration is over-privileged and blocks the release; anything that
 *   is not a proved denial is unproven and also blocks it.
 * - **github-pages** (DEC-097 section 7's `gala-pages-oidc-v2`): this job
 *   holds `id-token: write` for exactly one purpose, and it is discharged
 *   here — the job acquires the default-audience runner token once and
 *   hands it to the adapter as the create body's mandatory `oidc_token`.
 *   The adapter never mints it, and it never reaches a header, an output, a
 *   digest, an artifact or this script's own log.
 *
 * Neither proof is reachable without credentials, and neither is skipped
 * when they are absent: a run with no credential fails rather than
 * pretending the proof passed. That is the only fail-closed blocker left in
 * this script — everything the kernel and the adapters can do without a
 * credential now actually runs.
 *
 * @module
 */

import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import {
  bindAuthorizedIntent,
  destinationIdentityFrom,
  providerBindingOf,
  requireRunner,
} from './authorized-intent.mjs';
import { readAuthorization } from './build-pages-carrier.mjs';
import {
  DEPLOY_PHASE_MEMBERS,
  ISSUANCE_PHASE_MEMBERS,
  recomputeSpacesClosedRecords,
  deployPhaseEvaluation,
  requireCapabilityDecisionAgreement,
} from './capability-decision.mjs';
import { findCarrier } from './decode-carrier.mjs';
import { parseOptions, requireOption } from './carrier.mjs';
import { decodeFrozenEnvelope } from './frozen-envelope.mjs';
import { acquirePagesOidcToken } from './pages-oidc.mjs';
import { runKernelDeployment } from './kernel-run.mjs';
import { runIfMain } from '../run-if-main.mjs';

/**
 * Read one required environment variable, refusing an empty value.
 *
 * @param {string} name the variable name
 * @returns {string} the value
 */
function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`DEPLOY_CREDENTIAL_MISSING: ${name} is empty or unset`);
  }
  return value;
}

/**
 * Build the Spaces destination from the authorization's provider binding and
 * the three caller-mapped limited-key secrets. The coordinates come from the
 * intent alone (`providerBindingOf` fails closed by name when the intent
 * omits them); the environment contributes only the credential.
 *
 * @param {Record<string, unknown>} intent the deployment intent
 * @returns {Record<string, unknown>} the destination
 */
function spacesDestination(intent) {
  const sessionToken = process.env.CALLER_DO_SPACES_SESSION_TOKEN;
  const binding = providerBindingOf(intent);
  if (binding === null) {
    throw new Error(
      'DEPLOY_DESTINATION_BINDING_INVALID: the authorized intent carries no Spaces provider binding',
    );
  }
  return {
    ...binding,
    publicBaseUrl: destinationIdentityFrom(intent).baseUrl,
    accessKeyId: requireEnv('CALLER_DO_SPACES_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('CALLER_DO_SPACES_SECRET_ACCESS_KEY'),
    ...(sessionToken === undefined || sessionToken === ''
      ? {}
      : { sessionToken }),
  };
}

/**
 * The credential-free half of the Pages destination: the authorization's
 * `providerBinding` names the target repository, and the runner's own bound
 * identity supplies the two numeric ids the adapter recomputes the OIDC
 * subject against. A Pages deployment can only ever land in the repository
 * the runner's OIDC token was minted for, so a binding that names any other
 * repository is refused here before a credential is read.
 *
 * @param {Record<string, unknown>} intent the deployment intent
 * @param {Readonly<Record<string, string | undefined>>} runner the runner
 *   environment (`GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_ID`,
 *   `GITHUB_REPOSITORY_OWNER_ID`)
 * @returns {{owner: string, repository: string, repositoryId: string, repositoryOwnerId: string, publicBaseUrl: string}}
 *   the bound coordinates
 */
function pagesDestinationBinding(intent, runner) {
  const coordinates = providerBindingOf(intent);
  if (coordinates === null) {
    throw new Error(
      'DEPLOY_DESTINATION_BINDING_INVALID: the authorized intent carries no Pages provider binding',
    );
  }
  const owner = String(coordinates.owner);
  const repository = String(coordinates.repository);
  const own = requireRunner(runner, 'GITHUB_REPOSITORY');
  if (own.toLowerCase() !== `${owner}/${repository}`.toLowerCase()) {
    throw new Error(
      'DEPLOY_DESTINATION_BINDING_INVALID: the authorized providerBinding names a repository other than the one this job runs in; a Pages deployment cannot target another repository',
    );
  }
  return {
    owner,
    repository,
    repositoryId: requireRunner(runner, 'GITHUB_REPOSITORY_ID'),
    repositoryOwnerId: requireRunner(runner, 'GITHUB_REPOSITORY_OWNER_ID'),
    publicBaseUrl: String(destinationIdentityFrom(intent).baseUrl),
  };
}

/**
 * Collect the six exact OIDC binding claims the Pages adapter recomputes
 * the token's subject and audience against. Every one of them comes from
 * the runner's own bound identity, never from a workflow input.
 *
 * @returns {Readonly<Record<string, string>>} the expected claims
 */
function pagesOidcClaims() {
  const workflowSha = requireEnv('GITHUB_WORKFLOW_SHA');
  return Object.freeze({
    ref: requireEnv('GITHUB_REF'),
    sha: requireEnv('GITHUB_SHA'),
    runId: requireEnv('GITHUB_RUN_ID'),
    runAttempt: requireEnv('GITHUB_RUN_ATTEMPT'),
    jobWorkflowRef: `rathnasgala2/publish/.github/workflows/publish-v2.yml@${workflowSha}`,
    jobWorkflowSha: workflowSha,
  });
}

/**
 * @returns {Promise<void>} resolves once the kernel journal is written
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const inbox = requireOption(options, 'inbox');
  const out = requireOption(options, 'out');
  const requestedAdapter = requireOption(options, 'adapter');

  // Decoding the envelope recomputes its inventory and every metadata
  // digest; a corrupted or substituted envelope never reaches the adapter.
  const envelope = decodeFrozenEnvelope(
    (await findCarrier(inbox, requireOption(options, 'envelope-digest'))).bytes,
  );
  // The authorization carrier is the only source of the adapter, the
  // destination, the fence and every operation identity. It is bound to this
  // runner's own repository and publish ref before anything else happens.
  const bound = bindAuthorizedIntent({
    authorization: await readAuthorization(inbox),
    runner: process.env,
  });
  const { intent, adapterId } = bound;
  if (adapterId !== requestedAdapter) {
    throw new Error(
      `DEPLOY_ADAPTER_MISMATCH: the job selected ${requestedAdapter} but the authorized intent names ${adapterId}`,
    );
  }
  if (adapterId !== 'do-spaces' && adapterId !== 'github-pages') {
    throw new Error(
      `WORKLOAD_BINDING_INVALID: ${adapterId} has no managed deploy job; local-directory is the disposable conformance oracle only`,
    );
  }

  /** @type {Record<string, unknown>} */
  const journalHead = {
    schemaVersion: '2.0.0',
    adapterId,
    // The 2.8.0 `kind` the exchange was answered with (`null` from a 2.7.x
    // server): the kernel run states which contract generation authorized it.
    authorizationResponseKind: bound.responseKind,
    operationId: bound.operationId,
    attemptId: bound.attemptId,
    generationId: bound.proposedGenerationId,
    // The envelope's own metadata digests, recomputed by the decoder; the
    // intent must bind exactly these (DEC-097 section 6), so the report can
    // state the provenance and SBOM the deployed bytes were frozen with.
    manifestDigest: envelope.manifestDigest,
    provenanceDigest: envelope.provenanceDigest,
    sbomDigest: envelope.sbomDigest,
    // Exactly what this job took from the intent, member by member, so the
    // report and the reconciliation worker can see the binding this run
    // deployed under rather than infer it.
    authorization: bound.journal,
  };
  // Refused here, before any adapter is imported and before the first
  // destination contact: an envelope whose records are not the ones the
  // intent binds never reaches staging.
  requireEnvelopeIntentAgreement(intent, envelope);
  // DEC-097 line 8419 / LOCAL-62: the capability decision is recomputed
  // before staging. Only the issuance-phase record is compared against the
  // intent's digest; the deploy-phase facts (the Pages carrier, the exact
  // evaluation over the payload) are recorded as evidence below. For
  // do-spaces the two per-destination closed records (DEC-097 8444-8449)
  // are recomputed first, from the retained provider binding and base path
  // only — the same recomputation `verify-spaces-configuration.mjs` proves
  // before its own live control-plane calls.
  const spacesClosedRecords =
    adapterId === 'do-spaces'
      ? await recomputeSpacesClosedRecords(intent)
      : undefined;
  const decision = requireCapabilityDecisionAgreement(
    intent,
    {
      runId: requireEnv('GITHUB_RUN_ID'),
      runAttempt: Number.parseInt(requireEnv('GITHUB_RUN_ATTEMPT'), 10),
    },
    spacesClosedRecords,
  );
  /** @type {Record<string, unknown>} */
  const capabilityDecision = {
    issuancePhaseDigest: decision.decisionDigest,
    issuancePhaseMembers: Object.keys(decision.record).filter((member) =>
      ISSUANCE_PHASE_MEMBERS.includes(member),
    ),
    deployPhaseMembers: [...DEPLOY_PHASE_MEMBERS],
    admission: {
      adapterVersion: decision.admission.adapterVersion,
      capabilityDigest: decision.admission.capabilityDigest,
    },
    deployPhase: deployPhaseEvaluation({
      files: envelope.files,
      markerByteLength: decision.markerByteLength,
    }),
  };
  journalHead.capabilityDecision = capabilityDecision;

  /** @type {Record<string, unknown>} */
  let destination;
  /** @type {Record<string, unknown>} */
  let activateExtras = {};
  /** @type {Record<string, unknown>} */
  let adapterModule;

  if (adapterId === 'do-spaces') {
    adapterModule = await import('@rathnasgala2/adapter-do-spaces');
    destination = spacesDestination(intent);
    journalHead.adapterVersion = adapterModule.ADAPTER_VERSION;
    requireAdapterVersionAgreement(adapterModule.ADAPTER_VERSION, bound);
    journalHead.destinationOrigins = /** @type {any} */ (
      adapterModule
    ).deriveOrigins(destination);

    // Brief section 6.3: before mutation the limited key must be proved
    // limited. This is that proof, and it is the job's first destination
    // contact. It throws `SPACES_LIMITED_KEY_OVERPRIVILEGED` when the key
    // can read a configuration and `SPACES_LIMITED_KEY_DENIAL_UNPROVEN` for
    // anything that is not an exact, well-formed denial.
    journalHead.limitedKeyDenialEvidence = await /** @type {any} */ (
      adapterModule
    ).proveLimitedKeyAccessDenied({ destination });
  } else {
    adapterModule = await import('@rathnasgala2/adapter-github-pages');
    journalHead.adapterVersion = adapterModule.ADAPTER_VERSION;
    requireAdapterVersionAgreement(adapterModule.ADAPTER_VERSION, bound);
    const pagesArtifactId = requireOption(options, 'pages-artifact-id');
    const pagesArtifactDigest = requireOption(options, 'pages-artifact-digest');
    journalHead.pagesArtifactId = pagesArtifactId;
    journalHead.pagesArtifactDigest = pagesArtifactDigest;
    // The deploy-phase carrier fact this job holds (LOCAL-62): the digest
    // the uploaded Pages carrier was re-observed at.
    capabilityDecision.deployPhase = deployPhaseEvaluation({
      files: envelope.files,
      markerByteLength: decision.markerByteLength,
      pagesActionsArtifactDigest: pagesArtifactDigest,
    });

    // The one `id-token: write` use. The token is held in this local
    // binding, handed straight to the adapter's create call and never
    // written anywhere; only its normalized origin is evidence.
    const oidc = await acquirePagesOidcToken();
    journalHead.pagesOidcOrigin = oidc.pagesOidcOrigin;
    journalHead.pagesOidcClaimsBound = Object.keys(pagesOidcClaims()).sort();
    journalHead.pagesOidcTokenAcquired = true;

    destination = {
      ...pagesDestinationBinding(intent, process.env),
      token: requireEnv('GITHUB_TOKEN'),
      // The Pages carrier is uploaded by the pinned v7 action in this job's
      // own earlier step, never by the adapter: what the adapter is handed
      // is the already observed artifact identity, and the digest it was
      // re-observed at is compared before it is returned.
      publishCarrier: async (
        /** @type {{bytes: Buffer, carrierDigest: string}} */ input,
      ) => {
        const observed = `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`;
        if (observed !== input.carrierDigest) {
          throw new Error(
            'DEPLOY_PAGES_CARRIER_DIGEST_MISMATCH: the adapter re-encoded a carrier this job did not upload',
          );
        }
        return { pagesArtifactId, artifactDigest: pagesArtifactDigest };
      },
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: Number.parseInt(process.env.GITHUB_RUN_ATTEMPT ?? '1', 10),
    };
    activateExtras = {
      pagesOidcToken: oidc.token,
      pagesOidcClaims: pagesOidcClaims(),
    };
  }

  // The artifact digest is recomputed here under the installed adapter's own
  // projection — the digest the kernel's duty 1 and the adapter's activation
  // check compare — never quoted from the envelope or any job output.
  const artifactDigest =
    /** @type {(files: readonly {path: string, bytes: Buffer}[]) => string} */ (
      adapterModule.computeArtifactDigest
    )(envelope.files);
  journalHead.artifactDigest = artifactDigest;
  if (artifactDigest !== bound.artifactDigest) {
    throw new Error(
      `DEPLOY_ENVELOPE_INTENT_MISMATCH: the frozen envelope digests to ${artifactDigest} under ${adapterId}, not the ${bound.artifactDigest} the intent authorizes`,
    );
  }

  const outcome = await runKernelDeployment({
    adapterModule,
    destination,
    destinationIdentity: bound.destination,
    intent,
    files: envelope.files,
    activateExtras,
  });

  const journal = {
    ...journalHead,
    decision: outcome.decision,
    verified: outcome.verified,
    attempts: outcome.journal.attempts,
    observations: outcome.journal.observations,
    observedRoutes: outcome.journal.observedRoutes,
    ...(outcome.generationId === null
      ? {}
      : { destinationGenerationId: outcome.generationId }),
  };
  await writeFile(out, Buffer.from(JSON.stringify(journal), 'utf8'));

  if (outcome.decision !== 'activate' || !outcome.verified) {
    // The journal is still written and still reportable — that is the whole
    // point of normalizing an adapter/provider failure into the handoff —
    // but this job did not activate a verified generation and does not
    // report success.
    throw new Error(
      `DEPLOY_NOT_ACTIVATED: the ${adapterId} run ended ${outcome.decision} with verified=${String(outcome.verified)}; the kernel journal is written and reportable`,
    );
  }
  process.stdout.write(
    `${adapterId}: activated generation ${String(outcome.generationId)}, ${outcome.journal.attempts.length} attempt(s)\n`,
  );
}

/**
 * Require the frozen envelope's three metadata digests — recomputed by the
 * envelope decoder over the exact records it carries — to be the ones the
 * authorized intent binds (DEC-097 section 6). A disagreement on any member
 * is refused by name; nothing is staged for an envelope the intent did not
 * authorize.
 *
 * @param {Record<string, unknown>} intent the authorized deployment intent
 * @param {{manifestDigest: string, provenanceDigest: string, sbomDigest: string}} envelope
 *   the decoded envelope's digests
 * @returns {void}
 */
function requireEnvelopeIntentAgreement(intent, envelope) {
  for (const member of /** @type {const} */ ([
    'manifestDigest',
    'provenanceDigest',
    'sbomDigest',
  ])) {
    if (intent[member] !== envelope[member]) {
      throw new Error(
        `DEPLOY_ENVELOPE_INTENT_MISMATCH: the frozen envelope’s ${member} is ${envelope[member]}, not the ${String(intent[member])} the intent authorizes`,
      );
    }
  }
}

/**
 * The installed adapter must be the adapter release the intent authorizes.
 * The intent names `adapter.adapterVersion`; the toolchain checkout is
 * pinned by `github.workflow_sha`, so a disagreement means this workflow
 * revision is not the one the operation was authorized against.
 *
 * @param {unknown} installed the installed adapter's `ADAPTER_VERSION`
 * @param {{adapterId: string, adapterVersion: string}} bound the binding
 * @returns {void}
 */
function requireAdapterVersionAgreement(installed, bound) {
  if (installed !== bound.adapterVersion) {
    throw new Error(
      `DEPLOY_ADAPTER_VERSION_MISMATCH: the authorized intent names ${bound.adapterId}@${bound.adapterVersion} but this toolchain installs ${String(installed)}`,
    );
  }
}

export {
  destinationIdentityFrom,
  pagesDestinationBinding,
  pagesOidcClaims,
  requireAdapterVersionAgreement,
  requireEnvelopeIntentAgreement,
  spacesDestination,
};

await runIfMain(import.meta.url, main);
