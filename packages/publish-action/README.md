# @rathnasgala2/publish-action

Author-facing publish orchestration entry: GitHub Action plus local `npx`
`validate`/`build`/`preview`.

## Status

Implemented (S2-T20, extended by S2-T20b's theme wiring) and **unpublished**:
`package.json` sets `"private": true` (PUB-H8), so `npm publish` refuses this
package regardless of `release.yaml`'s exclusion list. This package is the
workspace's sole composition root: it normalizes an author repository into a
validated `build-input:2.0.0` document, resolves and verifies the
`gala.lock.json`-pinned theme package (see "Theme resolution" below), calls
`@rathnasgala2/template`'s `renderPublication`, and drives
`@rathnasgala2/publish-kernel` plus the selected `@rathnasgala2/adapter-*`
implementation.

`adapter-github-pages` and `adapter-do-spaces` are themselves fully implemented
and published (S4-T04/S4-T05) — the gap is in this package's own wiring, not in
those adapters: `assertImplementedAdapter` (`src/adapter-select.js`) only admits
`local-directory` today, and `github-pages`/`do-spaces` selection fails closed
with `TARGET_CAPABILITY_UNAVAILABLE` until S2-T18/S2-T19 wire them into this
composition root.

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
content `socialImageRef`, no `appearance` brand/word marks or font assets —
every one fails closed with a typed finding rather than being silently dropped)
— those are this package's own scope decisions, not a DEC-006 shortfall. Content
images (body images and `hero`), the `appearance` attribution switch and Prism
editions are supported; they are described below.

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
the SBOM gate stays clean. The current render-policy identity is never
hard-coded here: `currentRenderPolicyIdentity()` calls the template's public
`computeRenderPolicyIdentity()`, so it follows whatever production
Content-Security-Policy the template ships (which always allows
`https://api.galascribe.com` in `connect-src`, and appends a non-production
`GALA_API_ORIGIN` for the local stack).

## Content images

Intake checks every repository file that a document refers to as an image, so
the renderer can process it. A document that is part of the build (a draft is
part of it only in candidate mode; an archived document or a dropped edition
never is) refers to an image in two ways: a Markdown image in the body,
`![alt](assets/content/photo.png)`, or the front matter `hero`
(`{path, alt, role}`). Intake emits:

- for each body image, an entry in that document's **`content[].media[]`**:
  `{path, sourceDigest, mediaType, byteLength}`. `sourceDigest` is `sha256:` and
  64 hex digits of the file, `mediaType` is `image/png`, `image/jpeg`,
  `image/webp`, `image/avif` or `image/gif` as recognized from the file's first
  bytes (never from its name), `byteLength` its size. Entries are distinct and
  ordered by the UTF-8 bytes of `path`; `media` is present only on a document
  that has at least one body image, so a repository without images builds
  exactly the input it always did. This is the inventory the template resolves
  the body's `<img src>` against.
- for a hero,
  `content[].frontmatter.hero = {file: {path, sourceDigest}, alt, role}` (a hero
  is not in `media[]`; the renderer reads it from `hero.file`).

The bytes are not copied into the build input: the sandbox mounts the repository
read-only and the template's media pipeline reads each file from there, refusing
it when it does not hash to the digest listed.

Body images are read from the sanitized HTML that `normalizeAuthoredMarkdown`
produces, so intake and the renderer see the same `<img src>` strings, and each
`src` becomes a path by the renderer's own rule
(`template/src/core/internal/media/content-images.js`): entities decoded; a
scheme, a protocol-relative `//`, a query, a fragment or a backslash never
resolves; one leading `/` or `./` is dropped (a path is relative to the
repository root, never to the document's directory); the rest is percent-decoded
and Unicode-NFC-normalized; an empty, `.` or `..` segment never resolves. So
`assets/my%20pic.png`, `./assets/my%20pic.png` and `/assets/my%20pic.png` all
name the file `assets/my pic.png`. An external address (`https://...`) has its
`src` removed by the sanitizer, so it is reported as an image with no repository
path. A hero `path` is used exactly as written, so it must already be the final
path: no scheme, `/`, `./`, `..`, `?`, `#`, `%` or backslash.

**The file must be under an `assetRoots` entry** of `gala/repository.json`, be a
regular file, and stay inside that root after resolving directory symbolic links
(a symbolic link is never followed). It must start with the signature of a PNG,
JPEG, WebP, AVIF or GIF image; SVG is refused.

| Code                         | Severity       | Meaning                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_REFERENCE_UNRESOLVED` | `SOURCE_ERROR` | A reference cannot be used. One finding per reference, all reported together in reading order, each naming the document and the path; `evidence.reason` is `NO_SOURCE`, `EXTERNAL_ADDRESS`, `NOT_A_REPOSITORY_PATH`, `OUTSIDE_ASSET_ROOTS`, `FILE_MISSING`, `NOT_A_REGULAR_FILE` or `UNSUPPORTED_FORMAT`.                                                            |
| `MEDIA_LIMIT_EXCEEDED`       | `SOURCE_ERROR` | One image over 10 MiB (`evidence.limit` `IMAGE_BYTES`); a body image over 5 MiB (`BODY_IMAGE_BYTES`; a hero may be up to 10 MiB); more than 2048 distinct images (`IMAGE_COUNT`); more than 256 MiB of source bytes together (`TOTAL_BYTES`); or more than 200 distinct body images in one document (`DOCUMENT_IMAGES`). Judged only when every reference is usable. |

The 10 MiB, 2048 and 256 MiB limits are `template`'s
(`src/core/internal/media/limits.js`). The 5 MiB and 200 are `build-input`'s own
bounds for an entry of `media[]` (`byteLength` of an image, and the length of
the array), so a body image is held to the smaller of 5 MiB and the template's
10 MiB; a hero is not in `media[]` and may be up to 10 MiB.
`test/content-media.test.js` keeps every number equal to the template's or to
the installed schema's. The template applies its own, stricter decode ceilings
(dimensions, pixel count) when it reads the file. `socialImageRef` is still
refused with `CONTENT_MEDIA_UNSUPPORTED`.

## Appearance attribution

`gala/appearance.json`'s optional `attribution` (`{"showMadeWith": boolean}`; an
absent `attribution` means the "Made with Galascribe" mark is shown) is copied
into `build-input.appearance.attribution`. Absent stays absent.

## Prism editions

A document with `kind: edition` (normally `content/<slug>.edition.<kind>.md`) is
a shorter or longer rendering of one article. Its `edition` front matter
(`{of, kind, sourceDigest, generation, approvedAt}`) names the article by slug
(`of`) and records which text of that article it was made from (`sourceDigest`).
Intake keeps an edition only when both still hold:

| Situation                                                      | Result                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| no article of this build has the slug `edition.of`             | edition dropped, warning `EDITION_SOURCE_MISSING`                |
| the article's body no longer digests to `edition.sourceDigest` | edition dropped, warning `EDITION_STALE`                         |
| both hold                                                      | edition kept, with its front matter (`kind: edition`, `edition`) |

The article is looked for among the documents _of this build_: a draft (outside
candidate mode) or an archived article is not part of it, so its edition is
dropped rather than published without an original. When two articles share a
slug (the same post in two languages) the one in the edition's `language` is
chosen. A dropped edition is not looked at any further (its authors and images
are not checked) and never fails the build; a kept edition is held to the same
rules as any document.

**The digest rule.** `edition.sourceDigest` is the SHA-256 of the UTF-8 bytes of
the article's _Markdown body_: the text of the article's file after the closing
`---` line of its front matter, with each `\r\n` read as `\n`, and nothing else
changed. Leading and trailing newlines count (the editor writes exactly one
trailing newline); the front matter does not, so retitling or retagging an
article keeps its editions fresh while any edit to the body makes them stale. It
is not the digest of the rendered HTML and not `bodyDigest`. The schema writes
it as `sha256:` and 64 lowercase hex digits; intake compares the hex digits, so
a bare 64-digit spelling would name the same digest. The API computes the same
value from the body that its content document parser returns (the parser reads
`\r\n` as `\n` before it splits the front matter off, which is where the `\r\n`
rule comes from).

**Warnings.** `buildBuildInputFromRepository` takes an optional `warnings` array
and pushes the non-blocking findings (severity `WARNING`) onto it; `validate`,
`build` and `preview` return them as `findings` on a successful result
(`resultCode` `SUCCESS`, exit `0`), and the CLI also prints them to stderr, so
they appear in the build log of the managed workflow.

## Reader interactions module

When `<repository.json "modules">/interactions.json` (normally
`gala/modules/interactions.json`) exists, intake validates it against
`urn:gala:schema:interactions-config:2.0.0` (a failure is a build error naming
the file and the failing rule; reaction `key` and `order` uniqueness, which JSON
Schema cannot express, is checked by intake) and sets
`build-input.modules.interactions = {config, apiOrigin, appOrigin}`. With no
file, `modules` stays `{}`.

| Variable          | Default                      | Rule                                                                      |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `GALA_API_ORIGIN` | `https://api.galascribe.com` | https origin, or http `localhost`/`127.0.0.1`; no path, query or fragment |
| `GALA_APP_ORIGIN` | `https://app.galascribe.com` | same                                                                      |

The managed workflow passes `GALA_API_ORIGIN` from its `gala_api_origin` input,
and `scripts/sandbox-build.sh` forwards both variables into the sandbox.

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

On a runner the sandbox sets `WORKSPACE_ROOT` to the toolchain's
`node_modules/@rathnasgala2`, so step 3 finds the themes the toolchain root
installs (`src/theme-catalog.js` lists them with the lock block each needs).
Repository intake also refuses with `THEME_SELECTION_MISMATCH` when
`appearance.json`'s theme package differs from the lock's.

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
