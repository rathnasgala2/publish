#!/usr/bin/env node
/**
 * Build and verify the source-only generation-4 package set consumed by the
 * publish toolchain. The committed tarballs are the delivery mechanism: the
 * reusable workflow checks out only this repository and never resolves these
 * packages from npm or from mutable sibling repositories.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { THEME_CATALOG } from '../packages/publish-action/src/theme-catalog.js';
import { runIfMain } from './run-if-main.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLISH_ROOT = path.resolve(HERE, '..');
const DEFAULT_SOURCE_ROOT = path.resolve(PUBLISH_ROOT, '..');
const DEFAULT_VENDOR_ROOT = path.join(PUBLISH_ROOT, 'vendor');
const MANIFEST_DOMAIN = 'GALA-PUBLISH-SOURCE-VENDOR-MANIFEST-V1';
const MANIFEST_SCHEMA_VERSION = '1.0.0';

/** @type {readonly Readonly<{name: string, version: string, source: string}>[]} */
export const SOURCE_PACKAGES = Object.freeze(
  [
    { name: '@rathnasgala2/schemas', version: '3.8.0', source: 'schema' },
    { name: '@rathnasgala2/template', version: '4.0.0', source: 'template' },
    {
      name: '@rathnasgala2/theme-amaze',
      version: '4.0.0',
      source: 'theme-amaze',
    },
    {
      name: '@rathnasgala2/theme-default',
      version: '4.0.0',
      source: 'theme-default',
    },
    {
      name: '@rathnasgala2/theme-editorial',
      version: '4.0.0',
      source: 'theme-editorial',
    },
    {
      name: '@rathnasgala2/theme-flashy',
      version: '4.0.0',
      source: 'theme-flashy',
    },
    {
      name: '@rathnasgala2/theme-minimal',
      version: '4.0.0',
      source: 'theme-minimal',
    },
    {
      name: '@rathnasgala2/theme-zebra',
      version: '4.0.0',
      source: 'theme-zebra',
    },
  ].map((definition) => Object.freeze(definition)),
);

/**
 * @param {string} packageName npm package name
 * @param {string} version exact package version
 * @returns {string} npm's deterministic pack filename
 */
export function tarballFilename(packageName, version) {
  return `${packageName.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`;
}

/**
 * @param {Buffer} bytes bytes to hash
 * @param {'sha256' | 'sha512'} algorithm digest algorithm
 * @returns {string} tagged hexadecimal SHA-256 or SRI SHA-512
 */
function digest(bytes, algorithm) {
  const hash = createHash(algorithm).update(bytes);
  return algorithm === 'sha256'
    ? `sha256:${hash.digest('hex')}`
    : `sha512-${hash.digest('base64')}`;
}

/**
 * Produce a stable JSON representation independent of object insertion order.
 *
 * @param {unknown} value JSON value
 * @returns {string} canonical JSON
 */
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {Record<string, unknown>} manifest manifest without manifestDigest
 * @returns {string} domain-separated manifest digest
 */
function manifestDigest(manifest) {
  return digest(
    Buffer.from(`${MANIFEST_DOMAIN}\0${canonicalJson(manifest)}`, 'utf8'),
    'sha256',
  );
}

/**
 * @param {string} archive tarball path
 * @returns {Promise<Record<string, any>>} packed package manifest
 */
async function readPackedManifest(archive) {
  const { stdout } = await execFileAsync(
    'tar',
    ['-xOf', archive, 'package/package.json'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

/**
 * @param {Readonly<{name: string, version: string, source: string}>} definition package definition
 * @param {string} sourceRoot root containing source package directories
 * @param {string} outputDirectory destination directory
 * @returns {Promise<string>} generated tarball path
 */
async function packOne(definition, sourceRoot, outputDirectory) {
  const sourceDirectory = path.join(sourceRoot, definition.source);
  const sourceManifest = JSON.parse(
    await readFile(path.join(sourceDirectory, 'package.json'), 'utf8'),
  );
  if (
    sourceManifest.name !== definition.name ||
    sourceManifest.version !== definition.version
  ) {
    throw new Error(
      `${sourceDirectory}/package.json: expected ${definition.name}@${definition.version}, found ${String(sourceManifest.name)}@${String(sourceManifest.version)}`,
    );
  }
  if (definition.name === '@rathnasgala2/template') {
    if (
      sourceManifest.peerDependencies?.['@rathnasgala2/schemas'] !== '3.8.0' ||
      sourceManifest.dependencies?.['@rathnasgala2/schemas'] !== undefined
    ) {
      throw new Error(
        `${sourceDirectory}/package.json: Template must consume @rathnasgala2/schemas through exact peerDependency 3.8.0 before it can be vendored.`,
      );
    }
  }

  await mkdir(outputDirectory, { recursive: true });
  const cacheDirectory = path.join(outputDirectory, '.npm-cache');
  const { stdout } = await execFileAsync(
    'npm',
    [
      'pack',
      sourceDirectory,
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      outputDirectory,
    ],
    {
      cwd: PUBLISH_ROOT,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, npm_config_cache: cacheDirectory },
    },
  );
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error(
      `npm pack returned an unexpected result for ${definition.name}`,
    );
  }
  const filename = result[0]?.filename;
  const expectedFilename = tarballFilename(definition.name, definition.version);
  if (filename !== expectedFilename) {
    throw new Error(
      `npm pack named ${definition.name} ${String(filename)}; expected ${expectedFilename}`,
    );
  }
  return path.join(outputDirectory, filename);
}

/**
 * @param {string} sourceRoot root containing source package directories
 * @param {string} outputDirectory destination directory
 * @returns {Promise<Record<string, unknown>>} generated manifest without manifestDigest
 */
async function generatePackageSet(sourceRoot, outputDirectory) {
  /** @type {Record<string, unknown>[]} */
  const packages = [];
  for (const definition of SOURCE_PACKAGES) {
    const archive = await packOne(definition, sourceRoot, outputDirectory);
    const bytes = await readFile(archive);
    packages.push({
      name: definition.name,
      version: definition.version,
      source: `../${definition.source}`,
      file: `packages/${path.basename(archive)}`,
      byteLength: bytes.byteLength,
      sha256: digest(bytes, 'sha256'),
      sha512: digest(bytes, 'sha512'),
    });
  }
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, packages };
}

/**
 * Repack every source package twice and require byte-for-byte equality before
 * updating the committed vendor directory.
 *
 * @param {{sourceRoot?: string, vendorRoot?: string}} [options] paths
 * @returns {Promise<void>} resolves after deterministic artifacts are written
 */
export async function refreshVendoredPackages(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot ?? DEFAULT_SOURCE_ROOT);
  const vendorRoot = path.resolve(options.vendorRoot ?? DEFAULT_VENDOR_ROOT);
  const scratch = await mkdtemp(path.join(tmpdir(), 'gala-source-vendor-'));
  try {
    const firstRoot = path.join(scratch, 'first');
    const secondRoot = path.join(scratch, 'second');
    const firstManifest = await generatePackageSet(sourceRoot, firstRoot);
    const secondManifest = await generatePackageSet(sourceRoot, secondRoot);
    if (canonicalJson(firstManifest) !== canonicalJson(secondManifest)) {
      throw new Error(
        'Source package manifest is not deterministic across two packs.',
      );
    }
    for (const definition of SOURCE_PACKAGES) {
      const filename = tarballFilename(definition.name, definition.version);
      const first = await readFile(path.join(firstRoot, filename));
      const second = await readFile(path.join(secondRoot, filename));
      if (!first.equals(second)) {
        throw new Error(
          `${definition.name}: npm pack output is not deterministic.`,
        );
      }
    }

    const packagesRoot = path.join(vendorRoot, 'packages');
    await rm(packagesRoot, { recursive: true, force: true });
    await mkdir(packagesRoot, { recursive: true });
    for (const definition of SOURCE_PACKAGES) {
      const filename = tarballFilename(definition.name, definition.version);
      await cp(
        path.join(firstRoot, filename),
        path.join(packagesRoot, filename),
      );
    }
    const manifest = {
      ...firstManifest,
      manifestDigest: manifestDigest(firstManifest),
    };
    await writeFile(
      path.join(vendorRoot, 'source-packages.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * @param {string} workspaceRoot publish repository root
 * @param {Record<string, any>} manifest verified vendor manifest
 * @returns {Promise<string[]>} lockfile integration diagnostics
 */
async function lockfileDiagnostics(workspaceRoot, manifest) {
  const lock = JSON.parse(
    await readFile(path.join(workspaceRoot, 'package-lock.json'), 'utf8'),
  );
  /** @type {string[]} */
  const diagnostics = [];
  for (const entry of manifest.packages) {
    const key = `node_modules/${entry.name}`;
    const locked = lock.packages?.[key];
    const expectedResolved = `file:vendor/${entry.file}`;
    if (locked?.version !== entry.version) {
      diagnostics.push(
        `package-lock.json ${key}: expected version ${entry.version}, found ${String(locked?.version)}`,
      );
    }
    if (locked?.resolved !== expectedResolved) {
      diagnostics.push(
        `package-lock.json ${key}: expected resolved ${expectedResolved}, found ${String(locked?.resolved)}`,
      );
    }
    if (locked?.integrity !== entry.sha512) {
      diagnostics.push(
        `package-lock.json ${key}: integrity does not match vendor manifest`,
      );
    }
  }
  return diagnostics;
}

/**
 * Verify the committed vendor set without reading sibling source packages.
 *
 * @param {{workspaceRoot?: string, vendorRoot?: string, checkLockfile?: boolean}} [options] paths and checks
 * @returns {Promise<void>} resolves only for the exact complete package set
 */
export async function verifyVendoredPackages(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? PUBLISH_ROOT);
  const vendorRoot = path.resolve(
    options.vendorRoot ?? path.join(workspaceRoot, 'vendor'),
  );
  const manifestPath = path.join(vendorRoot, 'source-packages.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  /** @type {string[]} */
  const diagnostics = [];
  const topLevelKeys = Object.keys(manifest).sort();
  const expectedTopLevelKeys = ['manifestDigest', 'packages', 'schemaVersion'];
  if (canonicalJson(topLevelKeys) !== canonicalJson(expectedTopLevelKeys)) {
    diagnostics.push(
      `${manifestPath}: expected exactly ${expectedTopLevelKeys.join(', ')}; found ${topLevelKeys.join(', ')}`,
    );
  }
  const unsignedManifest = {
    schemaVersion: manifest.schemaVersion,
    packages: manifest.packages,
  };
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    diagnostics.push(
      `${manifestPath}: expected schemaVersion ${MANIFEST_SCHEMA_VERSION}`,
    );
  }
  if (manifest.manifestDigest !== manifestDigest(unsignedManifest)) {
    diagnostics.push(`${manifestPath}: manifestDigest is invalid`);
  }
  if (!Array.isArray(manifest.packages)) {
    throw new Error(`${manifestPath}: packages must be an array`);
  }
  const vendorEntries = /** @type {Record<string, any>[]} */ (
    manifest.packages
  );
  if (vendorEntries.length !== SOURCE_PACKAGES.length) {
    diagnostics.push(
      `${manifestPath}: expected ${SOURCE_PACKAGES.length} package entries, found ${vendorEntries.length}`,
    );
  }

  const expectedFiles = SOURCE_PACKAGES.map((definition) =>
    tarballFilename(definition.name, definition.version),
  ).sort();
  const actualFiles = (await readdir(path.join(vendorRoot, 'packages')))
    .filter((file) => file.endsWith('.tgz'))
    .sort();
  if (canonicalJson(actualFiles) !== canonicalJson(expectedFiles)) {
    diagnostics.push(
      `${path.join(vendorRoot, 'packages')}: expected exactly ${expectedFiles.join(', ')}, found ${actualFiles.join(', ')}`,
    );
  }

  for (const [index, definition] of SOURCE_PACKAGES.entries()) {
    const entry = vendorEntries[index];
    const expectedFile = `packages/${tarballFilename(definition.name, definition.version)}`;
    if (
      entry?.name !== definition.name ||
      entry?.version !== definition.version ||
      entry?.source !== `../${definition.source}` ||
      entry?.file !== expectedFile
    ) {
      diagnostics.push(
        `${manifestPath}: package entry ${index} must be ${definition.name}@${definition.version} from ../${definition.source} in ${expectedFile}`,
      );
      continue;
    }
    const entryKeys = Object.keys(entry).sort();
    const expectedEntryKeys = [
      'byteLength',
      'file',
      'name',
      'sha256',
      'sha512',
      'source',
      'version',
    ];
    if (canonicalJson(entryKeys) !== canonicalJson(expectedEntryKeys)) {
      diagnostics.push(
        `${manifestPath}: ${definition.name} expected exactly ${expectedEntryKeys.join(', ')}; found ${entryKeys.join(', ')}`,
      );
    }
    const archive = path.join(vendorRoot, entry.file);
    let bytes;
    try {
      bytes = await readFile(archive);
    } catch {
      diagnostics.push(`${archive}: vendored tarball is missing`);
      continue;
    }
    if (entry.byteLength !== bytes.byteLength) {
      diagnostics.push(`${archive}: byteLength does not match vendor manifest`);
    }
    if (entry.sha256 !== digest(bytes, 'sha256')) {
      diagnostics.push(`${archive}: SHA-256 does not match vendor manifest`);
    }
    if (entry.sha512 !== digest(bytes, 'sha512')) {
      diagnostics.push(`${archive}: SHA-512 does not match vendor manifest`);
    }
    try {
      const packedManifest = await readPackedManifest(archive);
      if (
        packedManifest.name !== definition.name ||
        packedManifest.version !== definition.version
      ) {
        diagnostics.push(
          `${archive}: packed identity must be ${definition.name}@${definition.version}`,
        );
      }
      if (
        definition.name === '@rathnasgala2/template' &&
        (packedManifest.peerDependencies?.['@rathnasgala2/schemas'] !==
          '3.8.0' ||
          packedManifest.dependencies?.['@rathnasgala2/schemas'] !== undefined)
      ) {
        diagnostics.push(
          `${archive}: Template must declare exact @rathnasgala2/schemas peerDependency 3.8.0 and no runtime file dependency`,
        );
      }
    } catch (error) {
      diagnostics.push(
        `${archive}: cannot read packed package.json (${String(error)})`,
      );
    }
  }

  const themesByName = new Map(
    THEME_CATALOG.map((entry) => [entry.package, entry]),
  );
  for (const entry of vendorEntries.filter((candidate) =>
    candidate.name.startsWith('@rathnasgala2/theme-'),
  )) {
    const catalog = themesByName.get(entry.name);
    if (
      catalog?.version !== entry.version ||
      catalog?.integrity !== entry.sha256
    ) {
      diagnostics.push(
        `${entry.name}: vendor identity ${entry.version}/${entry.sha256} does not match THEME_CATALOG`,
      );
    }
    themesByName.delete(entry.name);
  }
  if (themesByName.size > 0) {
    diagnostics.push(
      `THEME_CATALOG has unvendored packages: ${[...themesByName.keys()].join(', ')}`,
    );
  }

  if (options.checkLockfile !== false) {
    diagnostics.push(...(await lockfileDiagnostics(workspaceRoot, manifest)));
  }
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }
}

/**
 * Rebuild into scratch space and compare every byte with the committed vendor
 * set. This developer gate intentionally requires the sibling source tree;
 * normal CI and isolated installs use {@link verifyVendoredPackages} instead.
 *
 * @returns {Promise<void>} resolves when source and committed artifacts agree
 */
async function checkSourceReproducibility() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'gala-source-check-'));
  try {
    await refreshVendoredPackages({ vendorRoot: scratch });
    const expectedManifest = await readFile(
      path.join(DEFAULT_VENDOR_ROOT, 'source-packages.json'),
    );
    const actualManifest = await readFile(
      path.join(scratch, 'source-packages.json'),
    );
    if (!expectedManifest.equals(actualManifest)) {
      throw new Error(
        'Committed vendor manifest differs from a fresh source pack.',
      );
    }
    for (const definition of SOURCE_PACKAGES) {
      const filename = tarballFilename(definition.name, definition.version);
      const expected = await readFile(
        path.join(DEFAULT_VENDOR_ROOT, 'packages', filename),
      );
      const actual = await readFile(path.join(scratch, 'packages', filename));
      if (!expected.equals(actual)) {
        throw new Error(
          `${definition.name}: committed tarball differs from source.`,
        );
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * @returns {Promise<void>} command completion
 */
async function main() {
  const command = process.argv[2] ?? '--check';
  if (command === '--refresh') {
    await refreshVendoredPackages();
    await verifyVendoredPackages({ checkLockfile: false });
    process.stdout.write(
      `source-vendor: refreshed ${SOURCE_PACKAGES.length} deterministic package tarballs\n`,
    );
    return;
  }
  if (command === '--check-source') {
    await verifyVendoredPackages();
    await checkSourceReproducibility();
    process.stdout.write(
      `source-vendor: ${SOURCE_PACKAGES.length} committed tarballs equal two fresh source packs\n`,
    );
    return;
  }
  if (command !== '--check') {
    throw new Error(`Unknown source-vendor command: ${command}`);
  }
  await verifyVendoredPackages();
  const bytes = await stat(
    path.join(DEFAULT_VENDOR_ROOT, 'source-packages.json'),
  );
  process.stdout.write(
    `source-vendor: verified ${SOURCE_PACKAGES.length} locked tarballs and ${bytes.size}-byte manifest\n`,
  );
}

await runIfMain(import.meta.url, main);
