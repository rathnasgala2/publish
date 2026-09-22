/**
 * `freeze`, first half: independently recalculate the frozen envelope from
 * the two predecessor carriers.
 *
 * Freeze trusts neither predecessor's filesystem, only their exact artifact
 * digests; it starts in an empty workspace and recomputes rather than
 * copying any digest forward. What it writes is the real DEC-097 section 6
 * `gala-frozen-envelope-v2`: every artifact file as a payload record, then
 * the build's complete `artifact-manifest:2.0.0` (validated against the
 * pinned schema root and matched one-for-one against the payload), the
 * `buildProvenance:2.0.0` record this job is the honest author of
 * (`build-provenance.mjs`) and the SPDX 2.3 SBOM built from the payload
 * bytes and the verified source's lock (`sbom.mjs`), validated against the
 * unmodified official SPDX 2.3 schema. `provenanceDigest` and `sbomDigest`
 * are digests of exactly those two records and nothing else.
 *
 * The artifact digest it records in its summary is the selected adapter's
 * own projection — the adapter the verified source's lock selects, read here
 * and nowhere else — because that is the digest the kernel's duty 1 and the
 * adapter's activation check later compare; the manifest's own
 * `artifactDigest` is the schema's section 8 inventory projection, and the
 * envelope decoder recomputes both.
 *
 * The authorization input for a publish ref is written by the second half,
 * `build-authorization-input.mjs`, once this envelope has been uploaded and
 * re-observed by exact ID: its handoff members (artifact id, name, expiry)
 * exist only then, and DEC-097 section 6 requires the input to be the exact
 * bytes `authorize` sends.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateGalaDocument } from '@rathnasgala2/schemas';

import { findCarrier } from './decode-carrier.mjs';
import { UNFROZEN_METADATA_MEMBERS, readBuildFacts } from './build-facts.mjs';
import {
  carrierDigest,
  decodeCarrier,
  parseOptions,
  requireOption,
} from './carrier.mjs';
import { artifactDigestUnder } from './build-authorization-input.mjs';
import { buildProvenanceRecord } from './build-provenance.mjs';
import {
  decodeFrozenEnvelope,
  encodeFrozenEnvelope,
  manifestDigestOf,
  manifestInventory,
} from './frozen-envelope.mjs';
import { buildSbom, validateSbomBytes } from './sbom.mjs';
import { readLockDocument, readLockFacts } from './verified-source.mjs';
import { jcsBytes } from './frozen-envelope.mjs';
import { runIfMain } from '../run-if-main.mjs';

/** The reserved public-marker coordinate no artifact may carry. */
const MARKER_PATH = '.well-known/gala-generation.json';

/**
 * Where the unfrozen-output carrier carries the build's manifest
 * (`pack-carrier.mjs --manifest`). It is a carrier member, never an
 * artifact file.
 */
export const UNFROZEN_MANIFEST_MEMBER = 'metadata/artifact-manifest.json';

/**
 * `publish-action`'s own output-directory marker, written into the artifact
 * directory after the renderer's inventory scan; it is the one file of the
 * build output that is not artifact inventory and is dropped here by name.
 */
export const BUILD_DIRECTORY_MARKER = '.gala-build-directory';

/**
 * Split one unfrozen-output carrier into the artifact payload and the
 * manifest record, refusing a carrier with no manifest or with a file the
 * manifest does not name.
 *
 * @param {{files: readonly {path: string, bytes: Buffer}[]}} output the decoded carrier
 * @returns {{files: {path: string, bytes: Buffer}[], manifest: Record<string, unknown>}}
 *   the payload files and the parsed, schema-valid manifest
 */
export function splitUnfrozenOutput(output) {
  const manifestMember = output.files.find(
    (file) => file.path === UNFROZEN_MANIFEST_MEMBER,
  );
  if (manifestMember === undefined) {
    throw new Error(
      `FREEZE_MANIFEST_MISSING: the unfrozen-output carrier carries no ${UNFROZEN_MANIFEST_MEMBER}; the build must leave its artifact-manifest.json where pack-carrier.mjs --manifest reads it`,
    );
  }
  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(manifestMember.bytes.toString('utf8'));
  } catch {
    throw new Error(
      `FREEZE_MANIFEST_INVALID: ${UNFROZEN_MANIFEST_MEMBER} is not JSON`,
    );
  }
  const verdict = validateGalaDocument(
    'urn:gala:schema:artifact-manifest:2.0.0',
    manifest,
  );
  if (!verdict.valid) {
    throw new Error(
      `FREEZE_MANIFEST_INVALID: ${UNFROZEN_MANIFEST_MEMBER} is not a urn:gala:schema:artifact-manifest:2.0.0 instance — ${JSON.stringify(verdict.diagnostics).slice(0, 2000)}`,
    );
  }
  // The build's other two fact records (`metadata/build-input.json`,
  // `metadata/theme-contract.json`) are carrier members too, read and
  // validated by `build-facts.mjs` where the authorization input needs them;
  // they are never artifact payload.
  const files = output.files.filter(
    (file) =>
      !UNFROZEN_METADATA_MEMBERS.includes(file.path) &&
      file.path !== BUILD_DIRECTORY_MARKER,
  );
  for (const file of files) {
    if (file.path === MARKER_PATH) {
      throw new Error(
        `FREEZE_RESERVED_COORDINATE_COLLISION: the artifact contains ${MARKER_PATH}, which is reserved for the public generation marker`,
      );
    }
  }
  const named = new Set(
    manifestInventory(
      /** @type {Record<string, unknown>} */ (manifest),
    ).entries.map((entry) => entry.path),
  );
  const unnamed = files
    .filter((file) => !named.has(file.path))
    .map((f) => f.path);
  if (unnamed.length > 0) {
    throw new Error(
      `FREEZE_INVENTORY_MISMATCH: the build output carries ${unnamed.length} file(s) the manifest does not name: ${unnamed.slice(0, 10).join(', ')}`,
    );
  }
  return {
    files: files.map((file) => ({ path: file.path, bytes: file.bytes })),
    manifest: /** @type {Record<string, unknown>} */ (manifest),
  };
}

/**
 * Read one re-observed predecessor handoff from the options.
 *
 * @param {Record<string, string>} options the parsed options
 * @param {'verified-inputs' | 'unfrozen-output'} purpose the carrier purpose
 * @param {string} digest the digest this job was told to expect for it
 * @returns {import('./build-provenance.mjs').CarrierHandoff} the handoff evidence
 */
function handoffFromOptions(options, purpose, digest) {
  return {
    purpose,
    artifactId: requireOption(options, `${purpose}-artifact-id`),
    name: requireOption(options, `${purpose}-name`),
    // The schema's canonical non-negative decimal string
    // (`build-provenance.schema.json` `$defs.nonNegativeInt64`), never a
    // JS number: the option is already exactly that string.
    byteCount: requireOption(options, `${purpose}-byte-count`),
    digest,
    expiresAt: new Date(
      requireOption(options, `${purpose}-expires-at`),
    ).toISOString(),
  };
}

/**
 * Build the complete frozen envelope from the two decoded carriers and the
 * runner's facts. Pure apart from the adapter import the artifact projection
 * needs, so tests drive it without a filesystem.
 *
 * @param {{
 *   inputs: {metadata: Record<string, any>, files: readonly {path: string, bytes: Buffer}[]},
 *   output: {files: readonly {path: string, bytes: Buffer}[]},
 *   runner: Readonly<Record<string, string | undefined>>,
 *   verifiedInputHandoff: import('./build-provenance.mjs').CarrierHandoff,
 *   unfrozenOutputHandoff: import('./build-provenance.mjs').CarrierHandoff
 * }} facts the verified-inputs carrier, the unfrozen-output carrier, the
 *   runner identity and the two re-observed handoffs
 * @returns {Promise<{
 *   bytes: Buffer,
 *   decoded: import('./frozen-envelope.mjs').DecodedFrozenEnvelope,
 *   adapterId: string,
 *   adapterArtifactDigest: string
 * }>} the envelope, its decoded projection and the selected adapter's own
 *   artifact digest
 */
export async function buildFrozenEnvelope(facts) {
  const lock = readLockFacts(facts.inputs.files);
  const lockDocument = readLockDocument(facts.inputs.files);
  const { files, manifest } = splitUnfrozenOutput(facts.output);
  // Validated here so a build carrier whose build input or theme contract
  // is malformed, or whose build input is not the manifest's, fails the
  // freeze by name rather than one job later at the authorization input.
  readBuildFacts(facts.output.files, manifest);
  const inventory = manifestInventory(manifest);
  if (manifest.artifactDigest !== inventory.artifactDigest) {
    throw new Error(
      'FREEZE_MANIFEST_INVALID: the manifest’s artifactDigest is not the DEC-097 section 8 projection of its own inventory',
    );
  }
  if (manifest.manifestDigest !== manifestDigestOf(manifest)) {
    throw new Error(
      'FREEZE_MANIFEST_INVALID: the manifest’s manifestDigest is not the DEC-097 section 8 digest of its own members',
    );
  }
  const adapterArtifactDigest = await artifactDigestUnder(
    lock.adapterPackage,
    files,
  );

  const sbom = buildSbom({ manifest, lock: lockDocument, files });
  const { sbomDigest } = validateSbomBytes(jcsBytes(sbom), {
    manifest,
    lock: lockDocument,
    files,
  });
  const provenance = buildProvenanceRecord({
    runner: facts.runner,
    sourceCommit: facts.inputs.metadata.sourceCommit,
    workflowTriggerCommit: facts.inputs.metadata.workflowTriggerCommit,
    verifiedInputHandoff: facts.verifiedInputHandoff,
    unfrozenOutputHandoff: facts.unfrozenOutputHandoff,
    lockDigest: lock.lockDigest,
    buildInputDigest: manifest.buildInputDigest,
    artifactDigest: inventory.artifactDigest,
    manifestDigest: /** @type {string} */ (manifest.manifestDigest),
    sbomDigest,
  });
  const bytes = encodeFrozenEnvelope({ files, manifest, provenance, sbom });
  return {
    bytes,
    decoded: decodeFrozenEnvelope(bytes),
    adapterId: lock.adapter.adapterId,
    adapterArtifactDigest,
  };
}

/**
 * @returns {Promise<void>} resolves once the envelope has been written
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  const inbox = requireOption(options, 'inbox');
  const refKind = requireOption(options, 'ref-kind');
  const outDir = requireOption(options, 'out-dir');
  const verifiedInputsDigest = requireOption(options, 'verified-inputs-digest');
  const unfrozenOutputDigest = requireOption(options, 'unfrozen-output-digest');

  const inputs = decodeCarrier(
    (await findCarrier(inbox, verifiedInputsDigest)).bytes,
  );
  const output = decodeCarrier(
    (await findCarrier(inbox, unfrozenOutputDigest)).bytes,
  );

  const { bytes, decoded, adapterId, adapterArtifactDigest } =
    await buildFrozenEnvelope({
      inputs,
      output,
      runner: process.env,
      verifiedInputHandoff: handoffFromOptions(
        options,
        'verified-inputs',
        verifiedInputsDigest,
      ),
      unfrozenOutputHandoff: handoffFromOptions(
        options,
        'unfrozen-output',
        unfrozenOutputDigest,
      ),
    });

  const runId = process.env.GITHUB_RUN_ID ?? '0';
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? '1';
  const envelopePath = path.join(
    outDir,
    `gala-r${runId}-a${runAttempt}-frozen-envelope-v2.bin`,
  );
  await writeFile(envelopePath, bytes);
  process.stdout.write(
    [
      `frozen envelope (${adapterId}): ${decoded.files.length} file(s), ${decoded.recordCount} record(s), ${carrierDigest(bytes)}`,
      `  artifactDigest (${adapterId} projection): ${adapterArtifactDigest}`,
      `  manifestDigest: ${decoded.manifestDigest}`,
      `  provenanceDigest: ${decoded.provenanceDigest}`,
      `  sbomDigest: ${decoded.sbomDigest}`,
      '',
    ].join('\n'),
  );

  if (refKind !== 'publish') {
    process.stdout.write(
      'candidate ref: no authorization input is created and no operation or generation is claimed\n',
    );
  }
}

await runIfMain(import.meta.url, main);
