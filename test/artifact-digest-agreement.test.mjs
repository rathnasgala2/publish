/**
 * PUB-M5: `adapter-local-directory`, `adapter-github-pages` and
 * `adapter-do-spaces` each export a `computeArtifactDigest`. All three
 * delegate to `@rathnasgala2/adapter-protocol`'s `computeArtifactDigest`
 * (the marker-excluding two also filter their own reserved coordinate
 * first), so this is a repository-level proof they still agree byte-for-byte
 * over a shared fixture set, including empty files, unicode paths and
 * nested directories -- not merely a manual spot check.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeArtifactDigest as protocolComputeArtifactDigest } from '@rathnasgala2/adapter-protocol';
import { computeArtifactDigest as localComputeArtifactDigest } from '@rathnasgala2/adapter-local-directory';
import { computeArtifactDigest as pagesComputeArtifactDigest } from '@rathnasgala2/adapter-github-pages';
import { computeArtifactDigest as spacesComputeArtifactDigest } from '@rathnasgala2/adapter-do-spaces';

/** @type {readonly Readonly<{path: string, bytes: Buffer}>[]} */
const FIXTURE_FILES = Object.freeze([
  { path: 'index.html', bytes: Buffer.from('<html></html>', 'utf8') },
  { path: 'assets/app.js', bytes: Buffer.from('console.log(1);', 'utf8') },
  { path: 'empty.txt', bytes: Buffer.alloc(0) },
  { path: 'nested/deep/dir/file.bin', bytes: Buffer.from([0, 1, 2, 255]) },
  { path: 'ünïcödé/résumé.md', bytes: Buffer.from('café', 'utf8') },
]);

test('the three adapters and the protocol agree on the artifact digest for a shared fixture set', () => {
  const expected = protocolComputeArtifactDigest(FIXTURE_FILES);

  assert.equal(localComputeArtifactDigest(FIXTURE_FILES), expected);
  assert.equal(pagesComputeArtifactDigest(FIXTURE_FILES), expected);
  assert.equal(spacesComputeArtifactDigest(FIXTURE_FILES), expected);
});

test('the digest is order-independent across all four implementations', () => {
  const reversed = [...FIXTURE_FILES].reverse();
  const expected = protocolComputeArtifactDigest(FIXTURE_FILES);

  assert.equal(protocolComputeArtifactDigest(reversed), expected);
  assert.equal(localComputeArtifactDigest(reversed), expected);
  assert.equal(pagesComputeArtifactDigest(reversed), expected);
  assert.equal(spacesComputeArtifactDigest(reversed), expected);
});

test('a single-file artifact digests the same way through every implementation', () => {
  /** @type {readonly Readonly<{path: string, bytes: Buffer}>[]} */
  const single = [{ path: 'only.txt', bytes: Buffer.from('solo', 'utf8') }];
  const expected = protocolComputeArtifactDigest(single);

  assert.equal(localComputeArtifactDigest(single), expected);
  assert.equal(pagesComputeArtifactDigest(single), expected);
  assert.equal(spacesComputeArtifactDigest(single), expected);
});

test('the two marker-excluding adapters ignore the reserved generation-marker coordinate', () => {
  const withMarker = [
    ...FIXTURE_FILES,
    {
      path: '.well-known/gala-generation.json',
      bytes: Buffer.from('{"generationId":"g-1"}', 'utf8'),
    },
  ];
  const withoutMarker = protocolComputeArtifactDigest(FIXTURE_FILES);

  assert.equal(pagesComputeArtifactDigest(withMarker), withoutMarker);
  assert.equal(spacesComputeArtifactDigest(withMarker), withoutMarker);
});

test('design check: a marker-excluding digest over a set never collides with the non-excluding digest over that same set', () => {
  const withMarker = [
    ...FIXTURE_FILES,
    {
      path: '.well-known/gala-generation.json',
      bytes: Buffer.from('{"generationId":"g-1"}', 'utf8'),
    },
  ];

  // The non-excluding digest sees every entry, including the marker; the
  // marker-excluding adapters filter it out first. Over the identical raw
  // input, these must never agree -- JCS's array encoding is self-delimiting
  // (distinct entry counts produce syntactically distinct canonical text),
  // so this is a structural guarantee, not a coincidence of this fixture.
  const nonExcludingDigest = protocolComputeArtifactDigest(withMarker);
  const pagesExcludingDigest = pagesComputeArtifactDigest(withMarker);
  const spacesExcludingDigest = spacesComputeArtifactDigest(withMarker);

  assert.notEqual(pagesExcludingDigest, nonExcludingDigest);
  assert.notEqual(spacesExcludingDigest, nonExcludingDigest);
  assert.equal(pagesExcludingDigest, spacesExcludingDigest);
});
