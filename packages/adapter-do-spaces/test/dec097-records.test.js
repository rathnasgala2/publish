/**
 * Byte-for-byte proof that `dec097-records.js`'s three record builders
 * reproduce the pinned `@rathnasgala2/schemas` 2.10.0 golden vectors
 * (`parity/digest-record-vectors.json`): `spaces-website-configuration-root`,
 * `-docs-base-path`, `spaces-control-plane-binding`,
 * `spaces-region-catalog`, and the chained
 * `destination-provider-binding-do-spaces-realistic` vector, which is these
 * two records' digests composed into `deriveOrigins`'s own binding shape.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import { deriveOrigins } from '../src/origins.js';
import {
  errorDocumentKeyFor,
  spacesControlPlaneBinding,
  spacesRegionCatalog,
  spacesWebsiteConfiguration,
} from '../src/dec097-records.js';

/**
 * @returns {Promise<any[]>} the pinned parity vectors
 */
async function loadVectors() {
  const url = import.meta
    .resolve('@rathnasgala2/schemas/parity/digest-record-vectors.json');
  const document = JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
  return document.vectors;
}

/**
 * @param {any[]} vectors the vector set
 * @param {string} vectorId the vector to find
 * @returns {any} the vector
 */
function vector(vectors, vectorId) {
  const found = vectors.find((entry) => entry.vectorId === vectorId);
  assert.ok(found, `vector ${vectorId} exists`);
  return found;
}

test('spacesWebsiteConfiguration reproduces the root and docs base-path vectors', async () => {
  const vectors = await loadVectors();

  const root = vector(vectors, 'spaces-website-configuration-root');
  const rootRecord = spacesWebsiteConfiguration({ basePath: '/' });
  assert.deepEqual(
    { ...rootRecord, routingRules: [...rootRecord.routingRules] },
    root.input,
  );
  assert.equal(rootRecord.configurationDigest, `sha256:${root.digestHex}`);
  assert.ok(ACTIVE_DIGEST_PROFILES.spacesWebsiteConfiguration !== undefined);
  assert.equal(
    ACTIVE_DIGEST_PROFILES.spacesWebsiteConfiguration.digest(rootRecord),
    `sha256:${root.digestHex}`,
  );
  assert.equal(errorDocumentKeyFor('/'), '404.html');

  const docs = vector(vectors, 'spaces-website-configuration-docs-base-path');
  const docsRecord = spacesWebsiteConfiguration({ basePath: '/docs/' });
  assert.deepEqual(
    { ...docsRecord, routingRules: [...docsRecord.routingRules] },
    docs.input,
  );
  assert.equal(docsRecord.configurationDigest, `sha256:${docs.digestHex}`);
  assert.equal(errorDocumentKeyFor('/docs/'), 'docs/404.html');
});

test('spacesControlPlaneBinding reproduces the pinned vector, chained on the website configuration digest', async () => {
  const vectors = await loadVectors();
  const websiteVector = vector(vectors, 'spaces-website-configuration-root');
  const bindingVector = vector(vectors, 'spaces-control-plane-binding');

  const record = spacesControlPlaneBinding({
    servedBucket: 'gala-newsletter-served',
    stagingBucket: 'gala-newsletter-staging',
    region: 'nyc3',
    websiteOrigin:
      'https://gala-newsletter-served.nyc3-static.digitaloceanspaces.com',
    websiteConfigurationDigest: `sha256:${websiteVector.digestHex}`,
  });
  assert.deepEqual(record, bindingVector.input);
  assert.equal(record.bindingDigest, `sha256:${bindingVector.digestHex}`);
});

test('spacesRegionCatalog reproduces the pinned vector', async () => {
  const vectors = await loadVectors();
  const catalogVector = vector(vectors, 'spaces-region-catalog');
  const record = spacesRegionCatalog({
    regions: ['ams3', 'fra1', 'lon1', 'nyc3', 'sfo3', 'sgp1', 'syd1', 'tor1'],
  });
  assert.deepEqual(
    { ...record, regions: [...record.regions] },
    catalogVector.input,
  );
  assert.equal(record.digest, `sha256:${catalogVector.digestHex}`);
});

test('the chained realistic destinationProviderBinding vector: real origin spellings, and both control-plane digests are these two records own outputs', async () => {
  const vectors = await loadVectors();
  const realistic = vector(
    vectors,
    'destination-provider-binding-do-spaces-realistic',
  );
  const catalogVector = vector(vectors, 'spaces-region-catalog');

  const origins = deriveOrigins({
    region: 'nyc3',
    servedBucket: 'gala-newsletter-served',
    stagingBucket: 'gala-newsletter-staging',
  });
  assert.equal(origins.servedApiOrigin, realistic.input.servedApiOrigin);
  assert.equal(origins.stagingApiOrigin, realistic.input.stagingApiOrigin);
  assert.equal(origins.publicOrigin, realistic.input.websiteOrigin);

  const website = spacesWebsiteConfiguration({ basePath: '/' });
  const binding = spacesControlPlaneBinding({
    servedBucket: origins.servedBucket,
    stagingBucket: origins.stagingBucket,
    region: origins.region,
    websiteOrigin: origins.publicOrigin,
    websiteConfigurationDigest: website.configurationDigest,
  });
  const catalog = spacesRegionCatalog({
    regions: catalogVector.input.regions,
  });

  assert.equal(
    website.configurationDigest,
    realistic.input.websiteConfigurationDigest,
  );
  assert.equal(
    binding.bindingDigest,
    realistic.input.controlPlaneBindingDigest,
  );
  assert.equal(catalog.digest, realistic.input.regionCatalogDigest);

  const destinationProviderBinding = {
    kind: 'do-spaces',
    servedBucket: origins.servedBucket,
    stagingBucket: origins.stagingBucket,
    region: origins.region,
    regionCatalogDigest: catalog.digest,
    servedApiOrigin: origins.servedApiOrigin,
    stagingApiOrigin: origins.stagingApiOrigin,
    websiteOrigin: origins.publicOrigin,
    websiteConfigurationDigest: website.configurationDigest,
    controlPlaneBindingDigest: binding.bindingDigest,
  };
  assert.deepEqual(destinationProviderBinding, realistic.input);
  assert.ok(ACTIVE_DIGEST_PROFILES.destinationProviderBinding !== undefined);
  assert.equal(
    ACTIVE_DIGEST_PROFILES.destinationProviderBinding.digest(
      destinationProviderBinding,
    ),
    `sha256:${realistic.digestHex}`,
  );
});
