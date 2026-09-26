# Repository instructions

## Purpose

Own the provider-neutral publish safety kernel, the in-process deployment
adapter protocol, and the three S2 destination adapters
(`adapter-local-directory`, `adapter-github-pages`, `adapter-do-spaces`) plus
their single author-facing orchestration entry, `publish-action`. This
repository never clones a source repository, never installs author dependencies,
never executes author build code, never interprets Gala content semantics, and
never writes to a source repository (DEC-016).

## Commands

Use Node.js 24.18.0 and npm 11.16.0 (`nvm use` picks up `.nvmrc`). From the
workspace root:

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run architecture
npm run duplication
npm test
npm run sbom
npm run audit
npm run pins:check
npm run license:check
npm run provenance:check
npm run declarations:check
npm run manifest:check
npm run changelog:check
npm run verify        # runs everything above, in order
```

`npm test` runs both the per-package suites and the repository-level suites in
`test/` (workflow-graph equality, the build sandbox, the pin ledger and the
carrier codec).

Per-package equivalents run the same script name inside `packages/<name>` (for
example `npm test --workspace packages/adapter-protocol`).

## Architecture boundaries

`.dependency-cruiser.cjs` enforces adapter isolation:

- `adapter-protocol` is the lowest layer and depends on nothing else in this
  workspace.
- `publish-kernel` is provider-neutral and may depend on `adapter-protocol`
  only; it never imports a concrete adapter.
- Each `adapter-*` package depends on `adapter-protocol` only; it never imports
  a sibling adapter, `publish-kernel` or `publish-action`.
- `publish-action` is the sole composition root allowed to wire the kernel, the
  protocol and every adapter together.

`npm run architecture` (`depcruise --validate`) fails the build on a violation.

## What never goes here

Source-repository mutation, author build execution, content-semantics
interpretation, the deferred `cli`/`gala` executable (no `bin` named `gala`
exists anywhere in this repository), the out-of-process 1&nbsp;MiB framed
adapter transport (`adapter-message:2.0.0`, deferred by DEC-097 for S2 — S2
adapters are in-process ESM modules only) and `adapter-cloudflare-pages`. The
managed S4 behavior now lives here (the Pages and Spaces adapters, the reusable
workflow graph and the build sandbox); what still never lives here is any
Gala-side issuance: this repository never constructs a `deployment-receipt`,
never mints or refreshes a credential, and never holds the protected Spaces
control-plane key.

## Contract sources and generation commands

`@rathnasgala2/schemas@2.11.0` is consumed from the public npm registry (exact
pin, no range); the LOCAL-1/LOCAL-43 local-tarball convention
(`file:../../local-packages/rathnasgala2-schemas-*.tgz`, pinned in
`pins/ledger.json`) is retired for this package now that it publishes. No schema
is re-authored here. Protocol payloads are validated with the package's exported
`validateGalaDocument(schemaId, value)` against
`urn:gala:schema:adapter-capability:2.0.0`,
`urn:gala:schema:deployment-intent:2.0.0`,
`urn:gala:schema:deployment-observation:2.0.0` and
`urn:gala:schema:public-generation-marker:2.0.0`. There is no regeneration
command in this repository; a schema change lands upstream in `schema` first.

## How to run locally

`npm ci` at the workspace root installs every package. `npm test` runs the Node
native test runner (`node --test`) per package. `adapter-protocol` has no
external service dependency; its tests are pure unit and property tests.

## Review checklist

Confirm: exact lower-case three-row capability vocabulary (DEC-097 §7) is
unchanged; `adapter-protocol`'s lifecycle export set is exactly the eight named
functions on every adapter; negotiation refuses an unmet capability with
`TARGET_CAPABILITY_UNAVAILABLE` before staging, never after; no default export
outside a documented package entry point; no `bin` named `gala`; the in-process
frame/message helpers respect the DEC-086 1,048,576-byte ceiling;
dependency-cruiser adapter-isolation gate passes; near-complete unit/property
coverage on `adapter-protocol`; SBOM and license inventory are current; no
secret in source, fixture, log or test output.
