import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as adapterProtocol from '../src/index.js';

test('the public entry point has no default export', () => {
  assert.equal(Object.hasOwn(adapterProtocol, 'default'), false);
});

test('the public entry point re-exports every module surface', () => {
  const expected = [
    'AdapterProtocolError',
    'finding',
    'ADAPTER_CAPABILITY_ROWS',
    'ACTIVATION',
    'CACHE_INVALIDATION',
    'CONCURRENCY',
    'CONFIGURATION_KEYS',
    'DESTINATION_KINDS',
    'IDEMPOTENCY_CLASS',
    'OPERATIONS',
    'PROVIDER_INVENTORY_ASSURANCE',
    'ROLLBACK',
    'STAGING',
    'TRANSPORTS',
    'VERIFICATION',
    'getCapabilityRow',
    'isSameSet',
    'ADAPTER_CAPABILITY_SCHEMA_ID',
    'assertValidCapabilityDeclaration',
    'checkExactRow',
    'validateCapabilityDeclaration',
    'isFilesystemProviderLimits',
    'isHttpProviderLimits',
    'ARTIFACT_DIGEST_DOMAIN',
    'canonicalizeJson',
    'computeArtifactDigest',
    'domainDigest',
    'isDigestString',
    'projectArtifactEntry',
    'sha256Hex',
    'FRAME_CEILING_BYTES',
    'FRAME_LENGTH_PREFIX_BYTES',
    'decodeFrame',
    'decodeFrames',
    'encodeFrame',
    'ADAPTER_PROTOCOL_VERSION',
    'EXPECT_NOTHING_SERVED',
    'fenceDisagrees',
    'fenceFor',
    'requireGenerationFence',
    'GENERATION_ID_PATTERN',
    'LIFECYCLE_OPERATIONS',
    'defineAdapter',
    'loadAdapterModule',
    'NEGOTIATION_DECISION_DOMAIN',
    'negotiateCapability',
    'requireCapabilityMatch',
    'generateUuidV7',
  ];
  for (const name of expected) {
    assert.ok(
      Object.hasOwn(adapterProtocol, name),
      `expected index.js to export "${name}"`,
    );
  }
  assert.equal(Object.keys(adapterProtocol).length, expected.length);
});
