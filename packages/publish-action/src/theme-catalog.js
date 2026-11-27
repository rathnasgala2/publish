/**
 * The exact theme catalog this generation-4 toolchain can render: one entry per
 * theme package the repository root installs (`package.json` `devDependencies`,
 * exact-pinned, resolved from the public registry) and
 * `scripts/sandbox-build.sh` exposes to `theme-bridge.js` through
 * `WORKSPACE_ROOT=<toolchain>/node_modules/@rathnasgala2`. Each entry states
 * the block an author repository's `gala.lock.json` `theme` member must carry
 * for that theme.
 *
 * `integrity` is the lowercase hex SHA-256 of the registry tarball
 * (`lock:2.0.0`'s `digest` shape, `sha256:<64 hex>`), cross-checked against the
 * registry's `dist.integrity`. The build does not recompute it from installed
 * bytes: it only checks the resolved package's `name`/`version` and
 * `theme.json` identity; the digest travels into provenance and the
 * authorization input unchanged. The workspace test `theme-catalog.test.js`
 * keeps this table equal to the installed packages and the lockfile.
 *
 * `contractVersion` is the theme CONTRACT version (`theme.json` `contractVersion`, which the pinned template compares
 * with its published styling contract), never the package version; the
 * package version and the contract version are independent.
 *
 * @module
 */

/** The registry every catalog entry was published to. */
export const THEME_REGISTRY = 'https://registry.npmjs.org/';

/**
 * @typedef {object} ThemeCatalogEntry
 * @property {string} package npm package name
 * @property {string} version exact installed version
 * @property {string} integrity `sha256:<hex>` of the registry tarball
 * @property {string} registry registry URL
 * @property {string} contractVersion the theme contract version (`theme.json` contractVersion)
 * @property {string} compatibleWith semver range over the contract version
 */

/** @type {readonly ThemeCatalogEntry[]} */
export const THEME_CATALOG = Object.freeze([
  Object.freeze({
    package: '@rathnasgala2/theme-default',
    version: '4.2.1',
    integrity:
      'sha256:ea1f69574ca58ab201ccb2498536ebdaa7f09b5e98e6d8c064a0326e3ec71a22',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-amaze',
    version: '4.2.2',
    integrity:
      'sha256:3f53acc057ebbd28de5b74587897d161bacd4657a5e1b6d8b3c069e65092f791',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-editorial',
    version: '4.2.2',
    integrity:
      'sha256:bc4a1fd9ad3577e0588b839b1c795841bf78f5388bc45f68eb4e551d9f373745',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-flashy',
    version: '4.2.1',
    integrity:
      'sha256:750a273fda99b2fde0a2d95a69ca9a26b5efda8830d16c2386a8d51354243ddc',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-minimal',
    version: '4.2.1',
    integrity:
      'sha256:b90a0ea85e5a5bd8c456dab9cfb96af834fda3f4e3d1552de9435c6a907ca2a3',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
  Object.freeze({
    package: '@rathnasgala2/theme-zebra',
    version: '4.2.1',
    integrity:
      'sha256:2cd8aae23f887ff273733d3021add60f6442355562839c90cf7a163ee5825a48',
    registry: THEME_REGISTRY,
    contractVersion: '4.1.0',
    compatibleWith: '^4.0.0',
  }),
]);

/**
 * @param {string} packageName a theme package name
 * @returns {ThemeCatalogEntry | undefined} its catalog entry, if shipped
 */
export function findThemeCatalogEntry(packageName) {
  return THEME_CATALOG.find((entry) => entry.package === packageName);
}

/**
 * Fail closed unless a lock theme byte-equals one complete catalog row.
 *
 * @param {Record<string, unknown>} row lock `theme` object
 * @param {string} diagnosticPrefix stable caller-specific error prefix
 * @returns {ThemeCatalogEntry} the matching catalog entry
 */
export function requireThemeArtifact(row, diagnosticPrefix) {
  const entry =
    typeof row.package === 'string'
      ? findThemeCatalogEntry(row.package)
      : undefined;
  if (entry === undefined) {
    throw new Error(`${diagnosticPrefix}: selected theme is not cataloged`);
  }
  const members = [
    'package',
    'version',
    'integrity',
    'registry',
    'contractVersion',
    'compatibleWith',
  ];
  if (
    Object.keys(row).length !== members.length ||
    members.some((member) => !Object.hasOwn(row, member))
  ) {
    throw new Error(
      `${diagnosticPrefix}: ${entry.package} does not carry exactly the catalog package-row members`,
    );
  }
  for (const member of members) {
    if (
      row[member] !== entry[/** @type {keyof ThemeCatalogEntry} */ (member)]
    ) {
      throw new Error(
        `${diagnosticPrefix}: ${entry.package} ${member} does not match the closed artifact catalog`,
      );
    }
  }
  return entry;
}

/**
 * The package-name part of an `appearance.json` `theme` value
 * (`@scope/name@range` or `@scope/name`).
 *
 * @param {string} themeSpecifier the appearance `theme` value
 * @returns {string} the package name without its range
 */
export function themePackageNameOf(themeSpecifier) {
  const at = themeSpecifier.lastIndexOf('@');
  return at > 0 ? themeSpecifier.slice(0, at) : themeSpecifier;
}
