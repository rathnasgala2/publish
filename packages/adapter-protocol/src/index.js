/**
 * `@rathnasgala2/adapter-protocol`: the mandatory in-process deployment
 * adapter lifecycle interface, the closed lower-case capability vocabulary
 * and exact three-row admission table, provider limit-profile
 * discrimination, canonical digest primitives, the DEC-086 in-process
 * frame/message contract, in-process adapter loading, and capability
 * negotiation. See `README.md` for the package overview and
 * `orchestration/slice-briefs/S2-author-owned-publication.md` section 5 for
 * the governing specification.
 *
 * @module
 */

export { AdapterProtocolError, finding } from './errors.js';

export {
  ADAPTER_CAPABILITY_ROWS,
  ACTIVATION,
  CACHE_INVALIDATION,
  CONCURRENCY,
  CONFIGURATION_KEYS,
  DESTINATION_KINDS,
  IDEMPOTENCY_CLASS,
  OPERATIONS,
  PROVIDER_INVENTORY_ASSURANCE,
  ROLLBACK,
  STAGING,
  TRANSPORTS,
  VERIFICATION,
  getCapabilityRow,
  isSameSet,
} from './capability-vocabulary.js';

export {
  ADAPTER_CAPABILITY_SCHEMA_ID,
  assertValidCapabilityDeclaration,
  checkExactRow,
  validateCapabilityDeclaration,
} from './capability.js';

export { isFilesystemProviderLimits, isHttpProviderLimits } from './limits.js';

export {
  ARTIFACT_DIGEST_DOMAIN,
  canonicalizeJson,
  computeArtifactDigest,
  domainDigest,
  isDigestString,
  projectArtifactEntry,
  sha256Hex,
} from './digest.js';

export {
  FRAME_CEILING_BYTES,
  FRAME_LENGTH_PREFIX_BYTES,
  decodeFrame,
  decodeFrames,
  encodeFrame,
} from './frame.js';

export {
  ADAPTER_PROTOCOL_VERSION,
  EXPECT_NOTHING_SERVED,
  fenceDisagrees,
  fenceFor,
  requireGenerationFence,
  GENERATION_ID_PATTERN,
} from './generation-fence.js';

export { LIFECYCLE_OPERATIONS, defineAdapter } from './lifecycle.js';

export { loadAdapterModule } from './loader.js';

export {
  NEGOTIATION_DECISION_DOMAIN,
  negotiateCapability,
  requireCapabilityMatch,
} from './negotiation.js';

export { generateUuidV7 } from './uuid.js';
