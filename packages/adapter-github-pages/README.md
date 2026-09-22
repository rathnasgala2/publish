# @rathnasgala2/adapter-github-pages

The managed GitHub Pages deployment adapter (S4-T04, backlog W4-11). It
implements the eight `@rathnasgala2/adapter-protocol` lifecycle functions and
declares exactly the DEC-097 section 7 `github-pages` capability row.

## What it does

1. **stage** builds one deterministic gzip/POSIX.1-1988 ustar carrier from the
   frozen artifact plus the reserved public generation marker, and hands it to
   the caller-supplied Actions-artifact publisher. Nothing public changes:
   `staging: private` is literal.
2. **activate** re-reads the served generation, checks the mandatory activation
   fence, re-derives the artifact digest from the carrier bytes that will
   actually be deployed, verifies the caller-supplied Pages OIDC token's
   bindings, creates exactly one Pages deployment through the raw REST API with
   the caller-supplied installation token, and polls the deployment API to a
   terminal status. In `pages-reconciliation-recovery` mode it first resolves
   the prior attempt (DEC-097 section 6.2) before any current create.
3. **observe** verifies the result through credential-free public reads of the
   activated origin.
4. **rollback** is `reupload`: a fresh carrier for the selected historical
   content under a _new_ generation identity.

## What it deliberately does not do

DEC-097 section 6.2 closes each of these, and the capability declaration states
them as the weakest true claim rather than hiding them:

- it never invokes the opaque `actions/deploy-pages` action;
- it never mutates a branch and never assumes a source commit — a branch-based
  deployment would require `activation: branch-update`, which the closed
  `github-pages` capability row forbids;
- it never mints, refreshes, logs or persists a token; the caller supplies the
  installation token;
- it never uploads the Actions artifact itself: direct carrier upload is
  workflow-owned (DEC-097 section 2.3), so the destination supplies a
  `publishCarrier` callback;
- it never follows a provider-supplied `status_url`; that value is retained as
  evidence and every poll uses an independently constructed suffix-free URL;
- it declares `concurrency: none`, because Pages offers no compare-and-set on
  activation. `activate` still performs a read-then-compare against
  `expectedCurrentGenerationId` immediately before the create call, but that is
  honest best effort, not a provider fence;
- it never mints the Pages OIDC token and never verifies its issuer signature or
  fetches a JWKS: the token is caller-supplied, the trust boundary is the
  catalog-authorized runner token endpoint the workflow calls, and GitHub Pages
  is the relying party that cryptographically validates the JWT;
- it never mints a `pagesReconciliationRecovery` record, a run-attempt gap proof
  or a tombstone: it validates the server-minted record and refuses a malformed
  one;
- it declares `providerInventoryAssurance: none` and never claims complete
  deployed inventory; and
- it declares `cacheInvalidation: none` and has no purge authority.

## The activation fence (LOCAL-47)

`expectedCurrentGenerationId` is mandatory and is either a generation identity
or the explicit `EXPECT_NOTHING_SERVED` sentinel re-exported from this package.
`null` and `undefined` are refused with `EXPECTED_GENERATION_FENCE_INVALID`:
before adapter protocol `2.1.0` those spellings meant both "nothing is served"
and "do not fence me", and every adapter implemented the second reading, so a
first publish silently overwrote a live generation. Use `fenceFor(observed)` to
turn an observation into a fence.

## The nine-row request catalog

`src/request-catalog.js` declares exactly the nine DEC-097 section 7
`(stage, callClass)` rows — `inspect/pages-site`,
`activate/pages-create-deployment`, `activate/pages-deployment-status`,
`observe/pages-deployment-status`, `inspect/pages-recovery-prior-status`,
`cleanup-staged/pages-cancel-deployment`,
`cleanup-staged/pages-recovery-prior-cancel`, `rollback/pages-create-deployment`
and `rollback/pages-deployment-status` — sorted by member JCS bytes and digested
into `requestTemplateCatalogDigest`. Every row targets exactly
`https://api.github.com`, sends fixed `accept`, `accept-encoding: identity`,
`connection: close` and `x-github-api-version`, derives `host`, and carries one
`authorization` credential row with source `github-token` and prefix `Bearer `.
The two create rows add fixed `content-type: application/json`, derived
`content-length` and the `gala-pages-create-deployment-jcs-v2` body profile.

The `pagesDeploymentId` segment is chosen **statically by the call class**: the
seven ordinary/current rows take the intent's reserved 40-lowercase-hex
`pagesBuildVersion`, and the two `pages-recovery-prior-*` rows take
`pagesRecovery.priorPagesBuildVersion`. No provider response and no workflow
value can select it, and the two recovery-prior rows are refused outright in
`normal` mode.

Both facts are **declared**, not merely enforced: `CALL_CLASS_BINDING` is the
nine-row `limits.callClassBinding` block of the capability document
(`{stage, callClass, pagesDeploymentIdSource, recoveryOnly}`, JCS-sorted, schema
2.8.0 / LOCAL-52 (2)), bound by `limits.callClassBindingDigest` computed with
the schema package's own exported `providerCallClassBinding` profile
(`@rathnasgala2/schemas/digest-profiles`, 2.8.1) — the byte-identical
computation the contract validator checks, no longer a locally restated domain
string. It is deliberately not folded into `requestTemplateCatalogDigest`: the
template preimage is byte-identical to before the block was declared, and a test
pins that digest so a change to it is a contract change rather than a refactor.
`src/rest.js` resolves the source and the recovery-only rule from the declared
rows through `callClassIdBinding(stage, callClass)`.

## The create body and the two credentials

The create request entity is exactly the compact JCS of
`{artifact_id, oidc_token, pages_build_version}` — three members, no more and no
fewer, `artifact_id` a JSON integer in `1..9007199254740991`. `oidc_token` is
**mandatory**. The workflow's `deploy-github-pages` job acquires it from
`ACTIONS_ID_TOKEN_REQUEST_URL` (that is what its `id-token: write` is for) and
passes it in as `pagesOidcToken` (or `destination.oidcToken`) together with the
expected bindings as `pagesOidcClaims` (or `destination.oidcClaims`):

```js
await activate({
  destination, // must also carry repositoryId and repositoryOwnerId
  stageToken,
  generationId,
  expectedCurrentGenerationId: EXPECT_NOTHING_SERVED, // or a generation id
  pagesOidcToken: process.env.PAGES_OIDC_TOKEN,
  pagesOidcClaims: {
    ref,
    sha,
    runId,
    runAttempt,
    jobWorkflowRef,
    jobWorkflowSha,
  },
});
```

Before placing the JWT in the body — and only in the body — the adapter parses
its three compact segments, requires canonical unpadded base64url and
duplicate-key-free JSON header and payload, and checks issuer, audience
`https://github.com/<repository-owner>`, one of the two supported default
environment subject forms recomputed from the separately verified `repository`,
`repository_owner`, `repository_id` and `repository_owner_id` claims,
`environment: github-pages`, and the ref/SHA/run/`job_workflow_*` bindings the
caller supplies. The OIDC token never appears in a header, evidence, digest,
output, log or thrown message; the GitHub token never appears in the body. Both
directions are enforced by `src/redaction.js` and tested.

## Reconciliation recovery

`src/recovery.js` validates the server-minted `pagesReconciliationRecovery`
record (including its `recoveryDigest`, its `pagesRunAttemptGapProof` and every
`closed-no-destination-authority` tombstone digest) and then, before any current
carrier is created, polls the prior attempt's catalog-constructed status
endpoint using only `priorPagesBuildVersion`:

| prior observation                     | outcome                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| terminal `succeed`                    | no new create; terminalize as `terminal-candidate`                |
| terminal non-success                  | record the exact status; proceed with the fresh create            |
| temporary status or 404               | exactly one cataloged cancel, then bounded polling                |
| still-temporary/404/malformed/unknown | truthful evidence, no create, authority `reconciliation-required` |

`recoverPriorAttempt({destination, pagesRecovery})` exposes the same precheck
separately, so the deploy script can run it before `stage` uploads a carrier.

## The exact status vocabulary and poll schedule

The eleven accepted statuses, their temporary/terminal partition (with
`deployment_attempt_error` temporary, because GitHub retries it automatically)
and the exact `5, 8, 12, 18, 27, 30`-then-`30` poll schedule live in
`src/constants.js` and are asserted in `test/index.test.js`. An unknown,
malformed or ambiguous status can never release the destination fence.

## Destination shape

```js
{
  (owner,
    repository,
    repositoryId,
    repositoryOwnerId,
    apiOrigin, // https origin; defaults to https://api.github.com
    publicBaseUrl, // https origin of the activated Pages site
    token, // caller-supplied installation token
    oidcToken, // caller-supplied Pages OIDC JWT (or pass per-activate)
    oidcClaims, // its expected ref/sha/run/job_workflow bindings
    publishCarrier, // ({bytes, generationId, carrierDigest}) => {pagesArtifactId}
    fetch,
    publicFetch,
    sleep,
    runId,
    runAttempt); // all optional injection points
}
```

## Evidence

`test/conformance.test.js` runs the full `@rathnasgala2/adapter-conformance-kit`
suite against a local fake provider that speaks real HTTP, genuinely gunzips and
untars the carrier this adapter produced, and serves the result from a separate
public origin. `test/carrier.test.js` holds the codec goldens. What none of that
can prove is the live GitHub Pages deployment API itself; that is backlog W4-16.

## Commands

```sh
npm run typecheck --workspace packages/adapter-github-pages
npm test --workspace packages/adapter-github-pages
```
