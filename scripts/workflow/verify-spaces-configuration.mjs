/**
 * `verify-do-spaces-configuration`: the protected control-plane check.
 *
 * It performs exactly two bounded read-only `GetBucketWebsite` calls with
 * the Full-access control key (DigitalOcean requires
 * `All (Buckets and Objects)` for that operation), and emits one
 * credential-free compact-JCS evidence file. None of the control key's
 * bytes or derived authorization values may enter that file, a job output,
 * a digest, a log, a Gala request or the deploy job.
 */

import { writeFile } from 'node:fs/promises';

import { bindAuthorizedIntent, requireRunner } from './authorized-intent.mjs';
import { readAuthorization } from './build-pages-carrier.mjs';
import {
  recomputeSpacesClosedRecords,
  requireCapabilityDecisionAgreement,
} from './capability-decision.mjs';
import { parseOptions, requireOption } from './carrier.mjs';
import { runIfMain } from '../run-if-main.mjs';

/** The exact ceiling on the emitted evidence file, in bytes. */
export const MAXIMUM_EVIDENCE_BYTES = 65536;

/**
 * @returns {Promise<void>} resolves once the evidence file is written
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const inbox = requireOption(options, 'inbox');
  const out = requireOption(options, 'out');

  // The intent is the only source of the bucket coordinates this verifier
  // reads (its 2.8.0 `destination.providerBinding`); an intent without them,
  // or one bound to another repository or operation, is refused before the
  // control key is touched.
  const bound = bindAuthorizedIntent({
    authorization: await readAuthorization(inbox),
    runner: process.env,
  });
  if (bound.adapterId !== 'do-spaces' || bound.providerBinding === null) {
    throw new Error(
      `DEPLOY_DESTINATION_BINDING_INVALID: the authorized intent names ${bound.adapterId}, not a Spaces destination`,
    );
  }
  const destination = bound.providerBinding;

  // DEC-097 lines 8446-8449: the control-plane evidence artifact does not
  // exist yet, so the two closed records this job would otherwise have to
  // trust are instead independently recomputed from the intent's own
  // retained members (the provider binding and rebuildRecord.basePath) and
  // proved to equal the pre-authorized capability-decision digests — before
  // this job makes its first live control-plane call, not after.
  const spacesClosedRecords = await recomputeSpacesClosedRecords(bound.intent);
  const runId = requireRunner(process.env, 'GITHUB_RUN_ID');
  const runAttempt = requireRunner(process.env, 'GITHUB_RUN_ATTEMPT');
  // Recomputed and required to equal the intent's own pre-authorized
  // capabilityDecisionDigest before anything below touches the control key
  // (DEC-097 line 8419's "recomputed before staging" applies here too: this
  // job is a pre-mutation gate, and the two Spaces records above are
  // exactly the members that gate covers).
  requireCapabilityDecisionAgreement(
    bound.intent,
    { runId, runAttempt: Number.parseInt(runAttempt, 10) },
    spacesClosedRecords,
  );

  for (const name of [
    'DO_SPACES_CONTROL_ACCESS_KEY_ID',
    'DO_SPACES_CONTROL_SECRET_ACCESS_KEY',
  ]) {
    if (process.env[name] === undefined || process.env[name] === '') {
      throw new Error(
        `SPACES_CONTROL_CREDENTIAL_MISSING: ${name} is required in the gala-production environment for a Spaces publication`,
      );
    }
  }

  const { deriveOrigins } = await import('@rathnasgala2/adapter-do-spaces');
  const origins = deriveOrigins({
    region: String(destination.region),
    servedBucket: String(destination.servedBucket),
    stagingBucket: String(destination.stagingBucket),
  });

  // The two GetBucketWebsite calls themselves need live DigitalOcean
  // credentials, which no local environment has (W4-16). The evidence
  // record below is credential-free by construction and fails closed rather
  // than asserting an unobserved configuration. `requiredConfiguration` is
  // DEC-097's own `spacesWebsiteConfiguration` record — the one just proved
  // to equal the pre-authorized `spacesWebsiteConfigurationDigest` above —
  // never this adapter's separate internal declaration profile.
  const evidence = {
    profile: 'gala-spaces-control-plane-evidence-v2',
    intentDigest: bound.intentDigest,
    servedBucket: origins.servedBucket,
    stagingBucket: origins.stagingBucket,
    region: origins.region,
    requiredConfiguration: spacesClosedRecords.websiteConfiguration,
    requiredControlPlaneBinding: spacesClosedRecords.controlPlaneBinding,
    servedWebsiteConfigurationObserved: false,
    stagingWebsiteConfigurationAbsentObserved: false,
    blocker: 'SPACES_CONTROL_PLANE_LIVE_EVIDENCE_UNAVAILABLE',
  };
  const bytes = Buffer.from(JSON.stringify(evidence), 'utf8');
  if (bytes.byteLength > MAXIMUM_EVIDENCE_BYTES) {
    throw new Error(
      `SPACES_CONTROL_PLANE_EVIDENCE_TOO_LARGE: ${bytes.byteLength} bytes exceed ${MAXIMUM_EVIDENCE_BYTES}`,
    );
  }
  await writeFile(out, bytes);
  throw new Error(
    'SPACES_CONTROL_PLANE_UNVERIFIED: the two read-only GetBucketWebsite checks require live DigitalOcean credentials (W4-16); refusing to release the fence on an unobserved configuration',
  );
}

await runIfMain(import.meta.url, main);
