#!/usr/bin/env node
/**
 * Deterministic file rewrites for the owner-run adapter release
 * (`prod-adapter.sh` at the workspace root). Three subcommands, each
 * idempotent, none of which evaluates repository source:
 *
 * - `catalog --root <dir> <package>=<version>=<hex>...` rewrites the version
 *   and `sha256:<hex>` integrity of the named rows in
 *   `packages/publish-action/src/adapter-artifact-catalog.js` and of the
 *   matching package row in the minimal-repository fixture lock (whose
 *   `lockDigest` is recomputed with the lock digest profile).
 * - `changelog --file <path> --version <v> --date <YYYY-MM-DD>` turns the
 *   `## [Unreleased]` section into a dated release heading and leaves a fresh
 *   empty Unreleased section; it refuses an empty Unreleased section.
 * - `deps --root <dir> <package>=<old>=<new>...` moves exact workspace
 *   dependency pins from an old version to the bumped one.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runIfMain } from '../run-if-main.mjs';

export const CATALOG_PATH =
  'packages/publish-action/src/adapter-artifact-catalog.js';
export const FIXTURE_LOCK_PATH =
  'packages/publish-action/test/fixtures/minimal-repository/gala.lock.json';

const VERSION = /^\d+\.\d+\.\d+$/u;
const HEX = /^[0-9a-f]{64}$/u;

/**
 * @param {string} text value to embed in a regular expression
 * @returns {string} the escaped text
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * @typedef {object} RowUpdate
 * @property {string} package npm package name
 * @property {string} version new exact version
 * @property {string} hex sha256 of the registry tarball, lowercase hex
 */

/**
 * @param {readonly RowUpdate[]} updates rows to validate
 * @returns {void}
 */
function validateUpdates(updates) {
  for (const update of updates) {
    if (!VERSION.test(update.version) || !HEX.test(update.hex)) {
      throw new Error(`invalid update for ${update.package}`);
    }
  }
}

/**
 * Rewrite catalog rows in the catalog module source.
 *
 * @param {string} source the catalog module text
 * @param {readonly RowUpdate[]} updates the rows to set
 * @returns {string} the rewritten text
 */
export function rewriteCatalogSource(source, updates) {
  validateUpdates(updates);
  let next = source;
  for (const update of updates) {
    const pattern = new RegExp(
      `(package: '${escapeRegExp(update.package)}',\\n\\s+version: ')[^']*(',\\n\\s+integrity:\\n\\s+'sha256:)[0-9a-f]{64}(')`,
      'gu',
    );
    const matches = [...next.matchAll(pattern)];
    if (matches.length !== 1) {
      throw new Error(
        `catalog row for ${update.package} found ${matches.length} times, expected 1`,
      );
    }
    next = next.replace(
      pattern,
      (_all, head, middle, tail) =>
        `${head}${update.version}${middle}${update.hex}${tail}`,
    );
  }
  return next;
}

/**
 * Rewrite package rows in a lock file and recompute its `lockDigest`.
 * Packages the lock does not carry are left alone.
 *
 * @param {string} text lock JSON text
 * @param {readonly RowUpdate[]} updates the rows to set
 * @param {(lock: object) => string} digestLock lock digest function
 * @returns {string} the rewritten text
 */
export function rewriteLockText(text, updates, digestLock) {
  validateUpdates(updates);
  const lock = JSON.parse(text);
  let touched = false;
  for (const row of lock.publisher ?? []) {
    const update = updates.find((entry) => entry.package === row.package);
    if (update !== undefined) {
      row.version = update.version;
      row.integrity = `sha256:${update.hex}`;
      touched = true;
    }
  }
  if (!touched) {
    return text;
  }
  lock.lockDigest = digestLock(lock);
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/**
 * Turn a CHANGELOG's Unreleased section into a dated release.
 *
 * @param {string} changelog CHANGELOG.md text
 * @param {string} version the released version
 * @param {string} date release date, `YYYY-MM-DD`
 * @returns {string} the rewritten text
 */
export function releaseChangelog(changelog, version, date) {
  if (!VERSION.test(version) || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new Error('invalid version or date');
  }
  if (changelog.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG already has a ${version} heading`);
  }
  const heading = /^## \[Unreleased\][^\n]*\n/mu.exec(changelog);
  if (heading === null) {
    throw new Error('CHANGELOG has no "## [Unreleased]" heading');
  }
  const start = heading.index + heading[0].length;
  const rest = changelog.slice(start);
  const next = /^## \[/mu.exec(rest);
  const body = next === null ? rest : rest.slice(0, next.index);
  if (body.trim() === '') {
    throw new Error(
      'CHANGELOG Unreleased section is empty: a release needs a line',
    );
  }
  return `${changelog.slice(0, start)}\n## [${version}] - ${date}\n${rest}`;
}

/**
 * Move exact workspace dependency pins to a bumped version.
 *
 * @param {string} manifestText a package.json text
 * @param {readonly {package: string, from: string, to: string}[]} moves pins
 * @returns {string} the rewritten text
 */
export function moveExactPins(manifestText, moves) {
  const manifest = JSON.parse(manifestText);
  let moved = false;
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const move of moves) {
      if (manifest[field]?.[move.package] === move.from) {
        manifest[field][move.package] = move.to;
        moved = true;
      }
    }
  }
  return moved ? `${JSON.stringify(manifest, null, 2)}\n` : manifestText;
}

/**
 * @param {string} file path to rewrite
 * @param {(text: string) => string | Promise<string>} transform rewrite
 * @returns {Promise<boolean>} whether the file changed
 */
async function rewriteFile(file, transform) {
  const before = await readFile(file, 'utf8');
  const after = await transform(before);
  if (after === before) {
    return false;
  }
  await writeFile(file, after);
  return true;
}

/**
 * @param {string[]} specs `a=b=c` arguments
 * @param {number} parts expected parts
 * @returns {[string, string, string][]} split specs
 */
function splitSpecs(specs, parts) {
  return /** @type {[string, string, string][]} */ (
    specs.map((spec) => {
      const pieces = spec.split('=');
      if (pieces.length !== parts) {
        throw new Error(`bad argument, expected ${parts} "=" parts`);
      }
      return pieces;
    })
  );
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
  /**
   * @param {string} name option name
   * @returns {string} its value
   */
  const need = (name) => {
    const value = options[name];
    if (value === undefined || value === '') {
      throw new Error(`missing --${name}`);
    }
    return value;
  };
  if (command === 'catalog') {
    const root = need('root');
    const updates = splitSpecs(positional, 3).map(([name, version, hex]) => ({
      package: name,
      version,
      hex,
    }));
    const { ACTIVE_DIGEST_PROFILES } =
      await import('@rathnasgala2/schemas/digest-profiles');
    const profile = /** @type {any} */ (ACTIVE_DIGEST_PROFILES.lock);
    const a = await rewriteFile(path.join(root, CATALOG_PATH), (text) =>
      rewriteCatalogSource(text, updates),
    );
    const b = await rewriteFile(path.join(root, FIXTURE_LOCK_PATH), (text) =>
      rewriteLockText(text, updates, (lock) => profile.digest(lock)),
    );
    console.log(
      `catalog: ${a ? 'updated' : 'unchanged'}; fixture lock: ${b ? 'updated' : 'unchanged'}`,
    );
  } else if (command === 'changelog') {
    await rewriteFile(need('file'), (text) =>
      releaseChangelog(text, need('version'), need('date')),
    );
    console.log(`changelog: released ${need('version')}`);
  } else if (command === 'deps') {
    const moves = splitSpecs(positional, 3).map(([name, from, to]) => ({
      package: name,
      from,
      to,
    }));
    const packages = path.join(need('root'), 'packages');
    let changed = 0;
    for (const dir of await readdir(packages)) {
      const file = path.join(packages, dir, 'package.json');
      if (await rewriteFile(file, (text) => moveExactPins(text, moves))) {
        changed += 1;
        console.log(`deps: moved pins in packages/${dir}/package.json`);
      }
    }
    console.log(`deps: ${changed} manifest(s) changed`);
  } else {
    throw new Error('usage: update-adapter-catalog.mjs catalog|changelog|deps');
  }
}

await runIfMain(import.meta.url, () => run(process.argv.slice(2)));
