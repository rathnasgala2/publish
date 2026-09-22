/**
 * Shared constants for `@rathnasgala2/publish-action`: DEC-006's exit-code
 * vocabulary (borrowed without the CLI grammar, per the S2 brief section 5),
 * the domain-separation tags this package's own normalization step uses for
 * digests it is responsible for (distinct from `publish-kernel`'s and
 * `template`'s own domains), and the one closed adapter identity S2 actually
 * ships (`local-directory`; `github-pages` and `do-spaces` are S2-T18/T19).
 *
 * @module
 */

/** DEC-006 exit codes, reused here without the deferred CLI grammar. */
export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  FINDINGS: 1,
  INCOMPATIBLE_CONTRACT: 2,
  CONFLICT: 3,
  MISSING_DEPENDENCY: 4,
  UNSAFE_INPUT: 5,
  BUILD_OR_PUBLISH_FAILURE: 6,
  REDACTED_INTERNAL_FAILURE: 70,
});

/** The one adapter identity implemented in this repository as of S2-T20. */
export const IMPLEMENTED_ADAPTER_ID = 'local-directory';

/** The closed three-member adapter identity vocabulary (DEC-097 section 7). */
export const ADAPTER_IDS = Object.freeze([
  'local-directory',
  'github-pages',
  'do-spaces',
]);

/**
 * Domain-separation tag for this package's own repository-root digest
 * (`GALA-PUBLISH-ACTION-REPOSITORY-ROOT-V2`), distinct from `publish-kernel`'s
 * `GALA-CAPABILITY-DECISION-V2` and `template`'s `GALA-RENDER-POLICY-V2`
 * domains. This package's own convention: no shared DEC-097 repository-root
 * digest formula was found to reuse, so this is documented here rather than
 * silently invented inline.
 */
export const REPOSITORY_ROOT_DOMAIN =
  'GALA-PUBLISH-ACTION-REPOSITORY-ROOT-V2\0';

/** Domain-separation tag for this package's local source-revision stand-in. */
export const LOCAL_SOURCE_REVISION_DOMAIN =
  'GALA-PUBLISH-ACTION-LOCAL-SOURCE-REVISION-V2\0';

/** Domain-separation tag for this package's local package-identity stand-ins. */
export const LOCAL_PACKAGE_IDENTITY_DOMAIN =
  'GALA-PUBLISH-ACTION-LOCAL-PACKAGE-IDENTITY-V2\0';

/** Domain-separation tag for this package's own build-input digest. */
export const BUILD_INPUT_DIGEST_DOMAIN = 'GALA-PUBLISH-ACTION-BUILD-INPUT-V2\0';

// Every `local-development.invalid`-anchored stand-in (registry, base URL,
// repository coordinate, workflow identity) lives in `normalize/local-
// standins.js`, the single place this package's local placeholders are
// defined, so there is exactly one convention to recognize.
