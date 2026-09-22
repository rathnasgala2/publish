/**
 * The SPDX 2.3 SBOM `freeze` writes (DEC-097 section 6, "Deterministic SPDX
 * SBOM profile"): the official SPDX 2.3 JSON Schema accepts it, its rows
 * are the manifest inventory and the lock in DEC-097's exact order and IDs,
 * the package verification code follows SPDX 2.3 exactly, the relationship
 * union is complete and deduplicated, and what the workflow does not hold
 * is `NOASSERTION`, never a guess.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  SBOM_PROFILE_DEVIATIONS,
  SbomError,
  buildSbom,
  directPackageRows,
  validateSbomBytes,
} from '../scripts/workflow/sbom.mjs';
import { jcsBytes } from '../scripts/workflow/frozen-envelope.mjs';
import { fixtureLock, manifestFor } from './fixtures/artifact-manifest.mjs';

const FILES = Object.freeze([
  { path: 'index.html', bytes: Buffer.from('<!doctype html><p>home', 'utf8') },
  { path: 'assets/site.css', bytes: Buffer.from('body{color:#111}', 'utf8') },
  {
    path: 'about/index.html',
    bytes: Buffer.from('<!doctype html><p>about', 'utf8'),
  },
]);

/**
 * A lock with two transitive dependencies and three DAG edges, one of which
 * duplicates an artifact-to-direct row.
 *
 * @returns {Record<string, any>} the lock
 */
function lockWithDependencies() {
  return fixtureLock('@rathnasgala2/adapter-github-pages', (lock) => {
    lock.dependencies = [
      {
        package: 'left-pad',
        version: '1.3.0',
        integrity: `sha256:${'a'.repeat(64)}`,
        registry: 'https://registry.npmjs.org/',
      },
      {
        package: 'right-pad',
        version: '2.0.0',
        integrity: `sha256:${'b'.repeat(64)}`,
        registry: 'https://registry.npmjs.org/',
      },
    ];
    lock.dependencyDag = [
      { from: '@rathnasgala2/template@2.0.0', to: 'left-pad@1.3.0' },
      { from: 'left-pad@1.3.0', to: 'right-pad@2.0.0' },
      { from: '@rathnasgala2/publish-action@0.1.0', to: 'left-pad@1.3.0' },
    ];
  });
}

test('the SBOM is the closed projection: root members, package order and IDs, files, verification code and relationships', () => {
  const lock = lockWithDependencies();
  const manifest = manifestFor(FILES, { lock });
  const sbom = /** @type {any} */ (buildSbom({ manifest, lock, files: FILES }));
  const artifactHex = manifest.artifactDigest.slice('sha256:'.length);

  assert.deepEqual(Object.keys(sbom), [
    'SPDXID',
    'spdxVersion',
    'dataLicense',
    'name',
    'documentNamespace',
    'creationInfo',
    'documentDescribes',
    'packages',
    'files',
    'relationships',
  ]);
  assert.equal(sbom.name, `galascribe-artifact-${artifactHex}`);
  assert.equal(sbom.documentNamespace, `urn:gala:spdx:2:${artifactHex}`);
  assert.deepEqual(sbom.creationInfo, {
    created: manifest.generatedAt,
    creators: ['Tool: @rathnasgala2/publish-action-0.1.0'],
  });

  assert.deepEqual(
    sbom.packages.map((/** @type {any} */ row) => [row.SPDXID, row.name]),
    [
      ['SPDXRef-Package-Artifact', `galascribe-artifact-${artifactHex}`],
      ['SPDXRef-Package-Direct-00', '@rathnasgala2/schemas'],
      ['SPDXRef-Package-Direct-01', '@rathnasgala2/template'],
      ['SPDXRef-Package-Direct-02', '@rathnasgala2/theme-default'],
      ['SPDXRef-Package-Direct-03', '@rathnasgala2/publish-action'],
      ['SPDXRef-Package-Direct-04', '@rathnasgala2/publish-kernel'],
      ['SPDXRef-Package-Direct-05', '@rathnasgala2/adapter-protocol'],
      ['SPDXRef-Package-Direct-06', '@rathnasgala2/adapter-github-pages'],
      ['SPDXRef-Package-Dependency-000001', 'left-pad'],
      ['SPDXRef-Package-Dependency-000002', 'right-pad'],
    ],
  );
  assert.equal(directPackageRows(lock).length, 7);
  const artifact = sbom.packages[0];
  assert.equal(artifact.filesAnalyzed, true);
  assert.equal(artifact.versionInfo, manifest.sourceCommit);
  assert.equal(artifact.checksums, undefined);
  const dependency = sbom.packages[8];
  assert.equal(dependency.filesAnalyzed, false);
  assert.equal(dependency.packageVerificationCode, undefined);
  assert.deepEqual(dependency.checksums, [
    { algorithm: 'SHA256', checksumValue: 'a'.repeat(64) },
  ]);

  const sortedPaths = ['about/index.html', 'assets/site.css', 'index.html'];
  assert.deepEqual(
    sbom.files.map((/** @type {any} */ file) => [file.SPDXID, file.fileName]),
    sortedPaths.map((path, index) => [
      `SPDXRef-File-${String(index + 1).padStart(6, '0')}`,
      `./${path}`,
    ]),
  );
  const sha1s = sortedPaths.map((path) =>
    createHash('sha1')
      .update(
        /** @type {any} */ (FILES.find((file) => file.path === path)).bytes,
      )
      .digest('hex'),
  );
  assert.deepEqual(
    sbom.files.map(
      (/** @type {any} */ file) => file.checksums[0].checksumValue,
    ),
    sha1s,
  );
  assert.equal(
    artifact.packageVerificationCode.packageVerificationCodeValue,
    createHash('sha1')
      .update([...sha1s].sort().join(''), 'ascii')
      .digest('hex'),
  );

  const relationships = sbom.relationships.map(
    (/** @type {any} */ row) =>
      `${row.spdxElementId} ${row.relationshipType} ${row.relatedSpdxElement}`,
  );
  assert.deepEqual(
    relationships,
    [...relationships].sort(),
    'sorted by element, type, related',
  );
  assert.ok(
    relationships.includes(
      'SPDXRef-DOCUMENT DESCRIBES SPDXRef-Package-Artifact',
    ),
  );
  assert.equal(
    relationships.filter((row) => row.includes(' CONTAINS ')).length,
    FILES.length,
  );
  assert.equal(
    relationships.filter((row) =>
      row.startsWith('SPDXRef-Package-Artifact DEPENDS_ON'),
    ).length,
    7,
  );
  assert.ok(
    relationships.includes(
      'SPDXRef-Package-Direct-01 DEPENDS_ON SPDXRef-Package-Dependency-000001',
    ),
  );
  assert.ok(
    relationships.includes(
      'SPDXRef-Package-Dependency-000001 DEPENDS_ON SPDXRef-Package-Dependency-000002',
    ),
  );
  assert.ok(
    relationships.includes(
      'SPDXRef-Package-Direct-03 DEPENDS_ON SPDXRef-Package-Dependency-000001',
    ),
  );
  assert.equal(
    new Set(relationships).size,
    relationships.length,
    'the union has no duplicate',
  );
  assert.equal(relationships.length, 1 + FILES.length + 7 + 3);
});

test('what the workflow does not hold is NOASSERTION and documented, never guessed', () => {
  const lock = fixtureLock();
  const manifest = manifestFor(FILES, { lock });
  const sbom = /** @type {any} */ (buildSbom({ manifest, lock, files: FILES }));
  for (const row of sbom.packages) {
    assert.equal(row.licenseConcluded, 'NOASSERTION');
    assert.equal(row.licenseDeclared, 'NOASSERTION');
    assert.equal(row.copyrightText, 'NOASSERTION');
    assert.equal(row.downloadLocation, 'NOASSERTION');
  }
  for (const file of sbom.files) {
    assert.equal(file.licenseConcluded, 'NOASSERTION');
  }
  assert.equal(sbom.creationInfo.licenseListVersion, undefined);
  assert.deepEqual(Object.keys(SBOM_PROFILE_DEVIATIONS).sort(), [
    'fileLicenses',
    'licenseListVersion',
    'packageLicenses',
  ]);
});

test('the official SPDX 2.3 schema accepts the exact bytes, and a reserialized or altered document is refused', () => {
  const lock = lockWithDependencies();
  const manifest = manifestFor(FILES, { lock });
  const sbom = buildSbom({ manifest, lock, files: FILES });
  const bytes = jcsBytes(sbom);
  assert.deepEqual(validateSbomBytes(bytes, { manifest, lock, files: FILES }), {
    sbomDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  });
  assert.throws(
    () =>
      validateSbomBytes(Buffer.from(JSON.stringify(sbom, null, 2)), {
        manifest,
        lock,
        files: FILES,
      }),
    (/** @type {any} */ error) =>
      error instanceof SbomError && error.code === 'SPDX_SBOM_INVALID',
    'pretty-printed bytes are not the retained compact JCS',
  );
  assert.throws(
    () =>
      validateSbomBytes(
        jcsBytes({
          ...sbom,
          files: [.../** @type {any} */ (sbom).files].reverse(),
        }),
        { manifest, lock, files: FILES },
      ),
    /SPDX_SBOM_INVALID/u,
  );
  assert.throws(
    () =>
      validateSbomBytes(
        jcsBytes({ ...sbom, spdxVersion: 'SPDX-2.2', creationInfo: {} }),
        { manifest, lock, files: FILES },
      ),
    /SPDX_SBOM_SCHEMA_REJECTED/u,
    'a document the official schema rejects is refused before the profile is compared',
  );
});

test('a DAG edge naming a package the lock does not carry, and an empty file set, are refused', () => {
  const lock = fixtureLock(undefined, (document) => {
    document.dependencyDag = [
      { from: '@rathnasgala2/template@2.0.0', to: 'ghost@1.0.0' },
    ];
  });
  const manifest = manifestFor(FILES, { lock });
  assert.throws(
    () => buildSbom({ manifest, lock, files: FILES }),
    /SPDX_SBOM_INVALID: dependencyDag edge/u,
  );
  assert.throws(
    () =>
      buildSbom({
        manifest: manifestFor(FILES),
        lock: fixtureLock(),
        files: [],
      }),
    /SPDX_SBOM_INVALID: an empty file set/u,
  );
});
