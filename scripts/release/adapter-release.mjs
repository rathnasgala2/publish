#!/usr/bin/env node
/**
 * Release planning for `.github/workflows/release.yaml`, the only
 * workflow that publishes to npm. Two subcommands, both read-only against the
 * repository and the public npm registry:
 *
 * - `plan` decides which adapter packages a run releases. A
 *   `workflow_dispatch` run releases the one package it names. A `push` run
 *   releases every package whose *packed* files (what `npm pack` would ship:
 *   `src/`, `types/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`)
 *   changed between the push's `before` and `sha`; a change to a test or to
 *   another unpacked file releases nothing. Every selected package must have a
 *   declared version that is new on npm. A push that changes a packed path of a
 *   package whose declared version is already on npm FAILS the run: it never
 *   skips silently, and it publishes nothing from that push, so a half-bumped
 *   push cannot release a protocol without the adapters that depend on it.
 *   Writes `packages=<JSON array in dependency order>` to `$GITHUB_OUTPUT`.
 * - `check <packages/adapter-name>` exits non-zero unless that package's
 *   declared version is still new on npm. The publish job runs it right before
 *   it installs anything, after any wait behind an earlier run of the same
 *   package.
 *
 * The registry is read with `npm view <name> versions --json`, stdout and
 * stderr kept apart (PUB-M13): only an `E404` document means "never
 * published"; any other failure stops the run instead of reading as "new".
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { runIfMain } from '../run-if-main.mjs';

/**
 * The publishable adapter family in dependency order: the protocol first, then
 * the three destination adapters (which depend on it). `adapter-conformance-kit`
 * is private and never listed. `test/adapter-release.test.mjs` proves this list
 * equals the workflow's `package` choices and push path filters.
 */
export const RELEASE_ORDER = Object.freeze([
  'adapter-protocol',
  'adapter-local-directory',
  'adapter-github-pages',
  'adapter-do-spaces',
]);

const STRICT_VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;

/**
 * @param {string} version a version string
 * @returns {[number, number, number] | null} its three numbers, or null when it
 *   is not a plain `x.y.z` version
 */
export function parseVersion(version) {
  const match = STRICT_VERSION.exec(version);
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * @param {readonly number[]} left first version triple
 * @param {readonly number[]} right second version triple
 * @returns {number} negative, zero or positive as left is below, equal to or
 *   above right
 */
function compareTriples(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * @typedef {{ state: 'unpublished' }
 *   | { state: 'published' }
 *   | { state: 'stale', newest: string }
 *   | { state: 'invalid' }} VersionVerdict
 */

/**
 * Compare a declared version with what the registry lists for the package.
 *
 * @param {string} version the version `package.json` declares
 * @param {readonly string[]} publishedVersions every version the registry lists
 * @returns {VersionVerdict} `unpublished` (new and newer than everything
 *   listed), `published` (already listed), `stale` (not listed but not newer
 *   than the newest plain release listed, so publishing it would be out of
 *   order) or `invalid` (not a plain `x.y.z` version)
 */
export function classifyDeclaredVersion(version, publishedVersions) {
  const declared = parseVersion(version);
  if (declared === null) {
    return { state: 'invalid' };
  }
  if (publishedVersions.includes(version)) {
    return { state: 'published' };
  }
  /** @type {{ text: string, triple: [number, number, number] } | null} */
  let newest = null;
  for (const text of publishedVersions) {
    const triple = parseVersion(text);
    if (
      triple !== null &&
      (newest === null || compareTriples(triple, newest.triple) > 0)
    ) {
      newest = { text, triple };
    }
  }
  if (newest !== null && compareTriples(declared, newest.triple) <= 0) {
    return { state: 'stale', newest: newest.text };
  }
  return { state: 'unpublished' };
}

/**
 * Select the packages that changed a packed path, in release order.
 *
 * @param {readonly string[]} changedFiles repository-relative changed paths
 * @param {Readonly<Record<string, readonly string[]>>} packedFilesByPackage
 *   each package's packed file paths relative to its own directory
 * @returns {string[]} the package directory names with a changed packed file
 */
export function selectChangedPackages(changedFiles, packedFilesByPackage) {
  const changed = new Set(changedFiles);
  return RELEASE_ORDER.filter((name) =>
    (packedFilesByPackage[name] ?? []).some((packed) =>
      changed.has(`packages/${name}/${packed}`),
    ),
  );
}

/**
 * Interpret a finished `npm view <name> versions --json` invocation.
 *
 * @param {{ exitStatus: number, stdout: string, stderr: string }} result the
 *   process result, stdout and stderr kept separate
 * @returns {string[]} the listed versions (empty when the package was never
 *   published)
 * @throws {Error} for any outcome other than a version list or a clean E404
 */
export function parseRegistryVersions({ exitStatus, stdout, stderr }) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const detail = stderr.trim() !== '' ? stderr.trim() : stdout.trim();
    throw new Error(
      `npm view exited ${exitStatus} without a JSON answer: ${detail === '' ? 'no output' : detail}`,
    );
  }
  if (exitStatus === 0) {
    if (typeof parsed === 'string') {
      return [parsed];
    }
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return /** @type {string[]} */ (parsed);
    }
    throw new Error('npm view returned something other than a version list');
  }
  const code = /** @type {{ error?: { code?: unknown } } | null} */ (parsed)
    ?.error?.code;
  if (code === 'E404') {
    return [];
  }
  throw new Error(
    `npm view failed with ${typeof code === 'string' ? code : `exit ${exitStatus}`}: ${stderr.trim() || JSON.stringify(parsed)}`,
  );
}

/**
 * @typedef {object} ReleaseIo the effects the planner needs, injectable for tests
 * @property {(before: string, sha: string) => string[]} changedFiles paths
 *   changed by a push
 * @property {(directory: string) => string[]} packedFiles what `npm pack` ships
 * @property {(directory: string) => { name: string, version: string, private?: boolean }} manifest
 *   the package's `package.json`
 * @property {(name: string) => string[]} registryVersions versions npm lists
 */

/**
 * @typedef {object} Assessment
 * @property {string} directory the package directory name
 * @property {string} name the npm package name
 * @property {string} version the declared version
 * @property {VersionVerdict} verdict how the version relates to the registry
 */

/**
 * @param {string} directory a package directory name from `RELEASE_ORDER`
 * @param {ReleaseIo} io the effects
 * @returns {Assessment} the package's declared version against the registry
 */
export function assessPackage(directory, io) {
  const manifest = io.manifest(directory);
  if (manifest.private === true) {
    throw new Error(`${manifest.name} is private and cannot be released`);
  }
  return {
    directory,
    name: manifest.name,
    version: manifest.version,
    verdict: classifyDeclaredVersion(
      manifest.version,
      io.registryVersions(manifest.name),
    ),
  };
}

/**
 * @param {Assessment} assessment a package whose version is not new
 * @param {'push' | 'workflow_dispatch' | 'check'} eventName the triggering
 *   event, or `check` for the publish job's own re-check
 * @returns {{ level: 'error' | 'notice', message: string }} the annotation
 */
function describeNotNew(assessment, eventName) {
  const { directory, name, version, verdict } = assessment;
  if (verdict.state === 'published') {
    if (eventName === 'check') {
      return {
        level: 'error',
        message: `${name}@${version} is already published (an earlier run released it); this run publishes nothing for it.`,
      };
    }
    return eventName === 'push'
      ? {
          level: 'error',
          message: `${name}@${version} is already published, but this run was triggered by a push that touched a packed path of packages/${directory} (src/, types/, README.md, CHANGELOG.md, LICENSE or package.json). Bump package.json's version (and add a dated CHANGELOG.md heading) before pushing a change to a packed path.`,
        }
      : {
          level: 'notice',
          message: `${name}@${version} is already published; nothing to release for it.`,
        };
  }
  if (verdict.state === 'stale') {
    return {
      level: 'error',
      message: `${name}@${version} is not newer than the newest published version ${verdict.newest}. Bump package.json's version past it.`,
    };
  }
  return {
    level: 'error',
    message: `${name} declares version ${JSON.stringify(version)}, which is not a plain x.y.z version.`,
  };
}

/**
 * Decide which packages a run releases.
 *
 * @param {{ eventName: string, ref: string, inputPackage: string, before: string, sha: string }} event
 *   the triggering event
 * @param {ReleaseIo} io the effects
 * @returns {{ packages: string[], annotations: { level: 'error' | 'notice', message: string }[] }}
 *   the package directory names to release in dependency order, and the
 *   annotations to print; any `error` annotation means the run must fail and
 *   release nothing
 */
export function planReleases(event, io) {
  /** @type {{ level: 'error' | 'notice', message: string }[]} */
  const annotations = [];
  /**
   * @param {string} message the failure
   * @returns {{ packages: string[], annotations: typeof annotations }} a plan
   *   that releases nothing
   */
  const fail = (message) => {
    annotations.push({ level: 'error', message });
    return { packages: /** @type {string[]} */ ([]), annotations };
  };

  if (event.ref !== 'refs/heads/main') {
    return fail(
      `Adapter releases run from main only; this run is on ${event.ref || 'an unknown ref'}.`,
    );
  }

  /** @type {string[]} */
  let candidates;
  if (event.eventName === 'workflow_dispatch') {
    if (!RELEASE_ORDER.includes(event.inputPackage)) {
      return fail(
        `Unknown adapter package ${JSON.stringify(event.inputPackage)}; releasable packages are ${RELEASE_ORDER.join(', ')}.`,
      );
    }
    candidates = [event.inputPackage];
  } else if (event.eventName === 'push') {
    const changed = io.changedFiles(event.before, event.sha);
    /** @type {Record<string, string[]>} */
    const packed = {};
    for (const name of RELEASE_ORDER) {
      if (changed.some((file) => file.startsWith(`packages/${name}/`))) {
        packed[name] = io.packedFiles(name);
      }
    }
    candidates = selectChangedPackages(changed, packed);
    if (candidates.length === 0) {
      annotations.push({
        level: 'notice',
        message:
          'No packed path of any adapter package changed in this push; nothing to release.',
      });
    }
  } else {
    return fail(`Unsupported event ${JSON.stringify(event.eventName)}.`);
  }

  const eventName = /** @type {'push' | 'workflow_dispatch'} */ (
    event.eventName
  );
  /** @type {string[]} */
  const releasable = [];
  let failed = false;
  for (const directory of candidates) {
    const assessment = assessPackage(directory, io);
    if (assessment.verdict.state === 'unpublished') {
      releasable.push(directory);
      continue;
    }
    const annotation = describeNotNew(assessment, eventName);
    annotations.push(annotation);
    failed ||= annotation.level === 'error';
  }
  if (failed) {
    annotations.push({
      level: 'error',
      message:
        'Nothing was published from this run. Fix the packages named above, then dispatch this workflow once per package that still needs a release, adapter-protocol first.',
    });
    return { packages: [], annotations };
  }
  return { packages: releasable, annotations };
}

/**
 * @param {string} text an annotation message
 * @returns {string} the message escaped for a workflow command
 */
function escapeCommand(text) {
  return text
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

/**
 * @param {string} command the program
 * @param {readonly string[]} args its arguments
 * @returns {{ exitStatus: number, stdout: string, stderr: string }} the result
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    exitStatus: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** @type {ReleaseIo} */
const REAL_IO = {
  changedFiles(before, sha) {
    const known = (/** @type {string} */ revision) =>
      /^0+$/u.test(revision) || revision === ''
        ? false
        : run('git', ['cat-file', '-e', `${revision}^{commit}`]).exitStatus ===
          0;
    const base = known(before) ? before : `${sha}^`;
    const result =
      run('git', ['rev-parse', '--verify', '--quiet', base]).exitStatus === 0
        ? run('git', ['diff', '--name-only', '--no-renames', '-z', base, sha])
        : run('git', ['ls-tree', '-r', '--name-only', '-z', sha]);
    if (result.exitStatus !== 0) {
      throw new Error(`git could not list the changed files: ${result.stderr}`);
    }
    return result.stdout.split('\0').filter((file) => file !== '');
  },
  packedFiles(directory) {
    const result = run('npm', [
      'pack',
      '--dry-run',
      '--json',
      '--workspace',
      `packages/${directory}`,
    ]);
    if (result.exitStatus !== 0) {
      throw new Error(
        `npm pack --dry-run failed for packages/${directory}: ${result.stderr.trim()}`,
      );
    }
    const packed = JSON.parse(result.stdout);
    return packed[0].files.map((/** @type {{ path: string }} */ f) => f.path);
  },
  manifest(directory) {
    return JSON.parse(
      readFileSync(path.join('packages', directory, 'package.json'), 'utf8'),
    );
  },
  registryVersions(name) {
    return parseRegistryVersions(
      run('npm', ['view', name, 'versions', '--json']),
    );
  },
};

/**
 * @returns {Promise<void>} resolves once the subcommand has run
 */
async function main() {
  const [command, argument] = process.argv.slice(2);
  try {
    if (command === 'plan') {
      const result = planReleases(
        {
          eventName: process.env.EVENT_NAME ?? '',
          ref: process.env.GITHUB_REF ?? '',
          inputPackage: process.env.INPUT_PACKAGE ?? '',
          before: process.env.EVENT_BEFORE ?? '',
          sha: process.env.GITHUB_SHA ?? 'HEAD',
        },
        REAL_IO,
      );
      for (const { level, message } of result.annotations) {
        process.stdout.write(`::${level}::${escapeCommand(message)}\n`);
      }
      const hasError = result.annotations.some((a) => a.level === 'error');
      const line = `packages=${JSON.stringify(result.packages)}\n`;
      if (process.env.GITHUB_OUTPUT !== undefined) {
        appendFileSync(process.env.GITHUB_OUTPUT, line);
      }
      process.stdout.write(
        `Release plan: ${result.packages.length === 0 ? 'no packages' : result.packages.join(', ')}.\n`,
      );
      process.exitCode = hasError ? 1 : 0;
      return;
    }
    if (command === 'check' && argument !== undefined) {
      const directory = path.basename(argument);
      if (!RELEASE_ORDER.includes(directory)) {
        throw new Error(
          `${argument} is not a releasable adapter package (${RELEASE_ORDER.join(', ')}).`,
        );
      }
      const assessment = assessPackage(directory, REAL_IO);
      if (assessment.verdict.state !== 'unpublished') {
        throw new Error(describeNotNew(assessment, 'check').message);
      }
      process.stdout.write(
        `${assessment.name}@${assessment.version} is not on npm yet and is newer than every published version.\n`,
      );
      return;
    }
    process.stderr.write(
      'usage: node scripts/release/adapter-release.mjs plan | check <packages/adapter-name>\n',
    );
    process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`::error::${escapeCommand(message)}\n`);
    process.exitCode = 1;
  }
}

await runIfMain(import.meta.url, main);
