/**
 * The exact-ID carrier codec shared by every `publish-v2.yml` job.
 *
 * DEC-097 section 6 forbids any job from relying on another job's
 * filesystem or on a content-sized job output: a job hands its successor
 * exactly one uploaded file, and the successor re-observes that file by
 * artifact ID, rehashes it and revalidates it before decoding a single
 * byte. This module is that one file's format — a deterministic,
 * self-describing archive whose digest is stable for identical inputs, so a
 * rerun that produces the same bytes produces the same carrier identity.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/** The carrier format identity written into every envelope. */
export const CARRIER_FORMAT = 'gala-carrier-v2';

/**
 * Walk one directory into its complete, path-ordered file list.
 *
 * @param {string} root the directory to walk
 * @returns {Promise<{path: string, bytes: Buffer}[]>} the ordered files
 */
export async function walkDirectory(root) {
  /** @type {{path: string, bytes: Buffer}[]} */
  const files = [];
  /**
   * @param {string} relative the directory relative to `root`
   * @returns {Promise<void>} resolves once the subtree is walked
   */
  async function walk(relative) {
    const entries = await readdir(path.join(root, relative), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(next);
      } else if (entry.isFile()) {
        files.push({
          path: next,
          bytes: await readFile(path.join(root, next)),
        });
      } else {
        // `readdir` reports the link itself, so a symlink is never followed
        // here — a build output symlinked at /etc/passwd or at the runner
        // workspace cannot be read into a carrier. It is refused rather
        // than skipped, so a tree that depends on one fails loudly instead
        // of being published with a silently missing member.
        throw new Error(
          `CARRIER_MEMBER_TYPE_REFUSED: ${next} is not a regular file or directory; the carrier admits neither symlinks nor special files`,
        );
      }
    }
  }
  await walk('');
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return files;
}

/**
 * Encode one file set plus its closed metadata as deterministic carrier
 * bytes.
 *
 * @param {{
 *   purpose: string,
 *   metadata: Record<string, unknown>,
 *   files: readonly {path: string, bytes: Buffer}[]
 * }} envelope the carrier contents
 * @returns {Buffer} the carrier bytes
 */
export function encodeCarrier(envelope) {
  const manifest = {
    format: CARRIER_FORMAT,
    purpose: envelope.purpose,
    metadata: envelope.metadata,
    files: envelope.files.map((file) => ({
      path: file.path,
      byteLength: file.bytes.byteLength,
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
    })),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const header = Buffer.alloc(8);
  header.write(CARRIER_FORMAT.slice(0, 4), 0, 4, 'ascii');
  header.writeUInt32BE(manifestBytes.byteLength, 4);
  const payload = Buffer.concat([
    header,
    manifestBytes,
    ...envelope.files.map((file) => file.bytes),
  ]);
  const gzipped = gzipSync(payload, { level: 9 });
  gzipped.writeUInt32LE(0, 4);
  gzipped.writeUInt8(0xff, 9);
  return gzipped;
}

/**
 * Decode carrier bytes, verifying every per-file digest on the way out.
 *
 * @param {Buffer} carrier the carrier bytes
 * @returns {{purpose: string, metadata: Record<string, unknown>, files: {path: string, bytes: Buffer}[]}}
 *   the decoded envelope
 */
export function decodeCarrier(carrier) {
  const payload = gunzipSync(carrier);
  if (payload.subarray(0, 4).toString('ascii') !== CARRIER_FORMAT.slice(0, 4)) {
    throw new Error('CARRIER_FORMAT_UNRECOGNISED');
  }
  const manifestLength = payload.readUInt32BE(4);
  const manifest = JSON.parse(
    payload.subarray(8, 8 + manifestLength).toString('utf8'),
  );
  /** @type {{path: string, bytes: Buffer}[]} */
  const files = [];
  let offset = 8 + manifestLength;
  for (const entry of manifest.files) {
    const bytes = Buffer.from(
      payload.subarray(offset, offset + entry.byteLength),
    );
    offset += entry.byteLength;
    const observed = createHash('sha256').update(bytes).digest('hex');
    if (observed !== entry.sha256) {
      throw new Error(
        `CARRIER_MEMBER_DIGEST_MISMATCH: ${entry.path} digests to ${observed}, not ${entry.sha256}`,
      );
    }
    files.push({ path: entry.path, bytes });
  }
  return { purpose: manifest.purpose, metadata: manifest.metadata, files };
}

/**
 * Compute a carrier file's tagged digest.
 *
 * @param {Buffer} bytes the carrier bytes
 * @returns {string} `sha256:<64 lowercase hex characters>`
 */
export function carrierDigest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Write a decoded carrier's files back out under one directory.
 *
 * @param {string} root the destination directory
 * @param {readonly {path: string, bytes: Buffer}[]} files the files
 * @returns {Promise<void>} resolves once every file is written
 */
export async function materialize(root, files) {
  for (const file of files) {
    if (file.path.startsWith('/') || file.path.split('/').includes('..')) {
      throw new Error(`CARRIER_MEMBER_PATH_REFUSED: ${file.path}`);
    }
    const target = path.join(root, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
}

/**
 * Parse `--name value` arguments into a plain record.
 *
 * @param {readonly string[]} argv the raw arguments
 * @returns {Record<string, string>} the parsed options
 */
export function parseOptions(argv) {
  /** @type {Record<string, string>} */
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (name === undefined || !name.startsWith('--')) {
      throw new Error(`WORKFLOW_ARGUMENT_UNKNOWN: ${String(name)}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`WORKFLOW_ARGUMENT_VALUE_MISSING: ${name}`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

/**
 * Read one required option.
 *
 * @param {Record<string, string>} options the parsed options
 * @param {string} name the option name
 * @returns {string} the option value
 */
export function requireOption(options, name) {
  const value = options[name];
  if (value === undefined) {
    throw new Error(`WORKFLOW_ARGUMENT_REQUIRED: --${name}`);
  }
  return value;
}
