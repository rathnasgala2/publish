/**
 * This adapter's installed package version, read from its own `package.json`
 * rather than restated by hand: DEC-097 section 3 requires the capability
 * document's `adapter.adapterVersion` to byte-equal the locked package
 * version, and the only value that can never drift from what a lock records
 * for this package is the version the package manifest itself declares.
 */
export const ADAPTER_VERSION: string;
/**
 * The reserved artifact-relative coordinate the public generation marker is
 * staged at (brief section 5). Freeze rejects an artifact route colliding
 * with it; this adapter adds it to the deterministic Pages carrier.
 */
export const GENERATION_MARKER_PATH: ".well-known/gala-generation.json";
/**
 * The exact eleven accepted `GET /repos/{owner}/{repo}/pages/deployments/{id}`
 * status values (brief section 6.2). Anything else is unknown and can never
 * release the destination fence.
 */
export const PAGES_DEPLOYMENT_STATUSES: readonly string[];
/**
 * Temporary statuses: polling continues and the fence stays held.
 * `deployment_attempt_error` is temporary because GitHub retries it
 * automatically (brief section 6.2).
 */
export const TEMPORARY_STATUSES: readonly string[];
/** Terminal failure statuses: the deployment can never later succeed. */
export const TERMINAL_FAILURE_STATUSES: readonly string[];
/** The single success status. */
export const SUCCESS_STATUS: "succeed";
/**
 * The exact poll schedule in seconds: `5, 8, 12, 18, 27, 30`, then `30`
 * repeatedly while the fixed budget permits (brief section 6.2).
 */
export const POLL_SCHEDULE_SECONDS: readonly number[];
/** The repeated tail wait, in seconds, once the schedule is exhausted. */
export const POLL_TAIL_SECONDS: 30;
/** Fixed activation-detection polling budget, in seconds. */
export const POLL_BUDGET_SECONDS: 1500;
/** Hard ceiling on the deterministic Pages carrier, in bytes. */
export const MAXIMUM_PAGES_CARRIER_BYTES: 1073741824;
/** Domain separator: `adapter-capability:2.0.0.capabilityDigest`. */
export const DOMAIN_ADAPTER_CAPABILITY: "GALA-ADAPTER-CAPABILITY-V2\0";
/** Domain separator shared with the template's artifact-manifest projection. */
export const DOMAIN_ARTIFACT: "GALA-ARTIFACT-V2 ";
/** Domain separator: this adapter's own identity digest. */
export const DOMAIN_ADAPTER_IDENTITY: "GALA-PAGES-ADAPTER-IDENTITY-V2\0";
/** Domain separator: the `pagesBuildVersion` projection (brief section 6.2). */
export const DOMAIN_PAGES_BUILD_VERSION: "GALA-PAGES-BUILD-VERSION-V2\0";
/** Domain separator: the physical Pages destination mutation key. */
export const DOMAIN_PAGES_DESTINATION: "GALA-PAGES-DESTINATION-V2\0";
/** Domain separator: the stage token projection. */
export const DOMAIN_PAGES_STAGE_TOKEN: "GALA-PAGES-STAGE-TOKEN-V2\0";
/** Domain separator: the frozen provider request-template catalog. */
export const DOMAIN_PAGES_REQUEST_CATALOG: "GALA-PAGES-REQUEST-CATALOG-V2\0";
/** Domain separator: the frozen provider response-profile catalog. */
export const DOMAIN_PAGES_RESPONSE_CATALOG: "GALA-PAGES-RESPONSE-CATALOG-V2\0";
/** Domain separator: the provider compatibility evidence record. */
export const DOMAIN_PAGES_COMPATIBILITY: "GALA-PAGES-COMPATIBILITY-V2\0";
/** Domain separator: the TLS profile record. */
export const DOMAIN_PAGES_TLS_PROFILE: "GALA-PAGES-TLS-PROFILE-V2\0";
/** Domain separator: the credential-egress profile record. */
export const DOMAIN_PAGES_CREDENTIAL_EGRESS: "GALA-PAGES-CREDENTIAL-EGRESS-V2\0";
/** Domain separator: an intervening run attempt's no-authority tombstone. */
export const DOMAIN_PAGES_NO_AUTHORITY_RUN_ATTEMPT: "GALA-PAGES-NO-AUTHORITY-RUN-ATTEMPT-V2\0";
/** Domain separator: the run-attempt gap proof record. */
export const DOMAIN_PAGES_RUN_ATTEMPT_GAP_PROOF: "GALA-PAGES-RUN-ATTEMPT-GAP-PROOF-V2\0";
/** Domain separator: the `pagesReconciliationRecovery` record. */
export const DOMAIN_PAGES_RECONCILIATION_RECOVERY: "GALA-PAGES-RECONCILIATION-RECOVERY-V2\0";
/**
 * The two admitted `destinationMutationAuthority.mode` values (DEC-097
 * section 6.2). `normal` forbids every `pages-recovery-*` call.
 */
export const NORMAL_MODE: "normal";
/** The recovery mode that admits the two `pages-recovery-*` call classes. */
export const RECOVERY_MODE: "pages-reconciliation-recovery";
/** The two admitted authority modes. */
export const AUTHORITY_MODES: readonly string[];
/**
 * Bounded budget, in seconds, for the complete recovery-prior
 * status/poll/cancel/poll sequence. Recovery authorization budgets this in
 * addition to the ordinary fresh carrier/create/current poll sequence.
 */
export const RECOVERY_POLL_BUDGET_SECONDS: 300;
