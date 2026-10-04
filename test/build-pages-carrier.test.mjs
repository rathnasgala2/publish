/**
 * The Pages carrier this job uploads must be byte-identical to the carrier the
 * adapter re-encodes at stage time, or the adapter refuses the handoff. The API
 * renders the authorized marker with sorted keys; the adapter serialises its
 * own marker in declaration order. The builder therefore rebuilds the marker
 * through the adapter from the authorized values.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GENERATION_MARKER_PATH,
  buildValidatedMarker,
  encodeCarrier,
} from '@rathnasgala2/adapter-github-pages';

import { buildPagesCarrier } from '../scripts/workflow/build-pages-carrier.mjs';

const files = [
  { path: 'index.html', bytes: Buffer.from('<h1>hello</h1>') },
  { path: 'about/index.html', bytes: Buffer.from('<h1>about</h1>') },
];
const identity = {
  artifactId: 'a4e3a8a6-1f24-71a2-9008-847cbefec078',
  artifactDigest:
    'sha256:775e6e7c9a4e26da7ec106137204ebdcf8d4b0c2948ee543571152f57ca92fd8',
  generationId: '034bba59-3652-7531-8453-1d6c3a782a17',
};

test('a canonical (sorted-key) authorized marker yields the bytes the adapter re-encodes', async () => {
  const authorizedMarker = {
    artifactDigest: identity.artifactDigest,
    artifactId: identity.artifactId,
    generationId: identity.generationId,
    schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
    schemaVersion: '2.0.0',
  };
  const uploaded = await buildPagesCarrier(files, authorizedMarker);
  const adapterSide = encodeCarrier([
    ...files,
    {
      path: GENERATION_MARKER_PATH,
      bytes: Buffer.from(
        JSON.stringify(buildValidatedMarker(identity)),
        'utf8',
      ),
    },
  ]);
  assert.ok(
    uploaded.equals(adapterSide),
    'carrier bytes must match the adapter re-encoding',
  );
});

test('re-serialising the authorized marker verbatim would not match the adapter re-encoding', () => {
  const sorted = JSON.stringify({
    artifactDigest: identity.artifactDigest,
    artifactId: identity.artifactId,
    generationId: identity.generationId,
    schemaId: 'urn:gala:schema:public-generation-marker:2.0.0',
    schemaVersion: '2.0.0',
  });
  assert.notEqual(sorted, JSON.stringify(buildValidatedMarker(identity)));
});
