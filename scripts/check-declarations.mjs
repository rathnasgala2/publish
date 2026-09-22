#!/usr/bin/env node
/**
 * Assert a package's committed `.d.ts` declarations are byte-identical to a
 * fresh `tsc --declaration --emitDeclarationOnly` emit (DEC-094: "If a
 * generated declaration file is committed, a CI check asserts it is
 * regenerable and current.").
 *
 * Usage: node scripts/check-declarations.mjs <package-directory-name>
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '..');

/**
 * List every regular file under a directory, recursively, as paths relative
 * to that directory.
 *
 * @param {string} dir directory to walk
 * @returns {string[]} sorted relative file paths
 */
function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full).map((p) => path.join(entry.name, p)));
    } else if (entry.isFile()) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

/**
 * Run the check for one workspace package.
 *
 * @param {string} packageName directory name under `packages/`
 * @returns {void}
 */
function run(packageName) {
  const packageDir = path.join(workspaceRoot, 'packages', packageName);
  const committedDir = path.join(packageDir, 'types');
  const scratch = mkdtempSync(path.join(tmpdir(), 'gala-declarations-'));
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        path.join(packageDir, 'tsconfig.declarations.json'),
        '--outDir',
        scratch,
      ],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      throw new Error(`Declaration emit failed for ${packageName}`);
    }
    const committed = listFiles(committedDir);
    const fresh = listFiles(scratch);
    if (JSON.stringify(committed) !== JSON.stringify(fresh)) {
      throw new Error(
        `Declaration file set drifted for ${packageName}: committed=${JSON.stringify(
          committed,
        )} fresh=${JSON.stringify(fresh)}`,
      );
    }
    for (const relative of committed) {
      const committedBytes = readFileSync(path.join(committedDir, relative));
      const freshBytes = readFileSync(path.join(scratch, relative));
      if (!committedBytes.equals(freshBytes)) {
        throw new Error(
          `Declaration file ${relative} is not byte-identical to a fresh emit for ${packageName}`,
        );
      }
    }
    process.stdout.write(
      `declarations:check ${packageName}: ${committed.length} file(s) byte-identical\n`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const packageName = process.argv[2];
if (!packageName) {
  process.stderr.write(
    'usage: check-declarations.mjs <package-directory-name>\n',
  );
  process.exit(2);
}
run(packageName);
