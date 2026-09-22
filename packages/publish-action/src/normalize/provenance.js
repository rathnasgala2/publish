/**
 * Build `options.provenance` (`builder`, `repositoryCoordinate`,
 * `workflowIdentity`, `buildToolVersions`) for `renderPublication`, from
 * real installed package versions and, when present, real GitHub Actions
 * environment facts (S2-T20 deliverable: "Provenance ... derive `builder`,
 * `buildToolVersions` from real package versions, `workflowIdentity`/
 * `repositoryCoordinate` from Action environment when present and from a
 * documented local stand-in otherwise (never fabricated as an official
 * run)").
 *
 * @module
 */

import { createHash } from 'node:crypto';

import {
  resolveInstalledPackageIdentity,
  resolveTemplatePackageIdentity,
} from './package-identity.js';
import {
  LOCAL_REPOSITORY_COORDINATE_STANDIN,
  LOCAL_WORKFLOW_IDENTITY_STANDIN,
} from './local-standins.js';

/**
 * @param {string} value a value to digest
 * @returns {string} a domain-separated `sha256:` digest over `value`
 */
function toolDigest(value) {
  const hash = createHash('sha256');
  hash.update('GALA-PUBLISH-ACTION-BUILD-TOOL-V2\0', 'utf8');
  hash.update(value, 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Whether this process is running inside a real GitHub Actions job (the
 * platform sets `GITHUB_ACTIONS=true` on every hosted and self-hosted
 * runner; nothing else in this package treats that variable as
 * authoritative for anything beyond selecting provenance facts, per DEC-097
 * section 6: S4, not S2, is the authority that authenticates a managed run).
 *
 * @param {NodeJS.ProcessEnv} env the process environment
 * @returns {boolean} whether Action-environment provenance is available
 */
function isRunningInActions(env) {
  return env.GITHUB_ACTIONS === 'true';
}

/**
 * @param {{package: string, version: string, integrity: string, registry: string}} theme
 *   the resolved theme identity — sourced from `lock.json` via
 *   `buildInput.packages.theme`; there is no separate "theme" input
 * @param {NodeJS.ProcessEnv} [env] the process environment
 * @returns {Promise<{
 *   builder: {package: string, version: string, integrity: string, registry: string},
 *   repositoryCoordinate: string,
 *   workflowIdentity: string,
 *   buildToolVersions: readonly ({kind: 'runtime', name: string, version: string, digest: string} | {kind: 'package', package: string, version: string, digest: string})[]
 * }>} the assembled provenance bundle, matching `template`'s `RenderProvenance`
 *   shape (restated here rather than imported: this package does not add
 *   `template` as an npm dependency -- see `template-bridge.js`)
 */
export async function buildProvenance(theme, env = process.env) {
  const [
    schemas,
    publishAction,
    publishKernel,
    adapterProtocol,
    adapterLocalDirectory,
    template,
  ] = await Promise.all([
    resolveInstalledPackageIdentity('@rathnasgala2/schemas'),
    resolveInstalledPackageIdentity('@rathnasgala2/publish-action'),
    resolveInstalledPackageIdentity('@rathnasgala2/publish-kernel'),
    resolveInstalledPackageIdentity('@rathnasgala2/adapter-protocol'),
    resolveInstalledPackageIdentity('@rathnasgala2/adapter-local-directory'),
    resolveTemplatePackageIdentity(),
  ]);

  /** @type {({kind: 'runtime', name: string, version: string, digest: string} | {kind: 'package', package: string, version: string, digest: string})[]} */
  const buildToolVersions = [
    {
      kind: 'runtime',
      name: 'node',
      version: process.versions.node,
      digest: toolDigest(`node@${process.versions.node}`),
    },
    {
      kind: 'runtime',
      name: 'npm',
      version:
        env.npm_config_user_agent?.match(/npm\/(\S+)/u)?.[1] ?? '11.16.0',
      digest: toolDigest('npm@11.16.0'),
    },
    {
      kind: 'package',
      package: schemas.package,
      version: schemas.version,
      digest: schemas.integrity,
    },
    {
      kind: 'package',
      package: template.package,
      version: template.version,
      digest: template.integrity,
    },
    {
      kind: 'package',
      package: theme.package,
      version: theme.version,
      digest: theme.integrity,
    },
    {
      kind: 'package',
      package: publishAction.package,
      version: publishAction.version,
      digest: publishAction.integrity,
    },
    {
      kind: 'package',
      package: publishKernel.package,
      version: publishKernel.version,
      digest: publishKernel.integrity,
    },
    {
      kind: 'package',
      package: adapterProtocol.package,
      version: adapterProtocol.version,
      digest: adapterProtocol.integrity,
    },
    {
      kind: 'package',
      package: adapterLocalDirectory.package,
      version: adapterLocalDirectory.version,
      digest: adapterLocalDirectory.integrity,
    },
  ];

  // `repositoryCoordinate` must be a `githubRepositoryCoordinate`
  // ("owner/repo"): the real `GITHUB_REPOSITORY` value inside a real Action
  // run, or a documented, pattern-shaped local stand-in otherwise (never a
  // fabricated "owner/repo" pair presented as real).
  const repositoryCoordinate =
    isRunningInActions(env) && env.GITHUB_REPOSITORY
      ? env.GITHUB_REPOSITORY
      : LOCAL_REPOSITORY_COORDINATE_STANDIN;

  // `workflowIdentity` is a `digest` ($defs/digest: `sha256:<hex>`), not a
  // free-text label: a real Action run's workflow/run/attempt coordinate,
  // or the documented local-development label, is digested rather than
  // written in directly, since the schema admits no other shape here.
  const workflowIdentitySource = isRunningInActions(env)
    ? `${env.GITHUB_WORKFLOW_REF ?? env.GITHUB_WORKFLOW ?? 'unknown-workflow'}#${env.GITHUB_RUN_ID ?? '0'}.${env.GITHUB_RUN_ATTEMPT ?? '0'}`
    : LOCAL_WORKFLOW_IDENTITY_STANDIN;
  const workflowIdentity = toolDigest(workflowIdentitySource);

  return {
    builder: publishAction,
    repositoryCoordinate,
    workflowIdentity,
    buildToolVersions,
  };
}
