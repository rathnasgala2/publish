# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **PUB-H8:** `package.json` sets `"private": true`, so `npm publish` refuses
  this package structurally instead of relying only on `release.yaml`'s
  exclusion list. `@rathnasgala2/template` is now declared as an optional
  `peerDependencies` entry (`^2.0.0`), so this package's dependency closure is
  honest even though `template` is not yet on the npm registry.
  `workspace-siblings.js`'s `resolveWorkspaceRoot` now refuses its LOCAL-only
  relative sibling default outright when this module is running from inside a
  `node_modules` tree (the shape of an installed dependency) and requires an
  absolute `WORKSPACE_ROOT` in that case, closing the path by which an installed
  copy could `import()` code from outside a consumer's project. `WORKSPACE_ROOT`
  must now be an absolute path when set.

### Changed

- **PUBLISH-S4-6b — the build leaves its two validated fact records next to the
  manifest.** `runBuild` writes `work/build-input.json` (the normalized
  `build-input:2.0.0` the renderer consumed, whose `inputDigest` is the
  manifest's `buildInputDigest`) and `work/theme-contract.json` (the verified
  `theme-contract:2.0.0` of the lock-pinned theme, whose `package` is the lock's
  theme identity). The managed freeze job quotes the reproducible build record's
  `repositoryRootDigest`, `basePath`, `renderPolicy` and `stylingContractDigest`
  from them (DEC-097 section 5); neither is an artifact file. The e2e test
  asserts both.
- **PUBLISH-S4-6a — `destinationCapabilities` is the lock-selected adapter.**
  `normalize/destination-capabilities.js` no longer hard-codes a
  `local-directory` stand-in: `destinationCapabilitiesFromLock` selects the one
  adapter row of the lock's `publisher` closure under the closed DEC-097 section
  3 package-to-id mapping, takes `adapterVersion` from the locked version and
  `adapterDigest` from the locked integrity, and binds `baseUrl` to the
  publication's canonical base (section 5) instead of the retired
  `LOCAL_BASE_URL_STANDIN`. A lock selecting no adapter or two is refused
  (`LOCK_ADAPTER_SELECTION_INVALID`; the lock schema's four-row `publisher`
  closure refuses it first). `deploy-local-directory` takes the destination
  identity's `adapterVersion` from the installed adapter's `ADAPTER_VERSION`.
  `repository-intake.test.js` proves the projection for all three adapters.
- **LOCAL-47:** `deploy-local-directory` no longer passes a raw observed
  `currentGenerationId` (which is `null` on a first publish) as an activation
  fence. Both the kernel fence and the adapter's `expectedCurrentGenerationId`
  are built with `fenceFor(...)`, so a first publish states
  `EXPECT_NOTHING_SERVED` explicitly and is genuinely fenced against a
  destination that turns out to be serving something. The kernel fence also now
  carries `observedGenerationId`, which duty 6 requires, and the invented
  `'none'` placeholder is gone.

### Added

- FOLLOW-UP SUPPLY-CHAIN-JS: `src/workspace-siblings.js`, one shared resolver
  for the LOCAL-only sibling-repository paths `theme-bridge.js` and
  `template-bridge.js` each derived independently by fixed relative depth from
  this package's own file location. `resolveWorkspaceRoot` honours
  `WORKSPACE_ROOT` (DEC-015 name) when set to a non-empty string, falling back
  to the previous fixed relative default (`/Users/anand/ws/galascribe/v2` in
  this workspace's layout) otherwise; `resolveWorkspaceSibling` joins that root
  with a sibling directory name (`template`, `theme-<name>`).
  `template-bridge.js`'s `TEMPLATE_ROOT` and `theme-bridge.js`'s local-sibling
  candidate now both resolve through it, so a single environment variable — set
  once to the directory containing the sibling repositories — makes both bridges
  resolve correctly from a non-default location (a git worktree one level deeper
  than the real checkout, per LOCAL-38) where the fixed relative default cannot
  reach them; a CI checkout with no siblings at all still fails closed, now with
  a clear `WorkspaceSiblingNotFoundError` naming `WORKSPACE_ROOT` instead of a
  raw module-not-found error (`template-bridge.js`'s `importTemplateModule`).
  Added `test/workspace-siblings.test.js` (default resolution, the override, the
  error message) and `test/template-bridge.test.js` (`TEMPLATE_ROOT`'s
  default/override and the fail-closed error, exercised in a child process since
  `TEMPLATE_ROOT` is computed once at module import time from `process.env`).

- S2-T20b: theme package resolution and wiring into `build` (and, by extension,
  `preview` and the Action's `publish` path), so a real theme package's CSS is
  actually rendered into a build's output instead of `renderPublication`'s own
  pre-existing `assets/theme/print.css` default. `src/theme-bridge.js`'s
  `resolveThemeDirectory` resolves `gala.lock.json`'s `packages.theme` pin to an
  on-disk theme package directory in one fixed, documented order: (1) an
  installed `<repositoryDirectory>/node_modules/<theme package>` (the eventual
  real path, once a theme package is an ordinary npm dependency of a real author
  repository), (2) a `GALA_THEME_DIR` override, (3) the LOCAL-only sibling
  checkout `/Users/anand/ws/galascribe/v2/theme-<name>`, resolved relative to
  this package's own file path exactly like `template-bridge.js`'s
  `TEMPLATE_ROOT` — never consulted once step 1 finds a directory, and never a
  path a real Action run outside this workspace can rely on. The first candidate
  directory that exists is verified — its `package.json` `name`/`version` must
  exactly match the lock pin, and its `theme.json` must validate against
  `urn:gala:schema:theme-contract:2.0.0` and carry the matching `package`
  identity — and a candidate that exists but fails verification fails resolution
  closed rather than falling through to the next step. Every failure (no
  candidate found, unreadable/malformed `package.json`/`theme.json`, an identity
  mismatch, or a schema validation failure) is a typed `SOURCE_ERROR` finding
  (`THEME_PACKAGE_NOT_FOUND`, `THEME_PACKAGE_IDENTITY_MISMATCH`,
  `THEME_CONTRACT_IDENTITY_MISMATCH`, `THEME_CONTRACT_INVALID`,
  `THEME_PACKAGE_NAME_INVALID`), mapping to `UNSAFE_INPUT`/exit `5` through the
  existing `findingsFromError`/ `classifyFindings` pipeline — `build` never
  proceeds to `renderPublication` with an unresolved or unverified theme
  directory. The resolved directory is passed as `options.themeDirectory` to
  `renderPublication` (`src/commands/build.js`). Extended the end-to-end test
  (`test/e2e-npx-and-action.test.js`) to assert the fixture repository's
  `@rathnasgala2/theme-default` pin renders `assets/theme/tokens.css`/
  `components.css`/`print.css` byte-equal to the real `theme-default` sibling
  package's own files, and that every generated page's `<head>` links them in
  `theme.json`'s own `cssLayers` order. Added `test/theme-bridge.test.js`
  (resolution-order precedence, every fail-closed path, and a `runBuild`-level
  fail-closed assertion).

- Full S2-T20 implementation: author-repository intake and normalization
  (`repository:2.0.0`/`lock:2.0.0`/`publication:2.0.0`/`author:2.0.0`/
  `navigation:2.0.0`/`appearance:2.0.0`/`content-frontmatter:2.0.0`, fail closed
  with typed findings) into a validated `build-input:2.0.0` document; the `npx`
  subcommands `validate`, `build` and `preview` with DEC-006 exit codes and one
  closed result envelope; `action.yml` with a Node 24 runner entry composing
  normalization -> `renderPublication` -> `publish-kernel` -> the
  `local-directory` adapter; adapter selection that fails closed with
  `TARGET_CAPABILITY_UNAVAILABLE` for `github-pages`/`do-spaces`; a minimal
  deterministic fixture repository and end-to-end tests (`validate` -> `build`
  -> Action-path deploy -> byte-equal served output and generation marker;
  `preview` serving loopback-only and never deploying).

### Changed (from S2-T15's scaffold placeholder)

- `PACKAGE_STATUS.implemented` is now `true`.

### Fixed (independent review of the initial S2-T20 landing)

- Re-derived the author-repository intake from DEC-006 "Portable repository,
  content, extension and local-tool contract", which fixes the layout: the
  discovery bootstrap `gala/repository.json`, the committed lockfile
  `gala.lock.json`, and `publication.json`/`navigation.json`/
  `appearance.json`/`authors/` recommended-nested under `gala/`. Content
  frontmatter is now DEC-006's bounded YAML block (pinned `yaml` 2.9.0, YAML 1.2
  core schema, anchors/aliases/merge keys/duplicate keys/non-string
  keys/non-finite numbers all rejected — `src/normalize/frontmatter.js`),
  replacing the earlier JSON-fence convention DEC-006 explicitly rejects.
  Corrected the module doc comment that had claimed no authoritative layout
  exists. Updated fixtures and tests accordingly.
- Unified every local provenance/destination stand-in on one
  `local-development.invalid`-anchored convention
  (`src/normalize/local-standins.js`).
- Committed `src/bin/cli.js` with the executable bit set (mode 755) so `npm ci`
  does not dirty the working tree.

### Fixed (PUBLISH-STAGE-DIGEST)

- `runBuild` now removes and recreates `outputDirectory`/`workDirectory` before
  rendering, actually enforcing its own documented "writes only into an explicit
  clean output and work directory" contract instead of merely stating it.
  Reusing those directories across two `runBuild` calls (a local author's own
  preview build immediately followed by the Action's own build-then-deploy into
  the same default `.gala/output` — S2 brief section 5's documented flow) left
  `renderPublication`'s post-render output-directory scan picking up the prior
  render's leftover asset files a second time, producing an `artifact-manifest`
  route list with duplicate paths that no longer matched the physical file set
  one to one. The Action's stage/activate composition then (correctly) refused
  the resulting candidate with `STAGE_INTEGRITY_MISMATCH`.
- `buildEpoch` is now recovered deterministically per DEC-097 section 5 (the
  selected `sourceRevision` git commit's committer timestamp, or the documented
  local stand-in `1970-01-01T00:00:00.000Z` outside a real git working tree —
  `src/normalize/source-revision.js`'s new `resolveBuildEpoch`), never the wall
  clock at build time. The prior `new Date().toISOString()` made every
  `buildEpoch`-derived byte (the search index and feed documents) differ between
  two builds of the exact same commit, so a clean rebuild's `artifactDigest` was
  never reproducible.
- Added an end-to-end regression test covering the exact sequence above
  (`runBuild` into a nested, non-root output directory, then `runAction` into
  the same directories, with the real theme resolved) and asserting two
  independent runs produce a byte-identical `artifactDigest`.
- **Follow-up (independent review, blocking):** the directory-cleanliness fix
  above removed `outputDirectory`/`workDirectory` unconditionally, but both are
  caller-controlled (`--output`/`--work`, the Action's
  `output-directory`/`work-directory` inputs, or their
  `<repositoryDirectory>/.gala/{output,work}` defaults) — an `--output .` (or an
  equivalently dangerous ancestor/cwd/home/root value) would have deleted the
  author's own repository. Added `src/build-directory-safety.js`: `runBuild` now
  refuses (typed `SOURCE_ERROR` finding `UNSAFE_BUILD_DIRECTORY`,
  `UNSAFE_INPUT`/exit `5`, nothing removed) before any `rm` when either
  directory equals or is an ancestor of the repository directory, the process's
  current working directory, the home directory or the filesystem root; when
  `outputDirectory` and `workDirectory` are the same path or nested in each
  other; or when a directory already exists, is non-empty, and does not carry
  the `.gala-build-directory` marker a prior `runBuild` call wrote into it
  (written only after `renderPublication` returns, so the marker itself can
  never be swept into a manifest route). Added
  `test/build-directory-safety.test.js` (unit coverage for every refusal plus
  the marker-gated happy repeat-build path).
