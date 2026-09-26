# @rathnasgala2/adapter-protocol

The JavaScript interface every Galascribe v2 deployment adapter implements, plus
the closed capability vocabulary, provider limit profiles, negotiation and
in-process message contract (slice brief `S2-author-owned-publication.md`
section 5; DEC-020; DEC-097 section 7).

S2 adapters are **in-process ESM modules**. The out-of-process 1&nbsp;MiB framed
adapter transport (`adapter-message:2.0.0`, DEC-029/082/086) is explicitly
deferred and is not implemented by this package; `frame.js` implements only the
DEC-086 size discipline for the in-process kernel/adapter boundary, not a
process transport.

## What this package exports

- **Lifecycle** (`lifecycle.js`): `LIFECYCLE_OPERATIONS`, the exact eight
  function names (`describeCapabilities`, `inspectDestination`, `preflight`,
  `stage`, `activate`, `observe`, `cleanupStaged`, `rollback`) every adapter
  exports; `defineAdapter(moduleNamespace)` validates and freezes a candidate
  module's lifecycle surface.
- **Capability vocabulary** (`capability-vocabulary.js`): every closed
  lower-case enum from DEC-097 section 7, plus `ADAPTER_CAPABILITY_ROWS`, the
  exhaustive three-row admission table for `local-directory`, `github-pages` and
  `do-spaces`.
- **Capability validation** (`capability.js`): `validateCapabilityDeclaration`
  and `assertValidCapabilityDeclaration` validate a candidate
  `adapter-capability:2.0.0` document against `@rathnasgala2/schemas`' published
  validator (the sole authority for wire correctness) and against this package's
  exact-row table (a truthfulness check with a stable typed finding).
- **Limits** (`limits.js`): `isFilesystemProviderLimits` /
  `isHttpProviderLimits` discriminate the `adapterProviderLimits` `oneOf`
  branch.
- **Digests** (`digest.js`): `canonicalizeJson` (RFC 8785 JCS) and
  `domainDigest` (`SHA256(UTF8(domainSeparator) || JCS(value))`), the primitive
  every DEC-097 contract digest in this repository is built from.
- **Frame contract** (`frame.js`): `encodeFrame` / `decodeFrame` /
  `decodeFrames` enforce the DEC-086 1,048,576-byte ceiling on the in-process
  message contract.
- **Loader** (`loader.js`): `loadAdapterModule(specifier)` dynamically imports
  an adapter module in-process and validates its lifecycle surface.
- **Negotiation** (`negotiation.js`): `negotiateCapability` compares a validated
  declaration against policy requirements and returns an evidence-bearing
  decision with its own digest; `requireCapabilityMatch` throws a typed
  `TARGET_CAPABILITY_UNAVAILABLE` refusal before staging when a requirement is
  unmet.
- **Activation fence** (`generation-fence.js`): `EXPECT_NOTHING_SERVED`, the
  explicit "this destination serves nothing" sentinel (LOCAL-47);
  `requireGenerationFence(value)` resolves `activate`'s
  `expectedCurrentGenerationId` to a fence and admits exactly what the schema's
  activation fence admits — a lowercase UUIDv7 `stableId`
  (`GENERATION_ID_PATTERN`) or the sentinel — refusing `null`, `undefined`, the
  empty string and any other text with `EXPECTED_GENERATION_FENCE_INVALID`;
  `fenceDisagrees` and `fenceFor` are the two derived helpers.
- **UUIDv7** (`uuid.js`): `generateUuidV7()`, a minimal RFC 9562 generator for
  the `stableId` identities several published schemas require (for example
  `public-generation-marker:2.0.0`'s `artifactId`/`generationId`), shared here
  so every adapter and the conformance kit generate identities the same way
  instead of duplicating the algorithm.

## Version numbers (PUB-M2)

Three unrelated version numbers can appear on the same artifact; this is the one
place their relationship is stated:

- **The npm package version** (`package.json` `version`, currently `0.2.0`) is
  this published artifact's own semver, governed by ordinary npm compatibility
  rules and this package's `CHANGELOG.md`.
- **`ADAPTER_PROTOCOL_VERSION`** (`generation-fence.js`, currently `2.1.0`) is
  the wire-protocol version DEC-097 assigns to the in-process adapter lifecycle
  contract itself (capability vocabulary, admission table, fence semantics). It
  changes only when the _protocol_ — not this package's implementation of it —
  changes, so it moves independently of, and slower than, the package version.
- **Schema/profile versions** (`adapter-capability:2.0.0`,
  `theme-contract:2.0.0`, `public-generation-marker:2.0.0`, and the
  `@rathnasgala2/schemas` package version, e.g. `2.11.0`) are the published
  wire-schema versions this package validates payloads against; they are
  `@rathnasgala2/schemas`' own version numbers, not this package's.

The enforced rule: a change to `ADAPTER_PROTOCOL_VERSION` requires at least a
minor bump of this package's own `version` (a protocol change is never a patch
release of the implementation). `test/protocol-version.test.js` asserts this by
construction — it does not assert a _specific_ pair of numbers, so it cannot rot
as either one changes, only that the historical pairing this package has
actually shipped never regresses.

## Negotiation decision vs. the kernel's capability decision

This package's `negotiateCapability` produces its own record
(`gala-adapter-protocol-negotiation-v2`, domain-separated under
`GALA-ADAPTER-PROTOCOL-NEGOTIATION-V2\0`). It is distinct from the larger
`capabilityDecision` record DEC-097 section 7 defines
(`GALA-CAPABILITY-DECISION-V2\0`), which additionally binds artifact, manifest
and destination facts that exist only once a build has produced an artifact —
that record is `publish-kernel`'s responsibility (S2-T16), built using this
package's `domainDigest` primitive and `negotiateCapability` result as inputs.

## Example

```js
import {
  loadAdapterModule,
  requireCapabilityMatch,
} from '@rathnasgala2/adapter-protocol';

const adapter = await loadAdapterModule(
  '@rathnasgala2/adapter-local-directory',
);
const declaration = await adapter.describeCapabilities();
const decision = requireCapabilityMatch(declaration, {
  destinationKind: 'local-directory',
  concurrency: 'expected-generation',
});
// decision.satisfied === true, or requireCapabilityMatch already threw
// AdapterProtocolError with a TARGET_CAPABILITY_UNAVAILABLE finding.
```

## Commands

```sh
npm run typecheck --workspace packages/adapter-protocol
npm test --workspace packages/adapter-protocol
npm run declarations:check --workspace packages/adapter-protocol
```
