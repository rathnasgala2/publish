/**
 * The `gala-frozen-envelope-v2` codec (DEC-097 section 6).
 *
 * Two things are proved. First, the codec is closed: a corruption of every
 * framing field and record class is refused by name, and an envelope whose
 * manifest, provenance or SBOM does not bind the payload never decodes.
 * Second — and this is what makes the format the contract's rather than
 * this repository's — the schema package's own `validateFrozenEnvelope`
 * accepts every byte string the encoder writes and computes the same four
 * digests the decoder reports. That validator is not an exported entry
 * point (it is the Gala-side semantic validator's internal), so it is
 * loaded here by file path as a test oracle only; nothing in
 * `scripts/workflow` imports it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as pages from '@rathnasgala2/adapter-github-pages';

import {
  DIGEST_PROFILES,
  FROZEN_ENVELOPE_LIMITS,
  FROZEN_ENVELOPE_MAGIC,
  FrozenEnvelopeError,
  METADATA_RECORDS,
  decodeFrozenEnvelope,
  domainSeparatedDigest,
  encodeFrozenEnvelope,
  jcsBytes,
  manifestInventory,
} from '../scripts/workflow/frozen-envelope.mjs';
// @ts-expect-error -- the schema package's internal validator ships no declaration; it is loaded by file path as a test-only oracle
import { validateFrozenEnvelope as oracle } from '../node_modules/@rathnasgala2/schemas/src/internal/frozen-envelope.js';
import {
  fixtureLock,
  frozenEnvelopeFor,
  manifestFor,
} from './fixtures/artifact-manifest.mjs';

/** Files deliberately given out of order, with one non-ASCII path. */
const FILES = Object.freeze([
  { path: 'zeta/page.html', bytes: Buffer.from('<!doctype html><p>z', 'utf8') },
  { path: 'index.html', bytes: Buffer.from('<!doctype html><p>home', 'utf8') },
  { path: 'assets/site.css', bytes: Buffer.from('body{color:#111}', 'utf8') },
  { path: 'assets/é.txt', bytes: Buffer.from('accent', 'utf8') },
  { path: 'empty.txt', bytes: Buffer.alloc(0) },
]);

/**
 * @param {string} code the expected code
 * @returns {(error: unknown) => boolean} an assertion over the thrown error
 */
function refusedWith(code) {
  return (error) => {
    assert.ok(error instanceof FrozenEnvelopeError, String(error));
    assert.equal(error.code, code);
    return true;
  };
}

/**
 * Re-encode one envelope with one record's fields substituted.
 *
 * @param {Buffer} bytes a valid envelope
 * @param {(records: any[]) => void} mutate
 *   the mutation over the decoded raw records
 * @param {number} [count] an explicit record count to write instead
 * @returns {Buffer} the mutated envelope
 */
function reframe(bytes, mutate, count) {
  const magic = FROZEN_ENVELOPE_MAGIC.byteLength;
  const recordCount = bytes.readUInt32BE(magic);
  let offset = magic + 4;
  /** @type {{kind: number, path: Buffer, content: Buffer}[]} */
  const records = [];
  for (let index = 0; index < recordCount; index += 1) {
    const kind = /** @type {number} */ (bytes[offset]);
    const pathLength = bytes.readUInt32BE(offset + 1);
    const contentLength = Number(bytes.readBigUInt64BE(offset + 5));
    offset += 13;
    const path = Buffer.from(bytes.subarray(offset, offset + pathLength));
    offset += pathLength;
    const content = Buffer.from(bytes.subarray(offset, offset + contentLength));
    offset += contentLength;
    records.push({ kind, path, content });
  }
  mutate(records);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(count ?? records.length, 0);
  return Buffer.concat([
    FROZEN_ENVELOPE_MAGIC,
    header,
    ...records.flatMap((record) => {
      const pathLength = Buffer.alloc(4);
      pathLength.writeUInt32BE(record.path.byteLength, 0);
      const contentLength = Buffer.alloc(8);
      contentLength.writeBigUInt64BE(BigInt(record.content.byteLength), 0);
      return [
        Buffer.from([record.kind]),
        pathLength,
        contentLength,
        record.path,
        record.content,
      ];
    }),
  ]);
}

test('the envelope is deterministic, path-ordered by UTF-8 bytes and round-trips every record', () => {
  const first = frozenEnvelopeFor(FILES);
  const second = frozenEnvelopeFor([...FILES].reverse());
  assert.ok(
    first.bytes.equals(second.bytes),
    'input order does not change the bytes',
  );
  assert.ok(
    first.bytes
      .subarray(0, FROZEN_ENVELOPE_MAGIC.byteLength)
      .equals(FROZEN_ENVELOPE_MAGIC),
  );

  const decoded = first.decoded;
  assert.equal(decoded.recordCount, FILES.length + 3);
  assert.deepEqual(
    decoded.files.map((file) => file.path),
    [
      'assets/site.css',
      'assets/é.txt',
      'empty.txt',
      'index.html',
      'zeta/page.html',
    ],
  );
  for (const file of FILES) {
    assert.ok(
      decoded.files
        .find((member) => member.path === file.path)
        ?.bytes.equals(file.bytes),
      `${file.path} round-trips byte for byte`,
    );
  }
  assert.deepEqual(decoded.manifest, first.manifest);
  assert.deepEqual(decoded.provenance, first.provenance);
  assert.deepEqual(decoded.sbom, first.sbom);
  assert.ok(decoded.manifestBytes.equals(jcsBytes(first.manifest)));
  assert.ok(decoded.sbomBytes.equals(jcsBytes(first.sbom)));
  assert.equal(decoded.manifestDigest, first.manifest.manifestDigest);
  assert.equal(decoded.artifactDigest, first.manifest.artifactDigest);
  assert.equal(decoded.provenance.sbomDigest, decoded.sbomDigest);
  assert.equal(decoded.frozenEnvelopeByteCount, first.bytes.byteLength);
  assert.match(decoded.provenanceDigest, /^sha256:[0-9a-f]{64}$/u);
});

test('the schema package’s own validateFrozenEnvelope accepts the encoder’s bytes and computes the same digests', () => {
  for (const lock of [
    fixtureLock('@rathnasgala2/adapter-github-pages'),
    fixtureLock('@rathnasgala2/adapter-do-spaces'),
  ]) {
    const envelope = frozenEnvelopeFor(FILES, { lock });
    const verdict = oracle(envelope.bytes);
    assert.equal(verdict.recordCount, envelope.decoded.recordCount);
    assert.equal(verdict.artifactDigest, envelope.decoded.artifactDigest);
    assert.equal(verdict.manifestDigest, envelope.decoded.manifestDigest);
    assert.equal(verdict.provenanceDigest, envelope.decoded.provenanceDigest);
    assert.equal(verdict.sbomDigest, envelope.decoded.sbomDigest);
    assert.equal(
      verdict.frozenEnvelopeDigest,
      envelope.decoded.frozenEnvelopeDigest,
    );
    assert.equal(
      verdict.frozenEnvelopeByteCount,
      String(envelope.decoded.frozenEnvelopeByteCount),
    );
    assert.deepEqual(verdict.artifactManifest, envelope.manifest);
    assert.deepEqual(verdict.buildProvenance, envelope.provenance);
    assert.deepEqual(verdict.sbom, envelope.sbom);
  }
});

test('the metadata records are in DEC-097’s exact order at their exact reserved paths and kinds', () => {
  const { bytes } = frozenEnvelopeFor(FILES);
  /** @type {[number, string][]} */
  const decodedPaths = [];
  reframe(bytes, (records) => {
    decodedPaths.push(
      ...records.map(
        (record) =>
          /** @type {[number, string]} */ ([
            record.kind,
            record.path.toString('utf8'),
          ]),
      ),
    );
  });
  assert.deepEqual(decodedPaths.slice(FILES.length), [
    [0x02, 'metadata/artifact-manifest.jcs'],
    [0x03, 'metadata/provenance.jcs'],
    [0x04, 'metadata/sbom.spdx.json'],
  ]);
  assert.deepEqual(
    METADATA_RECORDS.map((record) => record.path),
    decodedPaths.slice(FILES.length).map((entry) => entry[1]),
  );
});

test('every framing corruption is refused by name', () => {
  const { bytes } = frozenEnvelopeFor(FILES);
  const cases = /** @type {[string, () => Buffer][]} */ ([
    [
      'FROZEN_ENVELOPE_MAGIC_INVALID',
      () =>
        Buffer.concat([
          Buffer.from('GALA-FROZEN-ENVELOPE-V1\n'),
          bytes.subarray(24),
        ]),
    ],
    ['FROZEN_ENVELOPE_COUNT_INVALID', () => reframe(bytes, () => {}, 2)],
    [
      'FROZEN_ENVELOPE_TRUNCATED',
      () => bytes.subarray(0, bytes.byteLength - 7),
    ],
    [
      'FROZEN_ENVELOPE_TRAILING_BYTES',
      () => Buffer.concat([bytes, Buffer.from([0])]),
    ],
    [
      'FROZEN_ENVELOPE_KIND_INVALID',
      () =>
        reframe(bytes, (records) => {
          records[0].kind = 0x09;
        }),
    ],
    [
      'FROZEN_ENVELOPE_RECORD_ORDER_INVALID',
      () =>
        reframe(bytes, (records) => {
          records[0].kind = 0x02;
        }),
    ],
    [
      'FROZEN_ENVELOPE_RECORD_ORDER_INVALID',
      () =>
        reframe(bytes, (records) => {
          const manifest = records[FILES.length];
          const provenance = records[FILES.length + 1];
          records[FILES.length] = provenance;
          records[FILES.length + 1] = manifest;
        }),
    ],
    [
      'FROZEN_ENVELOPE_PATH_ORDER_INVALID',
      () =>
        reframe(bytes, (records) => {
          const first = records[0];
          records[0] = records[1];
          records[1] = first;
        }),
    ],
    [
      'FROZEN_ENVELOPE_PATH_COLLISION',
      () =>
        reframe(bytes, (records) => {
          records[1].path = Buffer.from(records[0].path);
        }),
    ],
    [
      'FROZEN_ENVELOPE_RESERVED_PATH',
      () =>
        reframe(bytes, (records) => {
          records[0].path = Buffer.from('metadata/artifact-manifest.jcs');
          records[0].kind = 0x01;
        }),
    ],
    [
      'FROZEN_ENVELOPE_PATH_INVALID',
      () =>
        reframe(bytes, (records) => {
          records[0].path = Buffer.from('../escape.html');
        }),
    ],
    [
      'FROZEN_ENVELOPE_PATH_UTF8_INVALID',
      () =>
        reframe(bytes, (records) => {
          records[0].path = Buffer.from([0x61, 0xff, 0x62]);
        }),
    ],
    [
      'FROZEN_ENVELOPE_INVENTORY_MISMATCH',
      () =>
        reframe(bytes, (records) => {
          records[0].content = Buffer.concat([
            records[0].content,
            Buffer.from('!'),
          ]);
        }),
    ],
    [
      'FROZEN_ENVELOPE_INVENTORY_MISMATCH',
      () =>
        reframe(bytes, (records) => {
          records.splice(0, 1);
        }),
    ],
    [
      'FROZEN_ENVELOPE_JSON_INVALID',
      () =>
        reframe(bytes, (records) => {
          records[FILES.length].content = Buffer.from('{not json');
        }),
    ],
    [
      'FROZEN_ENVELOPE_JCS_INVALID',
      () =>
        reframe(bytes, (records) => {
          records[FILES.length + 1].content = Buffer.from(
            JSON.stringify(
              JSON.parse(records[FILES.length + 1].content.toString()),
              null,
              1,
            ),
          );
        }),
    ],
    [
      'FROZEN_ENVELOPE_DIGEST_MISMATCH',
      () =>
        reframe(bytes, (records) => {
          records[FILES.length + 2].content = jcsBytes({
            ...JSON.parse(records[FILES.length + 2].content.toString()),
            name: 'other',
          });
        }),
    ],
    [
      'FROZEN_ENVELOPE_PROVENANCE_INVALID',
      () =>
        reframe(bytes, (records) => {
          records[FILES.length + 1].content = jcsBytes({
            ...JSON.parse(records[FILES.length + 1].content.toString()),
            schemaVersion: '2.0.1',
          });
        }),
    ],
  ]);
  for (const [code, corrupt] of cases) {
    assert.throws(
      () => decodeFrozenEnvelope(corrupt()),
      refusedWith(code),
      code,
    );
  }
});

test('a manifest whose digests are not its own inventory’s never encodes', () => {
  const lock = fixtureLock();
  const manifest = manifestFor(FILES, { lock });
  const envelope = frozenEnvelopeFor(FILES, { lock, manifest });
  assert.throws(
    () =>
      encodeFrozenEnvelope({
        files: FILES,
        manifest: { ...manifest, artifactDigest: `sha256:${'0'.repeat(64)}` },
        provenance: envelope.provenance,
        sbom: envelope.sbom,
      }),
    refusedWith('FROZEN_ENVELOPE_DIGEST_MISMATCH'),
  );
  assert.throws(
    () =>
      encodeFrozenEnvelope({
        files: FILES,
        manifest: { ...manifest, generatedAt: '2026-09-18T00:00:00.000Z' },
        provenance: envelope.provenance,
        sbom: envelope.sbom,
      }),
    refusedWith('FROZEN_ENVELOPE_DIGEST_MISMATCH'),
    'a member change with a stale manifestDigest is refused',
  );
  assert.throws(
    () =>
      encodeFrozenEnvelope({
        files: FILES.slice(1),
        manifest,
        provenance: envelope.provenance,
        sbom: envelope.sbom,
      }),
    refusedWith('FROZEN_ENVELOPE_INVENTORY_MISMATCH'),
  );
  assert.throws(
    () =>
      encodeFrozenEnvelope({
        files: [
          ...FILES,
          { path: 'metadata/sbom.spdx.json', bytes: Buffer.from('x') },
        ],
        manifest,
        provenance: envelope.provenance,
        sbom: envelope.sbom,
      }),
    refusedWith('FROZEN_ENVELOPE_RESERVED_PATH'),
  );
});

test('the adapters’ own artifact projections are distinct from the manifest’s section 8 inventory digest, and both are recomputable from the payload', () => {
  const { decoded } = frozenEnvelopeFor(FILES);
  const adapterDigest = pages.computeArtifactDigest(decoded.files);
  assert.match(adapterDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(adapterDigest, decoded.artifactDigest);
  assert.equal(decoded.manifest.artifactDigest, decoded.artifactDigest);
});

test('the closed caps are the DEC-097 numbers', () => {
  assert.deepEqual(FROZEN_ENVELOPE_LIMITS, {
    maximumRecordCount: 200_003,
    maximumEnvelopeBytes: 1_073_741_824,
    maximumManifestBytes: 268_435_456,
    maximumProvenanceBytes: 16_777_216,
    maximumSbomBytes: 16_777_216,
    maximumPathBytes: 512,
  });
});

/**
 * The computation the codec used before schema 2.8.1 exported its digest
 * profiles: `SHA256(domain || JCS(projection))` under a locally restated
 * domain string. Kept here, and only here, as the reference the exported
 * profiles are proved against.
 *
 * @param {string} domain the terminal-NUL domain
 * @param {unknown} projection the already-projected value
 * @returns {string} the tagged digest the pre-2.8.1 codec produced
 */
function previousLocalDigest(domain, projection) {
  return domainSeparatedDigest(domain, jcsBytes(projection));
}

test('the exported 2.8.1 profiles and the previous local domain-plus-JCS computation agree byte-for-byte on the real records', () => {
  const { decoded, manifest, provenance } = frozenEnvelopeFor(FILES, {
    lock: fixtureLock('@rathnasgala2/adapter-do-spaces'),
  });
  const { entries } = manifestInventory(manifest);
  const manifestProjection = { ...manifest };
  delete manifestProjection.artifactId;
  delete manifestProjection.manifestDigest;
  const cases = /** @type {const} */ ([
    ['artifact', 'GALA-ARTIFACT-V2\0', entries, entries],
    [
      'artifactManifest',
      'GALA-ARTIFACT-MANIFEST-V2\0',
      manifest,
      manifestProjection,
    ],
    ['buildProvenance', 'GALA-BUILD-PROVENANCE-V2\0', provenance, provenance],
  ]);
  for (const [name, domain, value, projection] of cases) {
    const profile = DIGEST_PROFILES[name];
    assert.equal(profile.domain, domain, name);
    assert.equal(
      profile.digest(value),
      previousLocalDigest(domain, projection),
      name,
    );
    assert.equal(
      Buffer.from(profile.preimage(value)).toString('hex'),
      Buffer.concat([
        Buffer.from(domain, 'utf8'),
        jcsBytes(projection),
      ]).toString('hex'),
      `${name}: the preimage bytes are identical, not just the digest`,
    );
  }
  assert.equal(
    decoded.artifactDigest,
    previousLocalDigest('GALA-ARTIFACT-V2\0', entries),
  );
  assert.equal(
    decoded.manifestDigest,
    previousLocalDigest('GALA-ARTIFACT-MANIFEST-V2\0', manifestProjection),
  );
  assert.equal(
    decoded.provenanceDigest,
    previousLocalDigest('GALA-BUILD-PROVENANCE-V2\0', provenance),
  );
});
