# @rathnasgala2/adapter-local-directory

Reference POSIX local-directory deployment adapter and
`gala-local-directory-filesystem-v2` conformance oracle (S2-T17; DEC-097 section
7's `local-directory` row). This is the local end-to-end deploy target for
Galascribe v2 (LOCAL-2): no network, no provider credential, no ambient
configuration — every lifecycle call is a pure function of the caller-supplied
`{root: absolutePath}` destination.

## Destination layout

Every mutation lands under exactly these root-relative names (no other root
entry is ever created, replaced or removed — DEC-016: no deletion outside the
declared destination root):

```
releases/<generationId>/...                  one committed generation's files + marker
releases/.gala-stage-<stageToken>/...         private, unreachable staging scratch
.gala-local-v2/history.json                   retained certified-generation bookkeeping
.gala-local-v2/journal.json                   idempotency journal
current -> releases/<generationId>            the one activation pointer (relative symlink)
```

`gala-generation-marker.json` sits at the root of each generation directory (a
`public-generation-marker:2.0.0` document).

## Retention

Duty 9's default (the active generation plus five priors) is enforced two ways,
and both are real: `.gala-local-v2/history.json` records the abstract
certified-digest bookkeeping (`retainAndPersist`), and every successful
`activate` additionally **physically deletes** every `releases/<generationId>`
directory that falls out of that retained window. The active generation is never
a sweep candidate (it is always the head of the just-pruned history); every
deletion goes through `removeContainedTree`, which refuses to touch anything
outside the validated destination root. `test/retention.test.js` activates seven
generations in sequence and asserts exactly six release directories remain on
disk (the active one plus five priors), not just that the bookkeeping record
says so.

## Lifecycle calling convention

All eight `adapter-protocol` lifecycle functions are implemented; see
`@rathnasgala2/adapter-conformance-kit`'s README for the exact request/response
shapes this package follows (the convention that kit's reusable suite assumes
every adapter implements).

### The activation fence (`expectedCurrentGenerationId`)

`activate`'s `expectedCurrentGenerationId` is **mandatory** and is either a
generation identity or the adapter protocol's explicit `EXPECT_NOTHING_SERVED`
sentinel (`'gala:expect-nothing-served'`), re-exported from this package
alongside `fenceFor(observedGenerationId)`.

Until adapter protocol `2.1.0` this field accepted `null`, and this adapter —
like every other — read `null` as "no expectation, do not fence me". A caller
that genuinely meant "this is a first publish, refuse if anything is already
served" therefore got no fence at all and would happily overwrite a live
generation (LOCAL-47). There is now no value that disables the fence:

- `null`, `undefined`, `''` and any non-string are refused with an
  `AdapterProtocolError` carrying the `EXPECTED_GENERATION_FENCE_INVALID`
  finding code (a `TARGET_CONSTRAINT_ERROR`).
- `EXPECT_NOTHING_SERVED` genuinely fences: against a destination that is
  already serving a generation, `activate` returns `decision: 'reconcile'` and
  leaves the served generation untouched.
- Build the value from an observation with
  `fenceFor(before.currentGenerationId)` rather than passing
  `currentGenerationId` straight through.

`preflight`'s optional `expectedGenerationId` follows the same vocabulary: when
supplied it is validated as a fence value, and a destination serving nothing no
longer silently satisfies an expectation of some generation.

## Conformance to the DEC-097 oracle

DEC-097's `gala-local-directory-filesystem-v2` profile specifies an
implementation built on directory-fd-relative POSIX syscalls
(`openat`/`fstatat`/`readlinkat`/`symlinkat`/`renameat`/`linkat`/`unlinkat`), a
10,000-iteration atomic-replacement probe against a concurrent reader thread,
and an independently reviewed process-crash/power-loss injection laboratory.
Node.js's `node:fs` module does not expose directory-fd-relative syscalls
without a native addon, and building/reviewing a hardware-backed crash-injection
laboratory is a distinct, out-of-scope workstream from an in-process Node.js
adapter package. This package therefore implements the oracle's _behavioral
guarantees_ with the primitives actually available, documented here rather than
silently assumed:

- **Symlink-escape probing** (`src/fs-safety.js` `assertNoEscapingSymlink`): a
  sequential `lstat`-per-component ancestor walk from the validated root,
  refusing to traverse or replace any symlink it finds, rather than retaining an
  `O_NOFOLLOW`-opened directory descriptor for the whole lifecycle call. This is
  a TOCTOU-narrower approximation of the oracle's descriptor-retention
  guarantee, not its equal: a component could theoretically be swapped between
  the `lstat` and the subsequent operation. `activate`'s digest re-check before
  promotion (below) is the independent second line of defense against exactly
  this class of race.
- **Atomic activation**: a real `symlink` + `rename` pointer swap (POSIX
  guarantees `rename` onto an existing name is atomic on the same filesystem),
  not `renameat` against a retained root descriptor.
- **`fsync` discipline**: real `fsync` calls on every written file and its
  parent directory, and on the root/`.gala-local-v2` directories after
  bootstrap, using `fs.open(path, O_RDONLY)` + `fsync` (supported for
  directories on Linux and Darwin, the two admitted platforms).
- **The live filesystem probe** (`src/probe.js`): genuine `symlink`/
  `rename`/`readlink`/`link` syscalls against the actual destination root at
  capability-declaration time, proving atomic replacement and exclusive
  (`EEXIST`-on-conflict) control-row publication — but with 64 sequential
  replacement iterations and no concurrent reader thread, not the oracle's
  10,000 iterations against a concurrent reader. `PROBE_REPLACEMENT_ITERATIONS`
  in `src/probe.js` names the exact reduced count.
- **The bundled allowlist** (`src/allowlist.js`): DEC-097's allowlist entry is
  backed by a real hardware-tested laboratory whose four matrix digests
  (`atomicReplacementMatrixDigest`, `processCrashMatrixDigest`,
  `powerLossMatrixDigest`, `maliciousFilesystemMatrixDigest`) summarize that
  lab's results. This package bundles one entry per admitted platform tuple
  whose four digests are computed over this file's own literal,
  version-controlled placeholder text — real digests of real (checked-in) bytes,
  but not a real crash/power-loss laboratory run.
- **No raw `getrandom(...,0)`/`getentropy` binding**: stage tokens and scratch
  names use `node:crypto`'s CSPRNG (`randomUUID`/`randomBytes`), which is backed
  by the same platform CSPRNG the oracle names, just without a direct raw
  syscall binding.

None of these reductions weaken the properties this package's own tests check:
real atomic activation, real `fsync`-before-use, real symlink rejection, real
digest-checked activation refusal on a partial/tampered stage, and real on-disk
retention. They are a deliberate, documented scope reduction from DEC-097's full
raw-syscall oracle to what a pure Node.js package (no native addon, no
`TypeScript`, per this workspace's constraints) can honestly implement and
verify on a developer laptop or CI runner.

## Commands

```sh
npm run typecheck --workspace packages/adapter-local-directory
npm test --workspace packages/adapter-local-directory
```

`npm test` runs the conformance-kit suite against the real filesystem
(`test/conformance.test.js`) and the end-to-end test through `publish-kernel`
and a `@rathnasgala2/template`-rendered candidate directory
(`test/e2e-kernel-template.test.js`).
