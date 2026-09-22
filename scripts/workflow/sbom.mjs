/**
 * The SPDX 2.3 SBOM `freeze` writes into the frozen envelope's
 * `metadata/sbom.spdx.json` (DEC-097 section 6, "Deterministic SPDX SBOM
 * profile"): the `gala-spdx-json-v2` projection, emitted as compact JCS and
 * validated against the unmodified official SPDX 2.3 JSON Schema before it
 * is written.
 *
 * Every row here is a fact the freeze job holds: the artifact inventory
 * and its per-file SHA-1/SHA-256 checksums come from the payload bytes,
 * the seven direct package rows and every transitive row and edge come
 * from the verified source's lock, `created` is the manifest's build epoch
 * and the sole creator is the locked publisher. What the workflow does not
 * hold is stated as SPDX's own `NOASSERTION`, never guessed: per-package
 * license expressions are a Gala release-catalog fact and per-asset theme
 * licenses need the theme contract's asset map, so both license fields of
 * every package and every file's `licenseConcluded` are `NOASSERTION`, and
 * `creationInfo.licenseListVersion` (a Gala runtime-catalog fact) is
 * omitted. Those three deviations from the closed profile are recorded in
 * {@link SBOM_PROFILE_DEVIATIONS}.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Ajv } from 'ajv';

import { SPDX_23_JSON_SCHEMA_DIGEST } from './build-provenance.mjs';
import {
  compareUtf8,
  jcsBytes,
  manifestInventory,
  taggedSha256,
} from './frozen-envelope.mjs';

/** The predicate type the SBOM attestation carries. */
export const SPDX_PREDICATE_TYPE = 'https://spdx.dev/Document/v2.3';

/** DEC-097's serialized cap, GitHub's attestation input ceiling. */
export const MAXIMUM_SBOM_BYTES = 16_777_216;

/** The exact SPDX ID of the artifact package. */
export const ARTIFACT_PACKAGE_ID = 'SPDXRef-Package-Artifact';

/**
 * The closed-profile members this SBOM states as `NOASSERTION` or omits,
 * with the owner of the fact.
 */
export const SBOM_PROFILE_DEVIATIONS = Object.freeze({
  packageLicenses:
    'licenseConcluded/licenseDeclared of every dependency row are NOASSERTION: the normalized licenseExpression is a Gala release-catalog row the workflow does not hold',
  fileLicenses:
    'licenseConcluded of every file is NOASSERTION: theme-asset expressions need the theme contract’s asset license map, which the build carrier does not carry',
  licenseListVersion:
    'creationInfo.licenseListVersion is omitted: the accepted SPDX license-list release is a Gala runtime-catalog fact',
});

/**
 * The official SPDX 2.3 JSON Schema, read once and proved to be the exact
 * bytes DEC-097 names before anything is validated against it.
 */
const OFFICIAL_SCHEMA_BYTES = readFileSync(
  new URL('./spdx/spdx-schema-2.3.json', import.meta.url),
);
if (taggedSha256(OFFICIAL_SCHEMA_BYTES) !== SPDX_23_JSON_SCHEMA_DIGEST) {
  throw new Error(
    `SPDX_SCHEMA_DIGEST_MISMATCH: scripts/workflow/spdx/spdx-schema-2.3.json hashes to ${taggedSha256(OFFICIAL_SCHEMA_BYTES)}, not the DEC-097 ${SPDX_23_JSON_SCHEMA_DIGEST}`,
  );
}
const OFFICIAL_SCHEMA_VALIDATE = new Ajv({
  strict: false,
  allErrors: true,
}).compile(JSON.parse(OFFICIAL_SCHEMA_BYTES.toString('utf8')));

/**
 * One stable SBOM failure.
 */
export class SbomError extends Error {
  /**
   * @param {string} code the stable code
   * @param {string} detail what was observed
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'SbomError';
    this.code = code;
  }
}

/**
 * @param {string} digest a tagged `sha256:` digest
 * @param {string} pointer where, for the diagnostic
 * @returns {string} the untagged 64 hex characters
 */
function untagged(digest, pointer) {
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new SbomError(
      'SPDX_SBOM_INVALID',
      `${pointer} is not a tagged sha256 digest`,
    );
  }
  return digest.slice('sha256:'.length);
}

/**
 * @param {number} value the value
 * @param {number} width the zero-padded width
 * @returns {string} the padded decimal
 */
function padded(value, width) {
  return String(value).padStart(width, '0');
}

/**
 * The seven direct package rows in DEC-097's exact order: schemas,
 * template, theme, publish-action, publish-kernel, adapter-protocol and the
 * selected adapter — the lock's `schemas`/`template`/`theme` members and its
 * four `publisher` rows in lock order.
 *
 * @param {Record<string, any>} lock the lock document
 * @returns {{package: string, version: string, integrity: string}[]} the rows
 */
export function directPackageRows(lock) {
  const rows = [lock.schemas, lock.template, lock.theme, ...lock.publisher];
  if (
    rows.length !== 7 ||
    rows.some((row) => typeof row?.package !== 'string')
  ) {
    throw new SbomError(
      'SPDX_SBOM_INVALID',
      `the lock must carry exactly seven direct package rows (found ${rows.length})`,
    );
  }
  return rows;
}

/**
 * One dependency-package row (`filesAnalyzed: false`, one SHA-256 checksum).
 *
 * @param {{package: string, version: string, integrity: string}} row the lock row
 * @param {string} id the assigned SPDX ID
 * @returns {Record<string, unknown>} the SPDX package
 */
function dependencyPackage(row, id) {
  return {
    SPDXID: id,
    name: row.package,
    versionInfo: row.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    checksums: [
      {
        algorithm: 'SHA256',
        checksumValue: untagged(row.integrity, `${row.package}/integrity`),
      },
    ],
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  };
}

/**
 * Build the SBOM document for one frozen artifact.
 *
 * @param {{
 *   manifest: Record<string, unknown>,
 *   lock: Record<string, any>,
 *   files: readonly {path: string, bytes: Buffer}[]
 * }} input the manifest record, the lock document and the payload files
 * @returns {Record<string, unknown>} the SBOM object (serialize with `jcsBytes`)
 */
export function buildSbom(input) {
  const inventory = manifestInventory(input.manifest);
  const artifactHex = untagged(inventory.artifactDigest, 'artifactDigest');
  const files = [...input.files].sort((left, right) =>
    compareUtf8(left.path, right.path),
  );
  if (files.length === 0) {
    throw new SbomError(
      'SPDX_SBOM_INVALID',
      'an empty file set has no verification basis',
    );
  }
  const publisher = input.lock.publisher?.[0];
  if (publisher?.package !== '@rathnasgala2/publish-action') {
    throw new SbomError(
      'SPDX_SBOM_INVALID',
      'the lock’s first publisher row is not @rathnasgala2/publish-action',
    );
  }
  if (
    typeof input.manifest.generatedAt !== 'string' ||
    typeof input.manifest.sourceCommit !== 'string'
  ) {
    throw new SbomError(
      'SPDX_SBOM_INVALID',
      'the manifest carries no generatedAt/sourceCommit',
    );
  }

  const spdxFiles = files.map((file, index) => ({
    SPDXID: `SPDXRef-File-${padded(index + 1, 6)}`,
    fileName: `./${file.path}`,
    checksums: [
      {
        algorithm: 'SHA1',
        checksumValue: createHash('sha1').update(file.bytes).digest('hex'),
      },
      {
        algorithm: 'SHA256',
        checksumValue: createHash('sha256').update(file.bytes).digest('hex'),
      },
    ],
    licenseConcluded: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  }));
  // SPDX 2.3 package verification code: SHA-1 over the lexicographically
  // sorted, undelimited concatenation of every file's SHA-1.
  const verificationCode = createHash('sha1')
    .update(
      spdxFiles
        .map(
          (file) =>
            /** @type {{checksumValue: string}} */ (file.checksums[0])
              .checksumValue,
        )
        .sort()
        .join(''),
      'ascii',
    )
    .digest('hex');

  const direct = directPackageRows(input.lock);
  /** @type {Record<string, any>[]} */
  const dependencies = input.lock.dependencies ?? [];
  const packages = [
    {
      SPDXID: ARTIFACT_PACKAGE_ID,
      name: `galascribe-artifact-${artifactHex}`,
      versionInfo: input.manifest.sourceCommit,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: true,
      packageVerificationCode: {
        packageVerificationCodeValue: verificationCode,
      },
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
    },
    ...direct.map((row, index) =>
      dependencyPackage(row, `SPDXRef-Package-Direct-${padded(index, 2)}`),
    ),
    ...dependencies.map((row, index) =>
      dependencyPackage(
        /** @type {{package: string, version: string, integrity: string}} */ (
          row
        ),
        `SPDXRef-Package-Dependency-${padded(index + 1, 6)}`,
      ),
    ),
  ];
  /** @type {Map<string, string>} */
  const idByExact = new Map();
  for (const [index, row] of [...direct, ...dependencies].entries()) {
    idByExact.set(
      `${row.package}@${row.version}`,
      /** @type {{SPDXID: string}} */ (packages[index + 1]).SPDXID,
    );
  }

  /** @type {Set<string>} */
  const relationshipKeys = new Set();
  /** @type {{spdxElementId: string, relationshipType: string, relatedSpdxElement: string}[]} */
  const relationships = [];
  /**
   * @param {string} spdxElementId the subject
   * @param {string} relationshipType the closed relationship
   * @param {string} relatedSpdxElement the object
   * @returns {void}
   */
  function relate(spdxElementId, relationshipType, relatedSpdxElement) {
    const key = `${spdxElementId}\0${relationshipType}\0${relatedSpdxElement}`;
    if (!relationshipKeys.has(key)) {
      relationshipKeys.add(key);
      relationships.push({
        spdxElementId,
        relationshipType,
        relatedSpdxElement,
      });
    }
  }
  relate('SPDXRef-DOCUMENT', 'DESCRIBES', ARTIFACT_PACKAGE_ID);
  for (const file of spdxFiles) {
    relate(ARTIFACT_PACKAGE_ID, 'CONTAINS', file.SPDXID);
  }
  for (let index = 0; index < direct.length; index += 1) {
    relate(
      ARTIFACT_PACKAGE_ID,
      'DEPENDS_ON',
      /** @type {{SPDXID: string}} */ (packages[index + 1]).SPDXID,
    );
  }
  for (const edge of /** @type {{from: string, to: string}[]} */ (
    input.lock.dependencyDag ?? []
  )) {
    const from = idByExact.get(edge.from);
    const to = idByExact.get(edge.to);
    if (from === undefined || to === undefined) {
      throw new SbomError(
        'SPDX_SBOM_INVALID',
        `dependencyDag edge ${edge.from} -> ${edge.to} names a package the lock does not carry`,
      );
    }
    relate(from, 'DEPENDS_ON', to);
  }
  relationships.sort(
    (left, right) =>
      compareUtf8(left.spdxElementId, right.spdxElementId) ||
      compareUtf8(left.relationshipType, right.relationshipType) ||
      compareUtf8(left.relatedSpdxElement, right.relatedSpdxElement),
  );

  return {
    SPDXID: 'SPDXRef-DOCUMENT',
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    name: `galascribe-artifact-${artifactHex}`,
    documentNamespace: `urn:gala:spdx:2:${artifactHex}`,
    creationInfo: {
      created: input.manifest.generatedAt,
      creators: [`Tool: @rathnasgala2/publish-action-${publisher.version}`],
    },
    documentDescribes: [ARTIFACT_PACKAGE_ID],
    packages,
    files: spdxFiles,
    relationships,
  };
}

/**
 * Validate one SBOM's exact bytes: the official SPDX 2.3 schema must accept
 * them, they must be the compact JCS of the closed projection this module
 * builds from the same inputs, and they must fit the attestation cap.
 *
 * @param {Buffer} bytes the exact SBOM bytes
 * @param {{
 *   manifest: Record<string, unknown>,
 *   lock: Record<string, any>,
 *   files: readonly {path: string, bytes: Buffer}[]
 * }} input the inputs the SBOM must have been built from
 * @returns {{sbomDigest: string}} the tagged digest of the exact bytes
 */
export function validateSbomBytes(bytes, input) {
  if (bytes.byteLength > MAXIMUM_SBOM_BYTES) {
    throw new SbomError(
      'SPDX_SBOM_TOO_LARGE',
      `${bytes.byteLength} bytes exceed the ${MAXIMUM_SBOM_BYTES}-byte attestation input ceiling`,
    );
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new SbomError('SPDX_SBOM_INVALID', 'the SBOM bytes are not JSON');
  }
  if (!OFFICIAL_SCHEMA_VALIDATE(parsed)) {
    throw new SbomError(
      'SPDX_SBOM_SCHEMA_REJECTED',
      (OFFICIAL_SCHEMA_VALIDATE.errors ?? [])
        .map(
          (/** @type {{instancePath: string, message?: string}} */ error) =>
            `${error.instancePath || '/'} ${error.message ?? ''}`,
        )
        .join('; '),
    );
  }
  if (!bytes.equals(jcsBytes(buildSbom(input)))) {
    throw new SbomError(
      'SPDX_SBOM_INVALID',
      'the SBOM bytes are not the closed projection of the manifest, lock and payload they claim to describe',
    );
  }
  return { sbomDigest: taggedSha256(bytes) };
}
