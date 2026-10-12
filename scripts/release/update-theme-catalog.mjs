#!/usr/bin/env node
/**
 * Deterministic file rewrites for a theme-generation move. One subcommand:
 *
 * `catalog --root <dir> [--schemas <v>] [--template <v>] <package>=<version>=<hex>...`
 * rewrites the version and `sha256:<hex>` integrity of the named rows in
 * `packages/publish-action/src/theme-catalog.js`, moves the fixture lock's
 * `theme` block to the same row, optionally moves the lock's `schemas` and
 * `template` versions, and recomputes the fixture `lockDigest` with the lock
 * digest profile. It never hand-edits a digest and is idempotent.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runIfMain } from '../run-if-main.mjs';
import {
  FIXTURE_LOCK_PATH,
  rewriteCatalogSource,
} from './update-adapter-catalog.mjs';

export const THEME_CATALOG_PATH =
  'packages/publish-action/src/theme-catalog.js';

const VERSION = /^\d+\.\d+\.\d+$/u;
const HEX = /^[0-9a-f]{64}$/u;

/**
 * Rewrite the theme, schemas and template blocks of a lock and recompute its
 * `lockDigest`. The theme block moves only when its package is named.
 *
 * @param {string} text lock JSON text
 * @param {{
 *   themes: readonly {package: string, version: string, hex: string}[],
 *   schemas?: string | undefined,
 *   template?: string | undefined,
 * }} update the rows and versions to set
 * @param {(lock: object) => string} digestLock lock digest function
 * @returns {string} the rewritten text
 */
export function rewriteThemeLockText(text, update, digestLock) {
  for (const row of update.themes) {
    if (!VERSION.test(row.version) || !HEX.test(row.hex)) {
      throw new Error(`invalid update for ${row.package}`);
    }
  }
  for (const version of [update.schemas, update.template]) {
    if (version !== undefined && !VERSION.test(version)) {
      throw new Error(`invalid version ${version}`);
    }
  }
  const lock = JSON.parse(text);
  const theme = update.themes.find((row) => row.package === lock.theme.package);
  if (theme !== undefined) {
    lock.theme.version = theme.version;
    lock.theme.integrity = `sha256:${theme.hex}`;
  }
  if (update.schemas !== undefined) {
    lock.schemas.version = update.schemas;
  }
  if (update.template !== undefined) {
    lock.template.version = update.template;
  }
  lock.lockDigest = digestLock(lock);
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/**
 * @param {string[]} args command line after the script name
 * @returns {Promise<void>} resolves after the rewrite
 */
export async function run(args) {
  const [command, ...rest] = args;
  /** @type {Record<string, string>} */
  const options = {};
  /** @type {string[]} */
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? '';
    if (arg.startsWith('--')) {
      index += 1;
      options[arg.slice(2)] = rest[index] ?? '';
    } else {
      positional.push(arg);
    }
  }
  if (command !== 'catalog' || !options.root) {
    throw new Error(
      'usage: update-theme-catalog.mjs catalog --root <dir> [--schemas v] [--template v] <package>=<version>=<hex>...',
    );
  }
  const themes = positional.map((spec) => {
    const pieces = spec.split('=');
    if (pieces.length !== 3) {
      throw new Error('bad argument, expected 3 "=" parts');
    }
    return {
      package: pieces[0] ?? '',
      version: pieces[1] ?? '',
      hex: pieces[2] ?? '',
    };
  });
  const { ACTIVE_DIGEST_PROFILES } =
    await import('@rathnasgala2/schemas/digest-profiles');
  const profile = /** @type {any} */ (ACTIVE_DIGEST_PROFILES.lock);
  const catalogFile = path.join(options.root, THEME_CATALOG_PATH);
  const lockFile = path.join(options.root, FIXTURE_LOCK_PATH);
  await writeFile(
    catalogFile,
    rewriteCatalogSource(await readFile(catalogFile, 'utf8'), themes),
  );
  await writeFile(
    lockFile,
    rewriteThemeLockText(
      await readFile(lockFile, 'utf8'),
      { themes, schemas: options.schemas, template: options.template },
      (lock) => profile.digest(lock),
    ),
  );
  console.log(`theme catalog: ${themes.length} row(s); fixture lock updated`);
}

await runIfMain(import.meta.url, () => run(process.argv.slice(2)));
