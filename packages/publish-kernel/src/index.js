/**
 * `@rathnasgala2/publish-kernel`: the provider-neutral, non-disableable
 * publish safety kernel (DEC-016 §"Non-disableable publish safety kernel",
 * doc 20 §13.2; `orchestration/slice-briefs/S2-author-owned-publication.md`
 * section 5). Implements exactly the ten kernel duties over explicit,
 * caller-supplied inputs: pure, deterministic and fail closed. The kernel
 * never clones a source repository, never installs dependencies, never
 * executes author build code, never interprets Gala content semantics and
 * never writes to the source repository. See `README.md` for the duty-by-
 * duty overview.
 *
 * @module
 */

export {
  KernelError,
  FINDING_SEVERITIES,
  assertNoBlockingFinding,
  hasBlockingFinding,
  kernelFinding,
} from './errors.js';

// Duty 1: artifact identity and digest agreement.
export {
  assertArtifactIdentityAgreement,
  checkArtifactIdentityAgreement,
} from './artifact-identity.js';

// Duty 2: path containment.
export { checkPathContainment } from './path-containment.js';

// Duty 3: bounded resources.
export { checkBoundedResources } from './bounded-resources.js';

// Duty 4: destination authority.
export {
  checkDestinationAuthority,
  checkDestinationOwnership,
} from './destination-authority.js';

// Duty 5: secret handling.
export { findSecretExposure, redactSecrets } from './secret-redaction.js';

// Duty 6: operation identity, idempotency and concurrency fencing.
export {
  checkConcurrencyFence,
  checkIdentitySyntax,
  decideIdempotency,
} from './operation-fencing.js';

// The activation-fence vocabulary duty 6 and duty 7 are stated in, owned by
// `@rathnasgala2/adapter-protocol` and re-exported (never re-implemented)
// here so a kernel caller building a `ConcurrencyFenceInput` has the one
// sentinel and the one constructor to hand. `null` is not a fence value
// (LOCAL-47).
export {
  ADAPTER_PROTOCOL_VERSION,
  EXPECT_NOTHING_SERVED,
  fenceDisagrees,
  fenceFor,
  requireGenerationFence,
} from '@rathnasgala2/adapter-protocol';

// Duty 7: staged activation.
export { decideStagedActivation } from './staged-activation.js';

// Duty 8: ambiguous-outcome discipline.
export {
  checkNoBlindRetry,
  classifyMutationOutcome,
} from './ambiguous-outcome.js';

// Duty 9: last-known-good retention.
export {
  DEFAULT_MAXIMUM_PRIOR_GENERATIONS,
  retainCertifiedDigest,
  selectRetainedGeneration,
} from './retention.js';

// Duty 10 (typed diagnostics) is `errors.js`, exported above.

// The DEC-097 capabilityDecision/capabilityDecisionDigest record.
export {
  CAPABILITY_DECISION_DOMAIN,
  buildCapabilityDecision,
  verifyCapabilityDecisionDigest,
} from './capability-decision.js';

// public-generation-marker:2.0.0 construction and validation.
export {
  PUBLIC_GENERATION_MARKER_SCHEMA_ID,
  buildGenerationMarker,
  checkGenerationMarker,
} from './generation-marker.js';

// Per-lifecycle-stage composition of the ten duties.
export {
  evaluateActivate,
  evaluateCleanupStaged,
  evaluateObserve,
  evaluatePreflight,
  evaluateRollback,
  evaluateStage,
} from './kernel.js';
