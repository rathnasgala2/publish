# @rathnasgala2/adapter-do-spaces

The managed DigitalOcean Spaces deployment adapter (S4-T05, backlog W4-11). It
implements the eight `@rathnasgala2/adapter-protocol` lifecycle functions and
declares exactly the DEC-097 section 7 `do-spaces` capability row.

## The two-bucket binding

Two distinct lower-case, dot-free buckets in one admitted region:

| Role    | Bucket          | Origin                                                          |
| ------- | --------------- | --------------------------------------------------------------- |
| served  | `servedBucket`  | `https://<servedBucket>.<region>.digitaloceanspaces.com`        |
| staging | `stagingBucket` | `https://<stagingBucket>.<region>.digitaloceanspaces.com`       |
| public  | `servedBucket`  | `https://<servedBucket>.<region>-static.digitaloceanspaces.com` |

`src/origins.js` refuses one bucket for both roles, a dotted bucket name, an
unrecognised region, and — as the public base URL — a CDN endpoint, a custom
domain or a plain object origin, all before a credential is used.

## The closed request catalog is the whole API surface

`src/request-catalog.js` is DEC-097 section 7's exact 24-row Spaces union as
data: one row for each `(stage, callClass)`, sorted by member JCS bytes and
digested into `requestTemplateCatalogDigest`. Every provider call names the row
it is issuing, and `src/s3.js` renders the method, origin, request target,
canonical query profile and the complete fixed/derived/credential header set
**from that row**. A wrong origin, a query parameter outside the declared
profile, an object-metadata set the row does not declare or any undeclared
header throws before egress, and `requireTemplate` refuses an undeclared
`(stage, callClass)` with `SPACES_CALL_NOT_IN_CATALOG`.

The catalog has **no object-`GET` row**, so this adapter issues none:

- the activation marker is read over the credential-free website origin, and the
  ETag the conditional pointer write needs comes from the declared
  `inspect/object-head` `HEAD` row;
- the served root is written from the frozen envelope's own bytes — `activate`
  and `rollback` take an optional `files`, falling back to what this run itself
  staged — never from a read-back;
- there is no `stage.json` control object: the stage token is a pure, reversible
  projection of the three identity segments, so cleanup inverts it
  arithmetically and still refuses any prefix this adapter could not itself have
  derived.

Exactly one header family is sent outside the catalog: the best-effort
`If-Match`/`If-None-Match` guard on the marker write, whose value is a
provider-returned ETag and so is not representable as a fixed or derived row. It
is unsigned, is admitted only on the three `generation-marker-put` rows, and is
precisely why this adapter declares `concurrency: best-effort`.

## Object metadata

Every full-object write (single `PUT` and multipart _create_) signs DEC-097's
three-row object metadata set plus an ACL: `x-amz-acl: private` on every stage
write, `x-amz-acl: public-read` on every served-root or marker write.

- `content-type` is always a member of the closed `DEPLOYMENT_MEDIA_TYPES` list.
- `cache-control` is `public, max-age=31536000, immutable` exactly when the
  staged file carries `immutable: true`, and `no-cache` otherwise.
- `x-amz-meta-gala-sha256` is the **untagged** 64-hex payload SHA-256.

The generation marker's three values are fixed at
`application/json; charset=utf-8`, `no-store` and the untagged SHA-256 of its
exact compact-JCS bytes.

## The control plane is a separate, closed catalog

`src/control-plane.js` holds DEC-097's four-row
`gala-do-spaces-control-plane-http-v2` catalog (`GET <apiOrigin>/?website=`) and
its three response profiles. It is deliberately _not_ part of
`gala-do-spaces-sigv4-v2`: a configuration read is not an object mutation, and
the point of the split is that the limited deployment key must be unable to
perform one.

`proveLimitedKeyAccessDenied({destination, fetch?})` issues exactly the two
`limited-deployment` rows with the limited caller key and requires each to
answer HTTP 403 with the exact code `AccessDenied`. A 2xx/3xx raises
`SPACES_LIMITED_KEY_OVERPRIVILEGED`; anything else — a 404 absence, a malformed
body, a different code — raises `SPACES_LIMITED_KEY_DENIAL_UNPROVEN`. Both are
raised before a single object is mutated, and the returned evidence record is
credential-free. The two `full-control` rows belong to the separate
configuration-verifier job and are never executed by this package.

## The activation fence

`expectedCurrentGenerationId` is mandatory (adapter protocol 2.1.0, LOCAL-47).
It is either a generation identity or the exported `EXPECT_NOTHING_SERVED`
sentinel; `null` and `undefined` are refused with
`EXPECTED_GENERATION_FENCE_INVALID`, so a caller can no longer silently activate
unfenced, and the sentinel genuinely refuses to overwrite a destination that
already serves a generation.

## The lifecycle

1. **stage** writes the complete generation plus its marker under the reserved
   `_gala/staged/v2/<operationId>/<attemptId>/<generationId>/root/` prefix in
   the private staging bucket, so a stale private object can never contaminate
   served inventory. Objects above the declared 5 MiB single-part ceiling go
   through the cataloged multipart calls, and a failed multipart upload is
   aborted rather than left unaccepted.
2. **activate** reads the activation pointer over the website origin, resolves
   the bytes to serve (`files`, else this run's own stage record), re-derives
   the artifact digest, diffs the new inventory against the served root, writes
   every object, deletes every superseded object and writes the pointer **last**
   under a conditional guard, then re-reads it to confirm.
3. **observe** verifies through the public website origin, the declared
   `observe/object-head` row and a complete served-root enumeration.
4. **cleanupStaged** deletes exactly this operation's private prefix, derived by
   inverting the stage token, and refuses any prefix outside the reserved
   staging prefix.
5. **rollback** is `reupload`, re-promoting through the `rollback/*` rows from
   caller-supplied `files` or from what this run itself staged. A generation
   that is neither fails closed with `ROLLBACK_INPUT_UNAVAILABLE`: there is no
   honest third source.

## Honest negative claims

- `activation: replace-in-place`, never `pointer-swap`: a mixed-generation
  window between the first object write and the pointer write genuinely exists.
- `concurrency: best-effort`: read-then-compare plus a conditional pointer write
  is better than nothing and less than a fence.
- `providerInventoryAssurance: none`: an S3 `ETag` is not a content digest.
- `cacheInvalidation: none`: this adapter has no purge authority.
- It never creates or deletes a bucket, never mutates a bucket configuration,
  and never touches the protected full-access control key — the
  configuration-verification job owns that key and hands this adapter only
  credential-free evidence.

## Why SigV4 is implemented here rather than through an AWS SDK

DEC-097 requires this adapter to declare an _exact_ request catalog — method,
origin, request target, canonical query profile, fixed/derived/credential
headers and body profile — for every call it is permitted to make. A
general-purpose SDK builds requests its caller cannot fully enumerate (retries,
middleware, checksum negotiation, endpoint resolution), which would make that
declaration untruthful. `src/sigv4.js` is roughly 200 lines against
`node:crypto` and keeps this workspace's dependency surface at exactly the
pinned `@rathnasgala2` packages.

`host`, the `x-amz-*` family (including `x-amz-acl`), `content-type` and
`cache-control` are signed. `accept-encoding`, `connection` and `content-length`
are declared and sent but deliberately not signed: they are transport-computed
or hop-by-hop, and any client or proxy may legitimately compute or rewrite them,
so signing them would turn a legitimate rewrite into `SignatureDoesNotMatch`.
The conditional guard is likewise sent unsigned.

## Evidence

- `test/sigv4.test.js` replays the published AWS `aws-sig-v4-test-suite`
  `get-vanilla` vector: an expected signature this repository did not compute.
- `test/request-catalog.test.js` pins the catalog itself against DEC-097's
  24-row union, origin assignment, per-call matrix, header sets and JCS sort.
- `test/request-catalog-binding.test.js` drives a complete lifecycle through a
  gating `fetch` and asserts **zero** undeclared requests, that every wire
  request matches the row the adapter announced, and that every row the
  lifecycle is meant to exercise was exercised.
- `test/conformance.test.js` runs the full conformance kit against an in-process
  S3-compatible fake on real HTTP.
- `test/minio-conformance.test.js` runs the **identical** fixture against a
  throwaway MinIO container, which validates every signature independently. It
  is opt-in so `npm test` passes without a container runtime:

  ```sh
  scripts/minio-spaces.sh up
  SPACES_MINIO_ENDPOINT=http://127.0.0.1:59310 \
    npm test --workspace packages/adapter-do-spaces
  scripts/minio-spaces.sh down
  ```

  PUB-M10: `.github/workflows/nightly.yml`'s `spaces-minio-conformance` job runs
  this every night, so the strongest local evidence for this adapter is no
  longer generated only when someone runs it by hand.

What none of that proves is DigitalOcean Spaces itself — the website
configuration, the control-key `AccessDenied` check and the real static origin.
That is backlog W4-16.

## Errors

Every refusal this package raises is a `SpacesAdapterError` (`src/errors.js`,
exported from the package root), never a bare `Error`: it carries a stable,
machine-readable `code` property alongside the ordinary `Error` message, so a
caller can write `error.code === 'SPACES_PROVIDER_STATUS_UNEXPECTED'` instead of
parsing `.message`. `.message` is `${code}: ${detail}`, so a caller matching a
code inside the message still works. The code vocabulary is closed and stable:
`grep -rn "new SpacesAdapterError(" src` lists every code this package can
raise, grouped by the module that raises it (SigV4 signing, the request catalog,
staging, the control plane, capability declaration). A new code is an additive
change; renaming or removing one is breaking and belongs in `CHANGELOG.md`.

## Commands

```sh
npm run typecheck --workspace packages/adapter-do-spaces
npm test --workspace packages/adapter-do-spaces
```
