/**
 * Theme package resolution (S2-T20b deliverable): resolve the theme package
 * `gala.lock.json` pins (`buildInput.packages.theme`, read exactly once by
 * `normalize/repository-intake.js`) to a real, on-disk theme package
 * directory, verify it, and hand its absolute path to
 * `@rathnasgala2/template`'s `renderPublication` as `options.themeDirectory`
 * (see `template-bridge.js` and `v2/template`'s README S2-T12 section: an
 * extracted theme package directory shaped `theme.json`, `tokens.css`,
 * `components.css`, an optional `utilities.css`, `print.css`, `package.json`,
 * `LICENSE`, `README.md`, an optional `assets/*`).
 *
 * This repository never publishes a real npm package named
 * `@rathnasgala2/theme-<name>` to a registry, and never installs one as an
 * npm dependency of this workspace (the same SBOM-pollution reasoning
 * `template-bridge.js` documents for `@rathnasgala2/template`: a theme
 * package is a full sibling repository with its own independently installed
 * `node_modules`). So the theme package directory is located by one of three
 * documented resolution steps, tried in this fixed order, and the first
 * candidate directory that actually exists on disk wins:
 *
 * 1. **Installed package** — `<repositoryDirectory>/node_modules/<theme
 *    package name>` (e.g. `node_modules/@rathnasgala2/theme-default`). This
 *    is the eventual real path once an author repository declares the theme
 *    package as an ordinary npm dependency and a real registry publish
 *    exists; nothing in this repository fabricates that installation, this
 *    module only looks for it.
 * 2. **`GALA_THEME_DIR` override** — an absolute or cwd-relative path to a
 *    theme package directory, for a local override of either of the other
 *    two steps (a not-yet-published theme revision, a fixture, CI).
 * 3. **Local-first sibling checkout** — `<WORKSPACE_ROOT>/theme-<name>`
 *    (the unscoped remainder of the pinned package name after its
 *    `@rathnasgala2/` scope), resolved by `workspace-siblings.js`'s
 *    `resolveWorkspaceSibling` the same way `template-bridge.js` resolves
 *    `TEMPLATE_ROOT` for `@rathnasgala2/template`: `WORKSPACE_ROOT` (DEC-015
 *    name) when set, otherwise the fixed relative default
 *    `/Users/anand/ws/galascribe/v2/theme-<name>` from this package's own
 *    file path. **LOCAL-only**: this is a workspace-layout convenience for
 *    local-first delivery (LOCAL-4), never a path a real Action run on a
 *    contributor's own machine or CI runner can rely on without setting
 *    `WORKSPACE_ROOT` (there is no `v2/theme-<name>` sibling repository in
 *    a single-repo CI checkout at all — FOLLOW-UP SUPPLY-CHAIN-JS), and it
 *    is never consulted when step 1 already found an installed package.
 *
 * Once a candidate directory is found, this module verifies, before ever
 * handing it to `renderPublication`:
 *
 * - the directory's own `package.json` `name`/`version` exactly match the
 *   lock-pinned `theme.package`/`theme.version` (the resolved package must
 *   actually be the one the author repository's `gala.lock.json` pins, not
 *   merely a same-named directory that happens to be first on the search
 *   path);
 * - the directory's own `theme.json` validates against
 *   `urn:gala:schema:theme-contract:2.0.0` with `@rathnasgala2/schemas`'
 *   `validateGalaDocument` (this module does not re-implement any part of
 *   that schema; a schema change lands upstream in `schema` first), and its
 *   own `package` field (`"<name>@<version>"`) matches the same pinned
 *   identity.
 *
 * Any failure (no candidate directory found, an unreadable/malformed
 * `package.json` or `theme.json`, an identity mismatch, or a schema
 * validation failure) fails closed with a typed `SOURCE_ERROR` finding
 * (this package's existing `RepositoryIntakeError`/`SchemaValidationError`
 * severity for "the author repository's declared dependency set cannot be
 * satisfied as declared") rather than proceeding with an unverified or
 * absent theme directory — `renderPublication` never falls back to its own
 * pre-existing fixed `assets/theme/print.css` default on this package's own
 * `build`/Action path; every author repository names a theme package in its
 * `gala.lock.json`, and this package's `build`/Action path always resolves
 * and verifies one before rendering.
 *
 * @module
 */

import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';

import { validateGalaDocument } from '@rathnasgala2/schemas';

import { resolveWorkspaceSibling } from './workspace-siblings.js';

const THEME_CONTRACT_SCHEMA_ID = 'urn:gala:schema:theme-contract:2.0.0';

/** The pinned theme package name's required shape: `@rathnasgala2/theme-<slug>`. */
const THEME_PACKAGE_NAME_PATTERN =
  /^@rathnasgala2\/(theme-[a-z0-9]+(?:-[a-z0-9]+)*)$/u;

/**
 * A typed theme-resolution failure: no candidate directory could be found
 * for the lock-pinned theme package, or the one found does not verify
 * against the lock pin / `theme-contract:2.0.0`.
 */
export class ThemeResolutionError extends Error {
  /**
   * @param {string} message human-readable summary
   * @param {readonly import('./index.d.ts').PublishActionFinding[]} findings typed findings
   */
  constructor(message, findings = []) {
    super(message);
    this.name = 'ThemeResolutionError';
    this.findings = Object.freeze([...findings]);
  }
}

/**
 * @param {string} code stable finding code
 * @param {string} detail human-readable detail
 * @param {Record<string, unknown>} [evidence] optional evidence
 * @returns {import('./index.d.ts').PublishActionFinding} one typed finding
 */
function themeFinding(code, detail, evidence) {
  return {
    code,
    severity: 'SOURCE_ERROR',
    detail,
    recovery:
      "Install the pinned theme package under the repository's own " +
      'node_modules, set GALA_THEME_DIR to an extracted copy of it, or (LOCAL ' +
      'only) check out the matching v2/theme-<name> sibling repository at the ' +
      'pinned version and, if resolving from a non-default location (for ' +
      'example a git worktree), set WORKSPACE_ROOT to the directory ' +
      'containing the sibling repositories.',
    overridable: false,
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * @param {string} candidate an absolute path
 * @returns {Promise<boolean>} whether `candidate` exists and is a directory
 *   (never throws)
 */
async function isDirectory(candidate) {
  try {
    const stats = await lstat(candidate);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read and JSON-parse one file, throwing {@link ThemeResolutionError} with a
 * typed finding on any failure instead of letting a raw `fs`/`JSON.parse`
 * error escape.
 *
 * @param {string} absolutePath the file to read
 * @param {string} code the finding code to use on failure
 * @returns {Promise<any>} the parsed JSON value
 */
async function readJsonOrFail(absolutePath, code) {
  let bytes;
  try {
    bytes = await readFile(absolutePath);
  } catch (error) {
    throw new ThemeResolutionError(`${absolutePath} could not be read`, [
      themeFinding(
        code,
        `${absolutePath}: ${/** @type {Error} */ (error).message}`,
      ),
    ]);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new ThemeResolutionError(`${absolutePath} is not valid JSON`, [
      themeFinding(
        code,
        `${absolutePath}: ${/** @type {Error} */ (error).message}`,
      ),
    ]);
  }
}

/**
 * Verify one candidate theme package directory against the lock-pinned
 * theme identity (S2-T20b deliverable): its `package.json` `name`/`version`
 * must exactly match, and its `theme.json` must validate against
 * `theme-contract:2.0.0` and carry the matching `package` identity.
 *
 * @param {string} themeDirectory the absolute candidate directory
 * @param {{package: string, version: string}} theme the lock-pinned theme identity
 * @returns {Promise<void>} resolves once verified; throws {@link ThemeResolutionError} otherwise
 */
async function verifyThemeDirectory(themeDirectory, theme) {
  const packageJson = await readJsonOrFail(
    path.join(themeDirectory, 'package.json'),
    'THEME_PACKAGE_JSON_UNREADABLE',
  );
  if (
    packageJson.name !== theme.package ||
    packageJson.version !== theme.version
  ) {
    throw new ThemeResolutionError(
      `${themeDirectory}'s package.json (${packageJson.name}@${packageJson.version}) does not match the lock-pinned theme identity (${theme.package}@${theme.version})`,
      [
        themeFinding(
          'THEME_PACKAGE_IDENTITY_MISMATCH',
          `${themeDirectory}: expected ${theme.package}@${theme.version}, found ${packageJson.name}@${packageJson.version}`,
          {
            expected: { package: theme.package, version: theme.version },
            found: { package: packageJson.name, version: packageJson.version },
          },
        ),
      ],
    );
  }

  const themeContract = await readJsonOrFail(
    path.join(themeDirectory, 'theme.json'),
    'THEME_CONTRACT_UNREADABLE',
  );
  const expectedThemeContractPackage = `${theme.package}@${theme.version}`;
  if (themeContract.package !== expectedThemeContractPackage) {
    throw new ThemeResolutionError(
      `${themeDirectory}/theme.json's "package" field (${themeContract.package}) does not match the lock-pinned theme identity (${expectedThemeContractPackage})`,
      [
        themeFinding(
          'THEME_CONTRACT_IDENTITY_MISMATCH',
          `${themeDirectory}/theme.json: expected ${expectedThemeContractPackage}, found ${themeContract.package}`,
          {
            expected: expectedThemeContractPackage,
            found: themeContract.package,
          },
        ),
      ],
    );
  }
  const result = validateGalaDocument(THEME_CONTRACT_SCHEMA_ID, themeContract);
  if (!result.valid) {
    throw new ThemeResolutionError(
      `${themeDirectory}/theme.json failed validation against ${THEME_CONTRACT_SCHEMA_ID}`,
      [
        themeFinding(
          'THEME_CONTRACT_INVALID',
          `${themeDirectory}/theme.json: ${JSON.stringify(result.diagnostics)}`,
          {
            schemaId: THEME_CONTRACT_SCHEMA_ID,
            diagnostics: result.diagnostics,
          },
        ),
      ],
    );
  }
}

/**
 * Resolve, verify and return the absolute theme package directory for the
 * lock-pinned theme identity (S2-T20b deliverable). Tries, in order: (1) an
 * installed `node_modules/<theme package>` under `repositoryDirectory`, (2)
 * a `GALA_THEME_DIR` override, (3) the LOCAL-only sibling checkout
 * `/Users/anand/ws/galascribe/v2/theme-<name>`. The first candidate
 * directory that exists on disk is verified and returned; a candidate that
 * exists but fails verification fails the whole resolution closed (it does
 * not fall through to the next step — an existing-but-wrong theme package is
 * a finding, not a reason to keep searching).
 *
 * @param {{
 *   repositoryDirectory: string,
 *   theme: {package: string, version: string, integrity: string, registry: string},
 *   env?: NodeJS.ProcessEnv,
 * }} options the author repository directory, the lock-pinned theme
 *   identity (`buildInput.packages.theme`), and the process environment
 *   (injectable for tests)
 * @returns {Promise<string>} the absolute, verified theme package directory
 */
export async function resolveThemeDirectory({
  repositoryDirectory,
  theme,
  env = process.env,
}) {
  const match = THEME_PACKAGE_NAME_PATTERN.exec(theme.package);
  if (!match) {
    throw new ThemeResolutionError(
      `theme package "${theme.package}" does not match the required @rathnasgala2/theme-<name> convention`,
      [
        themeFinding(
          'THEME_PACKAGE_NAME_INVALID',
          `"${theme.package}" is not a "@rathnasgala2/theme-<name>" package name`,
        ),
      ],
    );
  }
  const themeSlug = /** @type {string} */ (match[1]);

  /** @type {{source: string, directory: string}[]} */
  const candidates = [
    {
      source: 'installed-package',
      directory: path.join(repositoryDirectory, 'node_modules', theme.package),
    },
    ...(env.GALA_THEME_DIR
      ? [{ source: 'override', directory: path.resolve(env.GALA_THEME_DIR) }]
      : []),
    {
      source: 'local-sibling',
      directory: resolveWorkspaceSibling(themeSlug, env),
    },
  ];

  for (const candidate of candidates) {
    if (await isDirectory(candidate.directory)) {
      await verifyThemeDirectory(candidate.directory, theme);
      return candidate.directory;
    }
  }

  throw new ThemeResolutionError(
    `no theme package directory found for ${theme.package}@${theme.version}`,
    [
      themeFinding(
        'THEME_PACKAGE_NOT_FOUND',
        `${theme.package}@${theme.version}: searched ${candidates
          .map((candidate) => `${candidate.source}=${candidate.directory}`)
          .join(', ')}`,
        { searched: candidates },
      ),
    ],
  );
}
