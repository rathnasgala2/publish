/**
 * The build job's two validated records beyond the manifest: the normalized
 * `build-input:2.0.0` the renderer consumed and the verified
 * `theme-contract:2.0.0` the build resolved for the locked theme.
 *
 * DEC-097 section 5 gives every `reproducibleBuildRecord` member one owning
 * equality, and several of those owners are the *validated build input*
 * (repository root digest, base URL and path, the render policy) and the
 * theme's own contract (`stylingContractDigest`). Neither is a member of
 * the artifact manifest, so `publish-action`'s build writes both next to
 * `artifact-manifest.json` and `pack-carrier.mjs` carries them as reserved
 * metadata members of the unfrozen-output carrier. Freeze validates each
 * against its pinned schema root, ties the build input to the manifest by
 * `inputDigest === manifest.buildInputDigest`, and the authorization input
 * quotes the rebuild-record members from them — never from a placeholder.
 *
 * Both members are optional at read time: a build carrier that predates
 * them decodes, and the authorization input then names the members it
 * cannot derive as missing (`AUTHORIZATION_INPUT_INCOMPLETE`), which is the
 * honest answer for a build that did not carry its own facts.
 *
 * @module
 */

import { validateGalaDocument } from '@rathnasgala2/schemas';

/** The carrier member the normalized build input travels at. */
export const BUILD_INPUT_MEMBER = 'metadata/build-input.json';

/** The carrier member the verified theme contract travels at. */
export const THEME_CONTRACT_MEMBER = 'metadata/theme-contract.json';

/** The three reserved metadata members of an unfrozen-output carrier. */
export const UNFROZEN_METADATA_MEMBERS = Object.freeze([
  'metadata/artifact-manifest.json',
  BUILD_INPUT_MEMBER,
  THEME_CONTRACT_MEMBER,
]);

/**
 * Parse one optional JSON carrier member and validate it against a schema
 * root, failing closed by name on a member that is present but not a valid
 * instance.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the carrier files
 * @param {string} member the member path
 * @param {string} schemaId the schema root it must satisfy
 * @returns {Record<string, any> | null} the document, or `null` when absent
 */
function readValidatedMember(files, member, schemaId) {
  const found = files.find((file) => file.path === member);
  if (found === undefined) {
    return null;
  }
  /** @type {unknown} */
  let document;
  try {
    document = JSON.parse(found.bytes.toString('utf8'));
  } catch {
    throw new Error(`FREEZE_BUILD_FACT_INVALID: ${member} is not JSON`);
  }
  const verdict = validateGalaDocument(schemaId, document);
  if (!verdict.valid) {
    throw new Error(
      `FREEZE_BUILD_FACT_INVALID: ${member} is not a ${schemaId} instance — ${JSON.stringify(verdict.diagnostics).slice(0, 2000)}`,
    );
  }
  return /** @type {Record<string, any>} */ (document);
}

/**
 * Read the build's two validated fact records from an unfrozen-output
 * carrier's files, and tie the build input to the manifest it produced.
 *
 * @param {readonly {path: string, bytes: Buffer}[]} files the carrier files
 * @param {Record<string, unknown>} manifest the carrier's validated manifest
 * @returns {{buildInput: Record<string, any> | null, themeContract: Record<string, any> | null}}
 *   the validated records, each `null` when the carrier does not carry it
 */
export function readBuildFacts(files, manifest) {
  const buildInput = readValidatedMember(
    files,
    BUILD_INPUT_MEMBER,
    'urn:gala:schema:build-input:2.0.0',
  );
  if (
    buildInput !== null &&
    buildInput.inputDigest !== manifest.buildInputDigest
  ) {
    throw new Error(
      'FREEZE_BUILD_INPUT_MISMATCH: the carried build input is not the one the manifest was rendered from (inputDigest differs from manifest.buildInputDigest)',
    );
  }
  const themeContract = readValidatedMember(
    files,
    THEME_CONTRACT_MEMBER,
    'urn:gala:schema:theme-contract:2.0.0',
  );
  return { buildInput, themeContract };
}
