/**
 * Documented `local-development.invalid`-TLD (RFC 2606) placeholders this
 * package's normalization/provenance step uses wherever a schema requires
 * an absolute HTTPS URL, a `githubRepositoryCoordinate` ("owner/repo") or an
 * opaque workflow label, but no real published origin or Action run exists
 * yet for a locally-built, not-yet-deployed author repository (LOCAL-6
 * established the same "documented local stand-in, never fabricated as
 * official" pattern for this workspace's own environment identity).
 * `.invalid` is guaranteed by IETF policy (RFC 2606) never to resolve, so
 * these can never be mistaken for a real published site or run. Every local
 * stand-in in this package is anchored on the same `local-development.invalid`
 * authority so a reader only has to recognize one convention.
 *
 * @module
 */
/** The one placeholder authority every local stand-in in this package is anchored on. */
export const LOCAL_STANDIN_AUTHORITY: "local-development.invalid";
/** Placeholder registry origin for a package identity resolved locally, not from a real npm registry (see `package-identity.js`). */
export const LOCAL_REGISTRY_STANDIN: "https://local-development.invalid/rathnasgala2/";
/**
 * Placeholder `githubRepositoryCoordinate` ("owner/repo") for
 * `options.provenance.repositoryCoordinate` outside a real Action run. The
 * `githubRepositoryCoordinate` pattern forbids a dot in the owner segment,
 * so the `.invalid` marker instead qualifies the repo segment.
 */
export const LOCAL_REPOSITORY_COORDINATE_STANDIN: "local-development/no-repository-coordinate.invalid";
/** Placeholder workflow-identity source text (digested before use — see `provenance.js`) outside a real Action run. */
export const LOCAL_WORKFLOW_IDENTITY_STANDIN: "local-development.invalid/no-workflow-identity";
/**
 * Placeholder `buildEpoch` (DEC-097 section 5: recovered deterministically
 * from the selected `sourceRevision` Git commit object's committer
 * timestamp) for a repository directory that is not a real git working
 * tree — a fixture directory with no `.git`, for example. The Unix epoch
 * instant itself, never the wall clock, so two clean builds of the same
 * non-git `build-input` still produce byte-identical `buildEpoch` bytes.
 */
export const LOCAL_BUILD_EPOCH_STANDIN: "1970-01-01T00:00:00.000Z";
