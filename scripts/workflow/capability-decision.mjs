/**
 * The DEC-097 section 8 `capabilityDecision` record as the API constructs it
 * at intent issuance (API-INTENT-DERIVATION-1, LOCAL-62), so a deploy job can
 * recompute it and prove the intent's `capabilityDecisionDigest` is the
 * digest of the decision Gala actually took over this artifact, this
 * destination and this adapter — before anything is staged (line 8419).
 *
 * **Two phases (LOCAL-62/LOCAL-63).** The record DEC-097 lines 8378-8419
 * closes has members two different moments own. At issuance the API holds
 * the artifact and manifest identities, its own retained destination, the
 * adapter identity, its admission row for that adapter (the provider limits
 * it evaluates every intent against, and the digests of its own canonical
 * admission text) and the exact JCS marker it retains; it does not hold the
 * Pages carrier the deploy job builds from the frozen payloads *after*
 * authorization, nor the manifest entries an exact path or stage-plan
 * evaluation needs. So the intent's `capabilityDecisionDigest` is over the
 * **issuance-phase** record: every member except
 * `pagesActionsArtifactByteCount`/`pagesActionsArtifactDigest` (absent) and
 * with the four `maximum*` members carrying the admitted bounds. The deploy
 * job recomputes exactly that record and compares its digest; the
 * **deploy-phase** facts (the carrier's byte count and digest, the exact
 * evaluation over the payload) are recorded in the kernel journal as
 * evidence, never used to refuse.
 *
 * **The two phase sets are read from the pinned schema, not hard-coded.**
 * `@rathnasgala2/schemas` 2.10.0 annotates every member of the closed
 * `capabilityDecision` record with `x-gala-decision-phase` (`issuance` or
 * `deploy`); `ISSUANCE_PHASE_MEMBERS`/`DEPLOY_PHASE_MEMBERS` below are
 * derived from that annotation at module load, in the record's own
 * declaration order (`profile` first, `decisionDigest` last), rather than
 * restated by hand — so the two sets can never silently drift from the
 * pinned contract. `test/capability-decision.test.mjs` additionally proves
 * a hard-coded reference copy of both sets still agrees with the derived
 * ones, so a schema repin that quietly reclassifies a member is a visible
 * test failure, not a silent behavior change.
 *
 * **The admission row is the API's.** `ADMISSION_ROWS` mirrors releases 0045
 * and 0046 (`gala_core.adapter_capability`) row for row, keyed by
 * `(adapterId, adapterVersion)` exactly as the API selects it (LOCAL-64): the
 * `adapterVersion` is the adapter's published *package* version (`0.1.0`,
 * the single-source rule of PUBLISH-S4-6a), never the protocol version; the
 * 0045 rows at `2.0.0` are retained as superseded and admit nothing. The
 * bounds are the numbers the three adapters declared at publish `188cb27`,
 * and the two adapter-scoped digests (`capabilityDigest`,
 * `credentialEgressProfileDigest`/`pagesOidcOriginCatalogDigest`) are
 * SHA-256 over the row's own canonical admission text by the API's
 * convention (`gala-adapter-capability-admission-v2;adapter=<id>@<ver>;
 * transport=…;maximum…`, plus `;profile=credential-egress` and
 * `;profile=pages-oidc-origin-catalog`). They are recomputed here from that
 * text, and the test pins them to the seeded literals of both releases, so a
 * change on either side is a visible drift, not a silent divergence, and
 * admitting a new package version is one data row. This is a mirror of
 * API-owned facts the intent does not carry; the honest end state is an
 * intent (or a read) that carries the admission row, recorded as a
 * follow-up.
 *
 * **The three Spaces control-plane catalog digests are NOT admission
 * constants (LOCAL-63(g), review of PUBLISH-S4-7).**
 * `spacesControlPlaneRequestCatalogDigest`,
 * `spacesControlPlaneResponseCatalogDigest` and
 * `spacesControlPlaneTlsProfileDigest` are per-**destination** facts: the
 * API stores them on the `publication_destination` row (computed at PUT
 * time from that destination's own origins, per
 * `@rathnasgala2/adapter-do-spaces`'s `buildControlPlaneRequestCatalog`,
 * which closes over `origins`) and puts them in the capability decision at
 * issuance — never mirrored here as a row keyed by `(adapterId,
 * adapterVersion)`. `ADMISSION_ROWS`/`admissionRow` therefore carry none of
 * the three; `issuancePhaseDecision` requires its caller to supply them (as
 * it already does for `spacesWebsiteConfigurationDigest`/
 * `spacesControlPlaneBindingDigest`), computed from the intent's own
 * destination with `recomputeSpacesClosedRecords` below, which calls the
 * adapter's own `spacesControlPlaneCatalogDigests(origins)` builder — the
 * same computation `describeCapabilities` uses, never a hand-restated
 * mirror.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ACTIVE_DIGEST_PROFILES } from '@rathnasgala2/schemas/digest-profiles';

import { canonicalJson } from './workload-identity.mjs';

/**
 * Read the pinned schema package's `capabilityDecision` property map once,
 * at module load, and partition its members by their required
 * `x-gala-decision-phase` annotation. Fails closed: a member with no
 * annotation, or one carrying a value other than `issuance`/`deploy`, is a
 * pinned-schema regression this module refuses to paper over.
 *
 * @returns {{issuance: readonly string[], deploy: readonly string[]}} the
 *   two member-name sets, in the record's own declaration order
 */
function readDecisionPhasesFromPinnedSchema() {
  const schemaPath = fileURLToPath(
    import.meta
      .resolve('@rathnasgala2/schemas/schemas/adapter-capability.schema.json'),
  );
  const root = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const properties = root.$defs?.capabilityDecision?.properties;
  if (properties === undefined || typeof properties !== 'object') {
    throw new Error(
      'CAPABILITY_DECISION_SCHEMA_SHAPE_UNKNOWN: the pinned schema package has no $defs.capabilityDecision.properties',
    );
  }
  /** @type {string[]} */
  const issuance = [];
  /** @type {string[]} */
  const deploy = [];
  for (const [member, definition] of Object.entries(properties)) {
    const phase = /** @type {any} */ (definition)['x-gala-decision-phase'];
    if (phase === 'issuance') {
      issuance.push(member);
    } else if (phase === 'deploy') {
      deploy.push(member);
    } else {
      throw new Error(
        `CAPABILITY_DECISION_PHASE_UNANNOTATED: capabilityDecision.${member} carries no recognized x-gala-decision-phase ("issuance" | "deploy") in the pinned schema package`,
      );
    }
  }
  return { issuance: Object.freeze(issuance), deploy: Object.freeze(deploy) };
}

/** The closed record profile (DEC-097 line 8378). */
export const CAPABILITY_DECISION_PROFILE = 'gala-capability-decision-v2';

/** The reserved public marker coordinate every deployment adds (DEC-097 section 7). */
export const GENERATION_MARKER_PATH = '.well-known/gala-generation.json';

/**
 * @typedef {{
 *   adapterId: string,
 *   adapterVersion: string,
 *   transport: 'filesystem' | 'http',
 *   supersededAt: string | null,
 *   maximumFiles: string,
 *   maximumFileBytes: string,
 *   maximumArtifactBytes: string,
 *   maximumPathBytes: string,
 *   maximumStageRequestCount: string,
 *   maximumStageRequestBytes: string,
 *   maximumStageResponseBytes: string,
 *   maximumStageResponseWireBytes: string
 * }} SeededAdmissionRow one `gala_core.adapter_capability` row as seeded
 */

/** The eight provider limits each adapter declared at publish `188cb27`. */
const DECLARED_LIMITS = Object.freeze({
  'local-directory': Object.freeze({
    transport: /** @type {const} */ ('filesystem'),
    maximumFiles: '1000000',
    maximumFileBytes: '1073741824',
    maximumArtifactBytes: '10737418240',
    maximumPathBytes: '400',
    maximumStageRequestCount: '1000001',
    maximumStageRequestBytes: '10737418240',
    maximumStageResponseBytes: '1073741824',
    maximumStageResponseWireBytes: '1073741824',
  }),
  'github-pages': Object.freeze({
    transport: /** @type {const} */ ('http'),
    maximumFiles: '100000',
    maximumFileBytes: '1073741824',
    maximumArtifactBytes: '1073741824',
    maximumPathBytes: '255',
    maximumStageRequestCount: '128',
    maximumStageRequestBytes: '1073741824',
    maximumStageResponseBytes: '1048576',
    maximumStageResponseWireBytes: '1048576',
  }),
  'do-spaces': Object.freeze({
    transport: /** @type {const} */ ('http'),
    maximumFiles: '100000',
    maximumFileBytes: '5368709120',
    maximumArtifactBytes: '10737418240',
    maximumPathBytes: '512',
    maximumStageRequestCount: '1000000',
    maximumStageRequestBytes: '10737418240',
    maximumStageResponseBytes: '1073741824',
    maximumStageResponseWireBytes: '1073741824',
  }),
});

/**
 * The API's admission rows (`gala_core.adapter_capability`), one per
 * `(adapterId, adapterVersion)`: release 0045 seeded the three adapters at
 * `2.0.0` (the protocol version, a mistake LOCAL-64 corrects), release 0046
 * superseded those and admitted the three at their published package
 * version `0.1.0`. A row with a `supersededAt` admits nothing. Digests are
 * derived, see {@link admissionRow}.
 *
 * @type {readonly SeededAdmissionRow[]}
 */
export const ADMISSION_ROWS = Object.freeze(
  /** @type {const} */ ([
    ['local-directory', '2.0.0', '2026-09-18T12:00:00.000Z'],
    ['github-pages', '2.0.0', '2026-09-18T12:00:00.000Z'],
    ['do-spaces', '2.0.0', '2026-09-18T12:00:00.000Z'],
    ['local-directory', '0.1.0', null],
    ['github-pages', '0.1.0', null],
    ['do-spaces', '0.1.0', null],
  ]).map(([adapterId, adapterVersion, supersededAt]) =>
    Object.freeze({
      adapterId,
      adapterVersion,
      supersededAt,
      ...DECLARED_LIMITS[adapterId],
    }),
  ),
);

/** The eight limit members, in the canonical admission text's order. */
const LIMIT_MEMBERS = Object.freeze([
  'maximumFiles',
  'maximumFileBytes',
  'maximumArtifactBytes',
  'maximumPathBytes',
  'maximumStageRequestCount',
  'maximumStageRequestBytes',
  'maximumStageResponseBytes',
  'maximumStageResponseWireBytes',
]);

const DECISION_PHASES = readDecisionPhasesFromPinnedSchema();

/**
 * The record members whose values the API holds at issuance and digests
 * into `capabilityDecisionDigest` (LOCAL-62 phase one), read from the
 * pinned schema's `x-gala-decision-phase` annotations rather than
 * hard-coded (LOCAL-63 item 1).
 */
export const ISSUANCE_PHASE_MEMBERS = DECISION_PHASES.issuance;

/**
 * The record members only the deploy job can state (LOCAL-62 phase two):
 * facts about the Pages carrier it builds after authorization. They are
 * journal evidence, never a reason to refuse. Read from the pinned schema's
 * `x-gala-decision-phase` annotations rather than hard-coded.
 */
export const DEPLOY_PHASE_MEMBERS = DECISION_PHASES.deploy;

/**
 * @param {string} text the text to digest
 * @returns {string} the tagged digest
 */
function taggedSha256(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * The API's canonical admission text for one adapter row.
 *
 * @param {string} adapterId the adapter
 * @param {Readonly<Record<string, string | null>>} row the seeded row
 * @returns {string} the canonical text the row's digests are taken over
 */
export function admissionCanonicalText(adapterId, row) {
  return [
    `gala-adapter-capability-admission-v2;adapter=${adapterId}@${row.adapterVersion}`,
    `transport=${row.transport}`,
    ...LIMIT_MEMBERS.map((member) => `${member}=${String(row[member])}`),
  ].join(';');
}

/**
 * @typedef {{
 *   adapterId: string,
 *   adapterVersion: string,
 *   capabilityDigest: string,
 *   credentialEgressProfileDigest?: string,
 *   pagesOidcOriginCatalogDigest?: string,
 *   maximumFiles: string,
 *   maximumFileBytes: string,
 *   maximumArtifactBytes: string,
 *   maximumPathBytes: string,
 *   maximumStageRequestCount: string,
 *   maximumStageRequestBytes: string,
 *   maximumStageResponseBytes: string,
 *   maximumStageResponseWireBytes: string
 * }} AdmissionRow the API's admitted row for one adapter package version.
 *   Carries no Spaces control-plane catalog digest: those are per-destination
 *   facts (LOCAL-63(g)), never part of this per-adapter row
 */

/**
 * The API's complete admitted row for one adapter at one published package
 * version, digests included — selected exactly as the API selects it
 * (LOCAL-64: `(adapter_id, adapter_version)` among the unsuperseded rows).
 * A version with no admitted row, superseded or never admitted, is what the
 * API refuses with `422 VALIDATION_FAILED` at `/adapter/adapterVersion`.
 *
 * @param {string} adapterId the adapter
 * @param {string} adapterVersion the adapter's published package version
 * @returns {AdmissionRow} the admitted row
 */
export function admissionRow(adapterId, adapterVersion) {
  const row = ADMISSION_ROWS.find(
    (candidate) =>
      candidate.adapterId === adapterId &&
      candidate.adapterVersion === adapterVersion &&
      candidate.supersededAt === null,
  );
  if (row === undefined) {
    throw new Error(
      `CAPABILITY_ADMISSION_UNKNOWN: ${adapterId}@${adapterVersion} has no admitted row (/adapter/adapterVersion; LOCAL-64)`,
    );
  }
  const canonical = admissionCanonicalText(adapterId, row);
  const prefix = `gala-adapter-capability-admission-v2;adapter=${adapterId}@${row.adapterVersion}`;
  return {
    adapterId,
    adapterVersion: row.adapterVersion,
    capabilityDigest: taggedSha256(canonical),
    ...(row.transport === 'http'
      ? {
          credentialEgressProfileDigest: taggedSha256(
            `${prefix};profile=credential-egress`,
          ),
        }
      : {}),
    ...(adapterId === 'github-pages'
      ? {
          pagesOidcOriginCatalogDigest: taggedSha256(
            `${prefix};profile=pages-oidc-origin-catalog`,
          ),
        }
      : {}),
    // DEC-097 lines 8443-8444's request/response catalog and TLS profile
    // digests are per-destination facts (LOCAL-63(g)), never part of this
    // per-adapter admission row: see recomputeSpacesClosedRecords below,
    // which computes them from the intent's own destination via
    // `@rathnasgala2/adapter-do-spaces`'s `spacesControlPlaneCatalogDigests`.
    maximumFiles: row.maximumFiles,
    maximumFileBytes: row.maximumFileBytes,
    maximumArtifactBytes: row.maximumArtifactBytes,
    maximumPathBytes: row.maximumPathBytes,
    maximumStageRequestCount: row.maximumStageRequestCount,
    maximumStageRequestBytes: row.maximumStageRequestBytes,
    maximumStageResponseBytes: row.maximumStageResponseBytes,
    maximumStageResponseWireBytes: row.maximumStageResponseWireBytes,
  };
}

/**
 * DEC-097 line 5978: the deterministic Pages carrier basename and Actions
 * artifact name.
 *
 * @param {string} runId the run id
 * @param {number} runAttempt the run attempt
 * @returns {string} the name
 */
export function pagesActionsArtifactName(runId, runAttempt) {
  return `gala-pages-r${runId}-a${runAttempt}`;
}

/**
 * The exact JCS marker the API retains and the deploy job stages: the five
 * closed members of the intent's `marker`, canonical.
 *
 * @param {Record<string, unknown>} marker the intent's marker
 * @returns {string} the canonical marker text
 */
export function markerJcs(marker) {
  return canonicalJson({
    artifactDigest: marker.artifactDigest,
    artifactId: marker.artifactId,
    generationId: marker.generationId,
    schemaId: marker.schemaId,
    schemaVersion: marker.schemaVersion,
  });
}

/**
 * Build the issuance-phase record (without `decisionDigest`) exactly as the
 * API does from the members it holds at issuance.
 *
 * @param {{
 *   artifactId: string,
 *   artifactDigest: string,
 *   manifestDigest: string,
 *   destination: Record<string, unknown>,
 *   adapter: {adapterId: string, adapterVersion: string, adapterDigest: string},
 *   artifactFileCount: number | string,
 *   artifactByteCount: number | string,
 *   marker: Record<string, unknown>,
 *   pagesBuildVersion?: string,
 *   spacesStagePrefix?: string,
 *   spacesWebsiteConfigurationDigest?: string,
 *   spacesControlPlaneBindingDigest?: string,
 *   spacesControlPlaneRequestCatalogDigest?: string,
 *   spacesControlPlaneResponseCatalogDigest?: string,
 *   spacesControlPlaneTlsProfileDigest?: string,
 *   runId: string,
 *   runAttempt: number,
 *   admission?: AdmissionRow
 * }} facts the issuance-phase members; `admission` defaults to the API's
 *   admitted row for the adapter at its version. `spacesWebsiteConfigurationDigest`
 *   and `spacesControlPlaneBindingDigest` are the two DEC-097 per-destination
 *   closed-record digests (`@rathnasgala2/adapter-do-spaces`'s
 *   `spacesWebsiteConfiguration`/`spacesControlPlaneBinding` builders,
 *   DEC-097 lines 8444-8449); `spacesControlPlaneRequestCatalogDigest`,
 *   `spacesControlPlaneResponseCatalogDigest` and
 *   `spacesControlPlaneTlsProfileDigest` are the three per-destination
 *   control-plane catalog digests (LOCAL-63(g),
 *   `spacesControlPlaneCatalogDigests`); all five are required when
 *   `adapter.adapterId` is `do-spaces`, since none is derivable from the
 *   admission row (a per-adapter-version fact)
 * @returns {{record: Record<string, unknown>, decisionDigest: string, markerByteLength: number, admission: AdmissionRow}}
 *   the record, its `GALA-CAPABILITY-DECISION-V2` digest, the marker length
 *   and the admission row used
 */
export function issuancePhaseDecision(facts) {
  const admission =
    facts.admission ??
    admissionRow(facts.adapter.adapterId, facts.adapter.adapterVersion);
  const markerByteLength = Buffer.byteLength(markerJcs(facts.marker), 'utf8');
  const artifactFileCount = Number(facts.artifactFileCount);
  const artifactByteCount = Number(facts.artifactByteCount);
  /** @type {Record<string, unknown>} */
  const record = {
    profile: CAPABILITY_DECISION_PROFILE,
    artifactId: facts.artifactId,
    artifactDigest: facts.artifactDigest,
    manifestDigest: facts.manifestDigest,
    destination: facts.destination,
    adapter: {
      adapterId: facts.adapter.adapterId,
      adapterVersion: facts.adapter.adapterVersion,
      adapterDigest: facts.adapter.adapterDigest,
    },
    capabilityDigest: admission.capabilityDigest,
    ...(admission.credentialEgressProfileDigest === undefined
      ? {}
      : {
          credentialEgressProfileDigest:
            admission.credentialEgressProfileDigest,
        }),
    ...(admission.pagesOidcOriginCatalogDigest === undefined
      ? {}
      : {
          pagesOidcOriginCatalogDigest: admission.pagesOidcOriginCatalogDigest,
        }),
    artifactFileCount: String(artifactFileCount),
    deploymentObjectCount: String(artifactFileCount + 1),
    artifactByteCount: String(artifactByteCount),
    markerByteLength: String(markerByteLength),
    deploymentByteCount: String(artifactByteCount + markerByteLength),
    maximumFinalPathByteLength: admission.maximumPathBytes,
    maximumStageRequestCount: admission.maximumStageRequestCount,
    maximumStageRequestBytes: admission.maximumStageRequestBytes,
    maximumStageResponseBytes: admission.maximumStageResponseBytes,
    maximumStageResponseWireBytes: admission.maximumStageResponseWireBytes,
  };
  if (facts.adapter.adapterId === 'github-pages') {
    record.pagesActionsArtifactName = pagesActionsArtifactName(
      facts.runId,
      facts.runAttempt,
    );
    if (facts.pagesBuildVersion !== undefined) {
      record.pagesBuildVersion = facts.pagesBuildVersion;
    }
  }
  if (facts.adapter.adapterId === 'do-spaces') {
    if (facts.spacesStagePrefix !== undefined) {
      record.spacesStagePrefix = facts.spacesStagePrefix;
    }
    if (
      facts.spacesWebsiteConfigurationDigest === undefined ||
      facts.spacesControlPlaneBindingDigest === undefined
    ) {
      throw new Error(
        'CAPABILITY_DECISION_SPACES_DIGEST_MISSING: a do-spaces issuance-phase decision requires spacesWebsiteConfigurationDigest and spacesControlPlaneBindingDigest (DEC-097 lines 8444-8449); build them with @rathnasgala2/adapter-do-spaces before calling issuancePhaseDecision',
      );
    }
    record.spacesWebsiteConfigurationDigest =
      facts.spacesWebsiteConfigurationDigest;
    record.spacesControlPlaneBindingDigest =
      facts.spacesControlPlaneBindingDigest;
    // LOCAL-63(g): the three control-plane catalog digests are per-
    // destination facts, never part of the per-adapter admission row — the
    // caller must supply them (recomputed from the intent's own destination
    // with @rathnasgala2/adapter-do-spaces's spacesControlPlaneCatalogDigests,
    // see recomputeSpacesClosedRecords below), exactly like the two DEC-097
    // closed-record digests just above.
    for (const member of /** @type {const} */ ([
      'spacesControlPlaneRequestCatalogDigest',
      'spacesControlPlaneResponseCatalogDigest',
      'spacesControlPlaneTlsProfileDigest',
    ])) {
      if (facts[member] === undefined) {
        throw new Error(
          `CAPABILITY_DECISION_SPACES_DIGEST_MISSING: a do-spaces issuance-phase decision requires ${member} (LOCAL-63(g); it is a per-destination fact, never part of the admission row); build it with @rathnasgala2/adapter-do-spaces's spacesControlPlaneCatalogDigests before calling issuancePhaseDecision`,
        );
      }
      record[member] = facts[member];
    }
  }
  const profile =
    /** @type {Record<string, {digest: (value: unknown) => string} | undefined>} */ (
      /** @type {unknown} */ (ACTIVE_DIGEST_PROFILES)
    ).capabilityDecision;
  if (profile === undefined) {
    throw new Error(
      'CAPABILITY_DECISION_PROFILE_MISSING: the schema package exports no capabilityDecision profile',
    );
  }
  return {
    record,
    decisionDigest: profile.digest(record),
    markerByteLength,
    admission,
  };
}

/**
 * Recompute DEC-097's two per-destination Spaces closed records —
 * `spacesWebsiteConfiguration` and `spacesControlPlaneBinding` — plus the
 * three per-destination Spaces control-plane catalog digests (LOCAL-63(g):
 * request catalog, response catalog, TLS profile), from an authorized
 * do-spaces intent, using exactly the sources DEC-097 8444-8449 (and, for
 * the catalog digests, the destination's own derived origins) say determine
 * them: the retained `destination.providerBinding` (`region`,
 * `servedBucket`, `stagingBucket`, the three coordinates DEC-097 keeps on
 * the wire) and the retained `rebuildRecord.basePath` (a
 * workflow-verifiable fact, never an API derivation). This is the single
 * shared implementation `verify-spaces-configuration.mjs` and `deploy.mjs`
 * both call, so the two jobs can never independently drift from each other
 * on what "recompute the records" means, and neither ever mirrors the three
 * catalog digests as a per-adapter admission constant.
 *
 * @param {Record<string, any>} intent the authorized deployment intent
 *   (`intent.adapter.adapterId === 'do-spaces'`)
 * @returns {Promise<{
 *   spacesWebsiteConfigurationDigest: string,
 *   spacesControlPlaneBindingDigest: string,
 *   spacesControlPlaneRequestCatalogDigest: string,
 *   spacesControlPlaneResponseCatalogDigest: string,
 *   spacesControlPlaneTlsProfileDigest: string,
 *   websiteConfiguration: Readonly<Record<string, unknown>>,
 *   controlPlaneBinding: Readonly<Record<string, unknown>>
 * }>} the recomputed records and their digests
 */
export async function recomputeSpacesClosedRecords(intent) {
  const destination = /** @type {Record<string, any>} */ (intent.destination);
  const providerBinding = destination?.providerBinding;
  if (typeof providerBinding !== 'object' || providerBinding === null) {
    throw new Error(
      'CAPABILITY_DECISION_SPACES_PROVIDER_BINDING_MISSING: the intent carries no destination.providerBinding to recompute the Spaces records from',
    );
  }
  const basePath = intent.rebuildRecord?.basePath;
  if (typeof basePath !== 'string') {
    throw new Error(
      'CAPABILITY_DECISION_SPACES_BASE_PATH_MISSING: the intent carries no rebuildRecord.basePath to recompute spacesWebsiteConfiguration.errorDocumentKey from',
    );
  }
  const {
    deriveOrigins,
    spacesControlPlaneBinding,
    spacesControlPlaneCatalogDigests,
    spacesWebsiteConfiguration,
  } = /** @type {any} */ (await import('@rathnasgala2/adapter-do-spaces'));
  const origins = deriveOrigins({
    region: String(providerBinding.region),
    servedBucket: String(providerBinding.servedBucket),
    stagingBucket: String(providerBinding.stagingBucket),
  });
  const websiteConfiguration = spacesWebsiteConfiguration({ basePath });
  const controlPlaneBinding = spacesControlPlaneBinding({
    servedBucket: origins.servedBucket,
    stagingBucket: origins.stagingBucket,
    region: origins.region,
    websiteOrigin: origins.publicOrigin,
    websiteConfigurationDigest: websiteConfiguration.configurationDigest,
  });
  const catalogDigests = spacesControlPlaneCatalogDigests(origins);
  return {
    spacesWebsiteConfigurationDigest: websiteConfiguration.configurationDigest,
    spacesControlPlaneBindingDigest: controlPlaneBinding.bindingDigest,
    spacesControlPlaneRequestCatalogDigest:
      catalogDigests.spacesControlPlaneRequestCatalogDigest,
    spacesControlPlaneResponseCatalogDigest:
      catalogDigests.spacesControlPlaneResponseCatalogDigest,
    spacesControlPlaneTlsProfileDigest:
      catalogDigests.spacesControlPlaneTlsProfileDigest,
    websiteConfiguration,
    controlPlaneBinding,
  };
}

/**
 * Recompute the issuance-phase decision for an authorized intent and refuse
 * an intent whose `capabilityDecisionDigest` is not its digest (DEC-097 line
 * 8419: recomputed before staging). Every input is the intent's own except
 * the run identity the Pages artifact name is bound to, which is the
 * runner's, and — for `do-spaces` only — the five per-destination digests
 * (the two DEC-097 closed-record digests plus the three LOCAL-63(g)
 * control-plane catalog digests), which the caller recomputes with
 * {@link recomputeSpacesClosedRecords} and passes in `spaces` (async, so it
 * cannot be done inside this synchronous function): DEC-097 8446-8449
 * requires those be recomputed and proved equal to the pre-authorized
 * digests *before* any live control-plane call, exactly what
 * `verify-spaces-configuration.mjs` does ahead of its `GetBucketWebsite`
 * calls.
 *
 * @param {Record<string, any>} intent the authorized deployment intent
 * @param {{runId: string, runAttempt: number}} run the runner's own run identity
 * @param {{
 *   spacesWebsiteConfigurationDigest: string,
 *   spacesControlPlaneBindingDigest: string,
 *   spacesControlPlaneRequestCatalogDigest: string,
 *   spacesControlPlaneResponseCatalogDigest: string,
 *   spacesControlPlaneTlsProfileDigest: string
 * } | undefined} [spaces]
 *   the recomputed Spaces per-destination digests; required when
 *   `intent.adapter.adapterId === 'do-spaces'`, ignored otherwise
 * @returns {ReturnType<typeof issuancePhaseDecision>} the agreeing decision
 */
export function requireCapabilityDecisionAgreement(intent, run, spaces) {
  const decision = issuancePhaseDecision({
    artifactId: String(intent.artifactId),
    artifactDigest: String(intent.artifactDigest),
    manifestDigest: String(intent.manifestDigest),
    destination: /** @type {Record<string, unknown>} */ (intent.destination),
    adapter: intent.adapter,
    artifactFileCount: intent.artifactFileCount,
    artifactByteCount: intent.artifactByteCount,
    marker: /** @type {Record<string, unknown>} */ (intent.marker),
    ...(intent.pagesBuildVersion === undefined
      ? {}
      : { pagesBuildVersion: String(intent.pagesBuildVersion) }),
    ...(intent.spacesStagePrefix === undefined
      ? {}
      : { spacesStagePrefix: String(intent.spacesStagePrefix) }),
    ...(spaces === undefined
      ? {}
      : {
          spacesWebsiteConfigurationDigest:
            spaces.spacesWebsiteConfigurationDigest,
          spacesControlPlaneBindingDigest:
            spaces.spacesControlPlaneBindingDigest,
          spacesControlPlaneRequestCatalogDigest:
            spaces.spacesControlPlaneRequestCatalogDigest,
          spacesControlPlaneResponseCatalogDigest:
            spaces.spacesControlPlaneResponseCatalogDigest,
          spacesControlPlaneTlsProfileDigest:
            spaces.spacesControlPlaneTlsProfileDigest,
        }),
    runId: run.runId,
    runAttempt: run.runAttempt,
  });
  if (decision.decisionDigest !== intent.capabilityDecisionDigest) {
    throw new Error(
      `DEPLOY_CAPABILITY_DECISION_MISMATCH: the issuance-phase capability decision recomputed from the intent digests to ${decision.decisionDigest}, not the ${String(intent.capabilityDecisionDigest)} the intent carries (LOCAL-62; the API's admission row for ${String(intent.adapter?.adapterId)}@${String(intent.adapter?.adapterVersion)} is mirrored from releases 0045/0046)`,
    );
  }
  return decision;
}

/**
 * The deploy-phase evaluation over the frozen payload (DEC-097 lines
 * 8362-8366): the exact object and byte totals with the marker, the longest
 * final path, and — for Pages — the carrier facts the deploy job holds.
 * Journal evidence only.
 *
 * @param {{
 *   files: readonly {path: string, bytes: Buffer}[],
 *   markerByteLength: number,
 *   pagesActionsArtifactDigest?: string,
 *   pagesActionsArtifactByteCount?: number
 * }} facts the payload and the carrier facts
 * @returns {Record<string, string>} the deploy-phase members, as decimal strings
 */
export function deployPhaseEvaluation(facts) {
  const artifactByteCount = facts.files.reduce(
    (total, file) => total + file.bytes.byteLength,
    0,
  );
  const longestPath = facts.files.reduce(
    (longest, file) => Math.max(longest, Buffer.byteLength(file.path, 'utf8')),
    Buffer.byteLength(GENERATION_MARKER_PATH, 'utf8'),
  );
  return {
    artifactFileCount: String(facts.files.length),
    deploymentObjectCount: String(facts.files.length + 1),
    artifactByteCount: String(artifactByteCount),
    markerByteLength: String(facts.markerByteLength),
    deploymentByteCount: String(artifactByteCount + facts.markerByteLength),
    exactFinalPathByteLength: String(longestPath),
    exactStageRequestCount: String(facts.files.length + 1),
    ...(facts.pagesActionsArtifactDigest === undefined
      ? {}
      : { pagesActionsArtifactDigest: facts.pagesActionsArtifactDigest }),
    ...(facts.pagesActionsArtifactByteCount === undefined
      ? {}
      : {
          pagesActionsArtifactByteCount: String(
            facts.pagesActionsArtifactByteCount,
          ),
        }),
  };
}
