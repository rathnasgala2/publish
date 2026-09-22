/**
 * Real installed-package identity resolution for this workspace's own
 * dependency graph (`@rathnasgala2/schemas`, `@rathnasgala2/publish-kernel`,
 * `@rathnasgala2/adapter-protocol`, `@rathnasgala2/adapter-local-directory`,
 * and this package itself), plus the one synthetic stand-in this repository
 * cannot resolve locally (`@rathnasgala2/template`, a sibling repository
 * consumed by path per `template-bridge.js`, and the selected theme
 * package, which ships no local package in this workspace at all).
 *
 * `integrity` here is a real SHA-256 digest of the real installed
 * `package.json` bytes (domain-separated under this package's own
 * `LOCAL_PACKAGE_IDENTITY_DOMAIN`), not an npm registry-issued SRI hash: no
 * real npm registry resolved any of these packages locally (LOCAL-1 pins a
 * packed tarball; the rest resolve through npm workspaces), and the
 * `packageIdentity` schema's `integrity` field requires the
 * `sha256:<hex>` shape a registry SRI hash (`sha512-<base64>`) would not
 * satisfy in any case. `registry` is the documented `.invalid` local
 * stand-in (`LOCAL_REGISTRY_STANDIN`) for the same reason. This is real,
 * reproducible, non-fabricated evidence about what was actually installed —
 * not release evidence of a registry publish.
 *
 * @module
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCAL_PACKAGE_IDENTITY_DOMAIN } from '../constants.js';
import { LOCAL_REGISTRY_STANDIN } from './local-standins.js';
import { TEMPLATE_ROOT } from '../template-bridge.js';

/**
 * @param {Buffer} bytes the file bytes to digest
 * @returns {string} the domain-separated `sha256:` digest
 */
function localPackageDigest(bytes) {
  const hash = createHash('sha256');
  hash.update(LOCAL_PACKAGE_IDENTITY_DOMAIN, 'utf8');
  hash.update(bytes);
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Build one `packageIdentity`-shaped record from an installed
 * `package.json`'s bytes.
 *
 * @param {Buffer} packageJsonBytes the raw `package.json` bytes
 * @returns {{package: string, version: string, integrity: string, registry: string}}
 *   the package identity
 */
function identityFromPackageJsonBytes(packageJsonBytes) {
  const parsed = /** @type {{name: string, version: string}} */ (
    JSON.parse(packageJsonBytes.toString('utf8'))
  );
  return {
    package: parsed.name,
    version: parsed.version,
    integrity: localPackageDigest(packageJsonBytes),
    registry: LOCAL_REGISTRY_STANDIN,
  };
}

/**
 * Resolve one real installed package's identity via Node's own module
 * resolution (`import.meta.resolve`), rooted at this module (so it follows
 * this package's own `node_modules`/workspace symlinks).
 *
 * @param {string} packageName an npm package name resolvable from this
 *   package's own dependency graph
 * @returns {Promise<{package: string, version: string, integrity: string, registry: string}>}
 *   the resolved package identity
 */
export async function resolveInstalledPackageIdentity(packageName) {
  const packageJsonUrl = await import.meta.resolve(
    `${packageName}/package.json`,
  );
  const bytes = await readFile(fileURLToPath(packageJsonUrl));
  return identityFromPackageJsonBytes(bytes);
}

/**
 * Resolve `@rathnasgala2/template`'s identity from the sibling repository
 * root `template-bridge.js` resolves (not an npm dependency of this
 * workspace; see that module's documentation).
 *
 * @returns {Promise<{package: string, version: string, integrity: string, registry: string}>}
 *   `@rathnasgala2/template`'s identity
 */
export async function resolveTemplatePackageIdentity() {
  const bytes = await readFile(path.join(TEMPLATE_ROOT, 'package.json'));
  return identityFromPackageJsonBytes(bytes);
}
