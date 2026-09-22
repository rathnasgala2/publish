# The author-installed caller

`gala-publish-v2.yml` in this directory is the fixed caller contract. Copy it
verbatim to `.github/workflows/gala-publish-v2.yml` in your publication
repository and change only the two marked values.

Gala never writes this file for you. S3 reads your repository's declared
workflow graph at the exact candidate or trigger commit and admits the caller
only when its **path, digest, full-SHA reusable-workflow pin, trigger,
permissions, input set, secret map and guard** all equal this contract. A
missing or stale caller is an explicit recoverable publication state you fix by
updating the file — never permission for Gala to generate or patch one.

## What you must replace

| Value                        | Where it comes from                                     |
| ---------------------------- | ------------------------------------------------------- |
| the 40-hex pin after `@`     | the `rathnasgala2/publish` commit Gala tells you to pin |
| `service_origin_catalog_url` | the signed Gala service-origin catalog location         |

## What you must not change

- the two triggers, `create` and `workflow_dispatch`, and nothing else;
- the five-permission union `actions: read`, `contents: read`,
  `id-token: write`, `pages: write`, `attestations: write`;
- the coarse guard expression;
- the three-entry secret map. `secrets: inherit` is never permitted, an unknown
  mapping is rejected, and a control-plane secret must never appear here.

## What your build must leave in `$GALA_OUTPUT_DIR`

The managed `build` job runs your repository's `npm run build` inside the
network-disabled sandbox with exactly one writable path, `$GALA_OUTPUT_DIR`.
Freeze reads two things from it and nothing else:

| Path                                           | What it is                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `$GALA_OUTPUT_DIR/artifact/`                   | the artifact inventory (`publish-action build --output`)                                  |
| `$GALA_OUTPUT_DIR/work/artifact-manifest.json` | the complete `artifact-manifest:2.0.0` the renderer wrote (`publish-action build --work`) |

So the build script is
`gala-publish build --output "$GALA_OUTPUT_DIR/artifact" --work "$GALA_OUTPUT_DIR/work"`
(or its `npx` equivalent). The manifest is validated against the pinned schema
and matched one-for-one against the artifact files; a file the manifest does not
name, a missing manifest or an artifact that carries the reserved
`.well-known/gala-generation.json` fails freeze by name. Only the manifest's
inventory is ever staged.

## The secrets and environments you provision

These are DEC-015 names. Create each one in the right place; they are never
shared across environments, and the two Spaces credential families never meet in
the same job.

### Repository or organization Actions secrets (source of the caller map)

| Name                               | Purpose                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DO_SPACES_DATA_ACCESS_KEY_ID`     | Limited Spaces key, exact `Read/Write/Delete` on both buckets. Required for a Spaces publication. |
| `DO_SPACES_DATA_SECRET_ACCESS_KEY` | Its secret. Required for a Spaces publication.                                                    |
| `DO_SPACES_SESSION_TOKEN`          | Optional STS session token; leave unset when you do not use one.                                  |

The caller maps them to the three `CALLER_*` names the reusable workflow
declares, all `required: false`:

```text
CALLER_DO_SPACES_ACCESS_KEY_ID: ${{ secrets.DO_SPACES_DATA_ACCESS_KEY_ID }}
CALLER_DO_SPACES_SECRET_ACCESS_KEY: ${{ secrets.DO_SPACES_DATA_SECRET_ACCESS_KEY }}
CALLER_DO_SPACES_SESSION_TOKEN: ${{ secrets.DO_SPACES_SESSION_TOKEN }}
```

### Environment `gala-production` (Spaces publications only)

This environment gates the one job permitted to hold the protected full-access
control key. Put a required-reviewer or wait-timer protection rule on it: the
verifier job cannot start until GitHub records that decision.

| Name                                  | Purpose                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `DO_SPACES_CONTROL_ACCESS_KEY_ID`     | Full-access control key. DigitalOcean requires `All (Buckets and Objects)` for `GetBucketWebsite`. |
| `DO_SPACES_CONTROL_SECRET_ACCESS_KEY` | Its secret.                                                                                        |
| `DO_SPACES_CONTROL_SESSION_TOKEN`     | Optional STS session token.                                                                        |

None of this key's bytes or derived authorization values may enter a caller
secret, a job output, an artifact, a digest, a log, a Gala request or the deploy
job. The deploy job has **no** `environment` key precisely so GitHub's
environment-secret precedence cannot substitute one family for the other.

### Environment `github-pages` (Pages publications only)

No secret. The Pages deploy job runs under this environment and receives only
its job-scoped GitHub token and OIDC authority.

Both environments must resolve in your own repository. Resolution to the
reusable-workflow repository, an absent environment, or an environment-secret
substitution across the two credential families is rejected.

## The Spaces buckets you provision

Provisioning the accepted configuration and both keys is an author-owned
ceremony outside the publish run; the workflow never creates or deletes a bucket
and never writes a bucket configuration.

- two distinct lower-case, dot-free buckets in one region;
- the served bucket configured as a website with index document `index.html`,
  the generated `404.html` error document, no redirect-all rule and no routing
  rules;
- the staging bucket with no website configuration at all;
- the limited caller key restricted to `Read/Write/Delete` on both buckets, and
  provably unable to perform `GetBucketWebsite` — the deploy adapter proves it
  receives `403 AccessDenied` before it mutates anything.
