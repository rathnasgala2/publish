# @rathnasgala2/publish-action

Author-facing publish orchestration entry: GitHub Action plus local `npx`
`validate`/`build`/`preview`.

## Status

Implemented (S2-T20, extended by S2-T20b's theme wiring). This package is the
workspace's sole composition root: it normalizes an author repository into a
validated `build-input:2.0.0` document, resolves and verifies the
`gala.lock.json`-pinned theme package (see "Theme resolution" below), calls
`@rathnasgala2/template`'s `renderPublication`, and drives
`@rathnasgala2/publish-kernel` plus the selected `@rathnasgala2/adapter-*`
implementation. Only `local-directory` is implemented; `github-pages` and
`do-spaces` selection fails closed with `TARGET_CAPABILITY_UNAVAILABLE` until
S2-T18/S2-T19 land.

## Two invocation shapes, one implementation

1. **GitHub Action** (`action.yml`, `runs.using: node24`, entry
   `src/action/run.js`). Inputs: `repository-directory`, `output-directory`,
   `work-directory`, `profile`, `adapter`, `adapter-config-path`. Outputs:
   `result-code`, `manifest-path`, `manifest-digest`, `artifact-directory`,
   `artifact-digest`, `route-count`, `byte-count`. There is no author-supplied
   operation id, challenge id, generation identity or other dynamic managed
   value — those are S4's domain. This is the only path that deploys.
2. **Local `npx`**: `npx @rathnasgala2/publish-action <validate|build|preview>`.
   No `bin` named `gala`, no global executable, no `publish` subcommand — a
   local author previews locally and deploys only through the Action.

Machine output goes to stdout as one closed result envelope (`resultCode`,
`exitCode`, `findings`, plus command-specific fields); human diagnostics go to
stderr. Exit codes follow DEC-006: `0` success, `1` findings, `2` incompatible
contract, `3` conflict, `4` missing dependency, `5` unsafe input, `6` build or
publish failure, `70` redacted internal failure.

| Subcommand | Behavior                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate` | Read-only, deterministic for the same revision/lock/toolchain. Never mutates.                                                                             |
| `build`    | Writes only into an explicit clean output/work directory. Never edits source or lock. Never deploys.                                                      |
| `preview`  | Builds, then serves the candidate read-only on `127.0.0.1` (port `0`). No deployment, no credential, no network beyond the loopback socket it listens on. |

## Author-repository intake convention

The author-repository layout **is** authoritatively specified by DEC-006
"Portable repository, content, extension and local-tool contract"
(`zz-gala-v2.3_20260909221715.md` lines ~7411-7524, ~7672). DEC-006 fixes
exactly two paths with format-level special meaning — the discovery bootstrap
`gala/repository.json` and the committed resolver output `gala.lock.json` — and
documents a _recommended_ (not required) tree for everything else, which
`src/normalize/repository-intake.js` and this package's fixtures follow:

```text
<repositoryDirectory>/
  gala/
    repository.json        # repository:2.0.0 (the fixed discovery path)
    publication.json        # publication:2.0.0
    navigation.json          # navigation:2.0.0
    appearance.json            # appearance:2.0.0
    authors/*.json               # author:2.0.0, one per file
  gala.lock.json                   # lock:2.0.0 (the fixed lockfile path)
  content/*.md                       # bounded YAML frontmatter + Markdown
```

`repository.json`'s own `publication`/`navigation`/`appearance` fields still
carry the actual repository-relative paths (DEC-006: "Everything else ... is
referenced from the bootstrap manifest using repository-relative paths"); this
package reads whatever those fields name.

Content is UTF-8 Markdown with a bounded YAML frontmatter block, delimited by
`---` fence lines (DEC-006 line ~7503: "Content uses UTF-8 Markdown with a
bounded YAML frontmatter block"; DEC-006 line ~7672 explicitly considered and
rejected a JSON-fence alternative: "JSON configuration plus constrained YAML
frontmatter supplies one deterministic contract").
`src/normalize/frontmatter.js` parses it with the pinned `yaml` 2.9.0 parser
(the same version `@rathnasgala2/schemas`/`schema` already pin) restricted to
DEC-006's constrained subset — the YAML 1.2 **core** schema, with anchors,
aliases, merge keys, duplicate keys, non-string keys and non-finite numbers all
rejected before the parsed frontmatter is schema-validated against
`content-frontmatter:2.0.0`.

Every authored document is schema-validated with `@rathnasgala2/schemas` before
use. Every authored Markdown body is normalized exactly once through
`template`'s `normalizeAuthoredMarkdown` (DEC-097 section 5's division of
labour). See `repository-intake.js`'s own documentation for the deliberate,
explicitly rejected scope reductions (no `publication.profile`/`footerCard`, no
content `hero`/`socialImage`, no `appearance` brand/word marks or font assets —
every one fails closed with a typed finding rather than being silently dropped)
— those are this package's own scope decisions, not a DEC-006 shortfall.

A minimal deterministic fixture repository lives at
`test/fixtures/minimal-repository` and is exercised end to end by
`test/e2e-npx-and-action.test.js` (`validate` -> `build` -> Action-path deploy
to a temp `local-directory` root, byte-equal served output, generation marker
present) and `test/repository-intake.test.js` (near-complete coverage of the
normalization step's fail-closed paths).

## Consuming `@rathnasgala2/template`

`v2/template` is a full sibling repository with its own independently installed
`node_modules` (including its own copy of `@rathnasgala2/schemas`). Adding it as
an npm `file:` dependency of this workspace would make `npm ls`/`cyclonedx-npm`
(this workspace's SBOM generator) crawl into that foreign `node_modules` tree
and report an unrelated "invalid" package there — the same friction point
`packages/adapter-local-directory/test/e2e-kernel-template.test.js` documents.
This package instead resolves `v2/template`'s package root directly from
`src/template-bridge.js`'s own file path and dynamically imports its published
entry (`src/core/index.js`) — the second option the task packet sanctions — so
the SBOM gate stays clean. `renderPublication`'s public entry point does not yet
expose a way to compute the current render-policy identity; this package reaches
that one internal module (`internal/content-security.js`'s
`computeRenderPolicyIdentity`) the same documented way the S2-T17 e2e test does.

## Theme resolution (S2-T20b)

`gala.lock.json`'s `theme` entry (`buildInput.packages.theme`, the sole
authority for the theme selection) names a real theme package
(`@rathnasgala2/theme-<name>@<version>`), but this workspace never installs one
as an npm dependency (the same reasoning `template-bridge.js` documents for
`@rathnasgala2/template`: a theme package is a full sibling repository with its
own independently installed `node_modules`, and adding it as a `file:`
dependency would pollute this workspace's own `npm ls`/SBOM output).
`src/theme-bridge.js`'s `resolveThemeDirectory` instead locates the theme
package directory on disk, in this fixed order — the first candidate directory
that actually exists wins:

1. **Installed package** —
   `<repositoryDirectory>/node_modules/<theme package name>`. This is the
   eventual real path once an author repository declares the theme package as an
   ordinary npm dependency and a real registry publish exists.
2. **`GALA_THEME_DIR` override** — an absolute or cwd-relative path to an
   extracted theme package directory.
3. **LOCAL-only sibling checkout** —
   `/Users/anand/ws/galascribe/v2/theme-<name>` (the unscoped remainder of the
   pinned package name), resolved relative to this package's own file path
   exactly like `template-bridge.js`'s `TEMPLATE_ROOT`. This is a
   workspace-layout convenience for local-first delivery (LOCAL-4), never a path
   a real Action run outside this exact workspace layout can rely on, and it is
   **never** consulted once step 1 already found an installed package.

Once a candidate directory is found, it is verified before ever being handed to
`renderPublication`: its own `package.json` `name`/`version` must exactly match
the lock-pinned `theme.package`/`theme.version`, and its own `theme.json` must
validate against `urn:gala:schema:theme-contract:2.0.0` with
`@rathnasgala2/schemas`' `validateGalaDocument` and carry the matching `package`
identity (`"<name>@<version>"`). A candidate directory that exists but fails
either check fails resolution closed — it does **not** fall through to the next
step, since an existing-but-wrong theme package is a finding, not a reason to
keep searching. Every failure (no candidate found, an unreadable/malformed
`package.json`/`theme.json`, an identity mismatch, or a schema-validation
failure) is a typed `SOURCE_ERROR` finding, which
`findingsFromError`/`classifyFindings` map to `UNSAFE_INPUT`/exit `5`: `build`
(and therefore `preview` and the Action's `publish` path, both of which call
`build` internally) never renders with an unresolved or unverified theme
directory.

The resolved, verified directory is passed as `options.themeDirectory` to
`@rathnasgala2/template`'s `renderPublication` (`src/commands/build.js`), which
copies the theme's declared stylesheets (and any declared passive assets) into
the candidate output's `assets/theme/` and links them, in `cssLayers` order, in
every generated page's `<head>` (see `v2/template`'s README, S2-T12 section, for
that consuming side's own path-containment and `basePath`-joining guarantees).
The fixture repository's `gala.lock.json` pins
`@rathnasgala2/theme-default@2.0.0`; `test/e2e-npx-and-action.test.js` asserts
the rendered `assets/theme/tokens.css`/`components.css`/`print.css` are
byte-equal to the real `theme-default` sibling package's own files, and that the
rendered `<link>` order matches `theme.json`'s `cssLayers`.

## Sibling-repository resolution and `WORKSPACE_ROOT` (FOLLOW-UP SUPPLY-CHAIN-JS)

`src/template-bridge.js`'s `TEMPLATE_ROOT` and `src/theme-bridge.js`'s
LOCAL-only sibling-checkout candidate both resolve a sibling repository
(`v2/template`, `v2/theme-<name>`) through one shared helper,
`src/workspace-siblings.js`. By default both resolve the fixed relative path
from this package's own file location (`packages/publish-action/src/` ->
`../../../../` -> `v2/`), unchanged from before this helper existed. Setting
`WORKSPACE_ROOT` (the DEC-015 name for this override) to the directory
containing the sibling repositories makes both resolve as
`<WORKSPACE_ROOT>/template` / `<WORKSPACE_ROOT>/theme-<name>` instead — the fix
for running from a location where the fixed relative default cannot reach the
siblings, such as a git worktree one level deeper than the real checkout
(LOCAL-38: `WORKSPACE_ROOT=/Users/anand/ws/galascribe/v2` from a worktree under
`v2/.worktrees/<name>`). A single-repository CI checkout has no sibling
repositories at all either way; resolution there fails closed with a
`WorkspaceSiblingNotFoundError` that names `WORKSPACE_ROOT` in its message
rather than a raw module-not-found error. `GALA_THEME_DIR` (theme-bridge step 2)
is unaffected and still takes precedence over the `WORKSPACE_ROOT`-resolved
local-sibling step for a theme-package override that is not itself a
`v2/theme-<name>` sibling checkout. `test/theme-bridge.test.js` covers the
resolution-order precedence and every fail-closed path.

## Provenance

`options.provenance` (`builder`, `repositoryCoordinate`, `workflowIdentity`,
`buildToolVersions`) is built from real installed package versions
(`src/normalize/package-identity.js`, `src/normalize/provenance.js`).
`repositoryCoordinate`/`workflowIdentity` come from the real GitHub Actions
environment when present (`GITHUB_REPOSITORY`, `GITHUB_WORKFLOW_REF`,
`GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`), or a documented, pattern-shaped local
stand-in otherwise — never fabricated as an official run. The theme identity in
`buildToolVersions` is sourced from `lock.json`'s `theme` entry
(`buildInput.packages.theme`); there is no separate "theme" input.

## Commands

```sh
npm run typecheck --workspace packages/publish-action
npm test --workspace packages/publish-action
```

## Governing documents

- [Slice brief S2: author-owned publication](../../orchestration/slice-briefs/S2-author-owned-publication.md),
  section 5 (`publish-action`)
- [DEC-097](../../orchestration/decisions/DEC-097-mvp-composition-build-and-deployment-contract-closure.md)
- [WORKSPACE.md](../../orchestration/WORKSPACE.md)
