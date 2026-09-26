/**
 * Root-relative path names and domain separators for
 * `gala-local-directory-filesystem-v2` (DEC-097 "Executable local-directory
 * filesystem profile"). This module names only the exact root entries the
 * adapter ever creates, replaces or removes; nothing else under
 * `publicationRoot` is ever touched (DEC-016: no deletion outside the
 * declared destination root).
 *
 * @module
 */
/** The directory holding every generation and the private staging scratch. */
export const RELEASES_DIR: "releases";
/** The adapter's private control-state directory (mode `0700`). */
export const CONTROL_DIR: ".gala-local-v2";
/** The activation pointer: a relative symlink to `releases/<generationId>`. */
export const CURRENT_LINK: "current";
/** Reserved marker filename placed at the root of every generation. */
export const GENERATION_MARKER_FILENAME: "gala-generation-marker.json";
/** Retained certified-digest history file (adapter-private bookkeeping). */
export const HISTORY_FILE_RELATIVE: ".gala-local-v2/history.json";
/** Idempotency journal file (adapter-private bookkeeping). */
export const JOURNAL_FILE_RELATIVE: ".gala-local-v2/journal.json";
/**
 * Default retained-generation count on disk: the active generation plus five
 * priors, mirroring `publish-kernel`'s duty-9 default
 * (`DEFAULT_MAXIMUM_PRIOR_GENERATIONS`). This adapter cannot import
 * `publish-kernel` (dependency-cruiser's adapter-isolation gate), so the
 * constant is restated here for the adapter's own on-disk directory
 * retention, which is a distinct concern from the kernel's abstract digest
 * history.
 */
export const MAXIMUM_PRIOR_GENERATIONS_ON_DISK: 5;
/** Domain separator: `adapter-capability:2.0.0.capabilityDigest`. */
export const DOMAIN_ADAPTER_CAPABILITY: "GALA-ADAPTER-CAPABILITY-V2\0";
/** Domain separator: root path digest input to `rootIdentityDigest`. */
export const DOMAIN_LOCAL_ROOT_PATH: "GALA-LOCAL-ROOT-PATH-V2\0";
/** Domain separator: `rootIdentityDigest`. */
export const DOMAIN_LOCAL_ROOT_IDENTITY: "GALA-LOCAL-ROOT-IDENTITY-V2\0";
/** Domain separator: `mutationSurfaceDigest`. */
export const DOMAIN_LOCAL_MUTATION_SURFACE: "GALA-LOCAL-MUTATION-SURFACE-V2\0";
/** Domain separator: `localFilesystemSurfaceIdentity.recordDigest`. */
export const DOMAIN_LOCAL_SURFACE_IDENTITY: "GALA-LOCAL-SURFACE-IDENTITY-V2\0";
/** Domain separator: the runtime probe's canonical transcript digest. */
export const DOMAIN_LOCAL_PROBE_TRANSCRIPT: "GALA-LOCAL-FILESYSTEM-PROBE-TRANSCRIPT-V2\0";
/** Domain separator: the bundled allowlist catalog digest. */
export const DOMAIN_LOCAL_ALLOWLIST: "GALA-LOCAL-FILESYSTEM-ALLOWLIST-V2\0";
/** Domain separator: `localFilesystemCapabilityEvidence.evidenceDigest`. */
export const DOMAIN_LOCAL_CAPABILITY_EVIDENCE: "GALA-LOCAL-FILESYSTEM-CAPABILITY-EVIDENCE-V2\0";
/**
 * Domain separator matching `@rathnasgala2/template`'s
 * `manifest.js` (`DOMAIN_ARTIFACT`), reused verbatim so this adapter's
 * `observe` recomputation is directly comparable to a real
 * `artifact-manifest:2.0.0.artifactDigest`.
 */
export const DOMAIN_ARTIFACT: "GALA-ARTIFACT-V2 ";
