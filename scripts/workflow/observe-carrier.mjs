/**
 * Re-observe one uploaded carrier by its exact artifact ID.
 *
 * DEC-097 section 2.3: a producer hashes and counts locally, accepts only
 * the returned artifact ID and lowercase digest, and re-observes the exact
 * ID, name, digest, size and expiry through the get-artifact-by-ID REST
 * operation before exposing anything as a job output. The local digest
 * check always runs; the REST re-observation runs whenever a token and the
 * repository identity are present, and its absence is reported rather than
 * silently skipped.
 */

import { readFile, stat } from 'node:fs/promises';

import { carrierDigest, parseOptions, requireOption } from './carrier.mjs';
import { runIfMain } from '../run-if-main.mjs';

/**
 * @param {string} name the output name
 * @param {string} value the output value
 * @returns {Promise<void>} resolves once the output is appended
 */
async function emit(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file === undefined) {
    process.stdout.write(`${name}=${value}\n`);
    return;
  }
  const { appendFile } = await import('node:fs/promises');
  await appendFile(file, `${name}=${value}\n`);
}

/**
 * @returns {Promise<void>} resolves once every output has been emitted
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const artifactId = requireOption(options, 'artifact-id');
  const local = requireOption(options, 'local');
  const expectedDigest = options['expected-digest'];

  const bytes = await readFile(local);
  const observedDigest = carrierDigest(bytes);
  const byteCount = (await stat(local)).size;
  if (
    expectedDigest !== undefined &&
    expectedDigest !== '' &&
    expectedDigest.replace(/^sha256:/u, '') !==
      observedDigest.replace(/^sha256:/u, '')
  ) {
    throw new Error(
      `CARRIER_UPLOAD_DIGEST_MISMATCH: the action reported ${expectedDigest} for bytes that digest to ${observedDigest}`,
    );
  }

  const token = process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  if (token === undefined || repository === undefined) {
    throw new Error(
      'CARRIER_REST_REOBSERVATION_UNAVAILABLE: GH_TOKEN and GITHUB_REPOSITORY are required; a carrier is never exposed as a job output on the upload action word alone',
    );
  }
  const response = await fetch(
    `${apiUrl}/repos/${repository}/actions/artifacts/${encodeURIComponent(artifactId)}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      redirect: 'error',
    },
  );
  if (response.status !== 200) {
    throw new Error(
      `CARRIER_REST_REOBSERVATION_FAILED: artifact ${artifactId} returned HTTP ${response.status}`,
    );
  }
  const observed = await response.json();
  if (String(observed.id) !== artifactId) {
    throw new Error('CARRIER_REST_IDENTITY_MISMATCH');
  }
  if (observed.expired === true) {
    throw new Error('CARRIER_EXPIRED: expired carrier bytes are never custody');
  }

  if (typeof observed.expires_at !== 'string' || observed.expires_at === '') {
    throw new Error(
      'CARRIER_REST_EXPIRY_UNKNOWN: the re-observed artifact carries no expires_at; retention cannot be stated',
    );
  }

  await emit('artifact_id', artifactId);
  await emit('artifact_name', String(observed.name));
  await emit('artifact_digest', observedDigest);
  await emit('artifact_byte_count', String(byteCount));
  await emit('artifact_expires_at', String(observed.expires_at));
}

await runIfMain(import.meta.url, main);
