/**
 * `attest`: extract one exact metadata record from the frozen envelope.
 *
 * DEC-097 section 6 has the attestation job download the frozen envelope,
 * revalidate its internal build-provenance record and hand the *exact*
 * SBOM record bytes to the SBOM attestation, with no reserialization and
 * no generated alternative. This script is that extraction: it re-observes
 * the envelope by digest, fully decodes it (which recomputes every
 * inventory and digest equality), and writes the requested record's bytes
 * unchanged. Nothing else in the attest job reads the envelope.
 */

import { writeFile } from 'node:fs/promises';

import { findCarrier } from './decode-carrier.mjs';
import { parseOptions, requireOption } from './carrier.mjs';
import { decodeFrozenEnvelope } from './frozen-envelope.mjs';
import { runIfMain } from '../run-if-main.mjs';

/** The extractable records, by option value. */
const RECORDS = Object.freeze({
  manifest: 'manifestBytes',
  provenance: 'provenanceBytes',
  sbom: 'sbomBytes',
});

/**
 * @returns {Promise<void>} resolves once the record has been written
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const inbox = requireOption(options, 'inbox');
  const record = requireOption(options, 'record');
  const out = requireOption(options, 'out');
  const member = RECORDS[/** @type {keyof typeof RECORDS} */ (record)];
  if (member === undefined) {
    throw new Error(
      `WORKFLOW_ARGUMENT_UNKNOWN: --record must be one of ${Object.keys(RECORDS).join(', ')}`,
    );
  }
  const envelope = decodeFrozenEnvelope(
    (await findCarrier(inbox, requireOption(options, 'expected-digest'))).bytes,
  );
  const bytes = envelope[member];
  await writeFile(out, bytes);
  process.stdout.write(
    `${record} record: ${bytes.byteLength} byte(s), provenanceDigest ${envelope.provenanceDigest}, sbomDigest ${envelope.sbomDigest}\n`,
  );
}

await runIfMain(import.meta.url, main);
