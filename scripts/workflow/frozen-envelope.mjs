/**
 * The `gala-frozen-envelope-v2` codec (DEC-097 section 6, "Frozen handoff
 * envelope").
 *
 * The single file `freeze` hands to `attest`, `deploy-*` and `report` is
 * this deterministic binary format and nothing else: no compression, no
 * padding, no trailer, no timestamps, no permissions. Its bytes are exactly
 *
 * ```text
 * ASCII("GALA-FROZEN-ENVELOPE-V2\n")
 * recordCount:u32
 * record[recordCount]
 * record = kind:u8 || pathByteCount:u32 || contentByteCount:u64 ||
 *          pathUtf8[pathByteCount] || content[contentByteCount]
 * ```
 *
 * with `artifactFileCount` payload records (`kind: 0x01`, ordered by path
 * UTF-8 bytes) followed by exactly three metadata records in this order:
 * `metadata/artifact-manifest.jcs` (`0x02`, the complete
 * `artifact-manifest:2.0.0` instance), `metadata/provenance.jcs` (`0x03`,
 * the `buildProvenance:2.0.0` record `provenanceDigest` binds) and
 * `metadata/sbom.spdx.json` (`0x04`, the SPDX 2.3 document `sbomDigest`
 * binds). The metadata records are never staged and are not artifact
 * inventory; their three paths are reserved and refused as payload paths.
 *
 * The decoder revalidates every framing field, the record order, the
 * reserved paths, the caps, the manifest inventory one-for-one against the
 * payload records and the four DEC-097 section 8 digest equalities
 * (`artifactDigest`, `manifestDigest`, `sbomDigest` and the provenance
 * record's own copies), so a consumer that decodes an envelope has already
 * proved it is the envelope the freeze job built. The rules here mirror the
 * schema package's own `validateFrozenEnvelope`; `test/frozen-envelope.test.mjs`
 * proves the two accept and digest the same bytes identically.
 *
 * @module
 */

import { createHash } from 'node:crypto';

import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import { canonicalJson } from './workload-identity.mjs';

/** The exact magic every envelope begins with. */
export const FROZEN_ENVELOPE_MAGIC = Buffer.from(
  'GALA-FROZEN-ENVELOPE-V2\n',
  'ascii',
);

/** `kind:u8 || pathByteCount:u32 || contentByteCount:u64`. */
const RECORD_HEADER_BYTES = 13;

/** The record kinds, by role. */
export const RECORD_KINDS = Object.freeze({
  payload: 0x01,
  manifest: 0x02,
  provenance: 0x03,
  sbom: 0x04,
});

/** DEC-097's caps: record count, whole envelope and each metadata record. */
export const FROZEN_ENVELOPE_LIMITS = Object.freeze({
  maximumRecordCount: 200_003,
  maximumEnvelopeBytes: 1_073_741_824,
  maximumManifestBytes: 268_435_456,
  maximumProvenanceBytes: 16_777_216,
  maximumSbomBytes: 16_777_216,
  maximumPathBytes: 512,
});

/** The three reserved metadata records, in their exact order. */
export const METADATA_RECORDS = Object.freeze([
  Object.freeze({
    kind: RECORD_KINDS.manifest,
    path: 'metadata/artifact-manifest.jcs',
    maximumBytes: FROZEN_ENVELOPE_LIMITS.maximumManifestBytes,
  }),
  Object.freeze({
    kind: RECORD_KINDS.provenance,
    path: 'metadata/provenance.jcs',
    maximumBytes: FROZEN_ENVELOPE_LIMITS.maximumProvenanceBytes,
  }),
  Object.freeze({
    kind: RECORD_KINDS.sbom,
    path: 'metadata/sbom.spdx.json',
    maximumBytes: FROZEN_ENVELOPE_LIMITS.maximumSbomBytes,
  }),
]);

/**
 * The three DEC-097 section 8 profiles this codec recomputes, read from the
 * schema package's own exported digest profiles (2.8.1): `artifact` over the
 * sorted inventory entries, `artifactManifest` over the manifest excluding
 * `artifactId` and `manifestDigest`, and `buildProvenance` over the complete
 * record. Each is required by name so an absent profile is a refusal at
 * load, never an `undefined` digest; `test/frozen-envelope.test.mjs` proves
 * every one equals the previous local domain-plus-JCS computation
 * byte-for-byte on real rows.
 */
export const DIGEST_PROFILES = Object.freeze({
  artifact: requireProfile('artifact'),
  artifactManifest: requireProfile('artifactManifest'),
  buildProvenance: requireProfile('buildProvenance'),
});

/**
 * @param {string} name the exported profile name
 * @returns {{domain: string, digest: (value: unknown) => string, preimage: (value: unknown) => Uint8Array}}
 *   the profile
 */
function requireProfile(name) {
  const profile = ACTIVE_DIGEST_PROFILES[name];
  if (profile === undefined) {
    throw new Error(
      `FROZEN_ENVELOPE_DIGEST_PROFILE_MISSING: @rathnasgala2/schemas/digest-profiles exports no ${name} profile`,
    );
  }
  return profile;
}

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FATAL_UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * One stable envelope failure, named by its code.
 */
export class FrozenEnvelopeError extends Error {
  /**
   * @param {string} code the stable code
   * @param {string} [detail] what was observed
   */
  constructor(code, detail) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = 'FrozenEnvelopeError';
    this.code = code;
  }
}

/**
 * @param {string} code the stable code
 * @param {string} [detail] what was observed
 * @returns {never} always throws
 */
function refuse(code, detail) {
  throw new FrozenEnvelopeError(code, detail);
}

/**
 * The compact JCS bytes of one JSON value.
 *
 * @param {unknown} value the value
 * @returns {Buffer} its canonical UTF-8 bytes
 */
export function jcsBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

/**
 * `SHA256(UTF8(domain) || bytes)`, tagged.
 *
 * @param {string} domain the terminal-NUL domain string
 * @param {Buffer} bytes the preimage bytes after the domain
 * @returns {string} the tagged digest
 */
export function domainSeparatedDigest(domain, bytes) {
  return `sha256:${createHash('sha256').update(domain, 'utf8').update(bytes).digest('hex')}`;
}

/**
 * The tagged SHA-256 of exact bytes.
 *
 * @param {Buffer | Uint8Array} bytes the bytes
 * @returns {string} the tagged digest
 */
export function taggedSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * @param {string} left a path
 * @param {string} right a path
 * @returns {number} the UTF-8 byte order of the two paths
 */
export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/**
 * Refuse a payload path the portable profile cannot admit: empty, over 512
 * bytes, absolute, with an empty, `.` or `..` segment, a backslash, a NUL,
 * a control character, or a reserved metadata path.
 *
 * @param {string} path the decoded path
 * @param {number} byteLength its UTF-8 byte length
 * @returns {void}
 */
function requirePayloadPath(path, byteLength) {
  if (
    byteLength === 0 ||
    byteLength > FROZEN_ENVELOPE_LIMITS.maximumPathBytes ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('//') ||
    path.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/u.test(path) ||
    path.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    refuse('FROZEN_ENVELOPE_PATH_INVALID', path);
  }
  if (METADATA_RECORDS.some((record) => record.path === path)) {
    refuse('FROZEN_ENVELOPE_RESERVED_PATH', path);
  }
}

/**
 * The manifest's artifact inventory: every route and asset entry as the
 * `{path, byteLength, sha256}` triple, sorted by path UTF-8 bytes, plus
 * the DEC-097 section 8 `artifactDigest` over that projection.
 *
 * @param {Record<string, unknown>} manifest the `artifact-manifest:2.0.0` instance
 * @returns {{entries: {path: string, byteLength: string, sha256: string}[], artifactDigest: string}}
 *   the inventory projection
 */
export function manifestInventory(manifest) {
  if (!Array.isArray(manifest.routes) || !Array.isArray(manifest.assets)) {
    refuse('FROZEN_ENVELOPE_MANIFEST_INVALID', 'routes/assets are not arrays');
  }
  /** @type {{path: string, byteLength: string, sha256: string}[]} */
  const entries = [];
  const seen = new Set();
  for (const inventory of [manifest.routes, manifest.assets]) {
    for (const entry of /** @type {Record<string, unknown>[]} */ (inventory)) {
      const { path, byteLength, sha256 } = entry;
      if (
        typeof path !== 'string' ||
        typeof byteLength !== 'string' ||
        !/^(?:0|[1-9][0-9]*)$/u.test(byteLength) ||
        typeof sha256 !== 'string' ||
        !DIGEST_PATTERN.test(sha256)
      ) {
        refuse('FROZEN_ENVELOPE_MANIFEST_INVALID', JSON.stringify(entry));
      }
      requirePayloadPath(path, Buffer.byteLength(path, 'utf8'));
      if (seen.has(path)) {
        refuse('FROZEN_ENVELOPE_PATH_COLLISION', path);
      }
      seen.add(path);
      entries.push({ path, byteLength, sha256 });
    }
  }
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  return {
    entries,
    artifactDigest: DIGEST_PROFILES.artifact.digest(entries),
  };
}

/**
 * The DEC-097 section 8 `manifestDigest`: the manifest excluding only
 * `artifactId` and `manifestDigest`.
 *
 * @param {Record<string, unknown>} manifest the manifest
 * @returns {string} the tagged digest
 */
export function manifestDigestOf(manifest) {
  return DIGEST_PROFILES.artifactManifest.digest(manifest);
}

/**
 * Require one metadata record to be the compact JCS of a JSON object, and
 * return that object.
 *
 * @param {Buffer} content the record content
 * @param {string} path the record path, for the diagnostic
 * @returns {Record<string, unknown>} the parsed object
 */
function parseJcsObject(content, path) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(FATAL_UTF8.decode(content));
  } catch {
    return refuse('FROZEN_ENVELOPE_JSON_INVALID', path);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    refuse('FROZEN_ENVELOPE_METADATA_INVALID', path);
  }
  if (!content.equals(jcsBytes(value))) {
    refuse('FROZEN_ENVELOPE_JCS_INVALID', path);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {number} value the value
 * @returns {Buffer} its big-endian u32
 */
function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value, 0);
  return bytes;
}

/**
 * @param {number} value the value
 * @returns {Buffer} its big-endian u64
 */
function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value), 0);
  return bytes;
}

/**
 * Encode one frozen envelope. The manifest, provenance and SBOM are given as
 * objects and written as their compact JCS bytes; the payload is written in
 * path UTF-8 byte order whatever order it arrives in. The inventory and
 * digest equalities the decoder checks are checked here too, so `freeze`
 * cannot write an envelope its own consumers would refuse.
 *
 * @param {{
 *   files: readonly {path: string, bytes: Buffer}[],
 *   manifest: Record<string, unknown>,
 *   provenance: Record<string, unknown>,
 *   sbom: Record<string, unknown>
 * }} input the payload and the three metadata records
 * @returns {Buffer} the envelope bytes
 */
export function encodeFrozenEnvelope(input) {
  const files = [...input.files].sort((left, right) =>
    compareUtf8(left.path, right.path),
  );
  if (
    files.length + METADATA_RECORDS.length >
    FROZEN_ENVELOPE_LIMITS.maximumRecordCount
  ) {
    refuse('FROZEN_ENVELOPE_COUNT_INVALID', String(files.length));
  }
  /** @type {Buffer[]} */
  const parts = [
    FROZEN_ENVELOPE_MAGIC,
    u32(files.length + METADATA_RECORDS.length),
  ];
  const seen = new Set();
  for (const file of files) {
    const pathBytes = Buffer.from(file.path, 'utf8');
    requirePayloadPath(file.path, pathBytes.byteLength);
    if (seen.has(file.path)) {
      refuse('FROZEN_ENVELOPE_PATH_COLLISION', file.path);
    }
    seen.add(file.path);
    parts.push(
      Buffer.from([RECORD_KINDS.payload]),
      u32(pathBytes.byteLength),
      u64(file.bytes.byteLength),
      pathBytes,
      file.bytes,
    );
  }
  const contents = [input.manifest, input.provenance, input.sbom].map((value) =>
    jcsBytes(value),
  );
  METADATA_RECORDS.forEach((record, index) => {
    const content = /** @type {Buffer} */ (contents[index]);
    if (content.byteLength > record.maximumBytes) {
      refuse('FROZEN_ENVELOPE_METADATA_LIMIT_EXCEEDED', record.path);
    }
    const pathBytes = Buffer.from(record.path, 'utf8');
    parts.push(
      Buffer.from([record.kind]),
      u32(pathBytes.byteLength),
      u64(content.byteLength),
      pathBytes,
      content,
    );
  });
  const envelope = Buffer.concat(parts);
  if (envelope.byteLength > FROZEN_ENVELOPE_LIMITS.maximumEnvelopeBytes) {
    refuse('FROZEN_ENVELOPE_SIZE_INVALID', String(envelope.byteLength));
  }
  // The encoder's own output must decode: the inventory and every digest
  // equality are proved before a byte is written anywhere.
  decodeFrozenEnvelope(envelope);
  return envelope;
}

/**
 * @typedef {{
 *   recordCount: number,
 *   files: {path: string, bytes: Buffer}[],
 *   manifest: Record<string, unknown>,
 *   provenance: Record<string, unknown>,
 *   sbom: Record<string, unknown>,
 *   manifestBytes: Buffer,
 *   provenanceBytes: Buffer,
 *   sbomBytes: Buffer,
 *   artifactDigest: string,
 *   manifestDigest: string,
 *   provenanceDigest: string,
 *   sbomDigest: string,
 *   frozenEnvelopeByteCount: number,
 *   frozenEnvelopeDigest: string
 * }} DecodedFrozenEnvelope
 */

/**
 * Decode and fully validate one frozen envelope.
 *
 * @param {Buffer} bytes the envelope bytes
 * @returns {DecodedFrozenEnvelope} the payload, the three records and every
 *   digest a consumer binds to
 */
export function decodeFrozenEnvelope(bytes) {
  if (bytes.byteLength > FROZEN_ENVELOPE_LIMITS.maximumEnvelopeBytes) {
    refuse('FROZEN_ENVELOPE_SIZE_INVALID', String(bytes.byteLength));
  }
  const magicLength = FROZEN_ENVELOPE_MAGIC.byteLength;
  if (
    bytes.byteLength < magicLength + 4 ||
    !bytes.subarray(0, magicLength).equals(FROZEN_ENVELOPE_MAGIC)
  ) {
    refuse('FROZEN_ENVELOPE_MAGIC_INVALID');
  }
  const recordCount = bytes.readUInt32BE(magicLength);
  if (
    recordCount < METADATA_RECORDS.length ||
    recordCount > FROZEN_ENVELOPE_LIMITS.maximumRecordCount
  ) {
    refuse('FROZEN_ENVELOPE_COUNT_INVALID', String(recordCount));
  }
  let offset = magicLength + 4;
  if (
    BigInt(recordCount) * BigInt(RECORD_HEADER_BYTES) >
    BigInt(bytes.byteLength - offset)
  ) {
    refuse('FROZEN_ENVELOPE_TRUNCATED');
  }
  const payloadCount = recordCount - METADATA_RECORDS.length;
  /** @type {{kind: number, path: string, content: Buffer}[]} */
  const records = [];
  const seen = new Set();
  /** @type {Buffer | undefined} */
  let priorPath;
  for (let index = 0; index < recordCount; index += 1) {
    if (bytes.byteLength - offset < RECORD_HEADER_BYTES) {
      refuse('FROZEN_ENVELOPE_TRUNCATED');
    }
    const kind = bytes[offset];
    const pathByteCount = bytes.readUInt32BE(offset + 1);
    const contentByteCount = bytes.readBigUInt64BE(offset + 5);
    if (contentByteCount > MAX_SIGNED_INT64) {
      refuse('FROZEN_ENVELOPE_LENGTH_INVALID');
    }
    offset += RECORD_HEADER_BYTES;
    const expected =
      index >= payloadCount
        ? METADATA_RECORDS[index - payloadCount]
        : undefined;
    if (![0x01, 0x02, 0x03, 0x04].includes(/** @type {number} */ (kind))) {
      refuse('FROZEN_ENVELOPE_KIND_INVALID', String(kind));
    }
    if (kind !== (expected?.kind ?? RECORD_KINDS.payload)) {
      refuse('FROZEN_ENVELOPE_RECORD_ORDER_INVALID', `record ${index}`);
    }
    if (
      expected !== undefined &&
      contentByteCount > BigInt(expected.maximumBytes)
    ) {
      refuse('FROZEN_ENVELOPE_METADATA_LIMIT_EXCEEDED', expected.path);
    }
    if (pathByteCount > FROZEN_ENVELOPE_LIMITS.maximumPathBytes) {
      refuse('FROZEN_ENVELOPE_PATH_INVALID', `record ${index}`);
    }
    if (
      BigInt(pathByteCount) + contentByteCount >
      BigInt(bytes.byteLength - offset)
    ) {
      refuse('FROZEN_ENVELOPE_TRUNCATED');
    }
    const pathBytes = bytes.subarray(offset, offset + pathByteCount);
    offset += pathByteCount;
    const content = bytes.subarray(offset, offset + Number(contentByteCount));
    offset += Number(contentByteCount);
    /** @type {string} */
    let path;
    try {
      path = FATAL_UTF8.decode(pathBytes);
    } catch {
      return refuse('FROZEN_ENVELOPE_PATH_UTF8_INVALID', `record ${index}`);
    }
    if (expected !== undefined) {
      if (path !== expected.path) {
        refuse('FROZEN_ENVELOPE_RECORD_ORDER_INVALID', path);
      }
    } else {
      requirePayloadPath(path, pathByteCount);
      if (seen.has(path)) {
        refuse('FROZEN_ENVELOPE_PATH_COLLISION', path);
      }
      seen.add(path);
      if (
        priorPath !== undefined &&
        Buffer.compare(priorPath, pathBytes) >= 0
      ) {
        refuse('FROZEN_ENVELOPE_PATH_ORDER_INVALID', path);
      }
      priorPath = Buffer.from(pathBytes);
    }
    records.push({ kind: /** @type {number} */ (kind), path, content });
  }
  if (offset !== bytes.byteLength) {
    refuse('FROZEN_ENVELOPE_TRAILING_BYTES');
  }

  const payloads = records.slice(0, payloadCount);
  const [manifestRecord, provenanceRecord, sbomRecord] =
    records.slice(payloadCount);
  if (!manifestRecord || !provenanceRecord || !sbomRecord) {
    return refuse('FROZEN_ENVELOPE_COUNT_INVALID');
  }
  const manifest = parseJcsObject(manifestRecord.content, manifestRecord.path);
  const provenance = parseJcsObject(
    provenanceRecord.content,
    provenanceRecord.path,
  );
  const sbom = parseJcsObject(sbomRecord.content, sbomRecord.path);

  if (
    manifest.schemaId !== 'urn:gala:schema:artifact-manifest:2.0.0' ||
    manifest.schemaVersion !== '2.0.0'
  ) {
    refuse('FROZEN_ENVELOPE_MANIFEST_INVALID', 'schemaId/schemaVersion');
  }
  const inventory = manifestInventory(manifest);
  const byteCount = inventory.entries.reduce(
    (total, entry) => total + BigInt(entry.byteLength),
    0n,
  );
  if (
    inventory.entries.length !== payloads.length ||
    manifest.artifactFileCount !== String(payloads.length) ||
    manifest.artifactByteCount !== byteCount.toString()
  ) {
    refuse(
      'FROZEN_ENVELOPE_INVENTORY_MISMATCH',
      `manifest names ${inventory.entries.length} file(s), envelope carries ${payloads.length}`,
    );
  }
  inventory.entries.forEach((entry, index) => {
    const payload = /** @type {{path: string, content: Buffer}} */ (
      payloads[index]
    );
    if (
      entry.path !== payload.path ||
      entry.byteLength !== String(payload.content.byteLength) ||
      entry.sha256 !== taggedSha256(payload.content)
    ) {
      refuse('FROZEN_ENVELOPE_INVENTORY_MISMATCH', entry.path);
    }
  });
  if (manifest.artifactDigest !== inventory.artifactDigest) {
    refuse('FROZEN_ENVELOPE_DIGEST_MISMATCH', 'artifactDigest');
  }
  if (
    !Object.hasOwn(manifest, 'artifactId') ||
    typeof manifest.manifestDigest !== 'string' ||
    !DIGEST_PATTERN.test(manifest.manifestDigest)
  ) {
    refuse('FROZEN_ENVELOPE_MANIFEST_INVALID', 'artifactId/manifestDigest');
  }
  const manifestDigest = manifestDigestOf(manifest);
  if (manifest.manifestDigest !== manifestDigest) {
    refuse('FROZEN_ENVELOPE_DIGEST_MISMATCH', 'manifestDigest');
  }
  const sbomDigest = taggedSha256(sbomRecord.content);
  if (
    provenance.schemaId !== 'urn:gala:metadata:build-provenance:2.0.0' ||
    provenance.schemaVersion !== '2.0.0' ||
    provenance.artifactDigest !== inventory.artifactDigest ||
    provenance.manifestDigest !== manifestDigest
  ) {
    refuse('FROZEN_ENVELOPE_PROVENANCE_INVALID');
  }
  if (provenance.sbomDigest !== sbomDigest) {
    refuse('FROZEN_ENVELOPE_DIGEST_MISMATCH', 'sbomDigest');
  }
  return {
    recordCount,
    files: payloads.map((record) => ({
      path: record.path,
      bytes: Buffer.from(record.content),
    })),
    manifest,
    provenance,
    sbom,
    manifestBytes: Buffer.from(manifestRecord.content),
    provenanceBytes: Buffer.from(provenanceRecord.content),
    sbomBytes: Buffer.from(sbomRecord.content),
    artifactDigest: inventory.artifactDigest,
    manifestDigest,
    // The record bytes are proved compact JCS above, so the profile's digest
    // over the parsed record is the digest over exactly those bytes.
    provenanceDigest: DIGEST_PROFILES.buildProvenance.digest(provenance),
    sbomDigest,
    frozenEnvelopeByteCount: bytes.byteLength,
    frozenEnvelopeDigest: taggedSha256(bytes),
  };
}
