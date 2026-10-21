/**
 * Public reads go to the origin that is serving right now.
 *
 * `destination.verificationBaseUrl` is that origin (the `github.io` project
 * path before the Pages CNAME is set, the custom base once it serves) and
 * every verification read uses it when present; `publicBaseUrl` (the build
 * base the artifact was built for) is used otherwise. Artifact-relative paths
 * are joined the same way under either.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as adapter from '../src/index.js';
import {
  computeArtifactDigest,
  forgetDestination,
  generateUuidV7,
} from '../src/index.js';
import { startFakePagesProvider } from './fake-pages-provider.js';
import { oidcFor } from './oidc-fixture.js';

const EXPECT_NOTHING_SERVED = 'gala:expect-nothing-served';
/** The base the artifact was built for: a root base, not the project path. */
const ROOT_BUILD_BASE = 'https://blog.example.com/';

/**
 * A provider whose site is served under its project path, and a destination
 * whose build base is a root base.
 *
 * @param {{verification: boolean}} options whether the destination names the
 *   verification base
 * @returns {Promise<{provider: any, destination: any, publicUrls: string[], teardown: () => Promise<void>}>}
 *   the fixture; `publicUrls` records every public URL read
 */
async function bind(options) {
  const provider = await startFakePagesProvider({
    repository: 'galascribe-blog',
  });
  /** @type {string[]} */
  const publicUrls = [];
  const destination = {
    owner: provider.owner,
    repository: provider.repository,
    repositoryId: '9200',
    repositoryOwnerId: '99001',
    apiOrigin: provider.apiOrigin,
    publicBaseUrl: ROOT_BUILD_BASE,
    ...(options.verification
      ? { verificationBaseUrl: provider.publicBaseUrl }
      : {}),
    token: provider.token,
    publishCarrier: provider.publishCarrier,
    headSha: '1c14dcdff9501ef74b8b7a5897fba69c586fa76a',
    fetch: provider.fetch,
    publicFetch: /** @type {typeof globalThis.fetch} */ (
      (url, init) => {
        publicUrls.push(String(url));
        return provider.fetch(url, init);
      }
    ),
    sleep: () => Promise.resolve(),
  };
  return {
    provider,
    destination,
    publicUrls,
    async teardown() {
      forgetDestination(destination);
      await provider.stop();
    },
  };
}

/**
 * Publish one generation built for the root base.
 *
 * @param {any} destination the destination
 * @returns {Promise<{generationId: string, artifactDigest: string}>} the
 *   published identities
 */
async function publish(destination) {
  const files = [{ path: 'index.html', bytes: Buffer.from('home', 'utf8') }];
  const generationId = generateUuidV7();
  const artifactDigest = computeArtifactDigest(files);
  const staged = await adapter.stage({
    destination,
    operationId: generateUuidV7(),
    attemptId: generateUuidV7(),
    idempotencyKey: generateUuidV7(),
    generationId,
    artifactId: generateUuidV7(),
    artifactDigest,
    files,
  });
  await adapter.activate({
    destination,
    stageToken: /** @type {string} */ (staged.stageToken),
    generationId,
    expectedCurrentGenerationId: EXPECT_NOTHING_SERVED,
    ...oidcFor(destination),
  });
  return { generationId, artifactDigest };
}

test('a project-path origin verifies an artifact built for a root base: the marker is found under the project path', async () => {
  const bound = await bind({ verification: true });
  try {
    const published = await publish(bound.destination);
    bound.publicUrls.length = 0;

    const inspected = await adapter.inspectDestination(bound.destination);
    assert.equal(inspected.currentGenerationId, published.generationId);
    assert.deepEqual(bound.publicUrls, [
      `${bound.provider.publicBaseUrl}/.well-known/gala-generation.json`,
    ]);
    assert.ok(
      bound.publicUrls.every((url) => !url.startsWith(ROOT_BUILD_BASE)),
      'the build base is never read',
    );

    bound.publicUrls.length = 0;
    const observed = await adapter.observe({
      destination: bound.destination,
      generationId: published.generationId,
      expectedArtifactDigest: published.artifactDigest,
    });
    assert.equal(observed.verified, true);
    assert.equal(observed.markerValid, true);
    assert.deepEqual(bound.publicUrls, [
      `${bound.provider.publicBaseUrl}/.well-known/gala-generation.json`,
      `${bound.provider.publicBaseUrl}/index.html`,
    ]);
  } finally {
    await bound.teardown();
  }
});

test('without a verification base the build base is read: the same site is not found at the root', async () => {
  const bound = await bind({ verification: false });
  try {
    await publish(bound.destination);
    bound.publicUrls.length = 0;
    const inspected = await adapter.inspectDestination(bound.destination);
    assert.equal(inspected.currentGenerationId, null);
    assert.deepEqual(bound.publicUrls, [
      `${ROOT_BUILD_BASE}.well-known/gala-generation.json`,
    ]);
  } finally {
    await bound.teardown();
  }
});

test('a verification base must be https', async () => {
  const bound = await bind({ verification: true });
  try {
    await assert.rejects(
      adapter.inspectDestination({
        ...bound.destination,
        verificationBaseUrl: 'http://galascribe.example.com/',
      }),
      /verificationBaseUrl must be an https origin/u,
    );
  } finally {
    await bound.teardown();
  }
});
