/**
 * The GitHub Action's Node 24 runner entry (`action.yml`'s `runs.main`):
 * composes normalization -> `renderPublication` -> kernel -> the selected
 * adapter (S2-T20 deliverable (3)). Author inputs cover repository
 * directory, output directory, work directory, profile, adapter selection
 * and adapter configuration path; there is no author-supplied operation id,
 * challenge id, generation identity or other dynamic managed value (those
 * are S4's domain). Outputs cover manifest path and digest, artifact
 * directory and digest, route count, byte count and the typed result code.
 *
 * Inputs are read the way `runs.using: node24` exposes them without
 * `@actions/core`: `INPUT_<NAME>` environment variables, uppercased with
 * spaces mapped to underscores (GitHub's own documented convention).
 * Outputs are appended to the file named by `GITHUB_OUTPUT`
 * (`name<<EOF\nvalue\nEOF\n` multiline-safe form), the modern replacement
 * for the deprecated `::set-output` workflow command.
 *
 * @module
 */

import { appendFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { runBuild } from '../commands/build.js';
import { deployToLocalDirectory } from '../deploy-local-directory.js';
import { assertImplementedAdapter } from '../adapter-select.js';
import { findingsFromError } from '../error-findings.js';
import { buildResultEnvelope, classifyFindings } from '../result.js';

/**
 * @param {string | undefined} value the raw "profile" input value
 * @returns {'directory-index' | 'explicit-file' | undefined} the validated
 *   route-normalization profile, or `undefined` when absent
 */
function parseRouteNormalizationProfile(value) {
  if (value === 'directory-index' || value === 'explicit-file') {
    return value;
  }
  return undefined;
}

/**
 * @param {string} name the input's declared `action.yml` id
 * @param {NodeJS.ProcessEnv} env the process environment
 * @returns {string | undefined} the input's value, when supplied
 */
function actionInput(name, env) {
  const key = `INPUT_${name.replace(/ /gu, '_').toUpperCase()}`;
  const value = env[key];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Write one `name=value` output pair through the `GITHUB_OUTPUT` file
 * protocol, multiline-safe with a random delimiter.
 *
 * @param {string} outputFile the file `GITHUB_OUTPUT` names
 * @param {string} name the output's declared `action.yml` id
 * @param {string} value the output's value
 * @returns {Promise<void>} resolves once appended
 */
async function writeActionOutput(outputFile, name, value) {
  const delimiter = `ghadelimiter_${randomBytes(16).toString('hex')}`;
  await appendFile(
    outputFile,
    `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
  );
}

/**
 * Run the Action end to end against the real process environment, writing
 * outputs and the machine-readable result envelope, then return the exit
 * code the runner entry should use.
 *
 * @param {NodeJS.ProcessEnv} [env] the process environment (injectable for tests)
 * @returns {Promise<number>} the process exit code
 */
export async function runAction(env = process.env) {
  const cwd = env.GITHUB_WORKSPACE ?? process.cwd();
  const repositoryDirectory = path.resolve(
    cwd,
    actionInput('repository-directory', env) ?? '.',
  );
  const outputDirectory = path.resolve(
    cwd,
    actionInput('output-directory', env) ??
      path.join(repositoryDirectory, '.gala', 'output'),
  );
  const workDirectory = path.resolve(
    cwd,
    actionInput('work-directory', env) ??
      path.join(repositoryDirectory, '.gala', 'work'),
  );
  const routeNormalizationProfile = parseRouteNormalizationProfile(
    actionInput('profile', env),
  );
  const adapter = actionInput('adapter', env) ?? 'local-directory';
  const adapterConfigPath = actionInput('adapter-config-path', env);
  const githubOutput = env.GITHUB_OUTPUT;

  /** @type {Record<string, unknown>} */
  let envelope;
  try {
    assertImplementedAdapter(adapter);

    const buildResult = await runBuild({
      repositoryDirectory,
      outputDirectory,
      workDirectory,
      ...(routeNormalizationProfile ? { routeNormalizationProfile } : {}),
    });
    if (buildResult.resultCode !== 'SUCCESS' || !buildResult.outputDirectory) {
      envelope = { ...buildResult, command: 'publish' };
    } else {
      if (!adapterConfigPath) {
        throw Object.assign(
          new Error(
            'adapter-config-path input is required when adapter is "local-directory"',
          ),
          {
            findings: [
              {
                code: 'ADAPTER_CONFIGURATION_MISSING',
                severity: 'SOURCE_ERROR',
                detail:
                  'The "adapter-config-path" input is required and must name a JSON file with a "root" field.',
                recovery:
                  'Add adapter-config-path pointing at a JSON file: { "root": "<absolute destination path>" }.',
                overridable: false,
              },
            ],
          },
        );
      }
      const adapterConfig = JSON.parse(
        await readFile(path.resolve(cwd, adapterConfigPath), 'utf8'),
      );
      const destinationRoot = path.resolve(cwd, adapterConfig.root);

      const deployResult = await deployToLocalDirectory({
        outputDirectory: buildResult.outputDirectory,
        manifest: /** @type {Record<string, unknown>} */ (buildResult.manifest),
        destinationRoot,
      });

      if (
        deployResult.findings.length > 0 ||
        deployResult.decision !== 'activate'
      ) {
        const { resultCode, exitCode } = classifyFindings(
          deployResult.findings.length > 0
            ? deployResult.findings
            : [
                {
                  code: 'LOCAL_DIRECTORY_RECONCILED',
                  severity: 'TARGET_CONSTRAINT_ERROR',
                  detail:
                    'The destination changed since preflight; the candidate reconciled instead of activating.',
                  recovery: 'Retry once the destination is quiescent.',
                  overridable: false,
                },
              ],
        );
        envelope = buildResultEnvelope({
          command: 'publish',
          resultCode,
          exitCode,
          findings: deployResult.findings,
        });
      } else {
        envelope = buildResultEnvelope({
          command: 'publish',
          resultCode: 'SUCCESS',
          exitCode: 0,
          findings: [],
          ...(buildResult.manifestPath !== undefined
            ? { manifestPath: buildResult.manifestPath }
            : {}),
          ...(buildResult.manifestDigest !== undefined
            ? { manifestDigest: buildResult.manifestDigest }
            : {}),
          artifactDirectory: buildResult.outputDirectory,
          artifactDigest: deployResult.artifactDigest,
          routeCount: deployResult.routeCount,
          byteCount: deployResult.byteCount,
        });
      }
    }
  } catch (error) {
    const findings = findingsFromError(error);
    const { resultCode, exitCode } = classifyFindings(findings);
    envelope = buildResultEnvelope({
      command: 'publish',
      resultCode,
      exitCode,
      findings,
    });
  }

  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  if (githubOutput) {
    await writeActionOutput(
      githubOutput,
      'result-code',
      String(envelope.resultCode),
    );
    /** @type {[string, string][]} */
    const outputMap = [
      ['manifest-path', 'manifestPath'],
      ['manifest-digest', 'manifestDigest'],
      ['artifact-directory', 'artifactDirectory'],
      ['artifact-digest', 'artifactDigest'],
      ['route-count', 'routeCount'],
      ['byte-count', 'byteCount'],
    ];
    for (const [name, key] of outputMap) {
      const value = envelope[key];
      if (value !== undefined) {
        await writeActionOutput(githubOutput, name, String(value));
      }
    }
  }
  return /** @type {number} */ (envelope.exitCode);
}

/* c8 ignore start -- process entry glue */
if (import.meta.url === `file://${process.argv[1]}`) {
  runAction()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${(error && error.stack) || String(error)}\n`);
      process.exitCode = 70;
    });
}
/* c8 ignore stop */
